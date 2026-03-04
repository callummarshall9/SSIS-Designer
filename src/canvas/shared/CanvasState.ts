/**
 * Zustand store for canvas state with undo/redo and webview ↔ extension sync.
 *
 * This store is designed to run inside the webview (React) context.
 * It communicates with the VS Code extension host via `postMessage`.
 */

import { create } from 'zustand';
import { Node, Edge } from 'reactflow';
import {
  SsisExecutable,
  PrecedenceConstraint,
  ConnectionManager,
  SsisVariable,
  SsisParameter,
} from '../../models/SsisPackageModel';
import {
  DataFlowModel,
  DataFlowComponent,
  DataFlowPath,
} from '../../models/DataFlowModel';
import { getDataFlowNodeType } from '../../models/CanvasModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResultEntry {
  severity: 'error' | 'warning' | 'info';
  message: string;
  location: string;
  nodeId?: string;
}

export interface CanvasSnapshot {
  nodes: Node<SsisExecutable>[];
  edges: Edge<PrecedenceConstraint>[];
}

export interface CanvasState extends CanvasSnapshot {
  // History
  past: CanvasSnapshot[];
  future: CanvasSnapshot[];

  // Status
  dirty: boolean;

  // Connection managers
  connectionManagers: ConnectionManager[];

  // Variables & parameters
  variables: SsisVariable[];
  parameters: SsisParameter[];

  // Data flow state
  dataFlowModel: DataFlowModel | null;
  activeDataFlowTaskId: string | null;
  dataFlowNodes: Node<DataFlowComponent>[];
  dataFlowEdges: Edge<DataFlowPath>[];

  // Validation
  validationResults: Map<string, ValidationResultEntry[]>;
  validationRun: boolean;

  // Actions – node
  addNode: (node: Node<SsisExecutable>) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, x: number, y: number) => void;
  updateNodeData: (nodeId: string, data: Partial<SsisExecutable>) => void;
  reparentNode: (nodeId: string, parentId: string | undefined) => void;

  // Actions – edge
  addEdge: (edge: Edge<PrecedenceConstraint>) => void;
  removeEdge: (edgeId: string) => void;

  // Actions – bulk
  setCanvas: (nodes: Node<SsisExecutable>[], edges: Edge<PrecedenceConstraint>[]) => void;

  // Actions – connection managers
  setConnectionManagers: (cms: ConnectionManager[]) => void;
  addConnectionManager: (cm: ConnectionManager) => void;
  removeConnectionManager: (id: string) => void;
  updateConnectionManager: (id: string, updates: Partial<ConnectionManager>) => void;

  // Actions – variables
  setVariables: (vars: SsisVariable[]) => void;
  addVariable: (variable: SsisVariable) => void;
  removeVariable: (id: string) => void;
  updateVariable: (id: string, updates: Partial<SsisVariable>) => void;

  // Actions – parameters
  setParameters: (params: SsisParameter[]) => void;
  addParameter: (param: SsisParameter) => void;
  removeParameter: (id: string) => void;
  updateParameter: (id: string, updates: Partial<SsisParameter>) => void;

  // Actions – data flow
  openDataFlow: (taskId: string, model: DataFlowModel) => void;
  closeDataFlow: () => void;
  addDataFlowComponent: (component: DataFlowComponent) => void;
  removeDataFlowComponent: (id: string) => void;
  updateDataFlowComponent: (id: string, updates: Partial<DataFlowComponent>) => void;
  addDataFlowPath: (path: DataFlowPath) => void;
  removeDataFlowPath: (id: string) => void;
  moveDataFlowComponent: (id: string, x: number, y: number) => void;
  setDataFlowCanvas: (nodes: Node<DataFlowComponent>[], edges: Edge<DataFlowPath>[]) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Validation
  runValidation: () => void;
  clearValidation: () => void;
  setValidationResults: (results: ValidationResultEntry[]) => void;

  // Sync
  syncToExtension: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;

/** Executable types that act as containers and can hold child nodes. */
export const CONTAINER_TYPES = new Set(['STOCK:FORLOOP', 'STOCK:FOREACHLOOP', 'STOCK:SEQUENCE']);

/** Header height consumed by the container chrome (top bar + label). */
const CONTAINER_HEADER_HEIGHT = 40;
/** Padding inside the container for child nodes. */
const CONTAINER_PADDING = 15;

/**
 * Find the innermost container node that encloses a given absolute position.
 * Skips the node identified by `excludeId` (so a node can't parent itself).
 */
