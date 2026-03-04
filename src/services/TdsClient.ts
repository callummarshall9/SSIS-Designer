/**
 * TDS (Tabular Data Stream) client for connecting to SQL Server / SSIS Catalog.
 * Wraps the mssql library for SSIS-specific operations.
 */

import * as sql from 'mssql';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TdsConnectionConfig {
  server: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  trustedConnection?: boolean;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  /** Entra / AAD authentication mode understood by the mssql (tedious) driver. */
  authenticationType?: string;
}

// ---------------------------------------------------------------------------
// Catalog DTOs
// ---------------------------------------------------------------------------

export interface CatalogFolder {
  folderId: number;
  name: string;
  description: string;
  createdTime: Date;
}

export interface CatalogProject {
  projectId: number;
  folderId: number;
  name: string;
  description: string;
  deployedByName: string;
  lastDeployedTime: Date;
}

export interface CatalogPackage {
  packageId: number;
  projectId: number;
  name: string;
  description: string;
  packageFormatVersion: number;
}

export interface CatalogEnvironment {
  environmentId: number;
  folderId: number;
  name: string;
  description: string;
}

export interface CatalogEnvVariable {
  variableId: number;
  environmentId: number;
  name: string;
  description: string;
  type: string;
  value: string;
  sensitive: boolean;
}

export interface ExecutionStatus {
  executionId: number;
  /** 1=created, 2=running, 3=canceled, 4=failed, 5=pending, 6=ended_unexpect, 7=succeeded, 9=completing */
  status: number;
  startTime: Date;
  endTime?: Date;
}

export interface ExecutionMessage {
  messageId: number;
  eventMessageId: number;
  messageTime: Date;
  messageType: number;
  messageSourceType: number;
  message: string;
  packageName: string;
  eventName: string;
  executionPath: string;
}

export interface ExecutionHistory {
  executionId: number;
  folderName: string;
  projectName: string;
  packageName: string;
  status: number;
  startTime: Date;
  endTime?: Date;
  executedAsName: string;
}

export interface EnvironmentReference {
  referenceId: number;
  projectId: number;
  environmentName: string;
  environmentFolderName: string | null;
  referenceType: 'R' | 'A';
}

export interface DataStatistic {
  dataStatisticsId: number;
  executionId: number;
  packageName: string;
  dataflowPathIdString: string;
  sourceName: string;
  destinationName: string;
  rowsSent: number;
  createdTime: Date;
}

export interface ExecutionParameter {
  executionId: number;
  objectType: number;
  parameterName: string;
  parameterValue: any;
  sensitiveParameterValue: boolean;
}

// ---------------------------------------------------------------------------
// MSDB Package Store DTOs (Package Deployment Model)
// ---------------------------------------------------------------------------

export interface MsdbFolder {
  folderId: string;
  parentFolderId: string | null;
  name: string;
}

export interface MsdbPackage {
  id: string;
  name: string;
  description: string;
  folderId: string;
  packageData?: Buffer;
}

/** What deployment models a server supports. */
export interface ServerCapabilities {
  /** True if [SSISDB] catalog exists (project deployment model, SQL 2012+). */
  hasSsisdb: boolean;
  /** True if msdb.dbo.sysssispackages exists (package deployment model / SSIS Package Store). */
  hasMsdbStore: boolean;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const EXECUTION_STATUS_LABELS: Record<number, string> = {
  1: 'Created',
  2: 'Running',
  3: 'Canceled',
  4: 'Failed',
  5: 'Pending',
  6: 'Ended Unexpectedly',
  7: 'Succeeded',
  9: 'Completing',
};

export function executionStatusLabel(status: number): string {
  return EXECUTION_STATUS_LABELS[status] ?? `Unknown (${status})`;
}

// ---------------------------------------------------------------------------
// TDS Client
// ---------------------------------------------------------------------------

export class TdsClient {
  private pool: sql.ConnectionPool | undefined;
  private connected = false;

  // ── Connection management ───────────────────────────────────────────

