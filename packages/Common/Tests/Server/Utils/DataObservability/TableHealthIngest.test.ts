import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataAssetColumnChangeKind } from "../../../../Types/DataObservability/DataAssetColumn";
import { DataObservabilityMetricName } from "../../../../Types/DataObservability/DataObservabilityMetric";
import ObjectID from "../../../../Types/ObjectID";
import {
  AssetPlan,
  detectChangeTime,
  getTableMetricValues,
  learnUpdateInterval,
  planAssetUpdate,
  PreviousAssetState,
} from "../../../../Server/Utils/DataObservability/TableHealthIngest";
import { CollectedTable } from "../../../../Server/Utils/DataObservability/TableHealthCollector";

/*
 * WHAT ONE COLLECTION MEANS FOR ONE TABLE.
 *
 * When a table last changed decides whether anyone is paged for it, so the
 * rules are pinned here: the engine's own time wins; else a write counter
 * or a row count that moved says "changed since the last collection" and
 * the collection's time is used - late, never early; a counter that went
 * down was reset and says nothing. And a table whose numbers did not move
 * is not written again.
 */

const COLLECTED_AT: Date = new Date("2026-11-03T12:00:00.000Z");
const FIVE_MINUTES_AGO: Date = new Date(COLLECTED_AT.getTime() - 5 * 60 * 1000);

function table(overrides: Partial<CollectedTable> = {}): CollectedTable {
  return {
    schema: "public",
    name: "orders",
    kind: DataAssetKind.Table,
    estimatedRows: 1000,
    sizeInBytes: 65536,
    writeCount: 5000,
    secondsSinceChange: null,
    columns: [
      { name: "id", dataType: "bigint", isNullable: false, position: 1 },
      { name: "total", dataType: "numeric", isNullable: true, position: 2 },
    ],
    ...overrides,
  };
}

function previous(
  overrides: Partial<PreviousAssetState> = {},
): PreviousAssetState {
  return {
    id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    columns: table().columns,
    rowCount: 1000,
    sizeInBytes: 65536,
    lastChangedAt: new Date("2026-11-03T11:00:00.000Z"),
    updateIntervalInSeconds: 3600,
    writeCount: 5000,
    isDropped: false,
    ...overrides,
  };
}

describe("detectChangeTime", () => {
  test("the engine's own time wins (MySQL, SQL Server)", () => {
    expect(
      detectChangeTime(
        previous(),
        table({ secondsSinceChange: 90, writeCount: 9999 }),
        COLLECTED_AT,
      )?.toISOString(),
    ).toBe("2026-11-03T11:58:30.000Z");
  });

  test("a write counter that moved means the table changed since the last collection (PostgreSQL)", () => {
    expect(
      detectChangeTime(previous(), table({ writeCount: 5001 }), COLLECTED_AT),
    ).toEqual(COLLECTED_AT);
  });

  test("a time only inserts move (MongoDB's newest ObjectId) gives way to a write counter that moved", () => {
    // The newest document is the one already known, but the collection took writes since.
    expect(
      detectChangeTime(
        previous(),
        table({ secondsSinceChange: 3600, writeCount: 5001 }),
        COLLECTED_AT,
      ),
    ).toEqual(COLLECTED_AT);
    // Nothing written since: the time stands.
    expect(
      detectChangeTime(
        previous(),
        table({ secondsSinceChange: 3600, writeCount: 5000 }),
        COLLECTED_AT,
      )?.toISOString(),
    ).toBe("2026-11-03T11:00:00.000Z");
  });

  test("a counter that went down was reset, and says nothing", () => {
    expect(
      detectChangeTime(
        previous({ writeCount: 5000 }),
        table({ writeCount: 12 }),
        COLLECTED_AT,
      ),
    ).toBeNull();
  });

  test("without a counter, a row count that moved says the table changed", () => {
    expect(
      detectChangeTime(
        previous({ writeCount: null }),
        table({ writeCount: null, estimatedRows: 1001 }),
        COLLECTED_AT,
      ),
    ).toEqual(COLLECTED_AT);
  });

  test("the first collection of a table without the engine's time cannot tell", () => {
    expect(detectChangeTime(null, table(), COLLECTED_AT)).toBeNull();
  });

  test("nothing moved: no change", () => {
    expect(detectChangeTime(previous(), table(), COLLECTED_AT)).toBeNull();
  });
});

