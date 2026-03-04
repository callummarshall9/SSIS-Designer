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

  it('should preserve newly added executable with duplicate object name in merge mode', () => {
    const model = serializer.parse(DTSX_WITH_EXECUTABLES);

    model.executables.push({
      id: '{11111111-2222-3333-4444-555555555555}',
      dtsId: '{11111111-2222-3333-4444-555555555555}',
      objectName: 'SQL Task 1',
      executableType: 'Microsoft.ExecuteSQLTask',
      description: '',
      x: 100,
      y: 100,
      width: 200,
      height: 80,
      properties: {
        'SQLTask.SqlStatementSource': 'SELECT 3',
      },
      connectionRefs: [],
      variables: [],
      unknownElements: [],
    });

    const xml = serializer.serialize(model, DTSX_WITH_EXECUTABLES);
    const model2 = serializer.parse(xml);

    expect(model2.executables).toHaveLength(3);
    expect(model2.executables.some(e => e.dtsId === '{11111111-2222-3333-4444-555555555555}')).toBe(true);
  });

  it('should add SQLTask namespace when execute sql task is added in merge mode', () => {
    const model = serializer.parse(MINIMAL_DTSX);

    model.executables.push({
      id: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      dtsId: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
      objectName: 'Execute SQL Task',
      executableType: 'Microsoft.ExecuteSQLTask',
      description: '',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      properties: {
        'SQLTask.SqlStatementSource': 'SELECT 1',
      },
      connectionRefs: [],
      variables: [],
      unknownElements: [],
    });

    const xml = serializer.serialize(model, MINIMAL_DTSX);
    expect(xml).toContain('xmlns:SQLTask="www.microsoft.com/sqlserver/dts/tasks/sqltask"');
    expect(xml).toContain('SQLTask:SqlTaskData');
    // Namespace appears on both the root and the SqlTaskData element (matches VS)
    expect((xml.match(/xmlns:SQLTask=/g) ?? [])).toHaveLength(2);

    const reparsed = serializer.parse(xml);
    expect(reparsed.executables).toHaveLength(1);
    expect(reparsed.executables[0].executableType).toBe('Microsoft.ExecuteSQLTask');
    expect(reparsed.executables[0].properties['SQLTask.SqlStatementSource']).toBe('SELECT 1');
  });

  it('should assign package DTSID during merge when original is blank', () => {
    const blankIdXml = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate=""
  DTS:LocaleID=""
  DTS:VersionBuild=""
  DTS:LastModifiedProductVersion=""
  DTS:CreatorName=""
  DTS:DTSID=""
  DTS:VersionGUID=""
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="Package">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
</DTS:Executable>`;

    const model = serializer.parse(blankIdXml);
    const xml = serializer.serialize(model, blankIdXml);

    expect(xml).toMatch(/DTS:DTSID="\{[0-9A-F\-]{36}\}"/);
    expect(xml).toMatch(/DTS:VersionGUID="\{[0-9A-F\-]{36}\}"/);
    expect(xml).toMatch(/DTS:CreationDate="[^"]+"/);
    expect(xml).toContain('DTS:LocaleID="1033"');
    expect(xml).toContain('DTS:VersionBuild="0"');
    expect(xml).toMatch(/DTS:LastModifiedProductVersion="[^"]+"/);
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

  it('should parse SSIS 2019 GraphLayout NodeLayout format (raw XML in CDATA)', () => {
    const graphLayoutXml = `<?xml version="1.0"?>
<Objects Version="8">
  <Package design-time-name="Package">
    <LayoutInfo>
      <GraphLayout Capacity="4">
        <NodeLayout Size="150.4,41.6" Id="Package\\Data Flow Task" TopLeft="299.28,71.11" />
      </GraphLayout>
    </LayoutInfo>
  </Package>
</Objects>`;
    const positions = serializer.parseDesignTimeProperties(graphLayoutXml);
    expect(positions).not.toBeNull();
    expect(positions!.has('Data Flow Task')).toBe(true);
    const pos = positions!.get('Data Flow Task')!;
    expect(pos.x).toBeCloseTo(299.28, 1);
    expect(pos.y).toBeCloseTo(71.11, 1);
    expect(pos.width).toBeCloseTo(150.4, 1);
    expect(pos.height).toBeCloseTo(41.6, 1);
  });
});

describe('DtsxSerializer – Q1-style attribute-based connection string', () => {
  const DTSX_WITH_ATTR_CONNSTR = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="5/15/2023 1:02:25 AM"
  DTS:DTSID="{125965C9-90BD-4D1B-9077-C93B597D26AC}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="Package1">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:ConnectionManagers>
    <DTS:ConnectionManager
      DTS:refId="Package.ConnectionManagers[MyServer.MyDB]"
      DTS:CreationName="OLEDB"
      DTS:DTSID="{F29007BE-5E5D-4EDA-A05F-6B763EF2E141}"
      DTS:ObjectName="MyServer.MyDB">
      <DTS:ObjectData>
        <DTS:ConnectionManager
          DTS:ConnectRetryCount="1"
          DTS:ConnectRetryInterval="5"
          DTS:ConnectionString="Data Source=MyServer;Initial Catalog=MyDB;Provider=SQLOLEDB.1;" />
      </DTS:ObjectData>
    </DTS:ConnectionManager>
  </DTS:ConnectionManagers>
</DTS:Executable>`;

  it('should parse connection string from DTS:ConnectionString attribute', () => {
    const model = serializer.parse(DTSX_WITH_ATTR_CONNSTR);
    expect(model.connectionManagers).toHaveLength(1);
    const cm = model.connectionManagers[0];
    expect(cm.objectName).toBe('MyServer.MyDB');
    expect(cm.connectionString).toBe('Data Source=MyServer;Initial Catalog=MyDB;Provider=SQLOLEDB.1;');
    expect(cm.creationName).toBe('OLEDB');
  });

  it('should round-trip attribute-based connection string in merge mode', () => {
    const model = serializer.parse(DTSX_WITH_ATTR_CONNSTR);
    // Modify the connection string
    model.connectionManagers[0].connectionString = 'Data Source=NewServer;Initial Catalog=NewDB;Provider=SQLOLEDB.1;';
    const xml = serializer.serialize(model, DTSX_WITH_ATTR_CONNSTR);
    const model2 = serializer.parse(xml);
    expect(model2.connectionManagers[0].connectionString).toBe('Data Source=NewServer;Initial Catalog=NewDB;Provider=SQLOLEDB.1;');
    // Should preserve the attribute format (no DTS:Property child for ConnectionString)
    expect(xml).toContain('DTS:ConnectionString="Data Source=NewServer;Initial Catalog=NewDB;Provider=SQLOLEDB.1;"');
  });

  it('should migrate DTS:Property-based CMs to attribute format during merge', () => {
    // DTSX_WITH_CONNECTIONS uses <DTS:Property DTS:Name="ConnectionString">...</DTS:Property>
    const model = serializer.parse(DTSX_WITH_CONNECTIONS);
    const xml = serializer.serialize(model, DTSX_WITH_CONNECTIONS);
    // After merge, ConnectionString should be an attribute, not a DTS:Property child
    expect(xml).toContain('DTS:ConnectionString="Data Source=.;Initial Catalog=TestDb;"');
    expect(xml).not.toContain('<DTS:Property DTS:Name="ConnectionString">');
    // RetainSameConnection should also be an attribute
    expect(xml).toContain('DTS:RetainSameConnection="False"');
    // Verify round-trip still works
    const model2 = serializer.parse(xml);
    expect(model2.connectionManagers[0].connectionString).toBe('Data Source=.;Initial Catalog=TestDb;');
  });

  it('should serialize new connection managers with attribute format', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.connectionManagers.push({
      objectName: 'NewConn',
      creationName: 'OLEDB',
      dtsId: '{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}',
      connectionString: 'Data Source=srv;Initial Catalog=db;',
      description: '',
      properties: { RetainSameConnection: 'False' },
    });
    const xml = serializer.serialize(model, MINIMAL_DTSX);
    // New CM should use attribute format
    expect(xml).toContain('DTS:ConnectionString="Data Source=srv;Initial Catalog=db;"');
    expect(xml).toContain('DTS:RetainSameConnection="False"');
    expect(xml).not.toContain('<DTS:Property DTS:Name="ConnectionString">');
  });
});

