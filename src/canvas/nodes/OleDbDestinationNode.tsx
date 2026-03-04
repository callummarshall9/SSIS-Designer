import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { DataFlowComponent } from '../../models/DataFlowModel';
import {
  nodeShellStyle,
  nodeShellSelectedStyle,
  topBarStyle,
  headerStyle,
  bodyStyle,
  iconStyle,
  DATAFLOW_COLORS,
} from './nodeStyles';

const DatabaseInIcon: React.FC = () => (
  <span style={iconStyle} title="OLE DB Destination">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <ellipse cx="9" cy="3" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 3v7c0 1.1 2.24 2 5 2s5-.9 5-2V3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 7l-3-2M4 7l-3 2" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  </span>
);

const OleDbDestinationNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  const tableName = (data.properties?.OpenRowset as string) ?? '';
  const truncated = tableName.length > 35 ? tableName.slice(0, 35) + '…' : tableName;

  const inputColumns = data.inputs?.reduce((sum, i) => sum + i.columns.length, 0) ?? 0;

  return (
    <div
      className="ssis-node ssis-df-node ssis-df-node--destination"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        style={{ background: DATAFLOW_COLORS.destination }}
      />
      <div style={topBarStyle(DATAFLOW_COLORS.destination)} />
      <div style={headerStyle}>
        <DatabaseInIcon />
        <span>{data.name || 'OLE DB Destination'}</span>
        {inputColumns > 0 && (
          <span className="ssis-df-column-badge" title={`${inputColumns} columns`}>
            {inputColumns}
          </span>
        )}
      </div>
      <div style={bodyStyle} title={tableName}>
        {truncated && <span>{truncated}</span>}
      </div>
      {/* Error output */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="errorOutput"
        className="ssis-df-error-handle"
        style={{
          background: '#F44336',
          width: 6,
          height: 6,
        }}
      />
    </div>
  );
};

export default OleDbDestinationNode;
