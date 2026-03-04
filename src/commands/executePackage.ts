import * as vscode from 'vscode';
import { SsisTreeDataProvider, SsisTreeItem, SsisTreeItemType } from '../SsisTreeDataProvider';
import { ExecutionOutputPanel } from '../panels/ExecutionOutputPanel';

/**
 * Execute an SSIS package on the catalog.
 *
 * Can be invoked:
 *  - From the catalog tree (package node — metadata carries folder/project/package names)
 *  - From the command palette (prompts user)
 */
export async function executePackage(
  context: vscode.ExtensionContext,
  treeProvider: SsisTreeDataProvider,
  treeItem?: SsisTreeItem,
): Promise<void> {
  let connectionId: string | undefined;
  let folderName: string | undefined;
  let projectName: string | undefined;
  let packageName: string | undefined;

  // ── Resolve package coordinates ────────────────────────────────────

  if (treeItem && treeItem.itemType === SsisTreeItemType.Package && treeItem.metadata) {
    connectionId = treeItem.metadata.connectionId;
    folderName = treeItem.metadata.folderName;
    projectName = treeItem.metadata.projectName;
    packageName = treeItem.metadata.packageName;
  } else {
    // Manual selection
    const connectionIds = treeProvider.getConnectionIds();
    if (connectionIds.length === 0) {
      vscode.window.showErrorMessage('No SSIS catalog connections. Connect first.');
      return;
    }

    connectionId = connectionIds[0];
    if (connectionIds.length > 1) {
      const pick = await vscode.window.showQuickPick(
        connectionIds.map((id) => {
          const conn = treeProvider.getConnection(id);
          return { label: conn?.serverName ?? id, id };
        }),
        { placeHolder: 'Select server' },
      );
      if (!pick) { return; }
      connectionId = pick.id;
    }

    const client = await treeProvider.getClient(connectionId!);
    if (!client) {
      vscode.window.showErrorMessage('Could not connect.');
      return;
    }

    // Pick folder
    const folders = await client.getCatalogFolders();
    if (folders.length === 0) {
      vscode.window.showErrorMessage('No folders in SSISDB.');
      return;
    }
    const folderPick = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, folderId: f.folderId })),
      { placeHolder: 'Select folder' },
    );
    if (!folderPick) { return; }
    folderName = folderPick.label;

    // Pick project
    const projects = await client.getProjects(folderPick.folderId);
    if (projects.length === 0) {
      vscode.window.showErrorMessage('No projects in this folder.');
      return;
    }
    const projectPick = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name, projectId: p.projectId })),
      { placeHolder: 'Select project' },
    );
    if (!projectPick) { return; }
    projectName = projectPick.label;

    // Pick package
    const packages = await client.getPackages(projectPick.projectId);
    if (packages.length === 0) {
      vscode.window.showErrorMessage('No packages in this project.');
      return;
    }
    const packagePick = await vscode.window.showQuickPick(
      packages.map((p) => ({ label: p.name })),
      { placeHolder: 'Select package' },
    );
    if (!packagePick) { return; }
    packageName = packagePick.label;
  }

  if (!connectionId || !folderName || !projectName || !packageName) {
    vscode.window.showErrorMessage('Could not determine package to execute.');
    return;
  }

  const client = await treeProvider.getClient(connectionId);
  if (!client) {
    vscode.window.showErrorMessage('Could not connect to server.');
    return;
  }

  // ── Optional: environment reference ────────────────────────────────

  let environmentRef: number | undefined;
  try {
    const folders = await client.getCatalogFolders();
    const folder = folders.find((f) => f.name === folderName);
    if (folder) {
      const envs = await client.getEnvironments(folder.folderId);
      if (envs.length > 0) {
        const envPick = await vscode.window.showQuickPick(
          [
            { label: '(No environment)', environmentId: undefined as number | undefined },
            ...envs.map((e) => ({ label: e.name, environmentId: e.environmentId as number | undefined })),
          ],
          { placeHolder: 'Select environment reference (optional)' },
        );
        if (envPick && envPick.environmentId !== undefined) {
          environmentRef = envPick.environmentId;
        }
      }
    }
  } catch {
    // ignore – continue without environment
  }

  // ── Create & start execution ───────────────────────────────────────

  const outputPanel = new ExecutionOutputPanel();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Starting execution of ${packageName}…`,
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Creating execution…' });
        const executionId = await client.createExecution(
          packageName!,
          folderName!,
          projectName!,
          environmentRef,
        );

        // Enable SYNCHRONIZED logging (parameter 50 = object_type for project, value 1 = true)
        try {
          await client.setExecutionParameterValue(executionId, 50, 'SYNCHRONIZED', 1);
        } catch {
          // Not critical
        }

        progress.report({ message: 'Starting execution…' });
        await client.startExecution(executionId);

        vscode.window.showInformationMessage(
          `Execution ${executionId} started for ${packageName}.`,
        );

        // Start async monitoring
        outputPanel.startMonitoring(executionId, client);
      },
    );
  } catch (err: any) {
    outputPanel.dispose();
    vscode.window.showErrorMessage(`Execution failed: ${err.message ?? err}`);
  }
}
