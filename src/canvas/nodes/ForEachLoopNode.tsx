import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { SsisExecutable } from '../../models/SsisPackageModel';
import {
  containerShellStyle,
  nodeShellSelectedStyle,
  topBarStyle,
  headerStyle,
  bodyStyle,
  iconStyle,
  NODE_COLORS,
} from './nodeStyles';

const ForEachIcon: React.FC = () => (
  <span style={iconStyle} title="For Each Loop Container">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 4a6 6 0 1 1-8 0" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M4 5V1h4" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <circle cx="8" cy="10" r="1.5" fill="currentColor" opacity="0.6" />
    </svg>
  </span>
);

const ForEachLoopNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const enumeratorType = (data.properties?.EnumeratorType as string) ?? '';

  return (
    <div
      className="ssis-node ssis-container-node"
      style={{
        ...containerShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
        borderStyle: 'dashed',
        borderColor: NODE_COLORS.forEachLoop,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.forEachLoop }} />
      <div style={topBarStyle(NODE_COLORS.forEachLoop)} />
      <div style={headerStyle}>
        <ForEachIcon />
        <span>{data.objectName || 'For Each Loop Container'}</span>
      </div>
      {enumeratorType && (
        <div style={bodyStyle} title={enumeratorType}>
          {enumeratorType}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.forEachLoop }} />
    </div>
  );
};

export default ForEachLoopNode;
