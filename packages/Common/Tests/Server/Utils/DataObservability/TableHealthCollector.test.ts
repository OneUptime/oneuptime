import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import {
  assembleSnapshot,
  readCount,
  readMySqlKind,
  readRedshiftKind,
  readRedshiftSize,
  readPostgresKind,
  readSqlServerKind,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";

/*
 * A CATALOG READ, PUT TOGETHER INTO A SNAPSHOT.
 *
 * The collector's statements are each engine's own; what is pinned here is
 * what the server relies on: kinds read right, counts that are never
 * negative or NaN, exclusions honoured, and - the one that would page
 * someone wrongly - a column list cut at its limit leaving the cut tables'
 * columns unknown rather than empty, and a table list cut at its limit
 * marking the snapshot incomplete so no table is called dropped.
 */

const COLLECTED_AT: Date = new Date("2026-11-03T12:00:00.000Z");

function rawTable(
  schema: string,
  name: string,
): {
  schema: string;
  name: string;
  kind: DataAssetKind;
  estimatedRows: number | null;
  sizeInBytes: number | null;
  writeCount: number | null;
  secondsSinceChange: number | null;
  readCount: number | null;
  secondsSinceRead: number | null;
} {
  return {
    schema,
    name,
    kind: DataAssetKind.Table,
    estimatedRows: 10,
    sizeInBytes: 8192,
    writeCount: 3,
    secondsSinceChange: null,
    readCount: 7,
    secondsSinceRead: 3600,
  };
}

function rawColumn(
  schema: string,
  table: string,
  name: string,
  position: number,
): {
  schema: string;
  table: string;
  column: {
    name: string;
    dataType: string;
    isNullable: boolean;
    position: number;
  };
} {
  return {
    schema,
    table,
    column: { name, dataType: "integer", isNullable: true, position },
  };
}

describe("kind readers", () => {
  test("PostgreSQL relkinds", () => {
    expect(readPostgresKind("r")).toBe(DataAssetKind.Table);
    expect(readPostgresKind("p")).toBe(DataAssetKind.PartitionedTable);
    expect(readPostgresKind("v")).toBe(DataAssetKind.View);
    expect(readPostgresKind("m")).toBe(DataAssetKind.MaterializedView);
    expect(readPostgresKind("f")).toBe(DataAssetKind.ForeignTable);
    // Indexes, sequences and TOAST tables are not data assets.
    expect(readPostgresKind("i")).toBeNull();
    expect(readPostgresKind("S")).toBeNull();
    expect(readPostgresKind("t")).toBeNull();
  });

  test("MySQL table types", () => {
    expect(readMySqlKind("BASE TABLE")).toBe(DataAssetKind.Table);
    expect(readMySqlKind("view")).toBe(DataAssetKind.View);
    expect(readMySqlKind("SYSTEM VIEW")).toBeNull();
    expect(readMySqlKind("SEQUENCE")).toBeNull();
  });

  test("SQL Server object types", () => {
    expect(readSqlServerKind("U ")).toBe(DataAssetKind.Table);
    expect(readSqlServerKind("V")).toBe(DataAssetKind.View);
    expect(readSqlServerKind("P")).toBeNull();
  });

  test("Redshift's tables and views; external tables and the rest are not watched", () => {
    expect(readRedshiftKind("BASE TABLE")).toBe(DataAssetKind.Table);
    expect(readRedshiftKind("view")).toBe(DataAssetKind.View);
    expect(readRedshiftKind("EXTERNAL TABLE")).toBeNull();
  });

  test("Redshift counts sizes in 1 MB blocks", () => {
    expect(readRedshiftSize(3)).toBe(3 * 1024 * 1024);
    expect(readRedshiftSize("12")).toBe(12 * 1024 * 1024);
    expect(readRedshiftSize(null)).toBeNull();
  });
});

describe("readCount", () => {
  test("reads numbers, bigints and numeric strings as whole numbers", () => {
    expect(readCount(42)).toBe(42);
    expect(readCount(BigInt(9_000_000_000))).toBe(9_000_000_000);
    expect(readCount("12345678901")).toBe(12345678901);
    expect(readCount(10.7)).toBe(10);
  });

  test("anything else, or a negative estimate, is unknown", () => {
    expect(readCount(null)).toBeNull();
    expect(readCount(undefined)).toBeNull();
    expect(readCount("")).toBeNull();
    expect(readCount("n/a")).toBeNull();
    // PostgreSQL's reltuples is -1 for a table never analyzed.
    expect(readCount(-1)).toBeNull();
  });
});

describe("assembleSnapshot", () => {
  test("puts each table with its columns, in position order", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "postgresql",
      read: {
        tables: [rawTable("public", "orders")],
        columns: [
          rawColumn("public", "orders", "total", 2),
          rawColumn("public", "orders", "id", 1),
        ],
        warnings: [],
        secondsSinceStatsReset: 86_400,
      },
      options: { maxTables: 100, maxColumns: 100, exclusions: [] },
      collectedAt: COLLECTED_AT,
    });

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.collectedAt).toBe(COLLECTED_AT.toISOString());
    // The read counters, and how long the engine has counted for.
    expect(snapshot.tables[0]!.readCount).toBe(7);
    expect(snapshot.tables[0]!.secondsSinceRead).toBe(3600);
    expect(snapshot.secondsSinceStatsReset).toBe(86_400);
    expect(
      snapshot.tables[0]!.columns!.map((item: { name: string }) => {
        return item.name;
      }),
    ).toEqual(["id", "total"]);
  });

  test("a table with no column rows has no columns, when the list was not cut", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "mysql",
      read: {
        tables: [rawTable("app", "empty")],
        columns: [],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: { maxTables: 100, maxColumns: 100, exclusions: [] },
      collectedAt: COLLECTED_AT,
    });

    expect(snapshot.tables[0]!.columns).toEqual([]);
  });

  test("a cut column list leaves the cut tables' columns unknown, never empty", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "postgresql",
      read: {
        tables: [
          rawTable("public", "a"),
          rawTable("public", "b"),
          rawTable("public", "c"),
        ],
        columns: [
          rawColumn("public", "a", "id", 1),
          rawColumn("public", "a", "name", 2),
          // The limit cut b part way: its one column here may not be all.
          rawColumn("public", "b", "id", 1),
        ],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: { maxTables: 100, maxColumns: 3, exclusions: [] },
      collectedAt: COLLECTED_AT,
    });

    const byName: Map<string, unknown> = new Map(
      snapshot.tables.map((item: { name: string; columns: unknown }) => {
        return [item.name, item.columns];
      }),
    );

    expect(byName.get("a")).toHaveLength(2);
    expect(byName.get("b")).toBeNull();
    expect(byName.get("c")).toBeNull();
    expect(snapshot.warnings.join(" ")).toContain("columns were read");
  });

  test("a table list cut at its limit is incomplete, so absence proves nothing", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "sqlserver",
      read: {
        tables: [rawTable("dbo", "a"), rawTable("dbo", "b")],
        columns: [],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: { maxTables: 2, maxColumns: 100, exclusions: [] },
      collectedAt: COLLECTED_AT,
    });

    expect(snapshot.isComplete).toBe(false);
    expect(snapshot.warnings.join(" ")).toContain("first 2 tables");
  });

  test("exclusions by schema, table, or schema.table leave tables out, without regard to case", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "postgresql",
      read: {
        tables: [
          rawTable("audit", "events"),
          rawTable("public", "Sessions"),
          rawTable("public", "tmp_import"),
          rawTable("public", "orders"),
        ],
        columns: [],
        warnings: [],
        secondsSinceStatsReset: null,
      },
      options: {
        maxTables: 100,
        maxColumns: 100,
        exclusions: ["AUDIT", "sessions", "public.tmp_import", "  "],
      },
      collectedAt: COLLECTED_AT,
    });

    expect(
      snapshot.tables.map((item: { name: string }) => {
        return item.name;
      }),
    ).toEqual(["orders"]);
  });

  test("keeps the collection's warnings", () => {
    const snapshot: TableHealthSnapshot = assembleSnapshot({
      engine: "mysql",
      read: {
        tables: [],
        columns: [],
        warnings: ["Write counters were left out"],
        secondsSinceStatsReset: null,
      },
      options: { maxTables: 100, maxColumns: 100, exclusions: [] },
      collectedAt: COLLECTED_AT,
    });

    expect(snapshot.warnings).toEqual(["Write counters were left out"]);
  });
});
