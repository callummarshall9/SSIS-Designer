import * as vscode from 'vscode';
import { ConnectionManagerPanelRelay } from './panels/ConnectionManagerPanel';
import { VariablePanelRelay } from './panels/VariablePanel';

export class DtsxEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'ssisDesigner.dtsxEditor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new DtsxEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            DtsxEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        );
    }

    /** Callback fired when connection managers change, so the tree can refresh. */
    public onConnectionManagersChanged?: () => void;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Configure webview options
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview'),
                vscode.Uri.joinPath(this.context.extensionUri, 'media'),
            ],
        };

        // Set initial HTML content
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        // In-memory model reference (parsed elsewhere, but we track the document)
        let currentModel: any = undefined;

        const getModel = () => currentModel;
        const onModelChanged = () => {
            // Mark document dirty by writing back
            const text = document.getText(); // For simple relay; serialize model in production
            // Fire connection manager changed event
            this.onConnectionManagersChanged?.();
        };

        // Set up relay handlers
        const connectionManagerRelay = new ConnectionManagerPanelRelay(getModel, onModelChanged);
        const variableRelay = new VariablePanelRelay(getModel, onModelChanged);

        // Send the initial document content to the webview
        function updateWebview(): void {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        }

        // Listen for document changes and sync to webview
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
            (e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    updateWebview();
                }
            }
        );

        // Dispose listener when the panel is closed
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
            connectionManagerRelay.dispose();
        });

        // Listen for messages from the webview
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'updateModel': {
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        message.text
                    );
                    vscode.workspace.applyEdit(edit);
                    return;
                }
                case 'ready': {
                    updateWebview();
                    return;
                }

                // Connection manager messages
                case 'addConnectionManager':
                case 'updateConnectionManager':
                case 'removeConnectionManager': {
                    await connectionManagerRelay.handleMessage(message);
                    this.onConnectionManagersChanged?.();
                    return;
                }

                case 'testConnection': {
                    const result = await connectionManagerRelay.testConnection(
                        message.connectionString,
                        message.connectionType
                    );
                    webviewPanel.webview.postMessage({
                        type: 'testConnectionResult',
                        success: result.success,
                        error: result.error,
                    });
                    return;
                }

                // Variable messages
                case 'addVariable':
                case 'updateVariable':
                case 'deleteVariable':
                case 'updateVariables': {
                    variableRelay.handleMessage(message);
                    return;
                }

                // Parameter messages
                case 'updateParameters': {
                    if (currentModel) {
                        currentModel.parameters = message.parameters;
                        onModelChanged();
                    }
                    return;
                }

                // Canvas state changes
                case 'canvasStateChanged': {
                    // Update the document with the new state
                    // In production, serialize the full model back to XML
                    return;
                }
            }
        });

        // Send initial content once webview is ready
        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        // URIs to load the webview bundle
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles', 'canvas.css')
        );
        const bundledStyleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'index.css')
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
    <link href="${bundledStyleUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>SSIS Designer</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
