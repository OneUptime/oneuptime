import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import {
  APP_JANK_EVENT_NAME,
  APP_JANK_FRAME_COUNT_ATTRIBUTE,
  APP_JANK_THRESHOLD_ATTRIBUTE,
  APP_SCREEN_NAME_ATTRIBUTE,
  APP_START_SPAN_NAME,
  APP_START_TYPE_ATTRIBUTE,
  FROZEN_FRAME_THRESHOLD,
  SLOW_FRAME_THRESHOLD,
} from "Common/Types/Rum/MobileAppTelemetry";
import { ANR_EXCEPTION_TYPE } from "Common/Utils/Telemetry/MobileAppFaults";
import {
  FRAMES_BY_SCREEN_LIMIT,
  FRAMES_BY_SCREEN_READ_LIMIT,
  MobileAppStarts,
  MobileSignalScope,
  ScreenFrames,
  TimePoint,
  buildAnrFilterBody,
  buildAppStartSeriesBody,
  buildAppStartTableBody,
  buildCrashFilterBody,
  buildFrameSeriesBody,
  buildFramesByScreenBody,
  buildSessionCountBody,
  emptyAppStarts,
  emptyFrames,
  readFaultSessions,
  readFrameThreshold,
  readSessionCount,
  summarizeAppStarts,
  summarizeFaultBuckets,
  summarizeFrameSeries,
  summarizeFramesByScreen,
} from "../../FeatureSet/Dashboard/src/Components/Rum/MobileOverview/MobileRumSignalData";

/*
 * What a mobile RUM application's Overview reads (#9588): the request each
 * read sends, and how its answer becomes what the tiles and charts draw.
 * MobileRumSignalData is React-free and API-free, so every fold runs here
 * for real.
 */

const APP_ID: ObjectID = new ObjectID("84858d6c-1111-4aaa-8bbb-000000000001");
const SCOPE: MobileSignalScope = {
  primaryEntityId: APP_ID,
  start: new Date("2026-11-19T09:00:00.000Z"),
  end: new Date("2026-11-19T10:00:00.000Z"),
};

// ClickHouse writes a bucket's time in UTC with no zone.
const T0: string = "2026-11-19 09:00:00";
const T1: string = "2026-11-19 09:05:00";
const T0_MS: number = Date.parse("2026-11-19T09:00:00.000Z");
const T1_MS: number = Date.parse("2026-11-19T09:05:00.000Z");

function points(series: Array<TimePoint>): Array<[number, number]> {
  return series.map((point: TimePoint): [number, number] => {
    return [point.x.getTime(), point.y];
  });
}

