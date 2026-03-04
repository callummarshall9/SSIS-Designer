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

const SearchIcon: React.FC = () => (
  <span style={iconStyle} title="Lookup">
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="6.5" cy="6.5" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 10l4.5 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  </span>
);

const LookupNode: React.FC<NodeProps<DataFlowComponent>> = ({ data, selected }) => {
  const refTable = (data.properties?.OpenRowset as string) ?? '';
  const truncated = refTable.length > 35 ? refTable.slice(0, 35) + '…' : refTable;

  // Find the match and no-match outputs
  const matchOutput = data.outputs?.find((o) => !o.isErrorOutput && o.name.toLowerCase().includes('match') && !o.name.toLowerCase().includes('no match'));
  const noMatchOutput = data.outputs?.find((o) => !o.isErrorOutput && o.name.toLowerCase().includes('no match'));

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
        <SearchIcon />
        <span>{data.name || 'Lookup'}</span>
      </div>
      <div style={bodyStyle} title={refTable}>
        {truncated && <span>{truncated}</span>}
      </div>
      {/* Match output */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={matchOutput?.id ?? 'matchOutput'}
        style={{ background: DATAFLOW_COLORS.transform, left: '30%' }}
        title="Match Output"
      />
      {/* No Match output */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={noMatchOutput?.id ?? 'noMatchOutput'}
        style={{ background: '#FF5722', left: '60%' }}
        title="No Match Output"
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
          left: '85%',
        }}
      />
    </div>
  );
};

export default LookupNode;
