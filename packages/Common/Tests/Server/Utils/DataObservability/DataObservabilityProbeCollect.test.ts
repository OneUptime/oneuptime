import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import {
  buildProbeCollectOptions,
  DATA_OBSERVABILITY_PROBE_RESULT_ROUTE,
  DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
  DataObservabilityProbeStoreWork,
  isCollectableVariable,
  readProbeCollectError,
  readProbeCollectWork,
  readTableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_TABLES_PER_COLLECTION,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";

/*
 * THE PROBE CONVERSATION'S CONTRACT, READ BY EACH SIDE.
 *
 * The probe reads work the server hands it; the server reads a snapshot a
 * probe sends, which it treats like anything it did not write: every field
 * checked, every list and string bounded, the probe's clock trusted for
 * nothing.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

describe("routes", () => {
  test("live beside Data Security's under /probe", () => {
    expect(DATA_OBSERVABILITY_PROBE_WORK_ROUTE).toBe(
      "/probe/data-observability/work",
    );
    expect(DATA_OBSERVABILITY_PROBE_RESULT_ROUTE).toBe(
      "/probe/data-observability/result",
    );
  });
});

describe("readProbeCollectWork", () => {
  test("reads a well-formed work item", () => {
    const work: DataObservabilityProbeStoreWork | null = readProbeCollectWork({
      dataStoreId: "11111111-1111-4111-8111-111111111111",
      engine: "postgresql",
      probeConnectionVariable: "ORDERS_DB_URL",
      maxTables: 100,
      maxColumns: 1000,
      exclusions: ["audit", 7, "public.tmp"],
    });

    expect(work).toEqual({
      dataStoreId: "11111111-1111-4111-8111-111111111111",
      engine: "postgresql",
      probeConnectionVariable: "ORDERS_DB_URL",
      maxTables: 100,
      maxColumns: 1000,
      exclusions: ["audit", "public.tmp"],
    });
    expect(buildProbeCollectOptions(work!)).toEqual({
      maxTables: 100,
      maxColumns: 1000,
      exclusions: ["audit", "public.tmp"],
    });
  });

  test("an engine no collector reads is not work", () => {
    expect(
      readProbeCollectWork({
        dataStoreId: "x",
        engine: "oracle",
        probeConnectionVariable: "DB",
      }),
    ).toBeNull();
    expect(readProbeCollectWork(null)).toBeNull();
  });

  test("limits above the collector's own are brought down to them", () => {
    expect(
      readProbeCollectWork({
        dataStoreId: "x",
        engine: "mysql",
        probeConnectionVariable: "DB",
        maxTables: 10_000_000,
      })!.maxTables,
    ).toBe(MAX_TABLES_PER_COLLECTION);
  });
});

describe("isCollectableVariable", () => {
  test("a shell variable's name, not one of the probe's own settings", () => {
    expect(isCollectableVariable("ORDERS_DB_URL")).toBe(true);
    expect(isCollectableVariable("orders_db")).toBe(false);
    expect(isCollectableVariable("PROBE_KEY")).toBe(false);
    expect(isCollectableVariable("ONEUPTIME_SECRET")).toBe(false);
  });
});

describe("readTableHealthSnapshot", () => {
  function snapshotOf(
    tables: Array<unknown>,
    extra: Record<string, unknown> = {},
  ): unknown {
    return {
      engine: "postgresql",
      collectedAt: "2026-11-03T11:59:00.000Z",
      isComplete: true,
      warnings: [],
      tables,
      ...extra,
    };
  }

  test("reads a well-formed snapshot", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      snapshotOf([
        {
          schema: "public",
          name: "orders",
          kind: DataAssetKind.Table,
          estimatedRows: "1000",
          sizeInBytes: 8192,
          writeCount: 3,
          secondsSinceChange: null,
          columns: [
            { name: "id", dataType: "bigint", isNullable: false, position: 1 },
          ],
        },
      ]),
      NOW,
    );

    expect(snapshot?.isComplete).toBe(true);
    expect(snapshot?.collectedAt).toBe("2026-11-03T11:59:00.000Z");
    expect(snapshot?.tables[0]).toEqual({
      schema: "public",
      name: "orders",
      kind: DataAssetKind.Table,
      estimatedRows: 1000,
      sizeInBytes: 8192,
      writeCount: 3,
      secondsSinceChange: null,
      columns: [
        { name: "id", dataType: "bigint", isNullable: false, position: 1 },
      ],
    });
  });

  test("anything that is not a snapshot is refused", () => {
    expect(readTableHealthSnapshot(null, NOW)).toBeNull();
    expect(readTableHealthSnapshot({ engine: "postgresql" }, NOW)).toBeNull();
    expect(
      readTableHealthSnapshot({ engine: "db2", tables: [] }, NOW),
    ).toBeNull();
  });

  test("tables that are not tables, and repeats, are dropped", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      snapshotOf([
        { schema: "public", name: "a", kind: DataAssetKind.Table },
        { schema: "public", name: "a", kind: DataAssetKind.Table },
        { schema: "public", name: "b", kind: "Index" },
        { schema: "public", kind: DataAssetKind.Table },
        "orders",
      ]),
      NOW,
    );

    expect(snapshot?.tables).toHaveLength(1);
  });

  test("names are cut so schema.table always fits the asset's key", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      snapshotOf([
        {
          schema: "s".repeat(5000),
          name: "t".repeat(5000),
          kind: DataAssetKind.Table,
        },
      ]),
      NOW,
    );

    expect(snapshot?.tables[0]!.schema).toHaveLength(MAX_IDENTIFIER_LENGTH);
    expect(snapshot?.tables[0]!.name).toHaveLength(MAX_IDENTIFIER_LENGTH);
  });

  test("columns a probe says it could not read stay unknown", () => {
    const snapshot: TableHealthSnapshot | null = readTableHealthSnapshot(
      snapshotOf([
        {
          schema: "public",
          name: "a",
          kind: DataAssetKind.Table,
          columns: null,
        },
      ]),
      NOW,
    );

    expect(snapshot?.tables[0]!.columns).toBeNull();
  });

  test("the probe's clock decides nothing: a time in the future or a day old is read as now", () => {
    expect(
      readTableHealthSnapshot(
        snapshotOf([], { collectedAt: "2030-01-01T00:00:00.000Z" }),
        NOW,
      )?.collectedAt,
    ).toBe(NOW.toISOString());
    expect(
      readTableHealthSnapshot(
        snapshotOf([], { collectedAt: "2026-10-01T00:00:00.000Z" }),
        NOW,
      )?.collectedAt,
    ).toBe(NOW.toISOString());
    expect(
      readTableHealthSnapshot(snapshotOf([], { collectedAt: "never" }), NOW)
        ?.collectedAt,
    ).toBe(NOW.toISOString());
  });

  test("a snapshot that does not say it is complete is not", () => {
    expect(
      readTableHealthSnapshot(snapshotOf([], { isComplete: "yes" }), NOW)
        ?.isComplete,
    ).toBe(false);
  });

  test("the database a probe read is kept as name, host and port, and nothing else", () => {
    expect(
      readTableHealthSnapshot(
        snapshotOf([], {
          target: {
            databaseName: "orders",
            host: "orders-db.internal",
            port: 5432,
            password: "never kept",
          },
        }),
        NOW,
      )?.target,
    ).toEqual({
      databaseName: "orders",
      host: "orders-db.internal",
      port: 5432,
    });
  });

  test("an older probe's snapshot, with no target, has none", () => {
    expect(readTableHealthSnapshot(snapshotOf([]), NOW)?.target).toBe(null);
  });
});

describe("readProbeCollectError", () => {
  test("a non-empty string, bounded; anything else is no error", () => {
    expect(readProbeCollectError("connection refused")).toBe(
      "connection refused",
    );
    expect(readProbeCollectError("x".repeat(10_000))).toHaveLength(1000);
    expect(readProbeCollectError("   ")).toBeNull();
    expect(readProbeCollectError(undefined)).toBeNull();
  });
});
