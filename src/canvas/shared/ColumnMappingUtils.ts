/**
 * Column Mapping utilities — extracted from ColumnMappingEditor.tsx
 * so that pure logic can be imported by extension code and tests
 * without requiring JSX compilation.
 */

import { ColumnInfo } from '../../services/SchemaDiscovery';
import { DataFlowColumn, ExternalColumn } from '../../models/DataFlowModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  sourceColumnName: string;
  destinationColumnName: string;
  sourceDataType: string;
  destinationDataType: string;
  hasTypeMismatch: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getColumnName(col: ColumnInfo | DataFlowColumn | ExternalColumn): string {
  return col.name;
}

function getColumnDataType(col: ColumnInfo | DataFlowColumn | ExternalColumn): string {
  if ('ssisDataType' in col) {
    return (col as ColumnInfo).ssisDataType;
  }
  return col.dataType;
}

/**
 * Check if two SSIS data types are compatible.
 * Returns true if they are the same or have a known-safe implicit conversion.
 */
function areTypesCompatible(srcType: string, dstType: string): boolean {
  if (srcType === dstType) { return true; }

  const compatible: Record<string, Set<string>> = {
    'DT_STR': new Set(['DT_WSTR', 'DT_TEXT', 'DT_NTEXT']),
    'DT_WSTR': new Set(['DT_STR', 'DT_TEXT', 'DT_NTEXT']),
    'DT_I2': new Set(['DT_I4', 'DT_I8', 'DT_R4', 'DT_R8', 'DT_NUMERIC', 'DT_DECIMAL']),
    'DT_I4': new Set(['DT_I8', 'DT_R8', 'DT_NUMERIC', 'DT_DECIMAL']),
    'DT_I8': new Set(['DT_R8', 'DT_NUMERIC', 'DT_DECIMAL']),
    'DT_UI1': new Set(['DT_I2', 'DT_I4', 'DT_I8', 'DT_UI2', 'DT_UI4', 'DT_R4', 'DT_R8']),
    'DT_UI2': new Set(['DT_I4', 'DT_I8', 'DT_UI4', 'DT_R4', 'DT_R8']),
    'DT_UI4': new Set(['DT_I8', 'DT_UI8', 'DT_R8']),
    'DT_R4': new Set(['DT_R8']),
    'DT_DBDATE': new Set(['DT_DBTIMESTAMP', 'DT_DATE']),
    'DT_DBTIME': new Set(['DT_DBTIMESTAMP']),
    'DT_DATE': new Set(['DT_DBTIMESTAMP']),
  };

  return !!compatible[srcType]?.has(dstType);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Auto-map source columns to destination columns by name (case-insensitive).
 */
export function autoMapByName(
  sourceColumns: (ColumnInfo | DataFlowColumn)[],
  destinationColumns: (ColumnInfo | ExternalColumn)[],
): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const destMap = new Map<string, ColumnInfo | ExternalColumn>();

  for (const dc of destinationColumns) {
    destMap.set(getColumnName(dc).toLowerCase(), dc);
  }

  for (const sc of sourceColumns) {
    const srcName = getColumnName(sc);
    const dest = destMap.get(srcName.toLowerCase());
    if (dest) {
      const srcType = getColumnDataType(sc);
      const dstType = getColumnDataType(dest);
      mappings.push({
        sourceColumnName: srcName,
        destinationColumnName: getColumnName(dest),
        sourceDataType: srcType,
        destinationDataType: dstType,
        hasTypeMismatch: !areTypesCompatible(srcType, dstType),
      });
    }
  }

  return mappings;
}

/**
 * Detect type mismatch for a single mapping.
 */
export function detectTypeMismatch(srcType: string, dstType: string): boolean {
  return !areTypesCompatible(srcType, dstType);
}
