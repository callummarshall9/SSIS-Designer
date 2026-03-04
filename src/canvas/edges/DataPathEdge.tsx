import React, { useState } from 'react';
import {
  EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
  BaseEdge,
  MarkerType,
} from 'reactflow';
import { DataFlowPath } from '../../models/DataFlowModel';
import { useCanvasStore } from '../shared/CanvasState';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PATH_COLOR = '#2196F3';
const ERROR_PATH_COLOR = '#F44336';

// ---------------------------------------------------------------------------
// DataPathEdge component
// ---------------------------------------------------------------------------

interface DataPathEdgeData extends DataFlowPath {
  /** Row count to display on the path (if available) */
  rowCount?: number;
  /** Whether this is an error path */
  isErrorPath?: boolean;
}

const DataPathEdge: React.FC<EdgeProps<DataPathEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}) => {
  const [hovered, setHovered] = useState(false);
  const removeDataFlowPath = useCanvasStore((s) => s.removeDataFlowPath);

  const isError = data?.isErrorPath ?? false;
  const color = isError ? ERROR_PATH_COLOR : PATH_COLOR;
  const rowCount = data?.rowCount;
  const pathName = data?.name ?? '';

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeDataFlowPath(id);
  };

  return (
    <>
      {/* Invisible wider path for easier hover target */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 3 : 2,
          filter: selected ? `drop-shadow(0 0 3px ${color})` : undefined,
        }}
        markerEnd={`url(#datapath-arrow-${isError ? 'error' : 'normal'})`}
      />

      {/* SVG marker definitions */}
      <defs>
        <marker
          id="datapath-arrow-normal"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={PATH_COLOR} />
        </marker>
        <marker
          id="datapath-arrow-error"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" fill={ERROR_PATH_COLOR} />
        </marker>
      </defs>

      {/* Label: path name, row count badge, delete button */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
          className="ssis-df-edge-label"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Row count badge */}
          {rowCount != null && (
            <span
              className="ssis-df-row-count-badge"
              style={{
                background: color,
                color: '#fff',
                padding: '1px 6px',
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {rowCount.toLocaleString()} rows
            </span>
          )}

          {/* Path name label on hover */}
          {(hovered || selected) && pathName && (
            <span
              style={{
                background: color,
                color: '#fff',
                padding: '1px 6px',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {pathName}
            </span>
          )}

          {/* Delete button on hover */}
          {(hovered || selected) && (
            <button
              onClick={handleDelete}
              title="Delete path"
              style={{
                background: 'var(--vscode-errorForeground, #f44336)',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: 16,
                height: 16,
                fontSize: 10,
                lineHeight: '16px',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default DataPathEdge;