describe("what a schema change is worth", () => {
  const before: CollectedTable["columns"] = [
    { name: "id", dataType: "bigint", isNullable: false, position: 1 },
    { name: "total", dataType: "numeric", isNullable: true, position: 2 },
  ];

  function metric(
    changed: CollectedTable,
    name: DataObservabilityMetricName,
  ): number | undefined {
    const plan: AssetPlan = planAssetUpdate(
      previous({ columns: before }),
      changed,
      COLLECTED_AT,
    );

    return getTableMetricValues({
      plan,
      table: changed,
      collectedAt: COLLECTED_AT,
    }).find((value: { name: string; value: number }) => {
      return value.name === name;
    })?.value;
  }

  test("an added column is a change, not a breaking one", () => {
    const added: CollectedTable = table({
      columns: [
        ...before!,
        { name: "note", dataType: "text", isNullable: true, position: 3 },
      ],
    });

    expect(metric(added, DataObservabilityMetricName.SchemaChanges)).toBe(1);
    expect(
      metric(added, DataObservabilityMetricName.BreakingSchemaChanges),
    ).toBe(0);
  });

  test("a removed column breaks what reads it, unless the columns were only worked out from documents", () => {
    const removed: CollectedTable = table({ columns: [before![0]!] });

    expect(
      metric(removed, DataObservabilityMetricName.BreakingSchemaChanges),
    ).toBe(1);
    expect(
      metric(
        { ...removed, columnsAreInferred: true },
        DataObservabilityMetricName.BreakingSchemaChanges,
      ),
    ).toBe(0);
  });
});

describe("learnUpdateInterval", () => {
  test("the first interval is taken as it is", () => {
    expect(
      learnUpdateInterval({
        previousIntervalInSeconds: null,
        previousChangeAt: FIVE_MINUTES_AGO,
        changeAt: COLLECTED_AT,
      }),
    ).toBe(300);
  });

  test("later intervals move the learned one a third of the way", () => {
    expect(
      learnUpdateInterval({
        previousIntervalInSeconds: 3600,
        previousChangeAt: FIVE_MINUTES_AGO,
        changeAt: COLLECTED_AT,
      }),
    ).toBe(Math.round(3600 * 0.7 + 300 * 0.3));
  });

  test("a second's jitter is not an interval", () => {
    expect(
      learnUpdateInterval({
        previousIntervalInSeconds: 3600,
        previousChangeAt: new Date(COLLECTED_AT.getTime() - 400),
        changeAt: COLLECTED_AT,
      }),
    ).toBe(3600);
  });

  test("with no change before, nothing is learned", () => {
    expect(
      learnUpdateInterval({
        previousIntervalInSeconds: null,
        previousChangeAt: null,
        changeAt: COLLECTED_AT,
      }),
    ).toBeNull();
  });
});

describe("detectChangeTime without a write counter", () => {
  test("Redshift and Snowflake keep no write counter: bytes that moved say it changed", () => {
    expect(
      detectChangeTime(
        previous({ writeCount: null }),
        table({ writeCount: null, sizeInBytes: 70000 }),
        COLLECTED_AT,
      ),
    ).toEqual(COLLECTED_AT);
  });

  test("with a write counter, bytes alone (a vacuum) say nothing", () => {
    expect(
      detectChangeTime(previous(), table({ sizeInBytes: 70000 }), COLLECTED_AT),
    ).toBe(null);
  });
});

