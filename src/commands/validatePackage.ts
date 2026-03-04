import * as vscode from 'vscode';
import { PackageValidator, ValidationResult as PkgValidationResult, ValidationSeverity } from '../services/PackageValidator';

// ---------------------------------------------------------------------------
// Diagnostics collection (singleton for the extension lifetime)
// ---------------------------------------------------------------------------

let diagnosticCollection: vscode.DiagnosticCollection | undefined;

function ensureDiagnostics(): vscode.DiagnosticCollection {
  if (!diagnosticCollection) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('ssis');
  }
  return diagnosticCollection;
}

function severityToVscode(s: ValidationSeverity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error': return vscode.DiagnosticSeverity.Error;
    case 'warning': return vscode.DiagnosticSeverity.Warning;
    case 'info': return vscode.DiagnosticSeverity.Information;
    default: return vscode.DiagnosticSeverity.Information;
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * Validate the currently active .dtsx package and publish diagnostics.
 */
export async function validatePackage(_context: vscode.ExtensionContext): Promise<void> {
  // 1. Determine which document to validate
  const editor = vscode.window.activeTextEditor;
  let uri: vscode.Uri | undefined;

  if (editor && editor.document.fileName.endsWith('.dtsx')) {
    uri = editor.document.uri;
  } else {
    // Try to find an open .dtsx tab via the custom editor
    const tabs = vscode.window.tabGroups.all.flatMap((g: vscode.TabGroup) => g.tabs);
    const dtsxTab = tabs.find(
      (t: vscode.Tab) => (t.input as any)?.uri?.fsPath?.endsWith('.dtsx'),
    );
    if (dtsxTab) {
      uri = (dtsxTab.input as any).uri;
    }
  }

  if (!uri) {
    // Fall back: let user pick
    const files = await vscode.workspace.findFiles('**/*.dtsx', '**/node_modules/**', 20);
    if (files.length === 0) {
      vscode.window.showInformationMessage('No .dtsx files found in workspace.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      files.map((f: vscode.Uri) => ({ label: vscode.workspace.asRelativePath(f), uri: f })),
      { placeHolder: 'Select package to validate' },
    );
    if (!pick) { return; }
    uri = pick.uri;
  }

  // 2. Read the raw XML
  const rawBytes = await vscode.workspace.fs.readFile(uri);
  const rawXml = new TextDecoder().decode(rawBytes);

  // 3. Run validation
  const validator = new PackageValidator();
  const issues = validator.validateXml(rawXml);

  // 4. Publish diagnostics
  const diags = ensureDiagnostics();
  const vsDiagnostics: vscode.Diagnostic[] = issues.map((issue) => {
    const line = (issue.line ?? 1) - 1;
    const col = (issue.column ?? 1) - 1;
    const range = new vscode.Range(line, col, line, col + 1);
    const d = new vscode.Diagnostic(range, `[${issue.location}] ${issue.message}`, severityToVscode(issue.severity));
    d.source = 'SSIS';
    return d;
  });
  diags.set(uri, vsDiagnostics);

  // 5. Summary notification
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const infos = issues.filter((i) => i.severity === 'info').length;

  if (issues.length === 0) {
    vscode.window.showInformationMessage('Package validation passed — no issues found.');
  } else {
    vscode.window.showWarningMessage(
      `Validation: ${errors} error(s), ${warnings} warning(s), ${infos} info(s). See Problems panel.`,
    );
  }
}
