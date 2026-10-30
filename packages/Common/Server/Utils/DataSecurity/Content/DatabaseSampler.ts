import { Client } from "pg";
import {
  Connection as MySqlConnection,
  ConnectionOptions as MySqlConnectionOptions,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import * as mssql from "mssql";
import { CollectedField } from "../../../../Utils/DataSecurity/FieldCollector";
import {
  ContentScanOptions,
  ContentScanResult,
  DataStoreLocationKind,
  emptyContentScanResult,
  LocationFindings,
  MAX_READ_LOG_ENTRIES,
} from "../DataSecurityScanTypes";
import { FingerprintAccumulator } from "../Fingerprint";
import {
  classifyCollectedFields,
  FieldsClassification,
} from "./ContentClassifier";

/*
 * A DATABASE, SAMPLED A FEW ROWS PER TABLE, WITHOUT WRITING A BYTE.
 *
 * The sampler connects with the connection string it is given (a read-only
 * login is what a person is asked for), lists the base tables the login
 * can see from information_schema - system schemas, partitions and the
 * store's exclusions left out - with each table's estimated row count from
 * the engine's own statistics, and reads up to maxRowsPerTable rows of at
 * most maxTables tables, each column cast to text and cut to
 * MAX_VALUE_LENGTH characters by the database itself. Each column is
 * classified as a field ("schema.table.column"), fields named for
 * passwords are checked for passwords kept as they are, and High values
 * feed the scan's fingerprints.
 *
 * Every statement is the sampler's own, and every name in one is quoted the
 * engine's way - never interpolated as it is - while values are bound by
 * the driver. Nothing it runs can write:
 *
 *  - PostgreSQL: the session's transactions default to READ ONLY, and each
 *    table is read in its own transaction that says so again (SET
 *    TRANSACTION READ ONLY), with SET LOCAL statement_timeout and
 *    lock_timeout. Large tables are sampled with TABLESAMPLE SYSTEM, which
 *    reads random pages instead of the table's start.
 *  - MySQL and MariaDB: SET SESSION TRANSACTION READ ONLY, then each table
 *    in START TRANSACTION READ ONLY, with MAX_EXECUTION_TIME (MariaDB:
 *    max_statement_time) and lock_wait_timeout.
 *  - SQL Server has no read-only transaction - snapshot isolation and READ
 *    UNCOMMITTED change what a statement sees, not what it may do - so the
 *    sampler relies on the read-only login it is given, runs only its own
 *    SELECTs, asks for a read-only replica (ApplicationIntent=ReadOnly),
 *    and bounds every statement with SET LOCK_TIMEOUT, a low deadlock
 *    priority and the driver's request timeout.
 *
 * The connection is always closed. The connection string is never logged,
 * and is taken out of every error message before it becomes a warning. A
 * connection that cannot be made is a thrown error, for the caller to
 * record; anything after it - a table that cannot be read - is a warning.
 */

export type DatabaseEngine = "postgresql" | "mysql" | "sqlserver";

export const DATABASE_ENGINES: ReadonlyArray<DatabaseEngine> = [
  "postgresql",
  "mysql",
  "sqlserver",
];

export interface DatabaseConnection {
  engine: DatabaseEngine;
  connectionString: string;
}

export const CONNECT_TIMEOUT_IN_MS: number = 10_000;

// The longest one statement may run, and a lock may be waited for.
export const STATEMENT_TIMEOUT_IN_MS: number = 30_000;
export const LOCK_TIMEOUT_IN_MS: number = 5_000;

// The most characters of one value the database sends.
export const MAX_VALUE_LENGTH: number = 2_048;

// The most values read from one table: rows times columns.
export const MAX_CELLS_PER_TABLE: number = 50_000;

// The most columns of one table read.
const MAX_COLUMNS_PER_TABLE: number = 250;

// Tables listed for each one the scan may read, to choose from.
const TABLE_LISTING_FACTOR: number = 5;
const MAX_LISTED_TABLES: number = 25_000;

// A table this much larger than the sample is sampled, not read from its start.
const TABLESAMPLE_FACTOR: number = 20;

// Statements that failed one after another before the scan gives up.
const MAX_CONSECUTIVE_FAILURES: number = 5;

const MAX_WARNINGS: number = 50;

const MAX_PLAINTEXT_PASSWORD_FIELDS: number = 50;

const APPLICATION_NAME: string = "oneuptime-data-security";

/*
 * Column types that cannot hold the data a scan looks for: binary data,
 * flags, identifiers, geometry, full-text vectors.
 */
const SKIPPED_TYPES: ReadonlySet<string> = new Set([
  // PostgreSQL
  "bytea",
  "boolean",
  "uuid",
  "tsvector",
  "tsquery",
  "point",
  "line",
  "lseg",
  "box",
  "path",
  "polygon",
  "circle",
  "bit",
  "bit varying",
  "interval",
  "oid",
  "regclass",
  "pg_lsn",
  "txid_snapshot",
  // MySQL
  "binary",
  "varbinary",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "geometry",
  "linestring",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
  // SQL Server
  "image",
  "timestamp",
  "rowversion",
  "uniqueidentifier",
  "geography",
  "hierarchyid",
  "sql_variant",
]);

// SQL Server types converted with an ISO 8601 style, so dates read as dates.
const SQL_SERVER_DATE_TYPES: ReadonlySet<string> = new Set([
  "date",
  "datetime",
  "datetime2",
  "smalldatetime",
  "datetimeoffset",
  "time",
]);

const SQL_SERVER_SCHEME: RegExp = /^(?:jdbc:)?(?:mssql|sqlserver):\/\//i;
const MARIADB_SCHEME: RegExp = /^mariadb:\/\//i;
const LEADING_SLASHES: RegExp = /^\/{1,8}/;

/*
 * QUOTING. A name is quoted the engine's way, its quote character doubled
 * inside it; a name no catalog can hold (empty, with a NUL, too long) is
 * refused rather than quoted.
 */
function checkIdentifier(name: string, maxLength: number): void {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > maxLength ||
    name.indexOf("\u0000") >= 0
  ) {
    throw new Error("A table or column name could not be quoted safely.");
  }
}