  async connect(config: TdsConnectionConfig): Promise<boolean> {
    try {
      const sqlConfig: sql.config = {
        server: config.server,
        port: config.port ?? 1433,
        database: config.database ?? 'master',
        options: {
          encrypt: config.encrypt ?? true,
          trustServerCertificate: config.trustServerCertificate ?? false,
        },
      };

      if (config.authenticationType) {
        // Entra / Azure AD authentication
        (sqlConfig as any).authentication = {
          type: config.authenticationType,
          options: {
            userName: config.user ?? '',
            password: config.password ?? '',
          },
        };
      } else if (config.trustedConnection) {
        (sqlConfig as any).authentication = {
          type: 'ntlm',
          options: { domain: '' },
        };
      } else {
        sqlConfig.user = config.user;
        sqlConfig.password = config.password;
      }

      this.pool = await sql.connect(sqlConfig);
      this.connected = true;
      return true;
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async connectWithConnectionString(connectionString: string): Promise<boolean> {
    try {
      this.pool = await sql.connect(connectionString);
      this.connected = true;
      return true;
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async testConnection(connectionString: string): Promise<{ success: boolean; error?: string }> {
    let pool: sql.ConnectionPool | undefined;
    let rawError: string | undefined;

    try {
      // Use sql.connect() with raw connection string as per mssql docs
      pool = await sql.connect(connectionString);
      await pool.close();
      return { success: true };
    } catch (err: any) {
      rawError = err?.message ?? err?.originalError?.message ?? 'Unknown error';
      console.error('[TdsClient] Raw connection string attempt failed:', rawError, err);
      try { pool?.close(); } catch { /* ignore cleanup */ }
    }

    // Fallback: parse the connection string into a config object and try again
    let parsedConfig: sql.config;
    try {
      parsedConfig = this.parseConnectionString(connectionString);
    } catch (parseErr: any) {
      const parseMessage = parseErr?.message ?? 'Failed to parse connection string';
      console.error('[TdsClient] Connection string parsing failed:', parseMessage, parseErr);
      return {
        success: false,
        error: `Connection string parse error: ${parseMessage}${rawError ? ` (raw attempt: ${rawError})` : ''}`,
      };
    }

    try {
      pool = await sql.connect(parsedConfig);
      await pool.close();
      return { success: true };
    } catch (err: any) {
      try { pool?.close(); } catch { /* ignore cleanup error */ }
      const errorMessage =
        err?.message ??
        err?.originalError?.message ??
        'Unknown connection error';
      console.error('[TdsClient] Parsed config connection attempt failed:', errorMessage, err);
      return {
        success: false,
        error: `${errorMessage}${rawError && rawError !== errorMessage ? ` (raw attempt: ${rawError})` : ''}`,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
      } catch { /* ignore */ }
      this.pool = undefined;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Generic query helpers ───────────────────────────────────────────

  async executeQuery(sqlText: string): Promise<any[]> {
    this._ensureConnected();
    const result = await this.pool!.request().query(sqlText);
    return result.recordset ?? [];
  }

  async executeProcedure(name: string, params: Record<string, any>): Promise<any> {
    this._ensureConnected();
    const request = this.pool!.request();
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
    const result = await request.execute(name);
    return result.recordset ?? [];
  }

  async query<T = unknown>(sqlText: string, params?: Record<string, unknown>): Promise<T[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value as any);
      }
    }
    const result = await request.query(sqlText);
    return (result.recordset ?? []) as T[];
  }

  // ── Catalog browsing ────────────────────────────────────────────────

  async getCatalogFolders(): Promise<CatalogFolder[]> {
    this._ensureConnected();
    const rows = await this.executeQuery(
      `SELECT folder_id, name, description, created_time
       FROM [SSISDB].[catalog].[folders]
       ORDER BY name`,
    );
    return rows.map((r: any) => ({
      folderId: r.folder_id,
      name: r.name,
      description: r.description ?? '',
      createdTime: new Date(r.created_time),
    }));
  }

  async getProjects(folderId: number): Promise<CatalogProject[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('folderId', sql.BigInt, folderId);
    const result = await request.query(
      `SELECT project_id, folder_id, name, description,
              deployed_by_name, last_deployed_time
       FROM [SSISDB].[catalog].[projects]
       WHERE folder_id = @folderId
       ORDER BY name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      projectId: r.project_id,
      folderId: r.folder_id,
      name: r.name,
      description: r.description ?? '',
      deployedByName: r.deployed_by_name ?? '',
      lastDeployedTime: r.last_deployed_time ? new Date(r.last_deployed_time) : new Date(),
    }));
  }

  async getPackages(projectId: number): Promise<CatalogPackage[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('projectId', sql.BigInt, projectId);
    const result = await request.query(
      `SELECT package_id, project_id, name, description, package_format_version
       FROM [SSISDB].[catalog].[packages]
       WHERE project_id = @projectId
       ORDER BY name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      packageId: r.package_id,
      projectId: r.project_id,
      name: r.name,
      description: r.description ?? '',
      packageFormatVersion: r.package_format_version ?? 0,
    }));
  }

  async getEnvironments(folderId: number): Promise<CatalogEnvironment[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('folderId', sql.BigInt, folderId);
    const result = await request.query(
      `SELECT environment_id, folder_id, name, description
       FROM [SSISDB].[catalog].[environments]
       WHERE folder_id = @folderId
       ORDER BY name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      environmentId: r.environment_id,
      folderId: r.folder_id,
      name: r.name,
      description: r.description ?? '',
    }));
  }

  async getEnvironmentVariables(environmentId: number): Promise<CatalogEnvVariable[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('environmentId', sql.BigInt, environmentId);
    const result = await request.query(
      `SELECT variable_id, environment_id, name, description,
              type, value, sensitive
       FROM [SSISDB].[catalog].[environment_variables]
       WHERE environment_id = @environmentId
       ORDER BY name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      variableId: r.variable_id,
      environmentId: r.environment_id,
      name: r.name,
      description: r.description ?? '',
      type: r.type ?? 'String',
      value: r.sensitive ? '' : String(r.value ?? ''),
      sensitive: !!r.sensitive,
    }));
  }

