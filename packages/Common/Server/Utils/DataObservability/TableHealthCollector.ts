import { Client } from "pg";
import {
  Connection as MySqlConnection,
  ConnectionOptions as MySqlConnectionOptions,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import * as mssql from "mssql";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetColumn,
  MAX_COLUMN_NAME_LENGTH,
  MAX_COLUMN_TYPE_LENGTH,
  MAX_COLUMNS_PER_DATA_ASSET,
} from "../../../Types/DataObservability/DataAssetColumn";
import {
  CONNECT_TIMEOUT_IN_MS,
  DatabaseConnection,
  DatabaseEngine,
  getConnectionSecrets,
  LOCK_TIMEOUT_IN_MS,
  parseSqlServerConnectionString,
  sanitizeErrorMessage,
  STATEMENT_TIMEOUT_IN_MS,
} from "../DataSecurity/Content/DatabaseSampler";
import { readConnectionTarget, TableHealthTarget } from "./TableHealthTarget";
import {
  DataCheckRunResult,
  MAX_CHECK_ERROR_LENGTH,
  PlannedDataCheck,
  readCheckRows,
} from "./DataCheckResults";

/*
 * EVERY TABLE OF A DATABASE, FROM ITS CATALOG, WITHOUT READING A ROW.
 *
 * Automatic table health needs, for each table and view: its columns, its
 * row count and size, and a sign of when it last changed. Every engine
 * keeps those in its own catalog and statistics, so the collector reads
 * nothing else - no table is scanned, no row is read, and a collection of
 * thousands of tables is a handful of statements:
 *
 *  - PostgreSQL: pg_class and pg_stat_user_tables give each relation's kind,
 *    live rows, total size and its insert, update and delete counters; the
 *    counters say a table changed when they move between collections.
 *    pg_attribute gives the columns. Partitions are folded into their
 *    partitioned table.
 *  - MySQL and MariaDB: information_schema.TABLES gives rows, size and
 *    UPDATE_TIME (MySQL 8 caches those for a day unless the session says
 *    otherwise, so it does); performance_schema's table I/O counters, where
 *    the login may read them, back UPDATE_TIME up.
 *    information_schema.COLUMNS gives the columns.
 *  - SQL Server: sys.objects and sys.partitions give tables, views and rows;
 *    sys.dm_db_partition_stats and sys.dm_db_index_usage_stats give size,
 *    last update and an update counter where the login has VIEW DATABASE
 *    STATE. INFORMATION_SCHEMA.COLUMNS gives the columns.
 *
 * Times are taken as "seconds ago" by the database's own clock, so neither
 * its time zone nor its clock's drift from OneUptime's matters.
 *
 * It is as careful as Data Security's sampler, whose connection handling it
 * shares: every statement is its own, in a read-only transaction where the
 * engine has one, bounded by a statement and a lock timeout; the connection
 * string is never logged and is taken out of every error. A statistic the
 * login may not read is left out with a warning; only a database that
 * cannot be reached, or a catalog that cannot be listed, fails the
 * collection.
 */

export const MAX_TABLES_PER_COLLECTION: number = 5_000;
/*
 * Longer schema and table names than any engine allows (PostgreSQL 63
 * bytes, MySQL 64 characters, SQL Server 128) are cut, so "schema.table"
 * always fits the asset's key.
 */
export const MAX_IDENTIFIER_LENGTH: number = 240;
export const MAX_COLUMNS_PER_COLLECTION: number = 200_000;
// Most warnings one collection keeps.
export const MAX_COLLECTION_WARNINGS: number = 20;

const APPLICATION_NAME: string = "OneUptime Data Observability";
const MARIADB_SCHEME: RegExp = /^mariadb:\/\//i;

export interface CollectedTable {
  schema: string;
  name: string;
  kind: DataAssetKind;
  // From the engine's statistics; null when it keeps none for this kind.
  estimatedRows: number | null;
  sizeInBytes: number | null;
  /*
   * A counter that grows with every insert, update and delete since the
   * engine's statistics were last reset; null when the login cannot read one.
   */
  writeCount: number | null;
  // How long ago the engine says the table last changed; null when it does not say.
  secondsSinceChange: number | null;
  // Null when the collection could not read all of them (the column list was cut).
  columns: Array<DataAssetColumn> | null;
}

