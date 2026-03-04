import React, { useState, useCallback, useMemo } from 'react';
import { useCanvasStore } from './shared/CanvasState';
import { SsisVariable, SsisDataType } from '../models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Data type options
// ---------------------------------------------------------------------------

const DATA_TYPES: SsisDataType[] = [
  'Boolean', 'Byte', 'Char', 'DateTime', 'Decimal', 'Double',
  'Int16', 'Int32', 'Int64', 'Object', 'SByte', 'Single', 'String',
  'UInt32', 'UInt64',
];

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

type SortField = 'objectName' | 'namespace' | 'dataType';
type SortDirection = 'asc' | 'desc';

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
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `{${seg(8)}-${seg(4)}-4${seg(3)}-${hex[8 + Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}}`;
}

function defaultVariable(): SsisVariable {
  return {
    id: newGuid(),
    dtsId: newGuid(),
    objectName: 'NewVariable',
    namespace: 'User',
    dataType: 'String',
    value: '',
    evaluateAsExpression: false,
    readOnly: false,
    unknownElements: [],
  };
}

// ---------------------------------------------------------------------------
// Variable Panel
// ---------------------------------------------------------------------------

interface VariablePanelProps {
  variables: SsisVariable[];
  onVariablesChange: (variables: SsisVariable[]) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Scope label (e.g. "Package" or the selected container name) */
  scope?: string;
}

