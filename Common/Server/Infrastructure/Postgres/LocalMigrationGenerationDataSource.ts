import dataSourceOptions from "./DataSourceOptions";
import { DataSource } from "typeorm";

/*
 * The app reaches Postgres over the compose network as `postgres:5432`, but the
 * migration CLI runs on the host, where the same server is published on
 * localhost:5400 — hence the defaults below.
 *
 * DATABASE_MIGRATIONS_HOST / DATABASE_MIGRATIONS_PORT (already in
 * config.example.env, already honoured by migration-run.sh) override them, so
 * the schema-drift job can point this at a CI service container on a different
 * port without editing the file.
 */
const dataSourceOptionToMigrate: any = {
  ...dataSourceOptions,
  host: process.env["DATABASE_MIGRATIONS_HOST"] || "localhost",
  port: parseInt(process.env["DATABASE_MIGRATIONS_PORT"] || "5400", 10),
};

const PostgresDataSource: DataSource = new DataSource(
  dataSourceOptionToMigrate,
);

export default PostgresDataSource;
