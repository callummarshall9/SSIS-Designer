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

const DatabaseOutIcon: React.FC = () => (
  <span style={iconStyle} title="OLE DB Source">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <ellipse cx="7" cy="3" rx="5" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 3v7c0 1.1 2.24 2 5 2s5-.9 5-2V3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 9l3-2M12 9l3 2" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  </span>
);

const OleDbSourceNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  const tableName = (data.properties?.OpenRowset as string) ?? '';
  const sqlCommand = (data.properties?.SqlCommand as string) ?? '';
  const preview = tableName || sqlCommand;
  const truncated = preview.length > 35 ? preview.slice(0, 35) + '…' : preview;

  const outputColumns = data.outputs
    ?.filter((o) => !o.isErrorOutput)
    .reduce((sum, o) => sum + o.columns.length, 0) ?? 0;

  return (
    <div
      className="ssis-node ssis-df-node ssis-df-node--source"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      <div style={topBarStyle(DATAFLOW_COLORS.source)} />
      <div style={headerStyle}>
        <DatabaseOutIcon />
        <span>{data.name || 'OLE DB Source'}</span>
        {outputColumns > 0 && (
          <span className="ssis-df-column-badge" title={`${outputColumns} columns`}>
            {outputColumns}
          </span>
        )}
      </div>
      <div style={bodyStyle} title={preview}>
        {truncated && <span>{truncated}</span>}
      </div>
      {/* Data output */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{ background: DATAFLOW_COLORS.source, left: '40%' }}
      />
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
          left: '75%',
        }}
      />
    </div>
  );
};

export default OleDbSourceNode;
