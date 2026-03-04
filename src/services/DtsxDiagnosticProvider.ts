/**
 * DtsxDiagnosticProvider – watches .dtsx files and publishes VS Code diagnostics.
 *
 * Supports three trigger modes (configurable via settings):
 *   - onSave:  validate when the document is saved
 *   - onType:  validate as the user types (debounced)
 *   - manual:  only validate via the command palette
 */

import * as vscode from 'vscode';
import { PackageValidator, ValidationResult, ValidationSeverity } from './PackageValidator';

// ---------------------------------------------------------------------------
// Diagnostic codes
// ---------------------------------------------------------------------------

export enum SsisDiagnosticCode {
  ParseError   = 'SSIS001',
  NoConnString = 'SSIS002',
  MissingConn  = 'SSIS003',
  NoSql        = 'SSIS004',
  ExprError    = 'SSIS005',
  NoName       = 'SSIS006',
  ScriptLang   = 'SSIS007',
  ParamNoName  = 'SSIS008',
  UnusedVar    = 'SSIS009',
  CircularPC   = 'SSIS010',
  UnmappedCol  = 'SSIS011',
  Disconnected = 'SSIS012',
  EmptyContainer = 'SSIS013',
  MissingForExpr = 'SSIS014',
  DuplicateName  = 'SSIS015',
}

// Map validation message prefixes to codes
function diagnosticCode(msg: string): string {
  if (msg.includes('Cannot parse'))            { return SsisDiagnosticCode.ParseError; }
  if (msg.includes('no connection string'))    { return SsisDiagnosticCode.NoConnString; }
  if (msg.includes('not found in package'))    { return SsisDiagnosticCode.MissingConn; }
  if (msg.includes('no SQL statement'))        { return SsisDiagnosticCode.NoSql; }
  if (msg.includes('Expression error'))        { return SsisDiagnosticCode.ExprError; }
  if (msg.includes('no ObjectName'))           { return SsisDiagnosticCode.NoName; }
  if (msg.includes('ScriptLanguage'))          { return SsisDiagnosticCode.ScriptLang; }
  if (msg.includes('Parameter has no name'))   { return SsisDiagnosticCode.ParamNoName; }
  if (msg.includes('unused') || msg.includes('Unused'))  { return SsisDiagnosticCode.UnusedVar; }
  if (msg.includes('Circular'))                { return SsisDiagnosticCode.CircularPC; }
  if (msg.includes('unmapped') || msg.includes('Unmapped')) { return SsisDiagnosticCode.UnmappedCol; }
  if (msg.includes('disconnected') || msg.includes('Disconnected')) { return SsisDiagnosticCode.Disconnected; }
  if (msg.includes('empty') || msg.includes('Empty'))   { return SsisDiagnosticCode.EmptyContainer; }
  if (msg.includes('Missing') && msg.includes('Expression')) { return SsisDiagnosticCode.MissingForExpr; }
  if (msg.includes('Duplicate'))               { return SsisDiagnosticCode.DuplicateName; }
  return 'SSIS000';
}

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

function toVsSeverity(s: ValidationSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':   return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'info':    return vscode.DiagnosticSeverity.Information;
    default:        return vscode.DiagnosticSeverity.Information;
  }
}

// ---------------------------------------------------------------------------
// Line finder — approximate line numbers for a location in the XML
// ---------------------------------------------------------------------------

