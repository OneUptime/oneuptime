import { describe, expect, test } from "@jest/globals";
import DataAssetKind, {
  DATA_ASSET_KINDS,
} from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshness,
  DataAssetFreshnessResult,
  getDataAssetFreshness,
  getDataAssetLateAt,
  MIN_LATENESS_SLACK_IN_SECONDS,
} from "../../../Types/DataObservability/DataAssetFreshness";
import {
  DATA_CHECK_HEALTH_ORDER,
  DATA_CHECK_HEALTHS_NEEDING_ATTENTION,
  DataAttentionItem,
  DataAttentionKind,
  DataCheckHealth,
  getDataAttentionOwnerKey,
  getDataCheckHealthRank,
  isDataCheckHealth,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import {
  DataPipelineLateness,
  DataPipelineTimeliness,
  getDataPipelineLateAt,
  getDataPipelineLateness,
  MAX_LATENESS_WATCH_IN_SECONDS,
  MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS,
} from "../../../Types/DataObservability/DataPipelineSchedule";

/*
 * WHAT A TABLE, A PIPELINE AND A CHECK KEEP OF HOW THEY STAND (#6550, #6552,
 * #6554).
 *
 * A table keeps when it is late (lateAt), a pipeline when its next run is
 * late, and a check its health and the health's place worst first. Lists
 * sort and filter by them on the server, and the menu counts by them, so each
 * must say exactly what the pages' own rules say: a table whose lateAt has
 * passed is the table its page calls Late, a pipeline whose lateAt has passed
 * is the pipeline Needs Attention calls late, and Checks orders failing
 * first.
 */

const HOUR: number = 60 * 60;
const CHANGED_AT: Date = new Date("2026-11-18T08:00:00.000Z");

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

describe("when a table is late (getDataAssetLateAt)", () => {
  test("twice its usual interval after its last change", () => {
    expect(
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt: CHANGED_AT,
        updateIntervalInSeconds: 6 * HOUR,
      })?.toISOString(),
    ).toBe(secondsAfter(CHANGED_AT, 12 * HOUR).toISOString());
  });

  test("at least fifteen minutes past its interval, for a table that changes every minute", () => {
    expect(
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt: CHANGED_AT,
        updateIntervalInSeconds: 60,
      })?.toISOString(),
    ).toBe(
      secondsAfter(CHANGED_AT, 60 + MIN_LATENESS_SLACK_IN_SECONDS).toISOString(),
    );
  });

  test("a time written as text reads as the same moment", () => {
    expect(
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt: CHANGED_AT.toISOString(),
        updateIntervalInSeconds: HOUR,
      })?.toISOString(),
    ).toBe(secondsAfter(CHANGED_AT, 2 * HOUR).toISOString());
  });

  test.each([
    ["a view", DataAssetKind.View, CHANGED_AT, HOUR],
    ["a foreign table", DataAssetKind.ForeignTable, CHANGED_AT, HOUR],
    ["a table never seen to change", DataAssetKind.Table, null, HOUR],
    ["a table whose rhythm is not known", DataAssetKind.Table, CHANGED_AT, null],
    ["a rhythm of nothing", DataAssetKind.Table, CHANGED_AT, 0],
    ["a negative rhythm", DataAssetKind.Table, CHANGED_AT, -60],
    ["a time that is no time", DataAssetKind.Table, "not a date", HOUR],
  ])(
    "none for %s",
    (
      _label: string,
      kind: DataAssetKind,
      lastChangedAt: Date | string | null,
      updateIntervalInSeconds: number | null,
    ) => {
      expect(
        getDataAssetLateAt({ kind, lastChangedAt, updateIntervalInSeconds }),
      ).toBeNull();
    },
  );

  test("a table of no kind yet is judged as a table", () => {
    expect(
      getDataAssetLateAt({
        kind: null,
        lastChangedAt: CHANGED_AT,
        updateIntervalInSeconds: HOUR,
      }),
    ).not.toBeNull();
  });

  /*
   * What the list asks - lateAt before now - is what the page's pill says,
   * for every kind and at every moment around the edge.
   */
  test.each(DATA_ASSET_KINDS.map((kind: DataAssetKind) => [kind]))(
    "a %s whose lateAt has passed is the one its page calls Late, and only that one",
    (kind: DataAssetKind) => {
      const lateAt: Date | null = getDataAssetLateAt({
        kind,
        lastChangedAt: CHANGED_AT,
        updateIntervalInSeconds: 2 * HOUR,
      });

      for (const offset of [-3600, -61, -1, 1, 2, 61, 3600, 86_400]) {
        const now: Date = secondsAfter(
          lateAt || secondsAfter(CHANGED_AT, 4 * HOUR),
          offset,
        );
        const result: DataAssetFreshnessResult = getDataAssetFreshness({
          kind,
          lastChangedAt: CHANGED_AT,
          updateIntervalInSeconds: 2 * HOUR,
          now,
        });
        const isLateByKeptTime: boolean = Boolean(
          lateAt && lateAt.getTime() <= now.getTime(),
        );

        expect({
          offset,
          late: result.freshness === DataAssetFreshness.Late,
        }).toEqual({ offset, late: isLateByKeptTime });

        if (result.lateAt) {
          expect(result.lateAt.toISOString()).toBe(lateAt?.toISOString());
        }
      }
    },
  );
});

