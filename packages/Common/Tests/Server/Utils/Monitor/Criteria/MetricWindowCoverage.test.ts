import MetricWindowCoverage, {
  MetricEvaluationWindow,
  MetricWindowCoverageResult,
} from "../../../../../Server/Utils/Monitor/Criteria/MetricWindowCoverage";
import { WindowCoverageShortfall } from "../../../../../Server/Utils/Monitor/Criteria/WindowCoverage";
import AggregateModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import MetricMonitorResponse from "../../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";
import RollingTime from "../../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../../Types/RollingTime/RollingTimeUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether one metric series' data points cover its monitor's window - what
 * "All Values" over a time range needs before it can say the condition held
 * for the whole range (#4793). The window comes from the worker's response,
 * so nothing here reads the clock: every time is fixed.
 */

const MINUTE: number = 60_000;
const SECOND: number = 1000;

// The worker's window for Past 15 Minutes, evaluated at 12:15:30.
const NOW: Date = new Date(Date.UTC(2026, 9, 16, 12, 15, 30));
const WINDOW: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
  RollingTime.Past15Minutes,
  NOW,
);
const WINDOW_START: number = (WINDOW.startValue as Date).getTime();

function response(
  overrides: Partial<MetricMonitorResponse> = {},
): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    startAndEndDate: WINDOW,
    ...overrides,
  };
}

function window(): MetricEvaluationWindow {
  return MetricWindowCoverage.getWindow(response())!;
}

// A data point for the minute bucket starting at `utcMinute` past 12:00.
function point(utcMinute: number, value: number = 1): AggregateModel {
  return {
    timestamp: new Date(Date.UTC(2026, 9, 16, 12, 0, 0) + utcMinute * MINUTE),
    value: value,
  };
}

// One data point a minute, from the bucket at 12:`from` to 12:`to`.
function points(from: number, to: number): Array<AggregateModel> {
  const result: Array<AggregateModel> = [];
  for (let minute: number = from; minute <= to; minute++) {
    result.push(point(minute));
  }
  return result;
}

function judge(samples: Array<AggregateModel>): MetricWindowCoverageResult {
  return MetricWindowCoverage.judge({ window: window(), samples: samples });
}

describe("MetricWindowCoverage.getWindow", () => {
  test("reads the window the worker queried", () => {
    expect(window()).toEqual({
      startMs: WINDOW_START,
      endMs: NOW.getTime(),
      completeFromMs: null,
    });
  });

  test("reads it back after the response went through JSON", () => {
    const roundTripped: MetricMonitorResponse = JSON.parse(
      JSON.stringify(response()),
    );

    expect(MetricWindowCoverage.getWindow(roundTripped)).toEqual(window());
  });

  test("reads a plain object with string ends too", () => {
    expect(
      MetricWindowCoverage.getWindow(
        response({
          startAndEndDate: {
            startValue: new Date(WINDOW_START).toISOString(),
            endValue: NOW.toISOString(),
          } as unknown as InBetween<Date>,
        }),
      ),
    ).toEqual(window());
  });

  test("is null when the response does not say - a payload from before windows were recorded", () => {
    const withoutWindow: MetricMonitorResponse = response();
    delete withoutWindow.startAndEndDate;

    expect(MetricWindowCoverage.getWindow(undefined)).toBeNull();
    expect(MetricWindowCoverage.getWindow(withoutWindow)).toBeNull();
  });

  test("is null for a window that is not one", () => {
    expect(
      MetricWindowCoverage.getWindow(
        response({ startAndEndDate: new InBetween<Date>(NOW, NOW) }),
      ),
    ).toBeNull();
    expect(
      MetricWindowCoverage.getWindow(
        response({
          startAndEndDate: new InBetween<Date>(
            NOW,
            new Date(NOW.getTime() - MINUTE),
          ),
        }),
      ),
    ).toBeNull();
    expect(
      MetricWindowCoverage.getWindow(
        response({
          startAndEndDate: new InBetween<Date>(
            "not a date" as unknown as Date,
            NOW,
          ),
        }),
      ),
    ).toBeNull();
  });

  test("moves the start up to where a read cut at its row limit is complete", () => {
    const completeFrom: Date = new Date(NOW.getTime() - 4 * MINUTE);

    expect(
      MetricWindowCoverage.getWindow(
        response({ dataCompleteFrom: completeFrom }),
      ),
    ).toEqual({
      startMs: WINDOW_START,
      endMs: NOW.getTime(),
      completeFromMs: completeFrom.getTime(),
    });
  });

  test("ignores a complete-from before the window, and keeps one after it inside", () => {
    expect(
      MetricWindowCoverage.getWindow(
        response({ dataCompleteFrom: new Date(WINDOW_START - MINUTE) }),
      )?.completeFromMs,
    ).toBeNull();
    expect(
      MetricWindowCoverage.getWindow(
        response({ dataCompleteFrom: new Date(NOW.getTime() + MINUTE) }),
      )?.completeFromMs,
    ).toBe(NOW.getTime());
  });
});

