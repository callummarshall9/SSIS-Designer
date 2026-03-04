import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Node, Edge } from 'reactflow';

import ControlFlowCanvas from '../src/canvas/ControlFlowCanvas';
import DataFlowCanvas from '../src/canvas/DataFlowCanvas';
import TaskPalette from '../src/canvas/palette/TaskPalette';
import ComponentPalette from '../src/canvas/palette/ComponentPalette';
import PropertyPanel from '../src/canvas/PropertyPanel';
import VariablePanel from '../src/canvas/VariablePanel';
import ParameterPanel from '../src/canvas/ParameterPanel';
import ConnectionManagerPanel from '../src/canvas/ConnectionManagerPanel';
import ValidationOverlay from '../src/canvas/ValidationOverlay';
import ExecutionHistoryPanel from '../src/canvas/ExecutionHistoryPanel';
import EnvironmentEditor from '../src/canvas/EnvironmentEditor';
import EnvironmentReferenceEditor from '../src/canvas/EnvironmentReferenceEditor';
import { useCanvasStore } from '../src/canvas/shared/CanvasState';
import {
  SsisPackageModel,
  SsisVariable,
  SsisParameter,
  ConnectionManager,
} from '../src/models/SsisPackageModel';
import { DataFlowModel } from '../src/models/DataFlowModel';

// ---------------------------------------------------------------------------
// VS Code API
// ---------------------------------------------------------------------------

