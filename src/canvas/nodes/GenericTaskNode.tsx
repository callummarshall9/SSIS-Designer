import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { SsisExecutable } from '../../models/SsisPackageModel';
import {
  nodeShellStyle,
  nodeShellSelectedStyle,
  topBarStyle,
  headerStyle,
  bodyStyle,
  iconStyle,
  NODE_COLORS,
} from './nodeStyles';

const GenericIcon: React.FC = () => (
  <span style={iconStyle} title="Task">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.5" />
    </svg>
  </span>
);

const GenericTaskNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const typeName = data.executableType?.split('.').pop() ?? 'Task';

  return (
    <div
      className="ssis-node"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.genericTask }} />
      <div style={topBarStyle(NODE_COLORS.genericTask)} />
      <div style={headerStyle}>
        <GenericIcon />
        <span>{data.objectName || typeName}</span>
      </div>
      <div style={bodyStyle}>
        <span>{data.executableType ?? 'Unknown'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.genericTask }} />
    </div>
  );
};

export default GenericTaskNode;