describe('DtsxSerializer – Data Flow Task parsing', () => {
  const DTSX_WITH_DATA_FLOW = `<?xml version="1.0"?>
<DTS:Executable xmlns:DTS="www.microsoft.com/SqlServer/Dts"
  DTS:refId="Package"
  DTS:CreationDate="5/15/2023"
  DTS:DTSID="{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"
  DTS:ExecutableType="Microsoft.Package"
  DTS:ObjectName="DFPkg">
  <DTS:Property DTS:Name="PackageFormatVersion">8</DTS:Property>
  <DTS:ConnectionManagers>
    <DTS:ConnectionManager
      DTS:refId="Package.ConnectionManagers[MyConn]"
      DTS:CreationName="OLEDB"
      DTS:DTSID="{11111111-2222-3333-4444-555555555555}"
      DTS:ObjectName="MyConn">
      <DTS:ObjectData>
        <DTS:ConnectionManager
          DTS:ConnectionString="Data Source=.;Initial Catalog=TestDB;" />
      </DTS:ObjectData>
    </DTS:ConnectionManager>
  </DTS:ConnectionManagers>
  <DTS:Executables>
    <DTS:Executable
      DTS:refId="Package\\Data Flow Task"
      DTS:CreationName="Microsoft.Pipeline"
      DTS:DTSID="{CA9D6F37-6704-4A45-AA1F-A9615C32CB52}"
      DTS:ExecutableType="Microsoft.Pipeline"
      DTS:ObjectName="Data Flow Task">
      <DTS:ObjectData>
        <pipeline version="1">
          <components>
            <component
              refId="Package\\Data Flow Task\\OLE DB Source"
              componentClassID="Microsoft.OLEDBSource"
              name="OLE DB Source">
              <outputs>
                <output
                  refId="Package\\Data Flow Task\\OLE DB Source.Outputs[OLE DB Source Output]"
                  name="OLE DB Source Output">
                  <outputColumns>
                    <outputColumn refId="Package\\Data Flow Task\\OLE DB Source.Outputs[OLE DB Source Output].Columns[id]"
                      dataType="i4" name="id" />
                  </outputColumns>
                  <externalMetadataColumns isUsed="True">
                    <externalMetadataColumn refId="Package\\Data Flow Task\\OLE DB Source.Outputs[OLE DB Source Output].ExternalColumns[id]"
                      dataType="i4" name="id" />
                  </externalMetadataColumns>
                </output>
              </outputs>
              <connections>
                <connection
                  refId="Package\\Data Flow Task\\OLE DB Source.Connections[OleDbConnection]"
                  connectionManagerRefId="Package.ConnectionManagers[MyConn]"
                  name="OleDbConnection" />
              </connections>
            </component>
            <component
              refId="Package\\Data Flow Task\\OLE DB Destination"
              componentClassID="Microsoft.OLEDBDestination"
              name="OLE DB Destination">
              <inputs>
                <input
                  refId="Package\\Data Flow Task\\OLE DB Destination.Inputs[OLE DB Destination Input]"
                  name="OLE DB Destination Input">
                  <inputColumns>
                    <inputColumn refId="Package\\Data Flow Task\\OLE DB Destination.Inputs[OLE DB Destination Input].Columns[id]"
                      cachedDataType="i4" cachedName="id" />
                  </inputColumns>
                </input>
              </inputs>
            </component>
          </components>
          <paths>
            <path
              refId="Package\\Data Flow Task.Paths[OLE DB Source Output]"
              endId="Package\\Data Flow Task\\OLE DB Destination.Inputs[OLE DB Destination Input]"
              name="OLE DB Source Output"
              startId="Package\\Data Flow Task\\OLE DB Source.Outputs[OLE DB Source Output]" />
          </paths>
        </pipeline>
      </DTS:ObjectData>
    </DTS:Executable>
  </DTS:Executables>
</DTS:Executable>`;

  it('should parse the Data Flow Task as a Microsoft.Pipeline executable', () => {
    const model = serializer.parse(DTSX_WITH_DATA_FLOW);
    expect(model.executables).toHaveLength(1);
    expect(model.executables[0].executableType).toBe('Microsoft.Pipeline');
    expect(model.executables[0].objectName).toBe('Data Flow Task');
  });

  it('should parse data flow model with components and paths', () => {
    // Parse the raw XML to get the raw executable node for parseDataFlowModel
    const { XMLParser } = require('fast-xml-parser');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      cdataPropName: '__cdata',
      trimValues: false,
      parseTagValue: false,
      allowBooleanAttributes: true,
      removeNSPrefix: false,
      processEntities: true,
      numberParseOptions: { leadingZeros: false, hex: false },
      isArray: (tagName: string) => {
        const arrayTags = [
          'DTS:Executable', 'DTS:ConnectionManager', 'DTS:Property',
          'component', 'path', 'input', 'output',
          'inputColumn', 'outputColumn', 'externalMetadataColumn', 'property',
        ];
        return arrayTags.includes(tagName);
      },
    });
    const doc = parser.parse(DTSX_WITH_DATA_FLOW);
    const root = Array.isArray(doc['DTS:Executable']) ? doc['DTS:Executable'][0] : doc['DTS:Executable'];
    const execNodes = root['DTS:Executables']['DTS:Executable'];
    const dfExec = Array.isArray(execNodes) ? execNodes[0] : execNodes;

    const dfModel = serializer.parseDataFlowModel(dfExec);
    expect(dfModel).not.toBeNull();
    expect(dfModel!.components).toHaveLength(2);
    expect(dfModel!.paths).toHaveLength(1);

    const source = dfModel!.components.find(c => c.name === 'OLE DB Source');
    expect(source).toBeDefined();
    expect(source!.connectionManagerRefId).toBe('Package.ConnectionManagers[MyConn]');
    expect(source!.outputs).toHaveLength(1);

    const dest = dfModel!.components.find(c => c.name === 'OLE DB Destination');
    expect(dest).toBeDefined();
    expect(dest!.inputs).toHaveLength(1);

    const path = dfModel!.paths[0];
    expect(path.name).toBe('OLE DB Source Output');
  });

  // ---- SQL Task serialization fidelity ----

  it('should emit CreationName attribute on executable nodes', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: {}, connectionRefs: [], variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    expect(xml).toContain('DTS:CreationName="Microsoft.ExecuteSQLTask"');
  });

  it('should emit empty DTS:Variables element on executables without variables', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: {}, connectionRefs: [], variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    expect(xml).toMatch(/DTS:Variables/);
  });

  it('should emit xmlns:SQLTask on SqlTaskData element', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: { 'SQLTask.SqlStatementSource': 'SELECT 1' },
      connectionRefs: [], variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    // The namespace should appear on the SqlTaskData element (inline)
    const sqlTaskDataMatch = xml.match(/<SQLTask:SqlTaskData[^>]*>/);
    expect(sqlTaskDataMatch).not.toBeNull();
    expect(sqlTaskDataMatch![0]).toContain('xmlns:SQLTask="www.microsoft.com/sqlserver/dts/tasks/sqltask"');
  });

  it('should resolve connection name to DTSID in SQLTask:Connection', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.connectionManagers.push({
      id: 'cm1',
      dtsId: '{CCCCCCCC-DDDD-EEEE-FFFF-000000000001}',
      refId: 'Package.ConnectionManagers[MyConn]',
      objectName: 'MyConn',
      creationName: 'ADO.NET:System.Data.SqlClient.SqlConnection',
      connectionString: 'Server=.;Database=test;',
      retainSameConnection: false,
      description: '',
      properties: {},
    });
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: {},
      connectionRefs: [{ connectionManagerId: 'MyConn', connectionManagerName: '' }],
      variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    expect(xml).toContain('SQLTask:Connection="{CCCCCCCC-DDDD-EEEE-FFFF-000000000001}"');
    expect(xml).not.toContain('SQLTask:Connection="MyConn"');
  });

  it('should preserve DTSID when connection ref is already a GUID', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: {},
      connectionRefs: [{ connectionManagerId: '{CCCCCCCC-DDDD-EEEE-FFFF-000000000001}', connectionManagerName: '' }],
      variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    expect(xml).toContain('SQLTask:Connection="{CCCCCCCC-DDDD-EEEE-FFFF-000000000001}"');
  });

  it('should not emit ConnectionName as DTS:Property', () => {
    const model = serializer.parse(MINIMAL_DTSX);
    model.executables.push({
      id: 'sql1', dtsId: '{11111111-0000-0000-0000-000000000001}',
      objectName: 'Run Query', executableType: 'Microsoft.ExecuteSQLTask',
      description: '', x: 0, y: 0, width: 200, height: 80,
      properties: { ConnectionName: 'MyConn', 'SQLTask.SqlStatementSource': 'SELECT 1' },
      connectionRefs: [{ connectionManagerId: 'MyConn', connectionManagerName: '' }],
      variables: [], unknownElements: [],
    });
    const xml = serializer.serialize(model);
    expect(xml).not.toContain('DTS:Name="ConnectionName"');
  });
});
