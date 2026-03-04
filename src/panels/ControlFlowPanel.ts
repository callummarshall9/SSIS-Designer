/**
 * ControlFlowPanel – extension-host side panel manager.
 *
 * Creates/shows the webview panel, loads the built webview content,
 * handles messages from the webview (model updates, save requests),
 * and sends model data to the webview on open.
 */

import * as vscode from 'vscode';
import { DtsxSerializer } from '../canvas/shared/DtsxSerializer';
import { SsisPackageModel } from '../models/SsisPackageModel';
import { getControlFlowNodeType } from '../models/CanvasModel';
import { Node, Edge } from 'reactflow';

export class ControlFlowPanel {
  public static readonly viewType = 'ssisDesigner.controlFlow';

  private panel: vscode.WebviewPanel | undefined;
  private model: SsisPackageModel | undefined;
  private serializer: DtsxSerializer;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument
  ) {
    this.serializer = new DtsxSerializer();
  }

  /** Show or create the panel and load the document model. */
  public show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      ControlFlowPanel.viewType,
      `Control Flow – ${this.document.uri.path.split('/').pop()}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
    this.setupMessageListener();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach((d) => d.dispose());
      this.disposables = [];
    });
  }

  /** Parse the document and send the model to the webview. */
  public sendModelToWebview(): void {
    if (!this.panel) { return; }
    try {
      this.model = this.serializer.parse(this.document.getText());

      // Convert model executables to React Flow nodes and edges
      const nodes: Node[] = this.model.executables.map((exec) => ({
        id: exec.id,
        type: getControlFlowNodeType(exec.executableType),
        position: { x: exec.x, y: exec.y },
        data: exec,
        style: { width: exec.width || 200, height: exec.height || 80 },
      }));

      const edges: Edge[] = this.model.precedenceConstraints.map((pc) => ({
        id: pc.id,
        source: pc.fromExecutableId,
        target: pc.toExecutableId,
        type: 'precedence',
        data: pc,
      }));

      this.panel.webview.postMessage({
        type: 'loadModel',
        model: this.model,
        nodes,
        edges,
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to parse SSIS package: ${err}`);
    }
  }

  /** Handle messages from the webview. */
  private setupMessageListener(): void {
    if (!this.panel) { return; }

    const listener = this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          this.sendModelToWebview();
          break;

        case 'canvasStateChanged': {
          // Webview canvas state changed — apply to document
          if (!this.model) { return; }
          // Update executables from node data
          this.model.executables = (message.nodes ?? []).map((n: Node) => ({
            ...n.data,
            x: n.position?.x ?? n.data.x,
            y: n.position?.y ?? n.data.y,
          }));
          // Update precedence constraints from edge data
          this.model.precedenceConstraints = (message.edges ?? [])
            .filter((e: Edge) => e.data)
            .map((e: Edge) => e.data);

          // Serialize back to XML and apply edit
          try {
            const xml = this.serializer.serialize(this.model, this.document.getText());
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              this.document.uri,
              new vscode.Range(0, 0, this.document.lineCount, 0),
              xml
            );
            await vscode.workspace.applyEdit(edit);
          } catch (err) {
            console.error('Failed to serialize SSIS model:', err);
          }
          break;
        }

        case 'openDataFlow': {
          // Open data flow canvas for a specific executable
          vscode.commands.executeCommand('ssis.openDataFlow', message.executableId);
          break;
        }

        case 'updateVariables': {
          if (!this.model) { return; }
          this.model.variables = message.variables;
          break;
        }
      }
    });

    this.disposables.push(listener);
  }

  /** Build the webview HTML. */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles', 'canvas.css')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   script-src 'nonce-${nonce}';
                   img-src ${webview.cspSource} data:;
                   font-src ${webview.cspSource};">
    <link href="${styleUri}" rel="stylesheet" />
    <title>SSIS Designer – Control Flow</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /** Dispose the panel. */
  public dispose(): void {
    this.panel?.dispose();
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
