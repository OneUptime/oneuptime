import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionLearnedBaselineUtil, {
  EXCEPTION_BASELINE_CACHE_NAMESPACE,
  EXCEPTION_BASELINE_CACHE_SECONDS,
  EXCEPTION_BASELINE_MINIMUM_WINDOWS_PER_WEEK,
  ExceptionAnomalyJudgement,
  ExceptionAnomalyState,
  ExceptionBaselineWeek,
} from "../../../../Server/Utils/Monitor/ExceptionLearnedBaseline";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ServiceService from "../../../../Server/Services/ServiceService";
import AnalyticsQuery from "../../../../Server/Types/AnalyticsDatabase/Query";
import ExceptionInstance from "../../../../Models/AnalyticsModels/ExceptionInstance";
import Project from "../../../../Models/DatabaseModels/Project";
import Service from "../../../../Models/DatabaseModels/Service";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../../Types/BaseDatabase/Search";
import {
  AnomalyDetectionMethod,
  AnomalyDetectionSensitivity,
  FilterType,
  MetricAnomalyDetectionOptions,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  EXCEPTION_ANOMALY_MINIMUM_COUNT,
  getExceptionIncreasePercent,
} from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import { ExceptionLearnedBaseline } from "../../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * The learned baseline of an Exceptions monitor: which earlier hours it
 * reads, what they say is normal, and whether a window is. The numbers come
 * from services simulated with seeded random counts, with the rhythms the
 * issue names (a weekly peak, a slow climb, a quiet service, a new one), so
 * what is pinned is what a monitor does with such a service.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;

const WINDOW_SECONDS: number = 900;
const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

// A Monday, in the middle of an hour.
const WINDOW_END: Date = new Date("2026-11-02T09:40:00.000Z");
const WINDOW_START: Date = new Date(
  WINDOW_END.getTime() - WINDOW_SECONDS * SECOND,
);

const ago: (milliseconds: number) => Date = (milliseconds: number): Date => {
  return new Date(WINDOW_END.getTime() - milliseconds);
};

// A Poisson draw: how many exceptions a window of this mean actually holds.
function poisson(random: SeededRandom, mean: number): number {
  const limit: number = Math.exp(-mean);
  let product: number = random();
  let count: number = 0;

  while (product > limit) {
    count++;
    product = product * random();
  }

  return count;
}

// Weeks of windows of a service at this rate, as the earlier weeks read.
function simulate(data: {
  seed: number;
  mean: number;
  weeks?: number | undefined;
  windowsPerWeek?: number | undefined;
}): Array<Array<number>> {
  const random: SeededRandom = seededRandom(data.seed);
  const weeks: Array<Array<number>> = [];

  for (let week: number = 0; week < (data.weeks || 2); week++) {
    const counts: Array<number> = [];

    for (let index: number = 0; index < (data.windowsPerWeek || 4); index++) {
      counts.push(poisson(random, data.mean));
    }

    weeks.push(counts);
  }

  return weeks;
}

function baselineOf(weeks: Array<Array<number>>): ExceptionLearnedBaseline {
  return ExceptionLearnedBaselineUtil.summarize({
    windowDays: 14,
    windowSeconds: WINDOW_SECONDS,
    weeks,
  });
}

function judge(
  count: number,
  weeks: Array<Array<number>>,
  options: MetricAnomalyDetectionOptions = {
    sensitivity: AnomalyDetectionSensitivity.Medium,
  },
  filterType: FilterType = FilterType.AnomalouslyHigh,
): ExceptionAnomalyJudgement {
  return ExceptionLearnedBaselineUtil.judge({
    count,
    baseline: baselineOf(weeks),
    filterType,
    options,
  });
}

function stateOf(
  count: number,
  weeks: Array<Array<number>>,
  options?: MetricAnomalyDetectionOptions,
  filterType?: FilterType,
): ExceptionAnomalyState {
  return judge(count, weeks, options, filterType).state;
}

