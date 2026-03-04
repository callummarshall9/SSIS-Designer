/**
 * Tests for Column Mapping Editor — auto-map, type mismatch detection, and SQL-to-SSIS mapping.
 */

import { describe, it, expect } from 'vitest';
import { autoMapByName, detectTypeMismatch, ColumnMapping } from '../canvas/shared/ColumnMappingUtils';
import { SchemaDiscovery, ColumnInfo } from '../services/SchemaDiscovery';
import { DataFlowColumn } from '../models/DataFlowModel';
import { ExternalColumn } from '../models/DataFlowModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumnInfo(name: string, ssisDataType: string, dataType = 'varchar'): ColumnInfo {
  return {
    name,
    dataType,
    ssisDataType,
    maxLength: 50,
    precision: 0,
    scale: 0,
    isNullable: true,
    isIdentity: false,
    ordinalPosition: 1,
  };
}

function makeDataFlowColumn(name: string, dataType: string): DataFlowColumn {
  return {
    id: `col-${name}`,
    refId: `ref-${name}`,
    name,
    dataType,
    unknownElements: [],
  };
}

function makeExternalColumn(name: string, dataType: string): ExternalColumn {
  return {
    id: `ext-${name}`,
    refId: `ext-ref-${name}`,
    name,
    dataType,
  };
}

// ---------------------------------------------------------------------------
// Auto-map by name tests
// ---------------------------------------------------------------------------