export function findContainerAtPosition(
  nodes: Node<SsisExecutable>[],
  x: number,
  y: number,
  excludeId?: string,
): Node<SsisExecutable> | undefined {
  // Gather containers with their absolute positions
  const containers: { node: Node<SsisExecutable>; absX: number; absY: number; area: number }[] = [];
  for (const n of nodes) {
    if (excludeId && n.id === excludeId) { continue; }
    if (!CONTAINER_TYPES.has(n.data.executableType)) { continue; }
    // Compute absolute position by walking up the parentNode chain
    let absX = n.position.x;
    let absY = n.position.y;
    let current: Node<SsisExecutable> | undefined = n;
    while (current?.parentNode) {
      const parent = nodes.find(p => p.id === current!.parentNode);
      if (!parent) { break; }
      absX += parent.position.x;
      absY += parent.position.y;
      current = parent;
    }
    const w = (n.style?.width as number) || n.data.width || 300;
    const h = (n.style?.height as number) || n.data.height || 200;
    // Check if point is inside the container body (below the header)
    if (x >= absX && x <= absX + w && y >= absY + CONTAINER_HEADER_HEIGHT && y <= absY + h) {
      containers.push({ node: n, absX, absY, area: w * h });
    }
  }
  if (containers.length === 0) { return undefined; }
  // Return the smallest (innermost) container
  containers.sort((a, b) => a.area - b.area);
  return containers[0].node;
}

// ---------------------------------------------------------------------------
// VS Code API accessor (lazy – only available inside a webview)
// ---------------------------------------------------------------------------

interface VsCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

let _vscodeApi: VsCodeApi | undefined;

