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

const ScriptIcon: React.FC = () => (
  <span style={iconStyle} title="Script Task">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 4l-3 4 3 4" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M11 4l3 4-3 4" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <line x1="9" y1="2" x2="7" y2="14" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  </span>
);

const ScriptTaskNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const language = (data.properties?.ScriptLanguage as string) ?? 'CSharp';

  return (
    <div
      className="ssis-node"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.scriptTask }} />
      <div style={topBarStyle(NODE_COLORS.scriptTask)} />
      <div style={headerStyle}>
        <ScriptIcon />
        <span>{data.objectName || 'Script Task'}</span>
      </div>
      <div style={bodyStyle}>
        <span>{language}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.scriptTask }} />
    </div>
  );
};

export default ScriptTaskNode;
