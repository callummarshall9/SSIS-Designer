import React, { useState, useCallback, useMemo } from 'react';
import { useCanvasStore } from './shared/CanvasState';
import { ConnectionManager } from '../models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionType =
  | 'OLEDB'
  | 'ADO.NET'
  | 'FLATFILE'
  | 'EXCEL'
  | 'FILE'
  | 'FTP'
  | 'HTTP'
  | 'SMTP'
  | 'MSOLAP';

interface OleDbFields {
  server: string;
  database: string;
  authentication: 'Windows' | 'SQL';
  username: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

interface FlatFileFields {
  filePath: string;
  columnDelimiter: string;
  textQualifier: string;
  headerRowDelimiter: string;
  hasHeaderRow: boolean;
}

interface ExcelFields {
  filePath: string;
  excelVersion: 'Excel 97-2003' | 'Excel 2007+';
  firstRowHasHeaders: boolean;
}

interface AdoNetFields {
  server: string;
  database: string;
  provider: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

interface RawFields {
  connectionString: string;
}

type ConnectionFields = OleDbFields | FlatFileFields | ExcelFields | AdoNetFields | RawFields;

interface EditingConnection {
  id: string;
  name: string;
  description: string;
  type: ConnectionType;
  fields: ConnectionFields;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONNECTION_TYPES: { value: ConnectionType; label: string; icon: string }[] = [
  { value: 'OLEDB', label: 'OLE DB', icon: '🗄️' },
  { value: 'ADO.NET', label: 'ADO.NET', icon: '🔗' },
  { value: 'FLATFILE', label: 'Flat File', icon: '📄' },
  { value: 'EXCEL', label: 'Excel', icon: '📊' },
  { value: 'FILE', label: 'File', icon: '📁' },
  { value: 'FTP', label: 'FTP', icon: '🌐' },
  { value: 'HTTP', label: 'HTTP', icon: '🌍' },
  { value: 'SMTP', label: 'SMTP', icon: '📧' },
  { value: 'MSOLAP', label: 'MSOLAP (Analysis Services)', icon: '📈' },
];

const ADO_NET_PROVIDERS = [
  'System.Data.SqlClient',
  'System.Data.OleDb',
  'System.Data.Odbc',
  'System.Data.OracleClient',
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

function defaultFieldsForType(type: ConnectionType): ConnectionFields {
  switch (type) {
    case 'OLEDB':
      return { server: '', database: '', authentication: 'Windows', username: '', password: '', encrypt: true, trustServerCertificate: false } as OleDbFields;
    case 'FLATFILE':
      return { filePath: '', columnDelimiter: ',', textQualifier: '"', headerRowDelimiter: '\\r\\n', hasHeaderRow: true } as FlatFileFields;
    case 'EXCEL':
      return { filePath: '', excelVersion: 'Excel 2007+', firstRowHasHeaders: true } as ExcelFields;
    case 'ADO.NET':
      return { server: '', database: '', provider: 'System.Data.SqlClient', encrypt: true, trustServerCertificate: false } as AdoNetFields;
    default:
      return { connectionString: '' } as RawFields;
  }
}

function buildConnectionString(type: ConnectionType, fields: ConnectionFields): string {
  switch (type) {
    case 'OLEDB': {
      const f = fields as OleDbFields;
      const parts = [
        'Provider=MSOLEDBSQL',
        `Data Source=${f.server}`,
        `Initial Catalog=${f.database}`,
      ];
      if (f.authentication === 'Windows') {
        parts.push('Integrated Security=SSPI');
      } else {
        parts.push(`User ID=${f.username}`, `Password=${f.password}`);
      }
      parts.push(`Encrypt=${f.encrypt ? 'yes' : 'no'}`);
      parts.push(`TrustServerCertificate=${f.trustServerCertificate ? 'yes' : 'no'}`);
      return parts.join(';') + ';';
    }
    case 'FLATFILE': {
      const f = fields as FlatFileFields;
      const parts = [`ConnectionString=${f.filePath}`];
      if (f.columnDelimiter) { parts.push(`ColumnDelimiter=${f.columnDelimiter}`); }
      if (f.textQualifier) { parts.push(`TextQualifier=${f.textQualifier}`); }
      if (f.hasHeaderRow) { parts.push('HeaderRowPresent=true'); }
      return parts.join(';') + ';';
    }
    case 'EXCEL': {
      const f = fields as ExcelFields;
      const provider =
        f.excelVersion === 'Excel 97-2003'
          ? 'Microsoft.Jet.OLEDB.4.0'
          : 'Microsoft.ACE.OLEDB.12.0';
      const extended =
        f.excelVersion === 'Excel 97-2003' ? 'Excel 8.0' : 'Excel 12.0 Xml';
      const hdr = f.firstRowHasHeaders ? 'YES' : 'NO';
      return `Provider=${provider};Data Source=${f.filePath};Extended Properties="${extended};HDR=${hdr}";`;
    }
    case 'ADO.NET': {
      const f = fields as AdoNetFields;
      return `Data Source=${f.server};Initial Catalog=${f.database};Provider=${f.provider};Integrated Security=SSPI;Encrypt=${f.encrypt ? 'yes' : 'no'};TrustServerCertificate=${f.trustServerCertificate ? 'yes' : 'no'};`;
    }
    default: {
      return (fields as RawFields).connectionString ?? '';
    }
  }
}

function parseConnectionStringToEditing(cm: ConnectionManager): EditingConnection {
  const type = cm.creationName as ConnectionType;
  return {
    id: cm.id,
    name: cm.objectName,
    description: cm.description,
    type,
    fields: defaultFieldsForType(type),
  };
}

// ---------------------------------------------------------------------------
// Sub-components: Type-specific forms
// ---------------------------------------------------------------------------

interface FieldEditorProps<T> {
  fields: T;
  onChange: (updates: Partial<T>) => void;
}

const OleDbEditor: React.FC<FieldEditorProps<OleDbFields>> = ({ fields, onChange }) => (
  <div className="ssis-cm-fields">
    <div className="ssis-cm-field">
      <label>Server</label>
      <input
        type="text"
        value={fields.server}
        onChange={(e) => onChange({ server: e.target.value })}
        placeholder="localhost"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Database</label>
      <input
        type="text"
        value={fields.database}
        onChange={(e) => onChange({ database: e.target.value })}
        placeholder="master"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Authentication</label>
      <select
        value={fields.authentication}
        onChange={(e) => onChange({ authentication: e.target.value as 'Windows' | 'SQL' })}
      >
        <option value="Windows">Windows Authentication</option>
        <option value="SQL">SQL Server Authentication</option>
      </select>
    </div>
    {fields.authentication === 'SQL' && (
      <>
        <div className="ssis-cm-field">
          <label>Username</label>
          <input
            type="text"
            value={fields.username}
            onChange={(e) => onChange({ username: e.target.value })}
          />
        </div>
        <div className="ssis-cm-field">
          <label>Password</label>
          <input
            type="password"
            value={fields.password}
            onChange={(e) => onChange({ password: e.target.value })}
          />
        </div>
      </>
    )}
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.encrypt}
          onChange={(e) => onChange({ encrypt: e.target.checked })}
        />
        Encrypt connection
      </label>
    </div>
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.trustServerCertificate}
          onChange={(e) => onChange({ trustServerCertificate: e.target.checked })}
        />
        Trust server certificate
      </label>
    </div>
  </div>
);

const FlatFileEditor: React.FC<FieldEditorProps<FlatFileFields>> = ({ fields, onChange }) => (
  <div className="ssis-cm-fields">
    <div className="ssis-cm-field">
      <label>File Path</label>
      <input
        type="text"
        value={fields.filePath}
        onChange={(e) => onChange({ filePath: e.target.value })}
        placeholder="/path/to/data.csv"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Column Delimiter</label>
      <select
        value={fields.columnDelimiter}
        onChange={(e) => onChange({ columnDelimiter: e.target.value })}
      >
        <option value=",">Comma (,)</option>
        <option value="&#9;">Tab</option>
        <option value="|">Pipe (|)</option>
        <option value=";">Semicolon (;)</option>
      </select>
    </div>
    <div className="ssis-cm-field">
      <label>Text Qualifier</label>
      <select
        value={fields.textQualifier}
        onChange={(e) => onChange({ textQualifier: e.target.value })}
      >
        <option value={'"'}>Double Quote (")</option>
        <option value="'">Single Quote (')</option>
        <option value="">None</option>
      </select>
    </div>
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.hasHeaderRow}
          onChange={(e) => onChange({ hasHeaderRow: e.target.checked })}
        />
        First row is header
      </label>
    </div>
  </div>
);

const ExcelEditor: React.FC<FieldEditorProps<ExcelFields>> = ({ fields, onChange }) => (
  <div className="ssis-cm-fields">
    <div className="ssis-cm-field">
      <label>File Path</label>
      <input
        type="text"
        value={fields.filePath}
        onChange={(e) => onChange({ filePath: e.target.value })}
        placeholder="/path/to/workbook.xlsx"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Excel Version</label>
      <select
        value={fields.excelVersion}
        onChange={(e) => onChange({ excelVersion: e.target.value as ExcelFields['excelVersion'] })}
      >
        <option value="Excel 97-2003">Excel 97-2003 (.xls)</option>
        <option value="Excel 2007+">Excel 2007+ (.xlsx)</option>
      </select>
    </div>
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.firstRowHasHeaders}
          onChange={(e) => onChange({ firstRowHasHeaders: e.target.checked })}
        />
        First row has column names
      </label>
    </div>
  </div>
);

const AdoNetEditor: React.FC<FieldEditorProps<AdoNetFields>> = ({ fields, onChange }) => (
  <div className="ssis-cm-fields">
    <div className="ssis-cm-field">
      <label>Server</label>
      <input
        type="text"
        value={fields.server}
        onChange={(e) => onChange({ server: e.target.value })}
        placeholder="localhost"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Database</label>
      <input
        type="text"
        value={fields.database}
        onChange={(e) => onChange({ database: e.target.value })}
        placeholder="master"
      />
    </div>
    <div className="ssis-cm-field">
      <label>Provider</label>
      <select
        value={fields.provider}
        onChange={(e) => onChange({ provider: e.target.value })}
      >
        {ADO_NET_PROVIDERS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
    </div>
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.encrypt}
          onChange={(e) => onChange({ encrypt: e.target.checked })}
        />
        Encrypt connection
      </label>
    </div>
    <div className="ssis-cm-field ssis-cm-field--checkbox">
      <label>
        <input
          type="checkbox"
          checked={fields.trustServerCertificate}
          onChange={(e) => onChange({ trustServerCertificate: e.target.checked })}
        />
        Trust server certificate
      </label>
    </div>
  </div>
);

const RawEditor: React.FC<FieldEditorProps<RawFields>> = ({ fields, onChange }) => (
  <div className="ssis-cm-fields">
    <div className="ssis-cm-field">
      <label>Connection String</label>
      <textarea
        value={fields.connectionString}
        onChange={(e) => onChange({ connectionString: e.target.value })}
        placeholder="Enter connection string..."
        rows={4}
      />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Field Editor Router
// ---------------------------------------------------------------------------

const FieldsEditor: React.FC<{
  type: ConnectionType;
  fields: ConnectionFields;
  onChange: (updates: Partial<ConnectionFields>) => void;
}> = ({ type, fields, onChange }) => {
  switch (type) {
    case 'OLEDB':
      return <OleDbEditor fields={fields as OleDbFields} onChange={onChange as any} />;
    case 'FLATFILE':
      return <FlatFileEditor fields={fields as FlatFileFields} onChange={onChange as any} />;
    case 'EXCEL':
      return <ExcelEditor fields={fields as ExcelFields} onChange={onChange as any} />;
    case 'ADO.NET':
      return <AdoNetEditor fields={fields as AdoNetFields} onChange={onChange as any} />;
    default:
      return <RawEditor fields={fields as RawFields} onChange={onChange as any} />;
  }
};

// ---------------------------------------------------------------------------
// Connection Manager Panel
// ---------------------------------------------------------------------------

export interface ConnectionManagerPanelProps {
  visible: boolean;
  onClose: () => void;
}

const ConnectionManagerPanel: React.FC<ConnectionManagerPanelProps> = ({ visible, onClose }) => {
  const connectionManagers = useCanvasStore((s) => s.connectionManagers);
  const addConnectionManager = useCanvasStore((s) => s.addConnectionManager);
  const removeConnectionManager = useCanvasStore((s) => s.removeConnectionManager);
  const updateConnectionManager = useCanvasStore((s) => s.updateConnectionManager);

  const [editing, setEditing] = useState<EditingConnection | null>(null);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failure'>('idle');
  const [testError, setTestError] = useState<string>('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const previewConnectionString = useMemo(() => {
    if (!editing) { return ''; }
    return buildConnectionString(editing.type, editing.fields);
  }, [editing]);

  // Post message to extension host
  const postMessage = useCallback((msg: any) => {
    try {
      const api = (globalThis as any)._vscodeApi;
      api?.postMessage(msg);
    } catch { /* not in webview */ }
  }, []);

  const handleAdd = useCallback((type: ConnectionType) => {
    const id = newGuid();
    setEditing({
      id,
      name: `New ${type} Connection`,
      description: '',
      type,
      fields: defaultFieldsForType(type),
    });
    setAddMenuOpen(false);
    setTestStatus('idle');
    setTestError('');
  }, []);

  const handleEdit = useCallback((cm: ConnectionManager) => {
    const ed = parseConnectionStringToEditing(cm);
    ed.name = cm.objectName;
    ed.description = cm.description;
    setEditing(ed);
    setTestStatus('idle');
    setTestError('');
  }, []);

  const handleDelete = useCallback((id: string) => {
    removeConnectionManager(id);
    postMessage({ type: 'removeConnectionManager', connectionManagerId: id });
    if (editing?.id === id) {
      setEditing(null);
    }
  }, [removeConnectionManager, postMessage, editing]);

  const handleFieldChange = useCallback((updates: Partial<ConnectionFields>) => {
    if (!editing) { return; }
    setEditing({
      ...editing,
      fields: { ...editing.fields, ...updates } as ConnectionFields,
    });
  }, [editing]);

  const handleTestConnection = useCallback(() => {
    if (!editing) { return; }
    const connStr = buildConnectionString(editing.type, editing.fields);
    setTestStatus('testing');
    setTestError('');

    // Listen for test result
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'testConnectionResult') {
        window.removeEventListener('message', handler);
        if (msg.success) {
          setTestStatus('success');
        } else {
          setTestStatus('failure');
          setTestError(msg.error ?? 'Connection failed');
        }
      }
    };
    window.addEventListener('message', handler);

    postMessage({
      type: 'testConnection',
      connectionString: connStr,
      connectionType: editing.type,
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler);
      setTestStatus((prev) => (prev === 'testing' ? 'failure' : prev));
      setTestError((prev) => prev || 'Connection test timed out');
    }, 30000);
  }, [editing, postMessage]);

  const handleSave = useCallback(() => {
    if (!editing) { return; }
    const connStr = buildConnectionString(editing.type, editing.fields);
    const cm: ConnectionManager = {
      id: editing.id,
      dtsId: editing.id,
      objectName: editing.name,
      connectionString: connStr,
      creationName: editing.type,
      description: editing.description,
      properties: {},
      unknownElements: [],
    };

    const existing = connectionManagers.find(c => c.id === editing.id);
    if (existing) {
      updateConnectionManager(editing.id, cm);
      postMessage({ type: 'updateConnectionManager', connectionManager: cm });
    } else {
      addConnectionManager(cm);
      postMessage({ type: 'addConnectionManager', connectionManager: cm });
    }
    setEditing(null);
    setTestStatus('idle');
  }, [editing, connectionManagers, addConnectionManager, updateConnectionManager, postMessage]);

  const handleCancel = useCallback(() => {
    setEditing(null);
    setTestStatus('idle');
    setTestError('');
  }, []);

  if (!visible) { return null; }

  return (
    <div className="ssis-cm-overlay" onClick={onClose}>
      <div className="ssis-cm-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="ssis-cm-panel__header">
          <span className="ssis-cm-panel__title">Connection Managers</span>
          <button className="ssis-cm-panel__close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="ssis-cm-panel__body">
          {/* Left: Connection list */}
          <div className="ssis-cm-list">
            <div className="ssis-cm-list__header">
              <span>Connections</span>
              <div className="ssis-cm-list__add-wrapper">
                <button
                  className="ssis-cm-list__add-btn"
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                  title="Add Connection"
                >
                  +
                </button>
                {addMenuOpen && (
                  <div className="ssis-cm-list__add-menu">
                    {CONNECTION_TYPES.map((ct) => (
                      <button
                        key={ct.value}
                        className="ssis-cm-list__add-menu-item"
                        onClick={() => handleAdd(ct.value)}
                      >
                        <span className="ssis-cm-list__add-menu-icon">{ct.icon}</span>
                        {ct.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ssis-cm-list__items">
              {connectionManagers.length === 0 && (
                <div className="ssis-cm-list__empty">No connection managers</div>
              )}
              {connectionManagers.map((cm) => {
                const typeInfo = CONNECTION_TYPES.find(t => t.value === cm.creationName);
                return (
                  <div
                    key={cm.id}
                    className={`ssis-cm-list__item ${editing?.id === cm.id ? 'ssis-cm-list__item--active' : ''}`}
                    onClick={() => handleEdit(cm)}
                  >
                    <span className="ssis-cm-list__item-icon">{typeInfo?.icon ?? '🔗'}</span>
                    <div className="ssis-cm-list__item-info">
                      <span className="ssis-cm-list__item-name">{cm.objectName}</span>
                      <span className="ssis-cm-list__item-type">{typeInfo?.label ?? cm.creationName}</span>
                    </div>
                    <button
                      className="ssis-cm-list__item-delete"
                      onClick={(e) => { e.stopPropagation(); handleDelete(cm.id); }}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Editor */}
          <div className="ssis-cm-editor">
            {!editing ? (
              <div className="ssis-cm-editor__empty">
                <span>Select a connection manager to edit, or add a new one.</span>
              </div>
            ) : (
              <div className="ssis-cm-editor__form">
                <div className="ssis-cm-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div className="ssis-cm-field">
                  <label>Description</label>
                  <input
                    type="text"
                    value={editing.description}
                    onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
                <div className="ssis-cm-field">
                  <label>Type</label>
                  <select
                    value={editing.type}
                    onChange={(e) => {
                      const newType = e.target.value as ConnectionType;
                      setEditing({
                        ...editing,
                        type: newType,
                        fields: defaultFieldsForType(newType),
                      });
                    }}
                  >
                    {CONNECTION_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ssis-cm-editor__divider" />

                <FieldsEditor
                  type={editing.type}
                  fields={editing.fields}
                  onChange={handleFieldChange}
                />

                {/* Connection string preview */}
                <div className="ssis-cm-preview">
                  <label>Connection String Preview</label>
                  <code className="ssis-cm-preview__value">{previewConnectionString}</code>
                </div>

                {/* Test connection */}
                <div className="ssis-cm-test">
                  <button
                    className={`ssis-cm-test__btn ssis-cm-test__btn--${testStatus}`}
                    onClick={handleTestConnection}
                    disabled={testStatus === 'testing'}
                  >
                    {testStatus === 'testing'
                      ? 'Testing…'
                      : testStatus === 'success'
                        ? '✓ Connected'
                        : testStatus === 'failure'
                          ? '✕ Failed'
                          : 'Test Connection'}
                  </button>
                  {testStatus === 'failure' && testError && (
                    <span className="ssis-cm-test__error">{testError}</span>
                  )}
                  {testStatus === 'success' && (
                    <span className="ssis-cm-test__success">Connection successful!</span>
                  )}
                </div>

                {/* Actions */}
                <div className="ssis-cm-editor__actions">
                  <button className="ssis-cm-btn ssis-cm-btn--primary" onClick={handleSave}>
                    Save
                  </button>
                  <button className="ssis-cm-btn ssis-cm-btn--secondary" onClick={handleCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionManagerPanel;
