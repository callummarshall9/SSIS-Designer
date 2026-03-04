import React, { useState, useCallback, useMemo } from 'react';
import { useCanvasStore } from './shared/CanvasState';
import { SsisParameter, SsisDataType } from '../models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Data type options
// ---------------------------------------------------------------------------

const DATA_TYPES: SsisDataType[] = [
  'Boolean', 'Byte', 'Char', 'DateTime', 'Decimal', 'Double',
  'Int16', 'Int32', 'Int64', 'Object', 'SByte', 'Single', 'String',
  'UInt32', 'UInt64',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newGuid(): string {
  try {
    const g = (globalThis as any).crypto;
    if (g && typeof g.randomUUID === 'function') {
      return `{${(g.randomUUID() as string).toUpperCase()}}`;
    }
  } catch { /* ignore */ }
  const hex = '0123456789ABCDEF';
  const seg = (n: number) =>
    Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `{${seg(8)}-${seg(4)}-4${seg(3)}-${hex[8 + Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}}`;
}

function defaultParameter(): SsisParameter {
  return {
    id: newGuid(),
    dtsId: newGuid(),
    objectName: 'NewParameter',
    dataType: 'String',
    value: '',
    required: false,
    sensitive: false,
    unknownElements: [],
  };
}

// ---------------------------------------------------------------------------
// Parameter Panel
// ---------------------------------------------------------------------------

interface ParameterPanelProps {
  parameters: SsisParameter[];
  onParametersChange: (parameters: SsisParameter[]) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  parameters,
  onParametersChange,
  collapsed = false,
  onToggle,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) { return parameters; }
    const lower = filter.toLowerCase();
    return parameters.filter(
      (p) =>
        p.objectName.toLowerCase().includes(lower) ||
        p.dataType.toLowerCase().includes(lower)
    );
  }, [parameters, filter]);

  const handleAdd = useCallback(() => {
    const newParam = defaultParameter();
    onParametersChange([...parameters, newParam]);
    setEditingId(newParam.id);
  }, [parameters, onParametersChange]);

  const handleDelete = useCallback(
    (id: string) => {
      onParametersChange(parameters.filter((p) => p.id !== id));
      if (editingId === id) { setEditingId(null); }
    },
    [parameters, onParametersChange, editingId]
  );

  const handleUpdate = useCallback(
    (id: string, field: keyof SsisParameter, value: any) => {
      onParametersChange(
        parameters.map((p) => (p.id === id ? { ...p, [field]: value } : p))
      );
    },
    [parameters, onParametersChange]
  );

  if (collapsed) {
    return (
      <div className="ssis-parameters ssis-parameters--collapsed" onClick={onToggle} title="Expand Parameters">
        <span>Parameters ▴</span>
      </div>
    );
  }

  return (
    <div className="ssis-parameters">
      <div className="ssis-parameters__header">
        <span className="ssis-parameters__title">Parameters</span>
        <div className="ssis-parameters__actions">
          <input
            type="text"
            className="ssis-parameters__filter"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="ssis-parameters__add-btn" onClick={handleAdd} title="Add Parameter">
            +
          </button>
          {onToggle && (
            <button className="ssis-parameters__collapse-btn" onClick={onToggle} title="Collapse">
              ▾
            </button>
          )}
        </div>
      </div>
      <div className="ssis-parameters__table-wrapper">
        <table className="ssis-parameters__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Data Type</th>
              <th>Value</th>
              <th>Required</th>
              <th>Sensitive</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="ssis-parameters__empty">
                  No parameters
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const isEditing = editingId === p.id;
              return (
                <tr key={p.id} className={isEditing ? 'ssis-parameters__row--editing' : ''}>
                  <td>
                    {isEditing ? (
                      <input
                        type="text"
                        className="ssis-var-input"
                        value={p.objectName}
                        onChange={(e) => handleUpdate(p.id, 'objectName', e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span onDoubleClick={() => setEditingId(p.id)}>{p.objectName}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <select
                        className="ssis-var-select"
                        value={p.dataType}
                        onChange={(e) => handleUpdate(p.id, 'dataType', e.target.value)}
                      >
                        {DATA_TYPES.map((dt) => (
                          <option key={dt} value={dt}>
                            {dt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{p.dataType}</span>
                    )}
                  </td>
                  <td>
                    {isEditing ? (
                      <input
                        type="text"
                        className="ssis-var-input"
                        value={String(p.value ?? '')}
                        onChange={(e) => handleUpdate(p.id, 'value', e.target.value)}
                      />
                    ) : (
                      <span onDoubleClick={() => setEditingId(p.id)}>
                        {p.sensitive ? '••••••' : String(p.value ?? '')}
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.required}
                      onChange={(e) => handleUpdate(p.id, 'required', e.target.checked)}
                      disabled={!isEditing}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.sensitive}
                      onChange={(e) => handleUpdate(p.id, 'sensitive', e.target.checked)}
                      disabled={!isEditing}
                    />
                  </td>
                  <td>
                    <div className="ssis-parameters__row-actions">
                      {isEditing ? (
                        <button
                          className="ssis-var-btn"
                          onClick={() => setEditingId(null)}
                          title="Done"
                        >
                          ✓
                        </button>
                      ) : (
                        <button
                          className="ssis-var-btn"
                          onClick={() => setEditingId(p.id)}
                          title="Edit"
                        >
                          ✎
                        </button>
                      )}
                      <button
                        className="ssis-var-btn ssis-var-btn--delete"
                        onClick={() => handleDelete(p.id)}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ParameterPanel;