describe("the requests", () => {
  const WINDOW: JSONObject = {
    startTime: "2026-11-19T09:00:00.000Z",
    endTime: "2026-11-19T10:00:00.000Z",
    serviceIds: [APP_ID.toString()],
  };

  test("app starts: one table row per start type, over the AppStart spans of this app", () => {
    expect(buildAppStartTableBody(SCOPE)).toEqual({
      ...WINDOW,
      chartType: "table",
      metric: "count",
      groupBy: ["start.type"],
      spanNames: ["AppStart"],
      limit: 10,
    });
  });

  test("app starts per interval: a count, and the p95 duration, each split by start type", () => {
    expect(buildAppStartSeriesBody(SCOPE, "count")).toEqual({
      ...WINDOW,
      chartType: "timeseries",
      metric: "count",
      groupBy: ["start.type"],
      spanNames: ["AppStart"],
      limit: 10,
    });
    expect(buildAppStartSeriesBody(SCOPE, "p95Duration")["metric"]).toBe(
      "p95Duration",
    );
  });

  test("the names are the ones OpenTelemetry Android sends", () => {
    expect(APP_START_SPAN_NAME).toBe("AppStart");
    expect(APP_START_TYPE_ATTRIBUTE).toBe("start.type");
    expect(APP_JANK_EVENT_NAME).toBe("app.jank");
    expect(APP_JANK_FRAME_COUNT_ATTRIBUTE).toBe("app.jank.frame_count");
    expect(APP_JANK_THRESHOLD_ATTRIBUTE).toBe("app.jank.threshold");
    expect(APP_SCREEN_NAME_ATTRIBUTE).toBe("app.screen.name");
    expect(SLOW_FRAME_THRESHOLD).toBe("0.016");
    expect(FROZEN_FRAME_THRESHOLD).toBe("0.7");
  });

  test("sessions: the window and the app, nothing else", () => {
    expect(buildSessionCountBody(SCOPE)).toEqual(WINDOW);
  });

  test("a crash is an unhandled exception that is no ANR", () => {
    expect(buildCrashFilterBody(SCOPE)).toEqual({
      ...WINDOW,
      escaped: true,
      excludedExceptionTypes: [ANR_EXCEPTION_TYPE],
    });
  });

  test("an ANR is the type ANR", () => {
    expect(buildAnrFilterBody(SCOPE)).toEqual({
      ...WINDOW,
      exceptionTypes: ["ANR"],
    });
  });

  test("frames: app.jank.frame_count added up per threshold and interval, of the app.jank events alone", () => {
    expect(buildFrameSeriesBody(SCOPE)).toEqual({
      ...WINDOW,
      chartType: "timeseries",
      aggregation: "sum",
      aggregationField: "app.jank.frame_count",
      groupBy: ["app.jank.threshold"],
      attributes: { "event.name": "app.jank" },
    });
  });

  test("frames per screen: per screen and threshold, enough rows for every listed screen's two", () => {
    expect(buildFramesByScreenBody(SCOPE)).toEqual({
      ...WINDOW,
      chartType: "table",
      aggregation: "sum",
      aggregationField: "app.jank.frame_count",
      groupBy: ["app.screen.name", "app.jank.threshold"],
      attributes: { "event.name": "app.jank" },
      limit: FRAMES_BY_SCREEN_READ_LIMIT,
    });
    expect(FRAMES_BY_SCREEN_READ_LIMIT).toBeGreaterThanOrEqual(
      FRAMES_BY_SCREEN_LIMIT * 2,
    );
  });
});

describe("summarizeAppStarts", () => {
  const TABLE: Array<JSONObject> = [
    {
      groupValues: { "start.type": "cold" },
      count: 12,
      p50DurationMs: 1100,
      p95DurationMs: 2300,
    },
    {
      groupValues: { "start.type": "warm" },
      count: "30",
      p50DurationMs: "400",
      p95DurationMs: "900",
    },
  ];

  test("reads each start type's count and percentiles, and the total of all", () => {
    const result: MobileAppStarts = summarizeAppStarts({
      tableRows: TABLE,
      countRows: [],
      p95Rows: [],
    });

    expect(result.failed).toBe(false);
    expect(result.total).toBe(42);
    expect(result.byType.cold).toEqual({
      count: 12,
      p50DurationMs: 1100,
      p95DurationMs: 2300,
    });
    expect(result.byType.warm).toEqual({
      count: 30,
      p50DurationMs: 400,
      p95DurationMs: 900,
    });
    // No hot start: no time, never 0 ms.
    expect(result.byType.hot).toEqual({
      count: 0,
      p50DurationMs: null,
      p95DurationMs: null,
    });
  });

  test("a start type the SDK does not use counts in the total, and gets no line", () => {
    const result: MobileAppStarts = summarizeAppStarts({
      tableRows: [
        ...TABLE,
        {
          groupValues: { "start.type": "prewarm" },
          count: 5,
          p95DurationMs: 9,
        },
      ],
      countRows: [
        { time: T0, value: 3, groupValues: { "start.type": "prewarm" } },
      ],
      p95Rows: [],
    });

    expect(result.total).toBe(47);
    expect(result.countSeries.cold).toEqual([]);
    expect(result.countSeries.warm).toEqual([]);
    expect(result.countSeries.hot).toEqual([]);
  });

  test("the start type is read whatever its case", () => {
    const result: MobileAppStarts = summarizeAppStarts({
      tableRows: [
        { groupValues: { "start.type": "COLD" }, count: 2, p95DurationMs: 5 },
      ],
      countRows: [],
      p95Rows: [],
    });

    expect(result.byType.cold.count).toBe(2);
  });

  test("the per-interval rows become one sorted line per start type, read as UTC", () => {
    const result: MobileAppStarts = summarizeAppStarts({
      tableRows: TABLE,
      countRows: [
        { time: T1, value: 4, groupValues: { "start.type": "cold" } },
        { time: T0, value: 8, groupValues: { "start.type": "cold" } },
        { time: T0, value: "30", groupValues: { "start.type": "warm" } },
      ],
      p95Rows: [
        { time: T0, value: 2100.5, groupValues: { "start.type": "cold" } },
        { time: T1, value: 2500, groupValues: { "start.type": "cold" } },
      ],
    });

    expect(points(result.countSeries.cold)).toEqual([
      [T0_MS, 8],
      [T1_MS, 4],
    ]);
    expect(points(result.countSeries.warm)).toEqual([[T0_MS, 30]]);
    expect(points(result.p95Series.cold)).toEqual([
      [T0_MS, 2100.5],
      [T1_MS, 2500],
    ]);
  });

  test("rows that are no row, no group or no time are left out", () => {
    const result: MobileAppStarts = summarizeAppStarts({
      tableRows: [null, "x", { count: 3 }, { groupValues: "cold", count: 1 }],
      countRows: [
        { time: "garbage", value: 1, groupValues: { "start.type": "cold" } },
        { value: 2, groupValues: { "start.type": "cold" } },
      ],
      p95Rows: "not rows",
    });

    // Rows with a count and no start type still count towards the total.
    expect(result.total).toBe(4);
    expect(result.byType.cold.count).toBe(0);
    expect(result.countSeries.cold).toEqual([]);
    expect(result.p95Series.cold).toEqual([]);
  });

  test("no answer is no app start, and not a failure", () => {
    expect(
      summarizeAppStarts({ tableRows: [], countRows: [], p95Rows: [] }),
    ).toEqual(emptyAppStarts(false));
  });

  test("a failed read is marked failed and draws nothing", () => {
    const failed: MobileAppStarts = emptyAppStarts(true);

    expect(failed.failed).toBe(true);
    expect(failed.total).toBe(0);
  });
});

