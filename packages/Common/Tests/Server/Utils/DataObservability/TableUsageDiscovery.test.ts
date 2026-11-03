import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import { DataAssetAccessKind } from "../../../../Types/DataObservability/DataAssetUsage";
import {
  addUsageMatch,
  buildTableUsageStatement,
  getUsageKey,
  readClickhouseDate,
  readSpanTableUsageRow,
  UsageDraft,
} from "../../../../Server/Utils/DataObservability/TableUsageDiscovery";
import {
  SpanTableUsageRow,
  TableUsageMatch,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";

/*
 * Discovery reads a project's database spans once per run and keeps one
 * row per table, service and way. The read and the folding of its rows are
 * pinned here; matching a row to a table is TableUsageMatching's.
 */

const SERVICE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function row(overrides: Partial<SpanTableUsageRow> = {}): SpanTableUsageRow {
  return {
    serviceId: SERVICE_ID,
    dbSystem: "postgresql",
    dbNamespace: "orders",
    serverAddress: "orders-db",
    collection: "orders",
    operation: "INSERT",
    callCount: 10,
    errorCount: 1,
    lastSeenAt: new Date("2026-11-03T12:00:00.000Z"),
    ...overrides,
  };
}

function match(overrides: Partial<TableUsageMatch> = {}): TableUsageMatch {
  return {
    asset: {
      dataAssetId: "asset-orders",
      dataStoreId: "store-orders",
      schemaName: "public",
      name: "orders",
    },
    accessKind: DataAssetAccessKind.Write,
    operation: "INSERT",
    ...overrides,
  };
}

describe("buildTableUsageStatement", () => {
  test("reads one project's client spans to a database, in the window, grouped", () => {
    const projectId: ObjectID = ObjectID.generate();
    const statement: Statement = buildTableUsageStatement({
      projectId,
      since: new Date("2026-11-03T11:00:00.000Z"),
      until: new Date("2026-11-03T12:00:00.000Z"),
    });
    const sql: string = statement.query;

    expect(sql).toContain("attributes['db.collection.name']");
    expect(sql).toContain("attributes['db.sql.table']");
    expect(sql).toContain("attributes['db.operation.name']");
    expect(sql).toContain("attributes['db.namespace']");
    expect(sql).toContain(
      "GROUP BY serviceId, dbSystem, dbNamespace, serverAddress, collection, operation",
    );
    expect(sql).toContain("WHERE dbSystem != '' AND collection != ''");
    // Values travel as parameters, never in the text.
    expect(sql).not.toContain(projectId.toString());
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(Object.values(statement.query_params)).toContain("SPAN_KIND_CLIENT");
  });
});

describe("readSpanTableUsageRow", () => {
  test("a row ClickHouse hands back, read as numbers and a date", () => {
    expect(
      readSpanTableUsageRow({
        serviceId: SERVICE_ID,
        dbSystem: "postgresql",
        dbNamespace: "orders",
        serverAddress: "orders-db",
        collection: "public.orders",
        operation: "SELECT",
        callCount: "42",
        errorCount: "2",
        lastSeenAt: "2026-11-03 11:59:58.123456",
      }),
    ).toEqual({
      serviceId: SERVICE_ID,
      dbSystem: "postgresql",
      dbNamespace: "orders",
      serverAddress: "orders-db",
      collection: "public.orders",
      operation: "SELECT",
      callCount: 42,
      errorCount: 2,
      lastSeenAt: new Date("2026-11-03T11:59:58.123Z"),
    });
  });

  test("a row with no service or no time is dropped", () => {
    expect(
      readSpanTableUsageRow({
        serviceId: "",
        lastSeenAt: "2026-11-03 12:00:00",
      }),
    ).toBe(null);
    expect(
      readSpanTableUsageRow({ serviceId: SERVICE_ID, lastSeenAt: "" }),
    ).toBe(null);
  });

  test("ClickHouse dates are UTC", () => {
    expect(readClickhouseDate("2026-11-03 12:00:00")?.toISOString()).toBe(
      "2026-11-03T12:00:00.000Z",
    );
    expect(readClickhouseDate("not a date")).toBe(null);
    expect(readClickhouseDate(null)).toBe(null);
  });
});

describe("addUsageMatch", () => {
  test("groups of one table, service and way fold into one, operations kept once", () => {
    const drafts: Map<string, UsageDraft> = new Map();

    addUsageMatch({ drafts, row: row(), match: match() });
    addUsageMatch({
      drafts,
      row: row({
        operation: "UPDATE",
        callCount: 5,
        errorCount: 0,
        lastSeenAt: new Date("2026-11-03T12:05:00.000Z"),
      }),
      match: match({ operation: "UPDATE" }),
    });
    addUsageMatch({ drafts, row: row({ callCount: 1 }), match: match() });

    expect(Array.from(drafts.values())).toEqual([
      {
        dataAssetId: "asset-orders",
        dataStoreId: "store-orders",
        serviceId: SERVICE_ID,
        accessKind: DataAssetAccessKind.Write,
        operations: ["INSERT", "UPDATE"],
        callCount: 16,
        errorCount: 2,
        lastSeenAt: new Date("2026-11-03T12:05:00.000Z"),
      },
    ]);
  });

  test("reading and writing the same table are two rows", () => {
    const drafts: Map<string, UsageDraft> = new Map();

    addUsageMatch({ drafts, row: row(), match: match() });
    addUsageMatch({
      drafts,
      row: row({ operation: "SELECT" }),
      match: match({
        accessKind: DataAssetAccessKind.Read,
        operation: "SELECT",
      }),
    });

    expect(drafts.size).toBe(2);
  });

  test("the key names the service and the way", () => {
    expect(
      getUsageKey({
        serviceId: SERVICE_ID,
        accessKind: DataAssetAccessKind.Read,
      }),
    ).toBe(`${SERVICE_ID}:Read`);
  });
});
