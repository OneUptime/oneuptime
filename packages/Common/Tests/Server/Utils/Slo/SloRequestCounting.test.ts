import SloRequestCounting, {
  SLO_REQUEST_BACKFILL_TIME_BUDGET_MILLISECONDS,
  SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS,
  SloRequestCountingConfig,
  SloRequestMeasurement,
} from "../../../../Server/Utils/Slo/SloRequestCounting";
import SpanService from "../../../../Server/Services/SpanService";
import SloHistoryService, {
  SloHistoryRow,
} from "../../../../Server/Services/SloHistoryService";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import {
  SLO_REQUEST_COUNT_CHUNK_MINUTES,
  SLO_REQUEST_STEP_MILLISECONDS,
  SloRequestCountingRange,
  SloRequestCounts,
} from "../../../../Utils/Slo/SloRequestSli";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * SloRequestCounting: how a request SLO's requests are counted from its
 * services' spans, kept in SloHistory and summed back.
 *
 * The SQL is pinned by its shape, as the trace aggregations' is: a count
 * that read every span instead of entry spans, a failure read as success
 * for a span with no status, or a sum that kept an old count of a step
 * counted again would all still run - and answer a wrong SLI. The
 * orchestration (measure) is pinned with the counts and the sums stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000002");
const SERVICE_A: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-0000000000aa",
);
const SERVICE_B: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-0000000000bb",
);

const STEP: number = SLO_REQUEST_STEP_MILLISECONDS;
const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;
const CHUNK: number = SLO_REQUEST_COUNT_CHUNK_MINUTES * MINUTE;

const NOW: Date = new Date("2026-07-19T12:07:30.000Z");
const SETTLED_END: Date = new Date("2026-07-19T12:05:00.000Z");
const WHITESPACE: RegExp = /\s+/g;

const SUCCESS: SloRequestCountingConfig = {
  sliType: SliType.RequestSuccess,
  serviceIds: [SERVICE_A, SERVICE_B],
};

const LATENCY: SloRequestCountingConfig = {
  sliType: SliType.RequestLatency,
  serviceIds: [SERVICE_A],
  latencyThresholdInMilliseconds: 300,
};

function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

function rangeOf(from: number, to: number): SloRequestCountingRange {
  return { from: at(from), to: at(to) };
}

