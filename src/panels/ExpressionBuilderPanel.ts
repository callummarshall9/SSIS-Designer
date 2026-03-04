/**
 * ExpressionBuilderPanel (extension host side) — message relay for expression editing.
 *
 * Handles expression validation requests from the webview,
 * provides variable/column lists from the current package/data-flow model,
 * and saves expression changes back to the model.
 */

import {
  SsisPackageModel,
  SsisVariable,
  SsisExecutable,
} from '../models/SsisPackageModel';
import {
  DataFlowModel,
  DataFlowColumn,
} from '../models/DataFlowModel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpressionContext {
  /** Where the expression is used */
  target: 'variable' | 'property' | 'constraint' | 'derivedColumn';
  /** ID of the owning element (variable ID, executable ID, constraint ID, etc.) */
  targetId: string;
  /** Property key on the target (e.g., 'Expression', 'EvalExpression') */
  propertyKey: string;
}

// ---------------------------------------------------------------------------
// ExpressionBuilderPanelRelay
// ---------------------------------------------------------------------------

export class ExpressionBuilderPanelRelay {
  constructor(
    private readonly model: () => SsisPackageModel | undefined,
    private readonly dataFlowModel: () => DataFlowModel | null,
    private readonly onModelChanged: () => void,
  ) {}

  /**
   * Handle a message from the webview related to expression editing.
   *
   * Message shapes:
   *  - { type: 'getExpressionContext', context: ExpressionContext }
   *  - { type: 'saveExpression', context: ExpressionContext, expression: string }
   *  - { type: 'getExpressionVariables' }
   *  - { type: 'getExpressionColumns', componentId?: string }
   */
  public handleMessage(message: any): any | undefined {
    const pkg = this.model();
    if (!pkg) { return undefined; }

    switch (message.type) {
      case 'getExpressionVariables':
        return {
          type: 'expressionVariables',
          variables: this.collectVariables(pkg),
        };

      case 'getExpressionColumns':
        return {
          type: 'expressionColumns',
          columns: this.collectColumns(message.componentId),
        };

      case 'saveExpression':
        return this.saveExpression(pkg, message.context, message.expression);

      default:
        return undefined;
    }
  }

  // -----------------------------------------------------------------------
  // Collect variables
  // -----------------------------------------------------------------------

  /**
   * Collect all variables visible in the current scope.
   * Includes package-level variables and container-scoped variables.
   */
  private collectVariables(pkg: SsisPackageModel): SsisVariable[] {
    const vars: SsisVariable[] = [];

    // Package-level variables
    if (pkg.variables) {
      vars.push(...pkg.variables);
    }

    // Walk executables to collect container-scoped variables
    const walkExecutables = (executables: SsisExecutable[]) => {
      for (const exec of executables) {
        if (exec.variables && exec.variables.length > 0) {
          vars.push(...exec.variables);
        }
        if (exec.children) {
          walkExecutables(exec.children);
        }
      }
    };

    if (pkg.executables) {
      walkExecutables(pkg.executables);
    }

    return vars;
  }

  // -----------------------------------------------------------------------
  // Collect columns
  // -----------------------------------------------------------------------

  /**
   * Collect available data flow columns for expression editing.
   * If a componentId is provided, returns columns available to that component.
   */
  private collectColumns(componentId?: string): DataFlowColumn[] {
    const dfModel = this.dataFlowModel();
    if (!dfModel) { return []; }

    const columns: DataFlowColumn[] = [];

    if (componentId) {
      // Find the specific component and its upstream columns
      const component = dfModel.components.find(c => c.id === componentId);
      if (component) {
        // Collect output columns from upstream components
        for (const path of dfModel.paths) {
          for (const input of component.inputs) {
            if (path.toInputId === input.refId) {
              // Find the source component output
              for (const srcComp of dfModel.components) {
                for (const output of srcComp.outputs) {
                  if (output.refId === path.fromOutputId && !output.isErrorOutput) {
                    columns.push(...output.columns);
                  }
                }
              }
            }
          }
        }
        // Also include the component's own input columns
        for (const input of component.inputs) {
          columns.push(...input.columns);
        }
      }
    } else {
      // Collect all non-error-output columns from all components
      for (const comp of dfModel.components) {
        for (const output of comp.outputs) {
          if (!output.isErrorOutput) {
            columns.push(...output.columns);
          }
        }
      }
    }

    return columns;
  }