describe("planAssetUpdate", () => {
  test("a read counter of 0 at first sight marks the table unread since the statistics started", () => {
    const plan: AssetPlan = planAssetUpdate(
      null,
      table({ readCount: 0 }),
      COLLECTED_AT,
      100 * 24 * 60 * 60,
    );

    expect(plan.reads).toEqual({
      readCount: 0,
      lastReadAt: null,
      unreadSince: new Date(COLLECTED_AT.getTime() - 100 * 24 * 60 * 60 * 1000),
    });
    expect(plan.collectionState["readCount"]).toBe(0);
  });

  test("a read counter that moved writes the read, even when nothing else moved", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous({
        reads: {
          readCount: 10,
          lastReadAt: new Date("2026-11-01T00:00:00.000Z"),
          unreadSince: new Date("2026-11-01T00:00:00.000Z"),
        },
      }),
      table({ readCount: 12 }),
      COLLECTED_AT,
    );

    expect(plan.needsWrite).toBe(true);
    expect(plan.reads.lastReadAt).toEqual(COLLECTED_AT);
    expect(plan.collectionState["readCount"]).toBe(12);
  });

  test("a table whose numbers did not move is not written again", () => {
    const plan: AssetPlan = planAssetUpdate(previous(), table(), COLLECTED_AT);

    expect(plan.needsWrite).toBe(false);
    expect(plan.columnChanges).toEqual([]);
    expect(plan.lastChangedAt).toEqual(previous().lastChangedAt);
  });

  test("a change moves the last change and teaches the interval", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous(),
      table({ writeCount: 6000, estimatedRows: 1100 }),
      COLLECTED_AT,
    );

    expect(plan.needsWrite).toBe(true);
    expect(plan.lastChangedAt).toEqual(COLLECTED_AT);
    expect(plan.updateIntervalInSeconds).toBe(3600);
  });

  test("the engine reporting the same change again does not count it twice", () => {
    const lastChangedAt: Date = new Date("2026-11-03T11:58:30.000Z");
    const plan: AssetPlan = planAssetUpdate(
      previous({ lastChangedAt, writeCount: null }),
      table({ writeCount: null, secondsSinceChange: 90 }),
      COLLECTED_AT,
    );

    expect(plan.lastChangedAt).toEqual(lastChangedAt);
    expect(plan.updateIntervalInSeconds).toBe(3600);
  });

  test("columns are compared with the last collection's", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous(),
      table({
        columns: [
          { name: "id", dataType: "bigint", isNullable: false, position: 1 },
        ],
      }),
      COLLECTED_AT,
    );

    expect(plan.columnChanges).toEqual([
      expect.objectContaining({
        kind: DataAssetColumnChangeKind.Removed,
        column: "total",
      }),
    ]);
    expect(plan.needsWrite).toBe(true);
  });

  test("columns a cut collection could not read are never compared (no false drops)", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous(),
      table({ columns: null }),
      COLLECTED_AT,
    );

    expect(plan.columnChanges).toEqual([]);
    expect(plan.columns).toBeNull();
    expect(plan.collectionState["columnsKnown"]).toBe(false);
  });

  test("columns are not compared when the last collection could not read them either", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous({ columns: null }),
      table(),
      COLLECTED_AT,
    );

    expect(plan.columnChanges).toEqual([]);
    // Now they are known, so the row is written to keep them.
    expect(plan.needsWrite).toBe(true);
  });

  test("a dropped table that is back is restored", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous({ isDropped: true }),
      table(),
      COLLECTED_AT,
    );

    expect(plan.isRestored).toBe(true);
    expect(plan.needsWrite).toBe(true);
  });

  test("the write counter is kept for the next collection to compare with", () => {
    expect(
      planAssetUpdate(previous(), table({ writeCount: 7 }), COLLECTED_AT)
        .collectionState["writeCount"],
    ).toBe(7);
  });
});

