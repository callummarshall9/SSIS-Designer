/**
 * VariablePanel (extension host side) – handles variable add/edit/delete
 * messages from the webview and applies them to the document model.
 */

import { SsisPackageModel, SsisVariable, SsisExecutable } from '../models/SsisPackageModel';

export class VariablePanelRelay {
  constructor(
    private readonly model: () => SsisPackageModel | undefined,
    private readonly onModelChanged: () => void
  ) {}

  /**
   * Handle variable messages from the webview.
   *
   * @param message Message with shape:
   *  { type: 'addVariable' | 'updateVariable' | 'deleteVariable', variable?: SsisVariable, variableId?: string, scope?: string }
   */
  public handleMessage(message: any): boolean {
    const model = this.model();
    if (!model) { return false; }

    switch (message.type) {
      case 'addVariable':
        return this.addVariable(model, message.variable, message.scope);

      case 'updateVariable':
        return this.updateVariable(model, message.variable, message.scope);

      case 'deleteVariable':
        return this.deleteVariable(model, message.variableId, message.scope);

      case 'updateVariables':
        return this.replaceVariables(model, message.variables, message.scope);

      default:
        return false;
    }
  }

  private addVariable(model: SsisPackageModel, variable: SsisVariable, scope?: string): boolean {
    const container = this.resolveScope(model, scope);
    if (!container) { return false; }

    if (Array.isArray(container)) {
      container.push(variable);
    } else {
      container.variables.push(variable);
    }

    this.onModelChanged();
    return true;
  }

  private updateVariable(model: SsisPackageModel, variable: SsisVariable, scope?: string): boolean {
    const container = this.resolveScope(model, scope);
    if (!container) { return false; }

    const vars = Array.isArray(container) ? container : container.variables;
    const idx = vars.findIndex((v: SsisVariable) => v.id === variable.id);
    if (idx === -1) { return false; }
    vars[idx] = variable;

    this.onModelChanged();
    return true;
  }

  private deleteVariable(model: SsisPackageModel, variableId: string, scope?: string): boolean {
    const container = this.resolveScope(model, scope);
    if (!container) { return false; }

    if (Array.isArray(container)) {
      const idx = container.findIndex((v: SsisVariable) => v.id === variableId);
      if (idx === -1) { return false; }
      container.splice(idx, 1);
    } else {
      const idx = container.variables.findIndex((v: SsisVariable) => v.id === variableId);
      if (idx === -1) { return false; }
      container.variables.splice(idx, 1);
    }

    this.onModelChanged();
    return true;
  }

  private replaceVariables(model: SsisPackageModel, variables: SsisVariable[], scope?: string): boolean {
    if (!scope || scope === 'Package') {
      model.variables = variables;
    } else {
      const exec = findExecutable(model.executables, scope);
      if (!exec) { return false; }
      exec.variables = variables;
    }

    this.onModelChanged();
    return true;
  }

  /**
   * Resolve the scope to either the package-level variables array
   * or an executable's variables array.
   */
  private resolveScope(
    model: SsisPackageModel,
    scope?: string
  ): SsisVariable[] | SsisExecutable | null {
    if (!scope || scope === 'Package') {
      return model.variables;
    }
    const exec = findExecutable(model.executables, scope);
    return exec ?? null;
  }
}

/** Recursively find an executable by ID. */
function findExecutable(executables: SsisExecutable[], id: string): SsisExecutable | undefined {
  for (const exec of executables) {
    if (exec.id === id) { return exec; }
    if (exec.children) {
      const found = findExecutable(exec.children, id);
      if (found) { return found; }
    }
  }
  return undefined;
}
