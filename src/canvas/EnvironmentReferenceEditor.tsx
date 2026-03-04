/**
 * EnvironmentReferenceEditor – React component for managing project-environment
 * references in SSISDB.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvironmentReference {
  referenceId: number;
  projectId: number;
  environmentName: string;
  environmentFolderName: string | null;
  referenceType: 'R' | 'A'; // Relative or Absolute
}

export interface AvailableEnvironment {
  name: string;
  folderName: string;
}

export interface EnvironmentReferenceEditorProps {
  visible: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// VS Code API helper
// ---------------------------------------------------------------------------

function getVsCodeApi() {
  return (globalThis as any)._vscodeApi as
    | { postMessage(msg: any): void }
    | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EnvironmentReferenceEditor: React.FC<EnvironmentReferenceEditorProps> = ({
  visible,
  onClose,
}) => {
  const [projectName, setProjectName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [references, setReferences] = useState<EnvironmentReference[]>([]);
  const [availableEnvs, setAvailableEnvs] = useState<AvailableEnvironment[]>([]);
  const [selectedEnv, setSelectedEnv] = useState('');
  const [selectedEnvFolder, setSelectedEnvFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Message handler
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'loadEnvironmentReferences':
          setProjectName(msg.projectName ?? '');
          setFolderName(msg.folderName ?? '');
          setReferences(msg.references ?? []);
          setAvailableEnvs(msg.availableEnvironments ?? []);
          setLoading(false);
          setError(null);
          break;

        case 'environmentReferenceAdded':
          if (msg.error) {
            setError(msg.error);
          } else {
            // Refresh references
            const api = getVsCodeApi();
            api?.postMessage({
              type: 'getEnvironmentReferences',
              projectName,
              folderName,
            });
          }
          setLoading(false);
          break;

        case 'environmentReferenceRemoved':
          if (msg.error) {
            setError(msg.error);
          } else {
            setReferences((prev) =>
              prev.filter((r) => r.referenceId !== msg.referenceId),
            );
          }
          setLoading(false);
          break;

        case 'environmentRefError':
          setLoading(false);
          setError(msg.error ?? 'Unknown error');
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [projectName, folderName]);

  // -----------------------------------------------------------------------
  // Add reference
  // -----------------------------------------------------------------------

  const handleAddReference = useCallback(() => {
    if (!selectedEnv) { return; }
    setLoading(true);
    setError(null);
    const api = getVsCodeApi();
    api?.postMessage({
      type: 'addEnvironmentReference',
      projectName,
      folderName,
      environmentName: selectedEnv,
      environmentFolderName: selectedEnvFolder || undefined,
    });
  }, [projectName, folderName, selectedEnv, selectedEnvFolder]);

  // -----------------------------------------------------------------------
  // Remove reference
  // -----------------------------------------------------------------------

  const handleRemoveReference = useCallback((referenceId: number) => {
    setLoading(true);
    setError(null);
    const api = getVsCodeApi();
    api?.postMessage({
      type: 'removeEnvironmentReference',
      referenceId,
    });
  }, []);

  // -----------------------------------------------------------------------
  // Unreferenced environments
  // -----------------------------------------------------------------------

  const unreferencedEnvs = useMemo(() => {
    const refNames = new Set(references.map((r) => `${r.environmentFolderName ?? ''}|${r.environmentName}`));
    return availableEnvs.filter(
      (e) => !refNames.has(`${e.folderName}|${e.name}`),
    );
  }, [availableEnvs, references]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!visible) { return null; }

  return (
    <div className="ssis-envref-editor-overlay">
      <div className="ssis-envref-editor">
        {/* Header */}
        <div className="ssis-envref-editor__header">
          <h2 className="ssis-envref-editor__title">
            Environment References: {projectName}
          </h2>
          <button className="ssis-envref-editor__close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Error */}
        {error && <div className="ssis-envref-editor__error">{error}</div>}

        {/* Current references */}
        <div className="ssis-envref-editor__section">
          <h3 className="ssis-envref-editor__section-title">Current References</h3>
          {references.length === 0 ? (
            <p className="ssis-envref-editor__empty">No environment references configured.</p>
          ) : (
            <table className="ssis-envref-editor__table">
              <thead>
                <tr>
                  <th>Environment</th>
                  <th>Folder</th>
                  <th>Type</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {references.map((ref) => (
                  <tr key={ref.referenceId}>
                    <td>{ref.environmentName}</td>
                    <td>{ref.environmentFolderName ?? '(same folder)'}</td>
                    <td>{ref.referenceType === 'R' ? 'Relative' : 'Absolute'}</td>
                    <td className="ssis-envref-editor__cell-center">
                      <button
                        className="ssis-envref-editor__remove-btn"
                        onClick={() => handleRemoveReference(ref.referenceId)}
                        disabled={loading}
                        title="Remove reference"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Add reference */}
        <div className="ssis-envref-editor__section">
          <h3 className="ssis-envref-editor__section-title">Add Reference</h3>
          <div className="ssis-envref-editor__add-row">
            <select
              className="ssis-envref-editor__select"
              value={selectedEnv}
              onChange={(e) => {
                setSelectedEnv(e.target.value);
                const env = unreferencedEnvs.find((a) => a.name === e.target.value);
                if (env) { setSelectedEnvFolder(env.folderName); }
              }}
            >
              <option value="">Select environment…</option>
              {unreferencedEnvs.map((env) => (
                <option key={`${env.folderName}|${env.name}`} value={env.name}>
                  {env.name} ({env.folderName})
                </option>
              ))}
            </select>
            <button
              className="ssis-envref-editor__btn ssis-envref-editor__btn--add"
              onClick={handleAddReference}
              disabled={!selectedEnv || loading}
            >
              + Add
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="ssis-envref-editor__footer">
          <button
            className="ssis-envref-editor__btn ssis-envref-editor__btn--close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnvironmentReferenceEditor;
