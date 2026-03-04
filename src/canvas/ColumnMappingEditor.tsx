/**
 * Column Mapping Editor — visual column mapping component.
 *
 * Used in OLE DB Source, OLE DB Destination, and Lookup components
 * to map input columns to output/destination/reference columns.
 *
 * Features:
 *  - Two-column layout with SVG mapping lines
 *  - Auto-map by name (case-insensitive)
 *  - Manual drag-and-drop mapping
 *  - Type mismatch warnings
 *  - Table view alternative
 *  - Refresh metadata button
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { ColumnInfo } from '../services/SchemaDiscovery';
import { DataFlowColumn, ExternalColumn } from '../models/DataFlowModel';
import { ColumnMapping, autoMapByName, detectTypeMismatch } from './shared/ColumnMappingUtils';

export type { ColumnMapping };
export { autoMapByName, detectTypeMismatch };

export interface ColumnMappingEditorProps {
  sourceColumns: ColumnInfo[] | DataFlowColumn[];
  destinationColumns: ColumnInfo[] | ExternalColumn[];
  mappings: ColumnMapping[];
  onMappingsChange: (mappings: ColumnMapping[]) => void;
  mode: 'source-to-output' | 'input-to-destination' | 'lookup';
  onRefreshSchema?: () => void;
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
 * Auto-map columns by name (case-insensitive match).
 */
// ---------------------------------------------------------------------------
// Column Mapping Editor Component
// ---------------------------------------------------------------------------