describe("the earlier weeks a baseline reads", () => {
  const weeksOf: (data?: {
    windowEnd?: Date;
    windowSeconds?: number;
    windowDays?: number;
  }) => Array<ExceptionBaselineWeek> = (
    data: {
      windowEnd?: Date;
      windowSeconds?: number;
      windowDays?: number;
    } = {},
  ): Array<ExceptionBaselineWeek> => {
    const windowEnd: Date = data.windowEnd || WINDOW_END;
    const windowSeconds: number = data.windowSeconds || WINDOW_SECONDS;

    return ExceptionLearnedBaselineUtil.getWeeks({
      windowStart: new Date(windowEnd.getTime() - windowSeconds * SECOND),
      windowEnd,
      windowSeconds,
      windowDays: data.windowDays || 14,
    });
  };

  test("the clock hour the window is in, one and two weeks back", () => {
    expect(weeksOf()).toEqual([
      {
        weeksBack: 1,
        start: new Date("2026-10-26T09:00:00.000Z"),
        end: new Date("2026-10-26T10:00:00.000Z"),
        windowCount: 4,
      },
      {
        weeksBack: 2,
        start: new Date("2026-10-19T09:00:00.000Z"),
        end: new Date("2026-10-19T10:00:00.000Z"),
        windowCount: 4,
      },
    ]);
  });

  test("a week for every seven days of the baseline window", () => {
    expect(weeksOf({ windowDays: 14 })).toHaveLength(2);
    expect(weeksOf({ windowDays: 28 })).toHaveLength(4);
    expect(weeksOf({ windowDays: 60 })).toHaveLength(8);
    expect(weeksOf({ windowDays: 90 })).toHaveLength(12);
  });

  test("the same hours all hour, which is what lets them be cached", () => {
    const first: Array<ExceptionBaselineWeek> = weeksOf({
      windowEnd: new Date("2026-11-02T09:16:00.000Z"),
    });

    for (const minute of ["20", "33", "47", "59"]) {
      expect(
        weeksOf({
          windowEnd: new Date(`2026-11-02T09:${minute}:30.000Z`),
        }),
      ).toEqual(first);
    }
  });

  test("a window that straddles two hours reads both, as a rhythm changes on the hour", () => {
    const week: ExceptionBaselineWeek = weeksOf({
      windowEnd: new Date("2026-11-02T09:05:00.000Z"),
    })[0]!;

    expect(week.start).toEqual(new Date("2026-10-26T08:00:00.000Z"));
    expect(week.end).toEqual(new Date("2026-10-26T10:00:00.000Z"));
    expect(week.windowCount).toBe(8);
  });

  test("a long window gets a few of its own length around it", () => {
    for (const windowSeconds of [1800, 3600, 21600, 43200, 86400]) {
      for (const week of weeksOf({ windowSeconds })) {
        expect(week.windowCount).toBeGreaterThanOrEqual(
          EXCEPTION_BASELINE_MINIMUM_WINDOWS_PER_WEEK,
        );
      }
    }
  });

  test("every window the form offers: whole windows on countPerWindow's boundaries, none reaching the window judged", () => {
    const random: SeededRandom = seededRandom(5472);

    for (const windowSeconds of [
      5, 10, 30, 60, 300, 420, 600, 900, 1800, 3600, 21600, 43200, 86400,
    ]) {
      for (let draw: number = 0; draw < 40; draw++) {
        const windowEnd: Date = new Date(
          WINDOW_END.getTime() + Math.floor(random() * WEEK),
        );
        const windowStart: Date = new Date(
          windowEnd.getTime() - windowSeconds * SECOND,
        );
        const windowInMs: number = windowSeconds * SECOND;

        for (const week of weeksOf({ windowEnd, windowSeconds })) {
          expect(week.start.getTime() % windowInMs).toBe(0);
          expect(week.end.getTime() % windowInMs).toBe(0);
          expect(week.end.getTime()).toBeLessThanOrEqual(windowStart.getTime());
          expect((week.end.getTime() - week.start.getTime()) / windowInMs).toBe(
            week.windowCount,
          );
        }
      }
    }
  });

  test("the first week back and the second read the same time of the week", () => {
    const [first, second]: Array<ExceptionBaselineWeek> = weeksOf();

    expect(first!.start.getUTCDay()).toBe(second!.start.getUTCDay());
    expect(first!.start.getUTCHours()).toBe(second!.start.getUTCHours());
  });

  test("a window of a week or more has no earlier week of its own", () => {
    expect(weeksOf({ windowSeconds: 7 * 24 * 60 * 60 })).toEqual([]);
    expect(weeksOf({ windowSeconds: 30 * 24 * 60 * 60 })).toEqual([]);
  });
});

describe("toWindowCounts: one count per window, zeros included", () => {
  const week: ExceptionBaselineWeek = {
    weeksBack: 1,
    start: new Date("2026-10-26T09:00:00.000Z"),
    end: new Date("2026-10-26T10:00:00.000Z"),
    windowCount: 4,
  };

  test("the windows that held nothing are zeros, not missing", () => {
    expect(
      ExceptionLearnedBaselineUtil.toWindowCounts({
        week,
        windowSeconds: WINDOW_SECONDS,
        counts: [
          { time: new Date("2026-10-26T09:15:00.000Z"), count: 7 },
          { time: new Date("2026-10-26T09:45:00.000Z"), count: 2 },
        ],
      }),
    ).toEqual([0, 7, 0, 2]);
  });

  test("nothing at all is a week of zeros", () => {
    expect(
      ExceptionLearnedBaselineUtil.toWindowCounts({
        week,
        windowSeconds: WINDOW_SECONDS,
        counts: [],
      }),
    ).toEqual([0, 0, 0, 0]);
  });

  test("an occurrence at the very end of the range is the next window's", () => {
    expect(
      ExceptionLearnedBaselineUtil.toWindowCounts({
        week,
        windowSeconds: WINDOW_SECONDS,
        counts: [{ time: week.end, count: 3 }],
      }),
    ).toEqual([0, 0, 0, 0]);
  });

  test("a window before the range is left out", () => {
    expect(
      ExceptionLearnedBaselineUtil.toWindowCounts({
        week,
        windowSeconds: WINDOW_SECONDS,
        counts: [{ time: new Date("2026-10-26T08:45:00.000Z"), count: 3 }],
      }),
    ).toEqual([0, 0, 0, 0]);
  });
});

