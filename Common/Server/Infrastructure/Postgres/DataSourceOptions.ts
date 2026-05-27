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
  PostgresIdleTimeoutMs,
  PostgresQueryTimeoutMs,
  PostgresSlowQueryLogThresholdMs,
  PostgresStatementTimeoutMs,
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
  migrationsRun: true,
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
