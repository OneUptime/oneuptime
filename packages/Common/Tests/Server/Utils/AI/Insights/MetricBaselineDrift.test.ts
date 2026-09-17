import { afterEach, describe, expect, test } from "@jest/globals";
import MetricBaselineService, {
  MetricBaselineService as MetricBaselineServiceClass,
  MetricDriftWindowRow,
} from "../../../../../Server/Services/MetricBaselineService";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: getWeekOverWeekDrift issues exactly two finalizing
 * GROUP BY (name, primaryEntityId) queries over the MetricBaselineHourly
 * states — "recent" = last 7 days, "prior" = days 14..8 back — each capped
 * at DRIFT_MAX_ROWS_PER_WINDOW rows ranked by sampleCount, with the
 * projectId escaped into the SQL literal, and tags every returned row with
 * its window so the caller's pure join can pair them.
 */

type FakeResultSet = {
  json: () => Promise<{
    data: Array<{
      name: string;
      primaryEntityId: string;
      mean: number | string;
      sampleCount: number | string;
    }>;
  }>;
};

function fakeResultSet(
  data: Array<{
    name: string;
    primaryEntityId: string;
    mean: number | string;
    sampleCount: number | string;
  }>,
): FakeResultSet {
  return {
    json: () => {
      return Promise.resolve({ data });
    },
  };
}

describe("MetricBaselineService.getWeekOverWeekDrift", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("issues recent and prior window queries with the merge/group/cap shape", async () => {
    const executeQuerySpy: jest.SpyInstance = jest
      .spyOn(MetricBaselineService, "executeQuery")
      .mockResolvedValueOnce(
        fakeResultSet([
          {
            name: "cpu.usage",
            primaryEntityId: "svc-1",
            mean: "12.5",
            sampleCount: "400",
          },
        ]) as unknown as Awaited<
          ReturnType<typeof MetricBaselineService.executeQuery>
        >,
      )
      .mockResolvedValueOnce(
        fakeResultSet([
          {
            name: "cpu.usage",
            primaryEntityId: "svc-1",
            mean: 25,
            sampleCount: 380,
          },
        ]) as unknown as Awaited<
          ReturnType<typeof MetricBaselineService.executeQuery>
        >,
      );

    const projectId: ObjectID = ObjectID.generate();
    const rows: Array<MetricDriftWindowRow> =
      await MetricBaselineService.getWeekOverWeekDrift({
        projectId,
        limitPerWindow: 500,
      });

    expect(executeQuerySpy).toHaveBeenCalledTimes(2);

    const recentSql: string = String(executeQuerySpy.mock.calls[0]![0]);
    expect(recentSql).toContain("avgMerge(meanState)");
    expect(recentSql).toContain("countMerge(sampleCountState)");
    expect(recentSql).toContain("FROM MetricBaselineHourly");
    expect(recentSql).toContain(`projectId = '${projectId.toString()}'`);
    expect(recentSql).toContain("day >= today() - INTERVAL 7 DAY");
    expect(recentSql).toContain("GROUP BY name, primaryEntityId");
    expect(recentSql).toContain("ORDER BY sampleCount DESC");
    expect(recentSql).toContain("LIMIT 500");

    const priorSql: string = String(executeQuerySpy.mock.calls[1]![0]);
    expect(priorSql).toContain(
      "day BETWEEN today() - INTERVAL 14 DAY AND today() - INTERVAL 8 DAY",
    );
    expect(priorSql).toContain("GROUP BY name, primaryEntityId");
    expect(priorSql).toContain("LIMIT 500");

    // Rows are window-tagged and numerically coerced (string or number).
    expect(rows).toEqual([
      {
        name: "cpu.usage",
        primaryEntityId: "svc-1",
        mean: 12.5,
        sampleCount: 400,
        window: "recent",
      },
      {
        name: "cpu.usage",
        primaryEntityId: "svc-1",
        mean: 25,
        sampleCount: 380,
        window: "prior",
      },
    ]);
  });

  test("clamps the per-window limit to the hard cap and to a floor of 1", async () => {
    const executeQuerySpy: jest.SpyInstance = jest
      .spyOn(MetricBaselineService, "executeQuery")
      .mockResolvedValue(
        fakeResultSet([]) as unknown as Awaited<
          ReturnType<typeof MetricBaselineService.executeQuery>
        >,
      );

    await MetricBaselineService.getWeekOverWeekDrift({
      projectId: ObjectID.generate(),
      limitPerWindow: 10_000,
    });
    expect(String(executeQuerySpy.mock.calls[0]![0])).toContain(
      `LIMIT ${MetricBaselineServiceClass.DRIFT_MAX_ROWS_PER_WINDOW}`,
    );

    executeQuerySpy.mockClear();
    await MetricBaselineService.getWeekOverWeekDrift({
      projectId: ObjectID.generate(),
      limitPerWindow: 0,
    });
    expect(String(executeQuerySpy.mock.calls[0]![0])).toContain("LIMIT 1");
  });

  test("escapes quotes in the projectId before interpolating into SQL", async () => {
    const executeQuerySpy: jest.SpyInstance = jest
      .spyOn(MetricBaselineService, "executeQuery")
      .mockResolvedValue(
        fakeResultSet([]) as unknown as Awaited<
          ReturnType<typeof MetricBaselineService.executeQuery>
        >,
      );

    await MetricBaselineService.getWeekOverWeekDrift({
      projectId: new ObjectID("proj'; DROP TABLE x --"),
      limitPerWindow: 10,
    });

    const sql: string = String(executeQuerySpy.mock.calls[0]![0]);
    expect(sql).toContain("proj\\'; DROP TABLE x --");
    expect(sql).not.toContain("= 'proj';");
  });

  test("empty result sets from both windows yield an empty row list", async () => {
    jest
      .spyOn(MetricBaselineService, "executeQuery")
      .mockResolvedValue(
        fakeResultSet([]) as unknown as Awaited<
          ReturnType<typeof MetricBaselineService.executeQuery>
        >,
      );

    const rows: Array<MetricDriftWindowRow> =
      await MetricBaselineService.getWeekOverWeekDrift({
        projectId: ObjectID.generate(),
        limitPerWindow: 100,
      });

    expect(rows).toEqual([]);
  });
});