export function quotePostgresIdentifier(name: string): string {
  checkIdentifier(name, 1024);
  return `"${name.split('"').join('""')}"`;
}

export function quoteMySqlIdentifier(name: string): string {
  checkIdentifier(name, 1024);
  return `\`${name.split("`").join("``")}\``;
}

export function quoteSqlServerIdentifier(name: string): string {
  checkIdentifier(name, 128);
  return `[${name.split("]").join("]]")}]`;
}

/*
 * SECRETS OF A CONNECTION STRING, to take out of error messages: the whole
 * string, its password (as written and decoded) and its user:password.
 */
export function getConnectionSecrets(connectionString: string): Array<string> {
  const secrets: Set<string> = new Set([connectionString]);

  try {
    const url: URL = new URL(
      connectionString.replace(SQL_SERVER_SCHEME, "mssql://"),
    );

    if (url.password) {
      secrets.add(url.password);
      secrets.add(decodeURIComponent(url.password));
      secrets.add(`${url.username}:${url.password}`);
    }
  } catch {
    // Not a URL: read its key=value pairs below.
  }

  for (const pair of connectionString.split(";")) {
    const equals: number = pair.indexOf("=");

    if (equals < 0) {
      continue;
    }

    const key: string = pair.slice(0, equals).trim().toLowerCase();

    if (key === "password" || key === "pwd") {
      secrets.add(pair.slice(equals + 1).trim());
    }
  }

  return [...secrets]
    .filter((secret: string) => {
      return secret.length >= 3;
    })
    .sort((a: string, b: string) => {
      return b.length - a.length;
    });
}

export function sanitizeErrorMessage(
  error: unknown,
  secrets: ReadonlyArray<string>,
): string {
  let message: string =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";

  for (const secret of secrets) {
    message = message.split(secret).join("****");
  }

  return message.split("\n")[0]!.slice(0, 300);
}

/*
 * SQL SERVER CONNECTION STRINGS: a URL (mssql://user:password@host:1433/
 * database), JDBC's sqlserver://host:1433;databaseName=...;user=..., or
 * ADO.NET's Server=...;Database=...;User Id=...;Password=... - which the
 * driver reads itself.
 */
