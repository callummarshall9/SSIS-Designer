import React, { useCallback, useRef, useMemo, useState } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  Connection,
  ReactFlowProvider,
  ReactFlowInstance,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  XYPosition,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { dataFlowNodeTypes } from './nodes';
import { dataFlowEdgeTypes } from './edges';
import { useCanvasStore } from './shared/CanvasState';
import {
  DataFlowComponent,
  DataFlowPath,
  DataFlowInput,
  DataFlowOutput,
} from '../models/DataFlowModel';
import { getDataFlowNodeType } from '../models/CanvasModel';
import { DATAFLOW_COLORS, DF_NODE_DEFAULT_WIDTH, DF_NODE_DEFAULT_HEIGHT } from './nodes/nodeStyles';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newGuid(): string {
  try {
    const g = (globalThis as any).crypto;
    if (g && typeof g.randomUUID === 'function') {
      return `{${(g.randomUUID() as string).toUpperCase()}}`;
    }
  } catch { /* ignore */ }
  const hex = '0123456789ABCDEF';
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join('');
  return `{${seg(8)}-${seg(4)}-4${seg(3)}-${hex[8 + Math.floor(Math.random() * 4)]}${seg(3)}-${seg(12)}}`;
}

function buildDefaultName(componentClassId: string): string {
  const map: Record<string, string> = {
    'Microsoft.OLEDBSource': 'OLE DB Source',
    'Microsoft.OLEDBDestination': 'OLE DB Destination',
    'Microsoft.FlatFileSource': 'Flat File Source',
    'Microsoft.FlatFileDestination': 'Flat File Destination',
    'Microsoft.ExcelSource': 'Excel Source',
    'Microsoft.ExcelDestination': 'Excel Destination',
    'Microsoft.ADONETSource': 'ADO NET Source',
    'Microsoft.ADONETDestination': 'ADO NET Destination',
    'Microsoft.RawFileSource': 'Raw File Source',
    'Microsoft.RawFileDestination': 'Raw File Destination',
    'Microsoft.XmlSource': 'XML Source',
    'Microsoft.DerivedColumn': 'Derived Column',
    'Microsoft.ConditionalSplit': 'Conditional Split',
    'Microsoft.Lookup': 'Lookup',
    'Microsoft.Aggregate': 'Aggregate',
    'Microsoft.Sort': 'Sort',
    'Microsoft.MergeJoin': 'Merge Join',
    'Microsoft.UnionAll': 'Union All',
    'Microsoft.DataConversion': 'Data Conversion',
    'Microsoft.Multicast': 'Multicast',
    'Microsoft.RowCount': 'Row Count',
    'Microsoft.ScriptComponent': 'Script Component',
  };
  return map[componentClassId] ?? 'Component';
}

/** Determine if a component class ID is a source, transform, or destination */
function getComponentCategory(classId: string): 'source' | 'transform' | 'destination' {
  const sources = new Set([
    'Microsoft.OLEDBSource', 'Microsoft.FlatFileSource', 'Microsoft.ExcelSource',
    'Microsoft.ADONETSource', 'Microsoft.RawFileSource', 'Microsoft.XmlSource',
  ]);
  const destinations = new Set([
    'Microsoft.OLEDBDestination', 'Microsoft.FlatFileDestination', 'Microsoft.ExcelDestination',
    'Microsoft.ADONETDestination', 'Microsoft.RawFileDestination',
  ]);
  if (sources.has(classId)) { return 'source'; }
  if (destinations.has(classId)) { return 'destination'; }
  return 'transform';
}

function buildDefaultInputs(classId: string): DataFlowInput[] {
  const category = getComponentCategory(classId);
  if (category === 'source') { return []; } // sources have no inputs
  return [{
    id: newGuid(),
    refId: '',
    name: 'Input',
    columns: [],
    externalColumns: [],
    unknownElements: [],
  }];
}

