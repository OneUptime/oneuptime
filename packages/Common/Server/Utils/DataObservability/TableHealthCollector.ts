import { Client } from "pg";
import {
  Connection as MySqlConnection,
  ConnectionOptions as MySqlConnectionOptions,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import * as mssql from "mssql";
import oracledb from "oracledb";
import { Collection, Db, MongoClient } from "mongodb";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import DataAssetLineageSource from "../../../Types/DataObservability/DataAssetLineageSource";
import { DataColumnMapping } from "../../../Types/DataObservability/DataColumnLineage";
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
import SnowflakeSqlApi, {
  readSnowflakeConnection,
  SnowflakeConnection,
} from "./SnowflakeSqlApi";
import BigQueryApi, {
  BigQueryConnection,
  readBigQueryConnection,
} from "./BigQueryApi";
import ClickHouseHttpApi, {
  ClickHouseConnection,
  readClickHouseConnection,
} from "./ClickHouseHttpApi";
import DatabricksApi, { readDatabricksConnection } from "./DatabricksApi";
import AthenaApi, {
  describeScanLimit,
  readAthenaConnection,
} from "./AthenaApi";
import { MongoCheckStatement, readMongoCheckStatement } from "./MongoDbChecks";
import { isMongoSystemDatabase, readMongoUri } from "./MongoUri";
import { MAX_SEGMENTS_PER_CHECK } from "../../../Types/DataObservability/DataCheckType";
import {
  OracleConnectAttributes,
  readOracleConnection,
} from "./OracleConnection";
import { JSONObject } from "../../../Types/JSON";
import {
  DataCheckLimits,
  DataCheckRunResult,
  MAX_CHECK_ERROR_LENGTH,
  PlannedDataCheck,
  readCheckRows,
} from "./DataCheckResults";
import {
  CollectedJobSpend,
  MAX_SPEND_JOBS,
  MAX_WRITTEN_TABLES_PER_JOB,
  nameJob,
  readTeamOfTag,
  SPEND_WINDOW_IN_HOURS,
} from "../../../Types/DataObservability/DataWarehouseSpend";

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
 *    live rows, total size, its insert, update and delete counters and its
 *    scan counters; the counters say a table changed, or was read, when they
 *    move between collections, and pg_stat_database how long they have
 *    counted for.
 *    pg_attribute gives the columns. Partitions are folded into their
 *    partitioned table.
 *  - MySQL and MariaDB: information_schema.TABLES gives rows, size and
 *    UPDATE_TIME (MySQL 8 caches those for a day unless the session says
 *    otherwise, so it does); performance_schema's table I/O counters, where
 *    the login may read them, back UPDATE_TIME up and count reads, since the
 *    server started (its Uptime).
 *    information_schema.COLUMNS gives the columns.
 *  - SQL Server: sys.objects and sys.partitions give tables, views and rows;
 *    sys.dm_db_partition_stats and sys.dm_db_index_usage_stats give size,
 *    last update and last read, with their counters, where the login has VIEW
 *    DATABASE STATE, since the server started (sys.dm_os_sys_info).
 *    INFORMATION_SCHEMA.COLUMNS gives the columns.
 *
 *  - ClickHouse: system.tables gives rows and bytes; system.parts each
 *    MergeTree table's block numbers, which only an insert moves, as its
 *    write counter; system.part_log, where the server keeps one, the time
 *    of each insert. system.columns gives the columns.
 *  - Databricks: Unity Catalog's REST API gives every table, view and
 *    column, and each Delta table's last commit, with no SQL warehouse.
 *  - MongoDB: listCollections and $collStats give each collection's
 *    documents and size, its newest ObjectId _id when it last took one,
 *    and its validator - or a sample's field names and types - its fields.
 *  - Oracle: ALL_TABLES and ALL_TAB_MODIFICATIONS give rows, inserts,
 *    updates and deletes since the last statistics, and the last change;
 *    DBA_SEGMENTS the size; ALL_TAB_COLUMNS the columns.
 *  - Amazon Athena: the Glue Data Catalog's API gives every table and view
 *    of a Glue database, its columns and statistics, and each Iceberg
 *    table's last commit.
 *
 * Each engine also says which tables feed which, where it can (lineage
 * with no pipeline to report it): a view's tables from its definition
 * (PostgreSQL, Redshift, MySQL 8, SQL Server), and a query that read one
 * table and wrote another from the engine's own query history (BigQuery's
 * jobs, Redshift's query log), read back to the last collection.
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

// What a read replica cannot say, as its database's warning.
const READ_REPLICA_WARNING: string =
  "This is a read replica. It does not count the writes it replays, or the reads on its primary, so a table's last change comes from its rows and size, and its reads are left out. Connect the primary to count both.";

// BigQuery's words when a query would bill more than it was allowed.
const BYTES_BILLED_LIMIT_PATTERN: RegExp = /bytes ?billed/i;
/*
 * The newest documents of a MongoDB collection whose fields are read when
 * no validator names them: the same documents read the same, so a field
 * leaves the list only when the newest ones stop carrying it.
 */
const MONGO_FIELD_SAMPLE_SIZE: number = 100;
// Most edges of lineage one collection reports.
export const MAX_LINEAGE_EDGES_PER_COLLECTION: number = 5_000;
// The longest login or service account an edge keeps.
export const MAX_SEEN_BY_LENGTH: number = 100;
// The query history a store's first collection reads, and the most any collection reads.
export const MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS: number = 7 * 24 * 60 * 60;
// Read before the last hour lineage was read in, so a query ending in between is never missed.
export const QUERY_HISTORY_MARGIN_IN_SECONDS: number = 15 * 60;
const HOUR_IN_MS: number = 60 * 60 * 1000;

/*
 * How far back a collection reads the query history, or 0 when it reads
 * no lineage this time. Lineage changes slowly and reading a query history
 * costs a little (BigQuery bills the bytes its jobs view reads), so it is
 * read at a store's first collection of each hour, back to the start of
 * the hour of its last collection with a margin: a query is read twice
 * rather than missed, and an edge is kept once per pair, so reading it
 * twice changes nothing. A store's first collection reads a week, so its
 * lineage is there from the start.
 */
export function getQueryHistoryLookbackInSeconds(
  lastCollectedAt: Date | null | undefined,
  now: Date,
): number {
  // A date read back from the database, or its text.
  const last: number = lastCollectedAt
    ? new Date(lastCollectedAt).getTime()
    : NaN;

  if (!Number.isFinite(last)) {
    return MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS;
  }

  const lastHour: number = Math.floor(last / HOUR_IN_MS);

  if (Math.floor(now.getTime() / HOUR_IN_MS) <= lastHour) {
    return 0;
  }

  return Math.min(
    MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS,
    Math.floor((now.getTime() - lastHour * HOUR_IN_MS) / 1000) +
      QUERY_HISTORY_MARGIN_IN_SECONDS,
  );
}

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
  /*
   * A counter that grows with every scan or index read since the engine's
   * statistics were last reset; null when the login cannot read one.
   */
  readCount?: number | null | undefined;
  // How long ago the engine says the table was last read; null when it does not say.
  secondsSinceRead?: number | null | undefined;
  // Null when the collection could not read all of them (the column list was cut).
  columns: Array<DataAssetColumn> | null;
  /*
   * True when the columns were worked out from its data, not read from a
   * schema (MongoDB's newest documents): one coming or going says what the
   * documents hold, not that anything broke.
   */
  columnsAreInferred?: boolean | undefined;
}

// Where the database itself shows one table feeding another.
export type CollectedLineageSource =
  | DataAssetLineageSource.QueryHistory
  | DataAssetLineageSource.ViewDefinition;

/*
 * One table feeding another, as the database itself shows it: a query in
 * its history that read the first and wrote the second, or a view defined
 * over the first. The downstream table is always the store's own; the
 * upstream one is too, unless upstreamDatabase names another (a BigQuery
 * query that read another project's or dataset's table).
 */
export interface CollectedLineageEdge {
  source: CollectedLineageSource;
  upstreamDatabase: string | null;
  upstreamSchema: string;
  upstreamTable: string;
  downstreamSchema: string;
  downstreamTable: string;
  // How long ago the last query that moved the data ended; null for a view.
  secondsSinceSeen: number | null;
  // A login or service account whose queries moved it; null for a view.
  seenBy: string | null;
  // Which columns feed which, when the database says (Snowflake's access history).
  columnMappings?: Array<DataColumnMapping> | undefined;
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
  /*
   * How long the engine's read and write counters have counted for: since
   * its statistics were reset or the server started. Null when unknown.
   */
  secondsSinceStatsReset?: number | null | undefined;
  // Tables feeding others, as the database shows it: views, and its query history.
  lineage?: Array<CollectedLineageEdge> | undefined;
  // True when every view's definition was read, so a view edge not reported is gone.
  isViewLineageComplete?: boolean | undefined;
  /*
   * What the warehouse spent on each job over the last day, read once an
   * hour; unset when it was not read this time.
   */
  spend?: Array<CollectedJobSpend> | undefined;
}

export interface TableHealthCollectOptions {
  maxTables: number;
  maxColumns: number;
  // "schema", "schema.table" or "table": the store's scan exclusions.
  exclusions: Array<string>;
  // The store's data checks that are due, run after the catalog in the same session.
  checks?: Array<PlannedDataCheck> | undefined;
  /*
   * How far back to read the query history (getQueryHistoryLookbackInSeconds);
   * 0, or not given (an older server, which keeps no lineage from a
   * collection), reads no lineage.
   */
  queryHistoryLookbackInSeconds?: number | undefined;
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
  readCount: number | null;
  secondsSinceRead: number | null;
  columnsAreInferred?: boolean | undefined;
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
  secondsSinceStatsReset: number | null;
  // Tables ("schema.table" keys) whose columns could not be read this time: unknown, not dropped.
  columnsUnknown?: Array<string> | undefined;
}

interface LineageRead {
  edges: Array<CollectedLineageEdge>;
  // True when every view's definition was read.
  isViewLineageComplete: boolean;
  warnings: Array<string>;
}

const NO_LINEAGE: LineageRead = {
  edges: [],
  isViewLineageComplete: false,
  warnings: [],
};

interface SpendRead {
  jobs: Array<CollectedJobSpend>;
  warnings: Array<string>;
  // Whether spend was read this time: a job not in a read list ran in none of the last day.
  isRead: boolean;
}

const NO_SPEND: SpendRead = { jobs: [], warnings: [], isRead: false };