export function parseSqlServerConnectionString(
  connectionString: string,
): mssql.config {
  const trimmed: string = connectionString.trim();

  if (!SQL_SERVER_SCHEME.test(trimmed)) {
    return mssql.ConnectionPool.parseConnectionString(trimmed);
  }

  const rest: string = trimmed.replace(SQL_SERVER_SCHEME, "");
  const semicolon: number = rest.indexOf(";");
  const hasAuthority: boolean =
    rest.indexOf("@") >= 0 && (semicolon < 0 || rest.indexOf("@") < semicolon);

  if (!hasAuthority) {
    // JDBC: host[:port][;key=value]...
    const hostPart: string = semicolon < 0 ? rest : rest.slice(0, semicolon);
    const colon: number = hostPart.lastIndexOf(":");
    const pairs: Map<string, string> = new Map();

    for (const pair of (semicolon < 0 ? "" : rest.slice(semicolon + 1)).split(
      ";",
    )) {
      const equals: number = pair.indexOf("=");

      if (equals > 0) {
        pairs.set(
          pair.slice(0, equals).trim().toLowerCase(),
          pair.slice(equals + 1).trim(),
        );
      }
    }

    return {
      server: colon > 0 ? hostPart.slice(0, colon) : hostPart,
      port: colon > 0 ? Number(hostPart.slice(colon + 1)) || 1433 : 1433,
      user: pairs.get("user") || pairs.get("username"),
      password: pairs.get("password"),
      database: pairs.get("databasename") || pairs.get("database"),
      options: {
        encrypt: pairs.get("encrypt") !== "false",
        trustServerCertificate: pairs.get("trustservercertificate") === "true",
      },
    };
  }

  const url: URL = new URL(`mssql://${rest}`);
  const database: string =
    decodeURIComponent(url.pathname.replace(LEADING_SLASHES, "")) ||
    url.searchParams.get("database") ||
    url.searchParams.get("databaseName") ||
    "";

  return {
    server: url.hostname,
    port: Number(url.port) || 1433,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(database ? { database } : {}),
    options: {
      encrypt: url.searchParams.get("encrypt") !== "false",
      trustServerCertificate:
        url.searchParams.get("trustServerCertificate") === "true",
    },
  };
}

/*
 * ONE ENGINE'S STATEMENTS.
 */
interface TableToSample {
  schema: string;
  table: string;
  estimatedRows: number;
}

interface ColumnToSample {
  name: string;
  dataType: string;
}