describe("MetricWindowCoverage.getDataPointMs", () => {
  /*
   * The width of the buckets the worker reads: what one data point stands
   * for (the metrics monitor docs' "One data point per" table).
   */
  test.each([
    [RollingTime.Past1Minute, MINUTE],
    [RollingTime.Past15Minutes, MINUTE],
    [RollingTime.Past3Hours, MINUTE],
    [RollingTime.Past6Hours, 5 * MINUTE],
    [RollingTime.Past1Hours, 15 * MINUTE],
    [RollingTime.Past3Days, 30 * MINUTE],
    [RollingTime.Past7Days, 60 * MINUTE],
  ])("%s: one data point per %d ms", (rollingTime: RollingTime, ms: number) => {
    const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      rollingTime,
      NOW,
    );

    expect(
      MetricWindowCoverage.getDataPointMs({
        startMs: (range.startValue as Date).getTime(),
        endMs: NOW.getTime(),
        completeFromMs: null,
      }),
    ).toBe(ms);
  });
});

describe("MetricWindowCoverage.judge", () => {
  test("a series reporting every minute of the window covers it", () => {
    // Buckets 12:00 (the window starts at 12:00:30) to 12:15.
    const result: MetricWindowCoverageResult = judge(points(0, 15));

    expect(result.isCovered).toBe(true);
    expect(result.dataPointMs).toBe(MINUTE);
    expect(result.intervalMs).toBe(MINUTE);
    expect(result.isCutByRowLimit).toBe(false);
    expect(result.configuredWindowMs).toBe(15 * MINUTE);
  });

  test("whose newest minute is not in yet: still covered", () => {
    // Ingest lag: 12:15 has nothing yet, 12:14 ends 30 s before the end.
    expect(judge(points(0, 14)).isCovered).toBe(true);
  });

  test("a brand-new series with one data point waits", () => {
    const result: MetricWindowCoverageResult = judge([point(15)]);

    expect(result.isCovered).toBe(false);
    expect(result.shortfall).toBe(WindowCoverageShortfall.StartsLate);
  });

  test("13 minutes of data wait; the whole window is needed, give or take a data point", () => {
    // From 12:03: 2.5 minutes after the window's start.
    expect(judge(points(3, 15)).shortfall).toBe(
      WindowCoverageShortfall.StartsLate,
    );
    // From 12:02: 1.5 minutes after it - the allowance for one data point.
    expect(judge(points(2, 15)).isCovered).toBe(true);
  });

  test("a series with a hole of two missing minutes waits", () => {
    const result: MetricWindowCoverageResult = judge([
      ...points(0, 6),
      ...points(9, 15),
    ]);

    expect(result.shortfall).toBe(WindowCoverageShortfall.Hole);
    expect(result.holeBeforeRunMs).toBe(2 * MINUTE);
  });

  test("one missing minute is bridged", () => {
    expect(judge([...points(0, 6), ...points(8, 15)]).isCovered).toBe(true);
  });

  test("a series that stopped reporting waits", () => {
    const result: MetricWindowCoverageResult = judge(points(0, 11));

    expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
    // The 12:11 bucket ended at 12:12, three and a half minutes ago.
    expect(result.sinceNewestReadingMs).toBe(3.5 * MINUTE);
  });

  test("a series exported every 5 minutes is judged against its own cadence", () => {
    const result: MetricWindowCoverageResult = judge([
      point(2),
      point(7),
      point(12),
    ]);

    expect(result.intervalMs).toBe(5 * MINUTE);
    expect(result.isCovered).toBe(true);
  });

  test("a single data point of a slow series cannot say what its cadence is, and waits", () => {
    expect(judge([point(12)]).isCovered).toBe(false);
  });

  test("timestamps that arrive as strings are read", () => {
    const samples: Array<AggregateModel> = points(0, 15).map(
      (sample: AggregateModel) => {
        return {
          ...sample,
          timestamp: (
            sample.timestamp as Date
          ).toISOString() as unknown as Date,
        };
      },
    );

    expect(judge(samples).isCovered).toBe(true);
  });

  test("data points with no readable time leave nothing to judge", () => {
    expect(
      judge([
        { timestamp: "garbage" as unknown as Date, value: 1 },
        { timestamp: undefined as unknown as Date, value: 1 },
      ]).shortfall,
    ).toBe(WindowCoverageShortfall.NoReadings);
  });

  describe("a read cut at its row limit", () => {
    const cut: MetricEvaluationWindow = {
      startMs: WINDOW_START,
      endMs: NOW.getTime(),
      // The newest rows the read returned go back to 12:11:10.
      completeFromMs: NOW.getTime() - 4 * MINUTE - 20 * SECOND,
    };

    test("judges the window from where the data is complete", () => {
      const result: MetricWindowCoverageResult = MetricWindowCoverage.judge({
        window: cut,
        samples: points(11, 15),
      });

      expect(result.isCovered).toBe(true);
      expect(result.isCutByRowLimit).toBe(true);
      expect(result.windowStartMs).toBe(cut.completeFromMs);
      expect(result.configuredWindowMs).toBe(15 * MINUTE);
    });

    test("and a series that began after that still waits", () => {
      expect(
        MetricWindowCoverage.judge({ window: cut, samples: points(14, 15) })
          .shortfall,
      ).toBe(WindowCoverageShortfall.StartsLate);
    });
  });

  test("long ranges are judged in their own buckets", () => {
    const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past1Hours,
      NOW,
    );
    const startMs: number = (range.startValue as Date).getTime();
    const samples: Array<AggregateModel> = [];

    // One data point every 15 minutes across the day.
    for (let timeMs: number = startMs; timeMs <= NOW.getTime(); ) {
      samples.push({ timestamp: new Date(timeMs), value: 1 });
      timeMs += 15 * MINUTE;
    }

    const result: MetricWindowCoverageResult = MetricWindowCoverage.judge({
      window: { startMs, endMs: NOW.getTime(), completeFromMs: null },
      samples,
    });

    expect(result.dataPointMs).toBe(15 * MINUTE);
    expect(result.isCovered).toBe(true);
  });
});

