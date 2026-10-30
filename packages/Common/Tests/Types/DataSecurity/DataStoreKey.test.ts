import { describe, expect, test } from "@jest/globals";
import {
  cloudDataStoreKey,
  databaseServerDataStoreKey,
  telemetryDataStoreKey,
  tracedDatabaseDataStoreKey,
} from "../../../Types/DataSecurity/DataStoreKey";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";

/*
 * ONE KEY PER STORE, HOWEVER IT WAS FOUND.
 */

describe("cloudDataStoreKey", () => {
  test("keys a store by its provider, its kind and its provider's id", () => {
    expect(
      cloudDataStoreKey({
        provider: "aws",
        kind: DataStoreKind.AwsS3Bucket,
        providerResourceId: "arn:aws:s3:::Acme-Exports",
      }),
    ).toBe("cloud:aws:AWS S3 Bucket:arn:aws:s3:::Acme-Exports");
  });

  test("lower-cases Azure ids, which Azure treats without case", () => {
    const id: string =
      "/subscriptions/0000/resourceGroups/Data/providers/Microsoft.Storage/storageAccounts/AcmeStore";

    expect(
      cloudDataStoreKey({
        provider: "azure",
        kind: DataStoreKind.AzureStorageAccount,
        providerResourceId: id,
      }),
    ).toBe(`cloud:azure:Azure Storage Account:${id.toLowerCase()}`);
    expect(
      cloudDataStoreKey({
        provider: "azure",
        kind: DataStoreKind.AzureStorageAccount,
        providerResourceId: id,
      }),
    ).toBe(
      cloudDataStoreKey({
        provider: "azure",
        kind: DataStoreKind.AzureStorageAccount,
        providerResourceId: id.toUpperCase(),
      }),
    );
  });

  test("keeps the case of other providers' ids, and tells kinds apart", () => {
    const bucket: string = cloudDataStoreKey({
      provider: "gcp",
      kind: DataStoreKind.GcpStorageBucket,
      providerResourceId: "projects/_/buckets/Acme",
    });

    expect(bucket).toContain("Acme");
    expect(bucket).not.toBe(
      cloudDataStoreKey({
        provider: "gcp",
        kind: DataStoreKind.GcpBigQueryDataset,
        providerResourceId: "projects/_/buckets/Acme",
      }),
    );
  });

  test("is at most 500 characters", () => {
    expect(
      cloudDataStoreKey({
        provider: "aws",
        kind: DataStoreKind.AwsS3Bucket,
        providerResourceId: "x".repeat(1_000),
      }),
    ).toHaveLength(500);
  });
});

describe("telemetryDataStoreKey and databaseServerDataStoreKey", () => {
  test("key telemetry by service and signal, and monitored databases by their row", () => {
    expect(
      telemetryDataStoreKey({
        serviceId: "svc-1",
        kind: DataStoreKind.TelemetryLogs,
      }),
    ).toBe("telemetry:svc-1:Logs");
    expect(
      telemetryDataStoreKey({
        serviceId: "svc-1",
        kind: DataStoreKind.TelemetryTraces,
      }),
    ).not.toBe(
      telemetryDataStoreKey({
        serviceId: "svc-1",
        kind: DataStoreKind.TelemetryLogs,
      }),
    );
    expect(databaseServerDataStoreKey("db-row-7")).toBe("database:db-row-7");
  });
});

describe("tracedDatabaseDataStoreKey", () => {
  test("keys a traced database by engine, address and name, in lower case", () => {
    expect(
      tracedDatabaseDataStoreKey({
        system: "PostgreSQL",
        address: "DB.internal:5432",
        namespace: "Orders",
      }),
    ).toBe("traced:postgresql:db.internal:5432:orders");
    expect(
      tracedDatabaseDataStoreKey({ system: "redis", address: "cache:6379" }),
    ).toBe("traced:redis:cache:6379:");
  });

  test("is at most 500 characters", () => {
    expect(
      tracedDatabaseDataStoreKey({ system: "mysql", address: "a".repeat(600) }),
    ).toHaveLength(500);
  });
});
