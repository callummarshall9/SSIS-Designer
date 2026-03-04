import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';

// ---------------------------------------------------------------------------
// Minimal ZIP builder using Node.js buffers (no external dependency needed)
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function buildZipBuffer(entries: ZipEntry[]): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf-8');
    const crc = crc32(entry.data);
    const uncompressed = entry.data;

    // Use deflate compression (method 8) to match SSIS/Visual Studio ISPACs
    const compressedData = zlib.deflateRawSync(uncompressed, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
    const method = 8;

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

export function buildContentTypesXml(): string {
  // Match Visual Studio format: UTF-8 BOM + single line, no whitespace
  return '\uFEFF<?xml version="1.0" encoding="utf-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="dtsx" ContentType="text/xml" />' +
    '<Default Extension="params" ContentType="text/xml" />' +
    '<Default Extension="manifest" ContentType="text/xml" />' +
    '</Types>';
}

export function buildProjectManifest(
  projectName: string,
  packages: string[],
  packageMetadata: PackageManifestMetadata[],
  connectionManagers: string[],
  projectProtectionLevel: string,
  passwordVerifier?: string,
): string {
  const projectId = newGuidBracedLower();
  const nowIso = new Date().toISOString();
  const hostName = process.env.COMPUTERNAME || process.env.HOSTNAME || 'UnknownHost';

  const pkgEntries = packages
    .map((p) => `    <SSIS:Package SSIS:Name="${xmlEscape(p)}" SSIS:EntryPoint="1" />`)
    .join('\n');
  const cmEntries = connectionManagers
    .map((c) => `    <SSIS:ConnectionManager SSIS:Name="${xmlEscape(c)}" />`)
    .join('\n');

  const packageInfoEntries = packageMetadata
    .map((meta) => `      <SSIS:PackageMetaData SSIS:Name="${xmlEscape(meta.fileName)}">
        <SSIS:Properties>
          <SSIS:Property SSIS:Name="ID">${xmlEscape(meta.id)}</SSIS:Property>
          <SSIS:Property SSIS:Name="Name">${xmlEscape(meta.name)}</SSIS:Property>
          <SSIS:Property SSIS:Name="VersionMajor">${meta.versionMajor}</SSIS:Property>
          <SSIS:Property SSIS:Name="VersionMinor">${meta.versionMinor}</SSIS:Property>
          <SSIS:Property SSIS:Name="VersionBuild">${meta.versionBuild}</SSIS:Property>
          <SSIS:Property SSIS:Name="VersionComments"></SSIS:Property>
          <SSIS:Property SSIS:Name="VersionGUID">${xmlEscape(meta.versionGuid)}</SSIS:Property>
          <SSIS:Property SSIS:Name="PackageFormatVersion">${meta.packageFormatVersion}</SSIS:Property>
          <SSIS:Property SSIS:Name="Description">${xmlEscape(meta.description)}</SSIS:Property>
          <SSIS:Property SSIS:Name="ProtectionLevel">${meta.protectionLevel}</SSIS:Property>
        </SSIS:Properties>
        <SSIS:Parameters />
      </SSIS:PackageMetaData>`)
    .join('\n');

  // Build manifest without XML declaration (matches Visual Studio format).
  // Normalize to \r\n line endings to match reference ISPACs.
  const raw = `<SSIS:Project SSIS:ProtectionLevel="${xmlEscape(projectProtectionLevel)}" xmlns:SSIS="www.microsoft.com/SqlServer/SSIS">
  <SSIS:Properties>
    <SSIS:Property SSIS:Name="ID">${projectId}</SSIS:Property>
    <SSIS:Property SSIS:Name="Name">${xmlEscape(projectName)}</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionMajor">1</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionMinor">0</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionBuild">0</SSIS:Property>
    <SSIS:Property SSIS:Name="VersionComments"></SSIS:Property>
    <SSIS:Property SSIS:Name="CreationDate">${nowIso}</SSIS:Property>
    <SSIS:Property SSIS:Name="CreatorName">${xmlEscape(hostName)}\\${xmlEscape(process.env.USER || process.env.USERNAME || 'UnknownUser')}</SSIS:Property>
    <SSIS:Property SSIS:Name="CreatorComputerName">${xmlEscape(hostName)}</SSIS:Property>
    <SSIS:Property SSIS:Name="Description"></SSIS:Property>
    <SSIS:Property SSIS:Name="TargetServerVersion">160</SSIS:Property>
${passwordVerifier !== undefined ? `    <SSIS:Property SSIS:Name="PasswordVerifier" SSIS:Sensitive="1">${xmlEscape(passwordVerifier)}</SSIS:Property>\n` : ''}    <SSIS:Property SSIS:Name="FormatVersion">1</SSIS:Property>
  </SSIS:Properties>
  <SSIS:Packages>
${pkgEntries}
  </SSIS:Packages>
  <SSIS:ConnectionManagers${cmEntries ? `>\n${cmEntries}\n  </SSIS:ConnectionManagers>` : ' />'}
  <SSIS:DeploymentInfo>
    <SSIS:ProjectConnectionParameters />
    <SSIS:PackageInfo>
${packageInfoEntries}
    </SSIS:PackageInfo>
  </SSIS:DeploymentInfo>
</SSIS:Project>`;

  return raw.replace(/\r?\n/g, '\r\n');
}

export function buildProjectParams(): string {
  return `<?xml version="1.0"?>\r\n<SSIS:Parameters xmlns:SSIS="www.microsoft.com/SqlServer/SSIS" />`;
}

export interface PackageManifestMetadata {
  fileName: string;
  id: string;
  name: string;
  versionMajor: number;
  versionMinor: number;
  versionBuild: number;
  versionGuid: string;
  packageFormatVersion: number;
  description: string;
  protectionLevel: number;
}

function protectionLevelName(level: number): string {
  switch (level) {
    case 0: return 'DontSaveSensitive';
    case 1: return 'EncryptSensitiveWithUserKey';
    case 2: return 'EncryptSensitiveWithPassword';
    case 3: return 'EncryptAllWithPassword';
    case 4: return 'EncryptAllWithUserKey';
    case 5: return 'ServerStorage';
    default: return 'DontSaveSensitive';
  }
}

function generatePasswordVerifier(): string {
  return Buffer.from(newGuidBracedLower(), 'utf-8').toString('base64');
}

function newGuidBracedLower(): string {
  try {
    const g = (globalThis as any).crypto;
    if (g && typeof g.randomUUID === 'function') {
      return `{${(g.randomUUID() as string).toLowerCase()}}`;
    }
  } catch { /* ignore */ }
  const hex = '0123456789abcdef';
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `{${seg(8)}-${seg(4)}-4${seg(3)}-${hex[8 + Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}}`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getAttr(node: any, name: string): string {
  if (!node) { return ''; }
  return String(node[`@_DTS:${name}`] ?? node[`@_${name}`] ?? '');
}

function getPackageFormatVersion(root: any): number {
  const props = root?.['DTS:Property'];
  const arr = Array.isArray(props) ? props : (props ? [props] : []);
  for (const p of arr) {
    const name = getAttr(p, 'Name');
    if (name === 'PackageFormatVersion') {
      const raw = typeof p === 'object' ? (p['#text'] ?? '') : p;
      const val = Number(raw);
      return Number.isFinite(val) ? val : 8;
    }
  }
  return 8;
}

export function parsePackageManifestMetadata(fileName: string, xmlBuffer: Buffer): PackageManifestMetadata {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseTagValue: false,
      removeNSPrefix: false,
      trimValues: false,
      isArray: (tagName: string) => tagName === 'DTS:Property',
    } as any);
    const parsed = parser.parse(xmlBuffer.toString('utf-8'));
    const rawRoot = parsed?.['DTS:Executable'] ?? parsed?.['Executable'] ?? parsed;
    const root = Array.isArray(rawRoot) ? rawRoot[0] : rawRoot;

    const id = getAttr(root, 'DTSID') || newGuidBracedLower();
    const name = getAttr(root, 'ObjectName') || path.basename(fileName, path.extname(fileName));
    const versionMajor = Number(getAttr(root, 'VersionMajor') || 1) || 1;
    const versionMinor = Number(getAttr(root, 'VersionMinor') || 0) || 0;
    const versionBuild = Number(getAttr(root, 'VersionBuild') || 0) || 0;
    const versionGuid = getAttr(root, 'VersionGUID') || newGuidBracedLower();
    const packageFormatVersion = getPackageFormatVersion(root);
    const description = getAttr(root, 'Description') || '';
    const protectionLevel = Number(getAttr(root, 'ProtectionLevel') || 1) || 1;

    return {
      fileName,
      id,
      name,
      versionMajor,
      versionMinor,
      versionBuild,
      versionGuid,
      packageFormatVersion,
      description,
      protectionLevel,
    };
  } catch {
    return {
      fileName,
      id: newGuidBracedLower(),
      name: path.basename(fileName, path.extname(fileName)),
      versionMajor: 1,
      versionMinor: 0,
      versionBuild: 0,
      versionGuid: newGuidBracedLower(),
      packageFormatVersion: 8,
      description: '',
      protectionLevel: 1,
    };
  }
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

  const packageContents: { name: string; content: Buffer; metadata: PackageManifestMetadata }[] = [];
  for (const dtsx of dtsxFiles) {
    const content = fs.readFileSync(path.join(projectFolderPath, dtsx));
    packageContents.push({
      name: dtsx,
      content,
      metadata: parsePackageManifestMetadata(dtsx, content),
    });
  }

  // .dtsx packages first (matches Visual Studio ISPAC entry ordering)
  for (const pkg of packageContents) {
    entries.push({ name: pkg.name, data: pkg.content });
  }

  const strongestProtectionLevel = packageContents.reduce(
    (max, pkg) => Math.max(max, pkg.metadata.protectionLevel),
    0,
  );
  const projectProtectionLevel = protectionLevelName(strongestProtectionLevel);
  const projectPasswordVerifier = projectProtectionLevel === 'EncryptSensitiveWithUserKey'
    ? generatePasswordVerifier()
    : undefined;

  // Project.params
  entries.push({ name: 'Project.params', data: Buffer.from(buildProjectParams(), 'utf-8') });

  // @Project.manifest
  entries.push({
    name: '@Project.manifest',
    data: Buffer.from(
      buildProjectManifest(
        projectName,
        packageContents.map(p => p.name),
        packageContents.map(p => p.metadata),
        [],
        projectProtectionLevel,
        projectPasswordVerifier,
      ),
      'utf-8',
    ),
  });

  // [Content_Types].xml last
  entries.push({
    name: '[Content_Types].xml',
    data: Buffer.from(buildContentTypesXml(), 'utf-8'),
  });

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
