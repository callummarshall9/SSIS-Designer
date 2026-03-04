/**
 * Canvas-specific state models consumed by React Flow in the webview.
 */

import { Node, Edge } from 'reactflow';
import { SsisExecutable, PrecedenceConstraint } from './SsisPackageModel';
import { DataFlowComponent, DataFlowPath } from './DataFlowModel';

/** Control flow canvas state */
export interface ControlFlowCanvasState {
  nodes: Node<SsisExecutable>[];
  edges: Edge<PrecedenceConstraint>[];
}

/** Data flow canvas state */
export interface DataFlowCanvasState {
  nodes: Node<DataFlowComponent>[];
  edges: Edge<DataFlowPath>[];
}

/** Node type identifiers for React Flow – control flow */
export type ControlFlowNodeType =
  | 'executeSql'
  | 'dataFlow'
  | 'forLoop'
  | 'forEachLoop'
  | 'sequence'
  | 'scriptTask'
  | 'genericTask';

/** Node type identifiers for React Flow – data flow */
export type DataFlowNodeType =
  | 'oledbSource'
  | 'oledbDestination'
  | 'derivedColumn'
  | 'conditionalSplit'
  | 'lookup'
  | 'genericComponent';

/** Maps an SSIS executable type string to a control-flow canvas node type */
export function getControlFlowNodeType(executableType: string): ControlFlowNodeType {
  const typeMap: Record<string, ControlFlowNodeType> = {
    'Microsoft.ExecuteSQLTask': 'executeSql',
    'Microsoft.Pipeline': 'dataFlow',
    'STOCK:FORLOOP': 'forLoop',
    'STOCK:FOREACHLOOP': 'forEachLoop',
    'STOCK:SEQUENCE': 'sequence',
    'Microsoft.ScriptTask': 'scriptTask',
  };
  return typeMap[executableType] || 'genericTask';
}

/** Maps a pipeline component class ID to a data-flow canvas node type */
export function getDataFlowNodeType(componentClassId: string): DataFlowNodeType {
  const typeMap: Record<string, DataFlowNodeType> = {
    'Microsoft.OLEDBSource': 'oledbSource',
    'Microsoft.OLEDBDestination': 'oledbDestination',
    'Microsoft.DerivedColumn': 'derivedColumn',
    'Microsoft.ConditionalSplit': 'conditionalSplit',
    'Microsoft.Lookup': 'lookup',
  };
  return typeMap[componentClassId] || 'genericComponent';
}
