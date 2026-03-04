/**
 * EnvironmentEditorPanel – extension-side panel for SSISDB environment editing.
 *
 * Opens a webview that hosts the EnvironmentEditor React component.
 * Handles CRUD operations against SQL Server via TdsClient.
 */

import * as vscode from 'vscode';
import { TdsClient, CatalogEnvVariable } from '../services/TdsClient';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export class EnvironmentEditorPanel {
  public static currentPanel: EnvironmentEditorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly client: TdsClient;
  private disposables: vscode.Disposable[] = [];

  // ── static factory ──────────────────────────────────────────────────

  static async createOrShow(
    extensionUri: vscode.Uri,
    client: TdsClient,
    folderName: string,
    environmentName: string,
  ): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (EnvironmentEditorPanel.currentPanel) {
      EnvironmentEditorPanel.currentPanel.panel.reveal(column);
      await EnvironmentEditorPanel.currentPanel._loadEnvironment(folderName, environmentName);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ssisEnvironmentEditor',
      `Environment: ${environmentName}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    EnvironmentEditorPanel.currentPanel = new EnvironmentEditorPanel(panel, client, extensionUri);
    await EnvironmentEditorPanel.currentPanel._loadEnvironment(folderName, environmentName);
  }

  // ── static helpers ──────────────────────────────────────────────────

  static async createNewEnvironment(
    client: TdsClient,
    folderName: string,
  ): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Environment name' });
    if (!name) { return; }
    const desc = await vscode.window.showInputBox({ prompt: 'Description (optional)' }) ?? '';
    try {
      await client.createEnvironment(folderName, name, desc);
      vscode.window.showInformationMessage(`Environment "${name}" created.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to create environment: ${err.message ?? err}`);
    }
  }

  static async deleteEnvironment(
    client: TdsClient,
    folderName: string,
    envName: string,
  ): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      `Delete environment "${envName}"?`,
      { modal: true },
      'Delete',
    );
    if (answer !== 'Delete') { return; }
    try {
      await client.deleteEnvironment(folderName, envName);
      vscode.window.showInformationMessage(`Environment "${envName}" deleted.`);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to delete environment: ${err.message ?? err}`);
    }
  }

  // ── constructor ─────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    client: TdsClient,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.client = client;

    this.panel.webview.html = this._getHtmlForWebview(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this.disposables,
    );
  }

  dispose(): void {
    EnvironmentEditorPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  // ── load environment data ───────────────────────────────────────────

  private async _loadEnvironment(folderName: string, environmentName: string): Promise<void> {
    try {
      // Get environment id first
      const envs = await this.client.getEnvironments(0); // We use folder name instead
      // Query environment variables by folder+env name
      const vars = await this.client.getEnvironmentVariablesByName(folderName, environmentName);
      this.panel.webview.postMessage({
        type: 'loadEnvironment',
        folderName,
        environmentName,
        description: '',
        variables: vars,
      });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'environmentError',
        error: err.message ?? String(err),
      });
    }
  }

  // ── handle messages from webview ────────────────────────────────────

  private async _handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'saveEnvironment':
        await this._saveEnvironment(msg);
        break;
    }
  }

  private async _saveEnvironment(msg: any): Promise<void> {
    const { folderName, environmentName, description, variables } = msg;
    try {
      // Update environment description
      await this.client.setEnvironmentProperty(folderName, environmentName, 'description', description ?? '');

      for (const v of variables as any[]) {
        if (v._state === 'new') {
          await this.client.createEnvironmentVariable(
            folderName, environmentName,
            v.name, v.type, v.value, v.sensitive, v.description,
          );
        } else if (v._state === 'modified') {
          await this.client.setEnvironmentVariableValue(
            folderName, environmentName, v.name, v.value,
          );
        } else if (v._state === 'deleted' && v.variableId > 0) {
          await this.client.deleteEnvironmentVariable(
            folderName, environmentName, v.name,
          );
        }
      }

      this.panel.webview.postMessage({ type: 'environmentSaved' });
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'environmentSaved',
        error: err.message ?? String(err),
      });
    }
  }

  // ── webview HTML ────────────────────────────────────────────────────

  private _getHtmlForWebview(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'canvas.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Environment Editor</title>
</head>
<body>
  <div id="root" data-view="environmentEditor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