interface DatabaseSession {
  readonly engine: DatabaseEngine;
  // Lists base tables the login can see, system schemas left out.
  listTables(limit: number): Promise<Array<TableToSample>>;
  listColumns(table: TableToSample): Promise<Array<ColumnToSample>>;
  // Reads rows of the given columns, as text, aliased c0, c1, ...
  sampleRows(data: {
    table: TableToSample;
    columns: Array<ColumnToSample>;
    rows: number;
    timeoutInMs: number;
  }): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

function toNumber(value: unknown): number {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string"
          ? Number(value)
          : NaN;

  return Number.isFinite(number) ? number : -1;
}

function readTables(
  rows: Array<Record<string, unknown>>,
): Array<TableToSample> {
  return rows
    .map((row: Record<string, unknown>) => {
      return {
        schema: String(row["table_schema"] ?? ""),
        table: String(row["table_name"] ?? ""),
        estimatedRows: toNumber(row["estimated_rows"]),
      };
    })
    .filter((table: TableToSample) => {
      return table.schema.length > 0 && table.table.length > 0;
    });
}

function readColumns(
  rows: Array<Record<string, unknown>>,
): Array<ColumnToSample> {
  return rows
    .map((row: Record<string, unknown>) => {
      return {
        name: String(row["column_name"] ?? ""),
        dataType: String(row["data_type"] ?? "").toLowerCase(),
      };
    })
    .filter((column: ColumnToSample) => {
      return column.name.length > 0;
    });
}

// A whole number of milliseconds, at least one second.
function wholeMilliseconds(value: number): number {
  return Math.max(1000, Math.floor(value));
}

class PostgresSession implements DatabaseSession {
  public readonly engine: DatabaseEngine = "postgresql";
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  public static async open(connectionString: string): Promise<PostgresSession> {
    const client: Client = new Client({
      connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_IN_MS,
      query_timeout: STATEMENT_TIMEOUT_IN_MS + 5_000,
      application_name: APPLICATION_NAME,
    });
    const session: PostgresSession = new PostgresSession(client);

    try {
      await client.connect();
      // Every transaction of the session is read-only unless it says not.
      await client.query(
        "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
      );
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  private async inReadOnlyTransaction<T>(
    timeoutInMs: number,
    work: () => Promise<T>,
  ): Promise<T> {
    await this.client.query("BEGIN");

    try {
      await this.client.query("SET TRANSACTION READ ONLY");
      await this.client.query(
        `SET LOCAL statement_timeout = ${wholeMilliseconds(timeoutInMs)}`,
      );
      await this.client.query(
        `SET LOCAL lock_timeout = ${wholeMilliseconds(
          Math.min(LOCK_TIMEOUT_IN_MS, timeoutInMs),
        )}`,
      );

      const result: T = await work();

      await this.client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.client.query("ROLLBACK");
      } catch {
        // The connection is gone: nothing to roll back.
      }

      throw error;
    }
  }

  private async rows(
    sql: string,
    values: Array<unknown> = [],
  ): Promise<Array<Record<string, unknown>>> {
    const result: { rows: Array<Record<string, unknown>> } =
      await this.client.query(sql, values);

    return result.rows || [];
  }

  public async listTables(limit: number): Promise<Array<TableToSample>> {
    return await this.inReadOnlyTransaction(
      STATEMENT_TIMEOUT_IN_MS,
      async (): Promise<Array<TableToSample>> => {
        return readTables(
          await this.rows(
            `SELECT t.table_schema AS table_schema, t.table_name AS table_name,
              COALESCE(CASE WHEN c.relkind = 'p' THEN (
                SELECT SUM(GREATEST(child.reltuples, 0))
                FROM pg_catalog.pg_inherits i
                JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
                WHERE i.inhparent = c.oid
              ) ELSE c.reltuples END, -1)::bigint AS estimated_rows
            FROM information_schema.tables t
            JOIN pg_catalog.pg_namespace n ON n.nspname = t.table_schema
            JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
            WHERE t.table_type = 'BASE TABLE'
              AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
              AND t.table_schema NOT LIKE 'pg\\_toast%'
              AND t.table_schema NOT LIKE 'pg\\_temp\\_%'
              AND NOT c.relispartition
            ORDER BY t.table_schema, t.table_name
            LIMIT $1`,
            [limit],
          ),
        );
      },
    );
  }

  public async listColumns(
    table: TableToSample,
  ): Promise<Array<ColumnToSample>> {
    return await this.inReadOnlyTransaction(
      STATEMENT_TIMEOUT_IN_MS,
      async (): Promise<Array<ColumnToSample>> => {
        return readColumns(
          await this.rows(
            `SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
            LIMIT ${MAX_COLUMNS_PER_TABLE * 2}`,
            [table.schema, table.table],
          ),
        );
      },
    );
  }

  public async sampleRows(data: {
    table: TableToSample;
    columns: Array<ColumnToSample>;
    rows: number;
    timeoutInMs: number;
  }): Promise<Array<Record<string, unknown>>> {
    const select: string = data.columns
      .map((column: ColumnToSample, index: number) => {
        return `LEFT(CAST(${quotePostgresIdentifier(column.name)} AS text), ${MAX_VALUE_LENGTH}) AS ${quotePostgresIdentifier(`c${index}`)}`;
      })
      .join(", ");
    const from: string = `${quotePostgresIdentifier(data.table.schema)}.${quotePostgresIdentifier(data.table.table)}`;
    const limit: number = Math.max(1, Math.floor(data.rows));
    const isLarge: boolean =
      data.table.estimatedRows > limit * TABLESAMPLE_FACTOR;

    return await this.inReadOnlyTransaction(
      data.timeoutInMs,
      async (): Promise<Array<Record<string, unknown>>> => {
        if (isLarge) {
          // Random pages for about four times the rows wanted.
          const percent: number = Math.min(
            100,
            Math.max(0.0001, ((limit * 4) / data.table.estimatedRows) * 100),
          );
          const sampled: Array<Record<string, unknown>> = await this.rows(
            `SELECT ${select} FROM ${from} TABLESAMPLE SYSTEM (${percent.toFixed(4)}) LIMIT ${limit}`,
          );

          // Statistics can be stale: too few rows came back, so read the start.
          if (sampled.length >= Math.ceil(limit / 2)) {
            return sampled;
          }
        }

        return await this.rows(`SELECT ${select} FROM ${from} LIMIT ${limit}`);
      },
    );
  }

  public async close(): Promise<void> {
    try {
      await this.client.end();
    } catch {
      // Already closed, or never opened.
    }
  }
}

class MySqlSession implements DatabaseSession {
  public readonly engine: DatabaseEngine = "mysql";
  private readonly connection: MySqlConnection;

