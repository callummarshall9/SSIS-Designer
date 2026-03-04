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

const SplitIcon: React.FC = () => (
  <span style={iconStyle} title="Conditional Split">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 2v5M8 7L3 13M8 7l5 6" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="3" cy="13" r="1.2" fill="currentColor" />
      <circle cx="13" cy="13" r="1.2" fill="currentColor" />
    </svg>
  </span>
);

const ConditionalSplitNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  // Outputs excluding error output represent: one per condition + the default output
  const conditionOutputs = data.outputs?.filter((o) => !o.isErrorOutput) ?? [];
  const conditionCount = Math.max(0, conditionOutputs.length - 1); // subtract default output

  return (
    <div
      className="ssis-node ssis-df-node ssis-df-node--transform"
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
        style={{ background: DATAFLOW_COLORS.transform }}
      />
      <div style={topBarStyle(DATAFLOW_COLORS.transform)} />
      <div style={headerStyle}>
        <SplitIcon />
        <span>{data.name || 'Conditional Split'}</span>
      </div>
      <div style={bodyStyle}>
        <span>{conditionCount} condition{conditionCount !== 1 ? 's' : ''}</span>
      </div>
      {/* One output handle per condition output, evenly spaced */}
      {conditionOutputs.map((output, index) => {
        const total = conditionOutputs.length;
        const leftPercent = ((index + 1) / (total + 1)) * 100;
        return (
          <Handle
            key={output.id}
            type="source"
            position={Position.Bottom}
            id={output.id}
            style={{
              background: DATAFLOW_COLORS.transform,
              left: `${leftPercent}%`,
            }}
            title={output.name}
          />
        );
      })}
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
          left: '95%',
        }}
      />
    </div>
  );
};

export default ConditionalSplitNode;
