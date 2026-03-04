/**
 * EnvironmentEditor – React component for editing SSISDB environment variables.
 *
 * Rendered as a modal/panel inside the webview. Communicates with the extension
 * host via postMessage for CRUD operations.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvironmentVariable {
  variableId: number;
  name: string;
  type: EnvironmentVariableType;
  value: string;
  sensitive: boolean;
  description: string;
  /** Track local state: new, modified, deleted */
  _state?: 'new' | 'modified' | 'deleted';
}

export type EnvironmentVariableType =
  | 'Boolean' | 'Byte' | 'DateTime' | 'Decimal' | 'Double'
  | 'Int16' | 'Int32' | 'Int64' | 'SByte' | 'Single'
  | 'String' | 'UInt32' | 'UInt64';

const ENV_VAR_TYPES: EnvironmentVariableType[] = [
  'Boolean', 'Byte', 'DateTime', 'Decimal', 'Double',
  'Int16', 'Int32', 'Int64', 'SByte', 'Single',
  'String', 'UInt32', 'UInt64',
];

export interface EnvironmentEditorProps {
  visible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// VS Code API helper
// ---------------------------------------------------------------------------

function getVsCodeApi() {
  return (globalThis as any)._vscodeApi as
    | { postMessage(msg: any): void; getState(): any; setState(s: any): void }
    | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let nextTempId = -1;

const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({ visible, onClose }) => {
  const [envName, setEnvName] = useState('');
  const [envDescription, setEnvDescription] = useState('');
  const [folderName, setFolderName] = useState('');
  const [variables, setVariables] = useState<EnvironmentVariable[]>([]);
  const [editingCell, setEditingCell] = useState<{ varId: number; field: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Message handler — receive data from extension host
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadEnvironment':
          setEnvName(msg.environmentName ?? '');
          setEnvDescription(msg.description ?? '');
          setFolderName(msg.folderName ?? '');
          setVariables(
            (msg.variables ?? []).map((v: any) => ({
              ...v,
              _state: undefined,
            })),
          );
          setLoading(false);
          setError(null);
          break;

        case 'environmentSaved':
          setLoading(false);
          if (msg.error) {
            setError(msg.error);
          } else {
            onClose();
          }
          break;

        case 'environmentError':
          setLoading(false);
          setError(msg.error ?? 'Unknown error');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onClose]);

  // -----------------------------------------------------------------------
  // Variable CRUD
  // -----------------------------------------------------------------------

  const addVariable = useCallback(() => {
    const newVar: EnvironmentVariable = {
      variableId: nextTempId--,
      name: `Variable${variables.length + 1}`,
      type: 'String',
      value: '',
      sensitive: false,
      description: '',
      _state: 'new',
    };
    setVariables((prev) => [...prev, newVar]);
  }, [variables.length]);

  const deleteVariable = useCallback((varId: number) => {
    setVariables((prev) =>
      prev.map((v) =>
        v.variableId === varId
          ? v._state === 'new'
            ? null!                       // remove new unsaved variable
            : { ...v, _state: 'deleted' as const }
          : v,
      ).filter(Boolean),
    );
  }, []);

  const updateField = useCallback(
    (varId: number, field: keyof EnvironmentVariable, value: any) => {
      setVariables((prev) =>
        prev.map((v) =>
          v.variableId === varId
            ? { ...v, [field]: value, _state: v._state === 'new' ? 'new' : 'modified' }
            : v,
        ),
      );
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  const handleSave = useCallback(() => {
    setLoading(true);
    setError(null);
    const api = getVsCodeApi();
    api?.postMessage({
      type: 'saveEnvironment',
      folderName,
      environmentName: envName,
      description: envDescription,
      variables: variables.filter((v) => v._state !== 'deleted' || v.variableId > 0),
    });
  }, [folderName, envName, envDescription, variables]);

  // -----------------------------------------------------------------------
  // Active variables (non-deleted)
  // -----------------------------------------------------------------------

  const activeVars = useMemo(
    () => variables.filter((v) => v._state !== 'deleted'),
    [variables],
  );

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!visible) { return null; }

  return (
    <div className="ssis-env-editor-overlay">
      <div className="ssis-env-editor">
        {/* Header */}
        <div className="ssis-env-editor__header">
          <h2 className="ssis-env-editor__title">Environment Editor</h2>
          <button className="ssis-env-editor__close-btn" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Error message */}
        {error && (
          <div className="ssis-env-editor__error">{error}</div>
        )}

        {/* Environment metadata */}
        <div className="ssis-env-editor__meta">
          <label className="ssis-env-editor__label">
            <span>Folder:</span>
            <span className="ssis-env-editor__value">{folderName}</span>
          </label>
          <label className="ssis-env-editor__label">
            <span>Name:</span>
            <input
              className="ssis-env-editor__input"
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
            />
          </label>
          <label className="ssis-env-editor__label">
            <span>Description:</span>
            <input
              className="ssis-env-editor__input"
              value={envDescription}
              onChange={(e) => setEnvDescription(e.target.value)}
            />
          </label>
        </div>

        {/* Variable table */}
        <div className="ssis-env-editor__table-wrapper">
          <table className="ssis-env-editor__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Value</th>
                <th>Sensitive</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activeVars.length === 0 && (
                <tr>
                  <td colSpan={6} className="ssis-env-editor__empty-row">
                    No variables. Click "Add Variable" to create one.
                  </td>
                </tr>
              )}
              {activeVars.map((v) => (
                <tr
                  key={v.variableId}
                  className={`ssis-env-editor__row ${
                    v._state === 'new' ? 'ssis-env-editor__row--new' :
                    v._state === 'modified' ? 'ssis-env-editor__row--modified' : ''
                  }`}
                >
                  {/* Name */}
                  <td>
                    <input
                      className="ssis-env-editor__cell-input"
                      value={v.name}
                      onChange={(e) => updateField(v.variableId, 'name', e.target.value)}
                    />
                  </td>
                  {/* Type */}
                  <td>
                    <select
                      className="ssis-env-editor__cell-select"
                      value={v.type}
                      onChange={(e) =>
                        updateField(v.variableId, 'type', e.target.value as EnvironmentVariableType)
                      }
                    >
                      {ENV_VAR_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  {/* Value */}
                  <td>
                    {v.sensitive ? (
                      <input
                        className="ssis-env-editor__cell-input ssis-env-editor__cell-input--sensitive"
                        type="password"
                        placeholder="•••••"
                        value={v.value}
                        onChange={(e) => updateField(v.variableId, 'value', e.target.value)}
                      />
                    ) : (
                      <input
                        className="ssis-env-editor__cell-input"
                        value={v.value}
                        onChange={(e) => updateField(v.variableId, 'value', e.target.value)}
                      />
                    )}
                  </td>
                  {/* Sensitive */}
                  <td className="ssis-env-editor__cell-center">
                    <input
                      type="checkbox"
                      checked={v.sensitive}
                      onChange={(e) => updateField(v.variableId, 'sensitive', e.target.checked)}
                    />
                  </td>
                  {/* Description */}
                  <td>
                    <input
                      className="ssis-env-editor__cell-input"
                      value={v.description}
                      onChange={(e) => updateField(v.variableId, 'description', e.target.value)}
                    />
                  </td>
                  {/* Delete button */}
                  <td className="ssis-env-editor__cell-center">
                    <button
                      className="ssis-env-editor__delete-btn"
                      onClick={() => deleteVariable(v.variableId)}
                      title="Delete variable"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="ssis-env-editor__footer">
          <button className="ssis-env-editor__btn ssis-env-editor__btn--add" onClick={addVariable}>
            + Add Variable
          </button>
          <div className="ssis-env-editor__footer-right">
            <button
              className="ssis-env-editor__btn ssis-env-editor__btn--cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              className="ssis-env-editor__btn ssis-env-editor__btn--save"
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnvironmentEditor;