  private constructor(connection: MySqlConnection) {
    this.connection = connection;
  }

  public static async open(connectionString: string): Promise<MySqlSession> {
    const options: MySqlConnectionOptions = {
      uri: connectionString.trim().replace(MARIADB_SCHEME, "mysql://"),
      connectTimeout: CONNECT_TIMEOUT_IN_MS,
      // Never more than one statement in a query.
      multipleStatements: false,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    const connection: MySqlConnection = await createMySqlConnection(options);
    const session: MySqlSession = new MySqlSession(connection);

    try {
      await session.run("SET SESSION TRANSACTION READ ONLY");
      await session.run(
        `SET SESSION lock_wait_timeout = ${Math.ceil(LOCK_TIMEOUT_IN_MS / 1000)}`,
      );

      try {
        await session.run(
          `SET SESSION MAX_EXECUTION_TIME = ${STATEMENT_TIMEOUT_IN_MS}`,
        );
      } catch {
        // MariaDB names it max_statement_time, in seconds.
        await session.run(
          `SET SESSION max_statement_time = ${Math.ceil(STATEMENT_TIMEOUT_IN_MS / 1000)}`,
        );
      }
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  private async run(
    sql: string,
    values: Array<unknown> = [],
    timeoutInMs: number = STATEMENT_TIMEOUT_IN_MS,
  ): Promise<Array<Record<string, unknown>>> {
    const result: [unknown, unknown] = (await this.connection.query(
      { sql, timeout: wholeMilliseconds(timeoutInMs) + 5_000 },
      values,
    )) as unknown as [unknown, unknown];
    const rows: unknown = result[0];

    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  private async inReadOnlyTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.run("START TRANSACTION READ ONLY");

    try {
      const result: T = await work();

      await this.run("COMMIT");
      return result;
    } catch (error) {
      try {
        await this.run("ROLLBACK");
      } catch {
        // The connection is gone: nothing to roll back.
      }

      throw error;
    }
  }

  public async listTables(limit: number): Promise<Array<TableToSample>> {
    return await this.inReadOnlyTransaction(
      async (): Promise<Array<TableToSample>> => {
        return readTables(
          await this.run(
            `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_ROWS AS estimated_rows
            FROM information_schema.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
              AND TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
              AND (DATABASE() IS NULL OR TABLE_SCHEMA = DATABASE())
            ORDER BY TABLE_SCHEMA, TABLE_NAME
            LIMIT ?`,
            [limit],
          ),
        );
      },
    );
  }

  public async listColumns(
    table: TableToSample,
  ): Promise<Array<ColumnToSample>> {
    return await this.inReadOnlyTransaction(
      async (): Promise<Array<ColumnToSample>> => {
        return readColumns(
          await this.run(
            `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
            LIMIT ${MAX_COLUMNS_PER_TABLE * 2}`,
            [table.schema, table.table],
          ),
        );
      },
    );
  }

  public async sampleRows(data: {
    table: TableToSample;
    columns: Array<ColumnToSample>;
    rows: number;
    timeoutInMs: number;
  }): Promise<Array<Record<string, unknown>>> {
    const select: string = data.columns
      .map((column: ColumnToSample, index: number) => {
        return `LEFT(CAST(${quoteMySqlIdentifier(column.name)} AS CHAR), ${MAX_VALUE_LENGTH}) AS ${quoteMySqlIdentifier(`c${index}`)}`;
      })
      .join(", ");
    const from: string = `${quoteMySqlIdentifier(data.table.schema)}.${quoteMySqlIdentifier(data.table.table)}`;
    const limit: number = Math.max(1, Math.floor(data.rows));

    return await this.inReadOnlyTransaction(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.run(
          `SELECT ${select} FROM ${from} LIMIT ${limit}`,
          [],
          data.timeoutInMs,
        );
      },
    );
  }

  public async close(): Promise<void> {
    try {
      await this.connection.end();
    } catch {
      try {
        this.connection.destroy();
      } catch {
        // Already closed.
      }
    }
  }
}

class SqlServerSession implements DatabaseSession {
  public readonly engine: DatabaseEngine = "sqlserver";
  private readonly pool: mssql.ConnectionPool;

  private constructor(pool: mssql.ConnectionPool) {
    this.pool = pool;
  }

  public static async open(
    connectionString: string,
  ): Promise<SqlServerSession> {
    const parsed: mssql.config =
      parseSqlServerConnectionString(connectionString);
    const config: mssql.config = {
      ...parsed,
      connectionTimeout: CONNECT_TIMEOUT_IN_MS,
      requestTimeout: STATEMENT_TIMEOUT_IN_MS,
      // One connection: every statement runs where the SET statements ran.
      pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
      options: {
        ...(parsed.options || {}),
        appName: APPLICATION_NAME,
        // To a readable secondary, where there is one.
        readOnlyIntent: true,
      },
    };
    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);
    const session: SqlServerSession = new SqlServerSession(pool);

    try {
      await pool.connect();
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  /*
   * Runs one of the sampler's own statements, after the SET statements that
   * bound it - in the same batch, so they hold for it whichever connection
   * runs it.
   */
  private async run(
    sql: string,
    values: Array<unknown> = [],
  ): Promise<Array<Record<string, unknown>>> {
    const request: mssql.Request = this.pool.request();

    values.forEach((value: unknown, index: number) => {
      request.input(`p${index}`, value);
    });

    /*
     * The pool's requestTimeout bounds each statement; LOCK_TIMEOUT bounds
     * how long it waits for a writer's lock.
     */
    const result: mssql.IResult<Record<string, unknown>> = await request.query(
      `SET LOCK_TIMEOUT ${LOCK_TIMEOUT_IN_MS}; SET DEADLOCK_PRIORITY LOW; SET TEXTSIZE ${MAX_VALUE_LENGTH * 2}; ${sql}`,
    );

    return result.recordset ? Array.from(result.recordset) : [];
  }

  public async listTables(limit: number): Promise<Array<TableToSample>> {
    return readTables(
      await this.run(
        `SELECT TOP (@p0) t.TABLE_SCHEMA AS table_schema, t.TABLE_NAME AS table_name,
          (SELECT SUM(p.rows) FROM sys.partitions p
            WHERE p.object_id = OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + N'.' + QUOTENAME(t.TABLE_NAME))
              AND p.index_id IN (0, 1)) AS estimated_rows
        FROM INFORMATION_SCHEMA.TABLES t
        WHERE t.TABLE_TYPE = 'BASE TABLE'
          AND t.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
          AND COALESCE(OBJECTPROPERTY(OBJECT_ID(QUOTENAME(t.TABLE_SCHEMA) + N'.' + QUOTENAME(t.TABLE_NAME)), 'IsMSShipped'), 0) = 0
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME`,
        [limit],
      ),
    );
  }

  public async listColumns(
    table: TableToSample,
  ): Promise<Array<ColumnToSample>> {
    return readColumns(
      await this.run(
        `SELECT TOP (${MAX_COLUMNS_PER_TABLE * 2}) COLUMN_NAME AS column_name, DATA_TYPE AS data_type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = @p0 AND TABLE_NAME = @p1
        ORDER BY ORDINAL_POSITION`,
        [table.schema, table.table],
      ),
    );
  }

  public async sampleRows(data: {
    table: TableToSample;
    columns: Array<ColumnToSample>;
    rows: number;
    timeoutInMs: number;
  }): Promise<Array<Record<string, unknown>>> {
    const select: string = data.columns
      .map((column: ColumnToSample, index: number) => {
        const style: string = SQL_SERVER_DATE_TYPES.has(column.dataType)
          ? ", 126"
          : "";

        return `LEFT(CONVERT(NVARCHAR(MAX), ${quoteSqlServerIdentifier(column.name)}${style}), ${MAX_VALUE_LENGTH}) AS ${quoteSqlServerIdentifier(`c${index}`)}`;
      })
      .join(", ");
    const from: string = `${quoteSqlServerIdentifier(data.table.schema)}.${quoteSqlServerIdentifier(data.table.table)}`;
    const limit: number = Math.max(1, Math.floor(data.rows));

    return await this.run(`SELECT TOP (${limit}) ${select} FROM ${from}`);
  }

  public async close(): Promise<void> {
    try {
      await this.pool.close();
    } catch {
      // Already closed, or never opened.
    }
  }
}

async function openSession(
  connection: DatabaseConnection,
): Promise<DatabaseSession> {
  switch (connection.engine) {
    case "postgresql":
      return await PostgresSession.open(connection.connectionString);
    case "mysql":
      return await MySqlSession.open(connection.connectionString);
    case "sqlserver":
      return await SqlServerSession.open(connection.connectionString);
    default:
      throw new Error(
        `Data Security cannot sample ${String(connection.engine)} databases.`,
      );
  }
}

/*
 * EXCLUSIONS: "schema", "schema.table", "table", "schema.table.column" or
 * "table.column", compared without regard to case.
 */
function readExclusions(exclusions: Array<string>): Set<string> {
  return new Set(
    exclusions
      .map((exclusion: string) => {
        return exclusion.trim().toLowerCase();
      })
      .filter((exclusion: string) => {
        return exclusion.length > 0;
      }),
  );
}

function isTableExcluded(table: TableToSample, excluded: Set<string>): boolean {
  const schema: string = table.schema.toLowerCase();
  const name: string = table.table.toLowerCase();

  return (
    excluded.has(schema) ||
    excluded.has(name) ||
    excluded.has(`${schema}.${name}`)
  );
}

function isColumnExcluded(
  table: TableToSample,
  column: ColumnToSample,
  excluded: Set<string>,
): boolean {
  const name: string = column.name.toLowerCase();
  const tableName: string = table.table.toLowerCase();

  return (
    excluded.has(`${table.schema.toLowerCase()}.${tableName}.${name}`) ||
    excluded.has(`${tableName}.${name}`)
  );
}

function toText(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      .toString("utf8")
      .slice(0, MAX_VALUE_LENGTH);
  }

  return value;
}

/*
 * The tables to read, of those listed: not excluded, the ones with rows
 * before the empty ones, at most maxTables.
 */
function chooseTables(data: {
  listed: Array<TableToSample>;
  excluded: Set<string>;
  maxTables: number;
}): { chosen: Array<TableToSample>; eligible: number } {
  const eligible: Array<TableToSample> = data.listed.filter(
    (table: TableToSample) => {
      return !isTableExcluded(table, data.excluded);
    },
  );
  const ordered: Array<TableToSample> = [...eligible].sort(
    (a: TableToSample, b: TableToSample) => {
      return Number(a.estimatedRows === 0) - Number(b.estimatedRows === 0);
    },
  );

  return {
    chosen: ordered.slice(0, Math.max(0, data.maxTables)),
    eligible: eligible.length,
  };
}

export async function sampleDatabase(
  connection: DatabaseConnection,
  options: ContentScanOptions,
): Promise<ContentScanResult> {
  const secrets: Array<string> = getConnectionSecrets(
    connection.connectionString,
  );
  const result: ContentScanResult = emptyContentScanResult();
  const warnings: Array<string> = [];
  const limits: ContentScanOptions["limits"] = options.limits;
  const deadline: number = limits.deadline.getTime();
  const fingerprints: FingerprintAccumulator = new FingerprintAccumulator(
    options.fingerprintKey,
  );
  const locations: Array<LocationFindings> = [];
  const plaintextPasswordFields: Array<string> = [];
  const excluded: Set<string> = readExclusions(options.exclusions);
  let isComplete: boolean = true;
  let estimatedRecords: number = 0;

  const warn: (message: string) => void = (message: string): void => {
    if (warnings.length < MAX_WARNINGS && !warnings.includes(message)) {
      warnings.push(message);
    }
  };

  // No time left: not even a connection is made.
  if (Date.now() >= deadline) {
    result.warnings = [
      "The scan reached its time limit before it could connect.",
    ];
    result.isComplete = false;
    return result;
  }

  let session: DatabaseSession;

  try {
    session = await openSession(connection);
  } catch (error) {
    throw new Error(
      `Could not connect to the database: ${sanitizeErrorMessage(error, secrets)}`,
    );
  }

  try {
    let listed: Array<TableToSample>;

    try {
      listed = await session.listTables(
        Math.min(
          MAX_LISTED_TABLES,
          Math.max(1, limits.maxTables) * TABLE_LISTING_FACTOR,
        ),
      );
    } catch (error) {
      warn(
        `Could not list the tables: ${sanitizeErrorMessage(error, secrets)}`,
      );
      result.warnings = warnings;
      result.isComplete = false;
      return result;
    }

    const choice: { chosen: Array<TableToSample>; eligible: number } =
      chooseTables({ listed, excluded, maxTables: limits.maxTables });
    const chosen: Array<TableToSample> = choice.chosen;
    const eligible: number = choice.eligible;

    if (eligible > chosen.length) {
      isComplete = false;
      warn(
        `${eligible - chosen.length} tables were not sampled: the scan reads at most ${limits.maxTables} tables.`,
      );
    }

    let consecutiveFailures: number = 0;

    for (const table of chosen) {
      const name: string = `${table.schema}.${table.table}`;
      const timeLeft: number = deadline - Date.now();

      if (timeLeft <= 0) {
        isComplete = false;
        warn(
          `The scan reached its time limit after ${result.objectsRead} of ${chosen.length} tables.`,
        );
        break;
      }

      if (result.bytesRead >= limits.maxBytesTotal) {
        isComplete = false;
        warn(
          `The scan read its ${limits.maxBytesTotal} bytes after ${result.objectsRead} of ${chosen.length} tables.`,
        );
        break;
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        isComplete = false;
        warn(
          `The scan stopped after ${MAX_CONSECUTIVE_FAILURES} tables in a row could not be read.`,
        );
        break;
      }

      try {
        const columns: Array<ColumnToSample> = (
          await session.listColumns(table)
        )
          .filter((column: ColumnToSample) => {
            return (
              !SKIPPED_TYPES.has(column.dataType) &&
              !isColumnExcluded(table, column, excluded)
            );
          })
          .slice(0, MAX_COLUMNS_PER_TABLE);

        if (columns.length === 0) {
          consecutiveFailures = 0;
          continue;
        }

        const rowsWanted: number = Math.max(
          1,
          Math.min(
            limits.maxRowsPerTable,
            Math.floor(MAX_CELLS_PER_TABLE / columns.length),
          ),
        );
        const rows: Array<Record<string, unknown>> = await session.sampleRows({
          table,
          columns,
          rows: rowsWanted,
          timeoutInMs: Math.min(STATEMENT_TIMEOUT_IN_MS, timeLeft),
        });

        consecutiveFailures = 0;
        result.objectsRead++;
        result.rowsRead += rows.length;

        if (result.readLog.length < MAX_READ_LOG_ENTRIES) {
          result.readLog.push(name);
        }

        const fields: Array<CollectedField> = columns.map(
          (column: ColumnToSample, index: number) => {
            const values: Array<unknown> = [];

            for (const row of rows) {
              const value: unknown = toText(row[`c${index}`]);

              if (typeof value === "string") {
                result.bytesRead += value.length;
              }

              values.push(value);
            }

            return { path: `${name}.${column.name}`, values };
          },
        );

        if (rows.length === 0) {
          continue;
        }

        const classified: FieldsClassification = classifyCollectedFields({
          fields,
          options,
          fingerprints,
          locationKind: DataStoreLocationKind.Column,
        });

        locations.push(...classified.locations);

        for (const field of classified.plaintextPasswordFields) {
          if (plaintextPasswordFields.length < MAX_PLAINTEXT_PASSWORD_FIELDS) {
            plaintextPasswordFields.push(field);
          }
        }

        // Rows holding sensitive data, scaled from the sample to the table.
        const tableRows: number =
          table.estimatedRows > rows.length ? table.estimatedRows : rows.length;

        estimatedRecords += classified.sensitiveShare * tableRows;
      } catch (error) {
        consecutiveFailures++;
        isComplete = false;
        warn(
          `Could not sample ${name}: ${sanitizeErrorMessage(error, secrets)}`,
        );
      }
    }
  } finally {
    await session.close();
  }

  result.locations = locations;
  result.fingerprints = fingerprints.getFingerprints();
  result.plaintextPasswordFields = plaintextPasswordFields;
  result.warnings = warnings;
  result.isComplete = isComplete;
  result.estimatedRecords =
    result.objectsRead > 0 ? Math.round(estimatedRecords) : undefined;

  return result;
}
