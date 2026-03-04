import * as vscode from 'vscode';

export async function newPackage(): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
        filters: { 'SSIS Package': ['dtsx'] },
        saveLabel: 'Create Package',
    });

    if (!uri) {
        return;
    }

    // Ensure the file has a .dtsx extension
    let filePath = uri.fsPath;
    if (!filePath.toLowerCase().endsWith('.dtsx')) {
        filePath += '.dtsx';
    }
    const finalUri = vscode.Uri.file(filePath);

    const minimalDtsx = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate=""
  DTS:CreationName="Microsoft.Package"
  DTS:CreatorComputerName=""
  DTS:CreatorName=""
  DTS:DTSID=""
  DTS:ExecutableType="Microsoft.Package"
  DTS:LastModifiedProductVersion=""
  DTS:LocaleID="1033"
  DTS:ObjectName="Package"
  DTS:PackageType="5"
  DTS:VersionBuild="0"
  DTS:VersionGUID="">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:ConnectionManagers />
  <DTS:Variables />
  <DTS:Executables />
</DTS:Executable>
`;

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(finalUri, encoder.encode(minimalDtsx));
    await vscode.commands.executeCommand('vscode.open', finalUri);
    vscode.window.showInformationMessage(`Created SSIS package: ${finalUri.fsPath}`);
}