describe("when a pipeline is late (getDataPipelineLateAt)", () => {
  test("its expected interval after its last start, and a quarter of it more", () => {
    expect(
      getDataPipelineLateAt({
        lastRunStartedAt: CHANGED_AT,
        expectedRunIntervalInSeconds: 4 * HOUR,
      })?.toISOString(),
    ).toBe(secondsAfter(CHANGED_AT, 5 * HOUR).toISOString());
  });

  test("at least fifteen minutes past its interval, for one that runs every five minutes", () => {
    expect(
      getDataPipelineLateAt({
        lastRunStartedAt: CHANGED_AT,
        expectedRunIntervalInSeconds: 300,
      })?.toISOString(),
    ).toBe(
      secondsAfter(
        CHANGED_AT,
        300 + MIN_PIPELINE_LATENESS_SLACK_IN_SECONDS,
      ).toISOString(),
    );
  });

  test.each([
    ["no run yet", null, HOUR],
    ["no schedule learned yet", CHANGED_AT, null],
    ["a schedule of nothing", CHANGED_AT, 0],
    ["a start that is no time", "soon", HOUR],
  ])(
    "none for %s",
    (
      _label: string,
      lastRunStartedAt: Date | string | null,
      expectedRunIntervalInSeconds: number | null,
    ) => {
      expect(
        getDataPipelineLateAt({
          lastRunStartedAt,
          expectedRunIntervalInSeconds,
        }),
      ).toBeNull();
    },
  );

  test("a pipeline whose lateAt has passed is the one Needs Attention calls late, until it is retired at thirty days", () => {
    const lateAt: Date = getDataPipelineLateAt({
      lastRunStartedAt: CHANGED_AT,
      expectedRunIntervalInSeconds: HOUR,
    })!;

    for (const offset of [-61, -1, 1, 61, HOUR, 86_400]) {
      const now: Date = secondsAfter(lateAt, offset);
      const lateness: DataPipelineLateness = getDataPipelineLateness({
        lastRunStartedAt: CHANGED_AT,
        expectedRunIntervalInSeconds: HOUR,
        now,
      });

      expect({
        offset,
        late: lateness.timeliness === DataPipelineTimeliness.Late,
      }).toEqual({ offset, late: lateAt.getTime() <= now.getTime() });
      expect(lateness.lateAt?.toISOString()).toBe(lateAt.toISOString());
    }

    // Retired: the count asks for a start in the last thirty days, as this does.
    expect(
      getDataPipelineLateness({
        lastRunStartedAt: CHANGED_AT,
        expectedRunIntervalInSeconds: HOUR,
        now: secondsAfter(CHANGED_AT, MAX_LATENESS_WATCH_IN_SECONDS + 1),
      }).timeliness,
    ).toBe(DataPipelineTimeliness.Unknown);
  });
});

