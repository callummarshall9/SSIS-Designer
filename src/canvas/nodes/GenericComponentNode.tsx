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

const ComponentIcon: React.FC = () => (
  <span style={iconStyle} title="Data Flow Component">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6h6M5 8h6M5 10h4" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.6" />
    </svg>
  </span>
);

const GenericComponentNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  const hasInputs = (data.inputs?.length ?? 0) > 0;
  const hasOutputs = data.outputs?.some((o) => !o.isErrorOutput) ?? false;
  const hasErrorOutput = data.outputs?.some((o) => o.isErrorOutput) ?? false;

  return (
    <div
      className="ssis-node ssis-df-node ssis-df-node--generic"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      {/* Input handle */}
      {hasInputs && (
        <Handle
          type="target"
          position={Position.Top}
          id="input"
          style={{ background: '#757575' }}
        />
      )}
      <div style={topBarStyle('#757575')} />
      <div style={headerStyle}>
        <ComponentIcon />
        <span>{data.name || 'Component'}</span>
      </div>
      <div style={bodyStyle} title={data.componentClassId}>
        <span>{data.componentClassId}</span>
      </div>
      {/* Data output */}
      {hasOutputs && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="output"
          style={{ background: '#757575', left: '40%' }}
        />
      )}
      {/* Error output */}
      {hasErrorOutput && (
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
      )}
    </div>
  );
};

export default GenericComponentNode;