interface VsCodeApi {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

let vscodeApi: VsCodeApi | undefined;

function getVsCodeApi(): VsCodeApi | undefined {
  if (vscodeApi) { return vscodeApi; }
  try {
    vscodeApi = (globalThis as any).acquireVsCodeApi?.();
    // Store on globalThis so other components can access it
    if (vscodeApi) {
      (globalThis as any)._vscodeApi = vscodeApi;
    }
  } catch {
    // Not in a webview
  }
  return vscodeApi;
}

// ---------------------------------------------------------------------------
// View mode type
// ---------------------------------------------------------------------------

type ViewMode = 'controlFlow' | 'dataFlow';

// ---------------------------------------------------------------------------
// Resizable sidebar hook
// ---------------------------------------------------------------------------

function useResizable(
  side: 'left' | 'right',
  defaultWidth: number,
  minWidth: number,
  maxWidth: number
) {
  const [width, setWidth] = useState(defaultWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(defaultWidth);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) { return; }
        const delta = side === 'left'
          ? ev.clientX - startX.current
          : startX.current - ev.clientX;
        const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth.current + delta));
        setWidth(newWidth);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width, side, minWidth, maxWidth]
  );

  return { width, onMouseDown };
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [variablesCollapsed, setVariablesCollapsed] = useState(true);
  const [parametersCollapsed, setParametersCollapsed] = useState(true);
  const [bottomTab, setBottomTab] = useState<'variables' | 'parameters'>('variables');
  const [connMgrVisible, setConnMgrVisible] = useState(false);
  const [model, setModel] = useState<SsisPackageModel | null>(null);
  const [variables, setVariables] = useState<SsisVariable[]>([]);
  const [parameters, setParameters] = useState<SsisParameter[]>([]);
  const [connectionManagers, setConnectionManagers] = useState<{ id: string; name: string }[]>([]);

  // Data flow view mode
  const [viewMode, setViewMode] = useState<ViewMode>('controlFlow');
  const [dataFlowTaskName, setDataFlowTaskName] = useState<string>('');

  // Overlay panels
  const [executionHistoryVisible, setExecutionHistoryVisible] = useState(false);
  const [environmentEditorVisible, setEnvironmentEditorVisible] = useState(false);
  const [envRefEditorVisible, setEnvRefEditorVisible] = useState(false);
  const [connectedToServer, setConnectedToServer] = useState(false);

  // Resizable sidebars
  const leftResize = useResizable('left', 250, 150, 500);
  const rightResize = useResizable('right', 300, 150, 600);

  const setCanvas = useCanvasStore((s) => s.setCanvas);
  const setStoreConnectionManagers = useCanvasStore((s) => s.setConnectionManagers);
  const setStoreVariables = useCanvasStore((s) => s.setVariables);
  const setStoreParameters = useCanvasStore((s) => s.setParameters);
  const openDataFlow = useCanvasStore((s) => s.openDataFlow);
  const closeDataFlow = useCanvasStore((s) => s.closeDataFlow);
  const setDataFlowCanvas = useCanvasStore((s) => s.setDataFlowCanvas);
  const setValidationResults = useCanvasStore((s) => s.setValidationResults);
  const clearValidation = useCanvasStore((s) => s.clearValidation);
  const nodes = useCanvasStore((s) => s.nodes);

  // -----------------------------------------------------------------------
  // Message handler — receive model from extension host
  // -----------------------------------------------------------------------

  useEffect(() => {
    const api = getVsCodeApi();

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case 'loadModel': {
          const pkg = message.model as SsisPackageModel;
          setModel(pkg);
          setVariables(pkg.variables ?? []);
          setParameters(pkg.parameters ?? []);
          const cms = pkg.connectionManagers ?? [];
          setConnectionManagers(
            cms.map((cm: ConnectionManager) => ({
              id: cm.dtsId,
              name: cm.objectName,
            }))
          );
          // Sync to store
          setStoreConnectionManagers(cms);
          setStoreVariables(pkg.variables ?? []);
          setStoreParameters(pkg.parameters ?? []);
          // Initialize canvas store with nodes and edges
          setCanvas(message.nodes ?? [], message.edges ?? []);
          // Reset to control flow view
          setViewMode('controlFlow');
          break;
        }
        case 'openDataFlow': {
          // Received from extension host with data flow model data
          const dfModel = message.dataFlowModel as DataFlowModel;
          const taskName = message.executableName ?? 'Data Flow Task';
          setDataFlowTaskName(taskName);
          openDataFlow(message.executableId, dfModel);
          setDataFlowCanvas(message.nodes ?? [], message.edges ?? []);
          setViewMode('dataFlow');
          break;
        }
        case 'update': {
          // Raw XML update — will need to re-parse
          // The extension host handles this via DtsxEditorProvider
          break;
        }
        case 'validationResults': {
          setValidationResults(message.results ?? []);
          break;
        }
        case 'clearValidation': {
          clearValidation();
          break;
        }
        case 'serverConnected': {
          setConnectedToServer(true);
          break;
        }
        case 'serverDisconnected': {
          setConnectedToServer(false);
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Signal the extension that the webview is ready
    api?.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [setCanvas, setStoreConnectionManagers, setStoreVariables, setStoreParameters, openDataFlow, closeDataFlow, setDataFlowCanvas, setValidationResults, clearValidation]);

  // -----------------------------------------------------------------------
  // Variable changes → relay to extension host
  // -----------------------------------------------------------------------

  const handleVariablesChange = useCallback(
    (newVars: SsisVariable[]) => {
      setVariables(newVars);
      setStoreVariables(newVars);
      const api = getVsCodeApi();
      api?.postMessage({
        type: 'updateVariables',
        variables: newVars,
        scope: 'Package',
      });
    },
    [setStoreVariables]
  );

  // -----------------------------------------------------------------------
  // Parameter changes → relay to extension host
  // -----------------------------------------------------------------------

  const handleParametersChange = useCallback(
    (newParams: SsisParameter[]) => {
      setParameters(newParams);
      setStoreParameters(newParams);
      const api = getVsCodeApi();
      api?.postMessage({
        type: 'updateParameters',
        parameters: newParams,
      });
    },
    [setStoreParameters]
  );

  // -----------------------------------------------------------------------
  // Keyboard shortcuts
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+V → toggle variables panel
      if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        setBottomTab('variables');
        setVariablesCollapsed(false);
        setParametersCollapsed(true);
      }
      // Ctrl+Shift+P → toggle parameters panel
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        setBottomTab('parameters');
        setParametersCollapsed(false);
        setVariablesCollapsed(true);
      }
      // Ctrl+Shift+C → toggle connection manager panel
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        setConnMgrVisible((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // -----------------------------------------------------------------------
  // Detect VS Code theme
  // -----------------------------------------------------------------------

  useEffect(() => {
    const body = document.body;
    const updateTheme = () => {
      const isDark =
        body.classList.contains('vscode-dark') ||
        body.getAttribute('data-vscode-theme-kind') === 'vscode-dark';
      body.classList.toggle('ssis-theme-dark', isDark);
      body.classList.toggle('ssis-theme-light', !isDark);
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
    return () => observer.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Back to control flow handler
  // -----------------------------------------------------------------------

  const handleBackToControlFlow = useCallback(() => {
    closeDataFlow();
    setViewMode('controlFlow');
    setDataFlowTaskName('');
  }, [closeDataFlow]);

  // -----------------------------------------------------------------------
  // Render 3-panel layout
  // -----------------------------------------------------------------------

  const isDataFlow = viewMode === 'dataFlow';

  return (
    <div className="ssis-layout">
      {/* Left sidebar — Task Palette or Component Palette */}
      <div style={paletteCollapsed ? undefined : { width: leftResize.width, minWidth: leftResize.width }}>
        {isDataFlow ? (
          <ComponentPalette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed(!paletteCollapsed)}
          />
        ) : (
          <TaskPalette
            collapsed={paletteCollapsed}
            onToggle={() => setPaletteCollapsed(!paletteCollapsed)}
          />
        )}
      </div>

      {/* Left resize handle */}
      {!paletteCollapsed && (
        <div className="ssis-resize-handle ssis-resize-handle--left" onMouseDown={leftResize.onMouseDown} />
      )}

      {/* Center column */}
      <div className="ssis-center">
        {/* Breadcrumb (data flow mode) */}
        {isDataFlow && (
          <div className="ssis-breadcrumb">
            <button
              className="ssis-breadcrumb__back-btn"
              onClick={handleBackToControlFlow}
              title="Back to Control Flow"
            >
              ← Back
            </button>
            <span className="ssis-breadcrumb__separator">/</span>
            <span className="ssis-breadcrumb__item">
              {model?.packageName ?? 'Package'}
            </span>
            <span className="ssis-breadcrumb__separator">›</span>
            <span className="ssis-breadcrumb__item ssis-breadcrumb__item--active">
              {dataFlowTaskName}
            </span>
          </div>
        )}

        {/* Toolbar */}
        <div className="ssis-toolbar">
          {isDataFlow && (
            <button
              className="ssis-toolbar__btn ssis-toolbar__btn--back"
              onClick={handleBackToControlFlow}
              title="Back to Control Flow"
            >
              ◀ Control Flow
            </button>
          )}
          <button
            className="ssis-toolbar__btn"
            onClick={() => setConnMgrVisible(true)}
            title="Connection Managers (Ctrl+Shift+C)"
          >
            🔗 Connection Managers
          </button>
          {connectedToServer && (
            <button
              className="ssis-toolbar__btn"
              onClick={() => setExecutionHistoryVisible(true)}
              title="View Execution History"
            >
              📋 View History
            </button>
          )}
        </div>

        {/* Canvas */}
        <div className="ssis-canvas-wrapper">
          {isDataFlow ? (
            <DataFlowCanvas
              onBackToControlFlow={handleBackToControlFlow}
              taskName={dataFlowTaskName}
            />
          ) : (
            <ControlFlowCanvas />
          )}
        </div>

        {/* Bottom panel tab bar */}
        <div className="ssis-bottom-tabs">
          <button
            className={`ssis-bottom-tabs__tab ${bottomTab === 'variables' ? 'ssis-bottom-tabs__tab--active' : ''}`}
            onClick={() => {
              setBottomTab('variables');
              setVariablesCollapsed(false);
              setParametersCollapsed(true);
            }}
          >
            Variables
          </button>
          <button
            className={`ssis-bottom-tabs__tab ${bottomTab === 'parameters' ? 'ssis-bottom-tabs__tab--active' : ''}`}
            onClick={() => {
              setBottomTab('parameters');
              setParametersCollapsed(false);
              setVariablesCollapsed(true);
            }}
          >
            Parameters
          </button>
        </div>

        {/* Bottom — Variable Panel */}
        {bottomTab === 'variables' && (
          <VariablePanel
            variables={variables}
            onVariablesChange={handleVariablesChange}
            collapsed={variablesCollapsed}
            onToggle={() => setVariablesCollapsed(!variablesCollapsed)}
            scope={model?.packageName ?? 'Package'}
          />
        )}

        {/* Bottom — Parameter Panel */}
        {bottomTab === 'parameters' && (
          <ParameterPanel
            parameters={parameters}
            onParametersChange={handleParametersChange}
            collapsed={parametersCollapsed}
            onToggle={() => setParametersCollapsed(!parametersCollapsed)}
          />
        )}
      </div>

      {/* Right resize handle */}
      {!propertiesCollapsed && (
        <div className="ssis-resize-handle ssis-resize-handle--right" onMouseDown={rightResize.onMouseDown} />
      )}

      {/* Right sidebar — Property Panel */}
      <div style={propertiesCollapsed ? undefined : { width: rightResize.width, minWidth: rightResize.width }}>
        <PropertyPanel
          collapsed={propertiesCollapsed}
          onToggle={() => setPropertiesCollapsed(!propertiesCollapsed)}
          connectionManagers={connectionManagers}
        />
      </div>

      {/* Connection Manager Panel (modal overlay) */}
      <ConnectionManagerPanel
        visible={connMgrVisible}
        onClose={() => setConnMgrVisible(false)}
      />

      {/* Validation Overlay */}
      <ValidationOverlay nodeIds={nodes.map(n => n.id)} />

      {/* Execution History Panel (modal overlay) */}
      <ExecutionHistoryPanel
        visible={executionHistoryVisible}
        onClose={() => setExecutionHistoryVisible(false)}
      />

      {/* Environment Editor (modal overlay) */}
      <EnvironmentEditor
        visible={environmentEditorVisible}
        onClose={() => setEnvironmentEditorVisible(false)}
      />

      {/* Environment Reference Editor (modal overlay) */}
      <EnvironmentReferenceEditor
        visible={envRefEditorVisible}
        onClose={() => setEnvRefEditorVisible(false)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