  // -----------------------------------------------------------------------
  // Save expression
  // -----------------------------------------------------------------------

  /**
   * Save an expression back to the model.
   */
  private saveExpression(
    pkg: SsisPackageModel,
    context: ExpressionContext,
    expression: string,
  ): { type: string; success: boolean } {
    try {
      switch (context.target) {
        case 'variable': {
          const variable = this.findVariable(pkg, context.targetId);
          if (variable) {
            variable.expression = expression;
            variable.evaluateAsExpression = expression.length > 0;
            this.onModelChanged();
            return { type: 'expressionSaved', success: true };
          }
          break;
        }

        case 'property': {
          const exec = this.findExecutable(pkg.executables, context.targetId);
          if (exec) {
            exec.properties[context.propertyKey] = expression;
            this.onModelChanged();
            return { type: 'expressionSaved', success: true };
          }
          break;
        }

        case 'constraint': {
          const constraint = this.findConstraint(pkg, context.targetId);
          if (constraint) {
            constraint.expression = expression;
            this.onModelChanged();
            return { type: 'expressionSaved', success: true };
          }
          break;
        }

        case 'derivedColumn': {
          const dfModel = this.dataFlowModel();
          if (dfModel) {
            for (const comp of dfModel.components) {
              for (const output of comp.outputs) {
                const col = output.columns.find(c => c.id === context.targetId);
                if (col) {
                  col.expression = expression;
                  this.onModelChanged();
                  return { type: 'expressionSaved', success: true };
                }
              }
            }
          }
          break;
        }
      }

      return { type: 'expressionSaved', success: false };
    } catch {
      return { type: 'expressionSaved', success: false };
    }
  }

  // -----------------------------------------------------------------------
  // Finders
  // -----------------------------------------------------------------------

  private findVariable(pkg: SsisPackageModel, variableId: string): SsisVariable | undefined {
    // Check package-level variables
    const pkgVar = pkg.variables?.find(v => v.id === variableId);
    if (pkgVar) { return pkgVar; }

    // Check executable-scoped variables
    const findInExecs = (executables: SsisExecutable[]): SsisVariable | undefined => {
      for (const exec of executables) {
        const found = exec.variables?.find(v => v.id === variableId);
        if (found) { return found; }
        if (exec.children) {
          const childFound = findInExecs(exec.children);
          if (childFound) { return childFound; }
        }
      }
      return undefined;
    };

    return pkg.executables ? findInExecs(pkg.executables) : undefined;
  }

  private findExecutable(executables: SsisExecutable[], execId: string): SsisExecutable | undefined {
    for (const exec of executables) {
      if (exec.id === execId) { return exec; }
      if (exec.children) {
        const found = this.findExecutable(exec.children, execId);
        if (found) { return found; }
      }
    }
    return undefined;
  }

  private findConstraint(pkg: SsisPackageModel, constraintId: string) {
    const found = pkg.precedenceConstraints?.find(c => c.id === constraintId);
    if (found) { return found; }

    // Check child constraints
    const findInExecs = (executables: SsisExecutable[]): any => {
      for (const exec of executables) {
        const c = exec.childConstraints?.find(cc => cc.id === constraintId);
        if (c) { return c; }
        if (exec.children) {
          const cf = findInExecs(exec.children);
          if (cf) { return cf; }
        }
      }
      return undefined;
    };

    return pkg.executables ? findInExecs(pkg.executables) : undefined;
  }
}
