/**
 * DataFlowPanel – extension-host side panel manager for data flow operations.
 *
 * Handles messages from the webview related to data flow components and paths.
 * Works with the data flow model embedded inside a Data Flow Task executable.
 */

import * as vscode from 'vscode';
import { DtsxSerializer } from '../canvas/shared/DtsxSerializer';
import { SsisPackageModel, SsisExecutable } from '../models/SsisPackageModel';
import {
  DataFlowModel,
  DataFlowComponent,
  DataFlowPath,
} from '../models/DataFlowModel';
import { getDataFlowNodeType } from '../models/CanvasModel';
import { Node, Edge } from 'reactflow';

export class DataFlowPanel {
  private serializer: DtsxSerializer;
  private dataFlowModel: DataFlowModel | null = null;
  private executableId: string | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument,
    private readonly webview: vscode.Webview
  ) {
    this.serializer = new DtsxSerializer();
  }

  /**
   * Open the data flow for the given executable (Data Flow Task).
   * Parses the package, finds the executable, extracts the DataFlowModel,
   * and sends it to the webview.
   */
  public openDataFlow(executableId: string): void {
    this.executableId = executableId;

    try {
      const model = this.serializer.parse(this.document.getText());
      const executable = this.findExecutable(model.executables, executableId);

      if (!executable) {
        vscode.window.showErrorMessage(`Data Flow Task not found: ${executableId}`);
        return;
      }

      // Extract or create data flow model from the executable
      this.dataFlowModel = this.extractDataFlowModel(executable);

      // Convert to React Flow nodes and edges
      const nodes: Node<DataFlowComponent>[] = this.dataFlowModel.components.map((c) => ({
        id: c.id,
        type: getDataFlowNodeType(c.componentClassId),
        position: { x: c.x, y: c.y },
        data: c,
      }));

      const edges: Edge<DataFlowPath>[] = this.dataFlowModel.paths.map((p) => ({
        id: p.id,
        source: p.fromOutputId,
        target: p.toInputId,
        type: 'dataPath',
        data: p,
      }));

      this.webview.postMessage({
        type: 'openDataFlow',
        executableId,
        executableName: executable.objectName,
        dataFlowModel: this.dataFlowModel,
        nodes,
        edges,
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to parse data flow: ${err}`);
    }
  }

  /**
   * Handle messages from the webview related to data flow.
   */
  public handleMessage(message: any): boolean {
    switch (message.type) {
      case 'addComponent':
        return this.handleAddComponent(message.component);

      case 'removeComponent':
        return this.handleRemoveComponent(message.componentId);

      case 'updateComponent':
        return this.handleUpdateComponent(message.componentId, message.updates);

      case 'addPath':
        return this.handleAddPath(message.path);

      case 'removePath':
        return this.handleRemovePath(message.pathId);

      case 'dataFlowStateChanged':
        return this.handleDataFlowStateChanged(message);

      default:
        return false;
    }
  }

  /**
   * Find an executable by ID (supports nested containers).
   */
  private findExecutable(
    executables: SsisExecutable[],
    id: string
  ): SsisExecutable | undefined {
    for (const exec of executables) {
      if (exec.id === id) { return exec; }
      // If the executable has children (containers), search recursively
      if ((exec as any).executables) {
        const found = this.findExecutable((exec as any).executables, id);
        if (found) { return found; }
      }
    }
    return undefined;
  }

  /**
   * Extract DataFlowModel from an executable's ObjectData / pipeline metadata.
   */
  private extractDataFlowModel(executable: SsisExecutable): DataFlowModel {
    // The data flow model is stored in the executable's properties or unknownElements
    // In a real SSIS package, this comes from the <pipeline> element within <ObjectData>
    const pipelineData = (executable as any).dataFlowModel;
    if (pipelineData) {
      return pipelineData as DataFlowModel;
    }

    // Return an empty model if none exists yet
    return {
      components: [],
      paths: [],
      unknownElements: executable.unknownElements ?? [],
    };
  }

  /**
   * Serialize the current data flow state back into the document.
   */
  private async serializeToDocument(): Promise<void> {
    if (!this.dataFlowModel || !this.executableId) { return; }

    try {
      const model = this.serializer.parse(this.document.getText());
      const executable = this.findExecutable(model.executables, this.executableId);
      if (executable) {
        (executable as any).dataFlowModel = this.dataFlowModel;
      }

      const xml = this.serializer.serialize(model, this.document.getText());
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        this.document.uri,
        new vscode.Range(0, 0, this.document.lineCount, 0),
        xml
      );
      await vscode.workspace.applyEdit(edit);
    } catch (err) {
      console.error('Failed to serialize data flow model:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Message handlers
  // -----------------------------------------------------------------------

  private handleAddComponent(component: DataFlowComponent): boolean {
    if (!this.dataFlowModel) { return false; }
    this.dataFlowModel.components.push(component);
    this.serializeToDocument();
    return true;
  }

  private handleRemoveComponent(componentId: string): boolean {
    if (!this.dataFlowModel) { return false; }
    this.dataFlowModel.components = this.dataFlowModel.components.filter(
      (c) => c.id !== componentId
    );
    // Also remove any connected paths
    this.dataFlowModel.paths = this.dataFlowModel.paths.filter(
      (p) => p.fromOutputId !== componentId && p.toInputId !== componentId
    );
    this.serializeToDocument();
    return true;
  }

  private handleUpdateComponent(
    componentId: string,
    updates: Partial<DataFlowComponent>
  ): boolean {
    if (!this.dataFlowModel) { return false; }
    this.dataFlowModel.components = this.dataFlowModel.components.map((c) =>
      c.id === componentId ? { ...c, ...updates } : c
    );
    this.serializeToDocument();
    return true;
  }

  private handleAddPath(path: DataFlowPath): boolean {
    if (!this.dataFlowModel) { return false; }
    this.dataFlowModel.paths.push(path);
    this.serializeToDocument();
    return true;
  }

  private handleRemovePath(pathId: string): boolean {
    if (!this.dataFlowModel) { return false; }
    this.dataFlowModel.paths = this.dataFlowModel.paths.filter(
      (p) => p.id !== pathId
    );
    this.serializeToDocument();
    return true;
  }

  private handleDataFlowStateChanged(message: any): boolean {
    if (!this.dataFlowModel) { return false; }

    // Update components from node data
    if (message.dataFlowNodes) {
      this.dataFlowModel.components = message.dataFlowNodes.map((n: Node<DataFlowComponent>) => ({
        ...n.data,
        x: n.position?.x ?? n.data.x,
        y: n.position?.y ?? n.data.y,
      }));
    }

    // Update paths from edge data
    if (message.dataFlowEdges) {
      this.dataFlowModel.paths = message.dataFlowEdges
        .filter((e: Edge<DataFlowPath>) => e.data)
        .map((e: Edge<DataFlowPath>) => e.data!);
    }

    this.serializeToDocument();
    return true;
  }

  /** Dispose resources. */
  public dispose(): void {
    this.dataFlowModel = null;
    this.executableId = null;
  }
}
