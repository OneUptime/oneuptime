import MetricBaselineService, {
  BandPoint,
  BaselineSummary,
} from "../../../Server/Services/MetricBaselineService";
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
const HOURS_OF_DAY: string = "9, 33, 57, 81, 105, 129, 153";

const service: {
  executeQuery: (sql: string) => Promise<unknown>;
} = MetricBaselineService as unknown as {
  executeQuery: (sql: string) => Promise<unknown>;
};

interface Answers {
  cell: Array<JSONObject>;
  days: Array<JSONObject>;
}

let queries: Array<string>;

const answerWith: (answers: Answers) => void = (answers: Answers): void => {
  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(async (sql: string): Promise<unknown> => {
      queries.push(sql);

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
    return !sql.includes("rowDay");
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
    hourOfWeek: data.hourOfWeek ?? HOUR,
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
      primaryEntityId?: ObjectID | string;
      metricName?: string;
    }) => Promise<BaselineSummary | null> = (
      input: {
        judgedAt?: Date;
        windowDays?: number;
        minSamples?: number;
        primaryEntityId?: ObjectID | string;
        metricName?: string;
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
      expect(cellSql()).toContain(`AND hourOfWeek = ${HOUR}`);
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

      expect(daysSql()).toContain(`AND hourOfWeek IN (${HOURS_OF_DAY})`);
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
      hourOfWeek: HOUR,
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

      expect(cellSql()).toContain("AND hourOfWeek IN (9, 10)");
      expect(daysSql()).toContain(
        "AND hourOfWeek IN (9, 33, 57, 81, 105, 129, 153, 10, 34, 58, 82, 106, 130, 154)",
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
