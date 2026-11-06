import { describe, expect, test } from "@jest/globals";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../../Types/ObjectID";
import {
  buildConnectionExample,
  getSuggestedEngine,
  isStoreConnected,
  readTracedTarget,
} from "../../../../Server/Utils/DataObservability/DataSourceSuggestions";

/*
 * A database the project knows of, from its traces, its cloud accounts or
 * Database Monitoring, that nobody has connected.
 */

const CONNECTION: ObjectID = new ObjectID(
  "7f9c24e8-3b12-4fef-91e2-111111111111",
);

describe("a store with a way in", () => {
  test("a connection string or a probe", () => {
    expect(
      isStoreConnected({
        kind: DataStoreKind.PostgreSql,
        connectionString: "postgres://a",
      }),
    ).toBe(true);
    expect(
      isStoreConnected({
        kind: DataStoreKind.PostgreSql,
        scanProbeId: CONNECTION,
      }),
    ).toBe(true);
  });

  test("a cloud connection is enough only for BigQuery and a bucket with paths", () => {
    expect(
      isStoreConnected({
        kind: DataStoreKind.PostgreSql,
        cloudConnectionId: CONNECTION,
      }),
    ).toBe(false);
    expect(
      isStoreConnected({
        kind: DataStoreKind.GcpBigQueryDataset,
        cloudConnectionId: CONNECTION,
      }),
    ).toBe(true);
    expect(
      isStoreConnected({
        kind: DataStoreKind.AwsS3Bucket,
        cloudConnectionId: CONNECTION,
      }),
    ).toBe(false);
    expect(
      isStoreConnected({
        kind: DataStoreKind.AwsS3Bucket,
        cloudConnectionId: CONNECTION,
        watchedPaths: "orders/",
      }),
    ).toBe(true);
  });
});

describe("which engine to start from", () => {
  test("what we read is itself", () => {
    expect(getSuggestedEngine(DataStoreKind.PostgreSql)).toBe(
      DataStoreKind.PostgreSql,
    );
    expect(getSuggestedEngine(DataStoreKind.AwsRedshiftCluster)).toBe(
      DataStoreKind.AwsRedshiftCluster,
    );
  });

  test("a cloud database speaks its engine, or asks", () => {
    expect(getSuggestedEngine(DataStoreKind.AzurePostgreSqlServer)).toBe(
      DataStoreKind.PostgreSql,
    );
    expect(getSuggestedEngine(DataStoreKind.AwsDocumentDbCluster)).toBe(
      DataStoreKind.MongoDb,
    );
    expect(getSuggestedEngine(DataStoreKind.AwsRdsInstance)).toBeNull();
  });

  test("what we cannot read is not suggested", () => {
    expect(getSuggestedEngine(DataStoreKind.Redis)).toBeUndefined();
    expect(getSuggestedEngine(DataStoreKind.AwsS3Bucket)).toBeUndefined();
    expect(getSuggestedEngine(null)).toBeUndefined();
  });
});

describe("a connection string to start from", () => {
  test("holds what is known, and placeholders for the rest", () => {
    expect(
      buildConnectionExample({
        kind: DataStoreKind.PostgreSql,
        host: "orders-db.internal",
        port: null,
        databaseName: "orders",
      }),
    ).toBe(
      "postgres://USER:PASSWORD@orders-db.internal:5432/orders?sslmode=require",
    );
    expect(
      buildConnectionExample({
        kind: DataStoreKind.MySql,
        host: "db",
        port: 3307,
        databaseName: null,
      }),
    ).toBe("mysql://USER:PASSWORD@db:3307");
  });

  test("no host, or a format that is not a URL, has none", () => {
    expect(
      buildConnectionExample({
        kind: DataStoreKind.PostgreSql,
        host: null,
        port: null,
        databaseName: "orders",
      }),
    ).toBeNull();
    expect(
      buildConnectionExample({
        kind: DataStoreKind.Snowflake,
        host: "acme",
        port: null,
        databaseName: null,
      }),
    ).toBeNull();
    expect(
      buildConnectionExample({
        kind: null,
        host: "acme",
        port: null,
        databaseName: null,
      }),
    ).toBeNull();
  });
});

describe("what a store seen only in traces says of itself", () => {
  test("its key names its host and database", () => {
    expect(readTracedTarget("traced:postgresql:orders-db:orders")).toEqual({
      host: "orders-db",
      databaseName: "orders",
    });
    expect(readTracedTarget("traced:postgresql:orders-db:")).toEqual({
      host: "orders-db",
      databaseName: null,
    });
  });

  test("any other key says nothing", () => {
    expect(readTracedTarget("manual:abc")).toEqual({
      host: null,
      databaseName: null,
    });
    expect(readTracedTarget(null)).toEqual({ host: null, databaseName: null });
  });
});
