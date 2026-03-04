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

const FormulaIcon: React.FC = () => (
  <span style={iconStyle} title="Derived Column">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <text x="2" y="12" fontSize="13" fontWeight="bold" fontStyle="italic" fill="currentColor">ƒ</text>
      <path d="M9 3h5M9 8h5M9 13h5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.5" />
    </svg>
  </span>
);

const DerivedColumnNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  const derivedCount = data.outputs
    ?.filter((o) => !o.isErrorOutput)
    .reduce((sum, o) => sum + o.columns.filter((c) => c.expression).length, 0) ?? 0;

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
        <FormulaIcon />
        <span>{data.name || 'Derived Column'}</span>
      </div>
      <div style={bodyStyle}>
        <span>{derivedCount} derived column{derivedCount !== 1 ? 's' : ''}</span>
      </div>
      {/* Data output */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="output"
        style={{ background: DATAFLOW_COLORS.transform, left: '40%' }}
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

export default DerivedColumnNode;
