import * as vscode from 'vscode';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { ConnectionManagerPanelRelay } from './panels/ConnectionManagerPanel';
import { VariablePanelRelay } from './panels/VariablePanel';
import { DtsxSerializer } from './canvas/shared/DtsxSerializer';
import { SsisPackageModel, SsisExecutable } from './models/SsisPackageModel';
import { getControlFlowNodeType, getDataFlowNodeType } from './models/CanvasModel';
import { Node, Edge } from 'reactflow';

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

        // Serializer for round-trip XML ↔ model conversion
        const serializer = new DtsxSerializer();

        // In-memory model reference
        let currentModel: SsisPackageModel | undefined;

        // Track the last-known original XML so we can do merge-mode serialization
        let lastOriginalXml: string = document.getText();

        // Guard to prevent re-entrant document updates from
        // triggering another update cycle.
        // Use a version counter instead of a boolean flag to avoid race
        // conditions with async applyEdit — the onDidChangeTextDocument
        // event can fire after the awaited applyEdit resolves.
        let suppressDocChangeVersion = 0;
        let lastSerializedXml = '';

        const getModel = () => currentModel;

        /** Serialize the current model back to the .dtsx document. */
        const serializeToDocument = async () => {
            if (!currentModel) { return; }
            try {
                const xml = serializer.serialize(currentModel, lastOriginalXml);
                const validationResult = XMLValidator.validate(xml);
                if (validationResult !== true) {
                    const errMsg = typeof validationResult === 'object'
                        ? `${validationResult.err.msg} at line ${validationResult.err.line}`
                        : 'Invalid XML generated';
                    vscode.window.showErrorMessage(`Failed to save SSIS package: ${errMsg}`);
                    return;
                }
                // Only apply edit if content actually changed
                if (xml === document.getText()) { return; }
                suppressDocChangeVersion++;
                lastSerializedXml = xml;
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    xml
                );
                await vscode.workspace.applyEdit(edit);
                lastOriginalXml = xml;
            } catch (err) {
                console.error('Failed to serialize SSIS model:', err);
            }
        };

        const onModelChanged = () => {
            serializeToDocument();
            this.onConnectionManagersChanged?.();
        };

        // Set up relay handlers
        const connectionManagerRelay = new ConnectionManagerPanelRelay(getModel, onModelChanged);
        const variableRelay = new VariablePanelRelay(getModel, onModelChanged);

        /**
         * Parse the document XML into the model and send it to the webview
         * as a fully hydrated `loadModel` message with React Flow nodes/edges.
         */
        function parseAndSendModel(): void {
            try {
                lastOriginalXml = document.getText();
                currentModel = serializer.parse(lastOriginalXml);

                // Convert executables to React Flow nodes + edges
                const nodes: Node[] = currentModel.executables.map((exec) => ({
                    id: exec.id,
                    type: getControlFlowNodeType(exec.executableType),
                    position: { x: exec.x, y: exec.y },
                    data: exec,
                    style: { width: exec.width || 200, height: exec.height || 80 },
                }));

                const edges: Edge[] = currentModel.precedenceConstraints.map((pc) => ({
                    id: pc.id,
                    source: pc.fromExecutableId,
                    target: pc.toExecutableId,
                    type: 'precedence',
                    data: pc,
                }));

                webviewPanel.webview.postMessage({
                    type: 'loadModel',
                    model: currentModel,
                    nodes,
                    edges,
                });
            } catch (err) {
                // Fallback: send raw text so the webview at least knows something happened
                webviewPanel.webview.postMessage({
                    type: 'update',
                    text: document.getText(),
                });
                console.error('Failed to parse SSIS package:', err);
            }
        }

        // Listen for document changes and sync to webview
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
            (e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    // Skip if this change was caused by our own serialization.
                    // Compare against the last XML we serialized to detect our own edits.
                    if (e.document.getText() === lastSerializedXml) {
                        return;
                    }
                    parseAndSendModel();
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
                    parseAndSendModel();
                    return;
                }

                // Data flow view: parse the pipeline inside a Data Flow Task
                // and send back the data flow model, nodes, and edges.
                case 'openDataFlow': {
                    if (!currentModel) { return; }
                    const execId = message.executableId as string;

                    // Find the executable in the model (flat or nested)
                    const findExec = (list: SsisExecutable[]): SsisExecutable | undefined => {
                        for (const ex of list) {
                            if (ex.id === execId || ex.dtsId === execId) { return ex; }
                            if (ex.children) {
                                const found = findExec(ex.children);
                                if (found) { return found; }
                            }
                        }
                        return undefined;
                    };
                    const exec = findExec(currentModel.executables);
                    if (!exec) { return; }

                    // Re-parse the raw XML to get the original executable node
                    // so we can pass it to parseDataFlowModel which needs the
                    // raw XML structure, not the model.
                    try {
                        const parser = new XMLParser({
                            ignoreAttributes: false,
                            attributeNamePrefix: '@_',
                            cdataPropName: '__cdata',
                            trimValues: false,
                            preserveOrder: false,
                            parseTagValue: false,
                            allowBooleanAttributes: true,
                            removeNSPrefix: false,
                            processEntities: true,
                            commentPropName: '__comment',
                            numberParseOptions: { leadingZeros: false, hex: false },
                            isArray: (tagName: string) => {
                                const arrayTags = [
                                    'DTS:Variable', 'DTS:Executable', 'DTS:PrecedenceConstraint',
                                    'DTS:ConnectionManager', 'DTS:Property', 'DTS:PackageParameter',
                                    'component', 'path', 'input', 'output',
                                    'inputColumn', 'outputColumn', 'externalMetadataColumn',
                                    'property',
                                ];
                                return arrayTags.includes(tagName);
                            },
                        } as any);
                        const doc = parser.parse(lastOriginalXml);
                        const rawRoot = doc['DTS:Executable'] ?? doc['Executable'];
                        const root = Array.isArray(rawRoot) ? rawRoot[0] : rawRoot;

                        // Helper to find the raw executable node matching this task
                        const findRawExec = (container: any): any | undefined => {
                            const execContainer = container?.['DTS:Executables'];
                            if (!execContainer) { return undefined; }
                            const execNodes = Array.isArray(execContainer['DTS:Executable'])
                                ? execContainer['DTS:Executable']
                                : execContainer['DTS:Executable'] ? [execContainer['DTS:Executable']] : [];
                            for (const rawExec of execNodes) {
                                const rawDtsId = rawExec?.['@_DTS:DTSID'] ?? rawExec?.['@_DTSID'] ?? '';
                                const rawName = rawExec?.['@_DTS:ObjectName'] ?? rawExec?.['@_ObjectName'] ?? '';
                                if (rawDtsId === exec.dtsId || rawName === exec.objectName) {
                                    return rawExec;
                                }
                                // Search children recursively
                                const nested = findRawExec(rawExec);
                                if (nested) { return nested; }
                            }
                            return undefined;
                        };

                        const rawExecNode = findRawExec(root);
                        if (!rawExecNode) { return; }

                        const dfModel = serializer.parseDataFlowModel(rawExecNode);
                        if (!dfModel) { return; }

                        // Try to extract data flow component positions from design-time properties
                        const dtpRaw = root['DTS:DesignTimeProperties'];
                        if (dtpRaw) {
                            const dtpContent = typeof dtpRaw === 'object' && dtpRaw.__cdata
                                ? String(dtpRaw.__cdata)
                                : String(dtpRaw);
                            const positions = serializer.parseDesignTimeProperties(dtpContent);
                            if (positions) {
                                for (const comp of dfModel.components) {
                                    const pos = positions.get(comp.name) || positions.get(comp.refId);
                                    if (pos) {
                                        comp.x = pos.x;
                                        comp.y = pos.y;
                                    }
                                }
                            }
                        }

                        // Convert data flow components to React Flow nodes
                        const dfNodes: Node[] = dfModel.components.map((comp, idx) => ({
                            id: comp.id || comp.refId || `df-comp-${idx}`,
                            type: getDataFlowNodeType(comp.componentClassId),
                            position: { x: comp.x ?? 0, y: comp.y ?? idx * 120 },
                            data: comp,
                            style: { width: 200, height: 60 },
                        }));

                        // Convert data flow paths to React Flow edges
                        const dfEdges: Edge[] = dfModel.paths.map((p, idx) => {
                            // Map fromOutputId → source component, toInputId → target component
                            let sourceId = '';
                            let targetId = '';
                            for (const comp of dfModel.components) {
                                for (const out of comp.outputs) {
                                    if (out.refId === p.fromOutputId) {
                                        sourceId = comp.id || comp.refId;
                                    }
                                }
                                for (const inp of comp.inputs) {
                                    if (inp.refId === p.toInputId) {
                                        targetId = comp.id || comp.refId;
                                    }
                                }
                            }
                            return {
                                id: p.id || `df-path-${idx}`,
                                source: sourceId,
                                target: targetId,
                                type: 'dataPath',
                                data: p,
                            };
                        });

                        webviewPanel.webview.postMessage({
                            type: 'openDataFlow',
                            executableId: execId,
                            executableName: exec.objectName,
                            dataFlowModel: dfModel,
                            nodes: dfNodes,
                            edges: dfEdges,
                        });
                    } catch (err) {
                        console.error('Failed to parse data flow model:', err);
                    }
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
                    if (!currentModel) { return; }

                    // Update executables from node positions/data
                    if (message.nodes) {
                        currentModel.executables = (message.nodes as Node[]).map((n) => ({
                            ...n.data,
                            x: n.position?.x ?? n.data.x,
                            y: n.position?.y ?? n.data.y,
                        }));
                    }

                    // Update precedence constraints from edge data
                    if (message.edges) {
                        currentModel.precedenceConstraints = (message.edges as Edge[])
                            .filter((e) => e.data)
                            .map((e) => e.data);
                    }

                    // Update connection managers if present
                    if (message.connectionManagers) {
                        currentModel.connectionManagers = message.connectionManagers;
                    }

                    // Update variables if present
                    if (message.variables) {
                        currentModel.variables = message.variables;
                    }

                    // Update parameters if present
                    if (message.parameters) {
                        currentModel.parameters = message.parameters;
                    }

                    await serializeToDocument();
                    this.onConnectionManagersChanged?.();
                    return;
                }

                // Webview toolbar command invocations
                case 'command': {
                    if (message.command) {
                        await vscode.commands.executeCommand(message.command);
                    }
                    return;
                }
            }
        });

        // Send initial content once webview is ready
        parseAndSendModel();
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
