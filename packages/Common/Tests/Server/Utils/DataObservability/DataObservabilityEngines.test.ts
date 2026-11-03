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
 * Amazon Redshift, which Data Security does not sample: its own mapping is
 * left as it is.
 */

describe("DataObservabilityEngines", () => {
  test("the databases Data Security samples, and Redshift", () => {
    expect(DATA_OBSERVABILITY_KINDS).toEqual([
      DataStoreKind.PostgreSql,
      DataStoreKind.MySql,
      DataStoreKind.SqlServer,
      DataStoreKind.AwsRedshiftCluster,
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
    expect(getCollectorEngineOfKind(DataStoreKind.AwsS3Bucket)).toBe(null);
  });

  test("Data Security still samples no warehouse", () => {
    expect(getDatabaseEngineOfKind(DataStoreKind.AwsRedshiftCluster)).toBe(
      null,
    );
  });

  test("a probe's snapshot may come from any engine collected", () => {
    expect(isCollectorEngine("redshift")).toBe(true);
    expect(isCollectorEngine("postgresql")).toBe(true);
    expect(isCollectorEngine("db2")).toBe(false);
    expect(isCollectorEngine(undefined)).toBe(false);
  });
});
