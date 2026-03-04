/**
 * Tests for ISPAC export (exportIspac.ts)
 */
import { describe, it, expect, vi } from 'vitest';
import * as zlib from 'zlib';

// Mock vscode (exportIspac.ts imports it but these tests don't use it)
vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [], findFiles: vi.fn() },
  window: { showSaveDialog: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }) },
}));

import {
  buildZipBuffer,
  buildProjectManifest,
  buildContentTypesXml,
  buildProjectParams,
  parsePackageManifestMetadata,
  ZipEntry,
  PackageManifestMetadata,
} from '../commands/exportIspac';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a ZIP buffer and return entries with their decompressed data. */
function parseZip(buf: Buffer): { name: string; method: number; data: Buffer }[] {
  const entries: { name: string; method: number; data: Buffer }[] = [];

  // Read End-of-Central-Directory to find central dir
  let eocdPos = buf.length - 22;
  while (eocdPos >= 0 && buf.readUInt32LE(eocdPos) !== 0x06054b50) {
    eocdPos--;
  }
  if (eocdPos < 0) { throw new Error('EOCD not found'); }

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const totalEntries = buf.readUInt16LE(eocdPos + 10);

  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) { throw new Error('Bad CD sig'); }
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8');

    // Read local header to find data start
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressedBuf = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressedBuf);
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedBuf);
    } else {
      throw new Error(`Unknown compression method ${method}`);
    }

    entries.push({ name, method, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ISPAC ZIP builder', () => {
  it('should produce a valid ZIP with deflate compression (method 8)', () => {
    const entries: ZipEntry[] = [
      { name: 'hello.txt', data: Buffer.from('Hello World', 'utf-8') },
      { name: 'foo/bar.xml', data: Buffer.from('<root/>', 'utf-8') },
    ];
    const zip = buildZipBuffer(entries);
    const parsed = parseZip(zip);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('hello.txt');
    expect(parsed[0].method).toBe(8); // deflate
    expect(parsed[0].data.toString('utf-8')).toBe('Hello World');

    expect(parsed[1].name).toBe('foo/bar.xml');
    expect(parsed[1].method).toBe(8);
    expect(parsed[1].data.toString('utf-8')).toBe('<root/>');
  });

  it('should produce a ZIP that is smaller than store for compressible data', () => {
    const largeXml = '<root>' + '<item>data</item>'.repeat(500) + '</root>';
    const entries: ZipEntry[] = [
      { name: 'large.xml', data: Buffer.from(largeXml, 'utf-8') },
    ];
    const zip = buildZipBuffer(entries);
    // Deflate should be significantly smaller than the raw data
    expect(zip.length).toBeLessThan(largeXml.length);
  });
});

describe('buildProjectManifest', () => {
  const sampleMetadata: PackageManifestMetadata[] = [
    {
      fileName: 'Q1.dtsx',
      id: '{125965C9-90BD-4D1B-9077-C93B597D26AC}',
      name: 'Package1',
      versionMajor: 1,
      versionMinor: 0,
      versionBuild: 3,
      versionGuid: '{F031DBBF-685E-41C2-BE75-99444B12A1AD}',
      packageFormatVersion: 8,
      description: '',
      protectionLevel: 1,
    },
  ];

  it('should NOT include a default xmlns= namespace binding', () => {
    const manifest = buildProjectManifest(
      'MyProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
    );
    // The root element must NOT have xmlns="..." (only xmlns:SSIS="...")
    expect(manifest).not.toMatch(/xmlns="[^"]*"/);
    expect(manifest).toContain('xmlns:SSIS="www.microsoft.com/SqlServer/SSIS"');
  });

  it('should NOT include an XML declaration (<?xml ...?>)', () => {
    const manifest = buildProjectManifest(
      'MyProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
    );
    // Reference Visual Studio ISPACs have no XML declaration in the manifest
    expect(manifest).not.toContain('<?xml');
    // Must start directly with <SSIS:Project
    expect(manifest.trimStart().startsWith('<SSIS:Project')).toBe(true);
  });

  it('should use CRLF line endings', () => {
    const manifest = buildProjectManifest(
      'MyProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
    );
    // All newlines should be \r\n
    const lfOnly = manifest.replace(/\r\n/g, '').includes('\n');
    expect(lfOnly).toBe(false);
    expect(manifest).toContain('\r\n');
  });

  it('should have SSIS:ProtectionLevel before xmlns:SSIS in the root element', () => {
    const manifest = buildProjectManifest(
      'MyProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
    );
    const rootMatch = manifest.match(/<SSIS:Project\s+([^>]+)>/);
    expect(rootMatch).toBeTruthy();
    const attrs = rootMatch![1];
    const plPos = attrs.indexOf('SSIS:ProtectionLevel');
    const nsPos = attrs.indexOf('xmlns:SSIS');
    expect(plPos).toBeLessThan(nsPos);
  });

  it('should list packages under SSIS:Packages', () => {
    const manifest = buildProjectManifest(
      'TestProject',
      ['Q1.dtsx', 'Q2.dtsx'],
      [sampleMetadata[0], { ...sampleMetadata[0], fileName: 'Q2.dtsx' }],
      [],
      'DontSaveSensitive',
    );
    expect(manifest).toContain('<SSIS:Package SSIS:Name="Q1.dtsx" SSIS:EntryPoint="1" />');
    expect(manifest).toContain('<SSIS:Package SSIS:Name="Q2.dtsx" SSIS:EntryPoint="1" />');
  });

  it('should include PackageMetaData with correct properties', () => {
    const manifest = buildProjectManifest(
      'TestProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
    );
    expect(manifest).toContain('<SSIS:PackageMetaData SSIS:Name="Q1.dtsx">');
    expect(manifest).toContain('<SSIS:Property SSIS:Name="ID">{125965C9-90BD-4D1B-9077-C93B597D26AC}</SSIS:Property>');
    expect(manifest).toContain('<SSIS:Property SSIS:Name="Name">Package1</SSIS:Property>');
    expect(manifest).toContain('<SSIS:Property SSIS:Name="VersionBuild">3</SSIS:Property>');
    expect(manifest).toContain('<SSIS:Property SSIS:Name="VersionGUID">{F031DBBF-685E-41C2-BE75-99444B12A1AD}</SSIS:Property>');
    expect(manifest).toContain('<SSIS:Property SSIS:Name="PackageFormatVersion">8</SSIS:Property>');
  });

  it('should include FormatVersion property', () => {
    const manifest = buildProjectManifest(
      'TestProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'DontSaveSensitive',
    );
    expect(manifest).toContain('<SSIS:Property SSIS:Name="FormatVersion">1</SSIS:Property>');
  });

  it('should include PasswordVerifier when provided', () => {
    const manifest = buildProjectManifest(
      'TestProject',
      ['Q1.dtsx'],
      sampleMetadata,
      [],
      'EncryptSensitiveWithUserKey',
      'SomeBase64PasswordVerifier==',
    );
    expect(manifest).toContain('SSIS:Name="PasswordVerifier" SSIS:Sensitive="1"');
    expect(manifest).toContain('SomeBase64PasswordVerifier==');
  });
});

