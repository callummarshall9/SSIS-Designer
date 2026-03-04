/**
 * PropertyPanel (extension host side) – message relay.
 *
 * When the webview sends property changes, this module applies them
 * to the in-memory document model and triggers serialization.
 * This is a lightweight relay — the actual property editing UI is
 * rendered inside the webview (PropertyPanel.tsx component).
 */

import { SsisPackageModel, SsisExecutable, PrecedenceConstraint } from '../models/SsisPackageModel';

export class PropertyPanelRelay {
  constructor(
    private readonly model: () => SsisPackageModel | undefined,
    private readonly onModelChanged: () => void
  ) {}

  /**
   * Handle a property-update message from the webview.
   *
   * @param message Message from the webview with shape:
   *  {
   *    type: 'updateProperty',
   *    target: 'node' | 'edge',
   *    id: string,
   *    key: string,
   *    value: any
   *  }
   */
  public handleMessage(message: any): boolean {
    const model = this.model();
    if (!model) { return false; }

    if (message.type !== 'updateProperty') { return false; }

    if (message.target === 'node') {
      return this.updateExecutableProperty(model, message.id, message.key, message.value);
    }

    if (message.target === 'edge') {
      return this.updateConstraintProperty(model, message.id, message.key, message.value);
    }

    return false;
  }

  private updateExecutableProperty(
    model: SsisPackageModel,
    execId: string,
    key: string,
    value: any
  ): boolean {
    const exec = findExecutable(model.executables, execId);
    if (!exec) { return false; }

    // Top-level SsisExecutable fields
    if (key === 'objectName') {
      exec.objectName = value;
    } else if (key === 'description') {
      exec.description = value;
    } else {
      exec.properties[key] = value;
    }

    this.onModelChanged();
    return true;
  }

  private updateConstraintProperty(
    model: SsisPackageModel,
    constraintId: string,
    key: string,
    value: any
  ): boolean {
    const constraint = model.precedenceConstraints.find((pc) => pc.id === constraintId);
    if (!constraint) { return false; }

    switch (key) {
      case 'constraintType':
        constraint.constraintType = value;
        constraint.value =
          value === 'Success' ? 0 : value === 'Failure' ? 1 : 2;
        break;
      case 'expression':
        constraint.expression = value;
        break;
      case 'logicalAnd':
        constraint.logicalAnd = value === true || value === 'true';
        break;
      default:
        (constraint as any)[key] = value;
    }

    this.onModelChanged();
    return true;
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