export interface TableHealthSnapshot {
  engine: DatabaseEngine;
  collectedAt: string;
  tables: Array<CollectedTable>;
  // False when the table list was cut at its limit, so absence proves nothing.
  isComplete: boolean;
  warnings: Array<string>;
  // The database read: its name, host and port, from the connection string. Never a credential.
  target?: TableHealthTarget | null | undefined;
  // What each due data check read, or why it could not run.
  checkResults?: Array<DataCheckRunResult> | undefined;
}

export interface TableHealthCollectOptions {
  maxTables: number;
  maxColumns: number;
  // "schema", "schema.table" or "table": the store's scan exclusions.
  exclusions: Array<string>;
  // The store's data checks that are due, run after the catalog in the same session.
  checks?: Array<PlannedDataCheck> | undefined;
}

export const DEFAULT_COLLECT_OPTIONS: TableHealthCollectOptions = {
  maxTables: MAX_TABLES_PER_COLLECTION,
  maxColumns: MAX_COLUMNS_PER_COLLECTION,
  exclusions: [],
};

interface RawTable {
  schema: string;
  name: string;
  kind: DataAssetKind;
  estimatedRows: number | null;
  sizeInBytes: number | null;
  writeCount: number | null;
  secondsSinceChange: number | null;
}

interface RawColumn {
  schema: string;
  table: string;
  column: DataAssetColumn;
}

interface CatalogRead {
  tables: Array<RawTable>;
  columns: Array<RawColumn>;
  warnings: Array<string>;
}

interface CatalogSession {
  readonly engine: DatabaseEngine;
  read(options: TableHealthCollectOptions): Promise<CatalogRead>;
  // One data check's aggregate, read-only and bounded like every catalog read.
  readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

// A whole, non-negative number, or null for anything else.
export function readCount(value: unknown): number | null {
  const number: number =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && value.trim().length > 0
          ? Number(value)
          : NaN;

  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  return Math.floor(number);
}

function readText(value: unknown, maxLength: number): string {
  return String(value ?? "").slice(0, maxLength);
}

function readNullable(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return String(value ?? "")
    .trim()
    .toUpperCase()
    .startsWith("Y");
}

function readColumnRow(row: Record<string, unknown>): RawColumn | null {
  const schema: string = readText(row["table_schema"], MAX_IDENTIFIER_LENGTH);
  const table: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);
  const name: string = readText(row["column_name"], MAX_COLUMN_NAME_LENGTH);

  if (!table || !name) {
    return null;
  }

  const position: number | null = readCount(row["ordinal_position"]);

