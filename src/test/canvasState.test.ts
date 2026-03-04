/**
 * Tests for CanvasState Zustand store – node/edge CRUD and undo/redo.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore, CanvasState } from '../canvas/shared/CanvasState';
import { Node, Edge } from 'reactflow';
import { SsisExecutable, PrecedenceConstraint } from '../models/SsisPackageModel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(id: string, x = 0, y = 0): Node<SsisExecutable> {
  return {
    id,
    type: 'genericTask',
    position: { x, y },
    data: {
      id,
      dtsId: `{${id}}`,
      objectName: `Task ${id}`,
      executableType: 'Microsoft.ExecuteSQLTask',
      description: '',
      x,
      y,
      width: 150,
      height: 50,
      properties: {},
      connectionRefs: [],
      variables: [],
      unknownElements: [],
    },
  };
}

function makeEdge(id: string, source: string, target: string): Edge<PrecedenceConstraint> {
  return {
    id,
    source,
    target,
    data: {
      id,
      fromExecutableId: source,
      toExecutableId: target,
      constraintType: 'Success',
      logicalAnd: true,
      value: 0,
      unknownElements: [],
    },
  };
}

/** Reset the store between tests */
function resetStore(): void {
  useCanvasStore.setState({
    nodes: [],
    edges: [],
    past: [],
    future: [],
    dirty: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

describe('CanvasState – node operations', () => {
  it('should add a node', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1', 10, 20));

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('n1');
    expect(state.dirty).toBe(true);
  });

  it('should remove a node', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    store.addNode(makeNode('n2'));
    store.removeNode('n1');

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('n2');
  });

  it('should remove connected edges when removing a node', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    store.addNode(makeNode('n2'));
    store.addEdge(makeEdge('e1', 'n1', 'n2'));
    store.removeNode('n1');

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
  });

  it('should move a node', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1', 0, 0));
    store.moveNode('n1', 100, 200);

    const state = useCanvasStore.getState();
    expect(state.nodes[0].position.x).toBe(100);
    expect(state.nodes[0].position.y).toBe(200);
    expect(state.nodes[0].data.x).toBe(100);
    expect(state.nodes[0].data.y).toBe(200);
  });

  it('should update node data', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    store.updateNodeData('n1', { objectName: 'Renamed Task' });

    const state = useCanvasStore.getState();
    expect(state.nodes[0].data.objectName).toBe('Renamed Task');
  });
});

describe('CanvasState – edge operations', () => {
  it('should add an edge', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    store.addNode(makeNode('n2'));
    store.addEdge(makeEdge('e1', 'n1', 'n2'));

    const state = useCanvasStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].source).toBe('n1');
    expect(state.edges[0].target).toBe('n2');
  });

  it('should remove an edge', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    store.addNode(makeNode('n2'));
    store.addEdge(makeEdge('e1', 'n1', 'n2'));
    store.removeEdge('e1');

    const state = useCanvasStore.getState();
    expect(state.edges).toHaveLength(0);
  });
});

describe('CanvasState – undo/redo', () => {
  it('should undo an addNode', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    expect(useCanvasStore.getState().nodes).toHaveLength(1);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('should redo after undo', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().nodes).toHaveLength(1);
  });

  it('should support multiple undo steps', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    useCanvasStore.getState().addNode(makeNode('n2'));
    useCanvasStore.getState().addNode(makeNode('n3'));

    expect(useCanvasStore.getState().nodes).toHaveLength(3);

    useCanvasStore.getState().undo(); // remove n3
    expect(useCanvasStore.getState().nodes).toHaveLength(2);

    useCanvasStore.getState().undo(); // remove n2
    expect(useCanvasStore.getState().nodes).toHaveLength(1);

    useCanvasStore.getState().undo(); // remove n1
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('should clear future on new action after undo', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));
    useCanvasStore.getState().addNode(makeNode('n2'));

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().future).toHaveLength(1);

    // New action should clear future
    useCanvasStore.getState().addNode(makeNode('n3'));
    expect(useCanvasStore.getState().future).toHaveLength(0);
    expect(useCanvasStore.getState().nodes).toHaveLength(2); // n1, n3
  });

  it('should not crash on undo with empty history', () => {
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });

  it('should not crash on redo with empty future', () => {
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().nodes).toHaveLength(0);
  });
});

describe('CanvasState – setCanvas', () => {
  it('should set canvas and reset history', () => {
    const store = useCanvasStore.getState();
    store.addNode(makeNode('n1'));

    useCanvasStore.getState().setCanvas(
      [makeNode('a'), makeNode('b')],
      [makeEdge('e1', 'a', 'b')]
    );

    const state = useCanvasStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });
});
