/**
 * PackageValidator – runs offline validation checks on a parsed SSIS package model.
 */

import { DtsxSerializer } from '../canvas/shared/DtsxSerializer';
import {
  SsisPackageModel,
  SsisExecutable,
  SsisVariable,
  ConnectionManager,
  PrecedenceConstraint,
} from '../models/SsisPackageModel';
import { validateExpression } from '../canvas/expression/ExpressionValidator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationResult {
  severity: ValidationSeverity;
  message: string;
  /** Dotted path to the task or component, e.g., "Package\\ExecuteSQL1" */
  location: string;
  /** Maps to the canvas node id for overlay display */
  nodeId?: string;
  line?: number;
  column?: number;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export class PackageValidator {

  /**
   * Validate a raw .dtsx XML string and return a list of issues.
   */
  validateXml(rawXml: string): ValidationResult[] {
    const serializer = new DtsxSerializer();
    let model: SsisPackageModel;
    try {
      model = serializer.parse(rawXml);
    } catch (err: any) {
      return [
        {
          severity: 'error',
          message: `Cannot parse package XML: ${err.message ?? err}`,
          location: 'Package',
        },
      ];
    }
    return this.validate(model);
  }

  /**
   * Validate a parsed package model.
   */
  validate(model: SsisPackageModel): ValidationResult[] {
    const results: ValidationResult[] = [];

    // Collect all known connection manager IDs/names
    const cmIds = new Set(model.connectionManagers.map((c) => c.dtsId));
    const cmNames = new Set(model.connectionManagers.map((c) => c.objectName));

    // Collect all variables (package-scope)
    const allVariables = this._collectVariables(model);

    // 1. Validate connection managers themselves
    for (const cm of model.connectionManagers) {
      this._validateConnectionManager(cm, results);
    }

    // 2. Validate executables recursively
    this._validateExecutables(
      model.executables,
      'Package',
      cmIds,
      cmNames,
      allVariables,
      results,
    );

    // 3. Validate expressions in variables
    for (const v of model.variables) {
      if (v.evaluateAsExpression && v.expression) {
        this._validateExpression(
          v.expression,
          `Package\\Variables\\${v.namespace}::${v.objectName}`,
          results,
        );
      }
    }

    // 4. Validate parameters
    for (const p of model.parameters) {
      if (!p.objectName) {
        results.push({
          severity: 'warning',
          message: 'Parameter has no name.',
          location: 'Package\\Parameters',
        });
      }
    }

    // 5. Check for unused variables
    this._checkUnusedVariables(model, results);

    // 6. Check for circular precedence constraints
    this._checkCircularConstraints(model.executables, model.precedenceConstraints, 'Package', results);

    // 7. Data flow checks
    this._checkDataFlows(model.executables, 'Package', results);

    // 8. Empty containers
    this._checkEmptyContainers(model.executables, 'Package', results);

    // 9. Duplicate object names
    this._checkDuplicateNames(model, results);

    return results;
  }

  // ── helpers ─────────────────────────────────────────────────────────

  private _collectVariables(model: SsisPackageModel): Set<string> {
    const vars = new Set<string>();
    for (const v of model.variables) {
      vars.add(`${v.namespace}::${v.objectName}`);
      vars.add(v.objectName); // short name
    }
    const addFromExecs = (execs: SsisExecutable[]): void => {
      for (const e of execs) {
        for (const v of e.variables) {
          vars.add(`${v.namespace}::${v.objectName}`);
          vars.add(v.objectName);
        }
        if (e.children) { addFromExecs(e.children); }
      }
    };
    addFromExecs(model.executables);
    return vars;
  }

  private _validateConnectionManager(
    cm: ConnectionManager,
    results: ValidationResult[],
  ): void {
    if (!cm.connectionString || cm.connectionString.trim().length === 0) {
      results.push({
        severity: 'error',
        message: `Connection manager "${cm.objectName}" has no connection string.`,
        location: `Package\\ConnectionManagers\\${cm.objectName}`,
      });
    }
  }

  private _validateExecutables(
    executables: SsisExecutable[],
    parentPath: string,
    cmIds: Set<string>,
    cmNames: Set<string>,
    allVariables: Set<string>,
    results: ValidationResult[],
  ): void {
    for (const exec of executables) {
      const execPath = `${parentPath}\\${exec.objectName}`;

      // Required properties
      if (!exec.objectName) {
        results.push({
          severity: 'error',
          message: 'Task has no ObjectName.',
          location: execPath,
          nodeId: exec.id,
        });
      }

      // Connection references
      for (const ref of exec.connectionRefs) {
        const idValid = cmIds.has(ref.connectionManagerId);
        const nameValid = cmNames.has(ref.connectionManagerName);
        if (!idValid && !nameValid) {
          results.push({
            severity: 'error',
            message: `Connection reference "${ref.connectionManagerName}" (${ref.connectionManagerId}) not found in package connection managers.`,
            location: execPath,
            nodeId: exec.id,
          });
        }
      }

      // ExecuteSQL-specific: check SqlStatementSource
      if (exec.executableType === 'Microsoft.ExecuteSQLTask') {
        const sqlSource = exec.properties['SqlStatementSource'];
        if (!sqlSource || String(sqlSource).trim().length === 0) {
          results.push({
            severity: 'warning',
            message: 'Execute SQL Task has no SQL statement.',
            location: execPath,
            nodeId: exec.id,
          });
        }
      }

      // Script task: check ScriptLanguage presence
      if (exec.executableType === 'Microsoft.ScriptTask') {
        if (!exec.properties['ScriptLanguage']) {
          results.push({
            severity: 'info',
            message: 'Script Task missing ScriptLanguage property.',
            location: execPath,
            nodeId: exec.id,
          });
        }
      }

      // ForLoop container: check required expressions
      if (exec.executableType === 'STOCK:FORLOOP') {
        const initExpr = exec.properties['InitExpression'];
        const evalExpr = exec.properties['EvalExpression'];
        const assignExpr = exec.properties['AssignExpression'];
        if (!evalExpr || String(evalExpr).trim().length === 0) {
          results.push({
            severity: 'error',
            message: 'Missing For Loop EvalExpression (loop condition is required).',
            location: execPath,
            nodeId: exec.id,
          });
        }
        if (!initExpr || String(initExpr).trim().length === 0) {
          results.push({
            severity: 'warning',
            message: 'Missing For Loop InitExpression (loop initialization is empty).',
            location: execPath,
            nodeId: exec.id,
          });
        }
        if (!assignExpr || String(assignExpr).trim().length === 0) {
          results.push({
            severity: 'warning',
            message: 'Missing For Loop AssignExpression (loop assignment is empty).',
            location: execPath,
            nodeId: exec.id,
          });
        }
      }

      // Validate expressions in variable scopes
      for (const v of exec.variables) {
        if (v.evaluateAsExpression && v.expression) {
          this._validateExpression(v.expression, `${execPath}\\Variables\\${v.namespace}::${v.objectName}`, results);
        }
      }

      // Recurse into children (containers)
      if (exec.children && exec.children.length > 0) {
        this._validateExecutables(
          exec.children,
          execPath,
          cmIds,
          cmNames,
          allVariables,
          results,
        );
      }
    }
  }

  private _validateExpression(
    expression: string,
    location: string,
    results: ValidationResult[],
    nodeId?: string,
  ): void {
    try {
      const result = validateExpression(expression);
      if (!result.valid) {
        for (const err of result.errors) {
          results.push({
            severity: 'error',
            message: `Expression error: ${err.message}`,
            location,
            nodeId,
          });
        }
      }
    } catch {
      // If the expression validator itself fails, just note it
      results.push({
        severity: 'warning',
        message: `Could not validate expression: ${expression.substring(0, 80)}`,
        location,
        nodeId,
      });
    }
  }

  // ── New validation rules (Phase 3) ─────────────────────────────────

  /**
   * Find variables defined but never referenced in expressions across
   * the entire package (connection strings, property expressions, variable
   * expressions, etc.).
   */
  private _checkUnusedVariables(
    model: SsisPackageModel,
    results: ValidationResult[],
  ): void {
    // Collect all expressions in the package as one big string
    const expressionBag: string[] = [];
    const collectExprs = (execs: SsisExecutable[]): void => {
      for (const e of execs) {
        for (const v of e.variables) {
          if (v.expression) { expressionBag.push(v.expression); }
        }
        for (const [, val] of Object.entries(e.properties)) {
          if (typeof val === 'string') { expressionBag.push(val); }
        }
        if (e.children) { collectExprs(e.children); }
      }
    };
    collectExprs(model.executables);
    for (const v of model.variables) {
      if (v.expression) { expressionBag.push(v.expression); }
    }
    for (const cm of model.connectionManagers) {
      if (cm.connectionString) { expressionBag.push(cm.connectionString); }
    }
    const allText = expressionBag.join('\n');

    for (const v of model.variables) {
      if (v.namespace === 'System') { continue; } // skip system vars
      const fqName = `${v.namespace}::${v.objectName}`;
      if (!allText.includes(v.objectName) && !allText.includes(fqName)) {
        results.push({
          severity: 'warning',
          message: `Unused variable "${fqName}" — defined but never referenced.`,
          location: `Package\\Variables\\${fqName}`,
        });
      }
    }
  }

  /**
   * Detect circular precedence constraints (cycles) via DFS.
   */
  private _checkCircularConstraints(
    executables: SsisExecutable[],
    constraints: PrecedenceConstraint[],
    parentPath: string,
    results: ValidationResult[],
  ): void {
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const c of constraints) {
      const list = adj.get(c.fromExecutableId) ?? [];
      list.push(c.toExecutableId);
      adj.set(c.fromExecutableId, list);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      if (inStack.has(nodeId)) { return true; } // cycle
      if (visited.has(nodeId)) { return false; }
      visited.add(nodeId);
      inStack.add(nodeId);
      for (const next of (adj.get(nodeId) ?? [])) {
        if (dfs(next)) {
          const nodeName = executables.find(e => e.id === nodeId)?.objectName ?? nodeId;
          results.push({
            severity: 'error',
            message: `Circular precedence constraint detected involving "${nodeName}".`,
            location: parentPath,
            nodeId,
          });
          return true;
        }
      }
      inStack.delete(nodeId);
      return false;
    };

    for (const exec of executables) {
      dfs(exec.id);
    }

    // Recurse into containers
    for (const exec of executables) {
      if (exec.children && exec.children.length > 0 && exec.childConstraints) {
        this._checkCircularConstraints(
          exec.children,
          exec.childConstraints,
          `${parentPath}\\${exec.objectName}`,
          results,
        );
      }
    }
  }

  /**
   * Data flow checks: disconnected components, unmapped required columns.
   */
  private _checkDataFlows(
    executables: SsisExecutable[],
    parentPath: string,
    results: ValidationResult[],
  ): void {
    for (const exec of executables) {
      const execPath = `${parentPath}\\${exec.objectName}`;

      // Check data flow tasks
      if (exec.executableType === 'Microsoft.Pipeline' || exec.executableType === 'STOCK:PIPELINE') {
        const objectData = exec.properties['__dataFlowModel'];
        if (objectData && typeof objectData === 'object') {
          const dfModel = objectData as { components?: any[]; paths?: any[] };
          const components = dfModel.components ?? [];
          const paths = dfModel.paths ?? [];

          // Find components with no input path that are not sources
          const targetInputIds = new Set((paths ?? []).map((p: any) => p.toInputId));
          const sourceClassIds = new Set([
            'Microsoft.OLEDBSource', 'Microsoft.FlatFileSource',
            'Microsoft.ADONETSource', 'Microsoft.ExcelSource',
            'Microsoft.ODataSource', 'Microsoft.RawFileSource',
          ]);

          for (const comp of components) {
            const isSource = sourceClassIds.has(comp.componentClassId);
            const hasInputPath = (comp.inputs ?? []).some((inp: any) => targetInputIds.has(inp.id));
            if (!isSource && !hasInputPath && (comp.inputs ?? []).length > 0) {
              results.push({
                severity: 'warning',
                message: `Disconnected data flow component "${comp.name}" — has inputs but no incoming data path.`,
                location: `${execPath}\\${comp.name}`,
                nodeId: comp.id,
              });
            }

            // Check for unmapped required columns
            for (const input of (comp.inputs ?? [])) {
              for (const extCol of (input.externalColumns ?? [])) {
                const mapped = (input.columns ?? []).some(
                  (c: any) => c.name === extCol.name || c.externalMetadataColumnId === extCol.id,
                );
                if (!mapped) {
                  results.push({
                    severity: 'warning',
                    message: `Unmapped required column "${extCol.name}" in component "${comp.name}".`,
                    location: `${execPath}\\${comp.name}\\${input.name}`,
                    nodeId: comp.id,
                  });
                }
              }
            }
          }
        }
      }

      // Recurse into children
      if (exec.children && exec.children.length > 0) {
        this._checkDataFlows(exec.children, execPath, results);
      }
    }
  }

  /**
   * Check for empty containers (ForLoop, ForEachLoop, Sequence with no children).
   */
  private _checkEmptyContainers(
    executables: SsisExecutable[],
    parentPath: string,
    results: ValidationResult[],
  ): void {
    const containerTypes = new Set([
      'STOCK:FORLOOP', 'STOCK:FOREACHLOOP', 'STOCK:SEQUENCE',
    ]);

    for (const exec of executables) {
      const execPath = `${parentPath}\\${exec.objectName}`;

      if (containerTypes.has(exec.executableType)) {
        if (!exec.children || exec.children.length === 0) {
          results.push({
            severity: 'warning',
            message: `Empty container "${exec.objectName}" — contains no child tasks.`,
            location: execPath,
            nodeId: exec.id,
          });
        }
      }

      // Recurse
      if (exec.children && exec.children.length > 0) {
        this._checkEmptyContainers(exec.children, execPath, results);
      }
    }
  }

  /**
   * Check for duplicate object names at the same scope level.
   */
  private _checkDuplicateNames(
    model: SsisPackageModel,
    results: ValidationResult[],
  ): void {
    // Top-level executables
    this._checkDuplicatesInScope(model.executables, 'Package', results);

    // Connection managers
    const cmNames = new Map<string, number>();
    for (const cm of model.connectionManagers) {
      cmNames.set(cm.objectName, (cmNames.get(cm.objectName) ?? 0) + 1);
    }
    for (const [name, count] of cmNames) {
      if (count > 1) {
        results.push({
          severity: 'error',
          message: `Duplicate connection manager name "${name}" (${count} instances).`,
          location: 'Package\\ConnectionManagers',
        });
      }
    }

    // Variables at package scope
    const varNames = new Map<string, number>();
    for (const v of model.variables) {
      const key = `${v.namespace}::${v.objectName}`;
      varNames.set(key, (varNames.get(key) ?? 0) + 1);
    }
    for (const [name, count] of varNames) {
      if (count > 1) {
        results.push({
          severity: 'error',
          message: `Duplicate variable "${name}" (${count} instances).`,
          location: 'Package\\Variables',
        });
      }
    }
  }

  private _checkDuplicatesInScope(
    executables: SsisExecutable[],
    parentPath: string,
    results: ValidationResult[],
  ): void {
    const names = new Map<string, number>();
    for (const exec of executables) {
      names.set(exec.objectName, (names.get(exec.objectName) ?? 0) + 1);
    }
    for (const [name, count] of names) {
      if (count > 1) {
        const exec = executables.find(e => e.objectName === name);
        results.push({
          severity: 'error',
          message: `Duplicate task/container name "${name}" in scope (${count} instances).`,
          location: parentPath,
          nodeId: exec?.id,
        });
      }
    }
    // Recurse into children
    for (const exec of executables) {
      if (exec.children && exec.children.length > 0) {
        this._checkDuplicatesInScope(
          exec.children,
          `${parentPath}\\${exec.objectName}`,
          results,
        );
      }
    }
  }
}
