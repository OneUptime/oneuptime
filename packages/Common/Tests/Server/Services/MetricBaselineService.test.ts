import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import MetricBaselineService, {
  BandPoint,
  BaselineSummary,
  MetricBaselineEntity,
  MetricBaselineQuery,
  MetricBaselineScope,
  MetricBaselineService as MetricBaselineServiceClass,
  MetricSeriesBaselines,
} from "../../../Server/Services/MetricBaselineService";
import MetricHourBaseline from "../../../Server/Utils/Monitor/MetricHourBaseline";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../Utils/Telemetry/EntityKey";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
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
  executeQuery: (sql: string | Statement) => Promise<unknown>;
} = MetricBaselineService as unknown as {
  executeQuery: (sql: string | Statement) => Promise<unknown>;
};

interface Answers {
  cell: Array<JSONObject>;
  days: Array<JSONObject>;
  pointType?: string;
  // A read of data points, when it is not what the cell's days answer.
  points?: Array<JSONObject>;
  failsPoints?: boolean;
}

let queries: Array<string>;
let statements: Array<string | Statement>;

const answerWith: (answers: Answers) => void = (answers: Answers): void => {
  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(async (read: string | Statement): Promise<unknown> => {
      const sql: string = typeof read === "string" ? read : read.query;

      queries.push(sql);
      statements.push(read);

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

      if (sql.includes("keptUntil") && answers.failsPoints) {
        throw new Error("Timeout exceeded");
      }

      return {
        json: async (): Promise<{ data: Array<JSONObject> }> => {
          if (sql.includes("keptUntil") && answers.points) {
            return { data: answers.points };
          }

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

const cellQueries: () => Array<string> = (): Array<string> => {
  return queries.filter((sql: string): boolean => {
    return sql.includes("MetricBaselineHourly");
  });
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
    statements = [];
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

      for (const day of ["2026-11-16", "2026-11-23"]) {
        expect(pointSql()).toContain(
          `(time >= toDateTime('${day} 09:00:00') AND time < toDateTime('${day} 09:00:00') + INTERVAL 1 HOUR)`,
        );
      }

      expect(pointSql().match(/\(time >= /g)).toHaveLength(14);
    });

    test("the day judged is not read: nothing of it has a say", async () => {
      answerWith({ cell: [], days: POINTS, pointType: "Histogram" });

      await read({});

      expect(pointSql()).not.toContain(JUDGED_DAY);
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

    test("it says what the earlier data points measured", async () => {
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

    test("a metric whose data points held one value is held to it", async () => {
      answerWith({
        cell: [],
        days: [
          pointRow({ day: "2026-11-16", mean: 10, variance: 0 }),
          pointRow({ day: "2026-11-23", mean: 10, variance: 0 }),
        ].map((row: JSONObject): JSONObject => {
          return { ...row, minObserved: 10, maxObserved: 10 };
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

  /*
   * A query narrowed by an attribute no rollup holds: its own rows, a series at
   * a time, once an hour. What that SQL does to real rows is in
   * MonitorMetricBaselineClickhouse.test.ts.
   */
  describe("a query narrowed by attributes it can name", () => {
    const HOST: string = "web-1.example.internal";

    const scopeOf: (
      data: Partial<MetricBaselineScope>,
    ) => MetricBaselineScope = (
      data: Partial<MetricBaselineScope>,
    ): MetricBaselineScope => {
      return {
        attributes: {},
        groupByAttributeKeys: [],
        ...data,
      };
    };

    const queryOf: (
      scope: Partial<MetricBaselineScope>,
      query?: Partial<MetricBaselineQuery>,
    ) => MetricBaselineQuery = (
      scope: Partial<MetricBaselineScope>,
      query: Partial<MetricBaselineQuery> = {},
    ): MetricBaselineQuery => {
      return {
        aggregationType: AggregationType.Avg,
        isNarrowedByAttributes: true,
        interval: AggregationInterval.Minute,
        scope: scopeOf(scope),
        ...query,
      };
    };

    const readOne: (
      scope: Partial<MetricBaselineScope>,
      query?: Partial<MetricBaselineQuery>,
      input?: { primaryEntityId?: MetricBaselineEntity },
    ) => Promise<BaselineSummary | null> = (
      scope: Partial<MetricBaselineScope>,
      query: Partial<MetricBaselineQuery> = {},
      input: { primaryEntityId?: MetricBaselineEntity } = {},
    ): Promise<BaselineSummary | null> => {
      return MetricBaselineService.getBaseline({
        projectId,
        metricName: "cpu.usage",
        hourOfWeek: HOUR,
        judgedAt,
        ...input,
        query: queryOf(scope, query),
      });
    };

    const readSeries: (
      scope: Partial<MetricBaselineScope>,
      query?: Partial<MetricBaselineQuery>,
    ) => Promise<MetricSeriesBaselines> = (
      scope: Partial<MetricBaselineScope>,
      query: Partial<MetricBaselineQuery> = {},
    ): Promise<MetricSeriesBaselines> => {
      return MetricBaselineService.getSeriesBaselines({
        projectId,
        metricName: "cpu.usage",
        hourOfWeek: HOUR,
        judgedAt,
        query: queryOf(scope, query),
      });
    };

    const pointRow: (data: {
      day: string;
      mean?: number;
      keptUntil?: string;
      series?: Array<string>;
      sampleCount?: number;
    }) => JSONObject = (data: {
      day: string;
      mean?: number;
      keptUntil?: string;
      series?: Array<string>;
      sampleCount?: number;
    }): JSONObject => {
      const mean: number = data.mean ?? 40;
      const row: JSONObject = {
        rowDay: data.day,
        hourOfWeek: HOUR,
        sampleCount: String(data.sampleCount ?? 60),
        mean,
        variance: 4,
        median: mean,
        p95: mean + 3,
        minObserved: mean - 5,
        maxObserved: mean + 5,
        keptUntil: data.keptUntil ?? "2026-12-15 09:30:00",
      };

      (data.series || []).forEach((value: string, index: number): void => {
        row[`seriesKey${index}`] = value;
      });

      return row;
    };

    const POINTS: Array<JSONObject> = [
      pointRow({ day: "2026-11-16" }),
      pointRow({ day: "2026-11-23" }),
    ];

    const pointSql: () => string = (): string => {
      return queries.find((sql: string): boolean => {
        return sql.includes("keptUntil");
      })!;
    };

    const pointParams: () => Record<string, unknown> = (): Record<
      string,
      unknown
    > => {
      return (
        statements.find((statement: string | Statement): boolean => {
          return (
            statement instanceof Statement &&
            statement.query.includes("keptUntil")
          );
        }) as Statement
      ).query_params;
    };

    describe("what it reads", () => {
      test("its own rows, for a filter no rollup is keyed by", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { state: "idle" } });

        expect(pointSql()).toContain("FROM MetricItemV3");
        expect(pointSql()).not.toContain("MetricBaselineHourly");
        expect(Object.values(pointParams())).toContain("idle");
      });

      test("a filter is a parameter, whoever wrote it", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { "it's": "a' OR 1=1 --" } });

        expect(pointSql()).not.toContain("1=1");
        expect(pointSql()).not.toContain("it's");
        expect(Object.values(pointParams())).toContain("a' OR 1=1 --");
      });

      test("several filters all hold", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({
          attributes: { "resource.host.name": HOST, state: "idle" },
        });

        expect(Object.values(pointParams())).toEqual(
          expect.arrayContaining([HOST, "idle"]),
        );
      });

      test("a host among other filters is pruned by its entity key, as a raw read is", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({
          attributes: { "resource.host.name": HOST, state: "idle" },
        });

        // Column names are bound too, so both are among the parameters.
        expect(Object.values(pointParams())).toContain("hostEntityKey");
        expect(JSON.stringify(pointParams())).toContain(
          keyForHost(projectId.toString(), HOST),
        );
      });

      test("the read is held to the project, the metric and what is kept", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne(
          { attributes: { state: "idle" } },
          {},
          { primaryEntityId: serviceId },
        );

        expect(pointSql()).toContain(`projectId = '${projectId.toString()}'`);
        expect(pointSql()).toContain("name = 'cpu.usage'");
        expect(pointSql()).toContain(
          `AND primaryEntityId = '${serviceId.toString()}'`,
        );
        expect(pointSql()).toContain("AND retentionDate >= now()");
      });

      test("it is the days before the one judged, and not that day", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { state: "idle" } });

        expect(pointSql().match(/\(time >= /g)).toHaveLength(14);
        expect(pointSql()).not.toContain(JUDGED_DAY);
      });

      test("it fails rather than thins out", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { state: "idle" } });

        expect(pointSql()).toContain("timeout_overflow_mode = 'throw'");
      });

      test("a percentile is of the matching rows' values", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne(
          { attributes: { state: "idle" } },
          { aggregationType: AggregationType.P95 },
        );

        expect(pointSql()).toContain("quantileExact(0.95)(toFloat64(value))");
      });

      test("a histogram narrowed by an attribute has its observations", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          pointType: "Histogram",
        });

        expect(await readOne({ attributes: { state: "idle" } })).toMatchObject({
          mean: 40,
        });
        expect(pointSql()).toContain("toFloat64(count)");
      });

      test("a percentile of a histogram has no baseline, and reads nothing more", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          pointType: "Histogram",
        });

        expect(
          await readOne(
            { attributes: { state: "idle" } },
            { aggregationType: AggregationType.P95 },
          ),
        ).toBeNull();
        expect(queries).toHaveLength(1);
      });
    });

    describe("a query filtered to one entity and nothing else", () => {
      test.each([
        [
          "a host",
          { "resource.host.name": HOST },
          "MetricItemAggMV1mByHostV2",
          "hostEntityKey",
          keyForHost(projectId.toString(), HOST),
        ],
        [
          "a cluster",
          { "resource.k8s.cluster.name": "prod" },
          "MetricItemAggMV1mByK8sCluster",
          "k8sClusterEntityKey",
          keyForKubernetesCluster(projectId.toString(), "prod"),
        ],
      ])(
        "%s reads its rollup, and no attribute",
        async (
          _: string,
          attributes: JSONObject,
          table: string,
          keyColumn: string,
          key: string,
        ) => {
          answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

          await readOne({ attributes });

          expect(pointSql()).toContain(`FROM ${table}`);
          expect(pointSql()).toContain(`${keyColumn} IN `);
          expect(pointSql()).toContain("bucketTime >= toDateTime(");
          expect(Object.values(pointParams())).not.toContain("attributes");
          expect(Object.keys(pointParams())).toHaveLength(1);
          expect(JSON.stringify(pointParams())).toContain(key);
        },
      );

      test.each([
        [AggregationType.Avg, "sumMerge(valueSumState) / countMerge"],
        [AggregationType.Sum, "sumMerge(valueSumState)"],
        [AggregationType.Count, "countMerge(valueCountState)"],
        [AggregationType.Min, "minMerge(valueMinState)"],
        [AggregationType.Max, "maxMerge(valueMaxState)"],
      ])(
        "a %s merges the state it stores",
        async (aggregationType: AggregationType, expression: string) => {
          answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

          await readOne(
            { attributes: { "resource.host.name": HOST } },
            { aggregationType },
          );

          expect(pointSql()).toContain(expression);
        },
      );

      test("a percentile is not in the rollup", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne(
          { attributes: { "resource.host.name": HOST } },
          { aggregationType: AggregationType.P95 },
        );

        expect(pointSql()).toContain("FROM MetricItemV3");
      });

      test("nor is a histogram's data point", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          pointType: "Histogram",
        });

        await readOne({ attributes: { "resource.host.name": HOST } });

        expect(pointSql()).toContain("FROM MetricItemV3");
      });

      test("nor a service named too: the rollup knows only its entity", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne(
          { attributes: { "resource.host.name": HOST } },
          {},
          { primaryEntityId: serviceId },
        );

        expect(pointSql()).toContain("FROM MetricItemV3");
      });

      test("nor anything split into series", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readSeries({
          attributes: { "resource.host.name": HOST },
          groupByAttributeKeys: ["mountpoint"],
        });

        expect(pointSql()).toContain("FROM MetricItemV3");
      });
    });

    describe("a query split into series", () => {
      const fingerprintOf: (labels: JSONObject) => string = (
        labels: JSONObject,
      ): string => {
        return MetricSeriesFingerprint.computeFingerprint(labels);
      };

      const GROUPED: Array<JSONObject> = [
        pointRow({ day: "2026-11-16", mean: 10, series: ["a"] }),
        pointRow({ day: "2026-11-23", mean: 10, series: ["a"] }),
        pointRow({ day: "2026-11-16", mean: 90, series: ["b"] }),
        pointRow({ day: "2026-11-23", mean: 90, series: ["b"] }),
      ];

      test("each has a baseline of its own, under the worker's fingerprint", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: GROUPED });

        const baselines: MetricSeriesBaselines = await readSeries({
          groupByAttributeKeys: ["host"],
        });

        expect(baselines.series.get(fingerprintOf({ host: "a" }))?.mean).toBe(
          10,
        );
        expect(baselines.series.get(fingerprintOf({ host: "b" }))?.mean).toBe(
          90,
        );
      });

      test("a data point is of a series, in the read and what folds it", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: GROUPED });

        await readSeries({ groupByAttributeKeys: ["host", "state"] });

        expect(pointSql()).toContain("AS seriesKey0");
        expect(pointSql()).toContain("AS seriesKey1");
        expect(pointSql()).toContain(
          "GROUP BY pointTime, seriesKey0, seriesKey1",
        );
        expect(pointSql()).toContain(
          "GROUP BY rowDay, hourOfWeek, seriesKey0, seriesKey1",
        );
        expect(Object.values(pointParams())).toEqual(
          expect.arrayContaining(["host", "state"]),
        );
      });

      test("an attribute a series does not carry is empty, as the worker keeps it", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: [
            pointRow({ day: "2026-11-16", series: ["a", ""] }),
            pointRow({ day: "2026-11-23", series: ["a", ""] }),
          ],
        });

        const baselines: MetricSeriesBaselines = await readSeries({
          groupByAttributeKeys: ["host", "state"],
        });

        expect(
          baselines.series.has(fingerprintOf({ host: "a", state: "" })),
        ).toBe(true);
      });

      test("the worker's filters hold over every series", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: GROUPED });

        await readSeries({
          attributes: { "resource.host.name": HOST },
          groupByAttributeKeys: ["mountpoint"],
        });

        expect(Object.values(pointParams())).toEqual(
          expect.arrayContaining([HOST, "mountpoint"]),
        );
      });

      test("nothing falls back while every series holds its own weeks", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: GROUPED });

        await readSeries({ groupByAttributeKeys: ["host"] });

        expect(cellQueries()).toHaveLength(0);
      });
    });

    describe("what judges a series", () => {
      const SUMMARY: BaselineSummary = {
        sampleCount: 120,
        mean: 40,
        stddev: 2,
        median: 40,
        p95: 43,
        minObserved: 35,
        maxObserved: 45,
        isReliable: true,
        windowDays: 14,
        hourOfWeek: HOUR,
      };
      const LEARNING: BaselineSummary = { ...SUMMARY, isReliable: false };
      const CELL_SUMMARY: BaselineSummary = { ...SUMMARY, mean: 100 };

      const judge: (data: {
        series: Array<[string, BaselineSummary]>;
        fallback: BaselineSummary | null;
        fingerprint?: string;
      }) => BaselineSummary | null = (data: {
        series: Array<[string, BaselineSummary]>;
        fallback: BaselineSummary | null;
        fingerprint?: string;
      }): BaselineSummary | null => {
        return MetricBaselineServiceClass.getSeriesBaseline({
          baselines: {
            series: new Map<string, BaselineSummary>(data.series),
            fallback: data.fallback,
          },
          seriesFingerprint: data.fingerprint,
        });
      };

      test("its own, when that holds", () => {
        expect(
          judge({
            series: [["a", SUMMARY]],
            fallback: CELL_SUMMARY,
            fingerprint: "a",
          }),
        ).toBe(SUMMARY);
      });

      test("the cell, when its own does not and there is one", () => {
        expect(
          judge({
            series: [["a", LEARNING]],
            fallback: CELL_SUMMARY,
            fingerprint: "a",
          }),
        ).toBe(CELL_SUMMARY);
      });

      test("its own still, to say that it is learning, when there is none", () => {
        expect(
          judge({
            series: [["a", LEARNING]],
            fallback: null,
            fingerprint: "a",
          }),
        ).toBe(LEARNING);
      });

      test("nothing, for a series with no history and nothing to fall back on", () => {
        expect(
          judge({ series: [], fallback: null, fingerprint: "a" }),
        ).toBeNull();
      });

      test("a query not split into series is the whole monitor's", () => {
        expect(
          judge({
            series: [
              [MetricSeriesFingerprint.WholeMonitorFingerprint, SUMMARY],
            ],
            fallback: null,
          }),
        ).toBe(SUMMARY);
      });
    });

    /*
     * The earlier days of an hour do not change, and on a fleet's metric a read
     * of them takes seconds: nothing that can run on every check of every
     * minute (numbers in the PR).
     */
    describe("once an hour", () => {
      let cached: Map<string, unknown>;
      let kept: Array<number>;

      beforeEach(() => {
        cached = new Map<string, unknown>();
        kept = [];

        jest
          .spyOn(GlobalCache, "getJSONObject")
          .mockImplementation(async (_: string, key: string) => {
            return (cached.get(key) as JSONObject) || null;
          });
        jest
          .spyOn(GlobalCache, "setJSON")
          .mockImplementation(
            async (
              _: string,
              key: string,
              value: JSONObject,
              options?: { expiresInSeconds: number },
            ) => {
              cached.set(key, value);
              kept.push(options?.expiresInSeconds || 0);
            },
          );
      });

      const pointReads: () => number = (): number => {
        return queries.filter((sql: string): boolean => {
          return sql.includes("keptUntil");
        }).length;
      };

      test("the second check of an hour reads nothing", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        const first: BaselineSummary | null = await readOne({
          attributes: { state: "idle" },
        });
        const reads: number = queries.length;
        const second: BaselineSummary | null = await readOne({
          attributes: { state: "idle" },
        });

        expect(second).toEqual(first);
        expect(queries).toHaveLength(reads);
      });

      test("so does a histogram's, which reads as much on every check of it", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          pointType: "Histogram",
        });

        const query: Partial<MetricBaselineQuery> = {
          isNarrowedByAttributes: false,
          scope: undefined,
        };

        await readOne({}, query);
        await readOne({}, query);

        expect(pointReads()).toBe(1);
      });

      test("the hours of a query are its own", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { state: "idle" } });
        await readOne({ attributes: { state: "user" } });
        await readOne({
          attributes: { state: "idle" },
          groupByAttributeKeys: ["host"],
        });
        await readOne(
          { attributes: { state: "idle" } },
          { aggregationType: AggregationType.Max },
        );
        await readOne(
          { attributes: { state: "idle" } },
          { interval: AggregationInterval.FiveMinutes },
        );
        await readOne(
          { attributes: { state: "idle" } },
          {},
          { primaryEntityId: serviceId },
        );

        expect(pointReads()).toBe(6);
      });

      test("the next hour and the next day read again", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        const readAt: (hourOfWeek: number, at: Date) => Promise<unknown> = (
          hourOfWeek: number,
          at: Date,
        ): Promise<unknown> => {
          return MetricBaselineService.getBaseline({
            projectId,
            metricName: "cpu.usage",
            hourOfWeek,
            judgedAt: at,
            query: queryOf({ attributes: { state: "idle" } }),
          });
        };

        await readAt(HOUR, judgedAt);
        await readAt(HOUR + 1, new Date("2026-11-30T10:40:00.000Z"));
        await readAt(HOUR, new Date("2026-12-07T09:40:00.000Z"));

        expect(pointReads()).toBe(3);
      });

      test("it is kept for an hour, and for as long as the window holds the hour", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        await readOne({ attributes: { state: "idle" } });
        await readOne(
          { attributes: { state: "user" } },
          { windowInMs: 6 * 60 * 60 * 1000 },
        );

        expect(kept).toEqual([3600, 3600 + 6 * 3600]);
      });

      // The kept copy has been through the JSON the cache writes and reads back.
      test("what is kept reads back as it was, through the cache's own JSON", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: [
            pointRow({ day: "2026-11-16", series: ["a"] }),
            pointRow({ day: "2026-11-23", series: ["a"] }),
          ],
        });

        jest
          .spyOn(GlobalCache, "getJSONObject")
          .mockImplementation(async (_: string, key: string) => {
            const written: JSONObject | undefined = cached.get(key) as
              | JSONObject
              | undefined;

            return written
              ? (JSONFunctions.deserialize(
                  JSON.parse(
                    JSON.stringify(JSONFunctions.serialize(written)),
                  ) as JSONObject,
                ) as JSONObject)
              : null;
          });

        const first: MetricSeriesBaselines = await readSeries({
          groupByAttributeKeys: ["host"],
        });
        const second: MetricSeriesBaselines = await readSeries({
          groupByAttributeKeys: ["host"],
        });

        expect(first.series.size).toBe(1);
        expect(second.series).toEqual(first.series);
      });

      test("a check still reads and judges when the cache is away", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: POINTS });

        jest
          .spyOn(GlobalCache, "getJSONObject")
          .mockRejectedValue(new Error("Valkey is away"));
        jest
          .spyOn(GlobalCache, "setJSON")
          .mockRejectedValue(new Error("Valkey is away"));

        expect(await readOne({ attributes: { state: "idle" } })).toMatchObject({
          mean: 40,
          isReliable: true,
        });
      });

      test("a read that failed is left for a while, and not for the hour", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          failsPoints: true,
        });

        await readOne({ attributes: { state: "idle" } });
        await readOne({ attributes: { state: "idle" } });

        expect(pointReads()).toBe(1);
        expect(kept).toEqual([300]);
      });
    });

    describe("a read that fails", () => {
      test("leaves an average on the cell it had", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          failsPoints: true,
        });

        expect(await readOne({ attributes: { state: "idle" } })).toMatchObject({
          mean: 100,
        });
      });

      test("leaves a Sum with no baseline: the cell is not on its scale", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: POINTS,
          failsPoints: true,
        });

        expect(
          await readOne(
            { attributes: { state: "idle" } },
            { aggregationType: AggregationType.Sum },
          ),
        ).toBeNull();
      });
    });

    /*
     * Raw rows are kept as long as telemetry retention, 15 days by default, and
     * the hourly rollup 90. With a shorter retention a series can never hold two
     * earlier weeks of its own, and must not learn for ever.
     */
    describe("how far its rows reach", () => {
      const WEEK_KEPT: Array<JSONObject> = [
        pointRow({ day: "2026-11-23", keptUntil: "2026-11-30 09:30:00" }),
      ];
      const YOUNG: Array<JSONObject> = [
        pointRow({ day: "2026-11-23", keptUntil: "2026-12-08 09:30:00" }),
      ];

      test("an average kept too briefly is judged by the cell", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: WEEK_KEPT });

        expect(await readOne({ attributes: { state: "idle" } })).toMatchObject({
          mean: 100,
          isReliable: true,
        });
      });

      test("a Sum kept too briefly keeps learning: the cell is not on its scale", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: WEEK_KEPT });

        expect(
          await readOne(
            { attributes: { state: "idle" } },
            { aggregationType: AggregationType.Sum },
          ),
        ).toMatchObject({ isReliable: false });
        expect(cellQueries()).toHaveLength(0);
      });

      test("a series that is only young learns: its own history is on the way", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: YOUNG });

        expect(await readOne({ attributes: { state: "idle" } })).toMatchObject({
          mean: 40,
          isReliable: false,
        });
        expect(cellQueries()).toHaveLength(0);
      });

      test("a series with no history at all learns", async () => {
        answerWith({ cell: [CELL], days: TWO_WEEKS, points: [] });

        expect(await readOne({ attributes: { state: "idle" } })).toBeNull();
      });

      test("the cell is read for a series kept too briefly, and for no other", async () => {
        answerWith({
          cell: [CELL],
          days: TWO_WEEKS,
          points: [
            pointRow({ day: "2026-11-16", series: ["a"] }),
            pointRow({ day: "2026-11-23", series: ["a"] }),
            pointRow({
              day: "2026-11-23",
              series: ["b"],
              keptUntil: "2026-11-30 09:30:00",
            }),
          ],
        });

        const baselines: MetricSeriesBaselines = await readSeries({
          groupByAttributeKeys: ["host"],
        });

        const seriesOf: (host: string) => BaselineSummary | null = (
          host: string,
        ): BaselineSummary | null => {
          return MetricBaselineServiceClass.getSeriesBaseline({
            baselines,
            seriesFingerprint: MetricSeriesFingerprint.computeFingerprint({
              host,
            }),
          });
        };

        expect(seriesOf("a")?.mean).toBe(40);
        expect(seriesOf("b")?.mean).toBe(100);
      });
    });

    test("what narrows a query that cannot name it keeps the cell", async () => {
      answerWith({ cell: [CELL], days: TWO_WEEKS, pointType: "Gauge" });

      expect(
        await MetricBaselineService.getBaseline({
          projectId,
          metricName: "cpu.usage",
          hourOfWeek: HOUR,
          judgedAt,
          query: {
            aggregationType: AggregationType.Avg,
            isNarrowedByAttributes: true,
            interval: AggregationInterval.Minute,
          },
        }),
      ).toMatchObject({ mean: 100 });
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
