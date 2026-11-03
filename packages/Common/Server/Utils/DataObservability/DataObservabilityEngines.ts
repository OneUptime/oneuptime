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
 * PostgreSQL protocol with its own catalog views. Data Security's own list
 * and engine mapping are left as they are: it does not sample a warehouse.
 */

export const DATA_OBSERVABILITY_KINDS: ReadonlyArray<DataStoreKind> = [
  ...PROBE_SCANNABLE_KINDS,
  DataStoreKind.AwsRedshiftCluster,
];

export const DATA_OBSERVABILITY_ENGINES: ReadonlyArray<DatabaseEngine> = [
  "postgresql",
  "mysql",
  "sqlserver",
  "redshift",
];

export function getCollectorEngineOfKind(
  kind: string | undefined | null,
): DatabaseEngine | null {
  if (kind === DataStoreKind.AwsRedshiftCluster) {
    return "redshift";
  }

  return getDatabaseEngineOfKind(kind);
}

export function isCollectorEngine(value: unknown): value is DatabaseEngine {
  return (
    typeof value === "string" &&
    (DATA_OBSERVABILITY_ENGINES as ReadonlyArray<string>).includes(value)
  );
}