const ColumnMappingEditor: React.FC<ColumnMappingEditorProps> = ({
  sourceColumns,
  destinationColumns,
  mappings,
  onMappingsChange,
  mode,
  onRefreshSchema,
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'table'>('visual');
  const [dragSource, setDragSource] = useState<string | null>(null);
  const [hoveredDest, setHoveredDest] = useState<string | null>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track element positions for SVG lines
  const [lineCoords, setLineCoords] = useState<Array<{ x1: number; y1: number; x2: number; y2: number; mismatch: boolean }>>([]);

  const modeLabels = useMemo(() => {
    switch (mode) {
      case 'source-to-output': return { left: 'Available Columns', right: 'Output Columns' };
      case 'input-to-destination': return { left: 'Input Columns', right: 'Destination Columns' };
      case 'lookup': return { left: 'Input Columns', right: 'Reference Columns' };
    }
  }, [mode]);

  // Mapped source/dest column names
  const mappedSources = useMemo(() => new Set(mappings.map(m => m.sourceColumnName)), [mappings]);
  const mappedDests = useMemo(() => new Set(mappings.map(m => m.destinationColumnName)), [mappings]);

  // Compute line coordinates when mappings or layout changes
  const updateLineCoords = useCallback(() => {
    if (!containerRef.current || !leftColumnRef.current || !rightColumnRef.current) { return; }

    const containerRect = containerRef.current.getBoundingClientRect();
    const coords: typeof lineCoords = [];

    for (const mapping of mappings) {
      const leftItem = leftColumnRef.current.querySelector(`[data-column="${CSS.escape(mapping.sourceColumnName)}"]`);
      const rightItem = rightColumnRef.current.querySelector(`[data-column="${CSS.escape(mapping.destinationColumnName)}"]`);

      if (leftItem && rightItem) {
        const leftRect = leftItem.getBoundingClientRect();
        const rightRect = rightItem.getBoundingClientRect();
        coords.push({
          x1: leftRect.right - containerRect.left,
          y1: leftRect.top + leftRect.height / 2 - containerRect.top,
          x2: rightRect.left - containerRect.left,
          y2: rightRect.top + rightRect.height / 2 - containerRect.top,
          mismatch: mapping.hasTypeMismatch,
        });
      }
    }

    setLineCoords(coords);
  }, [mappings]);

  useEffect(() => {
    updateLineCoords();
    // Also recalculate on resize
    const observer = new ResizeObserver(updateLineCoords);
    if (containerRef.current) { observer.observe(containerRef.current); }
    return () => observer.disconnect();
  }, [updateLineCoords, mappings]);

  // -- Handlers -----------------------------------------------------------

  const handleAutoMap = useCallback(() => {
    const newMappings = autoMapByName(sourceColumns, destinationColumns);
    onMappingsChange(newMappings);
  }, [sourceColumns, destinationColumns, onMappingsChange]);

  const handleClearMappings = useCallback(() => {
    onMappingsChange([]);
  }, [onMappingsChange]);

  const handleRemoveMapping = useCallback((sourceColumnName: string) => {
    onMappingsChange(mappings.filter(m => m.sourceColumnName !== sourceColumnName));
  }, [mappings, onMappingsChange]);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((colName: string) => {
    setDragSource(colName);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, colName: string) => {
    e.preventDefault();
    setHoveredDest(colName);
  }, []);

  const handleDragLeave = useCallback(() => {
    setHoveredDest(null);
  }, []);

  const handleDrop = useCallback((destColName: string) => {
    if (!dragSource) { return; }

    // Find column objects
    const srcCol = sourceColumns.find(c => getColumnName(c) === dragSource);
    const destCol = destinationColumns.find(c => getColumnName(c) === destColName);

    if (!srcCol || !destCol) { return; }

    const srcType = getColumnDataType(srcCol);
    const dstType = getColumnDataType(destCol);

    // Remove existing mappings for this source/dest
    const filtered = mappings.filter(
      m => m.sourceColumnName !== dragSource && m.destinationColumnName !== destColName
    );

    filtered.push({
      sourceColumnName: dragSource,
      destinationColumnName: destColName,
      sourceDataType: srcType,
      destinationDataType: dstType,
      hasTypeMismatch: !areTypesCompatible(srcType, dstType),
    });

    onMappingsChange(filtered);
    setDragSource(null);
    setHoveredDest(null);
  }, [dragSource, sourceColumns, destinationColumns, mappings, onMappingsChange]);

  const handleDragEnd = useCallback(() => {
    setDragSource(null);
    setHoveredDest(null);
  }, []);

  // Table view handlers
  const handleTableMappingChange = useCallback((index: number, field: 'sourceColumnName' | 'destinationColumnName', value: string) => {
    const updated = [...mappings];
    const mapping = { ...updated[index], [field]: value };

    // Recalculate type mismatch
    const srcCol = sourceColumns.find(c => getColumnName(c) === mapping.sourceColumnName);
    const destCol = destinationColumns.find(c => getColumnName(c) === mapping.destinationColumnName);
    if (srcCol && destCol) {
      mapping.sourceDataType = getColumnDataType(srcCol);
      mapping.destinationDataType = getColumnDataType(destCol);
      mapping.hasTypeMismatch = !areTypesCompatible(mapping.sourceDataType, mapping.destinationDataType);
    }

    updated[index] = mapping;
    onMappingsChange(updated);
  }, [mappings, sourceColumns, destinationColumns, onMappingsChange]);

  const handleAddMapping = useCallback(() => {
    const srcNames = sourceColumns.map(c => getColumnName(c));
    const dstNames = destinationColumns.map(c => getColumnName(c));
    const unmappedSrc = srcNames.find(n => !mappedSources.has(n));
    const unmappedDst = dstNames.find(n => !mappedDests.has(n));

    if (unmappedSrc && unmappedDst) {
      const srcCol = sourceColumns.find(c => getColumnName(c) === unmappedSrc)!;
      const destCol = destinationColumns.find(c => getColumnName(c) === unmappedDst)!;
      const srcType = getColumnDataType(srcCol);
      const dstType = getColumnDataType(destCol);

      onMappingsChange([
        ...mappings,
        {
          sourceColumnName: unmappedSrc,
          destinationColumnName: unmappedDst,
          sourceDataType: srcType,
          destinationDataType: dstType,
          hasTypeMismatch: !areTypesCompatible(srcType, dstType),
        },
      ]);
    }
  }, [sourceColumns, destinationColumns, mappedSources, mappedDests, mappings, onMappingsChange]);

  // == Render ==============================================================

  return (
    <div className="ssis-col-map">
      {/* Toolbar */}
      <div className="ssis-col-map__toolbar">
        <button className="ssis-col-map__btn ssis-col-map__btn--primary" onClick={handleAutoMap} title="Auto-map columns by name (case-insensitive)">
          Auto Map
        </button>
        <button className="ssis-col-map__btn" onClick={handleClearMappings} title="Clear all mappings">
          Clear All
        </button>
        {onRefreshSchema && (
          <button className="ssis-col-map__btn" onClick={onRefreshSchema} title="Refresh metadata from database">
            ↻ Refresh
          </button>
        )}
        <div className="ssis-col-map__spacer" />
        <div className="ssis-col-map__view-toggle">
          <button
            className={`ssis-col-map__view-btn ${viewMode === 'visual' ? 'ssis-col-map__view-btn--active' : ''}`}
            onClick={() => setViewMode('visual')}
          >
            Visual
          </button>
          <button
            className={`ssis-col-map__view-btn ${viewMode === 'table' ? 'ssis-col-map__view-btn--active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            Table
          </button>
        </div>
      </div>

      {/* Visual view */}
      {viewMode === 'visual' && (
        <div className="ssis-col-map__visual" ref={containerRef}>
          {/* Left column – source */}
          <div className="ssis-col-map__column" ref={leftColumnRef}>
            <div className="ssis-col-map__column-header">{modeLabels.left}</div>
            <div className="ssis-col-map__column-list">
              {sourceColumns.map(col => {
                const name = getColumnName(col);
                const mapped = mappedSources.has(name);
                return (
                  <div
                    key={name}
                    className={`ssis-col-map__item ${mapped ? 'ssis-col-map__item--mapped' : 'ssis-col-map__item--unmapped'} ${dragSource === name ? 'ssis-col-map__item--dragging' : ''}`}
                    data-column={name}
                    draggable
                    onDragStart={() => handleDragStart(name)}
                    onDragEnd={handleDragEnd}
                  >
                    <span className="ssis-col-map__item-name">{name}</span>
                    <span className="ssis-col-map__item-type">{getColumnDataType(col)}</span>
                    {mapped && (
                      <button
                        className="ssis-col-map__item-remove"
                        onClick={() => handleRemoveMapping(name)}
                        title="Remove mapping"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* SVG mapping lines */}
          <svg className="ssis-col-map__svg" >
            {lineCoords.map((line, i) => (
              <path
                key={i}
                d={`M ${line.x1} ${line.y1} C ${(line.x1 + line.x2) / 2} ${line.y1}, ${(line.x1 + line.x2) / 2} ${line.y2}, ${line.x2} ${line.y2}`}
                className={`ssis-col-map__line ${line.mismatch ? 'ssis-col-map__line--mismatch' : ''}`}
              />
            ))}
          </svg>

          {/* Right column – destination */}
          <div className="ssis-col-map__column" ref={rightColumnRef}>
            <div className="ssis-col-map__column-header">{modeLabels.right}</div>
            <div className="ssis-col-map__column-list">
              {destinationColumns.map(col => {
                const name = getColumnName(col);
                const mapped = mappedDests.has(name);
                return (
                  <div
                    key={name}
                    className={`ssis-col-map__item ${mapped ? 'ssis-col-map__item--mapped' : 'ssis-col-map__item--unmapped'} ${hoveredDest === name ? 'ssis-col-map__item--hover-target' : ''}`}
                    data-column={name}
                    onDragOver={(e) => handleDragOver(e, name)}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop(name)}
                  >
                    <span className="ssis-col-map__item-name">{name}</span>
                    <span className="ssis-col-map__item-type">{getColumnDataType(col)}</span>
                    {mapped && mappings.find(m => m.destinationColumnName === name)?.hasTypeMismatch && (
                      <span className="ssis-col-map__item-warning" title="Type mismatch — may need explicit conversion">⚠</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && (
        <div className="ssis-col-map__table-container">
          <table className="ssis-col-map__table">
            <thead>
              <tr>
                <th>Source Column</th>
                <th>Destination Column</th>
                <th>Source Type</th>
                <th>Dest Type</th>
                <th>Warning</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping, i) => (
                <tr key={i} className={i % 2 === 0 ? 'ssis-col-map__row--even' : 'ssis-col-map__row--odd'}>
                  <td>
                    <select
                      className="ssis-col-map__select"
                      value={mapping.sourceColumnName}
                      onChange={e => handleTableMappingChange(i, 'sourceColumnName', e.target.value)}
                    >
                      {sourceColumns.map(c => (
                        <option key={getColumnName(c)} value={getColumnName(c)}>{getColumnName(c)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="ssis-col-map__select"
                      value={mapping.destinationColumnName}
                      onChange={e => handleTableMappingChange(i, 'destinationColumnName', e.target.value)}
                    >
                      {destinationColumns.map(c => (
                        <option key={getColumnName(c)} value={getColumnName(c)}>{getColumnName(c)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="ssis-col-map__type-cell">{mapping.sourceDataType}</td>
                  <td className="ssis-col-map__type-cell">{mapping.destinationDataType}</td>
                  <td>
                    {mapping.hasTypeMismatch && (
                      <span className="ssis-col-map__warning-badge" title="Type mismatch — may require explicit conversion">⚠ Type mismatch</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="ssis-col-map__remove-btn"
                      onClick={() => handleRemoveMapping(mapping.sourceColumnName)}
                      title="Remove mapping"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {mappings.length === 0 && (
                <tr>
                  <td colSpan={6} className="ssis-col-map__empty-row">
                    No mappings. Click "Auto Map" or drag columns to create mappings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <button className="ssis-col-map__btn ssis-col-map__btn--add" onClick={handleAddMapping}>
            + Add Mapping
          </button>
        </div>
      )}

      {/* Summary */}
      <div className="ssis-col-map__summary">
        <span>{mappings.length} mapping{mappings.length !== 1 ? 's' : ''}</span>
        {mappings.some(m => m.hasTypeMismatch) && (
          <span className="ssis-col-map__summary-warning">
            ⚠ {mappings.filter(m => m.hasTypeMismatch).length} type mismatch{mappings.filter(m => m.hasTypeMismatch).length > 1 ? 'es' : ''}
          </span>
        )}
        {sourceColumns.length - mappedSources.size > 0 && (
          <span className="ssis-col-map__summary-unmapped">
            {sourceColumns.length - mappedSources.size} unmapped source column{(sourceColumns.length - mappedSources.size) > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
};

export default ColumnMappingEditor;
export { areTypesCompatible, getColumnName, getColumnDataType };
