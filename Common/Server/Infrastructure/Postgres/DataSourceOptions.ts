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
   * Schema migrations run on connect unless disabled (e.g. runtime pods when a
   * dedicated migrate Job owns migrations). See RunDatabaseMigrationsOnBoot.
   */
  migrationsRun: RunDatabaseMigrationsOnBoot,
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
    max: MaxPostgresConnections,
    idleTimeoutMillis: PostgresIdleTimeoutMs,
    connectionTimeoutMillis: PostgresConnectionAcquireTimeoutMs,
    statement_timeout: PostgresStatementTimeoutMs,
    query_timeout: PostgresQueryTimeoutMs,
    idle_in_transaction_session_timeout: PostgresIdleInTransactionTimeoutMs,
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
