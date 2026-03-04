import * as vscode from 'vscode';
import { DtsxEditorProvider } from './DtsxEditorProvider';
import { SsisTreeDataProvider, SsisTreeItem, SsisTreeItemType } from './SsisTreeDataProvider';
import { ConnectionTreeProvider, ConnectionTreeItem } from './ConnectionTreeProvider';
import { TdsClient } from './services/TdsClient';
import { newPackage } from './commands/newPackage';
import { deployProject } from './commands/deployProject';
import { executePackage } from './commands/executePackage';
import { validatePackage } from './commands/validatePackage';
import { exportIspac } from './commands/exportIspac';
import { DtsxDiagnosticProvider } from './services/DtsxDiagnosticProvider';
import { EnvironmentEditorPanel } from './panels/EnvironmentEditorPanel';
import { ExecutionHistoryPanel } from './panels/ExecutionHistoryPanel';

export function activate(context: vscode.ExtensionContext): void {
    // Register the custom editor provider for .dtsx files
    const editorProvider = DtsxEditorProvider.register(context);
    context.subscriptions.push(editorProvider);

    // Register the Catalog Explorer tree view (now requires context for secrets/state)
    const ssisTreeDataProvider = new SsisTreeDataProvider(context);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('ssisDesigner.catalogExplorer', ssisTreeDataProvider)
    );

    // Register the Connection Manager tree view
    const connectionTreeProvider = new ConnectionTreeProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('ssisDesigner.connectionManager', connectionTreeProvider)
    );

    // Register the DtsxDiagnosticProvider for inline validation
    const diagnosticProvider = new DtsxDiagnosticProvider();
    context.subscriptions.push(diagnosticProvider);

    // Shared TDS client for testing connections from the Connection Manager tree
    const tdsClient = new TdsClient();

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ssis.newPackage', newPackage),

        // Deploy & Export
        vscode.commands.registerCommand('ssis.deployProject', () =>
            deployProject(context, ssisTreeDataProvider)
        ),
        vscode.commands.registerCommand('ssis.exportIspac', () => exportIspac(context)),

        // Execute (can be invoked from tree item or command palette)
        vscode.commands.registerCommand('ssis.executePackage', (item?: SsisTreeItem) =>
            executePackage(context, ssisTreeDataProvider, item)
        ),

        // Validate
        vscode.commands.registerCommand('ssis.validatePackage', () => validatePackage(context)),

        // ── Environment commands ──────────────────────────────────────
        vscode.commands.registerCommand('ssis.editEnvironment', async (item: SsisTreeItem) => {
            if (!item?.metadata?.connectionId || !item?.metadata?.folderName || !item?.metadata?.environmentName) {
                return;
            }
            const client = await ssisTreeDataProvider.getClient(item.metadata.connectionId);
            if (client) {
                await EnvironmentEditorPanel.createOrShow(
                    context.extensionUri,
                    client,
                    item.metadata.folderName,
                    item.metadata.environmentName,
                );
            }
        }),

        vscode.commands.registerCommand('ssis.createEnvironment', async (item: SsisTreeItem) => {
            if (!item?.metadata?.connectionId || !item?.metadata?.folderName) { return; }
            const client = await ssisTreeDataProvider.getClient(item.metadata.connectionId);
            if (client) {
                await EnvironmentEditorPanel.createNewEnvironment(client, item.metadata.folderName);
                ssisTreeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('ssis.deleteEnvironment', async (item: SsisTreeItem) => {
            if (!item?.metadata?.connectionId || !item?.metadata?.folderName || !item?.metadata?.environmentName) {
                return;
            }
            const client = await ssisTreeDataProvider.getClient(item.metadata.connectionId);
            if (client) {
                await EnvironmentEditorPanel.deleteEnvironment(
                    client,
                    item.metadata.folderName,
                    item.metadata.environmentName,
                );
                ssisTreeDataProvider.refresh();
            }
        }),

        vscode.commands.registerCommand('ssis.manageEnvironmentRefs', async (item: SsisTreeItem) => {
            if (!item?.metadata?.connectionId || !item?.metadata?.folderName || !item?.metadata?.projectName) {
                return;
            }
            const client = await ssisTreeDataProvider.getClient(item.metadata.connectionId);
            if (!client) { return; }
            try {
                const refs = await client.getEnvironmentReferences(
                    item.metadata.projectName,
                    item.metadata.folderName,
                );
                vscode.window.showInformationMessage(
                    `Project "${item.metadata.projectName}" has ${refs.length} environment reference(s).`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to get environment references: ${err.message ?? err}`);
            }
        }),

        // ── Execution History commands ────────────────────────────────
        vscode.commands.registerCommand('ssis.viewExecutionHistory', async (item?: SsisTreeItem) => {
            const connectionId = item?.metadata?.connectionId;
            if (!connectionId) {
                vscode.window.showInformationMessage('Connect to an SSIS Catalog first to view execution history.');
                return;
            }
            const client = await ssisTreeDataProvider.getClient(connectionId);
            if (client) {
                ExecutionHistoryPanel.createOrShow(context.extensionUri, client);
            }
        }),

        vscode.commands.registerCommand('ssis.viewExecutionDetails', async (item?: SsisTreeItem) => {
            // Opens execution history panel (same as above, details shown inline)
            const connectionId = item?.metadata?.connectionId;
            if (!connectionId) { return; }
            const client = await ssisTreeDataProvider.getClient(connectionId);
            if (client) {
                ExecutionHistoryPanel.createOrShow(context.extensionUri, client);
            }
        }),

        // Remove unused variable (code action from diagnostics)
        vscode.commands.registerCommand('ssis.removeUnusedVariable', (_uri: vscode.Uri, _diag: vscode.Diagnostic) => {
            vscode.window.showInformationMessage('Remove unused variable — open the package in the designer and delete from the Variables panel.');
        }),

        // ── Catalog Explorer commands ─────────────────────────────────
        vscode.commands.registerCommand('ssis.connectCatalog', () =>
            ssisTreeDataProvider.addConnection()
        ),

        vscode.commands.registerCommand('ssis.refreshCatalog', () =>
            ssisTreeDataProvider.refresh()
        ),

        vscode.commands.registerCommand('ssis.disconnectCatalog', (item: SsisTreeItem) => {
            if (item?.metadata?.connectionId) {
                ssisTreeDataProvider.removeConnection(item.metadata.connectionId);
            }
        }),

        vscode.commands.registerCommand('ssis.createFolder', async (item: SsisTreeItem) => {
            if (!item?.metadata?.connectionId) { return; }
            const name = await vscode.window.showInputBox({ prompt: 'Folder name' });
            if (!name) { return; }
            try {
                const client = await ssisTreeDataProvider.getClient(item.metadata.connectionId);
                if (client) {
                    await client.createCatalogFolder(name);
                    ssisTreeDataProvider.refresh();
                    vscode.window.showInformationMessage(`Folder "${name}" created.`);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create folder: ${err.message ?? err}`);
            }
        }),

        vscode.commands.registerCommand('ssis.downloadPackage', (item: SsisTreeItem) => {
            // Placeholder — downloading a package from SSISDB is non-trivial
            // (requires reading the project binary and extracting the .dtsx)
            if (item?.metadata) {
                vscode.window.showInformationMessage(
                    `Download ${item.metadata.packageName} from ${item.metadata.projectName} — coming soon.`
                );
            }
        }),

        // ── Connection Manager context menu commands ──────────────────
        vscode.commands.registerCommand('ssis.editConnection', (item: ConnectionTreeItem) => {
            if (item.connectionManager) {
                vscode.window.showInformationMessage(
                    `Edit connection: ${item.connectionManager.objectName}`
                );
            }
        }),

        vscode.commands.registerCommand('ssis.testConnection', async (item: ConnectionTreeItem) => {
            if (item.connectionManager) {
                const connStr = item.connectionManager.connectionString;
                vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Testing connection: ${item.connectionManager.objectName}…`,
                    },
                    async () => {
                        const result = await tdsClient.testConnection(connStr);
                        if (result.success) {
                            vscode.window.showInformationMessage(
                                `✓ Connection "${item.connectionManager!.objectName}" succeeded.`
                            );
                        } else {
                            vscode.window.showErrorMessage(
                                `✕ Connection "${item.connectionManager!.objectName}" failed: ${result.error}`
                            );
                        }
                    }
                );
            }
        }),

        vscode.commands.registerCommand('ssis.deleteConnection', (item: ConnectionTreeItem) => {
            if (item.connectionManager) {
                const name = item.connectionManager.objectName;
                vscode.window
                    .showWarningMessage(
                        `Delete connection "${name}"?`,
                        { modal: true },
                        'Delete'
                    )
                    .then((selection) => {
                        if (selection === 'Delete' && item.connectionManager) {
                            connectionTreeProvider.removeConnectionManager(item.connectionManager.id);
                        }
                    });
            }
        })
    );

    console.log('SSIS Designer activated');
}

export function deactivate(): void {
    // Cleanup resources if needed
}
