/**
 * ExecutionHistoryPanel (extension host) – manages the Execution History webview panel.
 *
 * Handles messages from the webview, queries TdsClient for execution data,
 * and supports filtering, pagination, and drill-down into individual executions.
 */

import * as vscode from 'vscode';
import { TdsClient } from '../services/TdsClient';

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export class ExecutionHistoryPanel {
  public static currentPanel: ExecutionHistoryPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly client: TdsClient;
  private disposables: vscode.Disposable[] = [];

  // ── static factory ──────────────────────────────────────────────────

  static createOrShow(
    extensionUri: vscode.Uri,
    client: TdsClient,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (ExecutionHistoryPanel.currentPanel) {
      ExecutionHistoryPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'ssisExecutionHistory',
      'SSIS Execution History',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    ExecutionHistoryPanel.currentPanel = new ExecutionHistoryPanel(panel, client, extensionUri);
  }

  // ── constructor ─────────────────────────────────────────────────────

  private constructor(
    panel: vscode.WebviewPanel,
    client: TdsClient,
    extensionUri: vscode.Uri,
  ) {
    this.panel = panel;
    this.client = client;

    this.panel.webview.html = this._getHtmlForWebview(extensionUri);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this._handleMessage(msg),
      null,
      this.disposables,
    );
  }

  dispose(): void {
    ExecutionHistoryPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
    this.disposables = [];
  }

  // ── message handler ─────────────────────────────────────────────────

  private async _handleMessage(msg: any): Promise<void> {
    try {
      switch (msg.type) {
        case 'getExecutionHistory':
          await this._handleGetHistory(msg);
          break;

        case 'getExecutionDetails':
          await this._handleGetDetails(msg);
          break;

        case 'viewExecutionMessages':
          await this._handleViewMessages(msg);
          break;
      }
    } catch (err: any) {
      this.panel.webview.postMessage({
        type: 'executionHistoryError',
        error: err.message ?? String(err),
      });
    }
  }

  // ── get execution history (with filtering & pagination) ─────────────

  private async _handleGetHistory(msg: any): Promise<void> {
    const {
      page = 0,
      pageSize = 50,
      filterStatus,
      filterPackage,
      filterDateFrom,
      filterDateTo,
      sortColumn = 'executionId',
      sortDir = 'desc',
    } = msg;

    const offset = page * pageSize;

    // Build WHERE clauses
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filterStatus !== undefined && filterStatus !== null) {
      clauses.push('e.status = @filterStatus');
      params.filterStatus = filterStatus;
    }
    if (filterPackage) {
      clauses.push('e.package_name LIKE @filterPackage');
      params.filterPackage = `%${filterPackage}%`;
    }
    if (filterDateFrom) {
      clauses.push('e.start_time >= @filterDateFrom');
      params.filterDateFrom = filterDateFrom;
    }
    if (filterDateTo) {
      clauses.push('e.start_time <= @filterDateTo');
      params.filterDateTo = filterDateTo + 'T23:59:59';
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    // Sort column mapping
    const sortMap: Record<string, string> = {
      executionId: 'e.execution_id',
      packageName: 'e.package_name',
      projectName: 'e.project_name',
      status: 'e.status',
      startTime: 'e.start_time',
      endTime: 'e.end_time',
      executedAsName: 'e.executed_as_name',
    };
    const orderCol = sortMap[sortColumn] ?? 'e.execution_id';
    const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

    // Count query
    const countRows = await this.client.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM [SSISDB].[catalog].[executions] e ${where}`,
      params,
    );
    const totalCount = countRows[0]?.cnt ?? 0;

    // Data query
    const rows = await this.client.query<any>(
      `SELECT e.execution_id, e.folder_name, e.project_name, e.package_name,
              e.status, e.start_time, e.end_time, e.executed_as_name
       FROM [SSISDB].[catalog].[executions] e
       ${where}
       ORDER BY ${orderCol} ${orderDir}
       OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`,
      { ...params, offset, pageSize },
    );

    const executions = rows.map((r: any) => ({
      executionId: r.execution_id,
      folderName: r.folder_name ?? '',
      projectName: r.project_name ?? '',
      packageName: r.package_name ?? '',
      status: r.status,
      startTime: r.start_time ? new Date(r.start_time).toISOString() : '',
      endTime: r.end_time ? new Date(r.end_time).toISOString() : undefined,
      executedAsName: r.executed_as_name ?? '',
    }));

    this.panel.webview.postMessage({
      type: 'executionHistoryLoaded',
      executions,
      totalCount,
    });
  }

  // ── get execution details (messages, stats, params) ─────────────────

  private async _handleGetDetails(msg: any): Promise<void> {
    const { executionId } = msg;

    const [messages, statistics, parameters] = await Promise.all([
      this.client.getExecutionMessages(executionId),
      this.client.getExecutionDataStatistics(executionId),
      this.client.getExecutionParameters(executionId),
    ]);

    this.panel.webview.postMessage({
      type: 'executionDetailsLoaded',
      messages: messages.map((m: any) => ({
        messageId: m.messageId,
        messageTime: m.messageTime?.toISOString?.() ?? '',
        messageType: m.messageType,
        message: m.message,
        packageName: m.packageName,
        eventName: m.eventName,
        executionPath: m.executionPath,
      })),
      statistics: statistics.map((s: any) => ({
        dataStatisticsId: s.dataStatisticsId,
        executionId: s.executionId,
        packageName: s.packageName,
        dataflowPathIdString: s.dataflowPathIdString,
        sourceName: s.sourceName,
        destinationName: s.destinationName,
        rowsSent: s.rowsSent,
        createdTime: s.createdTime?.toISOString?.() ?? '',
      })),
      parameters: parameters.map((p: any) => ({
        executionId: p.executionId,
        objectType: p.objectType,
        parameterName: p.parameterName,
        parameterValue: p.sensitiveParameterValue ? null : String(p.parameterValue ?? ''),
        sensitiveParameterValue: p.sensitiveParameterValue,
      })),
    });
  }

  // ── view full messages in output channel ────────────────────────────

  private async _handleViewMessages(msg: any): Promise<void> {
    const { executionId } = msg;
    const messages = await this.client.getExecutionMessages(executionId);

    const channel = vscode.window.createOutputChannel(`SSIS Execution ${executionId}`);
    channel.show(true);
    channel.appendLine(`═══ Execution ${executionId} Messages ═══`);
    channel.appendLine('');

    for (const m of messages) {
      const time = m.messageTime?.toISOString?.()?.substring(11, 23) ?? '';
      const typeLabel: Record<number, string> = {
        120: '[ERROR]', 130: '[WARN] ', 140: '[INFO] ', 60: '[PROG] ', 70: '[STAT] ',
      };
      const prefix = typeLabel[m.messageType] ?? `[${m.messageType}]`;
      channel.appendLine(`${time} ${prefix} [${m.packageName}] ${m.message}`);
    }
  }

  // ── webview HTML ────────────────────────────────────────────────────

  private _getHtmlForWebview(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'styles', 'canvas.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Execution History</title>
</head>
<body>
  <div id="root" data-view="executionHistory"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