describe("summarize: what the earlier weeks say is normal", () => {
  test("the windows that held nothing count, unlike a baseline of non-empty cells", () => {
    /*
     * One exception a window, in one window of sixteen. Taken as the windows
     * that held something, it reads as a service throwing one every window.
     */
    const baseline: ExceptionLearnedBaseline = baselineOf([
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ]);

    expect(baseline.sampleCount).toBe(16);
    expect(baseline.mean).toBeCloseTo(1 / 16);
    expect(baseline.maxObserved).toBe(1);
  });

  test("its weeks of history are the weeks it was read from", () => {
    expect(baselineOf([[1], [2], [3]]).weeksOfHistory).toBe(3);
    expect(baselineOf([]).weeksOfHistory).toBe(0);
  });

  test("no history: nothing to say, and every number is a number", () => {
    expect(baselineOf([])).toEqual({
      windowDays: 14,
      windowSeconds: WINDOW_SECONDS,
      weeksOfHistory: 0,
      sampleCount: 0,
      mean: 0,
      stddev: 0,
      median: 0,
      madSigma: 0,
      minObserved: 0,
      maxObserved: 0,
    });
  });

  test("a flat history is as noisy as chance makes a count, not perfectly steady", () => {
    const baseline: ExceptionLearnedBaseline = baselineOf([
      [16, 16, 16, 16],
      [16, 16, 16, 16],
    ]);

    expect(baseline.stddev).toBeCloseTo(4);
    expect(baseline.madSigma).toBeCloseTo(4);
  });

  test("a spread wider than chance is kept", () => {
    const baseline: ExceptionLearnedBaseline = baselineOf([
      [0, 100, 0, 100],
      [0, 100, 0, 100],
    ]);

    expect(baseline.stddev).toBeCloseTo(50);
  });

  test("a service that threw nothing still has a spread, so a burst is judged", () => {
    const baseline: ExceptionLearnedBaseline = baselineOf([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    expect(baseline.mean).toBe(0);
    expect(baseline.stddev).toBe(1);
  });

  test("survives the cache: plain numbers only", () => {
    const baseline: ExceptionLearnedBaseline = baselineOf(
      simulate({ seed: 11, mean: 12 }),
    );

    expect(JSON.parse(JSON.stringify(baseline))).toEqual(baseline);
  });
});

describe("judge: seasonality", () => {
  /*
   * A service whose Monday-morning peak is thirty times its Sunday night,
   * as the same hours of the weeks before read.
   */
  const mondayMorning: Array<Array<number>> = simulate({ seed: 1, mean: 120 });
  const sundayNight: Array<Array<number>> = simulate({ seed: 2, mean: 4 });

  test("the Monday-morning peak is normal on a Monday morning", () => {
    expect(stateOf(130, mondayMorning)).toBe(ExceptionAnomalyState.Normal);
  });

  test("the same count at the quiet hour is a spike", () => {
    expect(stateOf(130, sundayNight)).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("a spike on top of the peak is one too", () => {
    expect(stateOf(400, mondayMorning)).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("what a fixed percent over the day before calls a spike", () => {
    // The day before a Monday morning is a quiet Sunday.
    expect(
      getExceptionIncreasePercent({ currentCount: 130, usualCount: 4 }),
    ).toBeGreaterThan(200);
    expect(stateOf(130, mondayMorning)).toBe(ExceptionAnomalyState.Normal);
  });

  test("a slow climb a fixed percent never sees leaves last week's range", () => {
    const lastWeek: Array<Array<number>> = simulate({ seed: 3, mean: 40 });
    // 15% more every day for a week: each day barely above the one before.
    const today: number = Math.round(40 * Math.pow(1.15, 7));
    const yesterday: number = Math.round(40 * Math.pow(1.15, 6));

    expect(
      getExceptionIncreasePercent({
        currentCount: today,
        usualCount: yesterday,
      }),
    ).toBeLessThan(200);
    expect(stateOf(today, lastWeek)).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("a whole week of simulated hours: each hour judged by its own history", () => {
    // Business hours are busy, nights and weekends are quiet.
    const meanAt: (hourOfWeek: number) => number = (
      hourOfWeek: number,
    ): number => {
      const hour: number = hourOfWeek % 24;
      const isWeekend: boolean = hourOfWeek >= 5 * 24;
      return !isWeekend && hour >= 9 && hour < 18 ? 80 : 3;
    };

    for (let hourOfWeek: number = 0; hourOfWeek < 168; hourOfWeek++) {
      const history: Array<Array<number>> = simulate({
        seed: 1000 + hourOfWeek,
        mean: meanAt(hourOfWeek),
      });
      const usual: number = meanAt(hourOfWeek);

      expect(stateOf(usual, history)).toBe(ExceptionAnomalyState.Normal);
      expect(stateOf(usual * 6 + 20, history)).toBe(
        ExceptionAnomalyState.Anomalous,
      );
    }
  });
});

describe("judge: sparse and quiet services", () => {
  const quiet: Array<Array<number>> = [
    [0, 0, 0, 0],
    [0, 1, 0, 0],
  ];

  test("the first few exceptions of a quiet service are not a spike", () => {
    for (let count: number = 0; count < 10; count++) {
      expect(stateOf(count, quiet)).toBe(ExceptionAnomalyState.Normal);
    }
  });

  test("a real burst is, even from a service that threw nothing at all", () => {
    expect(stateOf(10, quiet)).toBe(ExceptionAnomalyState.Anomalous);
    expect(
      stateOf(500, [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    ).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("each sensitivity's minimum, one under and at it", () => {
    for (const sensitivity of Object.values(AnomalyDetectionSensitivity)) {
      const minimum: number = EXCEPTION_ANOMALY_MINIMUM_COUNT[sensitivity];

      expect(stateOf(minimum - 1, quiet, { sensitivity })).toBe(
        ExceptionAnomalyState.Normal,
      );
      expect(stateOf(minimum, quiet, { sensitivity })).toBe(
        ExceptionAnomalyState.Anomalous,
      );
    }
  });

  test("a flat history is judged, not skipped: within chance is normal, a burst is not", () => {
    const flat: Array<Array<number>> = [
      [16, 16, 16, 16],
      [16, 16, 16, 16],
    ];

    expect(stateOf(20, flat)).toBe(ExceptionAnomalyState.Normal);
    expect(stateOf(40, flat)).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("one exception a day is not read as one a window", () => {
    // 96 windows a day, so one day's window holds a single exception.
    const onePerDay: Array<Array<number>> = [
      [...new Array(95).fill(0), 1],
      [...new Array(95).fill(0), 1],
    ];

    expect(baselineOf(onePerDay).mean).toBeCloseTo(1 / 96);
    expect(stateOf(12, onePerDay)).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("an hour that peaks in one window of four is not a spike when it does", () => {
    // A job that fails at the same minute every hour.
    const job: Array<Array<number>> = [
      [50, 0, 0, 0],
      [50, 0, 0, 0],
    ];

    expect(stateOf(50, job)).toBe(ExceptionAnomalyState.Normal);
  });
});

describe("judge: new services", () => {
  const anyCount: Array<number> = [0, 3, 10, 500, 100000];

  test("no history: still learning, however many it throws", () => {
    for (const count of anyCount) {
      expect(stateOf(count, [])).toBe(ExceptionAnomalyState.Learning);
    }
  });

  test("one earlier week is not a rhythm yet", () => {
    for (const count of anyCount) {
      expect(stateOf(count, [[0, 1, 0, 2]])).toBe(
        ExceptionAnomalyState.Learning,
      );
    }
  });

  test("two earlier weeks are enough to alert", () => {
    expect(
      stateOf(500, [
        [0, 1, 0, 2],
        [1, 0, 0, 0],
      ]),
    ).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("a check that could not read a baseline is learning, not a breach", () => {
    expect(
      ExceptionLearnedBaselineUtil.judge({
        count: 100000,
        baseline: undefined,
        filterType: FilterType.AnomalouslyHigh,
        options: undefined,
      }).state,
    ).toBe(ExceptionAnomalyState.Learning);
  });

  test("a criteria's own minimum samples are honoured", () => {
    const weeks: Array<Array<number>> = [
      [0, 1, 0, 2],
      [1, 0, 0, 0],
    ];

    expect(stateOf(500, weeks, { minSamples: 9 })).toBe(
      ExceptionAnomalyState.Learning,
    );
    expect(stateOf(500, weeks, { minSamples: 8 })).toBe(
      ExceptionAnomalyState.Anomalous,
    );
  });
});

describe("judge: the history holds an incident", () => {
  const incident: Array<Array<number>> = [
    [2, 1, 3, 2, 2, 1, 2, 3],
    [1, 2, 2, 400, 1, 3, 2, 2],
  ];

  test("the average learns it as normal, for that hour of the week, until it ages out", () => {
    expect(stateOf(60, incident)).toBe(ExceptionAnomalyState.Normal);
  });

  test("Median & MAD does not", () => {
    expect(
      stateOf(60, incident, { method: AnomalyDetectionMethod.MedianMad }),
    ).toBe(ExceptionAnomalyState.Anomalous);
  });
});

describe("judge: the conditions", () => {
  const busy: Array<Array<number>> = simulate({ seed: 21, mean: 60 });

  test("Anomalously High reads only above the range", () => {
    expect(stateOf(5, busy, undefined, FilterType.AnomalouslyHigh)).toBe(
      ExceptionAnomalyState.Normal,
    );
    expect(stateOf(300, busy, undefined, FilterType.AnomalouslyHigh)).toBe(
      ExceptionAnomalyState.Anomalous,
    );
  });

  test("Anomalously Low reads only below it", () => {
    expect(stateOf(5, busy, undefined, FilterType.AnomalouslyLow)).toBe(
      ExceptionAnomalyState.Anomalous,
    );
    expect(stateOf(300, busy, undefined, FilterType.AnomalouslyLow)).toBe(
      ExceptionAnomalyState.Normal,
    );
  });

  test("Anomalous reads either way", () => {
    expect(stateOf(5, busy, undefined, FilterType.Anomalous)).toBe(
      ExceptionAnomalyState.Anomalous,
    );
    expect(stateOf(300, busy, undefined, FilterType.Anomalous)).toBe(
      ExceptionAnomalyState.Anomalous,
    );
    expect(stateOf(60, busy, undefined, FilterType.Anomalous)).toBe(
      ExceptionAnomalyState.Normal,
    );
  });

  test("the minimum holds Anomalous too, above the range only", () => {
    const quiet: Array<Array<number>> = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];

    expect(stateOf(6, quiet, undefined, FilterType.Anomalous)).toBe(
      ExceptionAnomalyState.Normal,
    );
    expect(stateOf(0, busy, undefined, FilterType.Anomalous)).toBe(
      ExceptionAnomalyState.Anomalous,
    );
  });

  test("a quiet service cannot read as unusually low: its range starts at none", () => {
    const quiet: Array<Array<number>> = [
      [0, 1, 0, 2],
      [1, 0, 0, 0],
    ];

    expect(stateOf(0, quiet, undefined, FilterType.AnomalouslyLow)).toBe(
      ExceptionAnomalyState.Normal,
    );
    expect(judge(0, quiet).expectedLow).toBe(0);
  });

  test("any other comparison never breaches", () => {
    expect(stateOf(100000, busy, undefined, FilterType.GreaterThan)).toBe(
      ExceptionAnomalyState.Normal,
    );
  });
});

describe("judge: the settings", () => {
  const history: Array<Array<number>> = simulate({ seed: 31, mean: 40 });

  test("higher sensitivity alerts on everything lower sensitivity does, and more", () => {
    const random: SeededRandom = seededRandom(32);

    for (let draw: number = 0; draw < 2000; draw++) {
      const weeks: Array<Array<number>> = simulate({
        seed: 100 + draw,
        mean: random() * 60,
      });
      const count: number = random(150);
      const low: boolean =
        stateOf(count, weeks, {
          sensitivity: AnomalyDetectionSensitivity.Low,
        }) === ExceptionAnomalyState.Anomalous;
      const medium: boolean =
        stateOf(count, weeks, {
          sensitivity: AnomalyDetectionSensitivity.Medium,
        }) === ExceptionAnomalyState.Anomalous;
      const high: boolean =
        stateOf(count, weeks, {
          sensitivity: AnomalyDetectionSensitivity.High,
        }) === ExceptionAnomalyState.Anomalous;

      expect(!low || medium).toBe(true);
      expect(!medium || high).toBe(true);
    }
  });

  test("the sensitivity sets the range: Low the widest, High the narrowest", () => {
    const widths: Array<number> = [
      AnomalyDetectionSensitivity.Low,
      AnomalyDetectionSensitivity.Medium,
      AnomalyDetectionSensitivity.High,
    ].map((sensitivity: AnomalyDetectionSensitivity): number => {
      const judgement: ExceptionAnomalyJudgement = judge(40, history, {
        sensitivity,
      });
      return judgement.expectedHigh - judgement.expectedLow;
    });

    expect(widths[0]).toBeGreaterThan(widths[1]!);
    expect(widths[1]).toBeGreaterThan(widths[2]!);
  });

  test("no sensitivity reads as Medium, as every anomaly condition does", () => {
    expect(judge(40, history, {}).settings.sensitivity).toBe(
      AnomalyDetectionSensitivity.Medium,
    );
  });

  test("the raw threshold replaces what the sensitivity sets", () => {
    const narrow: ExceptionAnomalyJudgement = judge(70, history, {
      sensitivity: AnomalyDetectionSensitivity.Low,
      sigmaCount: 1,
    });
    const wide: ExceptionAnomalyJudgement = judge(70, history, {
      sensitivity: AnomalyDetectionSensitivity.High,
      sigmaCount: 20,
    });

    expect(narrow.settings.sigmaCount).toBe(1);
    expect(narrow.state).toBe(ExceptionAnomalyState.Anomalous);
    expect(wide.settings.sigmaCount).toBe(20);
    expect(wide.state).toBe(ExceptionAnomalyState.Normal);
  });

  test("the minimum count replaces what the sensitivity sets, down to none", () => {
    const quiet: Array<Array<number>> = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];

    expect(stateOf(4, quiet, { minimumCount: 0 })).toBe(
      ExceptionAnomalyState.Anomalous,
    );
    expect(stateOf(50, quiet, { minimumCount: 100 })).toBe(
      ExceptionAnomalyState.Normal,
    );
  });

  test("raw JSON that is not a usable number reads as unset", () => {
    for (const bad of [0, -1, "many", null, Number.NaN]) {
      expect(
        judge(40, history, { sigmaCount: bad as number }).settings.sigmaCount,
      ).toBe(3);
    }

    for (const bad of [-1, "many", null, Number.NaN]) {
      expect(
        judge(40, history, { minimumCount: bad as number }).settings
          .minimumCount,
      ).toBe(EXCEPTION_ANOMALY_MINIMUM_COUNT.Medium);
    }
  });

  test("numbers stored as text are read, as the API may write them", () => {
    expect(
      judge(40, history, { sigmaCount: "2.5" as unknown as number }).settings
        .sigmaCount,
    ).toBe(2.5);
  });
});

describe("judge: how often it alerts on seeded services", () => {
  const trial: (data: {
    seed: number;
    mean: number;
    multiplier: number;
    sensitivity?: AnomalyDetectionSensitivity | undefined;
  }) => number = (data: {
    seed: number;
    mean: number;
    multiplier: number;
    sensitivity?: AnomalyDetectionSensitivity | undefined;
  }): number => {
    const random: SeededRandom = seededRandom(data.seed);
    const draws: number = 800;
    let alerts: number = 0;

    for (let draw: number = 0; draw < draws; draw++) {
      const weeks: Array<Array<number>> = simulate({
        seed: data.seed * 10000 + draw,
        mean: data.mean,
      });
      const count: number = poisson(random, data.mean * data.multiplier);

      if (
        stateOf(count, weeks, {
          sensitivity:
            data.sensitivity || AnomalyDetectionSensitivity.Medium,
        }) === ExceptionAnomalyState.Anomalous
      ) {
        alerts++;
      }
    }

    return alerts / draws;
  };

  test("an ordinary window of a steady service almost never alerts", () => {
    for (const [seed, mean] of [
      [41, 0.1],
      [42, 1],
      [43, 5],
      [44, 20],
      [45, 60],
      [46, 150],
    ] as Array<[number, number]>) {
      expect(trial({ seed, mean, multiplier: 1 })).toBeLessThan(0.03);
    }
  });

  test("three times the usual is caught on a busy service", () => {
    for (const [seed, mean] of [
      [51, 20],
      [52, 60],
      [53, 150],
    ] as Array<[number, number]>) {
      expect(trial({ seed, mean, multiplier: 3 })).toBeGreaterThan(0.9);
    }
  });

  test("a burst is caught on a quiet service", () => {
    expect(
      trial({ seed: 61, mean: 0.5, multiplier: 60 }),
    ).toBeGreaterThan(0.9);
  });

  test("Low is quieter than Medium, and High is louder", () => {
    const at: (sensitivity: AnomalyDetectionSensitivity) => number = (
      sensitivity: AnomalyDetectionSensitivity,
    ): number => {
      return trial({ seed: 71, mean: 20, multiplier: 1.7, sensitivity });
    };

    expect(at(AnomalyDetectionSensitivity.Low)).toBeLessThan(
      at(AnomalyDetectionSensitivity.Medium),
    );
    expect(at(AnomalyDetectionSensitivity.Medium)).toBeLessThan(
      at(AnomalyDetectionSensitivity.High),
    );
  });
});

describe("what the alert and the status timeline say", () => {
  const history: Array<Array<number>> = [
    [4, 6, 5, 5],
    [5, 7, 3, 5],
  ];

  test("an alert says the range expected and how far outside it the window was", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeBreach(judge(40, history)),
    ).toBe(
      "Exception count 40 over the last 15 minutes is above the 0 to 11 expected for this hour of the week, by 29: 15.65σ from the average of 5.00 (8 windows over 2 weeks, sensitivity Medium).",
    );
  });

  test("below the range, it says so", () => {
    const busy: Array<Array<number>> = [
      [60, 60, 60, 60],
      [60, 60, 60, 60],
    ];

    expect(
      ExceptionLearnedBaselineUtil.describeBreach(
        judge(5, busy, undefined, FilterType.AnomalouslyLow),
      ),
    ).toBe(
      "Exception count 5 over the last 15 minutes is below the 37 to 83 expected for this hour of the week, by 32: 7.10σ from the average of 60.00 (8 windows over 2 weeks, sensitivity Medium).",
    );
  });

  test("Median & MAD says the median it compared with", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeBreach(
        judge(40, history, { method: AnomalyDetectionMethod.MedianMad }),
      ),
    ).toContain("from the median of 5.00");
  });

  test("a raw threshold is said in place of the sensitivity", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeBreach(
        judge(40, history, { sigmaCount: 2.5 }),
      ),
    ).toContain("threshold 2.5σ");
  });

  test("the window reads in the largest whole unit", () => {
    const describe: (windowSeconds: number) => string = (
      windowSeconds: number,
    ): string => {
      return ExceptionLearnedBaselineUtil.describeBreach(
        ExceptionLearnedBaselineUtil.judge({
          count: 40,
          baseline: { ...baselineOf(history), windowSeconds },
          filterType: FilterType.AnomalouslyHigh,
          options: undefined,
        }),
      );
    };

    expect(describe(30)).toContain("over the last 30 seconds");
    expect(describe(60)).toContain("over the last 1 minute is");
    expect(describe(3600)).toContain("over the last 1 hour is");
    expect(describe(86400)).toContain("over the last 1 day is");
    expect(describe(90)).toContain("over the last 90 seconds");
  });

  test("the timeline: within the range", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeObservation(judge(6, history)),
    ).toBe(
      "Exception count was 6, within the 0 to 11 expected for this hour of the week.",
    );
  });

  test("the timeline: above it", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeObservation(judge(40, history)),
    ).toBe(
      "Exception count was 40, above the 0 to 11 expected for this hour of the week.",
    );
  });

  test("the timeline: above it, but too few to alert", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeObservation(
        judge(6, [
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ]),
      ),
    ).toBe(
      "Exception count was 6, above the 0 to 3 expected for this hour of the week, but under the 10 it takes to alert.",
    );
  });

  test("the timeline: below it", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeObservation(
        judge(
          5,
          [
            [60, 60, 60, 60],
            [60, 60, 60, 60],
          ],
          undefined,
          FilterType.AnomalouslyLow,
        ),
      ),
    ).toBe(
      "Exception count was 5, below the 37 to 83 expected for this hour of the week.",
    );
  });

  test("the timeline: still learning, with how far along", () => {
    expect(
      ExceptionLearnedBaselineUtil.describeObservation(
        judge(12, [[0, 1, 0, 0]]),
      ),
    ).toBe(
      "Exception count was 12. Still learning what is normal for this hour of the week: 1 of the 2 weeks of history it needs.",
    );
  });
});

describe("getBaseline: the one of the criteria's baseline window", () => {
  const baseline: (windowDays: number) => ExceptionLearnedBaseline = (
    windowDays: number,
  ): ExceptionLearnedBaseline => {
    return { ...baselineOf([[1], [2]]), windowDays };
  };

  test("by its baseline window", () => {
    expect(
      ExceptionLearnedBaselineUtil.getBaseline(
        { exceptionLearnedBaselines: [baseline(14), baseline(28)] },
        { windowDays: 28 },
      )?.windowDays,
    ).toBe(28);
  });

  test("no baseline window is the default one", () => {
    expect(
      ExceptionLearnedBaselineUtil.getBaseline(
        { exceptionLearnedBaselines: [baseline(28), baseline(14)] },
        undefined,
      )?.windowDays,
    ).toBe(14);
  });

  test("none read: nothing to find", () => {
    expect(
      ExceptionLearnedBaselineUtil.getBaseline({}, undefined),
    ).toBeUndefined();
  });
});

describe("read: from the monitor's own query", () => {
  interface WindowRead {
    query: AnalyticsQuery<ExceptionInstance>;
    timeColumnName: string;
    windowInSeconds: number;
    props: { isRoot?: boolean };
  }

  let windowReads: Array<WindowRead>;
  let cache: Map<string, unknown>;
  let cacheWrites: Array<{
    namespace: string;
    expiresInSeconds: number | undefined;
  }>;
  let service: Service;
  let project: Project | null;
  let serviceReads: number;
  let services: Array<Service> | undefined;

  const countQuery: AnalyticsQuery<ExceptionInstance> = {
    projectId: PROJECT_ID,
    primaryEntityId: new Includes([SERVICE_ID]),
    exceptionType: new Includes(["TypeError"]),
    message: new Search("cart"),
    fingerprint: new IncludesNone(["resolved-one"]),
    time: new InBetween(WINDOW_START, WINDOW_END),
  };

  const read: (
    overrides?: Partial<{
      telemetryServiceIds: Array<ObjectID> | undefined;
      countQuery: AnalyticsQuery<ExceptionInstance>;
      windowEnd: Date;
      windowStart: Date;
      windowSeconds: number;
      windowDays: number;
    }>,
  ) => Promise<ExceptionLearnedBaseline> = async (
    overrides = {},
  ): Promise<ExceptionLearnedBaseline> => {
    return await ExceptionLearnedBaselineUtil.read({
      projectId: PROJECT_ID,
      telemetryServiceIds: [SERVICE_ID],
      countQuery,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      windowSeconds: WINDOW_SECONDS,
      windowDays: 14,
      ...overrides,
    });
  };

  const serviceOf: (data: {
    createdAt: Date;
    retainTelemetryDataForDays?: number | undefined;
  }) => Service = (data: {
    createdAt: Date;
    retainTelemetryDataForDays?: number | undefined;
  }): Service => {
    const row: Service = new Service();
    row.createdAt = data.createdAt;
    row.retainTelemetryDataForDays = data.retainTelemetryDataForDays;
    return row;
  };

  beforeEach(() => {
    windowReads = [];
    cache = new Map<string, unknown>();
    cacheWrites = [];
    serviceReads = 0;
    services = undefined;

    service = serviceOf({ createdAt: ago(365 * DAY) });
    project = new Project();
    project.createdAt = ago(400 * DAY);

    jest
      .spyOn(ExceptionInstanceService, "countPerWindow")
      .mockImplementation((async (data: WindowRead) => {
        windowReads.push(data);
        const range: InBetween<Date> = data.query.time as InBetween<Date>;
        return [
          {
            time: new Date((range.startValue as Date).getTime() + 15 * MINUTE),
            count: 8,
          },
        ];
      }) as never);

    jest.spyOn(ServiceService, "findBy").mockImplementation((async () => {
      serviceReads++;
      return services || [service];
    }) as never);

    jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
      return project;
    }) as never);

    jest.spyOn(GlobalCache, "getJSONObject").mockImplementation((async (
      _namespace: string,
      key: string,
    ) => {
      return cache.has(key) ? JSON.parse(JSON.stringify(cache.get(key))) : null;
    }) as never);

    jest.spyOn(GlobalCache, "setJSON").mockImplementation((async (
      namespace: string,
      key: string,
      value: unknown,
      options?: { expiresInSeconds: number },
    ) => {
      cache.set(key, value);
      cacheWrites.push({
        namespace,
        expiresInSeconds: options?.expiresInSeconds,
      });
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each earlier week is the window's own query, with its hours in place of the window", async () => {
    await read();

    expect(windowReads).toHaveLength(2);

    for (const windowRead of windowReads) {
      expect(windowRead.timeColumnName).toBe("time");
      expect(windowRead.windowInSeconds).toBe(WINDOW_SECONDS);
      expect(windowRead.props).toEqual({ isRoot: true });
      expect(windowRead.query.projectId).toBe(PROJECT_ID);
      expect(windowRead.query.primaryEntityId).toBe(countQuery.primaryEntityId);
      expect(windowRead.query.exceptionType).toBe(countQuery.exceptionType);
      expect(windowRead.query.message).toBe(countQuery.message);
      // The exceptions the count leaves out are left out of what it is judged by.
      expect(windowRead.query.fingerprint).toBe(countQuery.fingerprint);
    }

    const ranges: Array<InBetween<Date>> = windowReads.map(
      (windowRead: WindowRead) => {
        return windowRead.query.time as InBetween<Date>;
      },
    );

    expect(ranges[0]!.startValue).toEqual(new Date("2026-10-26T09:00:00.000Z"));
    expect(ranges[0]!.endValue).toEqual(new Date("2026-10-26T10:00:00.000Z"));
    expect(ranges[1]!.startValue).toEqual(new Date("2026-10-19T09:00:00.000Z"));
    expect(ranges[1]!.endValue).toEqual(new Date("2026-10-19T10:00:00.000Z"));
  });

  test("the windows that held nothing go into the baseline as zeros", async () => {
    const baseline: ExceptionLearnedBaseline = await read();

    expect(baseline).toMatchObject({
      windowDays: 14,
      windowSeconds: WINDOW_SECONDS,
      weeksOfHistory: 2,
      sampleCount: 8,
      minObserved: 0,
      maxObserved: 8,
      median: 0,
    });
    expect(baseline.mean).toBeCloseTo(2);
  });

  test("an hour's checks make one read of each earlier week", async () => {
    for (const minute of [16, 20, 31, 45, 59]) {
      const windowEnd: Date = new Date(
        `2026-11-02T09:${String(minute).padStart(2, "0")}:00.000Z`,
      );

      await read({
        windowEnd,
        windowStart: new Date(windowEnd.getTime() - WINDOW_SECONDS * SECOND),
      });
    }

    expect(windowReads).toHaveLength(2);
    expect(serviceReads).toBe(1);
    expect(cacheWrites).toEqual([
      {
        namespace: EXCEPTION_BASELINE_CACHE_NAMESPACE,
        expiresInSeconds: EXCEPTION_BASELINE_CACHE_SECONDS,
      },
    ]);
  });

  test("a cached baseline reads nothing, and is the one that was read", async () => {
    const first: ExceptionLearnedBaseline = await read();
    const second: ExceptionLearnedBaseline = await read();

    expect(second).toEqual(first);
    expect(windowReads).toHaveLength(2);
  });

  test("a still-learning baseline is cached too: a young service costs no more", async () => {
    service = serviceOf({ createdAt: ago(3 * DAY) });

    await read();
    await read();

    expect(windowReads).toHaveLength(0);
    expect(serviceReads).toBe(1);
  });

  test("the next hour reads again", async () => {
    await read();

    const windowEnd: Date = new Date(WINDOW_END.getTime() + HOUR);

    await read({
      windowEnd,
      windowStart: new Date(windowEnd.getTime() - WINDOW_SECONDS * SECOND),
    });

    expect(windowReads).toHaveLength(4);
  });

  test("anything that changes the baseline changes the key", async () => {
    await read();
    const reads: Array<Promise<ExceptionLearnedBaseline>> = [
      read({ windowDays: 28 }),
      read({
        windowSeconds: 300,
        windowStart: new Date(WINDOW_END.getTime() - 300 * SECOND),
      }),
      read({
        countQuery: {
          ...countQuery,
          message: new Search("checkout"),
        },
      }),
      // Resolving an exception leaves it out of its baseline at once.
      read({
        countQuery: {
          ...countQuery,
          fingerprint: new IncludesNone(["resolved-one", "resolved-two"]),
        },
      }),
    ];

    await Promise.all(reads);

    expect(cache.size).toBe(5);
  });

  test("monitors that ask the same share one read", async () => {
    await read();
    await read({ telemetryServiceIds: [SERVICE_ID] });

    expect(windowReads).toHaveLength(2);
  });

  test("another project never shares it", async () => {
    await read();

    await ExceptionLearnedBaselineUtil.read({
      projectId: ObjectID.generate(),
      telemetryServiceIds: [SERVICE_ID],
      countQuery,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      windowSeconds: WINDOW_SECONDS,
      windowDays: 14,
    });

    expect(cache.size).toBe(2);
  });

  test("without a cache a check still reads and judges", async () => {
    jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setJSON")
      .mockRejectedValue(new Error("Cache is not connected"));

    expect((await read()).weeksOfHistory).toBe(2);
    expect(windowReads).toHaveLength(2);
  });

  test("a failed read of a week fails the read, and nothing is cached", async () => {
    jest
      .spyOn(ExceptionInstanceService, "countPerWindow")
      .mockRejectedValue(new Error("timed out"));

    await expect(read()).rejects.toThrow("timed out");
    expect(cache.size).toBe(0);
  });

  test("a new service has no earlier week: nothing is read, and it learns", async () => {
    service = serviceOf({ createdAt: ago(3 * DAY) });

    const baseline: ExceptionLearnedBaseline = await read();

    expect(windowReads).toHaveLength(0);
    expect(baseline.weeksOfHistory).toBe(0);
    expect(
      ExceptionLearnedBaselineUtil.judge({
        count: 100000,
        baseline,
        filterType: FilterType.AnomalouslyHigh,
        options: undefined,
      }).state,
    ).toBe(ExceptionAnomalyState.Learning);
  });

  test("a service nine days old has one earlier week, and the weeks before it are no evidence", async () => {
    service = serviceOf({ createdAt: ago(9 * DAY) });

    expect((await read()).weeksOfHistory).toBe(1);
    expect(windowReads).toHaveLength(1);
  });

  test("a service two weeks old is ready, and can alert", async () => {
    service = serviceOf({ createdAt: ago(15 * DAY) });

    expect((await read()).weeksOfHistory).toBe(2);
  });

  test("a service quiet for months is ready: its silence is its baseline", async () => {
    jest
      .spyOn(ExceptionInstanceService, "countPerWindow")
      .mockResolvedValue([] as never);

    const baseline: ExceptionLearnedBaseline = await read();

    expect(baseline.weeksOfHistory).toBe(2);
    expect(baseline.maxObserved).toBe(0);
    expect(
      ExceptionLearnedBaselineUtil.judge({
        count: 200,
        baseline,
        filterType: FilterType.AnomalouslyHigh,
        options: undefined,
      }).state,
    ).toBe(ExceptionAnomalyState.Anomalous);
  });

  test("weeks past what OneUptime keeps are not read as silence", async () => {
    // The project's default of 15 days holds two of the four weeks asked for.
    expect((await read({ windowDays: 28 })).weeksOfHistory).toBe(2);
    expect(windowReads).toHaveLength(2);
  });

  test("a longer retention reaches further back", async () => {
    service = serviceOf({
      createdAt: ago(365 * DAY),
      retainTelemetryDataForDays: 60,
    });

    expect((await read({ windowDays: 28 })).weeksOfHistory).toBe(4);
  });

  test("the project's default retention applies to a service without its own", async () => {
    project!.defaultTelemetryRetentionInDays = 30;

    expect((await read({ windowDays: 28 })).weeksOfHistory).toBe(4);
  });

  test("a retention too short for two weeks keeps learning, rather than taking expired weeks for quiet ones", async () => {
    service = serviceOf({
      createdAt: ago(365 * DAY),
      retainTelemetryDataForDays: 7,
    });

    expect((await read()).weeksOfHistory).toBe(0);
  });

  test("several services: history starts with the oldest, and reaches as far as the shortest retention", async () => {
    services = [
      serviceOf({ createdAt: ago(365 * DAY), retainTelemetryDataForDays: 90 }),
      serviceOf({ createdAt: ago(3 * DAY), retainTelemetryDataForDays: 15 }),
    ];

    expect((await read({ windowDays: 28 })).weeksOfHistory).toBe(2);
  });

  test("a monitor without services watches its project", async () => {
    project!.createdAt = ago(9 * DAY);
    project!.defaultTelemetryRetentionInDays = 30;

    expect((await read({ telemetryServiceIds: [] })).weeksOfHistory).toBe(1);
    expect(serviceReads).toBe(0);
  });

  test("a service no longer there falls back to its project", async () => {
    services = [];

    expect((await read()).weeksOfHistory).toBe(2);
  });

  test("nothing says when it began: it learns, rather than trust the silence", async () => {
    services = [];
    project = null;

    expect((await read()).weeksOfHistory).toBe(0);
  });

  test("a window of a week or more reads nothing, and learns", async () => {
    const windowSeconds: number = 7 * 24 * 60 * 60;

    const baseline: ExceptionLearnedBaseline = await read({
      windowSeconds,
      windowStart: new Date(WINDOW_END.getTime() - windowSeconds * SECOND),
    });

    expect(baseline.weeksOfHistory).toBe(0);
    expect(windowReads).toHaveLength(0);
  });
});