describe("readSessionCount", () => {
  test("reads the sessions and the spans, numbers or numeric text", () => {
    expect(readSessionCount({ sessions: "12", spans: 4096 })).toEqual({
      sessions: 12,
      spans: 4096,
      failed: false,
    });
  });

  test("an answer that is no answer is no session", () => {
    for (const data of [null, undefined, "x", [], { sessions: "lots" }]) {
      expect(readSessionCount(data)).toEqual({
        sessions: 0,
        spans: 0,
        failed: false,
      });
    }
  });
});

describe("summarizeFaultBuckets", () => {
  test("adds up every series of the histogram, per interval and in total", () => {
    const result: { total: number; series: Array<TimePoint> } =
      summarizeFaultBuckets([
        { time: T1, series: "unhandled", count: 2 },
        { time: T0, series: "unhandled", count: 3 },
        { time: T0, series: "handled", count: 1 },
      ]);

    expect(result.total).toBe(6);
    expect(points(result.series)).toEqual([
      [T0_MS, 4],
      [T1_MS, 2],
    ]);
  });

  test("a bucket without a time counts in the total and draws no point", () => {
    const result: { total: number; series: Array<TimePoint> } =
      summarizeFaultBuckets([{ series: "unhandled", count: 5 }]);

    expect(result.total).toBe(5);
    expect(result.series).toEqual([]);
  });

  test("buckets with no count, or none worth reading, add nothing", () => {
    expect(
      summarizeFaultBuckets([
        { time: T0, count: 0 },
        { time: T0, count: "nope" },
        { time: T0 },
      ]),
    ).toEqual({ total: 0, series: [] });
    expect(summarizeFaultBuckets(null)).toEqual({ total: 0, series: [] });
  });

  test("the sessions are read from a session-count answer", () => {
    expect(readFaultSessions({ sessions: "7", occurrences: 9 })).toBe(7);
    expect(readFaultSessions(null)).toBe(0);
  });
});

