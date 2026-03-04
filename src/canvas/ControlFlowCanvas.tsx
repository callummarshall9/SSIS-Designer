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
  NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { useCanvasStore, findContainerAtPosition, CONTAINER_TYPES } from './shared/CanvasState';
import { SsisExecutable, PrecedenceConstraint } from '../models/SsisPackageModel';
import { getControlFlowNodeType } from '../models/CanvasModel';

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

const CONTAINER_TYPES = new Set(['STOCK:FORLOOP', 'STOCK:FOREACHLOOP', 'STOCK:SEQUENCE']);

function defaultDimensions(executableType: string): { width: number; height: number } {
  return CONTAINER_TYPES.has(executableType)
    ? { width: 300, height: 200 }
    : { width: 200, height: 80 };
}

function buildDefaultName(executableType: string): string {
  const map: Record<string, string> = {
    'Microsoft.ExecuteSQLTask': 'Execute SQL Task',
    'Microsoft.Pipeline': 'Data Flow Task',
    'STOCK:FORLOOP': 'For Loop Container',
    'STOCK:FOREACHLOOP': 'For Each Loop Container',
    'STOCK:SEQUENCE': 'Sequence Container',
    'Microsoft.ScriptTask': 'Script Task',
    'Microsoft.ExecutePackageTask': 'Execute Package Task',
    'Microsoft.ExecuteProcess': 'Execute Process Task',
    'Microsoft.FileSystemTask': 'File System Task',
    'Microsoft.FtpTask': 'FTP Task',
    'Microsoft.SendMailTask': 'Send Mail Task',
    'Microsoft.ExpressionTask': 'Expression Task',
  };
  return map[executableType] ?? 'Task';
}

