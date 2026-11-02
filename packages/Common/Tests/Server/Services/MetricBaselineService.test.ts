import MetricBaselineService, {
  BandPoint,
  BaselineSummary,
  MetricBaselineEntity,
  MetricBaselineQuery,
} from "../../../Server/Services/MetricBaselineService";
import MetricHourBaseline from "../../../Server/Utils/Monitor/MetricHourBaseline";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a metric's baseline asks ClickHouse, and what it makes of the answer.
 * The read itself is in MetricHourBaseline.test.ts, and that the SQL does what
 * it says against the real rollup in MonitorMetricBaselineClickhouse.test.ts
 * (packages/App).
 */

const projectId: ObjectID = new ObjectID("7a00000000000000000000a1");
const serviceId: ObjectID = new ObjectID("7a00000000000000000000b1");

// A Monday, 09:40.
const judgedAt: Date = new Date("2026-11-30T09:40:00.000Z");
const JUDGED_DAY: string = "2026-11-30";
const HOUR: number = 9;
// Those hours as the rollup stores them, Tuesday's first (toStoredHour).
const STORED_HOUR: number = 241;
const STORED_HOURS_OF_DAY: string = "241, 9, 33, 57, 81, 105, 129";

const service: {
  executeQuery: (sql: string) => Promise<unknown>;
} = MetricBaselineService as unknown as {
  executeQuery: (sql: string) => Promise<unknown>;
};

interface Answers {
  cell: Array<JSONObject>;
  days: Array<JSONObject>;
  pointType?: string;
}

let queries: Array<string>;

const answerWith: (answers: Answers) => void = (answers: Answers): void => {
  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(async (sql: string): Promise<unknown> => {
      queries.push(sql);

      if (sql.includes("SELECT metricPointType")) {
        return {
          json: async (): Promise<{ data: Array<JSONObject> }> => {
            return {
              data: answers.pointType
                ? [{ metricPointType: answers.pointType }]
                : [],
            };
          },
        };
      }

      return {
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          return {
            data: sql.includes("rowDay") ? answers.days : answers.cell,
          };
        },
      };
    });
};

const cellSql: () => string = (): string => {
  return queries.find((sql: string): boolean => {
    return !sql.includes("rowDay") && !sql.includes("SELECT metricPointType");
  })!;
};

const daysSql: () => string = (): string => {
  return queries.find((sql: string): boolean => {
    return sql.includes("rowDay");
  })!;
};

const dayRow: (data: {
  day: string;
  hourOfWeek?: number;
  mean: number;
  low?: number;
  high?: number;
  sampleCount?: number;
}) => JSONObject = (data: {
  day: string;
  hourOfWeek?: number;
  mean: number;
  low?: number;
  high?: number;
  sampleCount?: number;
}): JSONObject => {
  return {
    rowDay: data.day,
    hourOfWeek: MetricHourBaseline.toStoredHour(data.hourOfWeek ?? HOUR),
    // UInt64 comes back from ClickHouse as a string.
    sampleCount: String(data.sampleCount ?? 120),
    mean: data.mean,
    minObserved: data.low ?? data.mean - 1,
    maxObserved: data.high ?? data.mean + 1,
  };
};

const CELL: JSONObject = {
  sampleCount: "240",
  mean: 100,
  stddev: 5,
  median: 99,
  p95: 110,
  minObserved: 80,
  maxObserved: 120,
};

// The two Mondays before the one judged, at the same level.
const TWO_WEEKS: Array<JSONObject> = [
  dayRow({ day: "2026-11-16", mean: 100 }),
  dayRow({ day: "2026-11-23", mean: 100 }),
];

