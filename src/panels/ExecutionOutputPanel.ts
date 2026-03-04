import * as vscode from 'vscode';
import { TdsClient, ExecutionMessage, ExecutionStatus, executionStatusLabel } from '../services/TdsClient';

// ---------------------------------------------------------------------------
// Message type icons
// ---------------------------------------------------------------------------

const MESSAGE_TYPE_ICONS: Record<number, string> = {
  // -1 = unknown, 10 = pre-validate, 20 = post-validate,
  // 30 = pre-execute, 40 = post-execute, 60 = progress,
  // 70 = status-change, 110 = custom, 120 = error, 130 = warning,
  // 140 = information, 150 = pre-plan/post-plan
  120: '[ERROR]',
  130: '[WARN] ',
  140: '[INFO] ',
  60:  '[PROG] ',
  70:  '[STAT] ',
};

function messagePrefix(type: number): string {
  return MESSAGE_TYPE_ICONS[type] ?? `[${type}]   `;
}

// ---------------------------------------------------------------------------
// Execution Output Panel
// ---------------------------------------------------------------------------

export class ExecutionOutputPanel {
  private readonly outputChannel: vscode.OutputChannel;
  private readonly statusBarItem: vscode.StatusBarItem;
  private pollingInterval?: ReturnType<typeof setInterval>;
  private lastMessageId = 0;
  private disposed = false;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('SSIS Execution');
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.text = '$(sync~spin) SSIS: Starting…';
    this.statusBarItem.show();
    this.outputChannel.show(true);
  }

  /**
   * Start polling for execution messages every 2 seconds until the execution
   * reaches a terminal state.
   */
  startMonitoring(executionId: number, tdsClient: TdsClient): void {
    this.outputChannel.appendLine(`═══ Execution ${executionId} started ═══`);
    this.outputChannel.appendLine('');

    this.pollingInterval = setInterval(async () => {
      if (this.disposed) {
        this._stopPolling();
        return;
      }

      try {
        // Fetch new messages
        const messages = await tdsClient.getExecutionMessages(
          executionId,
          this.lastMessageId > 0 ? this.lastMessageId : undefined,
        );
        for (const msg of messages) {
          this.appendMessage(msg);
          if (msg.messageId > this.lastMessageId) {
            this.lastMessageId = msg.messageId;
          }
        }

        // Check status
        const status = await tdsClient.getExecutionStatus(executionId);
        this.statusBarItem.text = `$(sync~spin) SSIS: ${executionStatusLabel(status.status)}`;

        // Terminal states: 3=canceled, 4=failed, 6=ended_unexpect, 7=succeeded
        if ([3, 4, 6, 7].includes(status.status)) {
          this.showFinalStatus(status);
          this._stopPolling();
        }
      } catch (err: any) {
        this.outputChannel.appendLine(`[POLL ERROR] ${err.message ?? err}`);
        this._stopPolling();
      }
    }, 2000);
  }

  /**
   * Format and append a single execution message to the output channel.
   */
  appendMessage(msg: ExecutionMessage): void {
    const time = msg.messageTime.toISOString().substring(11, 23);
    const prefix = messagePrefix(msg.messageType);
    const pkg = msg.packageName ? ` [${msg.packageName}]` : '';
    this.outputChannel.appendLine(`${time} ${prefix}${pkg} ${msg.message}`);
  }

  /**
   * Show a final status notification and update the output channel.
   */
  showFinalStatus(status: ExecutionStatus): void {
    const label = executionStatusLabel(status.status);
    const duration = status.endTime && status.startTime
      ? `${((status.endTime.getTime() - status.startTime.getTime()) / 1000).toFixed(1)}s`
      : '';

    this.outputChannel.appendLine('');
    this.outputChannel.appendLine(`═══ Execution ${status.executionId} ${label} ${duration ? `(${duration})` : ''} ═══`);

    this.statusBarItem.text = `$(${status.status === 7 ? 'check' : 'error'}) SSIS: ${label}`;

    // Auto-hide status bar after 10 seconds
    setTimeout(() => {
      this.statusBarItem.hide();
    }, 10_000);

    if (status.status === 7) {
      vscode.window.showInformationMessage(`SSIS Execution ${status.executionId} succeeded. ${duration}`);
    } else if (status.status === 4) {
      vscode.window.showErrorMessage(`SSIS Execution ${status.executionId} failed.`);
    } else {
      vscode.window.showWarningMessage(`SSIS Execution ${status.executionId}: ${label}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    this._stopPolling();
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }

  private _stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
  }
}
