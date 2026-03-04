import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Minimal ZIP builder using Node.js buffers (no external dependency needed)
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  data: Buffer;
}

function buildZipBuffer(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.data);
    const uncompressed = entry.data;

    // We store without compression (method 0) for simplicity & reliability
    const compressedData = uncompressed;
    const method = 0;

    // Local file header (30 + name length)
    const local = Buffer.alloc(30 + nameBuffer.length);
    local.writeUInt32LE(0x04034b50, 0);       // signature
    local.writeUInt16LE(20, 4);                // version needed
    local.writeUInt16LE(0, 6);                 // flags
    local.writeUInt16LE(method, 8);            // compression method
    local.writeUInt16LE(0, 10);                // mod time
    local.writeUInt16LE(0, 12);               // mod date
    local.writeUInt32LE(crc, 14);             // crc-32
    local.writeUInt32LE(compressedData.length, 18);  // compressed size
    local.writeUInt32LE(uncompressed.length, 22);    // uncompressed size
    local.writeUInt16LE(nameBuffer.length, 26);      // filename length
    local.writeUInt16LE(0, 28);               // extra field length
    nameBuffer.copy(local, 30);

    localHeaders.push(local);
    localHeaders.push(compressedData);

    // Central directory header (46 + name length)
    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02014b50, 0);     // signature
    central.writeUInt16LE(20, 4);             // version made by
    central.writeUInt16LE(20, 6);             // version needed
    central.writeUInt16LE(0, 8);              // flags
    central.writeUInt16LE(method, 10);        // compression method
    central.writeUInt16LE(0, 12);             // mod time
    central.writeUInt16LE(0, 14);             // mod date
    central.writeUInt32LE(crc, 16);           // crc-32
    central.writeUInt32LE(compressedData.length, 20); // compressed size
    central.writeUInt32LE(uncompressed.length, 24);   // uncompressed size
    central.writeUInt16LE(nameBuffer.length, 28);     // filename length
    central.writeUInt16LE(0, 30);             // extra field length
    central.writeUInt16LE(0, 32);             // file comment length
    central.writeUInt16LE(0, 34);             // disk number start
    central.writeUInt16LE(0, 36);             // internal attrs
    central.writeUInt32LE(0, 38);             // external attrs
    central.writeUInt32LE(offset, 42);        // relative offset of local header
    nameBuffer.copy(central, 46);

    centralHeaders.push(central);

    offset += local.length + compressedData.length;
  }

  const centralDirOffset = offset;
  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirSize = centralDirBuffer.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);           // signature
  eocd.writeUInt16LE(0, 4);                    // disk number
  eocd.writeUInt16LE(0, 6);                    // central dir start disk
  eocd.writeUInt16LE(entries.length, 8);       // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);      // total entries
  eocd.writeUInt32LE(centralDirSize, 12);      // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);    // central dir offset
  eocd.writeUInt16LE(0, 20);                   // comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

/** CRC-32 (ISO 3309) */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ISPAC content templates
// ---------------------------------------------------------------------------

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="dtsx" ContentType="text/xml" />
  <Default Extension="params" ContentType="text/xml" />
  <Default Extension="manifest" ContentType="text/xml" />
</Types>`;
}

function buildProjectManifest(
  projectName: string,
  packages: string[],
  connectionManagers: string[],
): string {
  const pkgEntries = packages
    .map((p) => `    <SSIS:PackageManifest SSIS:Name="${p}" />`)
    .join('\n');
  const cmEntries = connectionManagers
    .map((c) => `    <SSIS:ConnectionManagerManifest SSIS:Name="${c}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<SSIS:Project xmlns:SSIS="www.microsoft.com/SqlServer/SSIS"
  SSIS:ProtectionLevel="DontSaveSensitive">
  <SSIS:Properties>
    <SSIS:Property SSIS:Name="ID">{00000000-0000-0000-0000-000000000000}</SSIS:Property>
    <SSIS:Property SSIS:Name="Name">${projectName}</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionMajor">1</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionMinor">0</SSIS:Property>
    <SSIS:Property SSIS:Name="Description"></SSIS:Property>
  </SSIS:Properties>
  <SSIS:Packages>
${pkgEntries}
  </SSIS:Packages>
  <SSIS:ConnectionManagers>
${cmEntries}
  </SSIS:ConnectionManagers>
  <SSIS:DeploymentInfo>
    <SSIS:ProjectConnectionParameters />
  </SSIS:DeploymentInfo>
</SSIS:Project>`;
}

function buildProjectParams(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<SSIS:Parameters xmlns:SSIS="www.microsoft.com/SqlServer/SSIS" />`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an .ispac Buffer from a project folder containing .dtsx files.
 */
export async function buildIspac(projectFolderPath: string): Promise<Buffer> {
  // Gather .dtsx files
  const allFiles = fs.readdirSync(projectFolderPath);
  const dtsxFiles = allFiles.filter((f) => f.toLowerCase().endsWith('.dtsx'));
  if (dtsxFiles.length === 0) {
    throw new Error('No .dtsx files found in project folder.');
  }

  const projectName = path.basename(projectFolderPath);

  const entries: ZipEntry[] = [];

  // [Content_Types].xml
  entries.push({ name: '[Content_Types].xml', data: Buffer.from(buildContentTypesXml(), 'utf-8') });

  // @Project.manifest
  entries.push({
    name: '@Project.manifest',
    data: Buffer.from(buildProjectManifest(projectName, dtsxFiles, []), 'utf-8'),
  });

  // Project.params
  entries.push({ name: 'Project.params', data: Buffer.from(buildProjectParams(), 'utf-8') });

  // .dtsx packages
  for (const dtsx of dtsxFiles) {
    const content = fs.readFileSync(path.join(projectFolderPath, dtsx));
    entries.push({ name: dtsx, data: content });
  }

  return buildZipBuffer(entries);
}

/**
 * Interactive command: export project as .ispac file.
 */
export async function exportIspac(_context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Find .dtsx files
  const dtsxUris = await vscode.workspace.findFiles('**/*.dtsx', '**/node_modules/**', 100);
  if (dtsxUris.length === 0) {
    vscode.window.showErrorMessage('No .dtsx files found in workspace.');
    return;
  }

  // Determine project folder (directory containing most .dtsx files, or workspace root)
  const folderCounts = new Map<string, number>();
  for (const uri of dtsxUris) {
    const dir = path.dirname(uri.fsPath);
    folderCounts.set(dir, (folderCounts.get(dir) ?? 0) + 1);
  }
  let projectFolder = workspaceFolders[0].uri.fsPath;
  let maxCount = 0;
  for (const [dir, count] of folderCounts) {
    if (count > maxCount) {
      maxCount = count;
      projectFolder = dir;
    }
  }

  const projectName = path.basename(projectFolder);

  // Prompt for save location
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(projectFolder, `${projectName}.ispac`)),
    filters: { 'SSIS Project': ['ispac'] },
    saveLabel: 'Export ISPAC',
  });
  if (!saveUri) { return; }

  try {
    const ispacBuffer = await buildIspac(projectFolder);
    fs.writeFileSync(saveUri.fsPath, ispacBuffer);
    vscode.window.showInformationMessage(`ISPAC exported: ${saveUri.fsPath}`);
  } catch (err: any) {
    vscode.window.showErrorMessage(`Export failed: ${err.message ?? err}`);
  }
}
