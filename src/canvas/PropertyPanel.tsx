import React, { useState, useCallback, useMemo } from 'react';
import { useCanvasStore } from './shared/CanvasState';
import { SsisExecutable, PrecedenceConstraint } from '../models/SsisPackageModel';
import { Node, Edge } from 'reactflow';

// ---------------------------------------------------------------------------
// Property definition types
// ---------------------------------------------------------------------------

export interface PropertyDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'enum' | 'multiline' | 'connection' | 'expression';
  section: string;
  options?: { label: string; value: string }[];
  description?: string;
}

// ---------------------------------------------------------------------------
// Task property schemas
// ---------------------------------------------------------------------------

const generalProperties: PropertyDefinition[] = [
  { key: 'objectName', label: 'Name', type: 'text', section: 'General', description: 'Task display name' },
  { key: 'description', label: 'Description', type: 'multiline', section: 'General', description: 'Task description' },
];

export const taskPropertySchemas: Record<string, PropertyDefinition[]> = {
  'Microsoft.ExecuteSQLTask': [
    ...generalProperties,
    { key: 'ConnectionName', label: 'Connection', type: 'connection', section: 'Connection', description: 'Connection manager to use' },
    { key: 'SQLTask.SqlStatementSource', label: 'SQL Statement', type: 'multiline', section: 'SQL', description: 'SQL statement to execute' },
    { key: 'SQLTask.SqlStatementSourceType', label: 'Source Type', type: 'enum', section: 'SQL', options: [
      { label: 'Direct Input', value: 'DirectInput' },
      { label: 'File Connection', value: 'FileConnection' },
      { label: 'Variable', value: 'Variable' },
    ], description: 'Source type for the SQL statement' },
    { key: 'SQLTask.ResultSetType', label: 'Result Set', type: 'enum', section: 'SQL', options: [
      { label: 'None', value: 'ResultSetType_None' },
      { label: 'Single Row', value: 'ResultSetType_SingleRow' },
      { label: 'Full Result Set', value: 'ResultSetType_Rowset' },
      { label: 'XML', value: 'ResultSetType_XML' },
    ], description: 'Result set type' },
    { key: 'SQLTask.IsStoredProcedure', label: 'Is Stored Procedure', type: 'boolean', section: 'SQL', description: 'Whether the statement is a stored procedure' },
    { key: 'SQLTask.TimeOut', label: 'Timeout (seconds)', type: 'number', section: 'SQL', description: 'Command timeout in seconds' },
    { key: 'SQLTask.CodePage', label: 'Code Page', type: 'number', section: 'SQL', description: 'Code page for character data' },
    { key: 'SQLTask.BypassPrepare', label: 'Bypass Prepare', type: 'boolean', section: 'SQL', description: 'Bypass the prepare step' },
  ],

  'Microsoft.Pipeline': [
    ...generalProperties,
    { key: 'DefaultBufferMaxRows', label: 'Default Buffer Max Rows', type: 'number', section: 'Buffer', description: 'Maximum rows per buffer' },
    { key: 'DefaultBufferSize', label: 'Default Buffer Size', type: 'number', section: 'Buffer', description: 'Default buffer size in bytes' },
    { key: 'EngineThreads', label: 'Engine Threads', type: 'number', section: 'Performance', description: 'Number of engine threads' },
    { key: 'BLOBTempStoragePath', label: 'BLOB Temp Path', type: 'text', section: 'Performance', description: 'Temp storage path for BLOB data' },
    { key: 'RunInOptimizedMode', label: 'Run in Optimized Mode', type: 'boolean', section: 'Performance', description: 'Run in optimized mode' },
  ],

  'STOCK:FORLOOP': [
    ...generalProperties,
    { key: 'InitExpression', label: 'Init Expression', type: 'expression', section: 'Loop', description: 'Initialization expression' },
    { key: 'EvalExpression', label: 'Eval Expression', type: 'expression', section: 'Loop', description: 'Evaluation expression (loop condition)' },
    { key: 'AssignExpression', label: 'Assign Expression', type: 'expression', section: 'Loop', description: 'Assignment expression (increment)' },
  ],

  'STOCK:FOREACHLOOP': [
    ...generalProperties,
    { key: 'EnumeratorType', label: 'Enumerator Type', type: 'enum', section: 'Collection', options: [
      { label: 'File Enumerator', value: 'ForEachFile' },
      { label: 'Item Enumerator', value: 'ForEachItem' },
      { label: 'ADO Enumerator', value: 'ForEachADO' },
      { label: 'ADO.NET Schema Rowset', value: 'ForEachADONETSchema' },
      { label: 'From Variable Enumerator', value: 'ForEachFromVar' },
      { label: 'NodeList Enumerator', value: 'ForEachNodeList' },
      { label: 'SMO Enumerator', value: 'ForEachSMO' },
    ], description: 'Type of enumerator to use' },
    { key: 'FolderPath', label: 'Folder', type: 'text', section: 'Collection', description: 'Folder path (for file enumerator)' },
    { key: 'FileSpec', label: 'Files', type: 'text', section: 'Collection', description: 'File specification (e.g., *.csv)' },
  ],

  'STOCK:SEQUENCE': [
    ...generalProperties,
  ],

  'Microsoft.ScriptTask': [
    ...generalProperties,
    { key: 'ScriptLanguage', label: 'Script Language', type: 'enum', section: 'Script', options: [
      { label: 'C#', value: 'CSharp' },
      { label: 'Visual Basic', value: 'VisualBasic' },
    ], description: 'Script language' },
    { key: 'EntryPoint', label: 'Entry Point', type: 'text', section: 'Script', description: 'Script entry point method' },
    { key: 'ReadOnlyVariables', label: 'Read-Only Variables', type: 'text', section: 'Script', description: 'Comma-separated read-only variable names' },
    { key: 'ReadWriteVariables', label: 'Read/Write Variables', type: 'text', section: 'Script', description: 'Comma-separated read/write variable names' },
  ],

  'Microsoft.ExecutePackageTask': [
    ...generalProperties,
    { key: 'PackageName', label: 'Package Name', type: 'text', section: 'Package', description: 'Name of the child package' },
    { key: 'ConnectionName', label: 'Connection', type: 'connection', section: 'Package', description: 'Connection to the child package' },
    { key: 'ExecuteOutOfProcess', label: 'Execute Out of Process', type: 'boolean', section: 'Package', description: 'Run the child package in a separate process' },
  ],

  'Microsoft.ExecuteProcess': [
    ...generalProperties,
    { key: 'Executable', label: 'Executable', type: 'text', section: 'Process', description: 'Path to executable' },
    { key: 'Arguments', label: 'Arguments', type: 'text', section: 'Process', description: 'Command-line arguments' },
    { key: 'WorkingDirectory', label: 'Working Directory', type: 'text', section: 'Process', description: 'Working directory' },
    { key: 'WindowStyle', label: 'Window Style', type: 'enum', section: 'Process', options: [
      { label: 'Normal', value: 'Normal' },
      { label: 'Hidden', value: 'Hidden' },
      { label: 'Minimized', value: 'Minimized' },
    ] },
    { key: 'RequireFullFileName', label: 'Require Full File Name', type: 'boolean', section: 'Process' },
    { key: 'FailTaskIfReturnCodeIsNotSuccessValue', label: 'Fail on Non-Zero Exit', type: 'boolean', section: 'Process' },
    { key: 'SuccessValue', label: 'Success Value', type: 'number', section: 'Process' },
    { key: 'TimeOut', label: 'Timeout (seconds)', type: 'number', section: 'Process' },
  ],

  'Microsoft.ExpressionTask': [
    ...generalProperties,
    { key: 'Expression', label: 'Expression', type: 'expression', section: 'Expression', description: 'SSIS expression to evaluate' },
  ],

  'Microsoft.FileSystemTask': [
    ...generalProperties,
    { key: 'Operation', label: 'Operation', type: 'enum', section: 'File System', options: [
      { label: 'Copy File', value: 'CopyFile' },
      { label: 'Move File', value: 'MoveFile' },
      { label: 'Delete File', value: 'DeleteFile' },
      { label: 'Create Directory', value: 'CreateDirectory' },
      { label: 'Copy Directory', value: 'CopyDirectory' },
      { label: 'Move Directory', value: 'MoveDirectory' },
      { label: 'Delete Directory', value: 'DeleteDirectory' },
      { label: 'Rename File', value: 'RenameFile' },
      { label: 'Set Attributes', value: 'SetAttributes' },
    ] },
    { key: 'SourceConnection', label: 'Source Connection', type: 'connection', section: 'File System' },
    { key: 'DestinationConnection', label: 'Destination Connection', type: 'connection', section: 'File System' },
    { key: 'OverwriteDestination', label: 'Overwrite Destination', type: 'boolean', section: 'File System' },
  ],

  'Microsoft.SendMailTask': [
    ...generalProperties,
    { key: 'SmtpConnection', label: 'SMTP Connection', type: 'connection', section: 'Mail' },
    { key: 'From', label: 'From', type: 'text', section: 'Mail' },
    { key: 'To', label: 'To', type: 'text', section: 'Mail' },
    { key: 'Subject', label: 'Subject', type: 'text', section: 'Mail' },
    { key: 'MessageSource', label: 'Message', type: 'multiline', section: 'Mail' },
    { key: 'Priority', label: 'Priority', type: 'enum', section: 'Mail', options: [
      { label: 'Low', value: 'Low' },
      { label: 'Normal', value: 'Normal' },
      { label: 'High', value: 'High' },
    ] },
  ],

  'Microsoft.FtpTask': [
    ...generalProperties,
    { key: 'FtpConnection', label: 'FTP Connection', type: 'connection', section: 'FTP' },
    { key: 'Operation', label: 'Operation', type: 'enum', section: 'FTP', options: [
      { label: 'Send Files', value: 'Send' },
      { label: 'Receive Files', value: 'Receive' },
      { label: 'Create Local Directory', value: 'CreateLocalDir' },
      { label: 'Create Remote Directory', value: 'CreateRemoteDir' },
      { label: 'Remove Local Directory', value: 'RemoveLocalDir' },
      { label: 'Remove Remote Directory', value: 'RemoveRemoteDir' },
      { label: 'Delete Local Files', value: 'DeleteLocal' },
      { label: 'Delete Remote Files', value: 'DeleteRemote' },
    ] },
    { key: 'LocalPath', label: 'Local Path', type: 'text', section: 'FTP' },
    { key: 'RemotePath', label: 'Remote Path', type: 'text', section: 'FTP' },
    { key: 'OverwriteDestination', label: 'Overwrite', type: 'boolean', section: 'FTP' },
  ],
};

