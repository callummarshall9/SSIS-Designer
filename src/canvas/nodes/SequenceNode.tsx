import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { SsisExecutable } from '../../models/SsisPackageModel';
import {
  containerShellStyle,
  nodeShellSelectedStyle,
  topBarStyle,
  headerStyle,
  iconStyle,
  NODE_COLORS,
} from './nodeStyles';

const SequenceIcon: React.FC = () => (
  <span style={iconStyle} title="Sequence Container">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="2" y1="6" x2="14" y2="6" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
      <line x1="2" y1="10" x2="14" y2="10" stroke="currentColor" strokeWidth="0.8" opacity="0.4" />
    </svg>
  </span>
);

const SequenceNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  return (
    <div
      className="ssis-node ssis-container-node"
      style={{
        ...containerShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
        borderStyle: 'dashed',
        borderColor: NODE_COLORS.sequence,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.sequence }} />
      <div style={topBarStyle(NODE_COLORS.sequence)} />
      <div style={headerStyle}>
        <SequenceIcon />
        <span>{data.objectName || 'Sequence Container'}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.sequence }} />
    </div>
  );
};

export default SequenceNode;