function findLineForLocation(rawXml: string, location: string): number {
  // Break location into segments, e.g. "Package\\ExecuteSQL1"
  const segments = location.split('\\').filter(Boolean);
  const lines = rawXml.split('\n');

  // Try to find the last segment as an ObjectName in the XML
  const targetName = segments[segments.length - 1];
  if (!targetName || targetName === 'Package') { return 0; }

  // Look for DTS:ObjectName="<name>" or ObjectName="<name>"
  const patterns = [
    `ObjectName="${targetName}"`,
    `DTS:ObjectName="${targetName}"`,
    `name="${targetName}"`,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pat of patterns) {
      if (lines[i].includes(pat)) {
        return i;
      }
    }
  }

  // Fallback: search for the name itself
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(targetName)) {
      return i;
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Code Action Provider
// ---------------------------------------------------------------------------

class SsisCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      if (diag.source !== 'SSIS Designer') { continue; }
      const code = String(diag.code ?? '');

      if (code === SsisDiagnosticCode.MissingConn) {
        const action = new vscode.CodeAction(
          'Add missing connection manager',
          vscode.CodeActionKind.QuickFix,
        );
        action.command = {
          command: 'ssis.editConnection',
          title: 'Add connection manager',
        };
        action.diagnostics = [diag];
        action.isPreferred = true;
        actions.push(action);
      }

      if (code === SsisDiagnosticCode.UnusedVar) {
        const action = new vscode.CodeAction(
          'Remove unused variable',
          vscode.CodeActionKind.QuickFix,
        );
        action.command = {
          command: 'ssis.removeUnusedVariable',
          title: 'Remove unused variable',
          arguments: [document.uri, diag],
        };
        action.diagnostics = [diag];
        actions.push(action);
      }

      if (code === SsisDiagnosticCode.NoSql || code === SsisDiagnosticCode.NoConnString) {
        const action = new vscode.CodeAction(
          'Set required property',
          vscode.CodeActionKind.QuickFix,
        );
        action.command = {
          command: 'ssis.validatePackage',
          title: 'Open property panel',
        };
        action.diagnostics = [diag];
        actions.push(action);
      }
    }

    return actions;
  }
}

// ---------------------------------------------------------------------------
// Provider class
// ---------------------------------------------------------------------------

type TriggerMode = 'onSave' | 'onType' | 'manual';

export class DtsxDiagnosticProvider implements vscode.Disposable {
  private readonly diagnosticCollection: vscode.DiagnosticCollection;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly validator = new PackageValidator();
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('ssis-designer');
    const triggerMode = this._getTriggerMode();

    // Always listen for saves
    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (triggerMode !== 'manual' && doc.fileName.endsWith('.dtsx')) {
          this._validateDocument(doc);
        }
      }),
    );

    // onType mode: also listen for content changes
    if (triggerMode === 'onType') {
      this.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
          if (e.document.fileName.endsWith('.dtsx')) {
            this._debounceValidate(e.document);
          }
        }),
      );
    }

    // Clean up diagnostics when a document is closed
    this.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.fileName.endsWith('.dtsx')) {
          this.diagnosticCollection.delete(doc.uri);
        }
      }),
    );

    // Register code action provider for dtsx
    this.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { pattern: '**/*.dtsx' },
        new SsisCodeActionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
      ),
    );

    // Validate all open dtsx files on activation
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.fileName.endsWith('.dtsx')) {
        this._validateDocument(doc);
      }
    }
  }

  /** Force a validation pass for a given document URI. */
  validateUri(uri: vscode.Uri): void {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (doc) {
      this._validateDocument(doc);
    }
  }

  dispose(): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    this.diagnosticCollection.dispose();
    for (const sub of this.subscriptions) { sub.dispose(); }
  }

  // ── internal ────────────────────────────────────────────────────────

  private _getTriggerMode(): TriggerMode {
    const config = vscode.workspace.getConfiguration('ssisDesigner');
    return (config.get<string>('validationTrigger') as TriggerMode) ?? 'onSave';
  }

  private _debounceValidate(doc: vscode.TextDocument): void {
    if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
    this.debounceTimer = setTimeout(() => this._validateDocument(doc), 800);
  }

  private _validateDocument(doc: vscode.TextDocument): void {
    const rawXml = doc.getText();
    const issues = this.validator.validateXml(rawXml);

    const diagnostics: vscode.Diagnostic[] = issues.map((issue) => {
      const line = issue.line ?? findLineForLocation(rawXml, issue.location);
      const col = issue.column ?? 0;
      const range = new vscode.Range(line, col, line, col + 1);
      const diag = new vscode.Diagnostic(
        range,
        `[${issue.location}] ${issue.message}`,
        toVsSeverity(issue.severity),
      );
      diag.source = 'SSIS Designer';
      diag.code = diagnosticCode(issue.message);
      return diag;
    });

    this.diagnosticCollection.set(doc.uri, diagnostics);
  }
}