  // ── Deployment ──────────────────────────────────────────────────────

  /**
   * Deploy a project (.ispac binary) to SSISDB via `catalog.deploy_project`.
   */
  async deployProject(folderName: string, projectName: string, ispacData: Buffer): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[deploy_project]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'project_name', type: sql.NVarChar(128), value: projectName },
      { name: 'project_stream', type: sql.VarBinary(sql.MAX), value: ispacData },
    ]);
  }

  // ── Execution ───────────────────────────────────────────────────────

  /**
   * Create an execution instance. Returns the execution_id.
   */
  async createExecution(
    packageName: string,
    folderName: string,
    projectName: string,
    environmentRef?: number,
    use32bit?: boolean,
  ): Promise<number> {
    const result = await this._executeCatalogProcedure(
      '[SSISDB].[catalog].[create_execution]',
      [
        { name: 'package_name', type: sql.NVarChar(260), value: packageName },
        { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
        { name: 'project_name', type: sql.NVarChar(128), value: projectName },
        { name: 'use32bitruntime', type: sql.Bit, value: use32bit ? 1 : 0 },
        { name: 'reference_id', type: sql.BigInt, value: environmentRef ?? null },
      ],
      [{ name: 'execution_id', type: sql.BigInt }],
    );
    return result.output.execution_id as number;
  }

  /**
   * Set a parameter value on an execution.
   */
  async setExecutionParameterValue(
    executionId: number,
    objectType: number,
    parameterName: string,
    parameterValue: any,
  ): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[set_execution_parameter_value]', [
      { name: 'execution_id', type: sql.BigInt, value: executionId },
      { name: 'object_type', type: sql.SmallInt, value: objectType },
      { name: 'parameter_name', type: sql.NVarChar(128), value: parameterName },
      { name: 'parameter_value', type: sql.NVarChar(sql.MAX), value: String(parameterValue) },
    ]);
  }

  /**
   * Start an execution.
   */
  async startExecution(executionId: number): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[start_execution]', [
      { name: 'execution_id', type: sql.BigInt, value: executionId },
    ]);
  }

  /**
   * Get the current status of an execution.
   */
  async getExecutionStatus(executionId: number): Promise<ExecutionStatus> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('executionId', sql.BigInt, executionId);
    const result = await request.query(
      `SELECT execution_id, status, start_time, end_time
       FROM [SSISDB].[catalog].[executions]
       WHERE execution_id = @executionId`,
    );
    const r = result.recordset[0];
    if (!r) { throw new Error(`Execution ${executionId} not found`); }
    return {
      executionId: r.execution_id,
      status: r.status,
      startTime: new Date(r.start_time),
      endTime: r.end_time ? new Date(r.end_time) : undefined,
    };
  }

  /**
   * Get execution messages (event_messages), optionally after a given message id.
   */
  async getExecutionMessages(
    executionId: number,
    afterMessageId?: number,
  ): Promise<ExecutionMessage[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('executionId', sql.BigInt, executionId);
    const afterClause = afterMessageId !== undefined
      ? `AND em.event_message_id > @afterMessageId`
      : '';
    if (afterMessageId !== undefined) {
      request.input('afterMessageId', sql.BigInt, afterMessageId);
    }
    const result = await request.query(
      `SELECT TOP 500
              em.event_message_id AS message_id,
              em.event_message_id,
              em.message_time,
              em.message_type,
              em.message_source_type,
              em.message,
              em.package_name,
              em.event_name,
              em.execution_path
       FROM [SSISDB].[catalog].[event_messages] em
       WHERE em.operation_id = @executionId
         ${afterClause}
       ORDER BY em.event_message_id ASC`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      messageId: r.message_id,
      eventMessageId: r.event_message_id,
      messageTime: new Date(r.message_time),
      messageType: r.message_type,
      messageSourceType: r.message_source_type,
      message: r.message ?? '',
      packageName: r.package_name ?? '',
      eventName: r.event_name ?? '',
      executionPath: r.execution_path ?? '',
    }));
  }

  /**
   * Get execution history for a project/package.
   */
  async getExecutionHistory(
    projectName?: string,
    packageName?: string,
    top = 50,
  ): Promise<ExecutionHistory[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    const clauses: string[] = [];
    if (projectName) {
      request.input('projectName', sql.NVarChar(128), projectName);
      clauses.push('e.project_name = @projectName');
    }
    if (packageName) {
      request.input('packageName', sql.NVarChar(260), packageName);
      clauses.push('e.package_name = @packageName');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    request.input('top', sql.Int, top);
    const result = await request.query(
      `SELECT TOP (@top)
              e.execution_id, e.folder_name, e.project_name, e.package_name,
              e.status, e.start_time, e.end_time, e.executed_as_name
       FROM [SSISDB].[catalog].[executions] e
       ${where}
       ORDER BY e.execution_id DESC`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      executionId: r.execution_id,
      folderName: r.folder_name ?? '',
      projectName: r.project_name ?? '',
      packageName: r.package_name ?? '',
      status: r.status,
      startTime: new Date(r.start_time),
      endTime: r.end_time ? new Date(r.end_time) : undefined,
      executedAsName: r.executed_as_name ?? '',
    }));
  }

  // ── SSISDB folder management ────────────────────────────────────────

  /**
   * Create a folder in SSISDB.
   */
  async createCatalogFolder(folderName: string): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[create_folder]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
    ]);
  }

  // ── Environment management ──────────────────────────────────────────

  /**
   * Create a new environment in SSISDB.
   */
  async createEnvironment(folderName: string, envName: string, description?: string): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[create_environment]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
      { name: 'environment_description', type: sql.NVarChar(1024), value: description ?? '' },
    ]);
  }

  /**
   * Delete an environment from SSISDB.
   */
  async deleteEnvironment(folderName: string, envName: string): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[delete_environment]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
    ]);
  }

  /**
   * Set an environment property (e.g. description).
   */
  async setEnvironmentProperty(
    folderName: string,
    envName: string,
    propertyName: string,
    propertyValue: string,
  ): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[set_environment_property]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
      { name: 'property_name', type: sql.NVarChar(128), value: propertyName },
      { name: 'property_value', type: sql.NVarChar(4000), value: propertyValue },
    ]);
  }

  /**
   * Create an environment variable.
   */
  async createEnvironmentVariable(
    folderName: string,
    envName: string,
    varName: string,
    type: string,
    value: any,
    sensitive: boolean,
    description?: string,
  ): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[create_environment_variable]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
      { name: 'variable_name', type: sql.NVarChar(128), value: varName },
      { name: 'data_type', type: sql.NVarChar(128), value: type },
      { name: 'sensitive', type: sql.Bit, value: sensitive ? 1 : 0 },
      { name: 'value', type: sql.NVarChar(sql.MAX), value: value != null ? String(value) : '' },
      { name: 'description', type: sql.NVarChar(1024), value: description ?? '' },
    ]);
  }

  /**
   * Set the value of an existing environment variable.
   */
  async setEnvironmentVariableValue(
    folderName: string,
    envName: string,
    varName: string,
    value: any,
  ): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[set_environment_variable_value]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
      { name: 'variable_name', type: sql.NVarChar(128), value: varName },
      { name: 'value', type: sql.NVarChar(sql.MAX), value: value != null ? String(value) : '' },
    ]);
  }

  /**
   * Delete an environment variable.
   */
  async deleteEnvironmentVariable(
    folderName: string,
    envName: string,
    varName: string,
  ): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[delete_environment_variable]', [
      { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
      { name: 'environment_name', type: sql.NVarChar(128), value: envName },
      { name: 'variable_name', type: sql.NVarChar(128), value: varName },
    ]);
  }

  /**
   * Get environment variables by folder name and environment name.
   */
  async getEnvironmentVariablesByName(
    folderName: string,
    environmentName: string,
  ): Promise<CatalogEnvVariable[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('folderName', sql.NVarChar(128), folderName);
    request.input('envName', sql.NVarChar(128), environmentName);
    const result = await request.query(
      `SELECT ev.variable_id, ev.environment_id, ev.name, ev.description,
              ev.type, ev.value, ev.sensitive
       FROM [SSISDB].[catalog].[environment_variables] ev
       INNER JOIN [SSISDB].[catalog].[environments] e
         ON ev.environment_id = e.environment_id
       INNER JOIN [SSISDB].[catalog].[folders] f
         ON e.folder_id = f.folder_id
       WHERE f.name = @folderName AND e.name = @envName
       ORDER BY ev.name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      variableId: r.variable_id,
      environmentId: r.environment_id,
      name: r.name,
      description: r.description ?? '',
      type: r.type ?? 'String',
      value: r.sensitive ? '' : String(r.value ?? ''),
      sensitive: !!r.sensitive,
    }));
  }

  // ── Environment references ──────────────────────────────────────────

  /**
   * Get environment references for a project.
   */
  async getEnvironmentReferences(
    projectName: string,
    folderName: string,
  ): Promise<EnvironmentReference[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('projectName', sql.NVarChar(128), projectName);
    request.input('folderName', sql.NVarChar(128), folderName);
    const result = await request.query(
      `SELECT er.reference_id, er.project_id, er.environment_name,
              er.environment_folder_name, er.reference_type
       FROM [SSISDB].[catalog].[environment_references] er
       INNER JOIN [SSISDB].[catalog].[projects] p
         ON er.project_id = p.project_id
       INNER JOIN [SSISDB].[catalog].[folders] f
         ON p.folder_id = f.folder_id
       WHERE p.name = @projectName AND f.name = @folderName
       ORDER BY er.environment_name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      referenceId: r.reference_id,
      projectId: r.project_id,
      environmentName: r.environment_name,
      environmentFolderName: r.environment_folder_name ?? null,
      referenceType: r.reference_type as 'R' | 'A',
    }));
  }

  /**
   * Create an environment reference for a project.
   */
  async createEnvironmentReference(
    projectName: string,
    folderName: string,
    envName: string,
    envFolderName?: string,
  ): Promise<void> {
    // Reference type: 'R' for relative (same folder), 'A' for absolute
    const refType = envFolderName ? 'A' : 'R';
    await this._executeCatalogProcedure(
      '[SSISDB].[catalog].[create_environment_reference]',
      [
        { name: 'folder_name', type: sql.NVarChar(128), value: folderName },
        { name: 'project_name', type: sql.NVarChar(128), value: projectName },
        { name: 'environment_name', type: sql.NVarChar(128), value: envName },
        { name: 'reference_type', type: sql.Char(1), value: refType },
        { name: 'environment_folder_name', type: sql.NVarChar(128), value: envFolderName ?? null },
      ],
      [{ name: 'reference_id', type: sql.BigInt }],
    );
  }

  /**
   * Delete an environment reference by reference_id.
   */
  async deleteEnvironmentReference(referenceId: number): Promise<void> {
    await this._executeCatalogProcedure('[SSISDB].[catalog].[delete_environment_reference]', [
      { name: 'reference_id', type: sql.BigInt, value: referenceId },
    ]);
  }

  // ── Execution data statistics & parameters ──────────────────────────

  /**
   * Get data statistics (row counts per component) for an execution.
   */
  async getExecutionDataStatistics(executionId: number): Promise<DataStatistic[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('executionId', sql.BigInt, executionId);
    const result = await request.query(
      `SELECT eds.data_stats_id, eds.execution_id, eds.package_name,
              eds.dataflow_path_id_string, eds.source_component_name,
              eds.destination_component_name, eds.rows_sent, eds.created_time
       FROM [SSISDB].[catalog].[execution_data_statistics] eds
       WHERE eds.execution_id = @executionId
       ORDER BY eds.created_time ASC`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      dataStatisticsId: r.data_stats_id,
      executionId: r.execution_id,
      packageName: r.package_name ?? '',
      dataflowPathIdString: r.dataflow_path_id_string ?? '',
      sourceName: r.source_component_name ?? '',
      destinationName: r.destination_component_name ?? '',
      rowsSent: r.rows_sent ?? 0,
      createdTime: r.created_time ? new Date(r.created_time) : new Date(),
    }));
  }

  /**
   * Get parameter values used in an execution.
   */
  async getExecutionParameters(executionId: number): Promise<ExecutionParameter[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('executionId', sql.BigInt, executionId);
    const result = await request.query(
      `SELECT epv.execution_id, epv.object_type, epv.parameter_name,
              epv.parameter_value, epv.sensitive
       FROM [SSISDB].[catalog].[execution_parameter_values] epv
       WHERE epv.execution_id = @executionId
       ORDER BY epv.parameter_name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      executionId: r.execution_id,
      objectType: r.object_type,
      parameterName: r.parameter_name ?? '',
      parameterValue: r.sensitive ? null : r.parameter_value,
      sensitiveParameterValue: !!r.sensitive,
    }));
  }

  // ── Server Capability Detection ─────────────────────────────────────

  /**
   * Detect which SSIS deployment models the connected server supports.
   * - SSISDB catalog (project deployment model, SQL 2012+)
   * - msdb package store (package deployment model, legacy)
   */
  async detectCapabilities(): Promise<ServerCapabilities> {
    this._ensureConnected();

    let hasSsisdb = false;
    let hasMsdbStore = false;

    try {
      const dbResult = await this.executeQuery(
        `SELECT 1 FROM sys.databases WHERE name = 'SSISDB'`,
      );
      hasSsisdb = dbResult.length > 0;
    } catch { /* not available */ }

    try {
      const msdbResult = await this.executeQuery(
        `SELECT 1 FROM msdb.sys.objects WHERE name = 'sysssispackages' AND type = 'U'`,
      );
      hasMsdbStore = msdbResult.length > 0;
    } catch { /* not available */ }

    return { hasSsisdb, hasMsdbStore };
  }

  // ── MSDB Package Store (Package Deployment Model) ───────────────────

  /**
   * Get folders from the MSDB SSIS package store.
   */
  async getMsdbFolders(parentFolderId?: string): Promise<MsdbFolder[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    let query: string;
    if (parentFolderId !== undefined) {
      request.input('parentId', sql.UniqueIdentifier, parentFolderId);
      query = `SELECT folderid, parentfolderid, foldername
               FROM msdb.dbo.sysssispackagefolders
               WHERE parentfolderid = @parentId
               ORDER BY foldername`;
    } else {
      // Root folders have parentfolderid = the special root GUID or NULL
      query = `SELECT folderid, parentfolderid, foldername
               FROM msdb.dbo.sysssispackagefolders
               ORDER BY foldername`;
    }
    const result = await request.query(query);
    return (result.recordset ?? []).map((r: any) => ({
      folderId: String(r.folderid),
      parentFolderId: r.parentfolderid ? String(r.parentfolderid) : null,
      name: r.foldername ?? '',
    }));
  }

  /**
   * Get packages from the MSDB SSIS package store in a specific folder.
   */
  async getMsdbPackages(folderId: string): Promise<MsdbPackage[]> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('folderId', sql.UniqueIdentifier, folderId);
    const result = await request.query(
      `SELECT id, name, description, folderid
       FROM msdb.dbo.sysssispackages
       WHERE folderid = @folderId
       ORDER BY name`,
    );
    return (result.recordset ?? []).map((r: any) => ({
      id: String(r.id),
      name: r.name ?? '',
      description: r.description ?? '',
      folderId: String(r.folderid),
    }));
  }

  /**
   * Get all packages from the MSDB SSIS package store.
   */
  async getMsdbAllPackages(): Promise<MsdbPackage[]> {
    this._ensureConnected();
    const result = await this.executeQuery(
      `SELECT id, name, description, folderid
       FROM msdb.dbo.sysssispackages
       ORDER BY name`,
    );
    return result.map((r: any) => ({
      id: String(r.id),
      name: r.name ?? '',
      description: r.description ?? '',
      folderId: String(r.folderid),
    }));
  }

  /**
   * Download a package's XML (dtsx) from the MSDB store.
   */
  async getMsdbPackageData(packageId: string): Promise<Buffer> {
    this._ensureConnected();
    const request = this.pool!.request();
    request.input('pkgId', sql.UniqueIdentifier, packageId);
    const result = await request.query(
      `SELECT packagedata FROM msdb.dbo.sysssispackages WHERE id = @pkgId`,
    );
    const row = result.recordset?.[0];
    if (!row?.packagedata) {
      throw new Error(`Package ${packageId} not found or has no data`);
    }
    return row.packagedata as Buffer;
  }

  /**
   * Execute an MSDB-stored package using sp_start_job or dtexec.
   * Returns the job name created for execution tracking.
   */
  async executeMsdbPackage(
    packagePath: string,
    serverName: string,
  ): Promise<string> {
    this._ensureConnected();
    // Use SQL Agent to run the package
    const jobName = `SSIS_VSCode_${Date.now()}`;
    const request = this.pool!.request();
    // Create a one-time SQL Agent job that runs the package
    await request.query(`
      EXEC msdb.dbo.sp_add_job @job_name = '${jobName}';
      EXEC msdb.dbo.sp_add_jobstep @job_name = '${jobName}',
        @step_name = 'RunPackage',
        @subsystem = 'SSIS',
        @command = '/SQL "${packagePath}" /SERVER "${serverName}"';
      EXEC msdb.dbo.sp_add_jobserver @job_name = '${jobName}';
      EXEC msdb.dbo.sp_start_job @job_name = '${jobName}';
    `);
    return jobName;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private _ensureConnected(): void {
    if (!this.pool || !this.connected) {
      throw new Error('Not connected to SQL Server');
    }
  }

  /**
   * Execute an SSISDB catalog stored procedure, wrapping it with
   * `EXECUTE AS LOGIN` / `REVERT` when impersonation is configured.
   *
   * @param spName     Fully-qualified SP name, e.g. `[SSISDB].[catalog].[create_folder]`
   * @param params     Array of `{ name, type, value }` input parameters
   * @param outputDefs Optional array of `{ name, type }` output parameters
   * @returns          The raw `IResult` when there are output params, else void
   */
  private async _executeCatalogProcedure(
    spName: string,
    params: { name: string; type: any; value: any }[],
    outputDefs?: { name: string; type: any }[],
  ): Promise<sql.IResult<any>> {
    this._ensureConnected();

    const request = this.pool!.request();
    for (const p of params) {
      request.input(p.name, p.type, p.value);
    }
    if (outputDefs) {
      for (const o of outputDefs) {
        request.output(o.name, o.type);
      }
    }
    return request.execute(spName);
  }

  /**
   * Parse an OLEDB/ADO.NET-style connection string into an mssql config object.
   */
  parseConnectionString(connectionString: string): sql.config {
    const parts = new Map<string, string>();
    for (const segment of connectionString.split(';')) {
      const eqIdx = segment.indexOf('=');
      if (eqIdx > 0) {
        const key = segment.substring(0, eqIdx).trim().toLowerCase();
        const value = segment.substring(eqIdx + 1).trim();
        parts.set(key, value);
      }
    }

    const server = parts.get('server') ?? parts.get('data source') ?? 'localhost';
    const database = parts.get('database') ?? parts.get('initial catalog') ?? 'master';
    const user = parts.get('user id') ?? parts.get('uid') ?? parts.get('user') ?? '';
    const password = parts.get('password') ?? parts.get('pwd') ?? '';
    const integratedSecurity = parts.get('integrated security')?.toLowerCase();
    const trusted = integratedSecurity === 'sspi' || integratedSecurity === 'true';
    const authKeyword = parts.get('authentication')?.toLowerCase() ?? '';

    const encryptRaw = parts.get('encrypt')?.toLowerCase();
    const encrypt = encryptRaw === undefined || encryptRaw === 'yes' || encryptRaw === 'true' || encryptRaw === 'mandatory';
    const trustCertRaw = parts.get('trustservercertificate')?.toLowerCase();
    const trustServerCertificate = trustCertRaw === 'yes' || trustCertRaw === 'true';

    // Command Timeout / Connect Timeout → requestTimeout (ms)
    const timeoutRaw = parts.get('command timeout') ?? parts.get('connect timeout') ?? parts.get('connection timeout');
    const requestTimeout = timeoutRaw ? parseInt(timeoutRaw, 10) * 1000 : undefined;

    let host = server;
    let port = 1433;
    let instanceName: string | undefined;

    // Strip protocol prefix (e.g. "tcp:host" → "host")
    if (/^[a-z]+:/i.test(host)) {
      host = host.replace(/^[a-z]+:/i, '');
    }

    // Handle "." and "(local)" as localhost aliases
    if (host === '.' || host.toLowerCase() === '(local)') {
      host = 'localhost';
    }

    // Handle named instances: "host\instance" or ".\instance"
    if (host.includes('\\')) {
      const [h, inst] = host.split('\\', 2);
      host = (h === '.' || h.toLowerCase() === '(local)' || h === '') ? 'localhost' : h;
      instanceName = inst;
      // Do not set a fixed port — the SQL Browser service resolves it
      port = 0;
    }

    // Handle port override: "host,port"
    if (host.includes(',')) {
      const [h, p] = host.split(',');
      host = h;
      port = parseInt(p, 10) || 1433;
    }

    const config: sql.config = {
      server: host,
      database,
      ...(requestTimeout !== undefined ? { requestTimeout } : {}),
      options: {
        encrypt,
        trustServerCertificate,
        ...(instanceName ? { instanceName } : {}),
      },
    };

    // Only set port when not using a named instance (SQL Browser resolves the port)
    if (!instanceName || port !== 0) {
      config.port = port || 1433;
    }

    // Map OLE DB / ADO.NET authentication keywords to tedious driver types
    const entraTypeMap: Record<string, string> = {
      'activedirectorypassword': 'azure-active-directory-password',
      'activedirectoryintegrated': 'azure-active-directory-default',
      'activedirectoryinteractive': 'azure-active-directory-interactive',
      'activedirectoryserviceprincipal': 'azure-active-directory-service-principal-secret',
    };

    const tediousAuthType = entraTypeMap[authKeyword];

    if (tediousAuthType) {
      // Entra / Azure AD authentication
      (config as any).authentication = {
        type: tediousAuthType,
        options: {
          userName: user,
          password: password,
        },
      };
    } else if (trusted) {
      (config as any).authentication = {
        type: 'ntlm',
        options: { domain: '' },
      };
    } else if (user) {
      config.user = user;
      config.password = password;
    }

    return config;
  }
}