describe("MetricWindowCoverage.describeWait", () => {
  test("a new series: how much of the window it has so far", () => {
    expect(MetricWindowCoverage.describeWait(judge(points(13, 15)))).toBe(
      "Waiting for 15 minutes of data: 2 of 15 minutes so far.",
    );
  });

  test("one data point: a minute so far", () => {
    expect(MetricWindowCoverage.describeWait(judge([point(14)]))).toBe(
      "Waiting for 15 minutes of data: 1 of 15 minutes so far.",
    );
  });

  test("less than a minute so far", () => {
    expect(
      MetricWindowCoverage.describeWait(
        MetricWindowCoverage.judge({
          window: window(),
          // The 12:15 bucket, 30 seconds of which are in the window.
          samples: [point(15)],
        }),
      ),
    ).toBe(
      "Waiting for 15 minutes of data: less than a minute of 15 minutes so far.",
    );
  });

  test("a hole: how long since it, and how big it was", () => {
    expect(
      MetricWindowCoverage.describeWait(
        judge([...points(0, 6), ...points(11, 15)]),
      ),
    ).toBe(
      "Waiting for 15 minutes of data: 4 of 15 minutes so far, since a 4-minute gap in its data.",
    );
  });

  test("stale: how long nothing came", () => {
    expect(MetricWindowCoverage.describeWait(judge(points(0, 10)))).toBe(
      "Waiting for 15 minutes of data: no new data point for the last 4 minutes.",
    );
  });

  test("hours and days read in their own unit", () => {
    const range: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past2Hours,
      NOW,
    );
    const startMs: number = (range.startValue as Date).getTime();
    const samples: Array<AggregateModel> = [];

    for (let minute: number = 75; minute <= 120; minute++) {
      samples.push({
        timestamp: new Date(startMs + minute * MINUTE),
        value: 1,
      });
    }

    expect(
      MetricWindowCoverage.describeWait(
        MetricWindowCoverage.judge({
          window: { startMs, endMs: NOW.getTime(), completeFromMs: null },
          samples,
        }),
      ),
    ).toBe("Waiting for 2 hours of data: 45 minutes of 2 hours so far.");
  });

  test("a cut read says the newest part is all that could be read", () => {
    const cut: MetricEvaluationWindow = {
      startMs: WINDOW_START,
      endMs: NOW.getTime(),
      completeFromMs: NOW.getTime() - 5 * MINUTE,
    };

    expect(
      MetricWindowCoverage.describeWait(
        MetricWindowCoverage.judge({ window: cut, samples: points(13, 15) }),
      ),
    ).toBe(
      "Waiting for 5 minutes of data: 2 of 5 minutes so far. Only the newest 5 minutes of the 15-minute time range could be read: it holds more data points than one check reads.",
    );
  });

  test.each([
    [30 * SECOND, "less than a minute"],
    [MINUTE, "1 minute"],
    [90 * MINUTE, "90 minutes"],
    [2 * 60 * MINUTE, "2 hours"],
    [36 * 60 * MINUTE, "36 hours"],
    [7 * 24 * 60 * MINUTE, "7 days"],
  ])("describeDuration(%d) is %s", (ms: number, text: string) => {
    expect(MetricWindowCoverage.describeDuration(ms)).toBe(text);
  });
});