function buildDefaultOutputs(classId: string): DataFlowOutput[] {
  const outputs: DataFlowOutput[] = [{
    id: newGuid(),
    refId: '',
    name: 'Output',
    isErrorOutput: false,
    columns: [],
    externalColumns: [],
    unknownElements: [],
  }];
  // Add error output for most components
  outputs.push({
    id: newGuid(),
    refId: '',
    name: 'Error Output',
    isErrorOutput: true,
    columns: [],
    externalColumns: [],
    unknownElements: [],
  });
  return outputs;
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  nodeId?: string;
  edgeId?: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataFlowCanvasProps {
  onBackToControlFlow: () => void;
  taskName?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DataFlowCanvasInner: React.FC<DataFlowCanvasProps> = ({ onBackToControlFlow, taskName }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Zustand store – data flow slices
  const dataFlowNodes = useCanvasStore((s) => s.dataFlowNodes);
  const dataFlowEdges = useCanvasStore((s) => s.dataFlowEdges);
  const addDataFlowComponent = useCanvasStore((s) => s.addDataFlowComponent);
  const removeDataFlowComponent = useCanvasStore((s) => s.removeDataFlowComponent);
  const moveDataFlowComponent = useCanvasStore((s) => s.moveDataFlowComponent);
  const addDataFlowPath = useCanvasStore((s) => s.addDataFlowPath);
  const removeDataFlowPath = useCanvasStore((s) => s.removeDataFlowPath);

  // -----------------------------------------------------------------------
  // Node changes (position, selection, removal via keyboard)
  // -----------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, dataFlowNodes);
      useCanvasStore.setState({ dataFlowNodes: updated });

      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          moveDataFlowComponent(change.id, change.position.x, change.position.y);
        }
      }
    },
    [dataFlowNodes, moveDataFlowComponent]
  );

  // -----------------------------------------------------------------------
  // Edge changes (selection, removal)
  // -----------------------------------------------------------------------

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, dataFlowEdges);
      useCanvasStore.setState({ dataFlowEdges: updated });
    },
    [dataFlowEdges]
  );

  // -----------------------------------------------------------------------
  // Edge creation (dragging from handle to handle)
  // -----------------------------------------------------------------------

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) { return; }
      const id = newGuid();
      const newPath: DataFlowPath = {
        id,
        refId: '',
        name: 'Data Path',
        fromOutputId: connection.source,
        toInputId: connection.target,
        unknownElements: [],
      };
      addDataFlowPath(newPath);
    },
    [addDataFlowPath]
  );

  // -----------------------------------------------------------------------
  // Drag-and-drop from component palette
  // -----------------------------------------------------------------------

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const componentClassId = e.dataTransfer.getData('application/ssis-component-type');
      if (!componentClassId || !rfInstance || !reactFlowWrapper.current) { return; }

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position: XYPosition = rfInstance.project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      const id = newGuid();

      const component: DataFlowComponent = {
        id,
        refId: '',
        componentClassId,
        name: buildDefaultName(componentClassId),
        description: '',
        x: position.x,
        y: position.y,
        properties: {},
        inputs: buildDefaultInputs(componentClassId),
        outputs: buildDefaultOutputs(componentClassId),
        unknownElements: [],
      };

      addDataFlowComponent(component);
    },
    [rfInstance, addDataFlowComponent]
  );

  // -----------------------------------------------------------------------
  // Context menus
  // -----------------------------------------------------------------------

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) { return; }
      if (contextMenu.nodeId) {
        switch (action) {
          case 'delete':
            removeDataFlowComponent(contextMenu.nodeId);
            break;
          case 'configure':
            useCanvasStore.setState({
              dataFlowNodes: dataFlowNodes.map((n) => ({
                ...n,
                selected: n.id === contextMenu.nodeId,
              })),
            });
            break;
          case 'viewColumns': {
            const node = dataFlowNodes.find((n) => n.id === contextMenu.nodeId);
            if (node) {
              try {
                const api = (globalThis as any)._vscodeApi;
                api?.postMessage({
                  type: 'viewColumns',
                  componentId: node.id,
                  componentName: node.data.name,
                });
              } catch { /* not in webview */ }
            }
            break;
          }
        }
      }
      if (contextMenu.edgeId) {
        if (action === 'delete') {
          removeDataFlowPath(contextMenu.edgeId);
        }
      }
      setContextMenu(null);
    },
    [contextMenu, dataFlowNodes, removeDataFlowComponent, removeDataFlowPath]
  );

  // -----------------------------------------------------------------------
  // MiniMap colors
  // -----------------------------------------------------------------------

  const miniMapNodeColor = useCallback((node: Node) => {
    const colors: Record<string, string> = {
      oledbSource: DATAFLOW_COLORS.source,
      oledbDestination: DATAFLOW_COLORS.destination,
      derivedColumn: DATAFLOW_COLORS.transform,
      conditionalSplit: DATAFLOW_COLORS.transform,
      lookup: DATAFLOW_COLORS.transform,
      genericComponent: DATAFLOW_COLORS.generic,
    };
    return colors[node.type ?? ''] ?? DATAFLOW_COLORS.generic;
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div ref={reactFlowWrapper} className="ssis-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={dataFlowNodes}
        edges={dataFlowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={onPaneClick}
        onInit={setRfInstance}
        nodeTypes={dataFlowNodeTypes}
        edgeTypes={dataFlowEdgeTypes}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ type: 'dataPath' }}
      >
        <Controls />
        <MiniMap
          nodeColor={miniMapNodeColor}
          nodeStrokeWidth={3}
          zoomable
          pannable
          style={{
            backgroundColor: 'var(--canvas-bg, #1e1e1e)',
            border: '1px solid var(--canvas-border, #333)',
          }}
        />
        <Background variant={BackgroundVariant.Dots} gap={15} size={1} color="var(--canvas-border, #333)" />
      </ReactFlow>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="ssis-context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
          }}
        >
          {contextMenu.nodeId && (
            <>
              <button className="ssis-context-menu__item" onClick={() => handleContextAction('configure')}>
                Configure…
              </button>
              <button className="ssis-context-menu__item" onClick={() => handleContextAction('viewColumns')}>
                View Columns…
              </button>
              <div className="ssis-context-menu__separator" />
              <button className="ssis-context-menu__item ssis-context-menu__item--danger" onClick={() => handleContextAction('delete')}>
                Delete
              </button>
            </>
          )}
          {contextMenu.edgeId && (
            <>
              <button className="ssis-context-menu__item ssis-context-menu__item--danger" onClick={() => handleContextAction('delete')}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Wrapped export with ReactFlowProvider
// ---------------------------------------------------------------------------

const DataFlowCanvas: React.FC<DataFlowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <DataFlowCanvasInner {...props} />
  </ReactFlowProvider>
);

export default DataFlowCanvas;
