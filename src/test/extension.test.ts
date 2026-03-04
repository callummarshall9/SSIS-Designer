/**
 * Tests for extension activation, command registration, and tree view providers.
 *
 * Because the VS Code extension host APIs are not available in a plain Vitest
 * run we mock `vscode` and verify that activate() wires everything up.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock vscode module
// ---------------------------------------------------------------------------

const registeredCommands = new Map<string, (...args: any[]) => any>();
const registeredTreeProviders = new Map<string, any>();
const registeredCustomEditors = new Map<string, any>();
const subscriptions: any[] = [];

const mockContext: any = {
  subscriptions,
  extensionUri: { fsPath: '/mock' },
  globalState: {
    get: vi.fn().mockReturnValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  },
  secrets: {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
};

vi.mock('vscode', () => ({
  window: {
    registerTreeDataProvider: vi.fn((id: string, provider: any) => {
      registeredTreeProviders.set(id, provider);
      return { dispose: vi.fn() };
    }),
    registerCustomEditorProvider: vi.fn((id: string, provider: any) => {
      registeredCustomEditors.set(id, provider);
      return { dispose: vi.fn() };
    }),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    createStatusBarItem: vi.fn(() => ({
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      text: '',
    })),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
    showSaveDialog: vi.fn(),
    withProgress: vi.fn(),
    tabGroups: { all: [] },
    activeTextEditor: undefined,
  },
  commands: {
    registerCommand: vi.fn((id: string, handler: any) => {
      registeredCommands.set(id, handler);
      return { dispose: vi.fn() };
    }),
    executeCommand: vi.fn(),
  },
  workspace: {
    workspaceFolders: [],
    findFiles: vi.fn().mockResolvedValue([]),
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
    },
    asRelativePath: vi.fn((uri: any) => uri.fsPath ?? uri),
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({
      set: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  TreeItem: class {
    label: string;
    collapsibleState: number;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
  EventEmitter: class {
    private handlers: Function[] = [];
    event = (handler: Function) => { this.handlers.push(handler); return { dispose: vi.fn() }; };
    fire = (data?: any) => { this.handlers.forEach((h) => h(data)); };
  },
  Uri: {
    file: (p: string) => ({ fsPath: p, scheme: 'file', toString: () => p }),
    parse: (s: string) => ({ fsPath: s, scheme: 'file', toString: () => s }),
  },
  ProgressLocation: { Notification: 15 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  Range: class {
    constructor(
      public startLine: number,
      public startChar: number,
      public endLine: number,
      public endChar: number,
    ) {}
  },
  Diagnostic: class {
    source?: string;
    constructor(public range: any, public message: string, public severity: number) {}
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extension activation', () => {
  beforeEach(() => {
    registeredCommands.clear();
    registeredTreeProviders.clear();
    registeredCustomEditors.clear();
    subscriptions.length = 0;
  });

  it('should register all expected commands', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    const expectedCommands = [
      'ssis.newPackage',
      'ssis.deployProject',
      'ssis.executePackage',
      'ssis.validatePackage',
      'ssis.exportIspac',
      'ssis.connectCatalog',
      'ssis.refreshCatalog',
      'ssis.disconnectCatalog',
      'ssis.createFolder',
      'ssis.downloadPackage',
      'ssis.editConnection',
      'ssis.testConnection',
      'ssis.deleteConnection',
    ];

    for (const cmd of expectedCommands) {
      expect(registeredCommands.has(cmd), `Command ${cmd} should be registered`).toBe(true);
    }
  });

  it('should register the Catalog Explorer tree view', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    expect(registeredTreeProviders.has('ssisDesigner.catalogExplorer')).toBe(true);
  });

  it('should register the Connection Manager tree view', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    expect(registeredTreeProviders.has('ssisDesigner.connectionManager')).toBe(true);
  });

  it('should push disposables into context.subscriptions', async () => {
    const { activate } = await import('../extension');
    activate(mockContext);

    // At minimum: editor provider + 2 tree views + many commands
    expect(subscriptions.length).toBeGreaterThanOrEqual(10);
  });
});
