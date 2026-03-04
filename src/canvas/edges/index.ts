/**
 * React Flow custom edge types for the control flow canvas.
 */

import PrecedenceEdge from './PrecedenceEdge';

/**
 * React Flow custom edge types for the data flow canvas.
 */

import DataPathEdge from './DataPathEdge';

// ---------------------------------------------------------------------------
// Control flow edge types
// ---------------------------------------------------------------------------

export const edgeTypes = {
  precedence: PrecedenceEdge,
} as const;

// ---------------------------------------------------------------------------
// Data flow edge types
// ---------------------------------------------------------------------------

export const dataFlowEdgeTypes = {
  dataPath: DataPathEdge,
} as const;

export { PrecedenceEdge, DataPathEdge };