describe("MetricBaselineService", () => {
  beforeEach(() => {
    queries = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getBaseline", () => {
    const read: (input?: {
      judgedAt?: Date;
      windowDays?: number;
      minSamples?: number;
      primaryEntityId?: MetricBaselineEntity;
      metricName?: string;
      query?: MetricBaselineQuery;
    }) => Promise<BaselineSummary | null> = (
      input: {
        judgedAt?: Date;
        windowDays?: number;
        minSamples?: number;
        primaryEntityId?: MetricBaselineEntity;
        metricName?: string;
        query?: MetricBaselineQuery;
      } = {},
    ): Promise<BaselineSummary | null> => {
      return MetricBaselineService.getBaseline({
        projectId,
        metricName: "cpu.usage",
        hourOfWeek: HOUR,
        judgedAt,
        ...input,
      });
    };

    test("the cell is read from the days before the one judged", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read();

      expect(cellSql()).toContain(
        `AND day >= toDate('${JUDGED_DAY}') - INTERVAL 14 DAY`,
      );
      expect(cellSql()).toContain(`AND day < toDate('${JUDGED_DAY}')`);
      expect(cellSql()).toContain(`AND hourOfWeek = ${STORED_HOUR}`);
    });

    test("today is never what decides it: a server's today is not a UTC day", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read();

      expect(cellSql()).not.toContain("today()");
      expect(daysSql()).not.toContain("today()");
    });

    test("the day judged is the UTC day of what is judged", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ judgedAt: new Date("2026-11-30T23:59:59.000Z") });

      expect(cellSql()).toContain("AND day < toDate('2026-11-30')");
    });

    test("an hour read after midnight is held to the days before its own", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ judgedAt: new Date("2026-11-29T23:58:00.000Z") });

      expect(cellSql()).toContain("AND day < toDate('2026-11-29')");
    });

    test("with no moment named, what is judged is now", async () => {
      jest.useFakeTimers({ now: judgedAt });

      try {
        answerWith({ cell: [CELL], days: TWO_WEEKS });

        await MetricBaselineService.getBaseline({
          projectId,
          metricName: "cpu.usage",
          hourOfWeek: HOUR,
        });

        expect(cellSql()).toContain(`AND day < toDate('${JUDGED_DAY}')`);
      } finally {
        jest.useRealTimers();
      }
    });

    test("the hour's rows are read on every day, the day judged included", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read();

      expect(daysSql()).toContain(`AND hourOfWeek IN (${STORED_HOURS_OF_DAY})`);
      expect(daysSql()).toContain(
        `AND day >= toDate('${JUDGED_DAY}') - INTERVAL 14 DAY`,
      );
      expect(daysSql()).not.toContain("AND day < toDate");
      expect(daysSql()).toContain("GROUP BY rowDay, hourOfWeek");
    });

    test("both reads are held to the project, the metric and the service", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ primaryEntityId: serviceId });

      for (const sql of [cellSql(), daysSql()]) {
        expect(sql).toContain(`projectId = '${projectId.toString()}'`);
        expect(sql).toContain("name = 'cpu.usage'");
        expect(sql).toContain(
          `AND primaryEntityId = '${serviceId.toString()}'`,
        );
      }
    });

    test("several services are all read, in both reads", async () => {
      const otherId: ObjectID = new ObjectID("7a00000000000000000000b2");

      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ primaryEntityId: [serviceId, otherId] });

      for (const sql of [cellSql(), daysSql()]) {
        expect(sql).toContain(
          `AND primaryEntityId IN ('${serviceId.toString()}', '${otherId.toString()}')`,
        );
      }
    });

    test("one of a list is that service", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ primaryEntityId: [serviceId] });

      expect(cellSql()).toContain(
        `AND primaryEntityId = '${serviceId.toString()}'`,
      );
    });

    test("an empty list reads every service, as a monitor naming none does", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ primaryEntityId: [] });

      expect(cellSql()).not.toContain("primaryEntityId");
      expect(daysSql()).not.toContain("primaryEntityId");
    });

    test("a service named by anyone stays a string", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ primaryEntityId: ["a'b", "c"] });

      expect(cellSql()).toContain("IN ('a\\'b', 'c')");
    });

    test("a metric named by anyone stays a string in both reads", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ metricName: "a'b\\c" });

      for (const sql of [cellSql(), daysSql()]) {
        expect(sql).toContain("name = 'a\\'b\\\\c'");
      }
    });

    test("a window is held to what the rollup keeps", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await read({ windowDays: 365 });

      expect(cellSql()).toContain("INTERVAL 90 DAY");
      expect(daysSql()).toContain("INTERVAL 90 DAY");
    });

    test("no samples before the day judged is no baseline", async () => {
      answerWith({ cell: [{ ...CELL, sampleCount: "0" }], days: [] });

      expect(await read()).toBeNull();
    });

    test("no row at all is no baseline", async () => {
      answerWith({ cell: [], days: [] });

      expect(await read()).toBeNull();
    });

    test("it says what the earlier samples measured", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      expect(await read()).toEqual({
        sampleCount: 240,
        mean: 100,
        stddev: 5,
        median: 99,
        p95: 110,
        minObserved: 80,
        maxObserved: 120,
        isReliable: true,
        windowDays: 14,
        hourOfWeek: HOUR,
      });
    });

    test("and how far the hour's level can land from theirs", async () => {
      answerWith({
        cell: [CELL],
        days: [
          dayRow({ day: "2026-11-16", mean: 90 }),
          dayRow({ day: "2026-11-23", mean: 110 }),
        ],
      });

      const baseline: BaselineSummary = (await read())!;

      // 10 from their mean in each week: 2 * 100 of variance is missing.
      expect(baseline.stddev).toBeCloseTo(Math.sqrt(25 + 200), 9);
      expect(baseline.mean).toBe(100);
    });

    test("one earlier week is still learning", async () => {
      answerWith({
        cell: [CELL],
        days: [dayRow({ day: "2026-11-23", mean: 100 })],
      });

      expect((await read())?.isReliable).toBe(false);
    });

    test("its own samples count towards minSamples", async () => {
      answerWith({
        cell: [{ ...CELL, sampleCount: "4" }],
        days: [
          dayRow({ day: "2026-11-16", mean: 100, sampleCount: 2 }),
          dayRow({ day: "2026-11-23", mean: 100, sampleCount: 2 }),
          dayRow({ day: JUDGED_DAY, mean: 100, sampleCount: 1 }),
        ],
      });

      const baseline: BaselineSummary = (await read())!;

      expect(baseline.isReliable).toBe(true);
      expect(baseline.sampleCount).toBe(4);
    });

    test("a minSamples asked for is held to", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      expect((await read({ minSamples: 241 }))?.isReliable).toBe(false);
    });

    test("a metric that left the one value it held says so", async () => {
      answerWith({
        cell: [{ ...CELL, mean: 1, stddev: 0, minObserved: 1, maxObserved: 1 }],
        days: [
          dayRow({ day: "2026-11-16", mean: 1, low: 1, high: 1 }),
          dayRow({ day: "2026-11-23", mean: 1, low: 1, high: 1 }),
          dayRow({ day: JUDGED_DAY, mean: 0.5, low: 0, high: 1 }),
        ],
      });

      expect(await read()).toMatchObject({
        stddev: 0,
        leftFlatHistory: true,
        isReliable: true,
      });
    });

    test("one that did not, says nothing", async () => {
      answerWith({
        cell: [{ ...CELL, mean: 1, stddev: 0, minObserved: 1, maxObserved: 1 }],
        days: [
          dayRow({ day: "2026-11-16", mean: 1, low: 1, high: 1 }),
          dayRow({ day: "2026-11-23", mean: 1, low: 1, high: 1 }),
          dayRow({ day: JUDGED_DAY, mean: 1, low: 1, high: 1 }),
        ],
      });

      const baseline: BaselineSummary = (await read())!;

      expect(baseline.stddev).toBe(0);
      expect(baseline.leftFlatHistory).toBeUndefined();
    });
  });

  /*
   * What a query asks for when its data points are not on its samples' scale.
   * MetricHourBaseline.test.ts holds which query is which, and
   * MonitorMetricBaselineClickhouse.test.ts what a real server makes of these.
   */
  describe("getBaseline for a query", () => {
    const read: (
      query: Partial<MetricBaselineQuery>,
      input?: {
        primaryEntityId?: MetricBaselineEntity;
        minSamples?: number;
        metricName?: string;
      },
    ) => Promise<BaselineSummary | null> = (
      query: Partial<MetricBaselineQuery>,
      input: {
        primaryEntityId?: MetricBaselineEntity;
        minSamples?: number;
        metricName?: string;
      } = {},
    ): Promise<BaselineSummary | null> => {
      return MetricBaselineService.getBaseline({
        projectId,
        metricName: "cpu.usage",
        hourOfWeek: HOUR,
        judgedAt,
        ...input,
        query: {
          aggregationType: AggregationType.Avg,
          isNarrowedByAttributes: false,
          interval: AggregationInterval.Minute,
          ...query,
        },
      });
    };

    const pointRow: (data: {
      day: string;
      mean: number;
      variance?: number;
      sampleCount?: number;
    }) => JSONObject = (data: {
      day: string;
      mean: number;
      variance?: number;
      sampleCount?: number;
    }): JSONObject => {
      return {
        rowDay: data.day,
        // These hours are worked out by the read: they are the code's own.
        hourOfWeek: HOUR,
        sampleCount: String(data.sampleCount ?? 60),
        mean: data.mean,
        variance: data.variance ?? 4,
        median: data.mean,
        p95: data.mean + 3,
        minObserved: data.mean - 5,
        maxObserved: data.mean + 5,
      };
    };

    const POINTS: Array<JSONObject> = [
      pointRow({ day: "2026-11-16", mean: 1000 }),
      pointRow({ day: "2026-11-23", mean: 1000 }),
      pointRow({ day: JUDGED_DAY, mean: 2000, sampleCount: 40 }),
    ];

    const pointSql: () => string = (): string => {
      return daysSql();
    };

    test("an average of a plain metric is on its samples' scale, in the hourly rollup", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS, pointType: "Gauge" });

      await read({});

      expect(cellSql()).toContain("FROM MetricBaselineHourly");
      expect(daysSql()).toContain("FROM MetricBaselineHourly");
    });

    test("no query asks no more than it did: nothing else reads a point type", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS });

      await MetricBaselineService.getBaseline({
        projectId,
        metricName: "cpu.usage",
        hourOfWeek: HOUR,
        judgedAt,
      });

      expect(queries).toHaveLength(2);
    });

    test.each([
      [AggregationType.Sum, "sumMerge(valueSumState)"],
      [AggregationType.Count, "countMerge(valueCountState)"],
    ])(
      "a %s of a plain metric is read from the minute rollup",
      async (aggregationType: AggregationType, expression: string) => {
        answerWith({ cell: [], days: POINTS, pointType: "Gauge" });

        await read({ aggregationType });

        expect(pointSql()).toContain("FROM MetricItemAggMV1m");
        expect(pointSql()).toContain(`${expression} AS point`);
        expect(pointSql()).toContain("GROUP BY pointTime");
        expect(pointSql()).not.toContain("MetricBaselineHourly");
      },
    );

    test("a metric whose point type no row of the hour says is a plain one", async () => {
      answerWith({ cell: [], days: POINTS });

      await read({ aggregationType: AggregationType.Sum });

      expect(pointSql()).toContain("FROM MetricItemAggMV1m");
    });

    test.each(["Histogram", "ExponentialHistogram", "Summary"])(
      "an average of a %s is read from its rows, as its query folds them",
      async (pointType: string) => {
        answerWith({ cell: [], days: POINTS, pointType });

        await read({});

        expect(pointSql()).toContain("FROM MetricItemV3");
        expect(pointSql()).toContain("isNotNull(count)");
        expect(pointSql()).toContain("toFloat64(count)");
      },
    );

    test("a count of a histogram is its observations", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Histogram" });

      await read({ aggregationType: AggregationType.Count });

      expect(pointSql()).toContain("FROM MetricItemV3");
      expect(pointSql()).toContain("toFloat64(count)");
    });

    test("every hour of the window is named, so the sort key can skip the rest", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Histogram" });

      await read({});

      for (const day of ["2026-11-16", "2026-11-23", JUDGED_DAY]) {
        expect(pointSql()).toContain(
          `(time >= toDateTime('${day} 09:00:00') AND time < toDateTime('${day} 09:00:00') + INTERVAL 1 HOUR)`,
        );
      }

      expect(pointSql().match(/\(time >= /g)).toHaveLength(15);
    });

    test("both tables are held to the project, the metric, the services and what is kept", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Gauge" });

      await read(
        { aggregationType: AggregationType.Sum },
        { primaryEntityId: [serviceId, serviceId] },
      );

      expect(pointSql()).toContain(`projectId = '${projectId.toString()}'`);
      expect(pointSql()).toContain("name = 'cpu.usage'");
      expect(pointSql()).toContain("AND primaryEntityId IN (");
      expect(pointSql()).toContain("AND retentionDate >= now()");
    });

    test("a read of rows fails rather than thins out", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Histogram" });

      await read({});

      expect(pointSql()).toContain("max_execution_time = 45");
      expect(pointSql()).toContain("timeout_overflow_mode = 'throw'");
    });

    test("a data point is as long as the query's", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Gauge" });

      await read({
        aggregationType: AggregationType.Sum,
        interval: AggregationInterval.FiveMinutes,
      });

      expect(pointSql()).toContain(
        "toStartOfInterval(bucketTime, INTERVAL 5 MINUTE) AS pointTime",
      );
    });

    test("it says what the earlier data points measured, and not the day judged", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Gauge" });

      expect(await read({ aggregationType: AggregationType.Sum })).toEqual({
        sampleCount: 120,
        mean: 1000,
        stddev: 2,
        median: 1000,
        p95: 1003,
        minObserved: 995,
        maxObserved: 1005,
        isReliable: true,
        windowDays: 14,
        hourOfWeek: HOUR,
      });
    });

    test("a day is not a week: one earlier week is still learning", async () => {
      answerWith({
        cell: [],
        days: [pointRow({ day: "2026-11-23", mean: 1000 })],
        pointType: "Gauge",
      });

      expect(
        (await read({ aggregationType: AggregationType.Sum }))?.isReliable,
      ).toBe(false);
    });

    test("nothing in the earlier days is no baseline", async () => {
      answerWith({ cell: [], days: [], pointType: "Gauge" });

      expect(await read({ aggregationType: AggregationType.Sum })).toBeNull();
    });

    test("minSamples counts minutes, so a longer data point needs fewer", async () => {
      const days: Array<JSONObject> = [
        pointRow({ day: "2026-11-16", mean: 1000, sampleCount: 1 }),
        pointRow({ day: "2026-11-23", mean: 1000, sampleCount: 1 }),
      ];

      answerWith({ cell: [], days, pointType: "Gauge" });

      expect(
        (
          await read(
            {
              aggregationType: AggregationType.Sum,
              interval: AggregationInterval.ThirtyMinutes,
            },
            { minSamples: 30 },
          )
        )?.isReliable,
      ).toBe(true);

      expect(
        (
          await read(
            { aggregationType: AggregationType.Sum },
            { minSamples: 30 },
          )
        )?.isReliable,
      ).toBe(false);
    });

    test("a metric that left the one value its data points held says so", async () => {
      answerWith({
        cell: [],
        days: [
          pointRow({ day: "2026-11-16", mean: 10, variance: 0 }),
          pointRow({ day: "2026-11-23", mean: 10, variance: 0 }),
          pointRow({ day: JUDGED_DAY, mean: 8, variance: 4 }),
        ].map((row: JSONObject): JSONObject => {
          return row["rowDay"] === JUDGED_DAY
            ? row
            : { ...row, minObserved: 10, maxObserved: 10 };
        }),
        pointType: "Gauge",
      });

      expect(
        await read({ aggregationType: AggregationType.Sum }),
      ).toMatchObject({ stddev: 0, leftFlatHistory: true });
    });

    test("a metric's name stays a string in what it asks", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Gauge" });

      await read(
        { aggregationType: AggregationType.Sum },
        { metricName: "a'b\\c" },
      );

      for (const sql of queries) {
        expect(sql).toContain("name = 'a\\'b\\\\c'");
      }
    });

    describe("what no table holds has no baseline", () => {
      test.each([
        ["a Sum narrowed by an attribute", AggregationType.Sum, "Gauge"],
        ["a Count narrowed by an attribute", AggregationType.Count, "Gauge"],
        ["a histogram narrowed by one", AggregationType.Avg, "Histogram"],
      ])(
        "%s",
        async (
          _: string,
          aggregationType: AggregationType,
          pointType: string,
        ) => {
          answerWith({ cell: [CELL], days: POINTS, pointType });

          expect(
            await read({ aggregationType, isNarrowedByAttributes: true }),
          ).toBeNull();
          expect(queries).toHaveLength(1);
        },
      );

      test("a percentile of a histogram", async () => {
        answerWith({ cell: [CELL], days: POINTS, pointType: "Histogram" });

        expect(await read({ aggregationType: AggregationType.P95 })).toBeNull();
      });

      test("a Sum over a data point of a day", async () => {
        answerWith({ cell: [CELL], days: POINTS, pointType: "Gauge" });

        expect(
          await read({
            aggregationType: AggregationType.Sum,
            interval: AggregationInterval.Day,
          }),
        ).toBeNull();
      });
    });

    test("an average narrowed by an attribute still has the cell it had", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS, pointType: "Gauge" });

      expect(await read({ isNarrowedByAttributes: true })).not.toBeNull();
    });
  });

  describe("getBandSeries", () => {
    const read: (input?: {
      startTime?: Date;
      endTime?: Date;
      primaryEntityId?: ObjectID;
    }) => Promise<Array<BandPoint>> = (
      input: {
        startTime?: Date;
        endTime?: Date;
        primaryEntityId?: ObjectID;
      } = {},
    ): Promise<Array<BandPoint>> => {
      return MetricBaselineService.getBandSeries({
        projectId,
        metricName: "cpu.usage",
        startTime: new Date("2026-11-30T09:00:00.000Z"),
        endTime: new Date("2026-11-30T09:30:00.000Z"),
        intervalMinutes: 15,
        sigmaCount: 3,
        ...input,
      });
    };

    const bandCell: JSONObject = {
      hourOfWeek: STORED_HOUR,
      sampleCount: "240",
      mean: 100,
      stddev: 5,
    };

    test("a band is read from the days before it starts", async () => {
      answerWith({ cell: [bandCell], days: TWO_WEEKS });

      await read();

      expect(cellSql()).toContain(
        `AND day >= toDate('${JUDGED_DAY}') - INTERVAL 14 DAY`,
      );
      expect(cellSql()).toContain(`AND day < toDate('${JUDGED_DAY}')`);
      expect(cellSql()).not.toContain("today()");
    });

    test("it reads the hours it draws, and each one's hour on every day", async () => {
      answerWith({ cell: [bandCell], days: TWO_WEEKS });

      await read({ endTime: new Date("2026-11-30T10:00:00.000Z") });

      expect(cellSql()).toContain("AND hourOfWeek IN (241, 242)");
      expect(daysSql()).toContain(
        "AND hourOfWeek IN (241, 9, 33, 57, 81, 105, 129, 242, 10, 34, 58, 82, 106, 130)",
      );
    });

    test("every point of an hour has that hour's band", async () => {
      answerWith({ cell: [bandCell], days: TWO_WEEKS });

      const points: Array<BandPoint> = await read();

      expect(points).toHaveLength(3);

      for (const point of points) {
        expect(point).toMatchObject({
          mean: 100,
          expectedHigh: 115,
          expectedLow: 85,
        });
      }
    });

    test("the band is the one a monitor judges by, the level's move included", async () => {
      answerWith({
        cell: [bandCell],
        days: [
          dayRow({ day: "2026-11-16", mean: 90 }),
          dayRow({ day: "2026-11-23", mean: 110 }),
        ],
      });

      const points: Array<BandPoint> = await read();

      expect(points[0]!.expectedHigh).toBeCloseTo(
        100 + 3 * Math.sqrt(25 + 200),
        9,
      );
    });

    test("an hour still learning has no band", async () => {
      answerWith({
        cell: [bandCell],
        days: [dayRow({ day: "2026-11-23", mean: 100 })],
      });

      expect(await read()).toEqual([]);
    });

    test("nothing to draw asks nothing", async () => {
      answerWith({ cell: [bandCell], days: TWO_WEEKS });

      expect(
        await read({
          startTime: new Date("2026-11-30T10:00:00.000Z"),
          endTime: new Date("2026-11-30T09:00:00.000Z"),
        }),
      ).toEqual([]);
      expect(queries).toEqual([]);
    });
  });
});