interface CatalogSession {
  readonly engine: DatabaseEngine;
  read(options: TableHealthCollectOptions): Promise<CatalogRead>;
  // Which tables feed which, as the engine shows it; one that cannot say has none.
  readLineage?(options: TableHealthCollectOptions): Promise<LineageRead>;
  // What the warehouse spent on each job over the last day: once an hour, where it bills by use.
  readSpend?(options: TableHealthCollectOptions): Promise<SpendRead>;
  // One data check's aggregate, read-only and bounded like every catalog read.
  readAggregate(
    sql: string,
    params: Array<string>,
    limits?: DataCheckLimits | undefined,
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

// The query history this collection reads, in whole seconds: 0 for none.
function readLookback(options: TableHealthCollectOptions): number {
  const value: number = Number(options.queryHistoryLookbackInSeconds);

  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.min(Math.floor(value), MAX_QUERY_HISTORY_LOOKBACK_IN_SECONDS);
}

/*
 * A lineage row, as every engine's statement names its columns: the
 * upstream table (with its database when it is another's), the downstream
 * one, and for a query how long ago it ended and whose it was. A table
 * feeding itself (an update reading its own rows) is no edge.
 */
export function readLineageRow(
  row: Record<string, unknown>,
  source: CollectedLineageSource,
): CollectedLineageEdge | null {
  const isQuery: boolean = source === DataAssetLineageSource.QueryHistory;
  const edge: CollectedLineageEdge = {
    source,
    upstreamDatabase:
      readText(row["upstream_database"], MAX_IDENTIFIER_LENGTH).trim() || null,
    upstreamSchema: readText(row["upstream_schema"], MAX_IDENTIFIER_LENGTH),
    upstreamTable: readText(row["upstream_table"], MAX_IDENTIFIER_LENGTH),
    downstreamSchema: readText(row["downstream_schema"], MAX_IDENTIFIER_LENGTH),
    downstreamTable: readText(row["downstream_table"], MAX_IDENTIFIER_LENGTH),
    secondsSinceSeen: isQuery ? readCount(row["seconds_since_seen"]) : null,
    seenBy: isQuery
      ? readText(row["seen_by"], MAX_SEEN_BY_LENGTH).trim() || null
      : null,
  };

  if (!edge.upstreamTable || !edge.downstreamTable) {
    return null;
  }

  const isItself: boolean =
    !edge.upstreamDatabase &&
    edge.upstreamSchema === edge.downstreamSchema &&
    edge.upstreamTable === edge.downstreamTable;

  return isItself ? null : edge;
}

function readLineageRows(
  rows: Array<Record<string, unknown>>,
  source: CollectedLineageSource,
): Array<CollectedLineageEdge> {
  return rows
    .map((row: Record<string, unknown>): CollectedLineageEdge | null => {
      return readLineageRow(row, source);
    })
    .filter(
      (edge: CollectedLineageEdge | null): edge is CollectedLineageEdge => {
        return edge !== null;
      },
    );
}

/*
 * Every view's tables, read in one statement: complete unless it failed or
 * was cut at its limit. An engine version that keeps no view's tables
 * (isUnsupported) has no view lineage, with no warning.
 */
async function readViewLineage(
  read: () => Promise<Array<Record<string, unknown>>>,
  isUnsupported?: (message: string) => boolean,
): Promise<LineageRead> {
  try {
    const rows: Array<Record<string, unknown>> = await read();

    return {
      edges: readLineageRows(rows, DataAssetLineageSource.ViewDefinition),
      isViewLineageComplete: rows.length < MAX_LINEAGE_EDGES_PER_COLLECTION,
      warnings: [],
    };
  } catch (error) {
    const message: string = describeError(error);

    return {
      ...NO_LINEAGE,
      warnings:
        isUnsupported && isUnsupported(message)
          ? []
          : [
              `The lineage of views was left out (their definitions could not be read): ${message.slice(0, 200)}`,
            ],
    };
  }
}

/*
 * A view's tables, PostgreSQL's and Redshift's alike: its rewrite rule
 * depends on each table and view it selects from (pg_depend). A Redshift
 * late-binding view (WITH NO SCHEMA BINDING) records none.
 */
function pgViewLineageSql(schemaFilter: string): string {
  return `SELECT DISTINCT sn.nspname AS upstream_schema, sc.relname AS upstream_table,
      vn.nspname AS downstream_schema, vc.relname AS downstream_table
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
    JOIN pg_catalog.pg_class vc ON vc.oid = r.ev_class
    JOIN pg_catalog.pg_namespace vn ON vn.oid = vc.relnamespace
    JOIN pg_catalog.pg_class sc ON sc.oid = d.refobjid
    JOIN pg_catalog.pg_namespace sn ON sn.oid = sc.relnamespace
    WHERE vc.relkind IN ('v', 'm')
      AND sc.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND sc.oid <> vc.oid
      AND vn.nspname ${schemaFilter}
      AND vn.nspname NOT LIKE 'pg\\_%'
    ORDER BY 3, 4, 1, 2
    LIMIT $1`;
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
        END::bigint AS write_count,
        CASE
          WHEN c.relkind = 'p' THEN (
            SELECT SUM(COALESCE(cs.seq_scan, 0) + COALESCE(cs.idx_scan, 0))
            FROM pg_catalog.pg_inherits i
            JOIN pg_catalog.pg_stat_user_tables cs ON cs.relid = i.inhrelid
            WHERE i.inhparent = c.oid)
          WHEN c.relkind IN ('r', 'm') AND s.relid IS NOT NULL
            THEN COALESCE(s.seq_scan, 0) + COALESCE(s.idx_scan, 0)
          ELSE NULL
        END::bigint AS read_count
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
      WHERE ${PostgresCatalog.RELATION_FILTER}
      ORDER BY n.nspname, c.relname
      LIMIT $1`;
  }

  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    if (readLookback(options) === 0) {
      return NO_LINEAGE;
    }

    return await readViewLineage(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.rows(
          pgViewLineageSql("NOT IN ('pg_catalog', 'information_schema')"),
          [MAX_LINEAGE_EDGES_PER_COLLECTION],
        );
      },
    );
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

    const [recovery] = await this.rows(
      "SELECT pg_catalog.pg_is_in_recovery() AS in_recovery",
      [],
    );
    const isReplica: boolean = recovery?.["in_recovery"] === true;

    if (isReplica) {
      warnings.push(READ_REPLICA_WARNING);
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
        writeCount: isReplica ? null : readCount(row["write_count"]),
        secondsSinceChange: null,
        readCount: isReplica ? null : readCount(row["read_count"]),
        secondsSinceRead: null,
      });
    }

    let secondsSinceStatsReset: number | null = null;

    try {
      /*
       * The counters count since the database's statistics were reset; a
       * restart before PostgreSQL 15 lost them too, so the later of the two.
       */
      const [epoch] = await this.rows(
        `SELECT EXTRACT(EPOCH FROM (now() - GREATEST(COALESCE(d.stats_reset, pg_catalog.pg_postmaster_start_time()), pg_catalog.pg_postmaster_start_time())))::bigint AS seconds
          FROM pg_catalog.pg_stat_database d WHERE d.datname = pg_catalog.current_database()`,
        [],
      );
      secondsSinceStatsReset = readCount(epoch?.["seconds"]);
    } catch (error) {
      warnings.push(
        `How long the read counters have counted for was left out: ${describeError(error).slice(0, 200)}`,
      );
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
      secondsSinceStatsReset,
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

  // Each view's tables (MySQL 8.0.13 and later; MariaDB keeps none).
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    if (readLookback(options) === 0) {
      return NO_LINEAGE;
    }

    return await readViewLineage(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.inReadOnlyTransaction(
          `SELECT VIEW_SCHEMA AS downstream_schema, VIEW_NAME AS downstream_table,
            TABLE_SCHEMA AS upstream_schema, TABLE_NAME AS upstream_table
          FROM information_schema.VIEW_TABLE_USAGE
          WHERE VIEW_SCHEMA ${MySqlCatalog.SCHEMA_FILTER}
            AND (DATABASE() IS NULL OR VIEW_SCHEMA = DATABASE())
          ORDER BY VIEW_SCHEMA, VIEW_NAME, TABLE_SCHEMA, TABLE_NAME
          LIMIT ?`,
          [MAX_LINEAGE_EDGES_PER_COLLECTION],
        );
      },
      (message: string): boolean => {
        return message.toUpperCase().includes("VIEW_TABLE_USAGE");
      },
    );
  }

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
    const readCounts: Map<string, number> = new Map();
    let secondsSinceStatsReset: number | null = null;

    try {
      const counterRows: Array<Record<string, unknown>> =
        await this.inReadOnlyTransaction(
          `SELECT OBJECT_SCHEMA AS table_schema, OBJECT_NAME AS table_name,
            COUNT_INSERT + COUNT_UPDATE + COUNT_DELETE AS write_count,
            COUNT_READ AS read_count
          FROM performance_schema.table_io_waits_summary_by_table
          WHERE OBJECT_TYPE = 'TABLE'
            AND OBJECT_SCHEMA ${MySqlCatalog.SCHEMA_FILTER}
            AND (DATABASE() IS NULL OR OBJECT_SCHEMA = DATABASE())`,
          [],
        );

      for (const row of counterRows) {
        const key: string = keyOf(
          String(row["table_schema"] ?? ""),
          String(row["table_name"] ?? ""),
        );
        const count: number | null = readCount(row["write_count"]);
        const reads: number | null = readCount(row["read_count"]);

        if (count !== null) {
          writeCounts.set(key, count);
        }

        if (reads !== null) {
          readCounts.set(key, reads);
        }
      }

      // performance_schema counts since the server started.
      const [uptime] = await this.inReadOnlyTransaction(
        `SELECT VARIABLE_VALUE AS seconds FROM performance_schema.global_status WHERE VARIABLE_NAME = 'Uptime'`,
        [],
      );
      secondsSinceStatsReset = readCount(uptime?.["seconds"]);
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
        readCount: readCounts.get(keyOf(schema, name)) ?? null,
        secondsSinceRead: null,
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
      secondsSinceStatsReset,
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

  // Each view's tables and views, from its expression dependencies.
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    if (readLookback(options) === 0) {
      return NO_LINEAGE;
    }

    return await readViewLineage(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.run(
          `SELECT DISTINCT TOP (@p0) vs.name AS downstream_schema, v.name AS downstream_table,
            os.name AS upstream_schema, o.name AS upstream_table
          FROM sys.sql_expression_dependencies d
          JOIN sys.views v ON v.object_id = d.referencing_id
          JOIN sys.schemas vs ON vs.schema_id = v.schema_id
          JOIN sys.objects o ON o.object_id = d.referenced_id
          JOIN sys.schemas os ON os.schema_id = o.schema_id
          WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0 AND v.is_ms_shipped = 0
            AND o.object_id <> v.object_id
          ORDER BY downstream_schema, downstream_table, upstream_schema, upstream_table`,
          [MAX_LINEAGE_EDGES_PER_COLLECTION],
        );
      },
    );
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
        readCount: number | null;
        secondsSinceRead: number | null;
      }
    > = new Map();
    let secondsSinceStatsReset: number | null = null;

    // A readable secondary replays writes without counting them, and sees its own reads only.
    const [role] = await this.run(
      "SELECT CAST(DATABASEPROPERTYEX(DB_NAME(), 'Updateability') AS nvarchar(20)) AS updateability",
      [],
    );
    const isReplica: boolean = role?.["updateability"] === "READ_ONLY";

    if (isReplica) {
      warnings.push(READ_REPLICA_WARNING);
    }

    try {
      const statisticRows: Array<Record<string, unknown>> = await this.run(
        `SELECT TOP (@p0) s.name AS table_schema, o.name AS table_name,
          (SELECT SUM(ps.reserved_page_count) FROM sys.dm_db_partition_stats ps
            WHERE ps.object_id = o.object_id) * CAST(8192 AS bigint) AS size_bytes,
          (SELECT DATEDIFF(SECOND, MAX(u.last_user_update), GETDATE()) FROM sys.dm_db_index_usage_stats u
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS seconds_since_change,
          (SELECT SUM(u.user_updates) FROM sys.dm_db_index_usage_stats u
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS write_count,
          (SELECT SUM(u.user_seeks + u.user_scans + u.user_lookups) FROM sys.dm_db_index_usage_stats u
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS read_count,
          (SELECT DATEDIFF(SECOND, MAX(r.last_read), GETDATE())
            FROM sys.dm_db_index_usage_stats u
            CROSS APPLY (VALUES (u.last_user_seek), (u.last_user_scan), (u.last_user_lookup)) AS r(last_read)
            WHERE u.database_id = DB_ID() AND u.object_id = o.object_id) AS seconds_since_read
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
            secondsSinceChange: isReplica
              ? null
              : readCount(row["seconds_since_change"]),
            writeCount: isReplica ? null : readCount(row["write_count"]),
            readCount: isReplica ? null : readCount(row["read_count"]),
            secondsSinceRead: isReplica
              ? null
              : readCount(row["seconds_since_read"]),
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
            readCount: number | null;
            secondsSinceRead: number | null;
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
        readCount: statistic?.readCount ?? null,
        secondsSinceRead: statistic?.secondsSinceRead ?? null,
      });
    }

    try {
      // The usage statistics count since the server started.
      const [started] = await this.run(
        `SELECT DATEDIFF(SECOND, sqlserver_start_time, GETDATE()) AS seconds FROM sys.dm_os_sys_info`,
        [],
      );
      secondsSinceStatsReset = readCount(started?.["seconds"]);
    } catch {
      // Needs VIEW SERVER STATE: last reads are still known, only "never read since" is not.
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
      secondsSinceStatsReset,
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

// Redshift's table type, as a data asset kind.
export function readRedshiftKind(tableType: unknown): DataAssetKind | null {
  switch (String(tableType ?? "").toUpperCase()) {
    case "BASE TABLE":
      return DataAssetKind.Table;
    case "VIEW":
      return DataAssetKind.View;
    default:
      return null;
  }
}

// Redshift counts a table's size in 1 MB blocks.
export function readRedshiftSize(blocks: unknown): number | null {
  const count: number | null = readCount(blocks);

  return count === null ? null : count * 1024 * 1024;
}

/*
 * Amazon Redshift, over the PostgreSQL protocol with its own catalog:
 * svv_tables and svv_columns give tables, views and columns; svv_table_info
 * rows and size (1 MB blocks); stl_insert, stl_delete and stl_scan the last
 * write and read, kept a few days. svv_table_info and the stl views show
 * every user's work only to a login with SYSLOG ACCESS UNRESTRICTED (or a
 * superuser); without it, rows changing still say when a table changed.
 * Redshift has no lock timeout, and a cluster restart does not mark its
 * counters, so read times are kept, never "unread since".
 */
class RedshiftCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "redshift";
  private readonly client: Client;

  private constructor(client: Client) {
    this.client = client;
  }

  public static async open(connectionString: string): Promise<RedshiftCatalog> {
    const client: Client = new Client({
      connectionString: connectionString.replace(
        /^redshift:\/\//i,
        "postgresql://",
      ),
      connectionTimeoutMillis: CONNECT_TIMEOUT_IN_MS,
      query_timeout: STATEMENT_TIMEOUT_IN_MS + 5_000,
      application_name: APPLICATION_NAME,
    });
    const session: RedshiftCatalog = new RedshiftCatalog(client);

    try {
      await client.connect();
      await client.query(
        `SET statement_timeout TO ${wholeMilliseconds(STATEMENT_TIMEOUT_IN_MS)}`,
      );
    } catch (error) {
      await session.close();
      throw error;
    }

    return session;
  }

  private async rows(
    sql: string,
    values: Array<unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    await this.client.query("BEGIN READ ONLY");

    try {
      const result: { rows: Array<Record<string, unknown>> } =
        await this.client.query(sql, values);

      await this.client.query("COMMIT");
      return result.rows || [];
    } catch (error) {
      try {
        await this.client.query("ROLLBACK");
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
    return await this.rows(sql, params);
  }

  private static readonly SCHEMA_FILTER: string = `NOT IN ('pg_catalog', 'information_schema', 'pg_internal', 'pg_automv', 'catalog_history')`;

  private tablesSql(withInfo: boolean): string {
    return withInfo
      ? `SELECT t.table_schema, t.table_name, t.table_type,
          i.estimated_visible_rows AS estimated_rows, i.size AS size_blocks
        FROM svv_tables t
        LEFT JOIN svv_table_info i ON i."schema" = t.table_schema AND i."table" = t.table_name
        WHERE t.table_catalog = current_database()
          AND t.table_schema ${RedshiftCatalog.SCHEMA_FILTER}
          AND t.table_schema NOT LIKE 'pg\\_temp\\_%'
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY t.table_schema, t.table_name
        LIMIT $1`
      : `SELECT t.table_schema, t.table_name, t.table_type,
          NULL::bigint AS estimated_rows, NULL::bigint AS size_blocks
        FROM svv_tables t
        WHERE t.table_catalog = current_database()
          AND t.table_schema ${RedshiftCatalog.SCHEMA_FILTER}
          AND t.table_schema NOT LIKE 'pg\\_temp\\_%'
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY t.table_schema, t.table_name
        LIMIT $1`;
  }

  // Seconds since each table's last write or read in the stl views, by table.
  private async lastTimes(sql: string): Promise<Map<string, number> | null> {
    try {
      const times: Map<string, number> = new Map();

      for (const row of await this.rows(sql, [])) {
        const seconds: number | null = readCount(row["seconds"]);

        if (seconds !== null) {
          times.set(
            keyOf(
              String(row["table_schema"] ?? ""),
              String(row["table_name"] ?? ""),
            ),
            seconds,
          );
        }
      }

      return times;
    } catch {
      return null;
    }
  }

  /*
   * Each view's tables, and a query that read one table and wrote another
   * in the query log: stl_insert's table written, stl_scan's user tables
   * read (type 2) by the same query. A load from S3 reads no table, and a
   * temporary table is gone from the catalog once its session ends, so
   * neither is an edge.
   */
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    const lookback: number = readLookback(options);

    if (lookback === 0) {
      return NO_LINEAGE;
    }

    const views: LineageRead = await readViewLineage(
      async (): Promise<Array<Record<string, unknown>>> => {
        return await this.rows(
          pgViewLineageSql(RedshiftCatalog.SCHEMA_FILTER),
          [MAX_LINEAGE_EDGES_PER_COLLECTION],
        );
      },
    );

    try {
      const rows: Array<Record<string, unknown>> = await this.rows(
        `SELECT sn.nspname AS upstream_schema, sc.relname AS upstream_table,
          dn.nspname AS downstream_schema, dc.relname AS downstream_table,
          DATEDIFF(second, MAX(w.endtime), GETDATE()) AS seconds_since_seen,
          MAX(TRIM(u.usename)) AS seen_by
        FROM (SELECT query, tbl, MAX(endtime) AS endtime FROM stl_insert
          WHERE endtime > DATEADD(second, -${lookback}, GETDATE())
          GROUP BY query, tbl) w
        JOIN (SELECT DISTINCT query, tbl, userid FROM stl_scan
          WHERE type = 2 AND userid > 1
            AND endtime > DATEADD(second, -${lookback}, GETDATE())) r
          ON r.query = w.query AND r.tbl <> w.tbl
        JOIN pg_class dc ON dc.oid = w.tbl
        JOIN pg_namespace dn ON dn.oid = dc.relnamespace
        JOIN pg_class sc ON sc.oid = r.tbl
        JOIN pg_namespace sn ON sn.oid = sc.relnamespace
        LEFT JOIN pg_user u ON u.usesysid = r.userid
        WHERE dn.nspname ${RedshiftCatalog.SCHEMA_FILTER}
          AND sn.nspname ${RedshiftCatalog.SCHEMA_FILTER}
          AND dn.nspname NOT LIKE 'pg\\_%'
          AND sn.nspname NOT LIKE 'pg\\_%'
        GROUP BY sn.nspname, sc.relname, dn.nspname, dc.relname
        ORDER BY seconds_since_seen
        LIMIT $1`,
        [MAX_LINEAGE_EDGES_PER_COLLECTION],
      );

      return {
        ...views,
        edges: [
          ...views.edges,
          ...readLineageRows(rows, DataAssetLineageSource.QueryHistory),
        ],
      };
    } catch (error) {
      return {
        ...views,
        warnings: [
          ...views.warnings,
          `Lineage from the query log was left out (stl_insert and stl_scan need SYSLOG ACCESS UNRESTRICTED): ${describeError(error).slice(0, 200)}`,
        ],
      };
    }
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    let tableRows: Array<Record<string, unknown>>;

    try {
      tableRows = await this.rows(this.tablesSql(true), [options.maxTables]);
    } catch (error) {
      warnings.push(
        `Row counts and sizes were left out (svv_table_info needs SYSLOG ACCESS UNRESTRICTED): ${describeError(error).slice(0, 200)}`,
      );
      tableRows = await this.rows(this.tablesSql(false), [options.maxTables]);
    }

    const writes: Map<string, number> | null = await this.lastTimes(
      `SELECT n.nspname AS table_schema, c.relname AS table_name,
        DATEDIFF(second, MAX(s.endtime), GETDATE()) AS seconds
      FROM (SELECT tbl, endtime FROM stl_insert UNION ALL SELECT tbl, endtime FROM stl_delete) s
      JOIN pg_class c ON c.oid = s.tbl
      JOIN pg_namespace n ON n.oid = c.relnamespace
      GROUP BY n.nspname, c.relname`,
    );
    const reads: Map<string, number> | null = await this.lastTimes(
      `SELECT n.nspname AS table_schema, c.relname AS table_name,
        DATEDIFF(second, MAX(s.endtime), GETDATE()) AS seconds
      FROM stl_scan s
      JOIN pg_class c ON c.oid = s.tbl
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE s.userid > 1
      GROUP BY n.nspname, c.relname`,
    );

    if (!writes || !reads) {
      warnings.push(
        "Last writes and reads were left out: the stl views need SYSLOG ACCESS UNRESTRICTED.",
      );
    }

    const tables: Array<RawTable> = [];

    for (const row of tableRows) {
      const kind: DataAssetKind | null = readRedshiftKind(row["table_type"]);
      const schema: string = readText(
        row["table_schema"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name) {
        continue;
      }

      const isTable: boolean = kind === DataAssetKind.Table;
      const key: string = keyOf(schema, name);

      tables.push({
        schema,
        name,
        kind,
        estimatedRows: isTable ? readCount(row["estimated_rows"]) : null,
        sizeInBytes: isTable ? readRedshiftSize(row["size_blocks"]) : null,
        writeCount: null,
        secondsSinceChange: writes?.get(key) ?? null,
        readCount: null,
        secondsSinceRead: reads?.get(key) ?? null,
      });
    }

    const columnRows: Array<Record<string, unknown>> = await this.rows(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
        FROM svv_columns
        WHERE table_catalog = current_database()
          AND table_schema ${RedshiftCatalog.SCHEMA_FILTER}
        ORDER BY table_schema, table_name, ordinal_position
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
      secondsSinceStatsReset: null,
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

const SNOWFLAKE_BARE_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_$]*$/;

// A Snowflake name as a statement writes it: bare when it can be, else quoted.
export function snowflakeIdentifier(name: string): string {
  return SNOWFLAKE_BARE_NAME.test(name)
    ? name
    : `"${name.replace(/"/g, '""')}"`;
}

// A SHOW TABLES row's kind; a temporary table is a session's, never watched.
export function readSnowflakeTableKind(
  row: Record<string, unknown>,
): DataAssetKind | null {
  const kind: string = String(row["kind"] ?? "TABLE").toUpperCase();

  if (kind === "TEMPORARY" || String(row["is_external"] ?? "N") === "Y") {
    return null;
  }

  return DataAssetKind.Table;
}

// A SHOW COLUMNS row's type, as Snowflake writes it: NUMBER(38,0), VARCHAR(255).
export function readSnowflakeColumnType(dataType: unknown): {
  dataType: string;
  isNullable: boolean;
} {
  let parsed: JSONObject = {};

  try {
    parsed =
      typeof dataType === "string" ? (JSON.parse(dataType) as JSONObject) : {};
  } catch {
    parsed = {};
  }

  const type: string = String(parsed["type"] || "").toUpperCase();
  const isNullable: boolean = parsed["nullable"] !== false;

  if (type === "FIXED") {
    return {
      dataType: `NUMBER(${String(parsed["precision"] ?? 38)},${String(parsed["scale"] ?? 0)})`,
      isNullable,
    };
  }

  if (type === "TEXT") {
    return {
      dataType: parsed["length"]
        ? `VARCHAR(${String(parsed["length"])})`
        : "VARCHAR",
      isNullable,
    };
  }

  if (type === "REAL") {
    return { dataType: "FLOAT", isNullable };
  }

  return { dataType: type || "UNKNOWN", isNullable };
}

/*
 * Snowflake, over its SQL API (SnowflakeSqlApi). The catalog is read with
 * SHOW - tables with their rows and bytes, views, columns schema by schema
 * (SHOW returns at most 10,000 rows) - which needs no warehouse, so a
 * collection costs no credits. SHOW says no table's last change, so a table
 * changed when its rows or bytes moved. A data check reads a table's rows,
 * so it runs on the connection's warehouse.
 */
class SnowflakeCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "snowflake";
  private readonly api: SnowflakeSqlApi;
  private readonly database: string;

  private constructor(api: SnowflakeSqlApi, database: string) {
    this.api = api;
    this.database = database;
  }

  public static async open(
    connectionString: string,
  ): Promise<SnowflakeCatalog> {
    const connection: SnowflakeConnection =
      readSnowflakeConnection(connectionString);
    const session: SnowflakeCatalog = new SnowflakeCatalog(
      new SnowflakeSqlApi({ connection }),
      connection.database,
    );

    // A connection that cannot list its database's schemas cannot collect.
    await session.api.query({
      statement: `SHOW SCHEMAS IN DATABASE ${snowflakeIdentifier(connection.database)} LIMIT 1`,
    });

    return session;
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.api.query({
      statement: sql,
      bindings: params,
      useWarehouse: true,
    });
  }

  /*
   * Views from OBJECT_DEPENDENCIES and queries from ACCESS_HISTORY, down to
   * which column feeds which. Both are ACCOUNT_USAGE, read on the warehouse
   * once an hour with spend. ACCESS_HISTORY is Snowflake Enterprise's:
   * without it, views still say their lineage.
   */
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    const lookback: number = readLookback(options);

    if (lookback <= 0) {
      return NO_LINEAGE;
    }

    const window: number = Math.max(
      lookback,
      SNOWFLAKE_ACCOUNT_USAGE_LATENCY_IN_SECONDS,
    );
    const warnings: Array<string> = [];
    const edges: Array<CollectedLineageEdge> = [];
    let isViewLineageComplete: boolean = false;

    try {
      const rows: Array<Record<string, unknown>> = await this.api.query({
        statement: SNOWFLAKE_VIEW_LINEAGE_QUERY,
        bindings: [this.database],
        useWarehouse: true,
      });

      for (const row of rows) {
        const isHere: boolean =
          String(row["upstream_database"] ?? "").toUpperCase() ===
          this.database.toUpperCase();
        const edge: CollectedLineageEdge | null = readLineageRow(
          { ...row, upstream_database: isHere ? "" : row["upstream_database"] },
          DataAssetLineageSource.ViewDefinition,
        );

        if (edge) {
          edges.push(edge);
        }
      }

      isViewLineageComplete = rows.length < MAX_LINEAGE_EDGES_PER_COLLECTION;
    } catch (error) {
      warnings.push(
        `View lineage was left out (SNOWFLAKE.ACCOUNT_USAGE needs IMPORTED PRIVILEGES): ${describeError(error).slice(0, 200)}`,
      );
    }

    try {
      const queryEdges: Map<string, CollectedLineageEdge> = new Map();

      for (const row of await this.api.query({
        statement: buildSnowflakeQueryLineageQuery(window),
        bindings: [this.database],
        useWarehouse: true,
      })) {
        const upstream: ReturnType<typeof readSnowflakeObjectParts> =
          readSnowflakeObjectParts(row["upstream_object"], this.database);
        const downstream: ReturnType<typeof readSnowflakeObjectParts> =
          readSnowflakeObjectParts(row["downstream_object"], this.database);

        if (!upstream || !downstream || downstream.database) {
          continue;
        }

        const edge: CollectedLineageEdge | null = readLineageRow(
          {
            upstream_database: upstream.database,
            upstream_schema: upstream.schema,
            upstream_table: upstream.table,
            downstream_schema: downstream.schema,
            downstream_table: downstream.table,
            seconds_since_seen: row["seconds_since_seen"],
            seen_by: row["seen_by"],
          },
          DataAssetLineageSource.QueryHistory,
        );

        if (edge) {
          queryEdges.set(
            `${row["upstream_object"]}\u0000${row["downstream_object"]}`.toUpperCase(),
            edge,
          );
        }
      }

      // Column lineage is extra: the tables' edge stands without it.
      try {
        for (const row of await this.api.query({
          statement: buildSnowflakeColumnLineageQuery(window),
          bindings: [this.database],
          useWarehouse: true,
        })) {
          const edge: CollectedLineageEdge | undefined = queryEdges.get(
            `${row["upstream_object"]}\u0000${row["downstream_object"]}`.toUpperCase(),
          );
          const upstreamColumn: string = readText(
            row["upstream_column"],
            MAX_COLUMN_NAME_LENGTH,
          );
          const downstreamColumn: string = readText(
            row["downstream_column"],
            MAX_COLUMN_NAME_LENGTH,
          );

          if (edge && upstreamColumn && downstreamColumn) {
            edge.columnMappings = [
              ...(edge.columnMappings || []),
              { upstreamColumn, downstreamColumn },
            ];
          }
        }
      } catch (error) {
        warnings.push(
          `Column lineage was left out: ${describeError(error).slice(0, 200)}`,
        );
      }

      edges.push(...queryEdges.values());
    } catch (error) {
      warnings.push(
        `Query lineage was left out (ACCESS_HISTORY is Snowflake Enterprise's): ${describeError(error).slice(0, 200)}`,
      );
    }

    return { edges, isViewLineageComplete, warnings };
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    const database: string = snowflakeIdentifier(this.database);
    const limit: number = Math.min(options.maxTables, 10_000);
    const tables: Array<RawTable> = [];

    for (const row of await this.api.query({
      statement: `SHOW TABLES IN DATABASE ${database} LIMIT ${limit}`,
    })) {
      const kind: DataAssetKind | null = readSnowflakeTableKind(row);
      const schema: string = readText(
        row["schema_name"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["name"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name || schema === "INFORMATION_SCHEMA") {
        continue;
      }

      tables.push({
        schema,
        name,
        kind,
        estimatedRows: readCount(row["rows"]),
        sizeInBytes: readCount(row["bytes"]),
        writeCount: null,
        secondsSinceChange: null,
        readCount: null,
        secondsSinceRead: null,
      });
    }

    try {
      for (const row of await this.api.query({
        statement: `SHOW VIEWS IN DATABASE ${database} LIMIT ${limit}`,
      })) {
        const schema: string = readText(
          row["schema_name"],
          MAX_IDENTIFIER_LENGTH,
        );
        const name: string = readText(row["name"], MAX_IDENTIFIER_LENGTH);

        if (!name || schema === "INFORMATION_SCHEMA") {
          continue;
        }

        tables.push({
          schema,
          name,
          kind:
            String(row["is_materialized"] ?? "false") === "true"
              ? DataAssetKind.MaterializedView
              : DataAssetKind.View,
          estimatedRows: null,
          sizeInBytes: null,
          writeCount: null,
          secondsSinceChange: null,
          readCount: null,
          secondsSinceRead: null,
        });
      }
    } catch (error) {
      warnings.push(
        `Views were left out: ${describeError(error).slice(0, 200)}`,
      );
    }

    const columns: Array<RawColumn> = [];
    const schemas: Array<string> = Array.from(
      new Set(
        tables.map((table: RawTable): string => {
          return table.schema;
        }),
      ),
    ).sort();

    for (const schema of schemas) {
      if (columns.length >= options.maxColumns) {
        break;
      }

      try {
        const positions: Map<string, number> = new Map();

        for (const row of await this.api.query({
          statement: `SHOW COLUMNS IN SCHEMA ${database}.${snowflakeIdentifier(schema)}`,
        })) {
          const table: string = readText(
            row["table_name"],
            MAX_IDENTIFIER_LENGTH,
          );
          const name: string = readText(
            row["column_name"],
            MAX_IDENTIFIER_LENGTH,
          );

          if (!table || !name || columns.length >= options.maxColumns) {
            continue;
          }

          // SHOW lists a table's columns in their order.
          const position: number = (positions.get(table) || 0) + 1;
          const type: { dataType: string; isNullable: boolean } =
            readSnowflakeColumnType(row["data_type"]);

          positions.set(table, position);
          columns.push({
            schema,
            table,
            column: {
              name,
              dataType: type.dataType,
              isNullable: type.isNullable,
              position,
            },
          });
        }
      } catch (error) {
        warnings.push(
          `The columns of ${schema} were left out: ${describeError(error).slice(0, 200)}`,
        );
      }
    }

    return {
      tables: tables
        .sort((a: RawTable, b: RawTable) => {
          return keyOf(a.schema, a.name).localeCompare(keyOf(b.schema, b.name));
        })
        .slice(0, options.maxTables),
      columns,
      warnings,
      secondsSinceStatsReset: null,
    };
  }

  /*
   * Once an hour, on the connection's warehouse: each job's runs, failures
   * and credits over the last day, and the tables it wrote where the
   * account keeps ACCESS_HISTORY. ACCOUNT_USAGE needs IMPORTED PRIVILEGES
   * on the SNOWFLAKE database.
   */
  public async readSpend(
    options: TableHealthCollectOptions,
  ): Promise<SpendRead> {
    if (readLookback(options) <= 0) {
      return NO_SPEND;
    }

    const warnings: Array<string> = [];
    let rows: Array<Record<string, unknown>>;

    try {
      rows = await this.api.query({
        statement: buildSnowflakeSpendQuery(true),
        bindings: [this.database],
        useWarehouse: true,
      });
    } catch (attributionError) {
      try {
        rows = await this.api.query({
          statement: buildSnowflakeSpendQuery(false),
          bindings: [this.database],
          useWarehouse: true,
        });
        warnings.push(
          `Credits per job were left out (QUERY_ATTRIBUTION_HISTORY could not be read): ${describeError(attributionError).slice(0, 200)}`,
        );
      } catch (error) {
        return {
          ...NO_SPEND,
          warnings: [
            `Warehouse spend was left out (SNOWFLAKE.ACCOUNT_USAGE needs IMPORTED PRIVILEGES on the SNOWFLAKE database): ${describeError(error).slice(0, 200)}`,
          ],
        };
      }
    }

    const written: Map<
      string,
      Array<{ schema: string; table: string }>
    > = new Map();

    try {
      for (const row of await this.api.query({
        statement: SNOWFLAKE_WRITTEN_TABLES_QUERY,
        bindings: [this.database],
        useWarehouse: true,
      })) {
        const table: { schema: string; table: string } | null =
          readSnowflakeObjectName(row["object_name"], this.database);
        const jobKey: string = String(row["job_key"] ?? "");

        if (table && jobKey) {
          written.set(jobKey, [...(written.get(jobKey) || []), table]);
        }
      }
    } catch {
      // ACCESS_HISTORY is Snowflake Enterprise's: without it a job writes no table we know of.
    }

    return {
      jobs: rows
        .map((row: Record<string, unknown>): CollectedJobSpend | null => {
          return readSpendRow(
            row,
            written.get(String(row["job_key"] ?? "")) || [],
          );
        })
        .filter((job: CollectedJobSpend | null): job is CollectedJobSpend => {
          return job !== null;
        }),
      warnings,
      isRead: true,
    };
  }

  public async close(): Promise<void> {
    // Each statement is its own request: nothing is held open.
  }
}

// A BigQuery location, as its jobs view's region names it: us, eu, us-central1.
const BIGQUERY_LOCATION: RegExp = /^[a-z0-9-]{2,40}$/;
// A query job runs for six hours at most, so one ending in a window began at most this long before it.
const BIGQUERY_LONGEST_JOB_IN_SECONDS: number = 6 * 60 * 60;

// A Snowflake object name, DB.SCHEMA.TABLE, as a table of the store's database.
export function readSnowflakeObjectName(
  objectName: unknown,
  database: string,
): { schema: string; table: string } | null {
  const parts: Array<string> = String(objectName ?? "")
    .split(".")
    .map((part: string): string => {
      return part.replace(/^"|"$/g, "");
    });

  if (
    parts.length !== 3 ||
    !parts.every(Boolean) ||
    parts[0]!.toUpperCase() !== database.toUpperCase()
  ) {
    return null;
  }

  return { schema: parts[1]!, table: parts[2]! };
}

/*
 * Snowflake's spend over the last day, a job (a parameterized query) a
 * row: its runs and failures from QUERY_HISTORY, its compute credits from
 * QUERY_ATTRIBUTION_HISTORY, read back 30 hours since it fills in late.
 */
export function buildSnowflakeSpendQuery(withAttribution: boolean): string {
  return `WITH q AS (
      SELECT query_id, query_parameterized_hash AS job_key, query_tag, query_type, user_name,
        warehouse_name, execution_status, end_time
      FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
      WHERE end_time > DATEADD('hour', -${SPEND_WINDOW_IN_HOURS}, CURRENT_TIMESTAMP())
        AND warehouse_name IS NOT NULL
        AND query_parameterized_hash IS NOT NULL
        AND UPPER(database_name) = UPPER(?)
    )${
      withAttribution
        ? `, a AS (
      SELECT query_id, credits_attributed_compute AS credits
      FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_ATTRIBUTION_HISTORY
      WHERE start_time > DATEADD('hour', -${SPEND_WINDOW_IN_HOURS + 6}, CURRENT_TIMESTAMP())
    )`
        : ""
    }
    SELECT q.job_key, ANY_VALUE(q.query_tag) AS query_tag, ANY_VALUE(q.query_type) AS query_type,
      ANY_VALUE(q.user_name) AS user_name, ANY_VALUE(q.warehouse_name) AS warehouse_name,
      COUNT(*) AS runs, COUNT_IF(q.execution_status = 'FAIL') AS failed_runs,
      ${withAttribution ? "SUM(a.credits)" : "NULL"} AS credits,
      DATEDIFF('second', MAX(q.end_time), CURRENT_TIMESTAMP()) AS seconds_since_last_run
    FROM q${withAttribution ? " LEFT JOIN a ON a.query_id = q.query_id" : ""}
    GROUP BY q.job_key
    ORDER BY credits DESC NULLS LAST, runs DESC
    LIMIT ${MAX_SPEND_JOBS}`;
}

// The tables each job wrote, from ACCESS_HISTORY (Snowflake Enterprise).
// ACCOUNT_USAGE runs up to three hours behind: a shorter look back would miss what it has not said yet.
const SNOWFLAKE_ACCOUNT_USAGE_LATENCY_IN_SECONDS: number = 6 * 60 * 60;

// A view and what it is defined on, across the account's databases.
export const SNOWFLAKE_VIEW_LINEAGE_QUERY: string = `SELECT d.referenced_database AS upstream_database,
    d.referenced_schema AS upstream_schema, d.referenced_object_name AS upstream_table,
    d.referencing_schema AS downstream_schema, d.referencing_object_name AS downstream_table
  FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d
  WHERE UPPER(d.referencing_database) = UPPER(?)
    AND d.referencing_object_domain IN ('VIEW', 'MATERIALIZED VIEW')
    AND d.referenced_object_domain IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
  LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`;

// A query that read one table and wrote another, by the base tables behind any view it read.
export function buildSnowflakeQueryLineageQuery(
  lookbackInSeconds: number,
): string {
  return `SELECT base.value:"objectName"::string AS upstream_object,
    written.value:"objectName"::string AS downstream_object,
    DATEDIFF('second', MAX(h.query_start_time), CURRENT_TIMESTAMP()) AS seconds_since_seen,
    MAX(h.user_name) AS seen_by
  FROM SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY h,
    LATERAL FLATTEN(input => h.base_objects_accessed) base,
    LATERAL FLATTEN(input => h.objects_modified) written
  WHERE h.query_start_time > DATEADD('second', -${Math.floor(lookbackInSeconds)}, CURRENT_TIMESTAMP())
    AND base.value:"objectDomain"::string IN ('Table', 'Materialized view')
    AND written.value:"objectDomain"::string = 'Table'
    AND STARTSWITH(UPPER(written.value:"objectName"::string), UPPER(?) || '.')
  GROUP BY 1, 2
  LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`;
}

// The same history, a column at a time: each written column and the base columns behind it.
export function buildSnowflakeColumnLineageQuery(
  lookbackInSeconds: number,
): string {
  return `SELECT source.value:"objectName"::string AS upstream_object,
    source.value:"columnName"::string AS upstream_column,
    written.value:"objectName"::string AS downstream_object,
    col.value:"columnName"::string AS downstream_column
  FROM SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY h,
    LATERAL FLATTEN(input => h.objects_modified) written,
    LATERAL FLATTEN(input => written.value:"columns") col,
    LATERAL FLATTEN(input => col.value:"baseSources") source
  WHERE h.query_start_time > DATEADD('second', -${Math.floor(lookbackInSeconds)}, CURRENT_TIMESTAMP())
    AND written.value:"objectDomain"::string = 'Table'
    AND STARTSWITH(UPPER(written.value:"objectName"::string), UPPER(?) || '.')
  GROUP BY 1, 2, 3, 4
  LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`;
}

// An object's three-part name as a lineage row names it: its database only when it is another's.
export function readSnowflakeObjectParts(
  value: unknown,
  storeDatabase: string,
): { database: string; schema: string; table: string } | null {
  const parts: Array<string> = String(value ?? "").split(".");

  if (parts.length !== 3 || parts.some((part: string) => !part)) {
    return null;
  }

  return {
    database:
      parts[0]!.toUpperCase() === storeDatabase.toUpperCase() ? "" : parts[0]!,
    schema: parts[1]!,
    table: parts[2]!,
  };
}

export const SNOWFLAKE_WRITTEN_TABLES_QUERY: string = `SELECT q.query_parameterized_hash AS job_key,
    f.value:"objectName"::string AS object_name
  FROM SNOWFLAKE.ACCOUNT_USAGE.ACCESS_HISTORY h,
    LATERAL FLATTEN(input => h.objects_modified) f,
    SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY q
  WHERE q.query_id = h.query_id
    AND h.query_start_time > DATEADD('hour', -${SPEND_WINDOW_IN_HOURS}, CURRENT_TIMESTAMP())
    AND q.end_time > DATEADD('hour', -${SPEND_WINDOW_IN_HOURS}, CURRENT_TIMESTAMP())
    AND f.value:"objectDomain"::string = 'Table'
    AND UPPER(q.database_name) = UPPER(?)
  GROUP BY 1, 2
  LIMIT 5000`;

// A spend row as a job: named without its query's text.
export function readSpendRow(
  row: Record<string, unknown>,
  written: Array<{ schema: string; table: string }>,
): CollectedJobSpend | null {
  const jobKey: string = String(row["job_key"] ?? "").slice(0, 200);

  if (!jobKey) {
    return null;
  }

  const tag: string | null = row["query_tag"] ? String(row["query_tag"]) : null;
  const user: string | null = row["user_name"]
    ? String(row["user_name"]).slice(0, MAX_SEEN_BY_LENGTH)
    : null;
  const firstWritten: { schema: string; table: string } | undefined =
    written[0];
  const credits: number | null =
    row["credits"] === null || row["credits"] === undefined
      ? null
      : Number(row["credits"]);
  const bytesBilled: number | null = readCount(row["bytes_billed"]);

  return {
    jobKey,
    name: nameJob({
      tag: row["tag"] ? String(row["tag"]) : tag,
      queryType: row["query_type"] ? String(row["query_type"]) : null,
      writtenTable: firstWritten
        ? `${firstWritten.schema}.${firstWritten.table}`
        : null,
      user,
    }),
    user,
    warehouse: row["warehouse_name"]
      ? String(row["warehouse_name"]).slice(0, MAX_IDENTIFIER_LENGTH)
      : null,
    team: row["team"]
      ? String(row["team"]).slice(0, MAX_IDENTIFIER_LENGTH)
      : readTeamOfTag(tag),
    runs: readCount(row["runs"]) || 0,
    failedRuns: readCount(row["failed_runs"]) || 0,
    credits:
      credits !== null && Number.isFinite(credits) && credits >= 0
        ? credits
        : null,
    bytesBilled,
    writtenTables: written.slice(0, MAX_WRITTEN_TABLES_PER_JOB),
    secondsSinceLastRun: readCount(row["seconds_since_last_run"]),
  };
}

/*
 * BigQuery's spend over the last day, a job (a query, its literals left
 * out) a row: its runs, failures and bytes billed from the jobs view of
 * the dataset's project and location, for jobs that wrote or read a table
 * of the dataset; null when the location cannot be named.
 */
export function buildBigQuerySpendQuery(
  connection: Pick<BigQueryConnection, "projectId" | "dataset" | "location">,
): { statement: string; params: Array<string> } | null {
  const location: string = (connection.location || "US").toLowerCase();

  if (!BIGQUERY_LOCATION.test(location)) {
    return null;
  }

  return {
    statement: `SELECT COALESCE(j.query_info.query_hashes.normalized_literals, j.job_id) AS job_key,
        ANY_VALUE((SELECT l.value FROM UNNEST(j.labels) AS l WHERE l.key = 'team' LIMIT 1)) AS team,
        ANY_VALUE((SELECT l.value FROM UNNEST(j.labels) AS l WHERE l.key = 'job' LIMIT 1)) AS tag,
        ANY_VALUE(j.statement_type) AS query_type,
        ANY_VALUE(j.user_email) AS user_name,
        ANY_VALUE(j.reservation_id) AS warehouse_name,
        COUNT(*) AS runs,
        COUNTIF(j.error_result IS NOT NULL) AS failed_runs,
        SUM(j.total_bytes_billed) AS bytes_billed,
        ANY_VALUE(IF(j.destination_table.dataset_id = ?, j.destination_table.table_id, NULL)) AS written_table,
        TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(j.end_time), SECOND) AS seconds_since_last_run
      FROM \`${connection.projectId}\`.\`region-${location}\`.INFORMATION_SCHEMA.JOBS AS j
      WHERE j.creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${SPEND_WINDOW_IN_HOURS + 6} HOUR)
        AND j.end_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${SPEND_WINDOW_IN_HOURS} HOUR)
        AND j.job_type = 'QUERY'
        AND j.statement_type != 'SCRIPT'
        AND (j.destination_table.dataset_id = ?
          OR EXISTS(SELECT 1 FROM UNNEST(j.referenced_tables) AS r WHERE r.project_id = ? AND r.dataset_id = ?))
      GROUP BY 1
      ORDER BY bytes_billed DESC
      LIMIT ${MAX_SPEND_JOBS}`,
    params: [
      connection.dataset,
      connection.dataset,
      connection.projectId,
      connection.dataset,
    ],
  };
}

/*
 * The query that reads a dataset's lineage from the jobs view of its
 * project and location: each query job of the window that wrote a table of
 * the dataset, with the tables it read; null when no lineage is read this
 * time, or the location is not one a region can be named by. Only the
 * project and dataset are values; the rest is checked before it is used.
 */
export function buildBigQueryLineageQuery(
  connection: Pick<BigQueryConnection, "projectId" | "dataset" | "location">,
  lookbackInSeconds: number,
): { statement: string; params: Array<string> } | null {
  const location: string = (connection.location || "US").toLowerCase();

  if (
    lookbackInSeconds <= 0 ||
    !Number.isInteger(lookbackInSeconds) ||
    !BIGQUERY_LOCATION.test(location)
  ) {
    return null;
  }

  return {
    statement: `SELECT ref.project_id AS upstream_database, ref.dataset_id AS upstream_schema,
            ref.table_id AS upstream_table,
            j.destination_table.dataset_id AS downstream_schema,
            j.destination_table.table_id AS downstream_table,
            TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(j.end_time), SECOND) AS seconds_since_seen,
            ARRAY_AGG(j.user_email IGNORE NULLS ORDER BY j.end_time DESC LIMIT 1)[SAFE_OFFSET(0)] AS seen_by
          FROM \`${connection.projectId}\`.\`region-${location}\`.INFORMATION_SCHEMA.JOBS AS j,
            UNNEST(j.referenced_tables) AS ref
          WHERE j.creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${lookbackInSeconds + BIGQUERY_LONGEST_JOB_IN_SECONDS} SECOND)
            AND j.end_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${lookbackInSeconds} SECOND)
            AND j.job_type = 'QUERY'
            AND j.state = 'DONE'
            AND j.error_result IS NULL
            AND j.destination_table.project_id = ?
            AND j.destination_table.dataset_id = ?
            AND NOT STARTS_WITH(ref.dataset_id, '_')
            AND NOT (ref.project_id = j.destination_table.project_id
              AND ref.dataset_id = j.destination_table.dataset_id
              AND ref.table_id = j.destination_table.table_id)
          GROUP BY 1, 2, 3, 4, 5
          ORDER BY seconds_since_seen
          LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`,
    params: [connection.projectId, connection.dataset],
  };
}

// A __TABLES__ type, as a data asset kind: 1 a table, 2 a view.
export function readBigQueryKind(type: unknown): DataAssetKind | null {
  switch (String(type ?? "")) {
    case "1":
      return DataAssetKind.Table;
    case "2":
      return DataAssetKind.View;
    default:
      return null;
  }
}

/*
 * Google BigQuery, a dataset at a time (BigQueryApi): __TABLES__ gives each
 * table and view with its rows, bytes and last change; the dataset's
 * INFORMATION_SCHEMA.COLUMNS its columns. A data check runs as a query job
 * of the dataset's project, its names in backticks and its values bound by
 * position.
 */
class BigQueryCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "bigquery";
  private readonly api: BigQueryApi;
  private readonly connection: BigQueryConnection;

  private constructor(api: BigQueryApi, connection: BigQueryConnection) {
    this.api = api;
    this.connection = connection;
  }

  public static async open(connectionString: string): Promise<BigQueryCatalog> {
    const connection: BigQueryConnection =
      readBigQueryConnection(connectionString);

    return new BigQueryCatalog(new BigQueryApi({ connection }), connection);
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
    limits?: DataCheckLimits | undefined,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      return await this.api.query({
        statement: sql,
        params,
        maximumBytesBilled: limits?.maxBytesScanned,
      });
    } catch (error) {
      if (
        limits?.maxBytesScanned &&
        BYTES_BILLED_LIMIT_PATTERN.test(describeError(error))
      ) {
        throw new Error(describeScanLimit(limits.maxBytesScanned));
      }

      throw error;
    }
  }

  private datasetReference(): string {
    return `\`${this.connection.projectId}\`.\`${this.connection.dataset}\``;
  }

  /*
   * A query job that read one table and wrote another of this dataset, from
   * the jobs view of the dataset's project and location (its referenced
   * and destination tables): a scheduled query, a dbt model, a MERGE. Jobs
   * run in another project are in that project's view, not this one's.
   * The view is partitioned by creation time, so only the hours read are
   * billed (BigQuery's 10 MB minimum, mostly); the service account needs
   * BigQuery Resource Viewer (bigquery.jobs.listAll) to see every user's.
   */
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    const query: { statement: string; params: Array<string> } | null =
      buildBigQueryLineageQuery(this.connection, readLookback(options));

    if (!query) {
      return NO_LINEAGE;
    }

    try {
      const rows: Array<Record<string, unknown>> = await this.api.query(query);

      return {
        edges: readLineageRows(rows, DataAssetLineageSource.QueryHistory),
        isViewLineageComplete: false,
        warnings: [],
      };
    } catch (error) {
      return {
        ...NO_LINEAGE,
        warnings: [
          `Lineage from query history was left out (INFORMATION_SCHEMA.JOBS needs the BigQuery Resource Viewer role): ${describeError(error).slice(0, 200)}`,
        ],
      };
    }
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    const dataset: string = this.connection.dataset;
    const tables: Array<RawTable> = [];

    for (const row of await this.api.query({
      statement: `SELECT table_id, type, row_count, size_bytes,
          TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), TIMESTAMP_MILLIS(last_modified_time), SECOND) AS seconds_since_change
        FROM ${this.datasetReference()}.__TABLES__
        ORDER BY table_id
        LIMIT ${options.maxTables}`,
    })) {
      const kind: DataAssetKind | null = readBigQueryKind(row["type"]);
      const name: string = readText(row["table_id"], MAX_IDENTIFIER_LENGTH);

      if (!kind || !name) {
        continue;
      }

      const isTable: boolean = kind === DataAssetKind.Table;

      tables.push({
        schema: dataset,
        name,
        kind,
        estimatedRows: isTable ? readCount(row["row_count"]) : null,
        sizeInBytes: isTable ? readCount(row["size_bytes"]) : null,
        writeCount: null,
        secondsSinceChange: isTable
          ? readCount(row["seconds_since_change"])
          : null,
        readCount: null,
        secondsSinceRead: null,
      });
    }

    let columns: Array<RawColumn> = [];

    try {
      columns = (
        await this.api.query({
          statement: `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
            FROM ${this.datasetReference()}.INFORMATION_SCHEMA.COLUMNS
            ORDER BY table_name, ordinal_position
            LIMIT ${options.maxColumns}`,
        })
      )
        .map((row: Record<string, unknown>): RawColumn | null => {
          return readColumnRow({ ...row, table_schema: dataset });
        })
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        });
    } catch (error) {
      warnings.push(
        `Columns were left out (INFORMATION_SCHEMA.COLUMNS could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    return {
      tables,
      columns,
      warnings,
      secondsSinceStatsReset: null,
    };
  }

  /*
   * Once an hour: each job of the last day that wrote or read a table of
   * the dataset, with its runs, failures and bytes billed, from the jobs
   * view (BigQuery Resource Viewer sees every user's).
   */
  public async readSpend(
    options: TableHealthCollectOptions,
  ): Promise<SpendRead> {
    const query: { statement: string; params: Array<string> } | null =
      readLookback(options) > 0
        ? buildBigQuerySpendQuery(this.connection)
        : null;

    if (!query) {
      return NO_SPEND;
    }

    try {
      const rows: Array<Record<string, unknown>> = await this.api.query(query);

      return {
        jobs: rows
          .map((row: Record<string, unknown>): CollectedJobSpend | null => {
            const table: string = String(row["written_table"] ?? "");

            return readSpendRow(
              row,
              table ? [{ schema: this.connection.dataset, table }] : [],
            );
          })
          .filter((job: CollectedJobSpend | null): job is CollectedJobSpend => {
            return job !== null;
          }),
        warnings: [],
        isRead: true,
      };
    } catch (error) {
      return {
        ...NO_SPEND,
        warnings: [
          `Warehouse spend was left out (INFORMATION_SCHEMA.JOBS needs the BigQuery Resource Viewer role): ${describeError(error).slice(0, 200)}`,
        ],
      };
    }
  }

  public async close(): Promise<void> {
    // Each query is its own request: nothing is held open.
  }
}

// The server's own databases: never a store's tables.
const CLICKHOUSE_SYSTEM_DATABASES: string = `('system', 'INFORMATION_SCHEMA', 'information_schema')`;

// Table engines whose rows live somewhere else: a foreign table, read through.
const CLICKHOUSE_FOREIGN_ENGINES: ReadonlySet<string> = new Set([
  "MySQL",
  "PostgreSQL",
  "MaterializedPostgreSQL",
  "MongoDB",
  "Redis",
  "SQLite",
  "JDBC",
  "ODBC",
  "S3",
  "S3Queue",
  "URL",
  "HDFS",
  "AzureBlobStorage",
  "AzureQueue",
  "Kafka",
  "RabbitMQ",
  "NATS",
  "Iceberg",
  "IcebergS3",
  "IcebergAzure",
  "IcebergHDFS",
  "IcebergLocal",
  "DeltaLake",
  "DeltaLakeS3",
  "DeltaLakeAzure",
  "Hudi",
  "Hive",
]);

// A system.tables row's kind; a materialized view's inner table and a dictionary are no asset.
export function readClickHouseKind(
  engine: unknown,
  name: unknown,
): DataAssetKind | null {
  const tableEngine: string = String(engine ?? "");

  if (String(name ?? "").startsWith(".inner") || tableEngine === "Dictionary") {
    return null;
  }

  if (tableEngine === "View" || tableEngine === "LiveView") {
    return DataAssetKind.View;
  }

  if (tableEngine === "MaterializedView") {
    return DataAssetKind.MaterializedView;
  }

  return CLICKHOUSE_FOREIGN_ENGINES.has(tableEngine)
    ? DataAssetKind.ForeignTable
    : DataAssetKind.Table;
}

// One part of a ClickHouse name as a statement writes it: bare, or in backticks or double quotes.
const CLICKHOUSE_NAME_PART: string =
  '(?:`(?:[^`\\\\]|\\\\.)+`|"(?:[^"\\\\]|\\\\.)+"|[A-Za-z_][A-Za-z0-9_$]*)';
const CLICKHOUSE_INSERT_TARGET: RegExp = new RegExp(
  `^\\s*INSERT\\s+INTO\\s+(?:TABLE\\s+)?(${CLICKHOUSE_NAME_PART}(?:\\s*\\.\\s*${CLICKHOUSE_NAME_PART})?)`,
  "i",
);
const CLICKHOUSE_VIEW_TARGET: RegExp = new RegExp(
  `^\\s*CREATE\\s+MATERIALIZED\\s+VIEW\\s+${CLICKHOUSE_NAME_PART}(?:\\s*\\.\\s*${CLICKHOUSE_NAME_PART})?(?:\\s+ON\\s+CLUSTER\\s+\\S+)?\\s+TO\\s+(${CLICKHOUSE_NAME_PART}(?:\\s*\\.\\s*${CLICKHOUSE_NAME_PART})?)`,
  "i",
);

function unquoteClickHouseName(part: string): string {
  const trimmed: string = part.trim();

  if (
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
  }

  return trimmed;
}

// "db.table", "`db`.`table`" or "table" (in the database a query ran in), as its two parts.
export function readClickHouseName(
  value: string,
  currentDatabase: string,
): { schema: string; table: string } | null {
  const parts: Array<string> =
    value.match(new RegExp(CLICKHOUSE_NAME_PART, "g")) || [];

  if (parts.length === 1) {
    return currentDatabase
      ? { schema: currentDatabase, table: unquoteClickHouseName(parts[0]!) }
      : null;
  }

  if (parts.length === 2) {
    return {
      schema: unquoteClickHouseName(parts[0]!),
      table: unquoteClickHouseName(parts[1]!),
    };
  }

  return null;
}

// The table an INSERT wrote: INSERT INTO [TABLE] db.table ...
export function readInsertTarget(
  query: string,
  currentDatabase: string,
): { schema: string; table: string } | null {
  const match: RegExpMatchArray | null = query.match(CLICKHOUSE_INSERT_TARGET);

  return match ? readClickHouseName(match[1]!, currentDatabase) : null;
}

// The table a materialized view writes to: CREATE MATERIALIZED VIEW db.view TO db.table ...
export function readMaterializedViewTarget(
  definition: string,
  viewDatabase: string,
): { schema: string; table: string } | null {
  const match: RegExpMatchArray | null = definition.match(
    CLICKHOUSE_VIEW_TARGET,
  );

  return match ? readClickHouseName(match[1]!, viewDatabase) : null;
}

/*
 * The query log's INSERTs that read other tables, as lineage: each query
 * (one row per normalized query) wrote the table its INSERT names, and
 * read every other table it touched. "tables" holds db.table names.
 */
export function readClickHouseInsertLineage(
  rows: Array<Record<string, unknown>>,
): Array<CollectedLineageEdge> {
  const edges: Array<CollectedLineageEdge> = [];

  for (const row of rows) {
    const target: { schema: string; table: string } | null = readInsertTarget(
      String(row["query_text"] ?? ""),
      String(row["current_database"] ?? ""),
    );

    if (!target) {
      continue;
    }

    const tables: Array<unknown> = Array.isArray(row["tables"])
      ? (row["tables"] as Array<unknown>)
      : [];

    for (const name of tables) {
      const text: string = String(name ?? "");
      const dot: number = text.indexOf(".");

      if (dot <= 0) {
        continue;
      }

      const edge: CollectedLineageEdge | null = readLineageRow(
        {
          upstream_schema: text.slice(0, dot),
          upstream_table: text.slice(dot + 1),
          downstream_schema: target.schema,
          downstream_table: target.table,
          seconds_since_seen: row["seconds_since_seen"],
          seen_by: row["seen_by"],
        },
        DataAssetLineageSource.QueryHistory,
      );

      if (edge) {
        edges.push(edge);
      }
    }
  }

  return edges.slice(0, MAX_LINEAGE_EDGES_PER_COLLECTION);
}

/*
 * ClickHouse, over its HTTP interface (ClickHouseHttpApi): system.tables
 * gives every table and view with its rows and bytes; system.parts each
 * MergeTree table's block numbers, which only an insert moves (a merge
 * keeps them), so their sum is the table's write counter; system.part_log,
 * where the server keeps it, the time of each insert; system.columns the
 * columns. The query log, once an hour, says which tables were read, and
 * which INSERT ... SELECT read one table to write another; a materialized
 * view's source tables and its TO table are lineage from its definition.
 * Names are quoted with backticks and values bound as query parameters.
 */
class ClickHouseCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "clickhouse";
  private readonly api: ClickHouseHttpApi;
  private readonly database: string | null;

  private constructor(api: ClickHouseHttpApi, database: string | null) {
    this.api = api;
    this.database = database;
  }

  public static async open(
    connectionString: string,
  ): Promise<ClickHouseCatalog> {
    const connection: ClickHouseConnection =
      readClickHouseConnection(connectionString);
    const session: ClickHouseCatalog = new ClickHouseCatalog(
      new ClickHouseHttpApi({ connection }),
      connection.database,
    );

    // A login that cannot read the server's catalog cannot collect.
    await session.api.query({ statement: "SELECT 1 AS reachable" });

    return session;
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.api.query({ statement: sql, params });
  }

  // The databases read: the connection's one, or every one but the server's own.
  private databaseFilter(column: string): {
    sql: string;
    params: Array<string>;
  } {
    return this.database
      ? { sql: `${column} = {p1:String}`, params: [this.database] }
      : { sql: `${column} NOT IN ${CLICKHOUSE_SYSTEM_DATABASES}`, params: [] };
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    const filter: { sql: string; params: Array<string> } =
      this.databaseFilter("t.database");
    const tablesSql: (withParts: boolean) => string = (
      withParts: boolean,
    ): string => {
      return `SELECT t.database AS table_schema, t.name AS table_name, t.engine AS engine,
          t.total_rows AS total_rows, t.total_bytes AS total_bytes
          ${withParts ? ", p.table AS parts_table, p.write_count AS write_count" : ""}
        FROM system.tables AS t
        ${
          withParts
            ? `LEFT JOIN (
            SELECT database, table, sum(partition_max) AS write_count
            FROM (
              SELECT database, table, partition_id, max(max_block_number) AS partition_max
              FROM system.parts
              WHERE active
              GROUP BY database, table, partition_id
            )
            GROUP BY database, table
          ) AS p ON p.database = t.database AND p.table = t.name`
            : ""
        }
        WHERE ${filter.sql} AND t.is_temporary = 0
        ORDER BY t.database, t.name
        LIMIT ${options.maxTables}`;
    };
    let rows: Array<Record<string, unknown>>;

    try {
      rows = await this.api.query({
        statement: tablesSql(true),
        params: filter.params,
      });
    } catch (error) {
      rows = await this.api.query({
        statement: tablesSql(false),
        params: filter.params,
      });
      warnings.push(
        `Inserts are seen by a table's rows alone (system.parts could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    const insertedAgo: Map<string, number> = new Map();

    // When the server keeps a part log, the time of each table's last insert.
    try {
      const partLogFilter: { sql: string; params: Array<string> } =
        this.databaseFilter("database");

      for (const row of await this.api.query({
        statement: `SELECT database AS table_schema, table AS table_name,
            dateDiff('second', max(event_time), now()) AS seconds_since_change
          FROM system.part_log
          WHERE event_date >= yesterday() AND event_type = 'NewPart' AND ${partLogFilter.sql}
          GROUP BY database, table`,
        params: partLogFilter.params,
      })) {
        const seconds: number | null = readCount(row["seconds_since_change"]);

        if (seconds !== null) {
          insertedAgo.set(
            keyOf(
              String(row["table_schema"] ?? ""),
              String(row["table_name"] ?? ""),
            ),
            seconds,
          );
        }
      }
    } catch {
      // Most servers keep no part log: the write counter says when a table changed.
    }

    const readAgo: Map<string, number> = await this.readTimes(
      options,
      warnings,
    );
    const tables: Array<RawTable> = [];

    for (const row of rows) {
      const schema: string = readText(
        row["table_schema"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);
      const kind: DataAssetKind | null = readClickHouseKind(
        row["engine"],
        name,
      );

      if (!kind || !schema || !name) {
        continue;
      }

      const key: string = keyOf(schema, name);
      const hasParts: boolean =
        readText(row["parts_table"], MAX_IDENTIFIER_LENGTH).length > 0;
      const holdsRows: boolean =
        kind === DataAssetKind.Table || kind === DataAssetKind.MaterializedView;

      tables.push({
        schema,
        name,
        kind,
        estimatedRows: holdsRows ? readCount(row["total_rows"]) : null,
        sizeInBytes: holdsRows ? readCount(row["total_bytes"]) : null,
        writeCount: hasParts ? readCount(row["write_count"]) : null,
        secondsSinceChange: insertedAgo.get(key) ?? null,
        readCount: null,
        secondsSinceRead: readAgo.get(key) ?? null,
      });
    }

    let columns: Array<RawColumn> = [];

    try {
      const columnFilter: { sql: string; params: Array<string> } =
        this.databaseFilter("database");

      columns = (
        await this.api.query({
          statement: `SELECT database AS table_schema, table AS table_name, name AS column_name,
              type AS data_type, position AS ordinal_position,
              if(startsWith(type, 'Nullable(') OR startsWith(type, 'LowCardinality(Nullable('), 'YES', 'NO') AS is_nullable
            FROM system.columns
            WHERE ${columnFilter.sql}
            ORDER BY database, table, position
            LIMIT ${options.maxColumns}`,
          params: columnFilter.params,
        })
      )
        .map((row: Record<string, unknown>): RawColumn | null => {
          return readColumnRow(row);
        })
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        });
    } catch (error) {
      warnings.push(
        `Columns were left out (system.columns could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    return { tables, columns, warnings, secondsSinceStatsReset: null };
  }

  /*
   * How long ago each table was last read, from the query log: only when
   * this collection reads query history (once an hour), back to the last
   * read, and never OneUptime's own reads.
   */
  private async readTimes(
    options: TableHealthCollectOptions,
    warnings: Array<string>,
  ): Promise<Map<string, number>> {
    const lookback: number = readLookback(options);
    const times: Map<string, number> = new Map();

    if (lookback <= 0) {
      return times;
    }

    try {
      for (const row of await this.api.query({
        statement: `SELECT full_name, dateDiff('second', max(event_time), now()) AS seconds_since_read
          FROM system.query_log
          ARRAY JOIN tables AS full_name
          WHERE event_date >= toDate(now() - INTERVAL ${lookback} SECOND)
            AND event_time > now() - INTERVAL ${lookback} SECOND
            AND type = 'QueryFinish' AND query_kind = 'Select' AND user != currentUser()
          GROUP BY full_name
          LIMIT ${MAX_TABLES_PER_COLLECTION * 2}`,
      })) {
        const name: string = String(row["full_name"] ?? "");
        const dot: number = name.indexOf(".");
        const seconds: number | null = readCount(row["seconds_since_read"]);

        if (dot > 0 && seconds !== null) {
          times.set(keyOf(name.slice(0, dot), name.slice(dot + 1)), seconds);
        }
      }
    } catch (error) {
      warnings.push(
        `When each table was last read was left out (system.query_log could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    return times;
  }

  /*
   * A materialized view's lineage from its definition - every table it
   * reads (their dependencies_table) feeds it, and it feeds its TO table -
   * read every collection; INSERT ... SELECT from the query log once an
   * hour.
   */
  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    const views: LineageRead = await readViewLineage(
      async (): Promise<Array<Record<string, unknown>>> => {
        const filter: { sql: string; params: Array<string> } =
          this.databaseFilter("database");
        const edges: Array<Record<string, unknown>> = [];

        for (const row of await this.api.query({
          statement: `SELECT database, name, dependencies_database, dependencies_table
            FROM system.tables
            WHERE ${filter.sql} AND length(dependencies_table) > 0
            LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`,
          params: filter.params,
        })) {
          const databases: Array<unknown> = Array.isArray(
            row["dependencies_database"],
          )
            ? (row["dependencies_database"] as Array<unknown>)
            : [];
          const dependents: Array<unknown> = Array.isArray(
            row["dependencies_table"],
          )
            ? (row["dependencies_table"] as Array<unknown>)
            : [];

          dependents.forEach((dependent: unknown, index: number) => {
            edges.push({
              upstream_schema: row["database"],
              upstream_table: row["name"],
              downstream_schema: databases[index] ?? row["database"],
              downstream_table: dependent,
            });
          });
        }

        for (const row of await this.api.query({
          statement: `SELECT database, name, substring(create_table_query, 1, 4000) AS definition
            FROM system.tables
            WHERE ${filter.sql} AND engine = 'MaterializedView'
            LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`,
          params: filter.params,
        })) {
          const target: { schema: string; table: string } | null =
            readMaterializedViewTarget(
              String(row["definition"] ?? ""),
              String(row["database"] ?? ""),
            );

          if (target) {
            edges.push({
              upstream_schema: row["database"],
              upstream_table: row["name"],
              downstream_schema: target.schema,
              downstream_table: target.table,
            });
          }
        }

        return edges;
      },
    );
    const lookback: number = readLookback(options);

    if (lookback <= 0) {
      return views;
    }

    try {
      const rows: Array<Record<string, unknown>> = await this.api.query({
        statement: `SELECT any(substring(query, 1, 2000)) AS query_text, any(tables) AS tables,
            any(current_database) AS current_database, argMax(user, event_time) AS seen_by,
            dateDiff('second', max(event_time), now()) AS seconds_since_seen
          FROM system.query_log
          WHERE event_date >= toDate(now() - INTERVAL ${lookback} SECOND)
            AND event_time > now() - INTERVAL ${lookback} SECOND
            AND type = 'QueryFinish' AND query_kind = 'Insert' AND length(tables) > 1
          GROUP BY normalized_query_hash
          ORDER BY seconds_since_seen
          LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`,
      });

      return {
        ...views,
        edges: [...views.edges, ...readClickHouseInsertLineage(rows)],
      };
    } catch (error) {
      return {
        ...views,
        warnings: [
          ...views.warnings,
          `Lineage from query history was left out (system.query_log could not be read): ${describeError(error).slice(0, 200)}`,
        ],
      };
    }
  }

  public async close(): Promise<void> {
    // Each statement is its own request: nothing is held open.
  }
}

// A Unity Catalog table type, as a data asset kind.
export function readDatabricksKind(tableType: unknown): DataAssetKind | null {
  switch (String(tableType ?? "").toUpperCase()) {
    case "VIEW":
    case "METRIC_VIEW":
      return DataAssetKind.View;
    case "MATERIALIZED_VIEW":
      return DataAssetKind.MaterializedView;
    case "FOREIGN":
      return DataAssetKind.ForeignTable;
    case "":
      return null;
    default:
      // MANAGED, EXTERNAL, STREAMING_TABLE and the shallow clones hold rows.
      return DataAssetKind.Table;
  }
}

/*
 * A Unity Catalog TableInfo as a table and its columns. Delta's last
 * commit (delta.lastCommitTimestamp, delta.lastUpdateVersion) says when the
 * table changed; the statistics ANALYZE keeps say its rows and size. A
 * view's dependencies are lineage from its definition.
 */
export function readDatabricksTable(
  info: JSONObject,
  now: Date,
): {
  table: RawTable;
  columns: Array<RawColumn>;
  viewSources: Array<{ database: string; schema: string; table: string }>;
} | null {
  const schema: string = readText(info["schema_name"], MAX_IDENTIFIER_LENGTH);
  const name: string = readText(info["name"], MAX_IDENTIFIER_LENGTH);
  const kind: DataAssetKind | null = readDatabricksKind(info["table_type"]);

  if (!schema || !name || !kind) {
    return null;
  }

  const properties: JSONObject =
    info["properties"] && typeof info["properties"] === "object"
      ? (info["properties"] as JSONObject)
      : {};
  const lastCommitAt: number | null = readCount(
    properties["delta.lastCommitTimestamp"],
  );
  const holdsRows: boolean = kind !== DataAssetKind.View;
  const columns: Array<RawColumn> = (
    Array.isArray(info["columns"]) ? (info["columns"] as Array<unknown>) : []
  )
    .map((value: unknown, index: number): RawColumn | null => {
      const column: JSONObject =
        value && typeof value === "object" ? (value as JSONObject) : {};
      const columnName: string = readText(
        column["name"],
        MAX_COLUMN_NAME_LENGTH,
      );
      const position: number | null = readCount(column["position"]);

      return columnName
        ? {
            schema,
            table: name,
            column: {
              name: columnName,
              dataType: readText(
                column["type_text"] ?? column["type_name"],
                MAX_COLUMN_TYPE_LENGTH,
              )
                .trim()
                .toLowerCase(),
              isNullable: column["nullable"] !== false,
              // Unity Catalog counts from 0.
              position: (position ?? index) + 1,
            },
          }
        : null;
    })
    .filter((column: RawColumn | null): column is RawColumn => {
      return column !== null;
    });
  const dependencies: Array<unknown> = Array.isArray(
    (info["view_dependencies"] as JSONObject | undefined)?.["dependencies"],
  )
    ? ((info["view_dependencies"] as JSONObject)[
        "dependencies"
      ] as Array<unknown>)
    : [];
  const viewSources: Array<{
    database: string;
    schema: string;
    table: string;
  }> = [];

  for (const dependency of dependencies) {
    const fullName: string = String(
      (
        (dependency as JSONObject | null)?.["table"] as JSONObject | undefined
      )?.["table_full_name"] ?? "",
    );
    const parts: Array<string> = fullName.split(".");

    if (parts.length === 3 && parts.every(Boolean)) {
      viewSources.push({
        database: parts[0]!,
        schema: parts[1]!,
        table: parts[2]!,
      });
    }
  }

  return {
    table: {
      schema,
      name,
      kind,
      estimatedRows: holdsRows
        ? readCount(properties["spark.sql.statistics.numRows"])
        : null,
      sizeInBytes: holdsRows
        ? readCount(properties["spark.sql.statistics.totalSize"])
        : null,
      writeCount: holdsRows
        ? readCount(properties["delta.lastUpdateVersion"])
        : null,
      secondsSinceChange:
        holdsRows && lastCommitAt !== null
          ? Math.max(0, Math.floor((now.getTime() - lastCommitAt) / 1000))
          : null,
      readCount: null,
      secondsSinceRead: null,
    },
    columns,
    viewSources,
  };
}

/*
 * The table lineage system table's rows for a catalog, read three ways:
 * a row with both tables, the downstream one the catalog's, is an edge; a
 * row writing a table of the catalog says when it was last written; a row
 * reading one says when it was last read.
 */
export function readDatabricksLineageRows(
  rows: Array<Record<string, unknown>>,
  catalog: string,
): {
  edges: Array<CollectedLineageEdge>;
  writtenAgo: Map<string, number>;
  readAgo: Map<string, number>;
} {
  const edges: Array<CollectedLineageEdge> = [];
  const writtenAgo: Map<string, number> = new Map();
  const readAgo: Map<string, number> = new Map();
  const keep: (
    map: Map<string, number>,
    key: string,
    seconds: number,
  ) => void = (
    map: Map<string, number>,
    key: string,
    seconds: number,
  ): void => {
    const known: number | undefined = map.get(key);

    if (known === undefined || seconds < known) {
      map.set(key, seconds);
    }
  };
  const sameCatalog: (value: unknown) => boolean = (
    value: unknown,
  ): boolean => {
    return String(value ?? "").toLowerCase() === catalog.toLowerCase();
  };

  for (const row of rows) {
    const seconds: number | null = readCount(row["seconds_since_seen"]);
    const sourceTable: string = String(row["source_table"] ?? "");
    const targetTable: string = String(row["target_table"] ?? "");

    if (seconds === null) {
      continue;
    }

    if (sourceTable && sameCatalog(row["source_catalog"])) {
      keep(
        readAgo,
        keyOf(String(row["source_schema"] ?? ""), sourceTable),
        seconds,
      );
    }

    if (!targetTable || !sameCatalog(row["target_catalog"])) {
      continue;
    }

    keep(
      writtenAgo,
      keyOf(String(row["target_schema"] ?? ""), targetTable),
      seconds,
    );

    if (!sourceTable) {
      continue;
    }

    const edge: CollectedLineageEdge | null = readLineageRow(
      {
        upstream_database: sameCatalog(row["source_catalog"])
          ? null
          : row["source_catalog"],
        upstream_schema: row["source_schema"],
        upstream_table: sourceTable,
        downstream_schema: row["target_schema"],
        downstream_table: targetTable,
        seconds_since_seen: seconds,
        seen_by: row["seen_by"],
      },
      DataAssetLineageSource.QueryHistory,
    );

    if (edge && edges.length < MAX_LINEAGE_EDGES_PER_COLLECTION) {
      edges.push(edge);
    }
  }

  return { edges, writtenAgo, readAgo };
}

/*
 * The table lineage query: every row of the window with a table of the
 * catalog at either end, one per pair of tables, OneUptime's own reads
 * left out. Only the catalog is a value; the window is a whole number.
 */
export function buildDatabricksLineageQuery(lookbackInSeconds: number): string {
  const days: number = Math.ceil(lookbackInSeconds / 86_400) + 1;

  return `SELECT source_table_catalog AS source_catalog, source_table_schema AS source_schema,
      source_table_name AS source_table, target_table_catalog AS target_catalog,
      target_table_schema AS target_schema, target_table_name AS target_table,
      CAST(unix_timestamp(current_timestamp()) - unix_timestamp(MAX(event_time)) AS BIGINT) AS seconds_since_seen,
      MAX_BY(created_by, event_time) AS seen_by
    FROM system.access.table_lineage
    WHERE event_date >= DATE_SUB(CURRENT_DATE(), ${days})
      AND event_time > TIMESTAMPADD(SECOND, -${lookbackInSeconds}, CURRENT_TIMESTAMP())
      AND (source_table_catalog = :catalog OR target_table_catalog = :catalog)
      AND created_by <> current_user()
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY seconds_since_seen
    LIMIT ${MAX_LINEAGE_EDGES_PER_COLLECTION}`;
}

/*
 * Databricks, a Unity Catalog catalog at a time (DatabricksApi): its
 * schemas, tables, views and columns from Unity Catalog's REST API, with
 * no SQL warehouse - so a collection costs no compute - and each Delta
 * table's last commit from its properties. Once an hour, on the
 * connection's SQL warehouse, the table lineage system table says which
 * tables fed which, when a table was last written where its properties do
 * not say, and when each was last read. A data check runs on the
 * warehouse too, its names in backticks and its values bound by name.
 */
class DatabricksCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "databricks";
  private readonly api: DatabricksApi;
  private viewEdges: Array<CollectedLineageEdge> = [];
  private historyEdges: Array<CollectedLineageEdge> = [];
  private isCatalogComplete: boolean = false;
  private lineageWarnings: Array<string> = [];

  private constructor(api: DatabricksApi) {
    this.api = api;
  }

  public static async open(
    connectionString: string,
  ): Promise<DatabricksCatalog> {
    const session: DatabricksCatalog = new DatabricksCatalog(
      new DatabricksApi({
        connection: readDatabricksConnection(connectionString),
      }),
    );

    await session.api.getCatalog();

    return session;
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.api.query({ statement: sql, params });
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    const now: Date = new Date();
    const tables: Array<RawTable> = [];
    const columns: Array<RawColumn> = [];
    const schemas: Array<string> = (await this.api.listSchemas())
      .filter((schema: string) => {
        return schema.toLowerCase() !== "information_schema";
      })
      .sort();
    let isComplete: boolean = true;

    this.viewEdges = [];

    for (const schema of schemas) {
      if (tables.length >= options.maxTables) {
        isComplete = false;
        break;
      }

      let infos: Array<JSONObject>;

      try {
        infos = await this.api.listTables(
          schema,
          options.maxTables - tables.length,
        );
      } catch (error) {
        isComplete = false;
        warnings.push(
          `The tables of ${schema} were left out: ${describeError(error).slice(0, 200)}`,
        );
        continue;
      }

      for (const info of infos) {
        const read: ReturnType<typeof readDatabricksTable> =
          readDatabricksTable(info, now);

        if (!read) {
          continue;
        }

        tables.push(read.table);

        for (const column of read.columns) {
          if (columns.length < options.maxColumns) {
            columns.push(column);
          }
        }

        for (const source of read.viewSources) {
          const edge: CollectedLineageEdge | null = readLineageRow(
            {
              upstream_database:
                source.database.toLowerCase() === this.api.catalog.toLowerCase()
                  ? null
                  : source.database,
              upstream_schema: source.schema,
              upstream_table: source.table,
              downstream_schema: read.table.schema,
              downstream_table: read.table.name,
            },
            DataAssetLineageSource.ViewDefinition,
          );

          if (edge) {
            this.viewEdges.push(edge);
          }
        }
      }
    }

    this.isCatalogComplete = isComplete;
    this.historyEdges = [];
    this.lineageWarnings = [];

    const lookback: number = readLookback(options);

    if (lookback > 0 && !this.api.warehouseId) {
      this.lineageWarnings.push(
        "Lineage from query history, and when each table was last read, need a SQL warehouse in the Databricks connection.",
      );
    } else if (lookback > 0) {
      try {
        const lineage: ReturnType<typeof readDatabricksLineageRows> =
          readDatabricksLineageRows(
            await this.api.query({
              statement: buildDatabricksLineageQuery(lookback),
              namedParams: { catalog: this.api.catalog },
            }),
            this.api.catalog,
          );

        this.historyEdges = lineage.edges;

        for (const table of tables) {
          const key: string = keyOf(table.schema, table.name);
          const written: number | undefined = lineage.writtenAgo.get(key);

          if (table.secondsSinceChange === null && written !== undefined) {
            table.secondsSinceChange = written;
          }

          table.secondsSinceRead = lineage.readAgo.get(key) ?? null;
        }
      } catch (error) {
        this.lineageWarnings.push(
          `Lineage from query history was left out (system.access.table_lineage needs SELECT on the system.access schema): ${describeError(error).slice(0, 200)}`,
        );
      }
    }

    return {
      tables: tables.slice(0, options.maxTables),
      columns,
      warnings,
      secondsSinceStatsReset: null,
    };
  }

  // Read with the catalog (read): views' dependencies always, query history once an hour.
  public async readLineage(): Promise<LineageRead> {
    return {
      edges: [...this.viewEdges, ...this.historyEdges].slice(
        0,
        MAX_LINEAGE_EDGES_PER_COLLECTION,
      ),
      isViewLineageComplete: this.isCatalogComplete,
      warnings: this.lineageWarnings,
    };
  }

  public async close(): Promise<void> {
    // Each call is its own request: nothing is held open.
  }
}

// A Glue table's kind: a view, else a table (Iceberg, Hive-style or governed).
export function readGlueKind(tableType: unknown): DataAssetKind {
  return String(tableType ?? "").toUpperCase() === "VIRTUAL_VIEW"
    ? DataAssetKind.View
    : DataAssetKind.Table;
}

/*
 * A Glue table as a table and its columns. An Iceberg table's every commit
 * updates its Glue table (its metadata location), so its UpdateTime is when
 * it last changed; a Hive-style table's is only when its definition did,
 * so it says no change. Rows and size come from the statistics a crawler
 * or ANALYZE keeps.
 */
export function readGlueTable(
  info: JSONObject,
  now: Date,
): { table: RawTable; columns: Array<RawColumn> } | null {
  const name: string = readText(info["Name"], MAX_IDENTIFIER_LENGTH);
  const schema: string = readText(info["DatabaseName"], MAX_IDENTIFIER_LENGTH);

  if (!name || !schema) {
    return null;
  }

  const kind: DataAssetKind = readGlueKind(info["TableType"]);
  const parameters: JSONObject =
    info["Parameters"] && typeof info["Parameters"] === "object"
      ? (info["Parameters"] as JSONObject)
      : {};
  const isIceberg: boolean =
    String(parameters["table_type"] ?? "").toUpperCase() === "ICEBERG" ||
    Boolean(parameters["metadata_location"]);
  const updatedAt: number = Number(info["UpdateTime"]);
  const storage: JSONObject =
    info["StorageDescriptor"] && typeof info["StorageDescriptor"] === "object"
      ? (info["StorageDescriptor"] as JSONObject)
      : {};
  const columns: Array<RawColumn> = [
    ...(Array.isArray(storage["Columns"])
      ? (storage["Columns"] as Array<unknown>)
      : []),
    ...(Array.isArray(info["PartitionKeys"])
      ? (info["PartitionKeys"] as Array<unknown>)
      : []),
  ]
    .map((value: unknown, index: number): RawColumn | null => {
      const column: JSONObject =
        value && typeof value === "object" ? (value as JSONObject) : {};
      const columnName: string = readText(
        column["Name"],
        MAX_COLUMN_NAME_LENGTH,
      );

      return columnName
        ? {
            schema,
            table: name,
            column: {
              name: columnName,
              dataType: readText(column["Type"], MAX_COLUMN_TYPE_LENGTH)
                .trim()
                .toLowerCase(),
              isNullable: true,
              position: index + 1,
            },
          }
        : null;
    })
    .filter((column: RawColumn | null): column is RawColumn => {
      return column !== null;
    });
  const holdsRows: boolean = kind === DataAssetKind.Table;

  return {
    table: {
      schema,
      name,
      kind,
      estimatedRows: holdsRows
        ? readCount(parameters["numRows"] ?? parameters["recordCount"])
        : null,
      sizeInBytes: holdsRows ? readCount(parameters["totalSize"]) : null,
      writeCount: null,
      secondsSinceChange:
        holdsRows && isIceberg && Number.isFinite(updatedAt) && updatedAt > 0
          ? Math.max(0, Math.floor(now.getTime() / 1000 - updatedAt))
          : null,
      readCount: null,
      secondsSinceRead: null,
    },
    columns,
  };
}

/*
 * Amazon Athena, a Glue database at a time (AthenaApi): its tables and
 * views, their columns, statistics and - for Iceberg - last commit, from
 * the Glue Data Catalog's API, which reads no data and costs nothing. A
 * data check runs as an Athena query in the connection's workgroup, its
 * names in double quotes and its values written in as quoted strings.
 */
class AthenaCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "athena";
  private readonly api: AthenaApi;

  private constructor(api: AthenaApi) {
    this.api = api;
  }

  public static async open(connectionString: string): Promise<AthenaCatalog> {
    const session: AthenaCatalog = new AthenaCatalog(
      new AthenaApi({ connection: readAthenaConnection(connectionString) }),
    );

    await session.api.getDatabase();

    return session;
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
    limits?: DataCheckLimits | undefined,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.api.query({
      statement: sql,
      params,
      maxBytesScanned: limits?.maxBytesScanned,
    });
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const now: Date = new Date();
    const tables: Array<RawTable> = [];
    const columns: Array<RawColumn> = [];

    for (const info of await this.api.listTables(options.maxTables)) {
      const read: ReturnType<typeof readGlueTable> = readGlueTable(info, now);

      if (!read) {
        continue;
      }

      tables.push(read.table);

      for (const column of read.columns) {
        if (columns.length < options.maxColumns) {
          columns.push(column);
        }
      }
    }

    return { tables, columns, warnings: [], secondsSinceStatsReset: null };
  }

  public async close(): Promise<void> {
    // Each call is its own request: nothing is held open.
  }
}

// Every key of an Oracle row in lower case: Oracle names columns in upper case.
function lowerKeys(row: Record<string, unknown>): Record<string, unknown> {
  const lowered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    lowered[key.toLowerCase()] = value;
  }

  return lowered;
}

// The schemas Oracle maintains itself: never a store's tables.
const ORACLE_USER_JOIN: (alias: string, column: string) => string = (
  alias: string,
  column: string,
): string => {
  return `JOIN all_users ${alias} ON ${alias}.username = ${column} AND ${alias}.oracle_maintained = 'N'`;
};

/*
 * Oracle Database, over the oracledb driver in its thin mode (no Oracle
 * client to install). ALL_TABLES gives every table the login can see in a
 * schema Oracle does not maintain itself, with its rows from its last
 * statistics; ALL_TAB_MODIFICATIONS its inserts, updates and deletes since
 * then, and when it last changed; DBA_SEGMENTS (or the login's own
 * USER_SEGMENTS) its size; ALL_VIEWS and ALL_MVIEWS the views;
 * ALL_TAB_COLUMNS the columns; ALL_DEPENDENCIES the views' lineage. Every
 * statement runs in a read-only transaction, rolled back after it, bounded
 * by the call timeout.
 */
class OracleCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "oracle";
  private readonly connection: oracledb.Connection;

  private constructor(connection: oracledb.Connection) {
    this.connection = connection;
  }

  public static async open(connectionString: string): Promise<OracleCatalog> {
    const attributes: OracleConnectAttributes =
      readOracleConnection(connectionString);
    const connection: oracledb.Connection = await oracledb.getConnection({
      ...attributes,
      connectTimeout: Math.ceil(CONNECT_TIMEOUT_IN_MS / 1000),
    });

    connection.callTimeout = STATEMENT_TIMEOUT_IN_MS;

    return new OracleCatalog(connection);
  }

  private async rows(
    sql: string,
    binds: Array<string | number> = [],
  ): Promise<Array<Record<string, unknown>>> {
    await this.connection.execute("SET TRANSACTION READ ONLY");

    try {
      const result: oracledb.Result<Record<string, unknown>> =
        await this.connection.execute<Record<string, unknown>>(sql, binds, {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: MAX_COLUMNS_PER_COLLECTION,
        });

      return (result.rows || []).map(lowerKeys);
    } finally {
      await this.connection.rollback();
    }
  }

  public async readAggregate(
    sql: string,
    params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    return await this.rows(sql, params);
  }

  public async readLineage(
    options: TableHealthCollectOptions,
  ): Promise<LineageRead> {
    return await readViewLineage(async () => {
      return await this.rows(
        `SELECT d.referenced_owner AS upstream_schema, d.referenced_name AS upstream_table,
            d.owner AS downstream_schema, d.name AS downstream_table
          FROM all_dependencies d
          ${ORACLE_USER_JOIN("u", "d.owner")}
          WHERE d.type IN ('VIEW', 'MATERIALIZED VIEW')
            AND d.referenced_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
            AND d.referenced_link_name IS NULL
          ORDER BY 3, 4, 1, 2
          FETCH FIRST :1 ROWS ONLY`,
        [Math.min(options.maxTables, MAX_LINEAGE_EDGES_PER_COLLECTION)],
      );
    });
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const warnings: Array<string> = [];
    const materialized: Set<string> = new Set();

    try {
      for (const row of await this.rows(
        `SELECT m.owner AS table_schema, m.mview_name AS table_name
          FROM all_mviews m ${ORACLE_USER_JOIN("u", "m.owner")}`,
      )) {
        materialized.add(
          keyOf(
            String(row["table_schema"] ?? ""),
            String(row["table_name"] ?? ""),
          ),
        );
      }
    } catch (error) {
      warnings.push(
        `Materialized views were read as tables (ALL_MVIEWS could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    const sizes: Map<string, number> = new Map();

    for (const sizeSql of [
      `SELECT owner AS table_schema, segment_name AS table_name, SUM(bytes) AS size_bytes
        FROM dba_segments WHERE segment_type LIKE 'TABLE%' GROUP BY owner, segment_name`,
      `SELECT USER AS table_schema, segment_name AS table_name, SUM(bytes) AS size_bytes
        FROM user_segments WHERE segment_type LIKE 'TABLE%' GROUP BY segment_name`,
    ]) {
      try {
        for (const row of await this.rows(sizeSql)) {
          const size: number | null = readCount(row["size_bytes"]);

          if (size !== null) {
            sizes.set(
              keyOf(
                String(row["table_schema"] ?? ""),
                String(row["table_name"] ?? ""),
              ),
              size,
            );
          }
        }
        break;
      } catch {
        // DBA_SEGMENTS needs SELECT_CATALOG_ROLE: the login's own segments, then none.
      }
    }

    const tables: Array<RawTable> = [];

    for (const row of await this.rows(
      `SELECT t.owner AS table_schema, t.table_name AS table_name, t.num_rows AS num_rows,
          m.inserts + m.updates + m.deletes AS write_count,
          ROUND((SYSDATE - m.timestamp) * 86400) AS seconds_since_change
        FROM all_tables t
        ${ORACLE_USER_JOIN("u", "t.owner")}
        LEFT JOIN all_tab_modifications m ON m.table_owner = t.owner AND m.table_name = t.table_name
          AND m.partition_name IS NULL AND m.subpartition_name IS NULL
        WHERE t.temporary = 'N' AND t.nested = 'NO' AND t.secondary = 'N' AND t.dropped = 'NO'
        ORDER BY t.owner, t.table_name
        FETCH FIRST :1 ROWS ONLY`,
      [options.maxTables],
    )) {
      const schema: string = readText(
        row["table_schema"],
        MAX_IDENTIFIER_LENGTH,
      );
      const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

      if (!schema || !name) {
        continue;
      }

      const key: string = keyOf(schema, name);

      tables.push({
        schema,
        name,
        kind: materialized.has(key)
          ? DataAssetKind.MaterializedView
          : DataAssetKind.Table,
        estimatedRows: readCount(row["num_rows"]),
        sizeInBytes: sizes.get(key) ?? null,
        writeCount: readCount(row["write_count"]),
        secondsSinceChange: readCount(row["seconds_since_change"]),
        readCount: null,
        secondsSinceRead: null,
      });
    }

    try {
      for (const row of await this.rows(
        `SELECT v.owner AS table_schema, v.view_name AS table_name
          FROM all_views v ${ORACLE_USER_JOIN("u", "v.owner")}
          ORDER BY v.owner, v.view_name
          FETCH FIRST :1 ROWS ONLY`,
        [options.maxTables],
      )) {
        const schema: string = readText(
          row["table_schema"],
          MAX_IDENTIFIER_LENGTH,
        );
        const name: string = readText(row["table_name"], MAX_IDENTIFIER_LENGTH);

        if (schema && name) {
          tables.push({
            schema,
            name,
            kind: DataAssetKind.View,
            estimatedRows: null,
            sizeInBytes: null,
            writeCount: null,
            secondsSinceChange: null,
            readCount: null,
            secondsSinceRead: null,
          });
        }
      }
    } catch (error) {
      warnings.push(
        `Views were left out (ALL_VIEWS could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    let columns: Array<RawColumn> = [];

    try {
      columns = (
        await this.rows(
          `SELECT c.owner AS table_schema, c.table_name AS table_name, c.column_name AS column_name,
              c.data_type AS data_type, c.nullable AS is_nullable, c.column_id AS ordinal_position
            FROM all_tab_columns c ${ORACLE_USER_JOIN("u", "c.owner")}
            ORDER BY c.owner, c.table_name, c.column_id
            FETCH FIRST :1 ROWS ONLY`,
          [options.maxColumns],
        )
      )
        .map((row: Record<string, unknown>): RawColumn | null => {
          return readColumnRow(row);
        })
        .filter((column: RawColumn | null): column is RawColumn => {
          return column !== null;
        });
    } catch (error) {
      warnings.push(
        `Columns were left out (ALL_TAB_COLUMNS could not be read): ${describeError(error).slice(0, 200)}`,
      );
    }

    return {
      tables: tables
        .sort((a: RawTable, b: RawTable) => {
          return keyOf(a.schema, a.name).localeCompare(keyOf(b.schema, b.name));
        })
        .slice(0, options.maxTables),
      columns,
      warnings,
      secondsSinceStatsReset: null,
    };
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }
}

// BSON's and JSON Schema's numeric types, one to a column: 1 and 1.5 are both a number.
const MONGO_NUMBER_TYPES: ReadonlySet<string> = new Set([
  "int",
  "long",
  "double",
  "decimal",
  "integer",
  "number",
]);

// What a field of a document store always may be, so never a type of its own.
const MONGO_ABSENT_TYPES: ReadonlySet<string> = new Set([
  "null",
  "missing",
  "undefined",
]);

// Collections read at once, over the client's small pool.
const MONGO_COLLECTION_CONCURRENCY: number = 4;

export interface MongoCollectionInfo {
  name: string;
  // "collection", "view" or "timeseries".
  type: string;
  // Its validator, a view's source and pipeline, a time series' fields; empty when not read.
  options: JSONObject;
}

interface MongoCollectionRead {
  table: RawTable;
  // Null when they could not be read this time: unknown, never all dropped.
  columns: Array<DataAssetColumn> | null;
  viewOn: string | null;
}

function readMongoObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

/*
 * A field's BSON types as a column's type: "string", "number", or
 * "date|string" when its documents disagree. Null and missing are left out:
 * any field of a document may be either.
 */
export function readMongoFieldType(types: Array<unknown>): string {
  const names: Set<string> = new Set();

  for (const type of types) {
    const name: string = String(type ?? "")
      .trim()
      .toLowerCase();

    if (name && !MONGO_ABSENT_TYPES.has(name)) {
      names.add(MONGO_NUMBER_TYPES.has(name) ? "number" : name);
    }
  }

  return ([...names].sort().join("|") || "null").slice(
    0,
    MAX_COLUMN_TYPE_LENGTH,
  );
}

/*
 * A collection's fields as its validator's JSON schema declares them, the
 * required ones not nullable. Null when it declares none.
 */
export function readMongoSchemaFields(
  validator: unknown,
): Array<DataAssetColumn> | null {
  const schema: JSONObject = readMongoObject(
    readMongoObject(validator)["$jsonSchema"],
  );
  const properties: JSONObject = readMongoObject(schema["properties"]);
  const required: Array<unknown> = Array.isArray(schema["required"])
    ? schema["required"]
    : [];
  const names: Array<string> = Object.keys(properties)
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .slice(0, MAX_COLUMNS_PER_DATA_ASSET);

  if (names.length === 0) {
    return null;
  }

  return names.map((name: string, index: number): DataAssetColumn => {
    const definition: JSONObject = readMongoObject(properties[name]);
    const declared: unknown = definition["bsonType"] ?? definition["type"];
    const types: Array<unknown> = Array.isArray(declared)
      ? declared
      : [declared ?? "mixed"];

    return {
      name: name.slice(0, MAX_COLUMN_NAME_LENGTH),
      dataType: readMongoFieldType(types),
      isNullable: !required.includes(name) || types.includes("null"),
      position: index + 1,
    };
  });
}

/*
 * A collection's fields as its newest documents carry them, grouped in the
 * database to names and types - never a value - _id first, then by name,
 * so the same documents always read the same.
 */
export function readMongoSampledFields(
  rows: Array<Record<string, unknown>>,
): Array<DataAssetColumn> {
  return rows
    .map((row: Record<string, unknown>) => {
      return {
        name: readText(row["_id"], MAX_COLUMN_NAME_LENGTH),
        types: Array.isArray(row["types"])
          ? (row["types"] as Array<unknown>)
          : [],
      };
    })
    .filter((field: { name: string }): boolean => {
      return field.name.length > 0;
    })
    .sort((a: { name: string }, b: { name: string }): number => {
      if (a.name === b.name) {
        return 0;
      }

      if (a.name === "_id" || b.name === "_id") {
        return a.name === "_id" ? -1 : 1;
      }

      return a.name < b.name ? -1 : 1;
    })
    .slice(0, MAX_COLUMNS_PER_DATA_ASSET)
    .map(
      (
        field: { name: string; types: Array<unknown> },
        index: number,
      ): DataAssetColumn => {
        return {
          name: field.name,
          dataType: readMongoFieldType(field.types),
          isNullable: field.name !== "_id",
          position: index + 1,
        };
      },
    );
}

// A time series collection's fields as its options name them: its time, and its metadata.
export function readMongoTimeSeriesFields(
  options: JSONObject,
): Array<DataAssetColumn> | null {
  const timeseries: JSONObject = readMongoObject(options["timeseries"]);
  const timeField: string = readText(
    timeseries["timeField"],
    MAX_COLUMN_NAME_LENGTH,
  );
  const metaField: string = readText(
    timeseries["metaField"],
    MAX_COLUMN_NAME_LENGTH,
  );

  if (!timeField) {
    return null;
  }

  return [
    { name: timeField, dataType: "date", isNullable: false, position: 1 },
    ...(metaField
      ? [{ name: metaField, dataType: "mixed", isNullable: true, position: 2 }]
      : []),
  ];
}

/*
 * The newest documents' fields and the newest one's _id, in one walk down
 * the _id index: an ObjectId says when its document was made.
 */
export function buildMongoSamplePipeline(): Array<JSONObject> {
  return [
    { $sort: { _id: -1 } },
    { $limit: MONGO_FIELD_SAMPLE_SIZE },
    {
      $facet: {
        newest: [{ $limit: 1 }, { $project: { _id: 1 } }],
        fields: [
          { $project: { _id: 0, field: { $objectToArray: "$$ROOT" } } },
          { $unwind: "$field" },
          {
            $group: {
              _id: "$field.k",
              types: { $addToSet: { $type: "$field.v" } },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: MAX_COLUMNS_PER_DATA_ASSET },
        ],
      },
    },
  ];
}

// When an ObjectId was made, from its leading seconds; null for any other _id.
export function readObjectIdTime(value: unknown): Date | null {
  const getTimestamp: unknown =
    value && typeof value === "object"
      ? (value as { getTimestamp?: unknown }).getTimestamp
      : undefined;

  if (typeof getTimestamp !== "function") {
    return null;
  }

  const time: unknown = getTimestamp.call(value);

  return time instanceof Date && Number.isFinite(time.getTime()) ? time : null;
}

/*
 * What $collStats says of a collection, summed over its shards: its
 * documents, its size on disk with its indexes, and the writes it has taken
 * since the server started - a counter that moves on every insert, update
 * and delete, which OneUptime's reads never move.
 */
export function readMongoCollectionStats(
  documents: Array<Record<string, unknown>>,
): { rows: number | null; size: number | null; writes: number | null } {
  const add: (total: number | null, value: number | null) => number | null = (
    total: number | null,
    value: number | null,
  ): number | null => {
    return value === null ? total : (total ?? 0) + value;
  };
  let rows: number | null = null;
  let size: number | null = null;
  let writes: number | null = null;

  for (const document of documents) {
    const storage: JSONObject = readMongoObject(document["storageStats"]);
    const storageSize: number | null = readCount(storage["storageSize"]);

    rows = add(rows, readCount(storage["count"]));
    size = add(
      size,
      readCount(storage["totalSize"]) ??
        (storageSize === null
          ? null
          : storageSize + (readCount(storage["totalIndexSize"]) ?? 0)),
    );
    writes = add(
      writes,
      readCount(
        readMongoObject(readMongoObject(document["latencyStats"])["writes"])[
          "ops"
        ],
      ),
    );
  }

  return { rows, size, writes };
}

/*
 * A value of a check's document as readCheckRows reads it: BSON's numbers
 * (Decimal128, Long) as their text, an ObjectId as its hex.
 */
export function readMongoCell(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    value instanceof Date
  ) {
    return value ?? null;
  }

  if ("_bsontype" in value) {
    return String(value);
  }

  return JSON.stringify(value).slice(0, MAX_IDENTIFIER_LENGTH);
}

/*
 * MongoDB, over its own driver. Each database's collections, views and
 * time series (listCollections); each collection's documents, size and
 * write counter ($collStats, from the member that takes the writes); when
 * it last took a document, and its fields, from its newest documents in one
 * walk down the _id index - its validator's JSON schema naming the fields
 * when it has one. A view's source collection is lineage. Documents are
 * read on a secondary where there is one, and every read is bounded by
 * maxTimeMS. Nothing is ever written.
 */
class MongoCatalog implements CatalogSession {
  public readonly engine: DatabaseEngine = "mongodb";
  private readonly client: MongoClient;
  private readonly databases: Array<string>;
  private viewEdges: Array<CollectedLineageEdge> = [];
  private isComplete: boolean = false;

  private constructor(client: MongoClient, databases: Array<string>) {
    this.client = client;
    this.databases = databases;
  }

  public static async open(connectionString: string): Promise<MongoCatalog> {
    const client: MongoClient = new MongoClient(connectionString, {
      appName: APPLICATION_NAME,
      serverSelectionTimeoutMS: CONNECT_TIMEOUT_IN_MS,
      connectTimeoutMS: CONNECT_TIMEOUT_IN_MS,
      socketTimeoutMS: STATEMENT_TIMEOUT_IN_MS + 5_000,
      maxPoolSize: MONGO_COLLECTION_CONCURRENCY,
      readPreference: "secondaryPreferred",
      retryWrites: false,
    });

    await client.connect();

    try {
      // The database the string names, else every one the login may read.
      const named: string | null =
        readMongoUri(connectionString)?.database || null;
      const databases: Array<string> = named
        ? [named]
        : (
            await client
              .db("admin")
              .admin()
              .listDatabases({ nameOnly: true, authorizedDatabases: true })
          ).databases
            .map((database: { name: string }): string => {
              return database.name;
            })
            .filter((name: string): boolean => {
              return !isMongoSystemDatabase(name);
            })
            .sort();

      return new MongoCatalog(client, databases);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /*
   * A database's collections with their options; a login that may not list
   * them in full lists their names and types alone.
   */
  private async listCollections(
    database: Db,
  ): Promise<Array<MongoCollectionInfo>> {
    let infos: Array<Record<string, unknown>>;

    try {
      infos = (await database
        .listCollections({}, { nameOnly: false })
        .toArray()) as unknown as Array<Record<string, unknown>>;
    } catch {
      infos = (await database
        .listCollections({}, { nameOnly: true, authorizedCollections: true })
        .toArray()) as unknown as Array<Record<string, unknown>>;
    }

    return infos
      .map((info: Record<string, unknown>): MongoCollectionInfo => {
        return {
          name: readText(info["name"], MAX_IDENTIFIER_LENGTH),
          type: readText(info["type"] ?? "collection", 40),
          options: readMongoObject(info["options"]),
        };
      })
      .filter((info: MongoCollectionInfo): boolean => {
        // system.views, system.buckets.* and the like are MongoDB's own.
        return info.name.length > 0 && !info.name.startsWith("system.");
      })
      .sort((a: MongoCollectionInfo, b: MongoCollectionInfo): number => {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
  }

  // $collStats, from the member that takes the writes: its write counter is the one that moves.
  private async readStats(
    collection: Collection,
    withCounters: boolean,
  ): Promise<{
    rows: number | null;
    size: number | null;
    writes: number | null;
  }> {
    try {
      return readMongoCollectionStats(
        await collection
          .aggregate(
            [
              {
                $collStats: {
                  storageStats: { scale: 1 },
                  ...(withCounters ? { latencyStats: {} } : {}),
                },
              },
              {
                $project: {
                  "storageStats.count": 1,
                  "storageStats.size": 1,
                  "storageStats.storageSize": 1,
                  "storageStats.totalIndexSize": 1,
                  "storageStats.totalSize": 1,
                  "latencyStats.writes.ops": 1,
                },
              },
            ],
            {
              maxTimeMS: STATEMENT_TIMEOUT_IN_MS,
              readPreference: "primaryPreferred",
            },
          )
          .toArray(),
      );
    } catch {
      // A server without $collStats (or a login without collStats): the count it keeps.
      const rows: number | null = withCounters
        ? readCount(
            await collection
              .estimatedDocumentCount({ maxTimeMS: STATEMENT_TIMEOUT_IN_MS })
              .catch((): null => {
                return null;
              }),
          )
        : null;

      return { rows, size: null, writes: null };
    }
  }

  // The newest documents' fields and the newest _id; null when they could not be read.
  private async readSample(
    collection: Collection,
  ): Promise<{ newestId: unknown; fields: Array<DataAssetColumn> } | null> {
    try {
      const [sample] = await collection
        .aggregate(buildMongoSamplePipeline(), {
          maxTimeMS: STATEMENT_TIMEOUT_IN_MS,
        })
        .toArray();
      const newest: Array<unknown> = Array.isArray(sample?.["newest"])
        ? (sample["newest"] as Array<unknown>)
        : [];
      const fields: Array<Record<string, unknown>> = Array.isArray(
        sample?.["fields"],
      )
        ? (sample["fields"] as Array<Record<string, unknown>>)
        : [];

      return {
        newestId: readMongoObject(newest[0])["_id"] ?? null,
        fields: readMongoSampledFields(fields),
      };
    } catch {
      return null;
    }
  }

  private async readCollection(
    database: Db,
    info: MongoCollectionInfo,
    now: Date,
  ): Promise<MongoCollectionRead> {
    const collection: Collection = database.collection(info.name);
    const table: RawTable = {
      schema: database.databaseName,
      name: info.name,
      kind: info.type === "view" ? DataAssetKind.View : DataAssetKind.Table,
      estimatedRows: null,
      sizeInBytes: null,
      writeCount: null,
      secondsSinceChange: null,
      readCount: null,
      secondsSinceRead: null,
    };

    // A view holds nothing of its own: running its pipeline to read it is a query, not a look.
    if (info.type === "view") {
      return {
        table,
        columns: null,
        viewOn: readText(info.options["viewOn"], MAX_IDENTIFIER_LENGTH) || null,
      };
    }

    /*
     * A time series keeps its documents in buckets with no _id index to
     * walk: its size moving says it changed, and its options name its fields.
     */
    if (info.type === "timeseries") {
      const stats: { size: number | null } = await this.readStats(
        collection,
        false,
      );

      return {
        table: { ...table, sizeInBytes: stats.size },
        columns: readMongoTimeSeriesFields(info.options),
        viewOn: null,
      };
    }

    const [stats, sample] = await Promise.all([
      this.readStats(collection, true),
      this.readSample(collection),
    ]);
    const newestAt: Date | null = readObjectIdTime(sample?.newestId);
    const declared: Array<DataAssetColumn> | null = readMongoSchemaFields(
      info.options["validator"],
    );

    return {
      table: {
        ...table,
        estimatedRows: stats.rows,
        sizeInBytes: stats.size,
        writeCount: stats.writes,
        columnsAreInferred: declared === null,
        secondsSinceChange: newestAt
          ? Math.max(0, Math.floor((now.getTime() - newestAt.getTime()) / 1000))
          : null,
      },
      columns: declared ?? sample?.fields ?? null,
      viewOn: null,
    };
  }

  public async read(options: TableHealthCollectOptions): Promise<CatalogRead> {
    const excluded: Set<string> = readExclusions(options.exclusions);
    const warnings: Array<string> = [];
    const tables: Array<RawTable> = [];
    const columns: Array<RawColumn> = [];
    const columnsUnknown: Array<string> = [];
    const now: Date = new Date();
    let isComplete: boolean = true;

    this.viewEdges = [];

    for (const databaseName of this.databases) {
      if (excluded.has(databaseName.toLowerCase())) {
        continue;
      }

      if (tables.length >= options.maxTables) {
        isComplete = false;
        break;
      }

      const database: Db = this.client.db(databaseName);
      let infos: Array<MongoCollectionInfo>;

      try {
        infos = (await this.listCollections(database)).filter(
          (info: MongoCollectionInfo): boolean => {
            return !isExcluded(databaseName, info.name, excluded);
          },
        );
      } catch (error) {
        isComplete = false;
        warnings.push(
          `The collections of ${databaseName} were left out: ${describeError(error).slice(0, 200)}`,
        );
        continue;
      }

      const wanted: Array<MongoCollectionInfo> = infos.slice(
        0,
        Math.max(0, options.maxTables - tables.length),
      );

      for (
        let start: number = 0;
        start < wanted.length;
        start += MONGO_COLLECTION_CONCURRENCY
      ) {
        const reads: Array<MongoCollectionRead> = await Promise.all(
          wanted
            .slice(start, start + MONGO_COLLECTION_CONCURRENCY)
            .map((info: MongoCollectionInfo) => {
              return this.readCollection(database, info, now);
            }),
        );

        for (const read of reads) {
          tables.push(read.table);

          if (read.columns === null) {
            columnsUnknown.push(keyOf(databaseName, read.table.name));
          }

          for (const column of read.columns || []) {
            if (columns.length < options.maxColumns) {
              columns.push({
                schema: databaseName,
                table: read.table.name,
                column,
              });
            }
          }

          const edge: CollectedLineageEdge | null = read.viewOn
            ? readLineageRow(
                {
                  upstream_schema: databaseName,
                  upstream_table: read.viewOn,
                  downstream_schema: databaseName,
                  downstream_table: read.table.name,
                },
                DataAssetLineageSource.ViewDefinition,
              )
            : null;

          if (edge) {
            this.viewEdges.push(edge);
          }
        }
      }
    }

    this.isComplete = isComplete;

    return {
      tables,
      columns,
      warnings,
      secondsSinceStatsReset: null,
      columnsUnknown,
    };
  }

  // Each view's source collection, read with the catalog.
  public async readLineage(): Promise<LineageRead> {
    return {
      edges: this.viewEdges.slice(0, MAX_LINEAGE_EDGES_PER_COLLECTION),
      isViewLineageComplete: this.isComplete,
      warnings: [],
    };
  }

  /*
   * One check's pipeline, on a secondary where there is one, its documents
   * capped at a check's segments. No documents is the check's own empty
   * value: a count's 0, else nothing.
   */
  public async readAggregate(
    sql: string,
    _params: Array<string>,
  ): Promise<Array<Record<string, unknown>>> {
    const statement: MongoCheckStatement = readMongoCheckStatement(sql);
    const documents: Array<Record<string, unknown>> = await this.client
      .db(statement.database || this.databases[0] || "test")
      .collection(statement.collection)
      .aggregate([...statement.pipeline, { $limit: MAX_SEGMENTS_PER_CHECK }], {
        maxTimeMS: STATEMENT_TIMEOUT_IN_MS,
      })
      .toArray();

    if (documents.length === 0) {
      return statement.isSegmented ? [] : [{ value: statement.emptyValue }];
    }

    return documents.map((document: Record<string, unknown>) => {
      const row: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(document)) {
        row[key] = readMongoCell(value);
      }

      return row;
    });
  }

  public async close(): Promise<void> {
    await this.client.close();
  }
}

async function openCatalog(
  connection: DatabaseConnection,
): Promise<CatalogSession> {
  switch (connection.engine) {
    case "postgresql":
      return await PostgresCatalog.open(connection.connectionString);
    case "bigquery":
      return await BigQueryCatalog.open(connection.connectionString);
    case "redshift":
      return await RedshiftCatalog.open(connection.connectionString);
    case "snowflake":
      return await SnowflakeCatalog.open(connection.connectionString);
    case "mysql":
      return await MySqlCatalog.open(connection.connectionString);
    case "sqlserver":
      return await SqlServerCatalog.open(connection.connectionString);
    case "clickhouse":
      return await ClickHouseCatalog.open(connection.connectionString);
    case "databricks":
      return await DatabricksCatalog.open(connection.connectionString);
    case "athena":
      return await AthenaCatalog.open(connection.connectionString);
    case "oracle":
      return await OracleCatalog.open(connection.connectionString);
    case "mongodb":
      return await MongoCatalog.open(connection.connectionString);
    default:
      throw new Error(
        `Data Observability cannot collect ${String(connection.engine)} databases yet.`,
      );
  }
}

// The store's exclusions, as isExcluded compares them.
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
 * comparison would read as every column dropped. Lineage, when it was
 * read, leaves out every edge with an excluded table at either end.
 */
export function assembleSnapshot(data: {
  engine: DatabaseEngine;
  read: CatalogRead;
  options: TableHealthCollectOptions;
  collectedAt: Date;
  lineage?: LineageRead | undefined;
}): TableHealthSnapshot {
  const excluded: Set<string> = readExclusions(data.options.exclusions);
  const columnsUnknown: Set<string> = new Set(data.read.columnsUnknown || []);
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
        : columnsCut || columnsUnknown.has(keyOf(raw.schema, raw.name))
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

  const snapshot: TableHealthSnapshot = {
    engine: data.engine,
    collectedAt: data.collectedAt.toISOString(),
    tables,
    isComplete: data.read.tables.length < data.options.maxTables,
    warnings: warnings.slice(0, MAX_COLLECTION_WARNINGS),
    secondsSinceStatsReset: data.read.secondsSinceStatsReset,
  };

  if (data.lineage) {
    snapshot.lineage = data.lineage.edges
      .filter((edge: CollectedLineageEdge) => {
        return (
          !isExcluded(edge.downstreamSchema, edge.downstreamTable, excluded) &&
          !isExcluded(edge.upstreamSchema, edge.upstreamTable, excluded)
        );
      })
      .slice(0, MAX_LINEAGE_EDGES_PER_COLLECTION);
    snapshot.isViewLineageComplete = data.lineage.isViewLineageComplete;
  }

  return snapshot;
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
    let lineage: LineageRead = NO_LINEAGE;

    // Lineage is extra: an engine that cannot say it never fails the collection.
    try {
      lineage = catalog.readLineage
        ? await catalog.readLineage(options)
        : NO_LINEAGE;
    } catch (error) {
      lineage = {
        ...NO_LINEAGE,
        warnings: [
          `Lineage was left out: ${describeError(error).slice(0, 200)}`,
        ],
      };
    }

    // Spend is extra too: a warehouse that cannot say it never fails the collection.
    let spend: SpendRead = NO_SPEND;

    try {
      spend = catalog.readSpend ? await catalog.readSpend(options) : NO_SPEND;
    } catch (error) {
      spend = {
        ...NO_SPEND,
        warnings: [
          `Warehouse spend was left out: ${describeError(error).slice(0, 200)}`,
        ],
      };
    }

    const checkResults: Array<DataCheckRunResult> = [];

    // Each check on its own: one that cannot run never stops the others.
    for (const check of options.checks || []) {
      try {
        checkResults.push({
          checkId: check.checkId,
          values: readCheckRows({
            type: check.type,
            isSegmented: check.isSegmented,
            rows: await catalog.readAggregate(
              check.sql,
              check.params,
              check.limits,
            ),
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
          warnings: [
            ...read.warnings,
            ...lineage.warnings,
            ...spend.warnings,
          ].map((warning: string) => {
            return sanitizeErrorMessage(new Error(warning), secrets);
          }),
        },
        options,
        collectedAt,
        lineage,
      }),
      target: readConnectionTarget(connection),
      ...(spend.isRead ? { spend: spend.jobs.slice(0, MAX_SPEND_JOBS) } : {}),
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