function getVsCodeApi(): VsCodeApi | undefined {
  if (_vscodeApi) { return _vscodeApi; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _vscodeApi = (globalThis as any).acquireVsCodeApi?.();
  } catch {
    // Not inside a webview – ignore (e.g. tests)
  }
  return _vscodeApi;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshot(state: CanvasSnapshot): CanvasSnapshot {
  return {
    nodes: state.nodes.map(n => ({ ...n, data: { ...n.data } })),
    edges: state.edges.map(e => ({ ...e, data: e.data ? { ...e.data } : undefined })),
  };
}

function pushHistory(past: CanvasSnapshot[], current: CanvasSnapshot): CanvasSnapshot[] {
  const next = [...past, snapshot(current)];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

/**
 * Sort nodes so that children always appear after their parent in the array.
 * React Flow requires this ordering for `parentNode` rendering to work.
 */
function sortNodesByParentage(nodes: Node<SsisExecutable>[]): Node<SsisExecutable>[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set<string>();
  const result: Node<SsisExecutable>[] = [];

  function visit(id: string) {
    if (visited.has(id)) { return; }
    const node = byId.get(id);
    if (!node) { return; }
    if (node.parentNode) {
      visit(node.parentNode); // ensure parent comes first
    }
    visited.add(id);
    result.push(node);
  }

  for (const n of nodes) {
    visit(n.id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCanvasStore = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  past: [],
  future: [],
  dirty: false,
  connectionManagers: [],
  variables: [],
  parameters: [],
  dataFlowModel: null,
  activeDataFlowTaskId: null,
  dataFlowNodes: [],
  dataFlowEdges: [],
  validationResults: new Map(),
  validationRun: false,

  // ---- Nodes -------------------------------------------------------------

  addNode: (node) => {
    const state = get();
    const newNodes = sortNodesByParentage([...state.nodes, node]);
    set({
      past: pushHistory(state.past, state),
      future: [],
      nodes: newNodes,
      dirty: true,
    });
    get().syncToExtension();
  },

  removeNode: (nodeId) => {
    const state = get();
    // When removing a container, unparent its children back to the canvas
    const removedNode = state.nodes.find(n => n.id === nodeId);
    let updatedNodes = state.nodes.filter(n => n.id !== nodeId);
    if (removedNode && CONTAINER_TYPES.has(removedNode.data.executableType)) {
      updatedNodes = updatedNodes.map(n => {
        if (n.parentId !== nodeId) { return n; }
        // Convert child position to absolute
        const absX = n.position.x + removedNode.position.x;
        const absY = n.position.y + removedNode.position.y;
        const patched = {
          ...n,
          position: { x: absX, y: absY },
          data: { ...n.data, x: absX, y: absY },
        };
        delete (patched as any).parentNode;
        delete (patched as any).extent;
        delete (patched as any).expandParent;
        return patched;
      });
    }
    set({
      past: pushHistory(state.past, state),
      future: [],
      nodes: updatedNodes,
      // Also remove edges connected to this node
      edges: state.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
      dirty: true,
    });
    get().syncToExtension();
  },

  moveNode: (nodeId, x, y) => {
    const state = get();
    set({
      past: pushHistory(state.past, state),
      future: [],
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, position: { x, y }, data: { ...n.data, x, y } }
          : n
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  updateNodeData: (nodeId, data) => {
    const state = get();
    set({
      past: pushHistory(state.past, state),
      future: [],
      nodes: state.nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, ...data } }
          : n
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  reparentNode: (nodeId, parentId) => {
    const state = get();
    const child = state.nodes.find(n => n.id === nodeId);
    if (!child) { return; }
    const currentParent = child.parentNode;
    if (currentParent === parentId) { return; } // no change

    // Compute child's current absolute position
    let absX = child.position.x;
    let absY = child.position.y;
    if (currentParent) {
      const cp = state.nodes.find(n => n.id === currentParent);
      if (cp) { absX += cp.position.x; absY += cp.position.y; }
    }

    // Compute position relative to new parent (or absolute if unparenting)
    let newX = absX;
    let newY = absY;
    if (parentId) {
      const np = state.nodes.find(n => n.id === parentId);
      if (np) {
        newX = absX - np.position.x;
        newY = absY - np.position.y;
      }
      // Clamp inside parent bounds
      newX = Math.max(CONTAINER_PADDING, newX);
      newY = Math.max(CONTAINER_HEADER_HEIGHT, newY);
    }

    // Build the new nodes array — React Flow requires children to appear *after*
    // their parent in the array for `parentNode` rendering to work.
    const updatedNodes = state.nodes.map(n => {
      if (n.id !== nodeId) { return n; }
      const patched: Node<SsisExecutable> = {
        ...n,
        position: { x: newX, y: newY },
        data: { ...n.data, x: newX, y: newY },
        parentNode: parentId,
        extent: parentId ? 'parent' as const : undefined,
        expandParent: parentId ? true : undefined,
      };
      // React Flow: if parentNode is undefined we must *delete* the key, not set undefined
      if (!parentId) {
        delete (patched as any).parentNode;
        delete (patched as any).extent;
        delete (patched as any).expandParent;
      }
      return patched;
    });

    // Ensure child nodes appear after their parent in the array
    const sorted = sortNodesByParentage(updatedNodes);

    set({
      past: pushHistory(state.past, state),
      future: [],
      nodes: sorted,
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Edges --------------------------------------------------------------

  addEdge: (edge) => {
    const state = get();
    set({
      past: pushHistory(state.past, state),
      future: [],
      edges: [...state.edges, edge],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeEdge: (edgeId) => {
    const state = get();
    set({
      past: pushHistory(state.past, state),
      future: [],
      edges: state.edges.filter(e => e.id !== edgeId),
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Bulk ---------------------------------------------------------------

  setCanvas: (nodes, edges) => {
    set({
      nodes,
      edges,
      past: [],
      future: [],
      dirty: false,
    });
  },

  // ---- Connection Managers ------------------------------------------------

  setConnectionManagers: (cms) => {
    set({ connectionManagers: cms });
  },

  addConnectionManager: (cm) => {
    const state = get();
    set({
      connectionManagers: [...state.connectionManagers, cm],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeConnectionManager: (id) => {
    const state = get();
    set({
      connectionManagers: state.connectionManagers.filter(c => c.id !== id),
      dirty: true,
    });
    get().syncToExtension();
  },

  updateConnectionManager: (id, updates) => {
    const state = get();
    set({
      connectionManagers: state.connectionManagers.map(c =>
        c.id === id ? { ...c, ...updates } : c
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Variables ----------------------------------------------------------

  setVariables: (vars) => {
    set({ variables: vars });
  },

  addVariable: (variable) => {
    const state = get();
    set({
      variables: [...state.variables, variable],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeVariable: (id) => {
    const state = get();
    set({
      variables: state.variables.filter(v => v.id !== id),
      dirty: true,
    });
    get().syncToExtension();
  },

  updateVariable: (id, updates) => {
    const state = get();
    set({
      variables: state.variables.map(v =>
        v.id === id ? { ...v, ...updates } : v
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Parameters ---------------------------------------------------------

  setParameters: (params) => {
    set({ parameters: params });
  },

  addParameter: (param) => {
    const state = get();
    set({
      parameters: [...state.parameters, param],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeParameter: (id) => {
    const state = get();
    set({
      parameters: state.parameters.filter(p => p.id !== id),
      dirty: true,
    });
    get().syncToExtension();
  },

  updateParameter: (id, updates) => {
    const state = get();
    set({
      parameters: state.parameters.map(p =>
        p.id === id ? { ...p, ...updates } : p
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Data Flow ----------------------------------------------------------

  openDataFlow: (taskId, model) => {
    set({
      activeDataFlowTaskId: taskId,
      dataFlowModel: model,
    });
  },

  closeDataFlow: () => {
    set({
      activeDataFlowTaskId: null,
      dataFlowModel: null,
      dataFlowNodes: [],
      dataFlowEdges: [],
    });
  },

  setDataFlowCanvas: (nodes, edges) => {
    set({
      dataFlowNodes: nodes,
      dataFlowEdges: edges,
    });
  },

  addDataFlowComponent: (component) => {
    const state = get();
    const nodeType = getDataFlowNodeType(component.componentClassId);
    const node: Node<DataFlowComponent> = {
      id: component.id,
      type: nodeType,
      position: { x: component.x, y: component.y },
      data: component,
    };
    set({
      dataFlowNodes: [...state.dataFlowNodes, node],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeDataFlowComponent: (id) => {
    const state = get();
    set({
      dataFlowNodes: state.dataFlowNodes.filter(n => n.id !== id),
      dataFlowEdges: state.dataFlowEdges.filter(e => e.source !== id && e.target !== id),
      dirty: true,
    });
    get().syncToExtension();
  },

  updateDataFlowComponent: (id, updates) => {
    const state = get();
    set({
      dataFlowNodes: state.dataFlowNodes.map(n =>
        n.id === id ? { ...n, data: { ...n.data, ...updates } } : n
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  addDataFlowPath: (path) => {
    const state = get();
    const edge: Edge<DataFlowPath> = {
      id: path.id,
      source: path.fromOutputId,
      target: path.toInputId,
      type: 'dataPath',
      data: path,
    };
    set({
      dataFlowEdges: [...state.dataFlowEdges, edge],
      dirty: true,
    });
    get().syncToExtension();
  },

  removeDataFlowPath: (id) => {
    const state = get();
    set({
      dataFlowEdges: state.dataFlowEdges.filter(e => e.id !== id),
      dirty: true,
    });
    get().syncToExtension();
  },

  moveDataFlowComponent: (id, x, y) => {
    const state = get();
    set({
      dataFlowNodes: state.dataFlowNodes.map(n =>
        n.id === id
          ? { ...n, position: { x, y }, data: { ...n.data, x, y } }
          : n
      ),
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Validation ---------------------------------------------------------

  runValidation: () => {
    // Request validation from extension host
    const api = getVsCodeApi();
    if (api) {
      api.postMessage({ type: 'runValidation' });
    }
  },

  clearValidation: () => {
    set({ validationResults: new Map(), validationRun: false });
  },

  setValidationResults: (results) => {
    const resultMap = new Map<string, ValidationResultEntry[]>();
    for (const r of results) {
      if (r.nodeId) {
        const list = resultMap.get(r.nodeId) ?? [];
        list.push(r);
        resultMap.set(r.nodeId, list);
      }
    }
    set({ validationResults: resultMap, validationRun: true });
  },

  // ---- History ------------------------------------------------------------

  undo: () => {
    const state = get();
    if (state.past.length === 0) { return; }
    const prev = state.past[state.past.length - 1];
    set({
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, MAX_HISTORY),
      nodes: prev.nodes,
      edges: prev.edges,
      dirty: true,
    });
    get().syncToExtension();
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) { return; }
    const next = state.future[0];
    set({
      past: pushHistory(state.past, state),
      future: state.future.slice(1),
      nodes: next.nodes,
      edges: next.edges,
      dirty: true,
    });
    get().syncToExtension();
  },

  // ---- Extension sync -----------------------------------------------------

  syncToExtension: () => {
    const api = getVsCodeApi();
    if (!api) { return; }
    const state = get();
    api.postMessage({
      type: 'canvasStateChanged',
      nodes: state.nodes,
      edges: state.edges,
      connectionManagers: state.connectionManagers,
      variables: state.variables,
      parameters: state.parameters,
      activeDataFlowTaskId: state.activeDataFlowTaskId,
      dataFlowNodes: state.dataFlowNodes,
      dataFlowEdges: state.dataFlowEdges,
    });
  },
}));
