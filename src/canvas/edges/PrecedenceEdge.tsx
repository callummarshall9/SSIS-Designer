import React, { useState } from 'react';
import {
  EdgeProps,
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
} from 'reactflow';
import { PrecedenceConstraint } from '../../models/SsisPackageModel';
import { useCanvasStore } from '../shared/CanvasState';

// ---------------------------------------------------------------------------
// Constraint colors
// ---------------------------------------------------------------------------

const CONSTRAINT_COLORS: Record<string, string> = {
  Success: '#4CAF50',
  Failure: '#F44336',
  Completion: '#2196F3',
  Expression: '#FFC107',
};

const CONSTRAINT_LABELS: Record<string, string> = {
  Success: 'Success',
  Failure: 'Failure',
  Completion: 'Completion',
  Expression: 'Expression',
};

// ---------------------------------------------------------------------------
// PrecedenceEdge component
// ---------------------------------------------------------------------------

const PrecedenceEdge: React.FC<EdgeProps<PrecedenceConstraint>> = ({
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
  const removeEdge = useCanvasStore((s) => s.removeEdge);

  const constraintType = data?.constraintType ?? 'Success';
  const color = CONSTRAINT_COLORS[constraintType] ?? CONSTRAINT_COLORS.Success;
  const isExpression = constraintType === 'Expression';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeEdge(id);
  };

  return (
    <>
      {/* Invisible wider path for easier hover target */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 1.5,
          strokeDasharray: isExpression ? '6 3' : undefined,
          filter: selected ? `drop-shadow(0 0 3px ${color})` : undefined,
        }}
      />
      {/* Label + delete button */}
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
          className="ssis-edge-label"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {(hovered || selected) && (
            <>
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
                {CONSTRAINT_LABELS[constraintType] ?? constraintType}
                {data?.expression ? ` (${data.expression.slice(0, 20)})` : ''}
              </span>
              <button
                onClick={handleDelete}
                title="Delete constraint"
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
            </>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default PrecedenceEdge;