describe('autoMapByName', () => {
  it('should map columns with matching names (case-insensitive)', () => {
    const src = [
      makeColumnInfo('CustomerID', 'DT_I4'),
      makeColumnInfo('FirstName', 'DT_WSTR'),
      makeColumnInfo('LastName', 'DT_WSTR'),
    ];
    const dest = [
      makeColumnInfo('customerid', 'DT_I4'),
      makeColumnInfo('firstname', 'DT_WSTR'),
      makeColumnInfo('lastname', 'DT_WSTR'),
    ];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(3);
    expect(mappings[0].sourceColumnName).toBe('CustomerID');
    expect(mappings[0].destinationColumnName).toBe('customerid');
  });

  it('should not map columns with different names', () => {
    const src = [makeColumnInfo('Id', 'DT_I4')];
    const dest = [makeColumnInfo('CustomerId', 'DT_I4')];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(0);
  });

  it('should detect type mismatch in auto-map', () => {
    const src = [makeColumnInfo('Amount', 'DT_WSTR')];
    const dest = [makeColumnInfo('Amount', 'DT_I4')];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].hasTypeMismatch).toBe(true);
  });

  it('should not report mismatch for same types', () => {
    const src = [makeColumnInfo('Name', 'DT_WSTR')];
    const dest = [makeColumnInfo('Name', 'DT_WSTR')];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].hasTypeMismatch).toBe(false);
  });

  it('should work with DataFlowColumn and ExternalColumn', () => {
    const src = [makeDataFlowColumn('OrderId', 'DT_I4')];
    const dest = [makeExternalColumn('orderid', 'DT_I4')];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(1);
    expect(mappings[0].sourceColumnName).toBe('OrderId');
    expect(mappings[0].destinationColumnName).toBe('orderid');
  });

  it('should handle empty source columns', () => {
    const src: ColumnInfo[] = [];
    const dest = [makeColumnInfo('Name', 'DT_WSTR')];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(0);
  });

  it('should handle empty destination columns', () => {
    const src = [makeColumnInfo('Name', 'DT_WSTR')];
    const dest: ColumnInfo[] = [];

    const mappings = autoMapByName(src, dest);
    expect(mappings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Type mismatch detection
// ---------------------------------------------------------------------------

describe('detectTypeMismatch', () => {
  it('should not flag same types as mismatch', () => {
    expect(detectTypeMismatch('DT_WSTR', 'DT_WSTR')).toBe(false);
    expect(detectTypeMismatch('DT_I4', 'DT_I4')).toBe(false);
    expect(detectTypeMismatch('DT_BOOL', 'DT_BOOL')).toBe(false);
  });

  it('should allow DT_STR to DT_WSTR conversion', () => {
    expect(detectTypeMismatch('DT_STR', 'DT_WSTR')).toBe(false);
  });

  it('should allow narrower int to wider int conversion', () => {
    expect(detectTypeMismatch('DT_I2', 'DT_I4')).toBe(false);
    expect(detectTypeMismatch('DT_I4', 'DT_I8')).toBe(false);
  });

  it('should flag incompatible types', () => {
    expect(detectTypeMismatch('DT_WSTR', 'DT_I4')).toBe(true);
    expect(detectTypeMismatch('DT_BOOL', 'DT_DBTIMESTAMP')).toBe(true);
  });

  it('should allow date to timestamp conversion', () => {
    expect(detectTypeMismatch('DT_DBDATE', 'DT_DBTIMESTAMP')).toBe(false);
    expect(detectTypeMismatch('DT_DATE', 'DT_DBTIMESTAMP')).toBe(false);
  });

  it('should allow numeric widening', () => {
    expect(detectTypeMismatch('DT_R4', 'DT_R8')).toBe(false);
    expect(detectTypeMismatch('DT_UI1', 'DT_I4')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SQL to SSIS type mapping
// ---------------------------------------------------------------------------

describe('SchemaDiscovery.mapSqlTypeToSsis', () => {
  it('should map varchar to DT_STR', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('varchar')).toBe('DT_STR');
  });

  it('should map nvarchar to DT_WSTR', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('nvarchar')).toBe('DT_WSTR');
  });

  it('should map int to DT_I4', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('int')).toBe('DT_I4');
  });

  it('should map bigint to DT_I8', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('bigint')).toBe('DT_I8');
  });

  it('should map smallint to DT_I2', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('smallint')).toBe('DT_I2');
  });

  it('should map tinyint to DT_UI1', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('tinyint')).toBe('DT_UI1');
  });

  it('should map bit to DT_BOOL', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('bit')).toBe('DT_BOOL');
  });

  it('should map decimal to DT_NUMERIC', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('decimal')).toBe('DT_NUMERIC');
  });

  it('should map numeric to DT_NUMERIC', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('numeric')).toBe('DT_NUMERIC');
  });

  it('should map float to DT_R8', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('float')).toBe('DT_R8');
  });

  it('should map real to DT_R4', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('real')).toBe('DT_R4');
  });

  it('should map datetime to DT_DBTIMESTAMP', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('datetime')).toBe('DT_DBTIMESTAMP');
  });

  it('should map datetime2 to DT_DBTIMESTAMP', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('datetime2')).toBe('DT_DBTIMESTAMP');
  });

  it('should map date to DT_DBDATE', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('date')).toBe('DT_DBDATE');
  });

  it('should map time to DT_DBTIME', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('time')).toBe('DT_DBTIME');
  });

  it('should map uniqueidentifier to DT_GUID', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('uniqueidentifier')).toBe('DT_GUID');
  });

  it('should map varbinary to DT_BYTES', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('varbinary')).toBe('DT_BYTES');
  });

  it('should map binary to DT_BYTES', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('binary')).toBe('DT_BYTES');
  });

  it('should map money to DT_CY', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('money')).toBe('DT_CY');
  });

  it('should map xml to DT_NTEXT', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('xml')).toBe('DT_NTEXT');
  });

  it('should map text to DT_TEXT', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('text')).toBe('DT_TEXT');
  });

  it('should map ntext to DT_NTEXT', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('ntext')).toBe('DT_NTEXT');
  });

  it('should be case-insensitive', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('INT')).toBe('DT_I4');
    expect(SchemaDiscovery.mapSqlTypeToSsis('NVarChar')).toBe('DT_WSTR');
  });

  it('should default to DT_WSTR for unknown types', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('unknowntype')).toBe('DT_WSTR');
  });

  it('should handle empty string', () => {
    expect(SchemaDiscovery.mapSqlTypeToSsis('')).toBe('DT_WSTR');
  });
});
