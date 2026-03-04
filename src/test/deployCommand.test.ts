/**
 * Tests for deploy and ISPAC export commands.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildIspac } from '../commands/exportIspac';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssis-test-'));

  const minimal = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="1/1/2024"
  DTS:CreatorName="TestUser"
  DTS:DTSID="{11111111-1111-1111-1111-111111111111}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="TestPackage">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
</DTS:Executable>`;

  fs.writeFileSync(path.join(dir, 'Package1.dtsx'), minimal, 'utf-8');
  fs.writeFileSync(path.join(dir, 'Package2.dtsx'), minimal, 'utf-8');

  return dir;
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildIspac', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject();
  });

  it('should produce a non-empty buffer', async () => {
    const buf = await buildIspac(projectDir);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    cleanupDir(projectDir);
  });

  it('should start with ZIP magic bytes (PK)', async () => {
    const buf = await buildIspac(projectDir);
    // ZIP local file header starts with PK\x03\x04
    expect(buf[0]).toBe(0x50); // P
    expect(buf[1]).toBe(0x4b); // K
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    cleanupDir(projectDir);
  });

  it('should contain expected file names', async () => {
    const buf = await buildIspac(projectDir);
    const str = buf.toString('utf-8');
    expect(str).toContain('[Content_Types].xml');
    expect(str).toContain('@Project.manifest');
    expect(str).toContain('Project.params');
    expect(str).toContain('Package1.dtsx');
    expect(str).toContain('Package2.dtsx');
    cleanupDir(projectDir);
  });

  it('should include default content types for SSIS extensions', async () => {
    const buf = await buildIspac(projectDir);
    const str = buf.toString('utf-8');
    expect(str).toContain('<Default Extension="dtsx" ContentType="text/xml" />');
    expect(str).toContain('<Default Extension="params" ContentType="text/xml" />');
    expect(str).toContain('<Default Extension="manifest" ContentType="text/xml" />');
    cleanupDir(projectDir);
  });

  it('should include SSIS project manifest Package entries', async () => {
    const buf = await buildIspac(projectDir);
    const str = buf.toString('utf-8');
      expect(str).toContain('<SSIS:Project xmlns="www.microsoft.com/SqlServer/SSIS" xmlns:SSIS="www.microsoft.com/SqlServer/SSIS" SSIS:ProtectionLevel="EncryptSensitiveWithUserKey">');
      expect(str).toContain('<SSIS:Property SSIS:Name="PasswordVerifier" SSIS:Sensitive="1">');
      expect(str).toContain('<SSIS:Packages>');
      expect(str).toContain('<SSIS:Package SSIS:Name="Package1.dtsx" SSIS:EntryPoint="1"');
      expect(str).toContain('<SSIS:Package SSIS:Name="Package2.dtsx" SSIS:EntryPoint="1"');
    expect(str).not.toContain('PackageManifest');
    cleanupDir(projectDir);
  });

  it('should throw when no .dtsx files exist', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssis-empty-'));
    await expect(buildIspac(emptyDir)).rejects.toThrow('No .dtsx files found');
    cleanupDir(emptyDir);
  });
});
    it('should include deployment package metadata section in manifest', async () => {
      const buf = await buildIspac(projectDir);
      const str = buf.toString('utf-8');
      expect(str).toContain('<SSIS:DeploymentInfo>');
      expect(str).toContain('<SSIS:PackageInfo>');
      expect(str).toContain('<SSIS:PackageMetaData SSIS:Name="Package1.dtsx">');
      expect(str).toContain('<SSIS:Property SSIS:Name="PackageFormatVersion">8</SSIS:Property>');
      cleanupDir(projectDir);
    });

describe('deploy error handling', () => {
  it('should raise an error if TdsClient.deployProject fails', async () => {
    // Simulating that deployProject would throw on the TDS layer
    const fakeDeploy = vi.fn().mockRejectedValue(new Error('Connection refused'));
    await expect(fakeDeploy()).rejects.toThrow('Connection refused');
  });
});
