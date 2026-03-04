import * as vscode from 'vscode';
import { TdsClient, TdsConnectionConfig, ServerCapabilities } from './services/TdsClient';

// ---------------------------------------------------------------------------
// Item types
// ---------------------------------------------------------------------------

export enum SsisTreeItemType {
  Server = 'server',
  Catalog = 'catalog',
  Folder = 'folder',
  ProjectsContainer = 'projectsContainer',
  Project = 'project',
  Package = 'package',
  EnvironmentsContainer = 'environmentsContainer',
  Environment = 'environment',
  EnvironmentVariable = 'environmentVariable',
  ConnectPrompt = 'connectPrompt',
  // MSDB Package Store (Package Deployment Model)
  MsdbStore = 'msdbStore',
  MsdbFolder = 'msdbFolder',
  MsdbPackage = 'msdbPackage',
}

// ---------------------------------------------------------------------------
// Tree Item
// ---------------------------------------------------------------------------

export class SsisTreeItem extends vscode.TreeItem {
  /** Set by SsisTreeDataProvider on construction so icons resolve correctly. */
  static extensionUri: vscode.Uri | undefined;

  constructor(
    public readonly label: string,
    public readonly itemType: SsisTreeItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly metadata?: Record<string, any>,
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;
    this._applyIcon();
  }

  private _applyIcon(): void {
    // Custom SVG icons in media/icons/
    const svgIconMap: Partial<Record<SsisTreeItemType, string>> = {
      [SsisTreeItemType.Server]: 'server',
      [SsisTreeItemType.Catalog]: 'connection',
      [SsisTreeItemType.Folder]: 'folder',
      [SsisTreeItemType.Project]: 'project',
      [SsisTreeItemType.Package]: 'package',
      [SsisTreeItemType.Environment]: 'environment',
      [SsisTreeItemType.ConnectPrompt]: 'connection',
      [SsisTreeItemType.MsdbStore]: 'connection',
      [SsisTreeItemType.MsdbFolder]: 'folder',
      [SsisTreeItemType.MsdbPackage]: 'package',
    };
    const svgName = svgIconMap[this.itemType];
    if (svgName && SsisTreeItem.extensionUri) {
      const iconUri = vscode.Uri.joinPath(SsisTreeItem.extensionUri, 'media', 'icons', `${svgName}.svg`);
      this.iconPath = { light: iconUri, dark: iconUri };
      return;
    }
    // Fallback to built-in codicons
    const codiconMap: Record<SsisTreeItemType, string> = {
      [SsisTreeItemType.Server]: 'server',
      [SsisTreeItemType.Catalog]: 'database',
      [SsisTreeItemType.Folder]: 'folder',
      [SsisTreeItemType.ProjectsContainer]: 'folder-library',
      [SsisTreeItemType.Project]: 'package',
      [SsisTreeItemType.Package]: 'file',
      [SsisTreeItemType.EnvironmentsContainer]: 'folder-opened',
      [SsisTreeItemType.Environment]: 'globe',
      [SsisTreeItemType.EnvironmentVariable]: 'key',
      [SsisTreeItemType.ConnectPrompt]: 'plug',
      [SsisTreeItemType.MsdbStore]: 'archive',
      [SsisTreeItemType.MsdbFolder]: 'folder',
      [SsisTreeItemType.MsdbPackage]: 'file',
    };
    this.iconPath = new vscode.ThemeIcon(codiconMap[this.itemType] ?? 'circle-outline');
  }
}

// ---------------------------------------------------------------------------
// Stored connection info
// ---------------------------------------------------------------------------

export interface SavedCatalogConnection {
  id: string;
  serverName: string;
  port: number;
  authType: 'sql' | 'windows';
  user?: string;
  /** Password is stored in VS Code SecretStorage, keyed by id */
}

// ---------------------------------------------------------------------------
// Tree Data Provider
// ---------------------------------------------------------------------------

