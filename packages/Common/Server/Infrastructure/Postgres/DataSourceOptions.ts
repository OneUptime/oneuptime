import {
  DatabaseHost,
  DatabaseName,
  DatabasePassword,
  DatabasePort,
  DatabaseRejectUnauthorized,
  DatabaseSslCa,
  DatabaseSslCert,
  DatabaseSslKey,
  DatabaseUsername,
  MaxPostgresConnections,
  PostgresConnectionAcquireTimeoutMs,
  PostgresConnectionMaxLifetimeMs,
  PostgresLockTimeoutMs,
  PostgresIdleInTransactionTimeoutMs,
  PostgresIdleSessionTimeoutMs,
  PostgresIdleTimeoutMs,
  PostgresKeepAliveInitialDelayMs,
  PostgresQueryTimeoutMs,
  PostgresSlowQueryLogThresholdMs,
  PostgresStatementTimeoutMs,
  RunDatabaseMigrationsOnBoot,
  ShouldDatabaseSslEnable,
} from "../../../Server/EnvironmentConfig";
import CancelOnTimeoutClient from "./CancelOnTimeoutClient";
import Migrations from "./SchemaMigrations/Index";
import DatabaseType from "../../../Types/DatabaseType";
import Entities from "../../../Models/DatabaseModels/Index";
import { DataSourceOptions } from "typeorm";

/*
 * The libpq `options` startup parameter every connection is opened with:
 *
 *   - idle_session_timeout, the server-side backstop for orphaned idle
 *     sessions. Unitless values are milliseconds. It must exceed
 *     idleTimeoutMillis (see EnvironmentConfig), so the pool reaps its
 *     healthy idle connections before the server force-closes them.
 *   - jit=off. Postgres compiles a statement to machine code when its
 *     estimated cost passes jit_above_cost, and the reads behind incident
 *     and alert rules (a rule with its seven to-many relations, LIMIT 10000)
 *     pass it even on empty tables: on Postgres 15 each spent 170-210 ms
 *     compiling and 4 ms planning and running, seven of them for every
 *     incident or alert created (2026-10-27). OneUptime's statements read a
 *     page of rows, never enough for compiled code to pay that back.
 *
 * Sent only while DATABASE_IDLE_SESSION_TIMEOUT_MS is above 0, as the
 * parameter was before it carried jit, so an install that turned the timeout
 * off to keep the parameter off its connections still connects as it did.
 * PgBouncer drops startup parameters: behind it, the chart's own Postgres
 * sets jit = off itself (HelmChart/Docs/Postgres.md).
 */
export const postgresStartupOptions: (idleSessionTimeoutMs: number) => {
  options?: string;
} = (idleSessionTimeoutMs: number): { options?: string } => {
  if (idleSessionTimeoutMs > 0) {
    return {
      options: `-c idle_session_timeout=${idleSessionTimeoutMs} -c jit=off`,
    };
  }

  return {};
};