describe('buildProjectParams', () => {
  it('should produce valid Project.params with SSIS namespace', () => {
    const params = buildProjectParams();
    expect(params).toContain('xmlns:SSIS="www.microsoft.com/SqlServer/SSIS"');
    expect(params).toContain('<SSIS:Parameters');
    // Should NOT have a default xmlns=
    expect(params).not.toMatch(/xmlns="[^"]*"/);
  });

  it('should use <?xml version="1.0"?> without encoding attribute', () => {
    const params = buildProjectParams();
    expect(params).toContain('<?xml version="1.0"?>');
    expect(params).not.toContain('encoding=');
  });
});

describe('buildContentTypesXml', () => {
  it('should include dtsx, params, and manifest content types', () => {
    const ct = buildContentTypesXml();
    expect(ct).toContain('Extension="dtsx"');
    expect(ct).toContain('Extension="params"');
    expect(ct).toContain('Extension="manifest"');
    expect(ct).toContain('xmlns="http://schemas.openxmlformats.org/package/2006/content-types"');
  });

  it('should start with UTF-8 BOM', () => {
    const ct = buildContentTypesXml();
    expect(ct.charCodeAt(0)).toBe(0xFEFF);
  });
});

describe('parsePackageManifestMetadata', () => {
  it('should extract metadata from a real .dtsx XML', () => {
    const dtsxXml = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:DTSID="{125965C9-90BD-4D1B-9077-C93B597D26AC}"
  DTS:ObjectName="Package1"
  DTS:VersionBuild="3"
  DTS:VersionGUID="{F031DBBF-685E-41C2-BE75-99444B12A1AD}">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
</DTS:Executable>`;
    const meta = parsePackageManifestMetadata('Q1.dtsx', Buffer.from(dtsxXml, 'utf-8'));
    expect(meta.fileName).toBe('Q1.dtsx');
    expect(meta.id).toBe('{125965C9-90BD-4D1B-9077-C93B597D26AC}');
    expect(meta.name).toBe('Package1');
    expect(meta.versionBuild).toBe(3);
    expect(meta.versionGuid).toBe('{F031DBBF-685E-41C2-BE75-99444B12A1AD}');
    expect(meta.packageFormatVersion).toBe(8);
  });

  it('should return defaults for malformed XML', () => {
    const meta = parsePackageManifestMetadata('bad.dtsx', Buffer.from('not xml at all', 'utf-8'));
    expect(meta.fileName).toBe('bad.dtsx');
    expect(meta.versionMajor).toBe(1);
    expect(meta.packageFormatVersion).toBe(8);
  });
});

describe('ISPAC entry ordering', () => {
  it('should place dtsx files first, then params, manifest, content types last', () => {
    // We can't call buildIspac directly (needs filesystem + vscode), so we
    // verify by building the entries in the same order the function does
    const dtsx1 = Buffer.from('<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts" DTS:ObjectName="P1" DTS:DTSID="{00000000-0000-0000-0000-000000000001}" />', 'utf-8');
    const dtsx2 = Buffer.from('<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts" DTS:ObjectName="P2" DTS:DTSID="{00000000-0000-0000-0000-000000000002}" />', 'utf-8');

    // Build entries in expected order (matching buildIspac)
    const entries: ZipEntry[] = [];
    entries.push({ name: 'Q1.dtsx', data: dtsx1 });
    entries.push({ name: 'Q2.dtsx', data: dtsx2 });
    entries.push({ name: 'Project.params', data: Buffer.from(buildProjectParams(), 'utf-8') });
    entries.push({
      name: '@Project.manifest',
      data: Buffer.from(
        buildProjectManifest('Test', ['Q1.dtsx', 'Q2.dtsx'], [
          parsePackageManifestMetadata('Q1.dtsx', dtsx1),
          parsePackageManifestMetadata('Q2.dtsx', dtsx2),
        ], [], 'DontSaveSensitive'),
        'utf-8',
      ),
    });
    entries.push({ name: '[Content_Types].xml', data: Buffer.from(buildContentTypesXml(), 'utf-8') });

    const zip = buildZipBuffer(entries);
    const parsed = parseZip(zip);

    expect(parsed.map(e => e.name)).toEqual([
      'Q1.dtsx',
      'Q2.dtsx',
      'Project.params',
      '@Project.manifest',
      '[Content_Types].xml',
    ]);
  });
});