function resultOf(rows: Array<JSONObject>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

function oneLine(statement: Statement): string {
  return statement.query.replace(WHITESPACE, " ");
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("SloRequestCounting.getFingerprint", () => {
  test("is a SHA-256 in hex, short enough for its column", () => {
    const fingerprint: string = SloRequestCounting.getFingerprint(SUCCESS);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("does not depend on the order or repetition of the services", () => {
    expect(SloRequestCounting.getFingerprint(SUCCESS)).toBe(
      SloRequestCounting.getFingerprint({
        sliType: SliType.RequestSuccess,
        serviceIds: [SERVICE_B, SERVICE_A, SERVICE_B],
      }),
    );
  });

  test("changes with the SLI type and the services", () => {
    const fingerprint: string = SloRequestCounting.getFingerprint(SUCCESS);

    expect(
      SloRequestCounting.getFingerprint({
        ...SUCCESS,
        sliType: SliType.RequestLatency,
        latencyThresholdInMilliseconds: 300,
      }),
    ).not.toBe(fingerprint);

    expect(
      SloRequestCounting.getFingerprint({
        ...SUCCESS,
        serviceIds: [SERVICE_A],
      }),
    ).not.toBe(fingerprint);
  });

  test("a latency threshold counts for Request Latency only", () => {
    expect(
      SloRequestCounting.getFingerprint({
        ...SUCCESS,
        latencyThresholdInMilliseconds: 999,
      }),
    ).toBe(SloRequestCounting.getFingerprint(SUCCESS));

    expect(
      SloRequestCounting.getFingerprint({
        ...LATENCY,
        latencyThresholdInMilliseconds: 500,
      }),
    ).not.toBe(SloRequestCounting.getFingerprint(LATENCY));
  });
});

describe("SloRequestCounting.buildCountStatement", () => {
  const range: SloRequestCountingRange = rangeOf(
    SETTLED_END.getTime() - 3 * STEP,
    SETTLED_END.getTime(),
  );

  test("counts entry spans of the SLO's services, in 5-minute steps, within retention", () => {
    const statement: Statement = SloRequestCounting.buildCountStatement({
      projectId: PROJECT_ID,
      config: SUCCESS,
      range: range,
    });

    const sql: string = oneLine(statement);

    expect(sql).toMatch(
      /intDiv\(toUnixTimestamp\(startTime\), \{p\d+:Int32\}\) \* \{p\d+:Int32\} AS stepStart/,
    );
    expect(sql).toContain("count() AS totalCount");
    expect(sql).toMatch(/WHERE projectId = \{p\d+:String\}/);
    expect(sql).toMatch(/AND startTime >= \{p\d+:DateTime64\(9\)\}/);
    expect(sql).toMatch(/AND startTime < \{p\d+:DateTime64\(9\)\}/);
    expect(sql).toContain("AND isEntrySpan = 1");
    expect(sql).toMatch(/AND primaryEntityId IN \(\{p\d+:Array\(String\)\}\)/);
    expect(sql).toContain("AND retentionDate >= now()");
    expect(sql).toContain("GROUP BY stepStart");
    expect(sql).toContain(
      `max_execution_time = ${SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS}`,
    );
    expect(sql).toContain("timeout_overflow_mode = 'throw'");

    const values: Array<unknown> = paramValues(statement);

    expect(values).toContain(300);
    expect(values).toContain(PROJECT_ID.toString());
    expect(values).toContainEqual([SERVICE_A.toString(), SERVICE_B.toString()]);
    expect(values).toContain("SpanItemV3");
  });

  test("a Request Success SLO's bad requests are the spans whose status is Error", () => {
    const statement: Statement = SloRequestCounting.buildCountStatement({
      projectId: PROJECT_ID,
      config: SUCCESS,
      range: range,
    });

    /*
     * statusCode = 2, never statusCode != 2 for the good ones: the column is
     * Nullable, and NULL != 2 is NULL - a span with no status would count as
     * neither good nor bad.
     */
    expect(oneLine(statement)).toMatch(
      /countIf\(statusCode = \{p\d+:Int32\}\) AS badCount/,
    );
    expect(paramValues(statement)).toContain(2);
    expect(oneLine(statement)).not.toContain("durationUnixNano");
  });

  test("a Request Latency SLO's bad requests took longer than the threshold, compared in Int128 nanoseconds", () => {
    const statement: Statement = SloRequestCounting.buildCountStatement({
      projectId: PROJECT_ID,
      config: LATENCY,
      range: range,
    });

    expect(oneLine(statement)).toMatch(
      /countIf\(durationUnixNano > \{p\d+:Int128\}\) AS badCount/,
    );
    expect(paramValues(statement)).toContain(300000000);
    expect(oneLine(statement)).not.toContain("statusCode");
  });
});

describe("SloRequestCounting.countRange", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const range: SloRequestCountingRange = rangeOf(
    SETTLED_END.getTime() - 3 * STEP,
    SETTLED_END.getTime(),
  );

  test("reads each step's counts, and a step with no requests is in the answer with zeros", async () => {
    jest.spyOn(SpanService, "executeQuery").mockResolvedValue(
      resultOf([
        {
          // ClickHouse quotes 64-bit counts in JSON.
          stepStart: (SETTLED_END.getTime() - 3 * STEP) / 1000,
          totalCount: "1000",
          badCount: "3",
        },
        {
          stepStart: (SETTLED_END.getTime() - STEP) / 1000,
          totalCount: 10,
          badCount: 0,
        },
      ]) as never,
    );

    const counts: Map<number, SloRequestCounts> =
      await SloRequestCounting.countRange({
        projectId: PROJECT_ID,
        config: SUCCESS,
        range: range,
      });

    expect(Array.from(counts.entries())).toEqual([
      [SETTLED_END.getTime() - 3 * STEP, { goodCount: 997, totalCount: 1000 }],
      [SETTLED_END.getTime() - 2 * STEP, { goodCount: 0, totalCount: 0 }],
      [SETTLED_END.getTime() - STEP, { goodCount: 10, totalCount: 10 }],
    ]);
  });

  test("a row outside the range never invents a step, and bad is never more than total", async () => {
    jest.spyOn(SpanService, "executeQuery").mockResolvedValue(
      resultOf([
        { stepStart: SETTLED_END.getTime() / 1000, totalCount: 5, badCount: 1 },
        {
          stepStart: (SETTLED_END.getTime() - STEP) / 1000,
          totalCount: 4,
          badCount: 9,
        },
      ]) as never,
    );

    const counts: Map<number, SloRequestCounts> =
      await SloRequestCounting.countRange({
        projectId: PROJECT_ID,
        config: SUCCESS,
        range: range,
      });

    expect(counts.has(SETTLED_END.getTime())).toBe(false);
    expect(counts.get(SETTLED_END.getTime() - STEP)).toEqual({
      goodCount: 0,
      totalCount: 4,
    });
  });

  test("an empty range reads nothing", async () => {
    const query: jest.SpiedFunction<typeof SpanService.executeQuery> = jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(resultOf([]) as never);

    const counts: Map<number, SloRequestCounts> =
      await SloRequestCounting.countRange({
        projectId: PROJECT_ID,
        config: SUCCESS,
        range: rangeOf(SETTLED_END.getTime(), SETTLED_END.getTime()),
      });

    expect(counts.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  test("a failed count throws", async () => {
    jest
      .spyOn(SpanService, "executeQuery")
      .mockRejectedValue(new Error("timeout") as never);

    await expect(
      SloRequestCounting.countRange({
        projectId: PROJECT_ID,
        config: SUCCESS,
        range: range,
      }),
    ).rejects.toThrow("timeout");
  });
});

describe("SloRequestCounting.toHistoryRows", () => {
  test("two rows per step, oldest step first, zeros included", () => {
    const rows: Array<SloHistoryRow> = SloRequestCounting.toHistoryRows({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      counts: new Map<number, SloRequestCounts>([
        [SETTLED_END.getTime() - STEP, { goodCount: 0, totalCount: 0 }],
        [SETTLED_END.getTime() - 2 * STEP, { goodCount: 9, totalCount: 10 }],
      ]),
    });

    expect(
      rows.map((row: SloHistoryRow) => {
        return [row.metricName, row.bucketStart.toISOString(), row.value];
      }),
    ).toEqual([
      ["good.count", "2026-07-19T11:55:00.000Z", 9],
      ["total.count", "2026-07-19T11:55:00.000Z", 10],
      ["good.count", "2026-07-19T12:00:00.000Z", 0],
      ["total.count", "2026-07-19T12:00:00.000Z", 0],
    ]);

    for (const row of rows) {
      expect(row.projectId).toBe(PROJECT_ID);
      expect(row.sloId).toBe(SLO_ID);
    }
  });
});

describe("SloRequestCounting.buildWindowSumsStatement", () => {
  test("sums each window from the newest version of every step that has both counts", () => {
    const statement: Statement = SloRequestCounting.buildWindowSumsStatement({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      windowStarts: [
        at(SETTLED_END.getTime() - 30 * DAY),
        at(SETTLED_END.getTime() - 60 * MINUTE),
      ],
      readFrom: at(SETTLED_END.getTime() - 30 * DAY),
      readTo: SETTLED_END,
      excludedRanges: [
        rangeOf(SETTLED_END.getTime() - 3 * STEP, SETTLED_END.getTime()),
      ],
    });

    const sql: string = oneLine(statement);

    expect(sql).toMatch(
      /sumIf\(good, bucketStart >= \{p\d+:DateTime\}\) AS good0/,
    );
    expect(sql).toMatch(
      /sumIf\(total, bucketStart >= \{p\d+:DateTime\}\) AS total0/,
    );
    expect(sql).toContain("AS good1");
    expect(sql).toContain("AS total1");
    expect(sql).toMatch(
      /argMaxIf\(value, version, metricName = \{p\d+:String\}\) AS good/,
    );
    expect(sql).toMatch(
      /argMaxIf\(value, version, metricName = \{p\d+:String\}\) AS total/,
    );
    expect(sql).toMatch(/AND sloId = \{p\d+:String\}/);
    expect(sql).toMatch(/AND bucketStart >= \{p\d+:DateTime\}/);
    expect(sql).toMatch(/AND bucketStart < \{p\d+:DateTime\}/);
    expect(sql).toMatch(
      /AND NOT \(bucketStart >= \{p\d+:DateTime\} AND bucketStart < \{p\d+:DateTime\}\)/,
    );
    expect(sql).toContain("GROUP BY bucketStart HAVING countIf(metricName =");
    expect(paramValues(statement)).toContain("good.count");
    expect(paramValues(statement)).toContain("total.count");
    expect(paramValues(statement)).toContain("SloHistory");
    expect(paramValues(statement)).toContain(SLO_ID.toString());
  });
});

describe("SloRequestCounting.readWindowSums", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads one sum per window", async () => {
    jest
      .spyOn(SloHistoryService, "executeQuery")
      .mockResolvedValue(
        resultOf([
          { good0: "990", total0: "1000", good1: 50, total1: 60 },
        ]) as never,
      );

    const sums: Array<SloRequestCounts> =
      await SloRequestCounting.readWindowSums({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        windowStarts: [
          at(SETTLED_END.getTime() - DAY),
          at(SETTLED_END.getTime() - 60 * MINUTE),
        ],
        readFrom: at(SETTLED_END.getTime() - DAY),
        readTo: SETTLED_END,
        excludedRanges: [],
      });

    expect(sums).toEqual([
      { goodCount: 990, totalCount: 1000 },
      { goodCount: 50, totalCount: 60 },
    ]);
  });

  test("reads nothing when this evaluation counted the whole read range itself", async () => {
    const query: jest.SpiedFunction<typeof SloHistoryService.executeQuery> =
      jest
        .spyOn(SloHistoryService, "executeQuery")
        .mockResolvedValue(resultOf([]) as never);

    const sums: Array<SloRequestCounts> =
      await SloRequestCounting.readWindowSums({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        windowStarts: [at(SETTLED_END.getTime() - 2 * CHUNK)],
        readFrom: at(SETTLED_END.getTime() - 2 * CHUNK),
        readTo: SETTLED_END,
        excludedRanges: [
          rangeOf(SETTLED_END.getTime() - CHUNK, SETTLED_END.getTime()),
          rangeOf(
            SETTLED_END.getTime() - 2 * CHUNK,
            SETTLED_END.getTime() - CHUNK,
          ),
        ],
      });

    expect(query).not.toHaveBeenCalled();
    expect(sums).toEqual([{ goodCount: 0, totalCount: 0 }]);
  });

  test("an empty read range, or no row at all, sums to zero", async () => {
    jest
      .spyOn(SloHistoryService, "executeQuery")
      .mockResolvedValue(resultOf([]) as never);

    expect(
      await SloRequestCounting.readWindowSums({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        windowStarts: [at(SETTLED_END.getTime() - DAY)],
        readFrom: at(SETTLED_END.getTime() - DAY),
        readTo: SETTLED_END,
        excludedRanges: [],
      }),
    ).toEqual([{ goodCount: 0, totalCount: 0 }]);

    expect(
      await SloRequestCounting.readWindowSums({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        windowStarts: [SETTLED_END],
        readFrom: SETTLED_END,
        readTo: SETTLED_END,
        excludedRanges: [],
      }),
    ).toEqual([{ goodCount: 0, totalCount: 0 }]);
  });
});

describe("SloRequestCounting.isCoveredBy", () => {
  const from: number = SETTLED_END.getTime() - 4 * STEP;
  const to: number = SETTLED_END.getTime();

  test("covered by ranges that meet, in any order", () => {
    expect(
      SloRequestCounting.isCoveredBy({
        from: at(from),
        to: at(to),
        ranges: [rangeOf(from + 2 * STEP, to), rangeOf(from, from + 2 * STEP)],
      }),
    ).toBe(true);
  });

  test("not covered with a gap, a missing start or a missing end", () => {
    expect(
      SloRequestCounting.isCoveredBy({
        from: at(from),
        to: at(to),
        ranges: [rangeOf(from, from + STEP), rangeOf(from + 2 * STEP, to)],
      }),
    ).toBe(false);

    expect(
      SloRequestCounting.isCoveredBy({
        from: at(from),
        to: at(to),
        ranges: [rangeOf(from + STEP, to)],
      }),
    ).toBe(false);

    expect(
      SloRequestCounting.isCoveredBy({
        from: at(from),
        to: at(to),
        ranges: [rangeOf(from, to - STEP)],
      }),
    ).toBe(false);

    expect(
      SloRequestCounting.isCoveredBy({
        from: at(from),
        to: at(to),
        ranges: [],
      }),
    ).toBe(false);
  });
});

describe("SloRequestCounting.measure", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type CountRangeArgs = {
    projectId: ObjectID;
    config: SloRequestCountingConfig;
    range: SloRequestCountingRange;
  };

  // Every step of every range counted as 100 requests, `bad` of them bad.
  function stubCounts(
    bad: number = 1,
  ): jest.SpiedFunction<typeof SloRequestCounting.countRange> {
    return jest
      .spyOn(SloRequestCounting, "countRange")
      .mockImplementation(async (args: CountRangeArgs) => {
        const counts: Map<number, SloRequestCounts> = new Map<
          number,
          SloRequestCounts
        >();

        for (
          let time: number = args.range.from.getTime();
          time < args.range.to.getTime();
          time += STEP
        ) {
          counts.set(time, { goodCount: 100 - bad, totalCount: 100 });
        }

        return counts;
      });
  }

  function stubInsert(): jest.SpiedFunction<
    typeof SloHistoryService.insertHistoryRows
  > {
    return jest
      .spyOn(SloHistoryService, "insertHistoryRows")
      .mockResolvedValue(undefined);
  }

  test("a new SLO counts the newest 6 hours and older pieces, keeps them, and sums them from memory", async () => {
    const countRange: jest.SpiedFunction<typeof SloRequestCounting.countRange> =
      stubCounts();
    const insert: jest.SpiedFunction<
      typeof SloHistoryService.insertHistoryRows
    > = stubInsert();
    const readSums: jest.SpiedFunction<
      typeof SloRequestCounting.readWindowSums
    > = jest.spyOn(SloRequestCounting, "readWindowSums");
    const historyQuery: jest.SpiedFunction<
      typeof SloHistoryService.executeQuery
    > = jest
      .spyOn(SloHistoryService, "executeQuery")
      .mockResolvedValue(resultOf([]) as never);

    const measurement: SloRequestMeasurement = await SloRequestCounting.measure(
      {
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - DAY),
        windowStarts: [
          at(SETTLED_END.getTime() - DAY),
          at(SETTLED_END.getTime() - 60 * MINUTE),
        ],
      },
    );

    // 6 hours forward, then three older pieces back to the start of the day.
    expect(countRange).toHaveBeenCalledTimes(4);
    expect(countRange.mock.calls[0]![0].range).toEqual(
      rangeOf(SETTLED_END.getTime() - CHUNK, SETTLED_END.getTime()),
    );

    expect(measurement.isRestart).toBe(true);
    expect(measurement.lastAccumulatedBucketEndAt).toEqual(SETTLED_END);
    expect(measurement.firstAccumulatedBucketStartAt).toEqual(
      at(SETTLED_END.getTime() - DAY),
    );
    expect(measurement.fingerprint).toBe(
      SloRequestCounting.getFingerprint(SUCCESS),
    );

    // 288 steps of a day, 12 of the last hour, each 100 requests.
    expect(measurement.windowCounts).toEqual([
      { goodCount: 288 * 99, totalCount: 288 * 100 },
      { goodCount: 12 * 99, totalCount: 12 * 100 },
    ]);

    // Every counted step kept, in one write: two rows each.
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0]).toHaveLength(288 * 2);

    // Everything it sums it counted itself, so SloHistory is not read.
    expect(readSums).toHaveBeenCalledTimes(1);
    expect(historyQuery).not.toHaveBeenCalled();
  });

  test("an evaluation that carries on reads the earlier steps from SloHistory and adds the new ones", async () => {
    const countRange: jest.SpiedFunction<typeof SloRequestCounting.countRange> =
      stubCounts(0);
    stubInsert();
    const readSums: jest.SpiedFunction<
      typeof SloRequestCounting.readWindowSums
    > = jest.spyOn(SloRequestCounting, "readWindowSums").mockResolvedValue([
      { goodCount: 5000, totalCount: 5100 },
      { goodCount: 800, totalCount: 900 },
    ]);

    const measurement: SloRequestMeasurement = await SloRequestCounting.measure(
      {
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - DAY),
        firstAccumulatedBucketStartAt: at(SETTLED_END.getTime() - 2 * DAY),
        lastAccumulatedBucketEndAt: at(SETTLED_END.getTime() - STEP),
        fingerprint: SloRequestCounting.getFingerprint(SUCCESS),
        windowStarts: [
          at(SETTLED_END.getTime() - DAY),
          at(SETTLED_END.getTime() - 60 * MINUTE),
        ],
      },
    );

    expect(measurement.isRestart).toBe(false);

    // The one new step and the two before it, counted again.
    expect(countRange).toHaveBeenCalledTimes(1);
    expect(countRange.mock.calls[0]![0].range).toEqual(
      rangeOf(SETTLED_END.getTime() - 3 * STEP, SETTLED_END.getTime()),
    );

    // SloHistory is read for the rest, without the steps just counted.
    expect(readSums.mock.calls[0]![0].excludedRanges).toEqual([
      rangeOf(SETTLED_END.getTime() - 3 * STEP, SETTLED_END.getTime()),
    ]);
    expect(readSums.mock.calls[0]![0].readTo).toEqual(SETTLED_END);

    // The saved sums plus the three counted steps of 100 good requests.
    expect(measurement.windowCounts).toEqual([
      { goodCount: 5300, totalCount: 5400 },
      { goodCount: 1100, totalCount: 1200 },
    ]);
  });

  test("a window older than what is counted is summed from the oldest counted step", async () => {
    stubCounts();
    stubInsert();
    const readSums: jest.SpiedFunction<
      typeof SloRequestCounting.readWindowSums
    > = jest
      .spyOn(SloRequestCounting, "readWindowSums")
      .mockResolvedValue([{ goodCount: 0, totalCount: 0 }]);

    await SloRequestCounting.measure({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      config: SUCCESS,
      now: NOW,
      neededFrom: at(SETTLED_END.getTime() - 30 * DAY),
      firstAccumulatedBucketStartAt: at(SETTLED_END.getTime() - DAY),
      lastAccumulatedBucketEndAt: SETTLED_END,
      fingerprint: SloRequestCounting.getFingerprint(SUCCESS),
      windowStarts: [at(SETTLED_END.getTime() - 30 * DAY)],
    });

    /*
     * Four older pieces were counted back from a day ago, and the window's
     * sum starts at the oldest of them - never at older steps that may hold
     * counts of something the SLO counted before.
     */
    expect(readSums.mock.calls[0]![0].windowStarts).toEqual([
      at(SETTLED_END.getTime() - DAY - 4 * CHUNK),
    ]);
  });

  test("an older piece that fails to count is logged and stops the backfill; the newer counts stand", async () => {
    let call: number = 0;

    jest
      .spyOn(SloRequestCounting, "countRange")
      .mockImplementation(async (args: CountRangeArgs) => {
        call++;

        if (call === 3) {
          throw new Error("timeout");
        }

        const counts: Map<number, SloRequestCounts> = new Map<
          number,
          SloRequestCounts
        >();
        counts.set(args.range.from.getTime(), {
          goodCount: 1,
          totalCount: 1,
        });
        return counts;
      });
    stubInsert();
    jest
      .spyOn(SloRequestCounting, "readWindowSums")
      .mockResolvedValue([{ goodCount: 0, totalCount: 0 }]);
    const error: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    const measurement: SloRequestMeasurement = await SloRequestCounting.measure(
      {
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - 30 * DAY),
        windowStarts: [at(SETTLED_END.getTime() - 30 * DAY)],
      },
    );

    // Forward, then one older piece, then the failure: the counts go back 12 hours.
    expect(measurement.firstAccumulatedBucketStartAt).toEqual(
      at(SETTLED_END.getTime() - 2 * CHUNK),
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain(
      "the next evaluation counts them",
    );
  });

  test("older pieces stop once the time budget is spent", async () => {
    let clock: number = 1_000_000;

    jest.spyOn(Date, "now").mockImplementation(() => {
      return clock;
    });

    jest
      .spyOn(SloRequestCounting, "countRange")
      .mockImplementation(async () => {
        clock += SLO_REQUEST_BACKFILL_TIME_BUDGET_MILLISECONDS;
        return new Map<number, SloRequestCounts>();
      });
    stubInsert();
    jest
      .spyOn(SloRequestCounting, "readWindowSums")
      .mockResolvedValue([{ goodCount: 0, totalCount: 0 }]);

    const measurement: SloRequestMeasurement = await SloRequestCounting.measure(
      {
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - 30 * DAY),
        windowStarts: [at(SETTLED_END.getTime() - 30 * DAY)],
      },
    );

    // The forward count, then one older piece: the second found the budget spent.
    expect(SloRequestCounting.countRange).toHaveBeenCalledTimes(2);
    expect(measurement.firstAccumulatedBucketStartAt).toEqual(
      at(SETTLED_END.getTime() - 2 * CHUNK),
    );
  });

  test("a failed count of the newest steps throws, and nothing is kept", async () => {
    jest
      .spyOn(SloRequestCounting, "countRange")
      .mockRejectedValue(new Error("ClickHouse is down"));
    const insert: jest.SpiedFunction<
      typeof SloHistoryService.insertHistoryRows
    > = stubInsert();

    await expect(
      SloRequestCounting.measure({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - DAY),
        windowStarts: [at(SETTLED_END.getTime() - DAY)],
      }),
    ).rejects.toThrow("ClickHouse is down");

    expect(insert).not.toHaveBeenCalled();
  });

  test("counts that cannot be kept throw, so the cursors do not claim them", async () => {
    stubCounts();
    jest
      .spyOn(SloHistoryService, "insertHistoryRows")
      .mockRejectedValue(new Error("insert failed"));

    await expect(
      SloRequestCounting.measure({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: SUCCESS,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - 60 * MINUTE),
        windowStarts: [at(SETTLED_END.getTime() - 60 * MINUTE)],
      }),
    ).rejects.toThrow("insert failed");
  });

  test("a fingerprint of something else starts the counting again", async () => {
    stubCounts();
    stubInsert();
    jest
      .spyOn(SloRequestCounting, "readWindowSums")
      .mockResolvedValue([{ goodCount: 0, totalCount: 0 }]);

    const measurement: SloRequestMeasurement = await SloRequestCounting.measure(
      {
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        config: LATENCY,
        now: NOW,
        neededFrom: at(SETTLED_END.getTime() - 60 * MINUTE),
        firstAccumulatedBucketStartAt: at(SETTLED_END.getTime() - DAY),
        lastAccumulatedBucketEndAt: at(SETTLED_END.getTime() - STEP),
        fingerprint: SloRequestCounting.getFingerprint(SUCCESS),
        windowStarts: [at(SETTLED_END.getTime() - 60 * MINUTE)],
      },
    );

    expect(measurement.isRestart).toBe(true);
    expect(measurement.fingerprint).toBe(
      SloRequestCounting.getFingerprint(LATENCY),
    );
    expect(measurement.firstAccumulatedBucketStartAt).toEqual(
      at(SETTLED_END.getTime() - 60 * MINUTE),
    );
  });
});
