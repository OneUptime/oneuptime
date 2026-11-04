import { describe, expect, test } from "@jest/globals";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  DATA_OBSERVABILITY_KINDS,
  getCollectorEngineOfKind,
  isCollectorEngine,
} from "../../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { getDatabaseEngineOfKind } from "../../../../Server/Utils/DataSecurity/DataSecurityProbeScan";

/*
 * Data Observability collects every database Data Security samples, and
 * the warehouses Data Security does not sample - Amazon Redshift,
 * Snowflake, BigQuery, ClickHouse and Databricks: its own mapping is left
 * as it is.
 */

describe("DataObservabilityEngines", () => {
  test("the databases Data Security samples, and the warehouses", () => {
    expect(DATA_OBSERVABILITY_KINDS).toEqual([
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
      DataStoreKind.AwsRedshiftCluster,
      DataStoreKind.Snowflake,
      DataStoreKind.GcpBigQueryDataset,
      DataStoreKind.ClickHouse,
      DataStoreKind.Databricks,
      DataStoreKind.AwsAthena,
    ]);
  });

  test("each kind's engine", () => {
    expect(getCollectorEngineOfKind(DataStoreKind.PostgreSql)).toBe(
      "postgresql",
    );
    expect(getCollectorEngineOfKind(DataStoreKind.MySql)).toBe("mysql");
    expect(getCollectorEngineOfKind(DataStoreKind.SqlServer)).toBe("sqlserver");
    expect(getCollectorEngineOfKind(DataStoreKind.AwsRedshiftCluster)).toBe(
      "redshift",
    );
    expect(getCollectorEngineOfKind(DataStoreKind.Snowflake)).toBe("snowflake");
    expect(getCollectorEngineOfKind(DataStoreKind.GcpBigQueryDataset)).toBe(
      "bigquery",
    );
    expect(getCollectorEngineOfKind(DataStoreKind.ClickHouse)).toBe(
      "clickhouse",
    );
    expect(getCollectorEngineOfKind(DataStoreKind.Databricks)).toBe(
      "databricks",
    );
    expect(getCollectorEngineOfKind(DataStoreKind.AwsAthena)).toBe("athena");
    expect(getCollectorEngineOfKind(DataStoreKind.AwsS3Bucket)).toBe(null);
  });

  test("Data Security still samples no warehouse", () => {
    expect(getDatabaseEngineOfKind(DataStoreKind.AwsRedshiftCluster)).toBe(
      null,
    );
    expect(getDatabaseEngineOfKind(DataStoreKind.Snowflake)).toBe(null);
    expect(getDatabaseEngineOfKind(DataStoreKind.GcpBigQueryDataset)).toBe(
      null,
    );
    expect(getDatabaseEngineOfKind(DataStoreKind.ClickHouse)).toBe(null);
    expect(getDatabaseEngineOfKind(DataStoreKind.Databricks)).toBe(null);
  });

  test("a probe's snapshot may come from any engine collected", () => {
    expect(isCollectorEngine("redshift")).toBe(true);
    expect(isCollectorEngine("clickhouse")).toBe(true);
    expect(isCollectorEngine("databricks")).toBe(true);
    expect(isCollectorEngine("postgresql")).toBe(true);
    expect(isCollectorEngine("db2")).toBe(false);
    expect(isCollectorEngine(undefined)).toBe(false);
  });
});