  return {
    schema,
    table,
    column: {
      name,
      dataType: readText(row["data_type"], MAX_COLUMN_TYPE_LENGTH)
        .trim()
        .toLowerCase(),
      isNullable: readNullable(row["is_nullable"]),
      position: position && position > 0 ? position : 1,
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wholeMilliseconds(value: number): number {
  return Math.max(1000, Math.floor(value));
}

function keyOf(schema: string, table: string): string {
  return `${schema}\u0000${table}`;
}

// The engine's kind code for a relation, as a data asset kind.
export function readPostgresKind(relkind: unknown): DataAssetKind | null {
  switch (String(relkind ?? "")) {
    case "r":
      return DataAssetKind.Table;
    case "p":
      return DataAssetKind.PartitionedTable;
    case "v":
      return DataAssetKind.View;
    case "m":
      return DataAssetKind.MaterializedView;
    case "f":
      return DataAssetKind.ForeignTable;
    default:
      return null;
  }
}

class PostgresCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "postgresql";
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  public static async open(connectionString: string): Promise<PostgresCatalog> {
    const client: Client = new Client({
      connectionString,
      connectionTimeoutMillis: CONNECT_TIMEOUT_IN_MS,
      query_timeout: STATEMENT_TIMEOUT_IN_MS + 5_000,
      application_name: APPLICATION_NAME,
    });
    const session: PostgresCatalog = new PostgresCatalog(client);

    try {
      await client.connect();
      await client.query(
        "SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY",
      );
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  private async inReadOnlyTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query("BEGIN");

    try {
      await this.client.query("SET TRANSACTION READ ONLY");
      await this.client.query(
        `SET LOCAL statement_timeout = ${wholeMilliseconds(STATEMENT_TIMEOUT_IN_MS)}`,
      );
      await this.client.query(
        `SET LOCAL lock_timeout = ${wholeMilliseconds(LOCK_TIMEOUT_IN_MS)}`,
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
    values: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.inReadOnlyTransaction(
      async (): Promise<Array<Record<string, unknown>>> => {
        const result: { rows: Array<Record<string, unknown>> } =
          await this.client.query(sql, values);

        return result.rows || [];
      },
    );
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.rows(sql, params);
  }

  private static readonly RELATION_FILTER: string = `c.relkind IN ('r', 'v', 'm', 'p', 'f')
      AND NOT c.relispartition
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_toast%'
      AND n.nspname NOT LIKE 'pg\\_temp\\_%'`;

  private tablesSql(withSizes: boolean): string {
    const size: string = withSizes
      ? `CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(pg_catalog.pg_total_relation_size(i.inhrelid))
            FROM pg_catalog.pg_inherits i WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') THEN pg_catalog.pg_total_relation_size(c.oid)
          ELSE NULL
        END::bigint`
      : "NULL::bigint";

    return `SELECT n.nspname AS table_schema, c.relname AS table_name, c.relkind AS relkind,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(GREATEST(COALESCE(cs.n_live_tup, child.reltuples), 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_class child ON child.oid = i.inhrelid
            LEFT JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = child.oid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') THEN GREATEST(COALESCE(s.n_live_tup, c.reltuples), 0)
          ELSE NULL
        END::bigint AS estimated_rows,
        ${size} AS size_bytes,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(COALESCE(cs.n_tup_ins, 0) + COALESCE(cs.n_tup_upd, 0) + COALESCE(cs.n_tup_del, 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = i.inhrelid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') AND s.relid IS NOT NULL
            THEN COALESCE(s.n_tup_ins, 0) + COALESCE(s.n_tup_upd, 0) + COALESCE(s.n_tup_del, 0)
          ELSE NULL
        END::bigint AS write_count
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
      WHERE ${PostgresCatalog.RELATION_FILTER}
      ORDER BY n.nspname, c.relname
      LIMIT $1`;
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    let tableRows: Array<Record<string, unknown>>;

    try {
      tableRows = await this.rows(this.tablesSql(true), [options.maxTables]);
    } catch (error) {
      // Sizing every relation is the costly part; without it the rest still says plenty.
      warnings.push(
        `Table sizes were left out: ${describeError(error).slice(0, 200)}`,
      );
      tableRows = await this.rows(this.tablesSql(false), [options.maxTables]);
    }

    const tables: Array<RawTable> = [];

    for (const row of tableRows) {
      const kind: DataAssetKind | null = readPostgresKind(row["relkind"]);
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name) {
        continue;
      }

      tables.push({
        schema: readText(row["table_schema"], MAX_IDENTIFIER_LENGTH),
        name,
        kind,
        estimatedRows: readCount(row["estimated_rows"]),
        sizeInBytes: readCount(row["size_bytes"]),
        writeCount: readCount(row["write_count"]),
        secondsSinceChange: null,
      });
    }

    const columnRows: Array<Record<string, unknown>> = await this.rows(
      `SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          NOT a.attnotnull AS is_nullable, a.attnum AS ordinal_position
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE a.attnum > 0 AND NOT a.attisdropped
          AND ${PostgresCatalog.RELATION_FILTER}
        ORDER BY n.nspname, c.relname, a.attnum
        LIMIT $1`,
      [options.maxColumns],
    );

    return {
      tables,
      columns: columnRows
        .map(readColumnRow)
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        }),
      warnings,
    };
  }

  public async close(): Promise<void> {
    try {
      await this.client.end();
    } catch {
      // Already closed, or never opened.
    }
  }
}

export function readMySqlKind(tableType: unknown): DataAssetKind | null {
  switch (String(tableType ?? "").toUpperCase()) {
    case "BASE TABLE":
      return DataAssetKind.Table;
    case "VIEW":
      return DataAssetKind.View;
    default:
      // SYSTEM VIEW, SEQUENCE: not data.
      return null;
  }
}

class MySqlCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "mysql";
  private readonly connection: MySqlConnection;

  private constructor(connection: MySqlConnection) {
    this.connection = connection;
  }

  public static async open(connectionString: string): Promise<MySqlCatalog> {
    const options: MySqlConnectionOptions = {
      uri: connectionString.trim().replace(MARIADB_SCHEME, "mysql://"),
      connectTimeout: CONNECT_TIMEOUT_IN_MS,
      multipleStatements: false,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
    const connection: MySqlConnection = await createMySqlConnection(options);
    const session: MySqlCatalog = new MySqlCatalog(connection);

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

      try {
        // MySQL 8 serves cached row counts and UPDATE_TIME for up to a day otherwise.
        await session.run("SET SESSION information_schema_stats_expiry = 0");
      } catch {
        // MySQL 5.7 and MariaDB read them live already.
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
  ): Promise<Array<Record<string, unknown>>> {
    const result: [unknown, unknown] = (await this.connection.query(
      { sql, timeout: wholeMilliseconds(STATEMENT_TIMEOUT_IN_MS) + 5_000 },
      values,
    )) as unknown as [unknown, unknown];
    const rows: unknown = result[0];

    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  private async inReadOnlyTransaction(
    sql: string,
    values: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    await this.run("START TRANSACTION READ ONLY");

    try {
      const rows: Array<Record<string, unknown>> = await this.run(sql, values);

      await this.run("COMMIT");
      return rows;
    } catch (error) {
      try {
        await this.run("ROLLBACK");
      } catch {
        // The connection is gone: nothing to roll back.
      }

      throw error;
    }
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.inReadOnlyTransaction(sql, params);
  }

  private static readonly SCHEMA_FILTER: string = `NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')`;

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];

    const tableRows: Array<Record<string, unknown>> =
      await this.inReadOnlyTransaction(
        `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_TYPE AS table_type,
          TABLE_ROWS AS estimated_rows,
          CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) ELSE NULL END AS size_bytes,
          CASE WHEN UPDATE_TIME IS NULL THEN NULL ELSE TIMESTAMPDIFF(SECOND, UPDATE_TIME, NOW()) END AS seconds_since_change
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA ${MySqlCatalog.SCHEMA_FILTER}
          AND (DATABASE() IS NULL OR TABLE_SCHEMA = DATABASE())
        ORDER BY TABLE_SCHEMA, TABLE_NAME
        LIMIT ?`,
        [options.maxTables],
      );

    const writeCounts: Map<string, number> = new Map();

    try {
      const counterRows: Array<Record<string, unknown>> =
        await this.inReadOnlyTransaction(
          `SELECT OBJECT_SCHEMA AS table_schema, OBJECT_NAME AS table_name,
            COUNT_INSERT + COUNT_UPDATE + COUNT_DELETE AS write_count
          FROM performance_schema.table_io_waits_summary_by_table
          WHERE OBJECT_TYPE = 'TABLE'
            AND OBJECT_SCHEMA ${MySqlCatalog.SCHEMA_FILTER}
            AND (DATABASE() IS NULL OR OBJECT_SCHEMA = DATABASE())`,
          [],
        );

      for (const row of counterRows) {
        const count: number | null = readCount(row["write_count"]);

        if (count !== null) {
          writeCounts.set(
            keyOf(
              String(row["table_schema"] ?? ""),
              String(row["table_name"] ?? ""),
            ),
            count,
          );
        }
      }
    } catch (error) {
      warnings.push(
        `Write counters were left out (performance_schema could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    const tables: Array<RawTable> = [];

    for (const row of tableRows) {
      const kind: DataAssetKind | null = readMySqlKind(row["table_type"]);
      const schema: string = readText(
        row["table_schema"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name) {
        continue;
      }

      const isTable: boolean = kind === DataAssetKind.Table;

      tables.push({
        schema,
        name,
        kind,
        estimatedRows: isTable ? readCount(row["estimated_rows"]) : null,
        sizeInBytes: isTable ? readCount(row["size_bytes"]) : null,
        writeCount: writeCounts.get(keyOf(schema, name)) ?? null,
        secondsSinceChange: isTable
          ? readCount(row["seconds_since_change"])
          : null,
      });
    }

    const columnRows: Array<Record<string, unknown>> =
      await this.inReadOnlyTransaction(
        `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
          COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable, ORDINAL_POSITION AS ordinal_position
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA ${MySqlCatalog.SCHEMA_FILTER}
          AND (DATABASE() IS NULL OR TABLE_SCHEMA = DATABASE())
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        LIMIT ?`,
        [options.maxColumns],
      );

    return {
      tables,
      columns: columnRows
        .map(readColumnRow)
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        }),
      warnings,
    };
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

export function readSqlServerKind(objectType: unknown): DataAssetKind | null {
  switch (
    String(objectType ?? "")
      .trim()
      .toUpperCase()
  ) {
    case "U":
      return DataAssetKind.Table;
    case "V":
      return DataAssetKind.View;
    default:
      return null;
  }
}

class SqlServerCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "sqlserver";
  private readonly pool: mssql.ConnectionPool;

  private constructor(pool: mssql.ConnectionPool) {
    this.pool = pool;
  }

  public static async open(
    connectionString: string,
  ): Promise<SqlServerCatalog> {
    const parsed: mssql.config =
      parseSqlServerConnectionString(connectionString);
    const config: mssql.config = {
      ...parsed,
      connectionTimeout: CONNECT_TIMEOUT_IN_MS,
      requestTimeout: STATEMENT_TIMEOUT_IN_MS,
      pool: { max: 1, min: 0, idleTimeoutMillis: 1_000 },
      options: {
        ...(parsed.options || {}),
        appName: APPLICATION_NAME,
        readOnlyIntent: true,
      },
    };
    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(config);
    const session: SqlServerCatalog = new SqlServerCatalog(pool);

    try {
      await pool.connect();
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  private async run(
    sql: string,
    values: Array<unknown> = [],
  ): Promise<Array<Record<string, unknown>>> {
    const request: mssql.Request = this.pool.request();

    values.forEach((value: unknown, index: number) => {
      request.input(`p${index}`, value);
    });

    const result: mssql.IResult<Record<string, unknown>> = await request.query(
      `SET LOCK_TIMEOUT ${LOCK_TIMEOUT_IN_MS}; SET DEADLOCK_PRIORITY LOW; ${sql}`,
    );

    return result.recordset ? Array.from(result.recordset) : [];
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.run(sql, params);
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];

    const tableRows: Array<Record<string, unknown>> = await this.run(
      `SELECT TOP (@p0) s.name AS table_schema, o.name AS table_name, o.type AS object_type,
        (SELECT SUM(p.rows) FROM sys.partitions p
          WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS estimated_rows
      FROM sys.objects o
      JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
      ORDER BY s.name, o.name`,
      [options.maxTables],
    );

    const statistics: Map<
      string,
      {
        sizeInBytes: number | null;
        secondsSinceChange: number | null;
        writeCount: number | null;
      }
    > = new Map();

    try {
      const statisticRows: Array<Record<string, unknown>> = await this.run(
        `SELECT TOP (@p0) s.name AS table_schema, o.name AS table_name,
          (SELECT SUM(ps.reserved_page_count) FROM sys.dm_db_partition_stats ps
            WHERE ps.object_id = o.object_id) * CAST(8192 AS bigint) AS size_bytes,
          (SELECT DATEDIFF(SECOND, MAX(u.last_user_update), GETDATE()) FROM sys.dm_db_index_usage_stats u
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS seconds_since_change,
          (SELECT SUM(u.user_updates) FROM sys.dm_db_index_usage_stats u
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS write_count
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type = 'U' AND o.is_ms_shipped = 0
        ORDER BY s.name, o.name`,
        [options.maxTables],
      );

      for (const row of statisticRows) {
        statistics.set(
          keyOf(
            String(row["table_schema"] ?? ""),
            String(row["table_name"] ?? ""),
          ),
          {
            sizeInBytes: readCount(row["size_bytes"]),
            secondsSinceChange: readCount(row["seconds_since_change"]),
            writeCount: readCount(row["write_count"]),
          },
        );
      }
    } catch (error) {
      warnings.push(
        `Sizes and last updates were left out (the login needs VIEW DATABASE STATE): ${describeError(error).slice(0, 200)}`,
      );
    }

    const tables: Array<RawTable> = [];

    for (const row of tableRows) {
      const kind: DataAssetKind | null = readSqlServerKind(row["object_type"]);
      const schema: string = readText(
        row["table_schema"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name) {
        continue;
      }

      const isTable: boolean = kind === DataAssetKind.Table;
      const statistic:
        | {
            sizeInBytes: number | null;
            secondsSinceChange: number | null;
            writeCount: number | null;
          }
        | undefined = statistics.get(keyOf(schema, name));

      tables.push({
        schema,
        name,
        kind,
        estimatedRows: isTable ? readCount(row["estimated_rows"]) : null,
        sizeInBytes: statistic?.sizeInBytes ?? null,
        writeCount: statistic?.writeCount ?? null,
        secondsSinceChange: statistic?.secondsSinceChange ?? null,
      });
    }

    const columnRows: Array<Record<string, unknown>> = await this.run(
      `SELECT TOP (@p0) TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
        DATA_TYPE + CASE
          WHEN CHARACTER_MAXIMUM_LENGTH IS NULL THEN ''
          WHEN CHARACTER_MAXIMUM_LENGTH = -1 THEN '(max)'
          ELSE '(' + CAST(CHARACTER_MAXIMUM_LENGTH AS varchar(12)) + ')'
        END AS data_type,
        IS_NULLABLE AS is_nullable, ORDINAL_POSITION AS ordinal_position
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
      [options.maxColumns],
    );

    return {
      tables,
      columns: columnRows
        .map(readColumnRow)
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        }),
      warnings,
    };
  }

  public async close(): Promise<void> {
    try {
      await this.pool.close();
    } catch {
      // Already closed, or never opened.
    }
  }
}

async function openCatalog(
  connection: DatabaseConnection,
): Promise<CatalogSession> {
  switch (connection.engine) {
    case "postgresql":
      return await PostgresCatalog.open(connection.connectionString);
    case "mysql":
      return await MySqlCatalog.open(connection.connectionString);
    case "sqlserver":
      return await SqlServerCatalog.open(connection.connectionString);
    default:
      throw new Error(
        `Data Observability cannot collect ${String(connection.engine)} databases yet.`,
      );
  }
}

function isExcluded(
  schema: string,
  table: string,
  excluded: Set<string>,
): boolean {
  const lowerSchema: string = schema.toLowerCase();
  const lowerTable: string = table.toLowerCase();

  return (
    excluded.has(lowerSchema) ||
    excluded.has(lowerTable) ||
    excluded.has(`${lowerSchema}.${lowerTable}`)
  );
}

/*
 * Puts a catalog read together: each table with its columns, the store's
 * exclusions left out. When the column list was cut at its limit, the last
 * table it reached may have only some of its columns and the ones after it
 * none, so their columns are unknown (null), never an empty list a
 * comparison would read as every column dropped.
 */
export function assembleSnapshot(data: {
  engine: DatabaseEngine;
  read: CatalogRead;
  options: TableHealthCollectOptions;
  collectedAt: Date;
}): TableHealthSnapshot {
  const excluded: Set<string> = new Set(
    data.options.exclusions
      .map((exclusion: string) => {
        return exclusion.trim().toLowerCase();
      })
      .filter((exclusion: string) => {
        return exclusion.length > 0;
      }),
  );
  const columnsCut: boolean =
    data.read.columns.length >= data.options.maxColumns;
  const columnsByTable: Map<string, Array<DataAssetColumn>> = new Map();
  let lastKey: string | null = null;

  for (const raw of data.read.columns) {
    const key: string = keyOf(raw.schema, raw.table);
    const list: Array<DataAssetColumn> = columnsByTable.get(key) || [];

    if (list.length < MAX_COLUMNS_PER_DATA_ASSET) {
      list.push(raw.column);
    }

    columnsByTable.set(key, list);
    lastKey = key;
  }

  if (columnsCut && lastKey) {
    columnsByTable.delete(lastKey);
  }

  const tables: Array<CollectedTable> = [];

  for (const raw of data.read.tables) {
    if (isExcluded(raw.schema, raw.name, excluded)) {
      continue;
    }

    const columns: Array<DataAssetColumn> | undefined = columnsByTable.get(
      keyOf(raw.schema, raw.name),
    );

    tables.push({
      ...raw,
      columns: columns
        ? columns.sort((a: DataAssetColumn, b: DataAssetColumn) => {
            return a.position - b.position;
          })
        : columnsCut
          ? null
          : [],
    });
  }

  const warnings: Array<string> = [...data.read.warnings];

  if (data.read.tables.length >= data.options.maxTables) {
    warnings.push(
      `Only the first ${data.options.maxTables} tables were collected; add exclusions to watch the rest.`,
    );
  }

  if (columnsCut) {
    warnings.push(
      `Only the first ${data.options.maxColumns} columns were read; schema changes of the tables after them are not compared.`,
    );
  }

  return {
    engine: data.engine,
    collectedAt: data.collectedAt.toISOString(),
    tables,
    isComplete: data.read.tables.length < data.options.maxTables,
    warnings: warnings.slice(0, MAX_COLLECTION_WARNINGS),
  };
}

export async function collectTableHealth(
  connection: DatabaseConnection,
  options: TableHealthCollectOptions = DEFAULT_COLLECT_OPTIONS,
): Promise<TableHealthSnapshot> {
  const secrets: Array<string> = getConnectionSecrets(
    connection.connectionString,
  );
  let catalog: CatalogSession | null = null;

  try {
    catalog = await openCatalog(connection);

    const collectedAt: Date = new Date();
    const read: CatalogRead = await catalog.read(options);
    const checkResults: Array<DataCheckRunResult> = [];

    // Each check on its own: one that cannot run never stops the others.
    for (const check of options.checks || []) {
      try {
        checkResults.push({
          checkId: check.checkId,
          values: readCheckRows({
            type: check.type,
            isSegmented: check.isSegmented,
            rows: await catalog.readAggregate(check.sql, check.params),
          }),
          error: null,
        });
      } catch (error) {
        checkResults.push({
          checkId: check.checkId,
          values: [],
          error: sanitizeErrorMessage(error, secrets).slice(
            0,
            MAX_CHECK_ERROR_LENGTH,
          ),
        });
      }
    }

    return {
      ...assembleSnapshot({
        engine: connection.engine,
        read: {
          ...read,
          warnings: read.warnings.map((warning: string) => {
            return sanitizeErrorMessage(new Error(warning), secrets);
          }),
        },
        options,
        collectedAt,
      }),
      target: readConnectionTarget(connection),
      ...(options.checks && options.checks.length > 0 ? { checkResults } : {}),
    };
  } catch (error) {
    throw new Error(sanitizeErrorMessage(error, secrets));
  } finally {
    if (catalog) {
      await catalog.close();
    }
  }
}
