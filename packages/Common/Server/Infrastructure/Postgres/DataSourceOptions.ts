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
     * Server-side backstop for orphaned idle sessions. node-postgres has no
     * first-class option for this GUC, so pass it via the libpq `options`
     * startup parameter. Unitless values are milliseconds. Only applied when
     * > 0, and must exceed idleTimeoutMillis (see EnvironmentConfig) so the
     * pool reaps healthy idle connections before the server force-closes them.
     */
    ...(PostgresIdleSessionTimeoutMs > 0
      ? { options: `-c idle_session_timeout=${PostgresIdleSessionTimeoutMs}` }
      : {}),
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
