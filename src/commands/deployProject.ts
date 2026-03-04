import * as vscode from 'vscode';
import * as path from 'path';
import { TdsClient } from '../services/TdsClient';
import { SsisTreeDataProvider } from '../SsisTreeDataProvider';
import { buildIspac } from './exportIspac';

/**
 * Deploy an SSIS project (.ispac) to the SSISDB catalog.
 */
export async function deployProject(
  context: vscode.ExtensionContext,
  treeProvider: SsisTreeDataProvider,
): Promise<void> {
  // 1. Locate .dtsx files (proxy for "project folder")
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Try to find a .dtsproj file
  const dtsprojFiles = await vscode.workspace.findFiles('**/*.dtsproj', '**/node_modules/**', 5);
  let projectFolder: vscode.Uri;

  if (dtsprojFiles.length > 0) {
    if (dtsprojFiles.length === 1) {
      projectFolder = vscode.Uri.file(path.dirname(dtsprojFiles[0].fsPath));
    } else {
      const pick = await vscode.window.showQuickPick(
        dtsprojFiles.map((f: vscode.Uri) => ({ label: path.basename(path.dirname(f.fsPath)), uri: f })),
        { placeHolder: 'Select project to deploy' },
      );
      if (!pick) { return; }
      projectFolder = vscode.Uri.file(path.dirname(pick.uri.fsPath));
    }
  } else {
    // Fall back to workspace root
    projectFolder = workspaceFolders[0].uri;
  }

  // 2. Pick target server connection
  const connectionIds = treeProvider.getConnectionIds();
  if (connectionIds.length === 0) {
    const addNow = await vscode.window.showInformationMessage(
      'No SSIS catalog connections configured. Add one now?',
      'Connect',
    );
    if (addNow === 'Connect') {
      await treeProvider.addConnection();
    }
    return;
  }

  let connectionId: string;
  if (connectionIds.length === 1) {
    connectionId = connectionIds[0];
  } else {
    const connPick = await vscode.window.showQuickPick(
      connectionIds.map((id) => {
        const conn = treeProvider.getConnection(id);
        return { label: conn?.serverName ?? id, id };
      }),
      { placeHolder: 'Select target server' },
    );
    if (!connPick) { return; }
    connectionId = connPick.id;
  }

  const client = await treeProvider.getClient(connectionId);
  if (!client) {
    vscode.window.showErrorMessage('Could not connect to the selected server.');
    return;
  }

  // 3. Ask for target folder
  let folderName: string | undefined;
  try {
    const folders = await client.getCatalogFolders();
    if (folders.length > 0) {
      const folderPick = await vscode.window.showQuickPick(
        [
          { label: '$(add) Create new folder…', value: '__new__' },
          ...folders.map((f) => ({ label: f.name, value: f.name })),
        ],
        { placeHolder: 'Target SSISDB folder' },
      );
      if (!folderPick) { return; }
      if (folderPick.value === '__new__') {
        folderName = await vscode.window.showInputBox({ prompt: 'New folder name' });
        if (!folderName) { return; }
        await client.createCatalogFolder(folderName);
      } else {
        folderName = folderPick.value;
      }
    } else {
      folderName = await vscode.window.showInputBox({ prompt: 'SSISDB folder name' });
      if (!folderName) { return; }
      await client.createCatalogFolder(folderName);
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to list folders: ${err.message ?? err}`);
    folderName = await vscode.window.showInputBox({ prompt: 'SSISDB folder name' });
    if (!folderName) { return; }
  }

  // 4. Ask for project name
  const defaultProjectName = path.basename(projectFolder.fsPath);
  const projectName = await vscode.window.showInputBox({
    prompt: 'Project name',
    value: defaultProjectName,
  });
  if (!projectName) { return; }

  // 5. Build .ispac and deploy
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying ${projectName}…`,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: 'Building .ispac…' });
        const ispacBuffer = await buildIspac(projectFolder.fsPath);

        progress.report({ message: 'Uploading to server…' });
        await client.deployProject(folderName!, projectName, ispacBuffer);

        treeProvider.refresh();
        vscode.window.showInformationMessage(
          `Successfully deployed "${projectName}" to folder "${folderName}".`,
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Deploy failed: ${err?.message ?? String(err)}`);
      }
    },
  );
}