const VariablePanel: React.FC<VariablePanelProps> = ({
  variables,
  onVariablesChange,
  collapsed = false,
  onToggle,
  scope = 'Package',
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'User' | 'System'>('all');
  const [nameFilter, setNameFilter] = useState('');
  const [sortField, setSortField] = useState<SortField>('objectName');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const filtered = useMemo(() => {
    let result = variables;
    if (scopeFilter !== 'all') {
      result = result.filter((v) => v.namespace === scopeFilter);
    }
    if (nameFilter) {
      const lower = nameFilter.toLowerCase();
      result = result.filter(
        (v) =>
          v.objectName.toLowerCase().includes(lower) ||
          v.dataType.toLowerCase().includes(lower) ||
          String(v.value ?? '').toLowerCase().includes(lower)
      );
    }
    // Sort
    result = [...result].sort((a, b) => {
      const aVal = String((a as any)[sortField] ?? '').toLowerCase();
      const bVal = String((b as any)[sortField] ?? '').toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [variables, scopeFilter, nameFilter, sortField, sortDir]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) { return ''; }
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  const handleAdd = useCallback(() => {
    const newVar = defaultVariable();
    onVariablesChange([...variables, newVar]);
    setEditingId(newVar.id);
  }, [variables, onVariablesChange]);

  const handleDelete = useCallback(
    (id: string) => {
      onVariablesChange(variables.filter((v) => v.id !== id));
      if (editingId === id) { setEditingId(null); }
    },
    [variables, onVariablesChange, editingId]
  );

  const handleUpdate = useCallback(
    (id: string, field: keyof SsisVariable, value: any) => {
      onVariablesChange(
        variables.map((v) => (v.id === id ? { ...v, [field]: value } : v))
      );
    },
    [variables, onVariablesChange]
  );

  if (collapsed) {
    return (
      <div className="ssis-variables ssis-variables--collapsed" onClick={onToggle} title="Expand Variables">
        <span>Variables ▴</span>
      </div>
    );
  }

  return (
    <div className="ssis-variables">
      <div className="ssis-variables__header">
        <span className="ssis-variables__title">Variables</span>
        <span className="ssis-variables__scope">Scope: {scope}</span>
        <div className="ssis-variables__actions">
          <input
            type="text"
            className="ssis-variables__filter"
            placeholder="Filter…"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />
          <select
            className="ssis-variables__scope-select"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as any)}
          >
            <option value="all">All</option>
            <option value="User">User</option>
            <option value="System">System</option>
          </select>
          <button className="ssis-variables__add-btn" onClick={handleAdd} title="Add Variable">
            +
          </button>
          {onToggle && (
            <button className="ssis-variables__collapse-btn" onClick={onToggle} title="Collapse">
              ▾
            </button>
          )}
        </div>
      </div>
      <div className="ssis-variables__table-wrapper">
        <table className="ssis-variables__table">
          <thead>
            <tr>
              <th className="ssis-variables__th--sortable" onClick={() => handleSort('objectName')}>
                Name{sortIndicator('objectName')}
              </th>
              <th className="ssis-variables__th--sortable" onClick={() => handleSort('namespace')}>
                Namespace{sortIndicator('namespace')}
              </th>
              <th className="ssis-variables__th--sortable" onClick={() => handleSort('dataType')}>
                Data Type{sortIndicator('dataType')}
              </th>
              <th>Value</th>
              <th>Expression</th>
              <th>Scope</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="ssis-variables__empty">
                  No variables
                </td>
              </tr>
            )}
            {filtered.map((v) => {
              const isEditing = editingId === v.id;
              const isSystem = v.namespace === 'System';
              const isReadOnly = isSystem || v.readOnly;
              return (
                <tr
                  key={v.id}
                  className={`${isEditing ? 'ssis-variables__row--editing' : ''} ${isSystem ? 'ssis-variables__row--system' : ''}`}
                >
                  <td>
                    {isEditing && !isReadOnly ? (
                      <input
                        type="text"
                        className="ssis-var-input"
                        value={v.objectName}
                        onChange={(e) => handleUpdate(v.id, 'objectName', e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span onDoubleClick={() => !isReadOnly && setEditingId(v.id)}>
                        {v.objectName}
                        {isReadOnly && <span className="ssis-var-readonly-badge" title="Read-only"> 🔒</span>}
                      </span>
                    )}
                  </td>
                  <td>
                    {isEditing && !isReadOnly ? (
                      <select
                        className="ssis-var-select"
                        value={v.namespace}
                        onChange={(e) => handleUpdate(v.id, 'namespace', e.target.value)}
                      >
                        <option value="User">User</option>
                        <option value="System">System</option>
                      </select>
                    ) : (
                      <span>{v.namespace}</span>
                    )}
                  </td>
                  <td>
                    {isEditing && !isReadOnly ? (
                      <select
                        className="ssis-var-select"
                        value={v.dataType}
                        onChange={(e) => handleUpdate(v.id, 'dataType', e.target.value)}
                      >
                        {DATA_TYPES.map((dt) => (
                          <option key={dt} value={dt}>
                            {dt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{v.dataType}</span>
                    )}
                  </td>
                  <td>
                    {isEditing && !isReadOnly ? (
                      <input
                        type="text"
                        className="ssis-var-input"
                        value={String(v.value ?? '')}
                        onChange={(e) => handleUpdate(v.id, 'value', e.target.value)}
                      />
                    ) : (
                      <span onDoubleClick={() => !isReadOnly && setEditingId(v.id)}>
                        {String(v.value ?? '')}
                      </span>
                    )}
                  </td>
                  <td>
                    {isEditing && !isReadOnly ? (
                      <div className="ssis-var-expression-cell">
                        <input
                          type="text"
                          className="ssis-var-input"
                          value={v.expression ?? ''}
                          onChange={(e) => handleUpdate(v.id, 'expression', e.target.value)}
                          placeholder="Expression…"
                        />
                        <label className="ssis-var-expression-toggle" title="Evaluate as expression">
                          <input
                            type="checkbox"
                            checked={v.evaluateAsExpression}
                            onChange={(e) => handleUpdate(v.id, 'evaluateAsExpression', e.target.checked)}
                          />
                          fx
                        </label>
                      </div>
                    ) : (
                      <span onDoubleClick={() => !isReadOnly && setEditingId(v.id)}>
                        {v.expression ? (
                          <span className="ssis-var-expression-preview" title={v.expression}>
                            {v.evaluateAsExpression ? '⚡ ' : ''}{v.expression}
                          </span>
                        ) : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="ssis-var-scope-badge">{scope}</span>
                  </td>
                  <td>
                    <div className="ssis-variables__row-actions">
                      {isReadOnly ? (
                        <span className="ssis-var-btn ssis-var-btn--disabled" title="System variable (read-only)">🔒</span>
                      ) : isEditing ? (
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
                          onClick={() => setEditingId(v.id)}
                          title="Edit"
                        >
                          ✎
                        </button>
                      )}
                      {!isReadOnly && (
                        <button
                          className="ssis-var-btn ssis-var-btn--delete"
                          onClick={() => handleDelete(v.id)}
                          title="Delete"
                        >
                          ✕
                        </button>
                      )}
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

export default VariablePanel;
