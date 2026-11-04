import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { DatabaseEngine } from "../DataSecurity/Content/DatabaseSampler";
import {
  getDatabaseEngineOfKind,
  PROBE_SCANNABLE_KINDS,
} from "../DataSecurity/DataSecurityProbeScan";

/*
 * THE DATABASES DATA OBSERVABILITY COLLECTS, AND WITH WHICH ENGINE.
 *
 * Every database Data Security samples - PostgreSQL, MySQL and MariaDB, SQL
 * Server - and the warehouses it does not: Amazon Redshift, read over the
 * PostgreSQL protocol with its own catalog views; Snowflake, over its SQL API
 * (SnowflakeSqlApi); Google BigQuery, each dataset with its Google Cloud
 * connection's service account (BigQueryApi); ClickHouse, over its HTTP
 * interface (ClickHouseHttpApi); and Databricks, a Unity Catalog catalog at
 * a time (DatabricksApi). Data Security's own list and engine mapping are
 * left as they are: it does not sample a warehouse.
 */

export const DATA_OBSERVABILITY_KINDS: ReadonlyArray<DataStoreKind> = [
  ...PROBE_SCANNABLE_KINDS,
  DataStoreKind.AwsRedshiftCluster,
  DataStoreKind.Snowflake,
  DataStoreKind.GcpBigQueryDataset,
  DataStoreKind.ClickHouse,
  DataStoreKind.Databricks,
];

export const DATA_OBSERVABILITY_ENGINES: ReadonlyArray<DatabaseEngine> = [
  "postgresql",
  "mysql",
  "sqlserver",
  "redshift",
  "snowflake",
  "bigquery",
  "clickhouse",
  "databricks",
];

export function getCollectorEngineOfKind(
  kind: string | undefined | null,
): DatabaseEngine | null {
  if (kind === DataStoreKind.AwsRedshiftCluster) {
    return "redshift";
  }

  if (kind === DataStoreKind.Snowflake) {
    return "snowflake";
  }

  if (kind === DataStoreKind.GcpBigQueryDataset) {
    return "bigquery";
  }

  if (kind === DataStoreKind.ClickHouse) {
    return "clickhouse";
  }

  if (kind === DataStoreKind.Databricks) {
    return "databricks";
  }

  return getDatabaseEngineOfKind(kind);
}

export function isCollectorEngine(value: unknown): value is DatabaseEngine {
  return (
    typeof value === "string" &&
    (DATA_OBSERVABILITY_ENGINES as ReadonlyArray<string>).includes(value)
  );
}
