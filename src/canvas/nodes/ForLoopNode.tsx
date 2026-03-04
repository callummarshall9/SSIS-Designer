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

const LoopIcon: React.FC = () => (
  <span style={iconStyle} title="For Loop Container">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12 4a6 6 0 1 1-8 0" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M4 5V1h4" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  </span>
);

const ForLoopNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const initExpr = (data.properties?.InitExpression as string) ?? '';
  const evalExpr = (data.properties?.EvalExpression as string) ?? '';
  const truncated = (evalExpr || initExpr).slice(0, 35);

  return (
    <div
      className="ssis-node ssis-container-node"
      style={{
        ...containerShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
        borderStyle: 'dashed',
        borderColor: NODE_COLORS.forLoop,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.forLoop }} />
      <div style={topBarStyle(NODE_COLORS.forLoop)} />
      <div style={headerStyle}>
        <LoopIcon />
        <span>{data.objectName || 'For Loop Container'}</span>
      </div>
      {truncated && (
        <div style={bodyStyle} title={evalExpr || initExpr}>
          {truncated}{(evalExpr || initExpr).length > 35 ? '…' : ''}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.forLoop }} />
    </div>
  );
};

export default ForLoopNode;