export class SsisTreeDataProvider implements vscode.TreeDataProvider<SsisTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SsisTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Active TDS clients keyed by connection id */
  private _clients = new Map<string, TdsClient>();

  /** Cached server capabilities keyed by connection id */
  private _capabilities = new Map<string, ServerCapabilities>();

  /** Saved connections (persisted in global state) */
  private _connections: SavedCatalogConnection[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    SsisTreeItem.extensionUri = context.extensionUri;
    this._loadConnections();
  }

  // ── persistence ─────────────────────────────────────────────────────

  private _loadConnections(): void {
    this._connections =
      this.context.globalState.get<SavedCatalogConnection[]>('ssis.catalogConnections') ?? [];
  }

  private async _saveConnections(): Promise<void> {
    await this.context.globalState.update('ssis.catalogConnections', this._connections);
  }

  // ── public API ──────────────────────────────────────────────────────

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Prompt the user to add a new catalog connection. */
  async addConnection(): Promise<void> {
    const serverName = await vscode.window.showInputBox({
      prompt: 'SQL Server hostname or IP',
      placeHolder: 'localhost',
    });
    if (!serverName) { return; }

    const portStr = await vscode.window.showInputBox({
      prompt: 'Port',
      value: '1433',
    });
    const port = parseInt(portStr ?? '1433', 10) || 1433;

    const authType = await vscode.window.showQuickPick(
      [
        { label: 'SQL Server Authentication', value: 'sql' as const },
        { label: 'Windows Authentication (NTLM)', value: 'windows' as const },
      ],
      { placeHolder: 'Authentication type' },
    );
    if (!authType) { return; }

    let user: string | undefined;
    let password: string | undefined;

    if (authType.value === 'sql') {
      user = await vscode.window.showInputBox({ prompt: 'User name' });
      if (!user) { return; }
      password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
      if (password === undefined) { return; }
    }

    const id = `ssis-conn-${Date.now()}`;
    const conn: SavedCatalogConnection = {
      id,
      serverName,
      port,
      authType: authType.value,
      user,
    };

    // Store password in SecretStorage
    if (password !== undefined) {
      await this.context.secrets.store(id, password);
    }

    // Attempt to connect (to master — we detect SSISDB/msdb capabilities after)
    const client = new TdsClient();
    let caps: ServerCapabilities;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Connecting to ${serverName}…` },
        async () => {
          const config: TdsConnectionConfig = {
            server: serverName,
            port,
            database: 'master',
            trustedConnection: authType.value === 'windows',
            user,
            password,
          };
          await client.connect(config);
          caps = await client.detectCapabilities();
        },
      );
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to connect: ${err.message ?? err}`);
      return;
    }

    this._clients.set(id, client);
    this._capabilities.set(id, caps!);
    this._connections.push(conn);
    await this._saveConnections();
    this.refresh();

    const models: string[] = [];
    if (caps!.hasSsisdb) { models.push('SSISDB Catalog'); }
    if (caps!.hasMsdbStore) { models.push('MSDB Package Store'); }
    const modelsDesc = models.length > 0 ? ` (${models.join(', ')})` : ' (no SSIS stores detected)';
    vscode.window.showInformationMessage(`Connected to ${serverName}${modelsDesc}`);
  }

  /** Disconnect and remove a server connection. */
  async removeConnection(connectionId: string): Promise<void> {
    const client = this._clients.get(connectionId);
    if (client) {
      await client.disconnect();
      this._clients.delete(connectionId);
    }
    this._capabilities.delete(connectionId);
    this._connections = this._connections.filter((c) => c.id !== connectionId);
    await this._saveConnections();
    await this.context.secrets.delete(connectionId);
    this.refresh();
  }

  /** Get or create a TDS client for a saved connection. */
  async getClient(connectionId: string): Promise<TdsClient | undefined> {
    if (this._clients.has(connectionId)) {
      return this._clients.get(connectionId)!;
    }
    const conn = this._connections.find((c) => c.id === connectionId);
    if (!conn) { return undefined; }

    const password = await this.context.secrets.get(conn.id);
    const client = new TdsClient();
    const config: TdsConnectionConfig = {
      server: conn.serverName,
      port: conn.port,
      database: 'master',
      trustedConnection: conn.authType === 'windows',
      user: conn.user,
      password: password ?? undefined,
    };
    await client.connect(config);
    this._clients.set(conn.id, client);

    // Detect capabilities on reconnect if not cached
    if (!this._capabilities.has(conn.id)) {
      try {
        const caps = await client.detectCapabilities();
        this._capabilities.set(conn.id, caps);
      } catch { /* best effort */ }
    }

    return client;
  }

  /** Get detected capabilities for a connection. */
  getCapabilities(connectionId: string): ServerCapabilities | undefined {
    return this._capabilities.get(connectionId);
  }

  /** Get IDs of all active connections. */
  getConnectionIds(): string[] {
    return this._connections.map((c) => c.id);
  }

  /** Get connection metadata by id. */
  getConnection(id: string): SavedCatalogConnection | undefined {
    return this._connections.find((c) => c.id === id);
  }

  // ── TreeDataProvider ────────────────────────────────────────────────

  getTreeItem(element: SsisTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SsisTreeItem): Promise<SsisTreeItem[]> {
    // ── Root level ──
    if (!element) {
      const items: SsisTreeItem[] = [];

      // One node per saved server
      for (const conn of this._connections) {
        const serverItem = new SsisTreeItem(
          conn.serverName,
          SsisTreeItemType.Server,
          vscode.TreeItemCollapsibleState.Collapsed,
          { connectionId: conn.id },
        );
        serverItem.description = conn.authType === 'sql' ? conn.user : '(Windows)';
        items.push(serverItem);
      }

      // Always show a "Connect" entry at the bottom
      const connectItem = new SsisTreeItem(
        'Connect to SSIS Catalog…',
        SsisTreeItemType.ConnectPrompt,
        vscode.TreeItemCollapsibleState.None,
      );
      connectItem.command = {
        command: 'ssis.connectCatalog',
        title: 'Connect to SSIS Catalog',
      };
      items.push(connectItem);
      return items;
    }

    const meta = element.metadata ?? {};

    try {
      switch (element.itemType) {
        // ── Server → show available SSIS stores ──
        case SsisTreeItemType.Server: {
          const items: SsisTreeItem[] = [];
          // Ensure client is connected & capabilities are detected
          const client = await this.getClient(meta.connectionId);
          const caps = this._capabilities.get(meta.connectionId);

          if (caps?.hasSsisdb) {
            items.push(
              new SsisTreeItem(
                'SSISDB (Project Deployment)',
                SsisTreeItemType.Catalog,
                vscode.TreeItemCollapsibleState.Collapsed,
                { connectionId: meta.connectionId },
              ),
            );
          }

          if (caps?.hasMsdbStore) {
            items.push(
              new SsisTreeItem(
                'MSDB Package Store',
                SsisTreeItemType.MsdbStore,
                vscode.TreeItemCollapsibleState.Collapsed,
                { connectionId: meta.connectionId },
              ),
            );
          }

          if (items.length === 0) {
            const noStore = new SsisTreeItem(
              'No SSIS stores detected',
              SsisTreeItemType.ConnectPrompt,
              vscode.TreeItemCollapsibleState.None,
            );
            noStore.description = 'SSISDB and MSDB not found';
            items.push(noStore);
          }

          return items;
        }

        // ── Catalog → Folders ──
        case SsisTreeItemType.Catalog: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const folders = await client.getCatalogFolders();
          return folders.map((f) =>
            new SsisTreeItem(
              f.name,
              SsisTreeItemType.Folder,
              vscode.TreeItemCollapsibleState.Collapsed,
              { connectionId: meta.connectionId, folderId: f.folderId, folderName: f.name },
            ),
          );
        }

        // ── Folder → Projects + Environments containers ──
        case SsisTreeItemType.Folder: {
          return [
            new SsisTreeItem(
              'Projects',
              SsisTreeItemType.ProjectsContainer,
              vscode.TreeItemCollapsibleState.Collapsed,
              { connectionId: meta.connectionId, folderId: meta.folderId, folderName: meta.folderName },
            ),
            new SsisTreeItem(
              'Environments',
              SsisTreeItemType.EnvironmentsContainer,
              vscode.TreeItemCollapsibleState.Collapsed,
              { connectionId: meta.connectionId, folderId: meta.folderId, folderName: meta.folderName },
            ),
          ];
        }

        // ── ProjectsContainer → Project list ──
        case SsisTreeItemType.ProjectsContainer: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const projects = await client.getProjects(meta.folderId);
          return projects.map((p) => {
            const item = new SsisTreeItem(
              p.name,
              SsisTreeItemType.Project,
              vscode.TreeItemCollapsibleState.Collapsed,
              {
                connectionId: meta.connectionId,
                folderId: meta.folderId,
                folderName: meta.folderName,
                projectId: p.projectId,
                projectName: p.name,
              },
            );
            item.description = p.lastDeployedTime
              ? `deployed ${new Date(p.lastDeployedTime).toLocaleDateString()}`
              : '';
            return item;
          });
        }

        // ── Project → Package list ──
        case SsisTreeItemType.Project: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const packages = await client.getPackages(meta.projectId);
          return packages.map((pkg) =>
            new SsisTreeItem(
              pkg.name,
              SsisTreeItemType.Package,
              vscode.TreeItemCollapsibleState.None,
              {
                connectionId: meta.connectionId,
                folderId: meta.folderId,
                folderName: meta.folderName,
                projectId: meta.projectId,
                projectName: meta.projectName,
                packageName: pkg.name,
              },
            ),
          );
        }

        // ── EnvironmentsContainer → Environment list ──
        case SsisTreeItemType.EnvironmentsContainer: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const envs = await client.getEnvironments(meta.folderId);
          return envs.map((e) =>
            new SsisTreeItem(
              e.name,
              SsisTreeItemType.Environment,
              vscode.TreeItemCollapsibleState.Collapsed,
              {
                connectionId: meta.connectionId,
                folderId: meta.folderId,
                folderName: meta.folderName,
                environmentId: e.environmentId,
                environmentName: e.name,
              },
            ),
          );
        }

        // ── Environment → Variables ──
        case SsisTreeItemType.Environment: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const vars = await client.getEnvironmentVariables(meta.environmentId);
          return vars.map((v) => {
            const display = v.sensitive ? '••••••' : String(v.value);
            const item = new SsisTreeItem(
              `${v.name} = ${display}`,
              SsisTreeItemType.EnvironmentVariable,
              vscode.TreeItemCollapsibleState.None,
              {
                connectionId: meta.connectionId,
                environmentId: meta.environmentId,
                variableId: v.variableId,
                variableName: v.name,
              },
            );
            item.description = v.type;
            item.tooltip = v.description || v.name;
            return item;
          });
        }

        // ── MSDB Package Store → Folders ──
        case SsisTreeItemType.MsdbStore: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const allFolders = await client.getMsdbFolders();
          // Build folder hierarchy: find root folders (ones whose parent is not in the list,
          // or whose parent is themselves, which is the MSDB root convention)
          const folderIds = new Set(allFolders.map(f => f.folderId));
          const rootFolders = allFolders.filter(f =>
            !f.parentFolderId ||
            f.parentFolderId === f.folderId ||
            !folderIds.has(f.parentFolderId)
          );
          const items: SsisTreeItem[] = rootFolders.map((f) =>
            new SsisTreeItem(
              f.name,
              SsisTreeItemType.MsdbFolder,
              vscode.TreeItemCollapsibleState.Collapsed,
              { connectionId: meta.connectionId, msdbFolderId: f.folderId },
            ),
          );
          // Also show packages at the root level
          const rootPackages = await client.getMsdbAllPackages();
          const rootFolderIds = new Set(rootFolders.map(f => f.folderId));
          const orphanPackages = rootPackages.filter(p =>
            !rootFolderIds.has(p.folderId) || rootFolders.length === 0
          );
          // If there are no sub-folders, just show all packages
          if (rootFolders.length === 0) {
            return rootPackages.map((pkg) => {
              const item = new SsisTreeItem(
                pkg.name,
                SsisTreeItemType.MsdbPackage,
                vscode.TreeItemCollapsibleState.None,
                {
                  connectionId: meta.connectionId,
                  msdbPackageId: pkg.id,
                  packageName: pkg.name,
                },
              );
              if (pkg.description) { item.tooltip = pkg.description; }
              return item;
            });
          }
          return items;
        }

        // ── MSDB Folder → Sub-folders + Packages ──
        case SsisTreeItemType.MsdbFolder: {
          const client = await this.getClient(meta.connectionId);
          if (!client) { return []; }
          const items: SsisTreeItem[] = [];

          // Child folders
          const allFolders = await client.getMsdbFolders();
          const childFolders = allFolders.filter(f =>
            f.parentFolderId === meta.msdbFolderId && f.folderId !== f.parentFolderId
          );
          for (const f of childFolders) {
            items.push(
              new SsisTreeItem(
                f.name,
                SsisTreeItemType.MsdbFolder,
                vscode.TreeItemCollapsibleState.Collapsed,
                { connectionId: meta.connectionId, msdbFolderId: f.folderId },
              ),
            );
          }

          // Packages in this folder
          const packages = await client.getMsdbPackages(meta.msdbFolderId);
          for (const pkg of packages) {
            const item = new SsisTreeItem(
              pkg.name,
              SsisTreeItemType.MsdbPackage,
              vscode.TreeItemCollapsibleState.None,
              {
                connectionId: meta.connectionId,
                msdbPackageId: pkg.id,
                packageName: pkg.name,
                msdbFolderId: meta.msdbFolderId,
              },
            );
            if (pkg.description) { item.tooltip = pkg.description; }
            items.push(item);
          }

          return items;
        }

        default:
          return [];
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Catalog query failed: ${err.message ?? err}`);
      return [];
    }
  }
}
