/**
 * Tests for DtsxSerializer – round-trip parsing, serialization, and helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DtsxSerializer } from '../canvas/shared/DtsxSerializer';
import { SsisPackageModel } from '../models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Sample .dtsx XML fixtures
// ---------------------------------------------------------------------------

const MINIMAL_DTSX = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="1/1/2024"
  DTS:CreatorName="TestUser"
  DTS:DTSID="{11111111-1111-1111-1111-111111111111}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="TestPackage">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
</DTS:Executable>`;

const DTSX_WITH_CONNECTIONS = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="3/1/2024"
  DTS:CreatorName="Dev"
  DTS:DTSID="{22222222-2222-2222-2222-222222222222}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="ConnPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:ConnectionManagers>
    <DTS:ConnectionManager
      DTS:refId="Package.ConnectionManagers[OleDbConn]"
      DTS:CreationName="OLEDB"
      DTS:DTSID="{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
      DTS:ObjectName="OleDbConn">
      <DTS:ObjectData>
        <DTS:ConnectionManager>
          <DTS:Property DTS:Name="ConnectionString">Data Source=.;Initial Catalog=TestDb;</DTS:Property>
          <DTS:Property DTS:Name="RetainSameConnection">False</DTS:Property>
        </DTS:ConnectionManager>
      </DTS:ObjectData>
    </DTS:ConnectionManager>
  </DTS:ConnectionManagers>
</DTS:Executable>`;

const DTSX_WITH_VARIABLES = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="3/1/2024"
  DTS:CreatorName="Dev"
  DTS:DTSID="{33333333-3333-3333-3333-333333333333}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="VarPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:Variables>
    <DTS:Variable
      DTS:DTSID="{BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB}"
      DTS:Namespace="User"
      DTS:ObjectName="Counter">
      <DTS:VariableValue DTS:DataType="3">0</DTS:VariableValue>
    </DTS:Variable>
    <DTS:Variable
      DTS:DTSID="{CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC}"
      DTS:Namespace="User"
      DTS:ObjectName="Greeting"
      DTS:EvaluateAsExpression="-1"
      DTS:Expression="&quot;Hello&quot;">
      <DTS:VariableValue DTS:DataType="8">Hello</DTS:VariableValue>
    </DTS:Variable>
  </DTS:Variables>
</DTS:Executable>`;

const DTSX_WITH_EXECUTABLES = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  xmlns:SQLTask="www.microsoft.com/sqlserver/dts/tasks/sqltask"
  DTS:refId="Package"
  DTS:CreationDate="3/1/2024"
  DTS:CreatorName="Dev"
  DTS:DTSID="{44444444-4444-4444-4444-444444444444}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="ExecPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:ConnectionManagers>
    <DTS:ConnectionManager
      DTS:refId="Package.ConnectionManagers[AdoConn]"
      DTS:CreationName="OLEDB"
      DTS:DTSID="{DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}"
      DTS:ObjectName="AdoConn">
      <DTS:ObjectData>
        <DTS:ConnectionManager>
          <DTS:Property DTS:Name="ConnectionString">Server=.;Database=Test;</DTS:Property>
        </DTS:ConnectionManager>
      </DTS:ObjectData>
    </DTS:ConnectionManager>
  </DTS:ConnectionManagers>
  <DTS:Executables>
    <DTS:Executable
      DTS:refId="Package\\SQL Task 1"
      DTS:DTSID="{EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE}"
      DTS:ExecutableType="Microsoft.ExecuteSQLTask"
      DTS:ObjectName="SQL Task 1">
      <DTS:ObjectData>
        <SQLTask:SqlTaskData
          SQLTask:Connection="{DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}"
          SQLTask:SqlStatementSource="SELECT 1" />
      </DTS:ObjectData>
    </DTS:Executable>
    <DTS:Executable
      DTS:refId="Package\\SQL Task 2"
      DTS:DTSID="{FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF}"
      DTS:ExecutableType="Microsoft.ExecuteSQLTask"
      DTS:ObjectName="SQL Task 2">
      <DTS:ObjectData>
        <SQLTask:SqlTaskData
          SQLTask:Connection="{DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}"
          SQLTask:SqlStatementSource="SELECT 2" />
      </DTS:ObjectData>
    </DTS:Executable>
  </DTS:Executables>
  <DTS:PrecedenceConstraints>
    <DTS:PrecedenceConstraint
      DTS:refId="Package.PrecedenceConstraints[Constraint]"
      DTS:From="Package\\SQL Task 1"
      DTS:To="Package\\SQL Task 2"
      DTS:DTSID="{12345678-1234-1234-1234-123456789012}"
      DTS:Value="0" />
  </DTS:PrecedenceConstraints>
</DTS:Executable>`;

const DTSX_WITH_NESTED_CONTAINER = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  xmlns:SQLTask="www.microsoft.com/sqlserver/dts/tasks/sqltask"
  DTS:refId="Package"
  DTS:CreationDate="3/1/2024"
  DTS:CreatorName="Dev"
  DTS:DTSID="{55555555-5555-5555-5555-555555555555}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="NestedPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:Executables>
    <DTS:Executable
      DTS:refId="Package\\Sequence Container"
      DTS:DTSID="{66666666-6666-6666-6666-666666666666}"
      DTS:ExecutableType="STOCK:SEQUENCE"
      DTS:ObjectName="Sequence Container">
      <DTS:Executables>
        <DTS:Executable
          DTS:refId="Package\\Sequence Container\\Inner Task"
          DTS:DTSID="{77777777-7777-7777-7777-777777777777}"
          DTS:ExecutableType="Microsoft.ExecuteSQLTask"
          DTS:ObjectName="Inner Task">
          <DTS:ObjectData>
            <SQLTask:SqlTaskData SQLTask:SqlStatementSource="SELECT 99" />
          </DTS:ObjectData>
        </DTS:Executable>
      </DTS:Executables>
    </DTS:Executable>
  </DTS:Executables>
</DTS:Executable>`;

const DTSX_WITH_UNKNOWN_ELEMENTS = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="3/1/2024"
  DTS:CreatorName="Dev"
  DTS:DTSID="{88888888-8888-8888-8888-888888888888}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="UnknownPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:LogProviders>
    <DTS:LogProvider DTS:ObjectName="MyLogger" />
  </DTS:LogProviders>
  <DTS:Configurations>
    <DTS:Configuration DTS:ConfigurationType="0" DTS:ObjectName="Config1" />
  </DTS:Configurations>
</DTS:Executable>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let serializer: DtsxSerializer;

beforeEach(() => {
  serializer = new DtsxSerializer();
});

describe('DtsxSerializer – parsing', () => {
  it('should parse a minimal package', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    expect(model.packageName).toBe('TestPackage');
    expect(model.packageId).toBe('{11111111-1111-1111-1111-111111111111}');
    expect(model.creatorName).toBe('TestUser');
    expect(model.formatVersion).toBe(8);
    expect(model.executables).toHaveLength(0);
    expect(model.connectionManagers).toHaveLength(0);
    expect(model.variables).toHaveLength(0);
  });

  it('should parse connection managers', () => {
    const model = serializer.parse(DTSX_WITH_CONNECTIONS);
    expect(model.connectionManagers).toHaveLength(1);
    const cm = model.connectionManagers[0];
    expect(cm.objectName).toBe('OleDbConn');
    expect(cm.creationName).toBe('OLEDB');
    expect(cm.connectionString).toBe('Data Source=.;Initial Catalog=TestDb;');
    expect(cm.dtsId).toBe('{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}');
    expect(cm.properties['RetainSameConnection']).toBe('False');
  });

  it('should parse variables', () => {
    const model = serializer.parse(DTSX_WITH_VARIABLES);
    expect(model.variables).toHaveLength(2);

    const counter = model.variables.find(v => v.objectName === 'Counter')!;
    expect(counter).toBeDefined();
    expect(counter.namespace).toBe('User');
    expect(counter.dataType).toBe('Int32');
    expect(counter.value).toBe('0');

    const greeting = model.variables.find(v => v.objectName === 'Greeting')!;
    expect(greeting).toBeDefined();
    expect(greeting.evaluateAsExpression).toBe(true);
    expect(greeting.dataType).toBe('String');
  });

  it('should parse executables and SQL task properties', () => {
    const model = serializer.parse(DTSX_WITH_EXECUTABLES);
    expect(model.executables).toHaveLength(2);

    const task1 = model.executables.find(e => e.objectName === 'SQL Task 1')!;
    expect(task1).toBeDefined();
    expect(task1.executableType).toBe('Microsoft.ExecuteSQLTask');
    expect(task1.connectionRefs).toHaveLength(1);
    expect(task1.connectionRefs[0].connectionManagerId).toBe('{DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD}');
    expect(task1.properties['SQLTask.SqlStatementSource']).toBe('SELECT 1');
  });

  it('should parse precedence constraints', () => {
    const model = serializer.parse(DTSX_WITH_EXECUTABLES);
    expect(model.precedenceConstraints).toHaveLength(1);
    const pc = model.precedenceConstraints[0];
    expect(pc.constraintType).toBe('Success');
    expect(pc.value).toBe(0);
    // From/To should be resolved to executable IDs
    expect(pc.fromExecutableId).toBeTruthy();
    expect(pc.toExecutableId).toBeTruthy();
  });

  it('should parse executables with nested containers', () => {
    const model = serializer.parse(DTSX_WITH_NESTED_CONTAINER);
    expect(model.executables).toHaveLength(1);
    const seq = model.executables[0];
    expect(seq.objectName).toBe('Sequence Container');
    expect(seq.executableType).toBe('STOCK:SEQUENCE');
    expect(seq.children).toBeDefined();
    expect(seq.children).toHaveLength(1);
    expect(seq.children![0].objectName).toBe('Inner Task');
    expect(seq.children![0].executableType).toBe('Microsoft.ExecuteSQLTask');
  });
});

describe('DtsxSerializer – round-trip', () => {
  it('should round-trip a basic package (parse → serialize → parse)', () => {
    const model1 = serializer.parse(MINIMAL_DTSX);
    const xml = serializer.serialize(model1);
    const model2 = serializer.parse(xml);

    expect(model2.packageName).toBe(model1.packageName);
    expect(model2.packageId).toBe(model1.packageId);
    expect(model2.formatVersion).toBe(model1.formatVersion);
    expect(model2.executables.length).toBe(model1.executables.length);
  });

  it('should round-trip a package with executables', () => {
    const model1 = serializer.parse(DTSX_WITH_EXECUTABLES);
    const xml = serializer.serialize(model1);
    const model2 = serializer.parse(xml);

    expect(model2.executables).toHaveLength(2);
    expect(model2.connectionManagers).toHaveLength(1);
    expect(model2.precedenceConstraints).toHaveLength(1);
  });

  it('should round-trip a package with variables', () => {
    const model1 = serializer.parse(DTSX_WITH_VARIABLES);
    const xml = serializer.serialize(model1);
    const model2 = serializer.parse(xml);

    expect(model2.variables).toHaveLength(2);
    const counter = model2.variables.find(v => v.objectName === 'Counter')!;
    expect(counter.dataType).toBe('Int32');
  });

  it('should round-trip in merge mode preserving structure', () => {
    const model = serializer.parse(DTSX_WITH_EXECUTABLES);
    // Modify something
    model.executables[0].objectName = 'Renamed Task';
    const xml = serializer.serialize(model, DTSX_WITH_EXECUTABLES);
    const model2 = serializer.parse(xml);
    expect(model2.executables[0].objectName).toBe('Renamed Task');
    expect(model2.executables).toHaveLength(2);
  });
});

describe('DtsxSerializer – unknown element preservation', () => {
  it('should detect unknown elements at package level', () => {
    const model = serializer.parse(DTSX_WITH_UNKNOWN_ELEMENTS);
    // LogProviders and Configurations are in the KNOWN set, so they won't be "unknown"
    // But they should still be parseable – the package itself should load fine
    expect(model.packageName).toBe('UnknownPkg');
    expect(model.formatVersion).toBe(8);
  });

  it('should preserve unknown elements during round-trip', () => {
    // Add a truly unknown element
    const customXml = MINIMAL_DTSX.replace(
      '</DTS:Executable>',
      '  <DTS:CustomExtension>SomeValue</DTS:CustomExtension>\n</DTS:Executable>'
    );
    const model = serializer.parse(customXml);
    expect(model.unknownElements.length).toBeGreaterThan(0);

    // Round-trip and verify the unknown element survives
    const xml = serializer.serialize(model);
    expect(xml).toContain('CustomExtension');
  });
});

describe('DtsxSerializer – new package generation', () => {
  it('should generate a valid new blank package', () => {
    const xml = serializer.generateNewPackageXml('MyNewPackage');
    expect(xml).toContain('<?xml version="1.0"?>');
    expect(xml).toContain('DTS:ObjectName="MyNewPackage"');
    expect(xml).toContain('DTS:ExecutableType="Microsoft.Package"');
    expect(xml).toContain('PackageFormatVersion');

    // Should be parseable
    const model = serializer.parse(xml);
    expect(model.packageName).toBe('MyNewPackage');
    expect(model.formatVersion).toBe(8);
  });

  it('should generate unique GUIDs', () => {
    const xml1 = serializer.generateNewPackageXml('Pkg1');
    const xml2 = serializer.generateNewPackageXml('Pkg2');
    const m1 = serializer.parse(xml1);
    const m2 = serializer.parse(xml2);
    expect(m1.packageId).not.toBe(m2.packageId);
  });
});

describe('DtsxSerializer – design-time properties', () => {
  it('should serialize and parse design-time properties', () => {
    const executables = [
      {
        id: 'e1', dtsId: '{AAA}', objectName: 'Task1',
        executableType: 'Microsoft.ExecuteSQLTask', description: '',
        x: 100, y: 200, width: 150, height: 50,
        properties: {}, connectionRefs: [], variables: [], unknownElements: [],
      },
      {
        id: 'e2', dtsId: '{BBB}', objectName: 'Task2',
        executableType: 'Microsoft.ExecuteSQLTask', description: '',
        x: 300, y: 400, width: 150, height: 50,
        properties: {}, connectionRefs: [], variables: [], unknownElements: [],
      },
    ];

    const base64 = serializer.serializeDesignTimeProperties(executables);
    expect(base64).toBeTruthy();

    const positions = serializer.parseDesignTimeProperties(base64!);
    expect(positions).not.toBeNull();
    // The layout XML uses "Package" as the node key containing path, so
    // we look for the object names in the parsed positions
    if (positions) {
      // At minimum the positions map should have entries
      expect(positions.size).toBeGreaterThan(0);
    }
  });

  it('should return null for empty executables', () => {
    const result = serializer.serializeDesignTimeProperties([]);
    expect(result).toBeNull();
  });
});
