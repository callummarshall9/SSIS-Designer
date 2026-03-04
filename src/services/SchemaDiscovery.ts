import { TdsClient } from './TdsClient';

/**
 * Service for discovering database schemas from SQL Server.
 * Used for connection manager configuration and data flow mapping.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TableInfo {
    schema: string;
    name: string;
    type: 'TABLE' | 'VIEW';
}

export interface ColumnInfo {
    name: string;
    dataType: string;       // SQL data type
    ssisDataType: string;   // Mapped SSIS data type
    maxLength: number;
    precision: number;
    scale: number;
    isNullable: boolean;
    isIdentity: boolean;
    ordinalPosition: number;
}

// ---------------------------------------------------------------------------
// SQL type → SSIS type mapping
// ---------------------------------------------------------------------------

const SQL_TO_SSIS_MAP: Record<string, string> = {
    // String types
    'varchar':            'DT_STR',
    'char':               'DT_STR',
    'nvarchar':           'DT_WSTR',
    'nchar':              'DT_WSTR',
    'text':               'DT_TEXT',
    'ntext':              'DT_NTEXT',

    // Integer types
    'int':                'DT_I4',
    'bigint':             'DT_I8',
    'smallint':           'DT_I2',
    'tinyint':            'DT_UI1',
    'bit':                'DT_BOOL',

    // Decimal / numeric types
    'decimal':            'DT_NUMERIC',
    'numeric':            'DT_NUMERIC',
    'money':              'DT_CY',
    'smallmoney':         'DT_CY',

    // Floating-point types
    'float':              'DT_R8',
    'real':               'DT_R4',

    // Date / time types
    'datetime':           'DT_DBTIMESTAMP',
    'datetime2':          'DT_DBTIMESTAMP',
    'smalldatetime':      'DT_DBTIMESTAMP',
    'date':               'DT_DBDATE',
    'time':               'DT_DBTIME',
    'datetimeoffset':     'DT_DBTIMESTAMPOFFSET',

    // Binary types
    'varbinary':          'DT_BYTES',
    'binary':             'DT_BYTES',
    'image':              'DT_IMAGE',

    // Other types
    'uniqueidentifier':   'DT_GUID',
    'xml':                'DT_NTEXT',
    'sql_variant':        'DT_WSTR',
    'timestamp':          'DT_BYTES',
    'rowversion':         'DT_BYTES',
    'hierarchyid':        'DT_BYTES',
    'geography':          'DT_IMAGE',
    'geometry':           'DT_IMAGE',
};

// ---------------------------------------------------------------------------
// SchemaDiscovery
// ---------------------------------------------------------------------------

export class SchemaDiscovery {
    constructor(private readonly client: TdsClient) {}

    // -----------------------------------------------------------------------
    // Discover databases
    // -----------------------------------------------------------------------

    /**
     * List all databases on the connected server.
     */
    async discoverDatabases(): Promise<string[]> {
        this.ensureConnected();
        const rows = await this.client.executeQuery(
            `SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name`
        );
        return rows.map((r: any) => r.name as string);
    }

    // -----------------------------------------------------------------------
    // Discover tables and views
    // -----------------------------------------------------------------------

    /**
     * Discover all tables and views in the specified (or current) database.
     */
    async discoverTables(database?: string): Promise<TableInfo[]> {
        this.ensureConnected();

        const useDb = database ? `USE [${database}]; ` : '';
        const sql = `${useDb}
            SELECT
                TABLE_SCHEMA  AS [schema],
                TABLE_NAME    AS [name],
                TABLE_TYPE    AS [type]
            FROM INFORMATION_SCHEMA.TABLES
            ORDER BY TABLE_SCHEMA, TABLE_NAME`;

        const rows = await this.client.executeQuery(sql);
        return rows.map((r: any) => ({
            schema: r.schema as string,
            name: r.name as string,
            type: (r.type === 'BASE TABLE' ? 'TABLE' : 'VIEW') as 'TABLE' | 'VIEW',
        }));
    }

    // -----------------------------------------------------------------------
    // Discover columns
    // -----------------------------------------------------------------------

    /**
     * Discover columns for a specific table or view.
     */
    async discoverColumns(tableName: string, schema: string = 'dbo'): Promise<ColumnInfo[]> {
        this.ensureConnected();

        const sql = `
            SELECT
                c.COLUMN_NAME            AS [name],
                c.DATA_TYPE              AS [dataType],
                ISNULL(c.CHARACTER_MAXIMUM_LENGTH, 0) AS [maxLength],
                ISNULL(c.NUMERIC_PRECISION, 0)        AS [precision],
                ISNULL(c.NUMERIC_SCALE, 0)            AS [scale],
                CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS [isNullable],
                ISNULL(COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME),
                        c.COLUMN_NAME, 'IsIdentity'), 0) AS [isIdentity],
                c.ORDINAL_POSITION       AS [ordinalPosition]
            FROM INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_NAME = '${escapeSqlString(tableName)}'
              AND c.TABLE_SCHEMA = '${escapeSqlString(schema)}'
            ORDER BY c.ORDINAL_POSITION`;

        const rows = await this.client.executeQuery(sql);
        return rows.map((r: any) => ({
            name: r.name as string,
            dataType: r.dataType as string,
            ssisDataType: SchemaDiscovery.mapSqlTypeToSsis(r.dataType as string),
            maxLength: Number(r.maxLength) || 0,
            precision: Number(r.precision) || 0,
            scale: Number(r.scale) || 0,
            isNullable: Boolean(r.isNullable),
            isIdentity: Boolean(r.isIdentity),
            ordinalPosition: Number(r.ordinalPosition) || 0,
        }));
    }

    // -----------------------------------------------------------------------
    // Preview data
    // -----------------------------------------------------------------------

    /**
     * Preview the first N rows of a table.
     */
    async previewData(
        tableName: string,
        schema: string = 'dbo',
        topN: number = 100,
    ): Promise<Record<string, any>[]> {
        this.ensureConnected();

        const n = Math.max(1, Math.min(topN, 1000)); // clamp to 1-1000
        const sql = `SELECT TOP ${n} * FROM [${escapeSqlString(schema)}].[${escapeSqlString(tableName)}]`;
        return this.client.executeQuery(sql);
    }

    // -----------------------------------------------------------------------
    // SQL type → SSIS type
    // -----------------------------------------------------------------------

    /**
     * Map a SQL Server data type name to the corresponding SSIS data type.
     */
    static mapSqlTypeToSsis(sqlType: string): string {
        const normalized = (sqlType || '').toLowerCase().trim();
        return SQL_TO_SSIS_MAP[normalized] ?? 'DT_WSTR';
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private ensureConnected(): void {
        if (!this.client.isConnected()) {
            throw new Error('Not connected to SQL Server');
        }
    }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Simple SQL string escape (replace single quotes). NOT for parameterized input. */
function escapeSqlString(value: string): string {
    return value.replace(/'/g, "''").replace(/\]/g, ']]');
}
