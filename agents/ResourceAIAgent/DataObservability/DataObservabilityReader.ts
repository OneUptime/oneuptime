import fs from "fs";
import {
  DatabaseConnectOptions,
  DatabaseDriverFactory,
  SqlConnection,
  SqlRow,
} from "../Executors/Database/DatabaseDrivers";
import {
  DatabaseSettings,
  DatabaseTlsMode,
} from "../Executors/Database/DatabaseSettings";
import {
  DATABASE_AGENT_MAX_ERROR_LENGTH,
  DATABASE_AGENT_MAX_LINEAGE_EDGES,
  DATABASE_AGENT_MAX_WARNINGS,
  DATABASE_AGENT_MAX_WARNING_LENGTH,
  DatabaseAgentCheck,
  DatabaseAgentCheckResult,
  DatabaseAgentEngine,
  DatabaseAgentLineageEdge,
  DatabaseAgentReport,
  DatabaseAgentSnapshot,
  DatabaseAgentTable,
  DatabaseAgentWork,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentWork";
import {
  DatabaseAgentCatalog,
  DatabaseAgentRefusal,
  DatabaseAgentStatement,
  MYSQL_COLUMNS_SQL,
  MYSQL_COUNTERS_SQL,
  MYSQL_MAX_CONNECTIONS_SQL,
  MYSQL_TABLES_SQL,
  MYSQL_THREADS_RUNNING_SQL,
  MYSQL_UPTIME_SQL,
  MYSQL_VIEW_LINEAGE_SQL,
  POSTGRES_BUSY_SQL,
  POSTGRES_COLUMNS_SQL,
  POSTGRES_RECOVERY_SQL,
  POSTGRES_STATS_RESET_SQL,
  POSTGRES_VIEW_LINEAGE_SQL,
  buildDatabaseAgentCheckStatement,
  buildDatabaseAgentFreshnessStatement,
  getDatabaseAgentCatalogKey,
  getDatabaseAgentCheckRefusal,
  getDatabaseAgentFreshnessRefusal,
  getPostgresTablesSql,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentStatements";
import {
  DatabaseAgentCatalogTables,
  DatabaseAgentColumnRow,
  assembleDatabaseAgentTables,
  filterDatabaseAgentLineage,
  readDatabaseAgentCheckRows,
  readDatabaseAgentColumnRow,
  readDatabaseAgentCount,
  readDatabaseAgentFreshnessAge,
  readDatabaseAgentViewLineage,
  readMySqlCounterRows,
  readMySqlTableRows,
  readPostgresTableRows,
} from "../Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentRows";
import {
  DataObservabilityLogin,
  DataObservabilitySettings,
  isSameLogin,
} from "./DataObservabilitySettings";

/*
 * ONE DATABASE READ FOR DATA OBSERVABILITY, ON THE AGENT (#11148).
 *
 * What runs is decided here, by this agent's own copy of the shapes
 * (Common/Utils/DataObservability/DatabaseAgent/DatabaseAgentStatements),
 * whatever the server sent:
 *
 *   - the catalog, with its fixed statements, over the catalog login;
 *   - each due check, refused unless every table and column it reads is in
 *     the catalog just read, then built here - its names quoted as the
 *     engine quotes a name, its values bound - over the checks login. A
 *     Custom SQL or Failing Rows check runs only where the agent's owner
 *     allowed it (ONEUPTIME_DATA_OBSERVABILITY_ALLOW_CUSTOM_SQL);
 *   - each freshness column, judged and built the same way.
 *
 * Every statement runs in a read-only transaction of its own, rolled back,
 * with a statement and a lock time limit: PostgreSQL's BEGIN READ ONLY with
 * SET LOCAL timeouts; MySQL's read-only session and START TRANSACTION READ
 * ONLY with MAX_EXECUTION_TIME (MariaDB's max_statement_time). Nothing a
 * statement runs can write. One connection per login per database, closed
 * at the end. What is reported is catalog facts and one number per check -
 * never a row, never a login: a message that holds a password has it
 * masked first.
 */

// The same limits OneUptime's workers and probes read a database with.
export const CONNECT_TIMEOUT_MS: number = 10_000;
export const STATEMENT_TIMEOUT_MS: number = 30_000;
export const LOCK_TIMEOUT_MS: number = 5_000;

export const APPLICATION_NAME: string = "OneUptime Data Observability";

// The largest CA bundle read from ONEUPTIME_AI_DATABASE_CA_FILE.
const MAX_CA_FILE_BYTES: number = 1024 * 1024;

// A password shorter than this is not masked in messages (it would mangle them).
const MIN_MASKED_SECRET_LENGTH: number = 4;
const MASKED_SECRET: string = "[redacted]";

const READ_REPLICA_WARNING: string =
  "This database is a read replica, so its write counters are the primary's to keep: a table's change time comes from its freshness column, or is not known.";

const BUSY_DATABASE_WARNING: string =
  "The database looked busy, so the checks that were due wait for the next collection.";

// Half of a server's connections at work makes it busy.
const BUSY_SHARE_OF_CONNECTIONS: number = 0.5;

export const CHECKS_OFF_REFUSAL: string =
  "This Database Agent runs no checks: its owner turned them off (ONEUPTIME_DATA_OBSERVABILITY_CHECKS=false).";

// One statement at a time, each in a read-only transaction of its own.
export interface ReadOnlySession {
  rows(sql: string, params?: ReadonlyArray<unknown>): Promise<Array<SqlRow>>;
  close(): Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A message with every login's password masked, bounded.
export function maskSecrets(
  message: string,
  secrets: ReadonlyArray<string>,
  maxLength: number,
): string {
  let masked: string = message;

  for (const secret of secrets) {
    if (secret && secret.length >= MIN_MASKED_SECRET_LENGTH) {
      masked = masked.split(secret).join(MASKED_SECRET);
    }
  }

  return masked.slice(0, maxLength);
}

function readCa(settings: DatabaseSettings): string | null {
  if (!settings.caFile || settings.tls !== DatabaseTlsMode.Verify) {
    return null;
  }

  const stat: fs.Stats = fs.statSync(settings.caFile);

  if (stat.size > MAX_CA_FILE_BYTES) {
    throw new Error(
      `The CA bundle ${settings.caFile} is larger than ${MAX_CA_FILE_BYTES} bytes.`,
    );
  }

  return fs.readFileSync(settings.caFile, "utf8");
}

// A PostgreSQL connection, each statement in BEGIN READ ONLY ... ROLLBACK.
export class PostgresReadOnlySession implements ReadOnlySession {
  public constructor(private readonly connection: SqlConnection) {}

  public async rows(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<Array<SqlRow>> {
    await this.connection.query("BEGIN READ ONLY");

    try {
      // SET LOCAL, with the values bound: they last until the rollback below.
      await this.connection.query(
        "SELECT set_config('statement_timeout', $1, true) AS statement_timeout, set_config('lock_timeout', $2, true) AS lock_timeout",
        [String(STATEMENT_TIMEOUT_MS), String(LOCK_TIMEOUT_MS)],
      );

      return await this.connection.query(sql, params);
    } finally {
      try {
        await this.connection.query("ROLLBACK");
      } catch {
        // The connection is gone: nothing to roll back.
      }
    }
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }
}

/*
 * A MySQL or MariaDB connection: a read-only session with time limits, each
 * statement in START TRANSACTION READ ONLY ... ROLLBACK.
 */
export class MySqlReadOnlySession implements ReadOnlySession {
  private constructor(private readonly connection: SqlConnection) {}

  public static async open(
    connection: SqlConnection,
  ): Promise<MySqlReadOnlySession> {
    await connection.query("SET SESSION TRANSACTION READ ONLY");
    await connection.query("SET SESSION lock_wait_timeout = ?", [
      Math.ceil(LOCK_TIMEOUT_MS / 1000),
    ]);

    try {
      await connection.query("SET SESSION MAX_EXECUTION_TIME = ?", [
        STATEMENT_TIMEOUT_MS,
      ]);
    } catch {
      // MariaDB names it max_statement_time, in seconds.
      await connection.query("SET SESSION max_statement_time = ?", [
        Math.ceil(STATEMENT_TIMEOUT_MS / 1000),
      ]);
    }

    try {
      // MySQL 8 serves cached row counts and UPDATE_TIME for up to a day otherwise.
      await connection.query("SET SESSION information_schema_stats_expiry = 0");
    } catch {
      // MySQL 5.7 and MariaDB read them live already.
    }

    return new MySqlReadOnlySession(connection);
  }

  public async rows(
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<Array<SqlRow>> {
    await this.connection.query("START TRANSACTION READ ONLY");

    try {
      return await this.connection.query(sql, params);
    } finally {
      try {
        await this.connection.query("ROLLBACK");
      } catch {
        // The connection is gone: nothing to roll back.
      }
    }
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }
}

// Opens a read-only session to one database with one login.
export async function openReadOnlySession(data: {
  drivers: DatabaseDriverFactory;
  engine: DatabaseAgentEngine;
  database: DatabaseSettings;
  login: DataObservabilityLogin;
  databaseName: string;
}): Promise<ReadOnlySession> {
  const options: DatabaseConnectOptions = {
    host: data.database.host,
    port: data.database.port,
    username: data.login.username,
    password: data.login.password,
    database: data.databaseName,
    ...(data.engine === "mysql" ? { mysqlDatabase: data.databaseName } : {}),
    tls: { mode: data.database.tls, ca: readCa(data.database) },
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    applicationName: APPLICATION_NAME,
  };

  if (data.engine === "postgresql") {
    return new PostgresReadOnlySession(
      await data.drivers.connectPostgres(options),
    );
  }

  const connection: SqlConnection = await data.drivers.connectMySql(options);

  try {
    return await MySqlReadOnlySession.open(connection);
  } catch (error) {
    await connection.close().catch(() => {
      return undefined;
    });
    throw error;
  }
}

interface CatalogRead {
  tables: Array<Omit<DatabaseAgentTable, "columns">>;
  columns: Array<DatabaseAgentColumnRow>;
  warnings: Array<string>;
  secondsSinceStatsReset: number | null;
}

async function readPostgresCatalog(
  session: ReadOnlySession,
  work: DatabaseAgentWork,
): Promise<CatalogRead> {
  const warnings: Array<string> = [];
  let tableRows: Array<SqlRow>;

  try {
    tableRows = await session.rows(getPostgresTablesSql(true), [
      work.maxTables,
    ]);
  } catch (error) {
    // Sizing every relation is the costly part; without it the rest still says plenty.
    warnings.push(
      `Table sizes were left out: ${describeError(error).slice(0, 200)}`,
    );
    tableRows = await session.rows(getPostgresTablesSql(false), [
      work.maxTables,
    ]);
  }

  const [recovery] = await session.rows(POSTGRES_RECOVERY_SQL);
  const isReplica: boolean = recovery?.["in_recovery"] === true;

  if (isReplica) {
    warnings.push(READ_REPLICA_WARNING);
  }

  let secondsSinceStatsReset: number | null = null;

  try {
    const [epoch] = await session.rows(POSTGRES_STATS_RESET_SQL);
    secondsSinceStatsReset = readDatabaseAgentCount(epoch?.["seconds"]);
  } catch (error) {
    warnings.push(
      `How long the read counters have counted for was left out: ${describeError(error).slice(0, 200)}`,
    );
  }

  const columnRows: Array<SqlRow> = await session.rows(POSTGRES_COLUMNS_SQL, [
    work.maxColumns,
  ]);

  return {
    tables: readPostgresTableRows(tableRows, isReplica),
    columns: columnRows
      .map(readDatabaseAgentColumnRow)
      .filter((column: DatabaseAgentColumnRow | null): column is DatabaseAgentColumnRow => {
        return column !== null;
      }),
    warnings,
    secondsSinceStatsReset,
  };
}

async function readMySqlCatalog(
  session: ReadOnlySession,
  work: DatabaseAgentWork,
): Promise<CatalogRead> {
  const warnings: Array<string> = [];
  const tableRows: Array<SqlRow> = await session.rows(MYSQL_TABLES_SQL, [
    work.maxTables,
  ]);
  let counters: Map<string, { writes: number | null; reads: number | null }> =
    new Map();
  let secondsSinceStatsReset: number | null = null;

  try {
    counters = readMySqlCounterRows(await session.rows(MYSQL_COUNTERS_SQL));

    // performance_schema counts since the server started.
    const [uptime] = await session.rows(MYSQL_UPTIME_SQL);
    secondsSinceStatsReset = readDatabaseAgentCount(uptime?.["seconds"]);
  } catch (error) {
    warnings.push(
      `Write counters were left out (performance_schema could not be read): ${describeError(error).slice(0, 200)}`,
    );
  }

  const columnRows: Array<SqlRow> = await session.rows(MYSQL_COLUMNS_SQL, [
    work.maxColumns,
  ]);

  return {
    tables: readMySqlTableRows(tableRows, counters),
    columns: columnRows
      .map(readDatabaseAgentColumnRow)
      .filter((column: DatabaseAgentColumnRow | null): column is DatabaseAgentColumnRow => {
        return column !== null;
      }),
    warnings,
    secondsSinceStatsReset,
  };
}

/*
 * Which views read which tables, as the engine records it - an engine
 * version that keeps none (MariaDB) has none, with no warning.
 */
async function readViewLineage(
  session: ReadOnlySession,
  engine: DatabaseAgentEngine,
): Promise<{
  edges: Array<DatabaseAgentLineageEdge>;
  isComplete: boolean;
  warning: string | null;
}> {
  try {
    const rows: Array<SqlRow> = await session.rows(
      engine === "postgresql" ? POSTGRES_VIEW_LINEAGE_SQL : MYSQL_VIEW_LINEAGE_SQL,
      [DATABASE_AGENT_MAX_LINEAGE_EDGES],
    );

    return {
      edges: readDatabaseAgentViewLineage(rows),
      isComplete: rows.length < DATABASE_AGENT_MAX_LINEAGE_EDGES,
      warning: null,
    };
  } catch (error) {
    const message: string = describeError(error);

    return {
      edges: [],
      isComplete: false,
      warning:
        engine === "mysql" && message.toUpperCase().includes("VIEW_TABLE_USAGE")
          ? null
          : `The lineage of views was left out (their definitions could not be read): ${message.slice(0, 200)}`,
    };
  }
}

async function isBusy(
  session: ReadOnlySession,
  engine: DatabaseAgentEngine,
): Promise<boolean> {
  try {
    if (engine === "postgresql") {
      const [row] = await session.rows(POSTGRES_BUSY_SQL);
      return isBusyAtShare(row?.["active"], row?.["max_connections"]);
    }

    const [running] = await session.rows(MYSQL_THREADS_RUNNING_SQL);
    const [limit] = await session.rows(MYSQL_MAX_CONNECTIONS_SQL);

    return isBusyAtShare(
      running?.["Value"] ?? running?.["value"],
      limit?.["max_connections"],
    );
  } catch {
    // A login that may not see how busy the database is has nothing to wait for.
    return false;
  }
}

export function isBusyAtShare(active: unknown, limit: unknown): boolean {
  const activeCount: number | null = readDatabaseAgentCount(active);
  const limitCount: number | null = readDatabaseAgentCount(limit);

  return (
    activeCount !== null &&
    limitCount !== null &&
    limitCount > 0 &&
    activeCount / limitCount >= BUSY_SHARE_OF_CONNECTIONS
  );
}

// The catalog as checks are judged against: each table's columns (null where they were cut).
export function getCatalogOfTables(
  tables: Array<DatabaseAgentTable>,
): DatabaseAgentCatalog {
  const catalog: DatabaseAgentCatalog = new Map();

  for (const table of tables) {
    catalog.set(
      getDatabaseAgentCatalogKey(table.schema, table.name),
      table.columns
        ? new Set(
            table.columns.map((column: { name: string }): string => {
              return column.name;
            }),
          )
        : null,
    );
  }

  return catalog;
}

/*
 * One check, judged against the catalog, built here, and run read-only;
 * its error is the reason it was refused, or the database's own words.
 */
export async function runDatabaseAgentCheck(data: {
  session: ReadOnlySession;
  engine: DatabaseAgentEngine;
  check: DatabaseAgentCheck;
  catalog: DatabaseAgentCatalog;
  allowsCustomSql: boolean;
  secrets: ReadonlyArray<string>;
}): Promise<DatabaseAgentCheckResult> {
  const refusal: string | null = getDatabaseAgentCheckRefusal(
    data.check,
    data.catalog,
    { allowsCustomSql: data.allowsCustomSql },
  );

  if (refusal) {
    return { checkId: data.check.checkId, values: [], error: refusal };
  }

  let statement: DatabaseAgentStatement;

  try {
    statement = buildDatabaseAgentCheckStatement(data.engine, data.check, {
      allowsCustomSql: data.allowsCustomSql,
    });
  } catch (error) {
    return {
      checkId: data.check.checkId,
      values: [],
      error:
        error instanceof DatabaseAgentRefusal
          ? error.message
          : maskSecrets(describeError(error), data.secrets, 500),
    };
  }

  try {
    const rows: Array<SqlRow> = await data.session.rows(
      statement.sql,
      statement.params,
    );

    return {
      checkId: data.check.checkId,
      values: readDatabaseAgentCheckRows({
        type: data.check.type,
        isSegmented: statement.isSegmented,
        rows,
      }),
      error: null,
    };
  } catch (error) {
    return {
      checkId: data.check.checkId,
      values: [],
      error: maskSecrets(describeError(error), data.secrets, 500),
    };
  }
}

/*
 * Reads one database for one work item, never throwing: a database it
 * cannot reach, a login it refuses, become the report's error, with every
 * password masked.
 */
export async function collectDatabase(data: {
  work: DatabaseAgentWork;
  settings: DataObservabilitySettings;
  drivers: DatabaseDriverFactory;
  target: { host: string | null; port: number | null };
  now?: (() => Date) | undefined;
}): Promise<DatabaseAgentReport> {
  const now: () => Date =
    data.now ||
    ((): Date => {
      return new Date();
    });
  const startedAt: string = now().toISOString();
  const { work, settings } = data;
  const secrets: Array<string> = [
    settings.catalogLogin?.password || "",
    settings.checksLogin?.password || "",
  ];
  const fail: (error: string) => DatabaseAgentReport = (
    error: string,
  ): DatabaseAgentReport => {
    return {
      dataStoreId: work.dataStoreId,
      startedAt,
      error: maskSecrets(error, secrets, DATABASE_AGENT_MAX_ERROR_LENGTH),
    };
  };

  if (
    !settings.isOn ||
    !settings.engine ||
    !settings.database ||
    !settings.catalogLogin ||
    !settings.checksLogin
  ) {
    return fail(
      "This Database Agent does not read databases for Data Observability: its owner has not turned it on (ONEUPTIME_DATA_OBSERVABILITY=true).",
    );
  }

  if (work.engine !== settings.engine) {
    return fail(
      `This Database Agent reads ${settings.engine === "mysql" ? "MySQL" : "PostgreSQL"} databases, and this database is read as ${work.engine === "mysql" ? "MySQL" : "PostgreSQL"}. Choose the agent of the server it is on.`,
    );
  }

  let catalogSession: ReadOnlySession | null = null;
  let checksSession: ReadOnlySession | null = null;

  try {
    catalogSession = await openReadOnlySession({
      drivers: data.drivers,
      engine: settings.engine,
      database: settings.database,
      login: settings.catalogLogin,
      databaseName: work.databaseName,
    });

    const collectedAt: Date = now();
    const read: CatalogRead =
      settings.engine === "postgresql"
        ? await readPostgresCatalog(catalogSession, work)
        : await readMySqlCatalog(catalogSession, work);
    const assembled: DatabaseAgentCatalogTables = assembleDatabaseAgentTables({
      engine: settings.engine,
      tables: read.tables,
      columns: read.columns,
      maxTables: work.maxTables,
      maxColumns: work.maxColumns,
      exclusions: work.exclusions,
    });
    const warnings: Array<string> = [...read.warnings, ...assembled.warnings];
    const lineage:
      | {
          edges: Array<DatabaseAgentLineageEdge>;
          isComplete: boolean;
          warning: string | null;
        }
      | null = work.readsViewLineage
      ? await readViewLineage(catalogSession, settings.engine)
      : null;

    if (lineage?.warning) {
      warnings.push(lineage.warning);
    }

    const catalog: DatabaseAgentCatalog = getCatalogOfTables(assembled.tables);
    const checkResults: Array<DatabaseAgentCheckResult> = [];
    const freshness: Map<string, number | null> = new Map();
    const hasReads: boolean =
      work.checks.length > 0 || work.freshnessReads.length > 0;

    if (hasReads && !settings.runsChecks) {
      for (const check of work.checks) {
        checkResults.push({
          checkId: check.checkId,
          values: [],
          error: CHECKS_OFF_REFUSAL,
        });
      }
    } else if (hasReads) {
      const waits: boolean =
        work.waitWhenBusy && (await isBusy(catalogSession, settings.engine));

      if (waits) {
        warnings.push(BUSY_DATABASE_WARNING);
      } else {
        // The checks login reads rows; the catalog login's connection serves when they are one.
        checksSession = isSameLogin(settings.catalogLogin, settings.checksLogin)
          ? null
          : await openReadOnlySession({
              drivers: data.drivers,
              engine: settings.engine,
              database: settings.database,
              login: settings.checksLogin,
              databaseName: work.databaseName,
            });

        const session: ReadOnlySession = checksSession || catalogSession;

        // Each check on its own: one that cannot run never stops the others.
        for (const check of work.checks) {
          checkResults.push(
            await runDatabaseAgentCheck({
              session,
              engine: settings.engine,
              check,
              catalog,
              allowsCustomSql: settings.runsCustomSql,
              secrets,
            }),
          );
        }

        for (const read of work.freshnessReads) {
          const refusal: string | null = getDatabaseAgentFreshnessRefusal(
            read,
            catalog,
          );

          if (refusal) {
            warnings.push(refusal);
            continue;
          }

          try {
            const statement: { sql: string; params: Array<string> } =
              buildDatabaseAgentFreshnessStatement(settings.engine, read);
            const [row] = await session.rows(statement.sql, statement.params);

            freshness.set(
              getDatabaseAgentCatalogKey(read.schemaName, read.tableName),
              readDatabaseAgentFreshnessAge(row?.["value"], collectedAt),
            );
          } catch (error) {
            warnings.push(
              `The freshness column of ${read.tableKey} could not be read: ${describeError(error).slice(0, 200)}`,
            );
          }
        }
      }
    }

    const snapshot: DatabaseAgentSnapshot = {
      engine: settings.engine,
      collectedAt: collectedAt.toISOString(),
      tables: assembled.tables.map(
        (table: DatabaseAgentTable): DatabaseAgentTable => {
          const key: string = getDatabaseAgentCatalogKey(
            table.schema,
            table.name,
          );

          return freshness.has(key)
            ? {
                ...table,
                secondsSinceChange: freshness.get(key) ?? null,
                isChangeTimeFromData: true,
              }
            : table;
        },
      ),
      isComplete: assembled.isComplete,
      warnings: warnings.slice(0, DATABASE_AGENT_MAX_WARNINGS).map(
        (warning: string): string => {
          return maskSecrets(warning, secrets, DATABASE_AGENT_MAX_WARNING_LENGTH);
        },
      ),
      secondsSinceStatsReset: read.secondsSinceStatsReset,
      target: {
        databaseName: work.databaseName,
        host: data.target.host,
        port: data.target.port,
      },
      ...(work.checks.length > 0 && !warnings.includes(BUSY_DATABASE_WARNING)
        ? { checkResults }
        : {}),
      ...(lineage
        ? {
            lineage: filterDatabaseAgentLineage(lineage.edges, work.exclusions),
            isViewLineageComplete: lineage.isComplete,
          }
        : {}),
    };

    return { dataStoreId: work.dataStoreId, startedAt, snapshot };
  } catch (error) {
    return fail(describeError(error));
  } finally {
    for (const session of [checksSession, catalogSession]) {
      if (session) {
        await session.close().catch(() => {
          return undefined;
        });
      }
    }
  }
}