// ---------------------------------------------------------------------------
// Constraint property schema
// ---------------------------------------------------------------------------

const constraintPropertySchema: PropertyDefinition[] = [
  { key: 'constraintType', label: 'Constraint Type', type: 'enum', section: 'Constraint', options: [
    { label: 'Success', value: 'Success' },
    { label: 'Failure', value: 'Failure' },
    { label: 'Completion', value: 'Completion' },
    { label: 'Expression', value: 'Expression' },
  ], description: 'Type of precedence constraint' },
  { key: 'expression', label: 'Expression', type: 'expression', section: 'Constraint', description: 'SSIS expression for Expression constraint type' },
  { key: 'logicalAnd', label: 'Multiple constraint logic', type: 'enum', section: 'Constraint', options: [
    { label: 'AND (all must succeed)', value: 'true' },
    { label: 'OR (any can succeed)', value: 'false' },
  ], description: 'Logical operator when multiple constraints target the same executable' },
];

// ---------------------------------------------------------------------------
// Property editors
// ---------------------------------------------------------------------------

interface PropertyEditorProps {
  def: PropertyDefinition;
  value: any;
  onChange: (key: string, value: any) => void;
  connectionManagers?: { id: string; name: string }[];
}

const PropertyEditor: React.FC<PropertyEditorProps> = ({ def, value, onChange, connectionManagers }) => {
  switch (def.type) {
    case 'text':
      return (
        <input
          type="text"
          className="ssis-prop-input"
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          title={def.description}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className="ssis-prop-input"
          value={value ?? 0}
          onChange={(e) => onChange(def.key, Number(e.target.value))}
          title={def.description}
        />
      );
    case 'boolean':
      return (
        <label className="ssis-prop-toggle" title={def.description}>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(def.key, e.target.checked)}
          />
          <span>{value ? 'True' : 'False'}</span>
        </label>
      );
    case 'enum':
      return (
        <select
          className="ssis-prop-select"
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          title={def.description}
        >
          <option value="">— Select —</option>
          {def.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case 'multiline':
      return (
        <textarea
          className="ssis-prop-textarea"
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          rows={4}
          title={def.description}
        />
      );
    case 'expression':
      return (
        <textarea
          className="ssis-prop-textarea ssis-prop-expression"
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          rows={2}
          placeholder="@[User::Var] > 0"
          title={def.description}
        />
      );
    case 'connection':
      return (
        <select
          className="ssis-prop-select"
          value={value ?? ''}
          onChange={(e) => onChange(def.key, e.target.value)}
          title={def.description}
        >
          <option value="">— Select Connection —</option>
          {connectionManagers?.map((cm) => (
            <option key={cm.id} value={cm.name}>
              {cm.name}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          type="text"
          className="ssis-prop-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(def.key, e.target.value)}
        />
      );
  }
};

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

const CollapsibleSection: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="ssis-prop-section">
      <div className="ssis-prop-section-header" onClick={() => setOpen(!open)}>
        <span className="ssis-prop-section-chevron">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </div>
      {open && <div className="ssis-prop-section-body">{children}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Property Panel
// ---------------------------------------------------------------------------

interface PropertyPanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const PropertyPanel: React.FC<PropertyPanelProps> = ({ collapsed = false, onToggle }) => {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const updateNodeData = useCanvasStore((s) => s.updateNodeData);
  const storeConnectionManagers = useCanvasStore((s) => s.connectionManagers);

  // Derive the list used by 'connection' dropdowns from the Zustand store
  const connectionManagers = useMemo(
    () => storeConnectionManagers.map((cm) => ({ id: cm.dtsId ?? cm.id, name: cm.objectName })),
    [storeConnectionManagers]
  );

  // Find selected node or edge
  const selectedNode = useMemo(
    () => nodes.find((n) => n.selected) as Node<SsisExecutable> | undefined,
    [nodes]
  );
  const selectedEdge = useMemo(
    () => edges.find((e) => e.selected) as Edge<PrecedenceConstraint> | undefined,
    [edges]
  );

  const handleNodePropertyChange = useCallback(
    (key: string, value: any) => {
      if (!selectedNode) { return; }
      // objectName and description are top-level on SsisExecutable
      if (key === 'objectName' || key === 'description') {
        updateNodeData(selectedNode.id, { [key]: value } as Partial<SsisExecutable>);
      } else if (key === 'ConnectionName') {
        // ConnectionName maps to connectionRefs for the serializer
        const refs = value
          ? [{ connectionManagerId: String(value), connectionManagerName: '' }]
          : [];
        updateNodeData(selectedNode.id, {
          connectionRefs: refs,
          properties: { ...selectedNode.data.properties, ConnectionName: String(value) },
        } as Partial<SsisExecutable>);
      } else {
        // Other properties go into the properties bag
        updateNodeData(selectedNode.id, {
          properties: { ...selectedNode.data.properties, [key]: value },
        } as Partial<SsisExecutable>);
      }
    },
    [selectedNode, updateNodeData]
  );

  const handleEdgePropertyChange = useCallback(
    (key: string, value: any) => {
      if (!selectedEdge) { return; }
      // Update edge data through the store
      const store = useCanvasStore.getState();
      const updatedEdges = store.edges.map((e) => {
        if (e.id !== selectedEdge.id) { return e; }
        const newData = { ...e.data } as PrecedenceConstraint;
        if (key === 'constraintType') {
          newData.constraintType = value;
        } else if (key === 'expression') {
          newData.expression = value;
        } else if (key === 'logicalAnd') {
          newData.logicalAnd = value === 'true';
        }
        return { ...e, data: newData };
      });
      useCanvasStore.setState({ edges: updatedEdges, dirty: true });
      store.syncToExtension();
    },
    [selectedEdge]
  );

  if (collapsed) {
    return (
      <div className="ssis-properties ssis-properties--collapsed" onClick={onToggle} title="Expand Properties">
        <span className="ssis-properties__toggle-icon">◀</span>
      </div>
    );
  }

  // No selection
  if (!selectedNode && !selectedEdge) {
    return (
      <div className="ssis-properties">
        <div className="ssis-properties__header">
          <span className="ssis-properties__title">Properties</span>
          {onToggle && (
            <button className="ssis-properties__collapse-btn" onClick={onToggle} title="Collapse">
              ▶
            </button>
          )}
        </div>
        <div className="ssis-properties__empty">
          <span>No selection</span>
          <span className="ssis-properties__hint">Select a task or constraint to view properties</span>
        </div>
      </div>
    );
  }

  // Edge selected
  if (selectedEdge && selectedEdge.data) {
    const sections = groupBySection(constraintPropertySchema);
    return (
      <div className="ssis-properties">
        <div className="ssis-properties__header">
          <span className="ssis-properties__title">Constraint Properties</span>
          {onToggle && (
            <button className="ssis-properties__collapse-btn" onClick={onToggle} title="Collapse">
              ▶
            </button>
          )}
        </div>
        <div className="ssis-properties__body">
          {Object.entries(sections).map(([section, defs]) => (
            <CollapsibleSection key={section} title={section}>
              {defs.map((def) => (
                <div key={def.key} className="ssis-prop-row">
                  <label className="ssis-prop-label" title={def.description}>
                    {def.label}
                  </label>
                  <PropertyEditor
                    def={def}
                    value={(selectedEdge.data as any)[def.key]}
                    onChange={handleEdgePropertyChange}
                    connectionManagers={connectionManagers}
                  />
                </div>
              ))}
            </CollapsibleSection>
          ))}
        </div>
      </div>
    );
  }

  // Node selected
  if (selectedNode) {
    const execType = selectedNode.data.executableType ?? '';
    const schema = taskPropertySchemas[execType] ?? generalProperties;
    const sections = groupBySection(schema);

    return (
      <div className="ssis-properties">
        <div className="ssis-properties__header">
          <span className="ssis-properties__title">Properties</span>
          <span className="ssis-properties__subtitle">{selectedNode.data.objectName}</span>
          {onToggle && (
            <button className="ssis-properties__collapse-btn" onClick={onToggle} title="Collapse">
              ▶
            </button>
          )}
        </div>
        <div className="ssis-properties__body">
          {Object.entries(sections).map(([section, defs]) => (
            <CollapsibleSection key={section} title={section}>
              {defs.map((def) => {
                const value =
                  def.key === 'objectName'
                    ? selectedNode.data.objectName
                    : def.key === 'description'
                    ? selectedNode.data.description
                    : def.key === 'ConnectionName'
                    ? (selectedNode.data.connectionRefs?.[0]?.connectionManagerId
                        ?? selectedNode.data.properties?.[def.key])
                    : selectedNode.data.properties?.[def.key];
                return (
                  <div key={def.key} className="ssis-prop-row">
                    <label className="ssis-prop-label" title={def.description}>
                      {def.label}
                    </label>
                    <PropertyEditor
                      def={def}
                      value={value}
                      onChange={handleNodePropertyChange}
                      connectionManagers={connectionManagers}
                    />
                  </div>
                );
              })}
            </CollapsibleSection>
          ))}
        </div>
      </div>
    );
  }

  return null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBySection(defs: PropertyDefinition[]): Record<string, PropertyDefinition[]> {
  const groups: Record<string, PropertyDefinition[]> = {};
  for (const def of defs) {
    (groups[def.section] ??= []).push(def);
  }
  return groups;
}

export default PropertyPanel;
export { PropertyDefinition, constraintPropertySchema };
