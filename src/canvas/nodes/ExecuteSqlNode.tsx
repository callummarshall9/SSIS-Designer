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

const DatabaseIcon: React.FC = () => (
  <span style={iconStyle} title="Execute SQL Task">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <ellipse cx="8" cy="3" rx="6" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 3v10c0 1.38 2.69 2.5 6 2.5s6-1.12 6-2.5V3" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="8" cy="8" rx="6" ry="2.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5" />
    </svg>
  </span>
);

const ExecuteSqlNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const sqlPreview = (data.properties?.SqlStatementSource as string) ?? '';
  const truncatedSql = sqlPreview.length > 40 ? sqlPreview.slice(0, 40) + '…' : sqlPreview;
  const connName =
    data.connectionRefs?.[0]?.connectionManagerName ?? '';

  return (
    <div
      className="ssis-node"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.executeSql }} />
      <div style={topBarStyle(NODE_COLORS.executeSql)} />
      <div style={headerStyle}>
        <DatabaseIcon />
        <span>{data.objectName || 'Execute SQL Task'}</span>
      </div>
      <div style={bodyStyle} title={sqlPreview || connName}>
        {connName && <span>{connName}</span>}
        {connName && truncatedSql && <span> — </span>}
        {truncatedSql && <span>{truncatedSql}</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.executeSql }} />
    </div>
  );
};

export default ExecuteSqlNode;
