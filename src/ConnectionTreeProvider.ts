import * as vscode from 'vscode';
import { ConnectionManager } from './models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Icon mapping for connection types
// ---------------------------------------------------------------------------

const CONNECTION_TYPE_ICONS: Record<string, string> = {
  OLEDB: 'database',
  'ADO.NET': 'plug',
  FLATFILE: 'file-text',
  EXCEL: 'table',
  FILE: 'file',
  FTP: 'cloud-upload',
  HTTP: 'globe',
  SMTP: 'mail',
  MSOLAP: 'graph-line',
};

// Custom SVG icons for connection types
const CONNECTION_TYPE_SVG: Record<string, string> = {
  OLEDB: 'connection',
  'ADO.NET': 'connection',
};

// ---------------------------------------------------------------------------
// Tree Items
// ---------------------------------------------------------------------------

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue?: string,
    public readonly connectionManager?: ConnectionManager
  ) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConnectionTreeItem | undefined | null | void> =
    new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConnectionTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private _connectionManagers: ConnectionManager[] = [];
  private _extensionUri: vscode.Uri | undefined;

  constructor(extensionUri?: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  /**
   * Update the connection managers shown in the tree.
   */
  setConnectionManagers(managers: ConnectionManager[]): void {
    this._connectionManagers = managers;
    this.refresh();
  }

  /**
   * Add a single connection manager and refresh.
   */
  addConnectionManager(cm: ConnectionManager): void {
    this._connectionManagers.push(cm);
    this.refresh();
  }

  /**
   * Remove a connection manager by ID and refresh.
   */
  removeConnectionManager(id: string): void {
    this._connectionManagers = this._connectionManagers.filter(
      (c) => c.id !== id && c.dtsId !== id
    );
    this.refresh();
  }

  /**
   * Update a connection manager and refresh.
   */
  updateConnectionManager(id: string, updates: Partial<ConnectionManager>): void {
    this._connectionManagers = this._connectionManagers.map((c) =>
      c.id === id || c.dtsId === id ? { ...c, ...updates } : c
    );
    this.refresh();
  }

  /**
   * Get the current connection managers.
   */
  getConnectionManagers(): ConnectionManager[] {
    return this._connectionManagers;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionTreeItem): Thenable<ConnectionTreeItem[]> {
    if (element) {
      // Child level — show connection details
      const cm = element.connectionManager;
      if (!cm) { return Promise.resolve([]); }

      const items: ConnectionTreeItem[] = [];

      // Type
      const typeItem = new ConnectionTreeItem(
        `Type: ${cm.creationName}`,
        vscode.TreeItemCollapsibleState.None,
        'connectionDetail'
      );
      typeItem.iconPath = new vscode.ThemeIcon('symbol-type-parameter');
      items.push(typeItem);

      // Connection string (truncated)
      const connStr = cm.connectionString.length > 60
        ? cm.connectionString.substring(0, 57) + '…'
        : cm.connectionString;
      const connItem = new ConnectionTreeItem(
        connStr,
        vscode.TreeItemCollapsibleState.None,
        'connectionDetail'
      );
      connItem.iconPath = new vscode.ThemeIcon('link');
      connItem.tooltip = cm.connectionString;
      items.push(connItem);

      // Description (if present)
      if (cm.description) {
        const descItem = new ConnectionTreeItem(
          cm.description,
          vscode.TreeItemCollapsibleState.None,
          'connectionDetail'
        );
        descItem.iconPath = new vscode.ThemeIcon('info');
        items.push(descItem);
      }

      return Promise.resolve(items);
    }

    // Root level
    if (this._connectionManagers.length === 0) {
      const placeholder = new ConnectionTreeItem(
        'No package open',
        vscode.TreeItemCollapsibleState.None,
        'noPackage'
      );
      placeholder.iconPath = new vscode.ThemeIcon('info');
      return Promise.resolve([placeholder]);
    }

    return Promise.resolve(
      this._connectionManagers.map((cm) => {
        const item = new ConnectionTreeItem(
          cm.objectName,
          vscode.TreeItemCollapsibleState.Collapsed,
          'connectionManager',
          cm
        );
        // Use custom SVG if available, otherwise fall back to codicon
        const svgName = CONNECTION_TYPE_SVG[cm.creationName];
        if (svgName && this._extensionUri) {
          const iconUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'icons', `${svgName}.svg`);
          item.iconPath = { light: iconUri, dark: iconUri };
        } else {
          const iconName = CONNECTION_TYPE_ICONS[cm.creationName] ?? 'plug';
          item.iconPath = new vscode.ThemeIcon(iconName);
        }
        item.tooltip = `${cm.creationName}: ${cm.objectName}`;
        item.description = cm.creationName;
        return item;
      })
    );
  }
}