describe("a check's health, kept in order", () => {
  test("failing first, then could not run, then passing, then what has nothing to say yet", () => {
    expect(DATA_CHECK_HEALTH_ORDER).toEqual([
      DataCheckHealth.Failing,
      DataCheckHealth.CouldNotRun,
      DataCheckHealth.Passing,
      DataCheckHealth.NoAlert,
      DataCheckHealth.Waiting,
      DataCheckHealth.Off,
    ]);
  });

  test("every health has a place, and each place is its own", () => {
    const ranks: Array<number> = Object.values(DataCheckHealth).map(
      (health: DataCheckHealth): number => {
        return getDataCheckHealthRank(health);
      },
    );

    expect(new Set(ranks).size).toBe(Object.values(DataCheckHealth).length);
    expect(getDataCheckHealthRank(DataCheckHealth.Failing)).toBe(0);
    expect(getDataCheckHealthRank(DataCheckHealth.Off)).toBe(5);
  });

  test("a health the list does not know sorts last", () => {
    expect(getDataCheckHealthRank("Melted" as DataCheckHealth)).toBe(
      DATA_CHECK_HEALTH_ORDER.length,
    );
  });

  test("failing and could not run are what the Overview counts as needing someone", () => {
    expect([...DATA_CHECK_HEALTHS_NEEDING_ATTENTION]).toEqual([
      DataCheckHealth.Failing,
      DataCheckHealth.CouldNotRun,
    ]);
  });

  test("a health is one of the words, written as stored", () => {
    for (const health of Object.values(DataCheckHealth)) {
      expect(isDataCheckHealth(health)).toBe(true);
    }

    for (const value of ["failing", "Ran", "", null, undefined, 0, {}]) {
      expect(isDataCheckHealth(value)).toBe(false);
    }
  });
});

describe("what an item's owners own (getDataAttentionOwnerKey)", () => {
  function item(fields: Partial<DataAttentionItem>): DataAttentionItem {
    return {
      kind: DataAttentionKind.TableLate,
      name: "public.orders",
      where: null,
      message: null,
      overdueBySeconds: 0,
      since: null,
      dataStoreId: null,
      dataAssetId: null,
      dataPipelineId: null,
      dataCheckId: null,
      dataProductId: null,
      dataReconciliationId: null,
      alert: null,
      ...fields,
    };
  }

  test("a table, and a check through its table", () => {
    expect(getDataAttentionOwnerKey(item({ dataAssetId: "a1" }))).toBe(
      "asset:a1",
    );
    expect(
      getDataAttentionOwnerKey(
        item({
          kind: DataAttentionKind.CheckFailing,
          dataCheckId: "c1",
          dataAssetId: "a1",
        }),
      ),
    ).toBe("asset:a1");
  });

  test("a pipeline's failed or late run, by its pipeline (#6551)", () => {
    expect(
      getDataAttentionOwnerKey(
        item({ kind: DataAttentionKind.PipelineFailed, dataPipelineId: "p1" }),
      ),
    ).toBe("pipeline:p1");
  });

  test("a data product, by itself", () => {
    expect(
      getDataAttentionOwnerKey(
        item({ kind: DataAttentionKind.DataProductLate, dataProductId: "d1" }),
      ),
    ).toBe("product:d1");
  });

  test("nothing for a database or a reconciliation", () => {
    expect(
      getDataAttentionOwnerKey(
        item({ kind: DataAttentionKind.CollectionFailed, dataStoreId: "s1" }),
      ),
    ).toBeNull();
    expect(
      getDataAttentionOwnerKey(
        item({
          kind: DataAttentionKind.ReconciliationDrifted,
          dataReconciliationId: "r1",
        }),
      ),
    ).toBeNull();
  });
});
