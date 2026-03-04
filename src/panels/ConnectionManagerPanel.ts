/**
 * ConnectionManagerPanel (extension host side) – handles connection manager
 * messages from the webview and applies them to the document model.
 */

import { SsisPackageModel, ConnectionManager } from '../models/SsisPackageModel';
import { TdsClient } from '../services/TdsClient';

export class ConnectionManagerPanelRelay {
  private tdsClient: TdsClient;

  constructor(
    private readonly model: () => SsisPackageModel | undefined,
    private readonly onModelChanged: () => void
  ) {
    this.tdsClient = new TdsClient();
  }

  /**
   * Handle connection-manager messages from the webview.
   *
   * @returns true if the message was handled, false otherwise.
   */
  public async handleMessage(message: any): Promise<boolean> {
    switch (message.type) {
      case 'addConnectionManager':
        return this.addConnectionManager(message.connectionManager);

      case 'updateConnectionManager':
        return this.updateConnectionManager(message.connectionManager);

      case 'removeConnectionManager':
        return this.removeConnectionManager(message.connectionManagerId);

      case 'testConnection':
        // Returns result via callback
        return true; // Handled externally — see getTestResult()

      default:
        return false;
    }
  }

  /**
   * Test a connection and return the result.
   * Called as an async operation from the message handler.
   */
  public async testConnection(
    connectionString: string,
    connectionType: string
  ): Promise<{ success: boolean; error?: string }> {
    // Only OLEDB and ADO.NET support real connection testing
    if (connectionType === 'OLEDB' || connectionType === 'ADO.NET') {
      return this.tdsClient.testConnection(connectionString);
    }

    // For file-based connections, check if the path looks valid
    if (connectionType === 'FLATFILE' || connectionType === 'EXCEL' || connectionType === 'FILE') {
      const pathMatch = connectionString.match(/(?:ConnectionString|Data Source)=([^;]+)/i);
      if (pathMatch) {
        const filePath = pathMatch[1].trim().replace(/"/g, '');
        if (filePath.length > 0) {
          return { success: true };
        }
        return { success: false, error: 'File path is empty' };
      }
      return { success: false, error: 'No file path found in connection string' };
    }

    // For other types, just validate there's a connection string
    if (connectionString && connectionString.trim().length > 0) {
      return { success: true };
    }
    return { success: false, error: 'Connection string is empty' };
  }

  /**
   * Build a connection string from individual field values.
   */
  public static buildOleDbConnectionString(fields: {
    server: string;
    database: string;
    authentication: 'Windows' | 'SQL';
    username?: string;
    password?: string;
  }): string {
    const parts = [
      'Provider=MSOLEDBSQL',
      `Data Source=${fields.server}`,
      `Initial Catalog=${fields.database}`,
    ];
    if (fields.authentication === 'Windows') {
      parts.push('Integrated Security=SSPI');
    } else {
      parts.push(`User ID=${fields.username ?? ''}`, `Password=${fields.password ?? ''}`);
    }
    return parts.join(';') + ';';
  }

  public static buildFlatFileConnectionString(fields: {
    filePath: string;
    columnDelimiter: string;
    textQualifier: string;
    hasHeaderRow: boolean;
  }): string {
    const parts = [`ConnectionString=${fields.filePath}`];
    if (fields.columnDelimiter) { parts.push(`ColumnDelimiter=${fields.columnDelimiter}`); }
    if (fields.textQualifier) { parts.push(`TextQualifier=${fields.textQualifier}`); }
    if (fields.hasHeaderRow) { parts.push('HeaderRowPresent=true'); }
    return parts.join(';') + ';';
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private addConnectionManager(cm: ConnectionManager): boolean {
    const model = this.model();
    if (!model) { return false; }

    model.connectionManagers.push(cm);
    this.onModelChanged();
    return true;
  }

  private updateConnectionManager(cm: ConnectionManager): boolean {
    const model = this.model();
    if (!model) { return false; }

    const idx = model.connectionManagers.findIndex(
      (c) => c.id === cm.id || c.dtsId === cm.dtsId
    );
    if (idx === -1) {
      // If not found, add it
      model.connectionManagers.push(cm);
    } else {
      model.connectionManagers[idx] = cm;
    }

    this.onModelChanged();
    return true;
  }

  private removeConnectionManager(id: string): boolean {
    const model = this.model();
    if (!model) { return false; }

    const idx = model.connectionManagers.findIndex(
      (c) => c.id === id || c.dtsId === id
    );
    if (idx === -1) { return false; }

    model.connectionManagers.splice(idx, 1);
    this.onModelChanged();
    return true;
  }

  /**
   * Dispose of the TDS client.
   */
  public async dispose(): Promise<void> {
    await this.tdsClient.disconnect();
  }
}