describe("readFrameThreshold", () => {
  test.each([
    ["0.7", "frozen"],
    ["0.70", "frozen"],
    ["0.016", "slow"],
    ["0.0160", "slow"],
    ["1.024", null],
    ["0.5", null],
    ["", null],
    ["   ", null],
    ["frozen", null],
  ])("reads %j as %j", (value: string, expected: string | null) => {
    expect(readFrameThreshold(value)).toBe(expected);
  });
});

describe("summarizeFrameSeries", () => {
  test("adds up the frames at each threshold, per interval and in total", () => {
    const result: ReturnType<typeof summarizeFrameSeries> =
      summarizeFrameSeries([
        { time: T0, count: 40, groupValues: { "app.jank.threshold": "0.016" } },
        {
          time: T1,
          count: "12",
          groupValues: { "app.jank.threshold": "0.016" },
        },
        { time: T1, count: 3, groupValues: { "app.jank.threshold": "0.7" } },
      ]);

    expect(result.slow).toBe(52);
    expect(result.frozen).toBe(3);
    expect(points(result.slowSeries)).toEqual([
      [T0_MS, 40],
      [T1_MS, 12],
    ]);
    expect(points(result.frozenSeries)).toEqual([[T1_MS, 3]]);
  });

  test("a threshold other than the two is no slow or frozen frame", () => {
    expect(
      summarizeFrameSeries([
        { time: T0, count: 9, groupValues: { "app.jank.threshold": "1.024" } },
        { time: T0, count: 9, groupValues: {} },
      ]),
    ).toEqual({ slow: 0, frozen: 0, slowSeries: [], frozenSeries: [] });
  });

  test("no answer is no frame", () => {
    expect(summarizeFrameSeries(undefined)).toEqual({
      slow: 0,
      frozen: 0,
      slowSeries: [],
      frozenSeries: [],
    });
  });

  test("a failed read is marked failed, the per-screen read with it", () => {
    expect(emptyFrames(true)).toEqual({
      slow: 0,
      frozen: 0,
      slowSeries: [],
      frozenSeries: [],
      byScreen: [],
      failed: true,
      byScreenFailed: true,
    });
  });
});

describe("summarizeFramesByScreen", () => {
  function row(screen: string, threshold: string, count: number): JSONObject {
    return {
      groupValues: {
        "app.screen.name": screen,
        "app.jank.threshold": threshold,
      },
      count,
    };
  }

  test("folds each screen's two thresholds into one row", () => {
    expect(
      summarizeFramesByScreen([
        row("CheckoutActivity", "0.016", 40),
        row("CheckoutActivity", "0.7", 3),
      ]),
    ).toEqual([{ screen: "CheckoutActivity", slow: 40, frozen: 3 }]);
  });

  test("ranks the screens that froze most first, then the slowest", () => {
    const screens: Array<ScreenFrames> = summarizeFramesByScreen([
      row("MenuActivity", "0.016", 300),
      row("CartActivity", "0.016", 20),
      row("CartActivity", "0.7", 2),
      row("PaymentActivity", "0.016", 10),
      row("PaymentActivity", "0.7", 6),
      row("SplashActivity", "0.016", 300),
    ]);

    expect(
      screens.map((screen: ScreenFrames): string => {
        return screen.screen;
      }),
    ).toEqual([
      "PaymentActivity",
      "CartActivity",
      "MenuActivity",
      "SplashActivity",
    ]);
  });

  test("lists at most the limit", () => {
    const rows: Array<JSONObject> = Array.from(
      { length: 15 },
      (_: unknown, i: number): JSONObject => {
        return row(`Screen${i}`, "0.7", i + 1);
      },
    );

    expect(summarizeFramesByScreen(rows)).toHaveLength(FRAMES_BY_SCREEN_LIMIT);
    expect(summarizeFramesByScreen(rows, 3)).toHaveLength(3);
    expect(summarizeFramesByScreen(rows)[0]?.screen).toBe("Screen14");
  });

  test("a row with no screen, no frames or another threshold is left out", () => {
    expect(
      summarizeFramesByScreen([
        row("", "0.7", 5),
        row("  ", "0.7", 5),
        row("HomeActivity", "0.7", 0),
        row("HomeActivity", "1.024", 5),
        { count: 4 },
      ]),
    ).toEqual([]);
  });
});
