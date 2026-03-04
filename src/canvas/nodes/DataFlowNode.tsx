import React, { useCallback } from 'react';
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

const DataFlowIcon: React.FC = () => (
  <span style={iconStyle} title="Data Flow Task">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2v12M4 14l-2-2M4 14l2-2" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M12 14V2M12 2l-2 2M12 2l2 2" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M8 4v8M8 12l-2-2M8 12l2-2" stroke="currentColor" strokeWidth="1.3" fill="none" opacity="0.5" />
    </svg>
  </span>
);

interface VsCodeApi {
  postMessage(message: any): void;
}

const DataFlowNode: React.FC<NodeProps<SsisExecutable>> = ({ data, selected }) => {
  const handleDoubleClick = useCallback(() => {
    try {
      const api = (globalThis as any)._vscodeApi as VsCodeApi | undefined;
      if (api) {
        api.postMessage({
          type: 'openDataFlow',
          executableId: data.id,
        });
      }
    } catch {
      // not in webview
    }
  }, [data.id]);

  return (
    <div
      className="ssis-node"
      style={{
        ...nodeShellStyle,
        ...(selected ? nodeShellSelectedStyle : {}),
      }}
      onDoubleClick={handleDoubleClick}
    >
      <Handle type="target" position={Position.Top} style={{ background: NODE_COLORS.dataFlow }} />
      <div style={topBarStyle(NODE_COLORS.dataFlow)} />
      <div style={headerStyle}>
        <DataFlowIcon />
        <span>{data.objectName || 'Data Flow Task'}</span>
      </div>
      <div style={bodyStyle}>
        <span>Double-click to edit data flow</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: NODE_COLORS.dataFlow }} />
    </div>
  );
};

export default DataFlowNode;
