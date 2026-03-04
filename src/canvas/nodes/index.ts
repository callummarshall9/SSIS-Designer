/**
 * React Flow custom node types for the control flow canvas.
 */

import ExecuteSqlNode from './ExecuteSqlNode';
import DataFlowNode from './DataFlowNode';
import ForLoopNode from './ForLoopNode';
import ForEachLoopNode from './ForEachLoopNode';
import SequenceNode from './SequenceNode';
import ScriptTaskNode from './ScriptTaskNode';
import GenericTaskNode from './GenericTaskNode';

/**
 * React Flow custom node types for the data flow canvas.
 */

import OleDbSourceNode from './OleDbSourceNode';
import OleDbDestinationNode from './OleDbDestinationNode';
import DerivedColumnNode from './DerivedColumnNode';
import ConditionalSplitNode from './ConditionalSplitNode';
import LookupNode from './LookupNode';
import GenericComponentNode from './GenericComponentNode';

// ---------------------------------------------------------------------------
// Control flow node types
// ---------------------------------------------------------------------------

export const nodeTypes = {
  executeSql: ExecuteSqlNode,
  dataFlow: DataFlowNode,
  forLoop: ForLoopNode,
  forEachLoop: ForEachLoopNode,
  sequence: SequenceNode,
  scriptTask: ScriptTaskNode,
  genericTask: GenericTaskNode,
} as const;

// ---------------------------------------------------------------------------
// Data flow node types
// ---------------------------------------------------------------------------

export const dataFlowNodeTypes = {
  oledbSource: OleDbSourceNode,
  oledbDestination: OleDbDestinationNode,
  derivedColumn: DerivedColumnNode,
  conditionalSplit: ConditionalSplitNode,
  lookup: LookupNode,
  genericComponent: GenericComponentNode,
} as const;

export {
  ExecuteSqlNode,
  DataFlowNode,
  ForLoopNode,
  ForEachLoopNode,
  SequenceNode,
  ScriptTaskNode,
  GenericTaskNode,
  OleDbSourceNode,
  OleDbDestinationNode,
  DerivedColumnNode,
  ConditionalSplitNode,
  LookupNode,
  GenericComponentNode,
};