describe("getTableMetricValues", () => {
  test("a table gives row count, size, time since change and schema changes", () => {
    const plan: AssetPlan = planAssetUpdate(previous(), table(), COLLECTED_AT);
    const values: Map<string, number> = new Map(
      getTableMetricValues({
        table: table(),
        plan,
        collectedAt: COLLECTED_AT,
      }).map((value: { name: DataObservabilityMetricName; value: number }) => {
        return [value.name, value.value];
      }),
    );

    expect(values.get(DataObservabilityMetricName.RowCount)).toBe(1000);
    expect(values.get(DataObservabilityMetricName.Size)).toBe(65536);
    expect(values.get(DataObservabilityMetricName.SecondsSinceChange)).toBe(
      3600,
    );
    expect(values.get(DataObservabilityMetricName.SchemaChanges)).toBe(0);
  });

  test("a value the engine did not give is left out, never written as zero", () => {
    const unknown: CollectedTable = table({
      estimatedRows: null,
      sizeInBytes: null,
    });
    const plan: AssetPlan = planAssetUpdate(null, unknown, COLLECTED_AT);
    const names: Array<string> = getTableMetricValues({
      table: unknown,
      plan,
      collectedAt: COLLECTED_AT,
    }).map((value: { name: DataObservabilityMetricName; value: number }) => {
      return value.name;
    });

    expect(names).toEqual([DataObservabilityMetricName.SchemaChanges]);
  });

  test("a view gives schema changes only", () => {
    const view: CollectedTable = table({
      kind: DataAssetKind.View,
      estimatedRows: null,
      sizeInBytes: null,
      writeCount: null,
    });
    const names: Array<string> = getTableMetricValues({
      table: view,
      plan: planAssetUpdate(null, view, COLLECTED_AT),
      collectedAt: COLLECTED_AT,
    }).map((value: { name: DataObservabilityMetricName; value: number }) => {
      return value.name;
    });

    expect(names).toEqual([DataObservabilityMetricName.SchemaChanges]);
  });

  function valuesOf(data: {
    table: CollectedTable;
    plan: AssetPlan;
    previousRowCount?: number | null | undefined;
  }): Map<string, number> {
    return new Map(
      getTableMetricValues({
        table: data.table,
        plan: data.plan,
        collectedAt: COLLECTED_AT,
        previousRowCount: data.previousRowCount,
      }).map((value: { name: DataObservabilityMetricName; value: number }) => {
        return [value.name, value.value];
      }),
    );
  }

  test("a table on time writes 0 overdue, so its series exists before it is ever late", () => {
    // Changed an hour ago, usually changes hourly: late only after two hours.
    const unchanged: CollectedTable = table();
    const plan: AssetPlan = planAssetUpdate(
      previous(),
      unchanged,
      COLLECTED_AT,
    );

    expect(
      valuesOf({ table: unchanged, plan }).get(
        DataObservabilityMetricName.OverdueSeconds,
      ),
    ).toBe(0);
  });

  test("a late table writes how long it has been late, by the Late pill's rule", () => {
    // Last changed three hours ago, usually hourly: late at two hours, so an hour over.
    const unchanged: CollectedTable = table();
    const plan: AssetPlan = planAssetUpdate(
      previous({ lastChangedAt: new Date("2026-11-03T09:00:00.000Z") }),
      unchanged,
      COLLECTED_AT,
    );

    expect(
      valuesOf({ table: unchanged, plan }).get(
        DataObservabilityMetricName.OverdueSeconds,
      ),
    ).toBe(3600);
  });

  test("a table whose rhythm is not learned writes no overdue time, rather than 0", () => {
    const fresh: CollectedTable = table();
    const plan: AssetPlan = planAssetUpdate(
      previous({ updateIntervalInSeconds: null }),
      fresh,
      COLLECTED_AT,
    );

    expect(
      valuesOf({ table: fresh, plan }).has(
        DataObservabilityMetricName.OverdueSeconds,
      ),
    ).toBe(false);
  });

  test("the change in rows is written as a percent of the rows before", () => {
    const plan: AssetPlan = planAssetUpdate(
      previous({ rowCount: 2000 }),
      table(),
      COLLECTED_AT,
    );

    expect(
      valuesOf({ table: table(), plan, previousRowCount: 2000 }).get(
        DataObservabilityMetricName.RowCountChangePercent,
      ),
    ).toBe(-50);

    expect(
      valuesOf({
        table: table({ estimatedRows: 3001 }),
        plan,
        previousRowCount: 3000,
      }).get(DataObservabilityMetricName.RowCountChangePercent),
    ).toBe(0.03);

    expect(
      valuesOf({ table: table(), plan, previousRowCount: 1000 }).get(
        DataObservabilityMetricName.RowCountChangePercent,
      ),
    ).toBe(0);
  });

  test("no change in rows for a new table, an unknown count, or a table too small to read as a percent", () => {
    const plan: AssetPlan = planAssetUpdate(null, table(), COLLECTED_AT);

    for (const data of [
      { table: table(), previousRowCount: null },
      { table: table(), previousRowCount: undefined },
      { table: table({ estimatedRows: null }), previousRowCount: 5000 },
      // 999 rows to 1 would read as -99.9%: below 1,000 rows a percent is noise.
      { table: table({ estimatedRows: 1 }), previousRowCount: 999 },
    ]) {
      expect(
        valuesOf({ ...data, plan }).has(
          DataObservabilityMetricName.RowCountChangePercent,
        ),
      ).toBe(false);
    }
  });

  test("a view writes neither overdue time nor a change in rows", () => {
    const view: CollectedTable = table({
      kind: DataAssetKind.View,
      estimatedRows: 5000,
      sizeInBytes: null,
      writeCount: null,
    });
    const values: Map<string, number> = valuesOf({
      table: view,
      plan: planAssetUpdate(previous(), view, COLLECTED_AT),
      previousRowCount: 5000,
    });

    expect(values.has(DataObservabilityMetricName.OverdueSeconds)).toBe(false);
    expect(values.has(DataObservabilityMetricName.RowCountChangePercent)).toBe(
      false,
    );
  });
});