function buildDefaultProperties(executableType: string): Record<string, string> {
  if (executableType === 'Microsoft.ExecuteSQLTask') {
    return {
      'SQLTask.SqlStatementSource': '',
      'SQLTask.SqlStatementSourceType': 'DirectInput',
      'SQLTask.ResultSetType': 'ResultSetType_None',
      'SQLTask.BypassPrepare': 'false',
      'SQLTask.TimeOut': '0',
    };
  }
  return {};
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
// Component
// ---------------------------------------------------------------------------

const ControlFlowCanvasInner: React.FC = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Zustand store
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdge = useCanvasStore((s) => s.addEdge);
  const removeNode = useCanvasStore((s) => s.removeNode);
  const removeEdge = useCanvasStore((s) => s.removeEdge);
  const moveNode = useCanvasStore((s) => s.moveNode);
  const reparentNode = useCanvasStore((s) => s.reparentNode);

  // -----------------------------------------------------------------------
  // Node changes (position, selection, removal via keyboard)
  // -----------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const removedIds = changes
        .filter((c): c is NodeChange & { type: 'remove'; id: string } => c.type === 'remove')
        .map(c => c.id);

      // Route removals through store actions so dirty/sync are applied.
      for (const id of removedIds) {
        removeNode(id);
      }

      const nonRemoveChanges = changes.filter(c => c.type !== 'remove');
      if (nonRemoveChanges.length > 0) {
        const currentNodes = useCanvasStore.getState().nodes;
        const updated = applyNodeChanges(nonRemoveChanges, currentNodes);
        useCanvasStore.setState({ nodes: updated });
      }

      for (const change of nonRemoveChanges) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          moveNode(change.id, change.position.x, change.position.y);
        }
      }
    },
    [moveNode, removeNode]
  );

  // -----------------------------------------------------------------------
  // Node drag handlers — highlight containers & reparent on drop
  // -----------------------------------------------------------------------

  const onNodeDrag: NodeDragHandler = useCallback(
    (_event, node) => {
      if (!rfInstance) { return; }
      // Compute absolute position of the dragged node
      let absX = node.position.x;
      let absY = node.position.y;
      if (node.parentNode) {
        const parent = nodes.find(n => n.id === node.parentNode);
        if (parent) {
          absX += parent.position.x;
          absY += parent.position.y;
        }
      }
      const centerX = absX + ((node.width ?? 200) / 2);
      const centerY = absY + ((node.height ?? 80) / 2);
      const container = findContainerAtPosition(nodes, centerX, centerY, node.id);
      setDropTargetId(container?.id ?? null);
    },
    [rfInstance, nodes]
  );

  const onNodeDragStop: NodeDragHandler = useCallback(
    (_event, node) => {
      // Compute absolute position of the dragged node
      let absX = node.position.x;
      let absY = node.position.y;
      if (node.parentNode) {
        const parent = nodes.find(n => n.id === node.parentNode);
        if (parent) {
          absX += parent.position.x;
          absY += parent.position.y;
        }
      }
      const centerX = absX + ((node.width ?? 200) / 2);
      const centerY = absY + ((node.height ?? 80) / 2);
      const container = findContainerAtPosition(nodes, centerX, centerY, node.id);
      const newParentId = container?.id;
      const currentParentId = node.parentNode;

      if (newParentId !== currentParentId) {
        reparentNode(node.id, newParentId);
      }
      setDropTargetId(null);
    },
    [nodes, reparentNode]
  );

  // -----------------------------------------------------------------------
  // Edge changes (selection, removal)
  // -----------------------------------------------------------------------

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedIds = changes
        .filter((c): c is EdgeChange & { type: 'remove'; id: string } => c.type === 'remove')
        .map(c => c.id);

      // Route removals through store actions so dirty/sync are applied.
      for (const id of removedIds) {
        removeEdge(id);
      }

      const nonRemoveChanges = changes.filter(c => c.type !== 'remove');
      if (nonRemoveChanges.length > 0) {
        const currentEdges = useCanvasStore.getState().edges;
        const updated = applyEdgeChanges(nonRemoveChanges, currentEdges);
        useCanvasStore.setState({ edges: updated });
      }
    },
    [removeEdge]
  );

  // -----------------------------------------------------------------------
  // Edge creation (dragging from handle to handle)
  // -----------------------------------------------------------------------

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) { return; }
      const id = newGuid();
      const newEdge: Edge<PrecedenceConstraint> = {
        id,
        source: connection.source,
        target: connection.target,
        type: 'precedence',
        data: {
          id,
          fromExecutableId: connection.source,
          toExecutableId: connection.target,
          constraintType: 'Success',
          logicalAnd: true,
          value: 0,
          unknownElements: [],
        },
      };
      addEdge(newEdge);
    },
    [addEdge]
  );

  // -----------------------------------------------------------------------
  // Drag-and-drop from palette
  // -----------------------------------------------------------------------

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const executableType = e.dataTransfer.getData('application/ssis-task-type');
      if (!executableType || !rfInstance || !reactFlowWrapper.current) { return; }

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position: XYPosition = rfInstance.project({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      const { width, height } = defaultDimensions(executableType);
      const id = newGuid();

      // Detect if dropped inside a container
      const container = findContainerAtPosition(nodes, position.x, position.y);

      // Compute position relative to container (if any)
      let nodePosition = position;
      if (container) {
        nodePosition = {
          x: position.x - container.position.x,
          y: position.y - container.position.y,
        };
        // Clamp inside container body
        nodePosition.x = Math.max(15, nodePosition.x);
        nodePosition.y = Math.max(40, nodePosition.y);
      }

      const executable: SsisExecutable = {
        id,
        dtsId: id,
        objectName: buildDefaultName(executableType),
        executableType,
        description: '',
        x: nodePosition.x,
        y: nodePosition.y,
        width,
        height,
        properties: buildDefaultProperties(executableType),
        connectionRefs: [],
        variables: [],
        unknownElements: [],
      };

      const nodeType = getControlFlowNodeType(executableType);
      const node: Node<SsisExecutable> = {
        id,
        type: nodeType,
        position: nodePosition,
        data: executable,
        style: { width, height },
        ...(container ? {
          parentNode: container.id,
          extent: 'parent' as const,
          expandParent: true,
        } : {}),
      };

      addNode(node);
      setDropTargetId(null);
    },
    [rfInstance, addNode, nodes]
  );

  // -----------------------------------------------------------------------
  // Double-click on data flow node → open data flow canvas
  // -----------------------------------------------------------------------

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node<SsisExecutable>) => {
      if (node.data.executableType === 'Microsoft.Pipeline') {
        try {
          const api = (globalThis as any)._vscodeApi;
          api?.postMessage({
            type: 'openDataFlow',
            executableId: node.data.id,
          });
        } catch { /* not in webview */ }
      }
    },
    []
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
            removeNode(contextMenu.nodeId);
            break;
          case 'configure':
            // Trigger selection so property panel opens
            useCanvasStore.setState({
              nodes: nodes.map((n) => ({ ...n, selected: n.id === contextMenu.nodeId })),
            });
            break;
        }
      }
      if (contextMenu.edgeId) {
        const constraintType = action as PrecedenceConstraint['constraintType'];
        if (['Success', 'Failure', 'Completion'].includes(constraintType)) {
          const updatedEdges = edges.map((e) => {
            if (e.id !== contextMenu.edgeId) { return e; }
            return {
              ...e,
              data: {
                ...e.data!,
                constraintType,
                value: constraintType === 'Success' ? 0 : constraintType === 'Failure' ? 1 : 2,
              },
            };
          });
          useCanvasStore.setState({ edges: updatedEdges, dirty: true });
          useCanvasStore.getState().syncToExtension();
        }
        if (action === 'delete') {
          removeEdge(contextMenu.edgeId);
        }
      }
      setContextMenu(null);
    },
    [contextMenu, nodes, edges, removeNode, removeEdge]
  );

  // -----------------------------------------------------------------------
  // Apply drop-target highlight to container nodes while dragging
  // -----------------------------------------------------------------------

  const displayNodes = useMemo(() => {
    if (!dropTargetId) { return nodes; }
    return nodes.map(n => {
      if (n.id !== dropTargetId) { return n; }
      return {
        ...n,
        style: {
          ...n.style,
          boxShadow: '0 0 0 2px var(--node-selected-border, #007fd4), inset 0 0 12px rgba(0,127,212,0.15)',
        },
        className: `${n.className ?? ''} ssis-drop-target`.trim(),
      };
    });
  }, [nodes, dropTargetId]);

  // -----------------------------------------------------------------------
  // MiniMap colors
  // -----------------------------------------------------------------------

  const miniMapNodeColor = useCallback((node: Node) => {
    const colors: Record<string, string> = {
      executeSql: '#4CAF50',
      dataFlow: '#FF9800',
      forLoop: '#9C27B0',
      forEachLoop: '#7B1FA2',
      sequence: '#03A9F4',
      scriptTask: '#FF5722',
      genericTask: '#757575',
    };
    return colors[node.type ?? ''] ?? '#757575';
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div ref={reactFlowWrapper} className="ssis-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onEdgeContextMenu={onEdgeContextMenu}
        onPaneClick={onPaneClick}
        onInit={setRfInstance}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        deleteKeyCode={['Backspace', 'Delete']}
        defaultEdgeOptions={{ type: 'precedence' }}
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
              <button className="ssis-context-menu__item ssis-context-menu__item--danger" onClick={() => handleContextAction('delete')}>
                Delete
              </button>
            </>
          )}
          {contextMenu.edgeId && (
            <>
              <button className="ssis-context-menu__item" onClick={() => handleContextAction('Success')}>
                ● Success
              </button>
              <button className="ssis-context-menu__item" onClick={() => handleContextAction('Failure')}>
                ● Failure
              </button>
              <button className="ssis-context-menu__item" onClick={() => handleContextAction('Completion')}>
                ● Completion
              </button>
              <div className="ssis-context-menu__separator" />
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

const ControlFlowCanvas: React.FC = () => (
  <ReactFlowProvider>
    <ControlFlowCanvasInner />
  </ReactFlowProvider>
);

export default ControlFlowCanvas;