const dataSourceOptions: DataSourceOptions = {
  type: DatabaseType.Postgres,
  host: DatabaseHost.toString(),
  port: DatabasePort.toNumber(),
  username: DatabaseUsername,
  password: DatabasePassword,
  database: DatabaseName,
  migrationsTableName: "migrations",
  migrations: Migrations,
  /*
   * Whether this process applies the schema migrations when it connects
   * (RunDatabaseMigrationsOnBoot: off on runtime pods when a dedicated
   * migrate Job owns them). PostgresDatabase.connect() reads it and applies
   * them through SchemaMigrationRunner, on a connection of their own with a
   * bounded lock wait and retries; it never lets initialize() run them on
   * this pool. With it off, connect() waits for whoever does apply them
   * (SchemaMigrationWait) instead of starting on an older schema. The TypeORM
   * CLI (migration:run, the schema drift check) turns it off and runs them
   * itself.
   */
  migrationsRun: RunDatabaseMigrationsOnBoot,
  /*
   * Run each migration in its own transaction rather than wrapping the whole
   * set in one (TypeORM's "all" default).
   *
   * An empty database — every new install, and the Postgres Schema Drift job —
   * applies all 500+ migrations at once. Under "all", every table, index and
   * foreign key those migrations create holds a lock for the entire run, and
   * the total outgrew Postgres's default lock table
   * (max_locks_per_transaction * max_connections), so the run aborted with
   * "out of shared memory ... increase max_locks_per_transaction". "each"
   * commits after every migration, so peak lock usage is one migration's worth
   * instead of the whole history's, and it no longer scales with the number of
   * migrations.
   *
   * Safe for every existing migration: each is still atomic on its own. It is
   * also more correct for the migrations that `SET LOCAL lock_timeout`, which
   * is transaction-scoped and under "all" would have leaked into every
   * migration that ran after them.
   *
   * "each" is also what lets one migration run outside a transaction: a
   * migration that sets `transaction = false` runs on its own, without one.
   * 1798300000000-AddLlmLogProjectCreatedAtIndex does, because CREATE INDEX
   * CONCURRENTLY cannot run inside a transaction block. Under "all" TypeORM
   * refuses such a migration (ForbiddenTransactionModeOverrideError) and the
   * whole run fails, on every install.
   */
  migrationsTransactionMode: "each",
  entities: Entities,
  applicationName: "oneuptime",
  ssl: ShouldDatabaseSslEnable
    ? {
        rejectUnauthorized: DatabaseRejectUnauthorized,
        ca: DatabaseSslCa,
        key: DatabaseSslKey,
        cert: DatabaseSslCert,
      }
    : false,
  /*
   * Anything in `extra` is forwarded to the underlying node-postgres pool
   * and client. Pool sizing + timeouts live here because TypeORM's defaults
   * (10 connections, no timeouts) are too small for any non-trivial load.
   */
  extra: {
    /*
     * The client every connection is opened with. It keeps query_timeout
     * below itself: a statement still running when it runs out is cancelled
     * on the database, and its connection closed rather than given back to
     * the pool - so a transaction it held open is rolled back by the
     * database, never committed by the next request to borrow it. Every
     * pool built from these options (the migration runner's, the failure
     * diagnosis') has it too. See CancelOnTimeoutClient.
     */
    Client: CancelOnTimeoutClient,
    max: MaxPostgresConnections,
    idleTimeoutMillis: PostgresIdleTimeoutMs,
    /*
     * Replace every connection once it is PostgresConnectionMaxLifetimeMs
     * old, so none stays open for the life of the process (see
     * EnvironmentConfig for why that matters). pg-pool closes an expired
     * connection when it is idle, never while a query or transaction has it.
     */
    ...(PostgresConnectionMaxLifetimeMs > 0
      ? { maxLifetimeSeconds: PostgresConnectionMaxLifetimeMs / 1000 }
      : {}),
    connectionTimeoutMillis: PostgresConnectionAcquireTimeoutMs,
    statement_timeout: PostgresStatementTimeoutMs,
    query_timeout: PostgresQueryTimeoutMs,
    idle_in_transaction_session_timeout: PostgresIdleInTransactionTimeoutMs,
    /*
     * Bound how long a statement WAITS for a lock, so contention on a hot row
     * fails fast instead of forming a queue (see PostgresLockTimeoutMs).
     *
     * Not on this pool in a process that runs migrations (App/Migrate.ts, and
     * every boot under docker compose). App/Migrate.ts connects DIRECTLY to the
     * backend (bypassing any pooler), where startup parameters really do take
     * effect, and its data migrations run on this pool and are left free to
     * wait for row locks, as they always were. Its SCHEMA migrations do not
     * run here: SchemaMigrationRunner gives them a connection of their own
     * with DATABASE_MIGRATION_LOCK_TIMEOUT_MS (2 s, below this 3 s) and
     * retries a migration that runs out - failing fast instead of queueing
     * ahead of every query on the table, without failing the deploy.
     */
    ...(PostgresLockTimeoutMs > 0 && !RunDatabaseMigrationsOnBoot
      ? { lock_timeout: PostgresLockTimeoutMs }
      : {}),
    /*
     * Detect dead TCP peers (ungraceful client exit / network partition) so
     * orphaned server-side connections get torn down instead of lingering
     * until the OS keepalive default (~2h).
     */
    keepAlive: true,
    keepAliveInitialDelayMillis: PostgresKeepAliveInitialDelayMs,
    /*
     * GUCs node-postgres has no first-class option for, in the libpq
     * `options` startup parameter (see postgresStartupOptions).
     */
    ...postgresStartupOptions(PostgresIdleSessionTimeoutMs),
  },
  /*
   * Log any query slower than the configured threshold so we can find
   * offenders in production. TypeORM emits these via the configured
   * logger; the default `advanced-console` logger writes to stdout.
   */
  maxQueryExecutionTime: PostgresSlowQueryLogThresholdMs,
  synchronize: false,
};

export default dataSourceOptions;
