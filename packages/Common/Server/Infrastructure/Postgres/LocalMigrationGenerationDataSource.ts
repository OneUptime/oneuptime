import dataSourceOptions from "./DataSourceOptions";
import { getHostPostgresPort } from "./HostPostgresPort";
import { DataSource } from "typeorm";

/*
 * The app reaches Postgres over the compose network as `postgres:5432`, but the
 * migration CLI runs on the host, where the same server is published on
 * localhost at DATABASE_PUBLISHED_PORT (5400 unless config.env moves it) —
 * hence the defaults below.
 *
 * DATABASE_MIGRATIONS_HOST / DATABASE_MIGRATIONS_PORT (in config.example.env)
 * override them, so the schema-drift job can point this at a CI service
 * container on a different port without editing the file. An empty one is
 * not set.
 */
const dataSourceOptionToMigrate: any = {
  ...dataSourceOptions,
  host: process.env["DATABASE_MIGRATIONS_HOST"] || "localhost",
  port: getHostPostgresPort(process.env),
};

const PostgresDataSource: DataSource = new DataSource(
  dataSourceOptionToMigrate,
);

export default PostgresDataSource;
