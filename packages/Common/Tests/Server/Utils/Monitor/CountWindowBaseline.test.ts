import CountAnomaly, {
  CountBaselineStats,
  CountBaselineSummary,
  CountWindowBreach,
} from "../../../../Server/Utils/Monitor/Criteria/CountAnomaly";
import CountWindowBaseline, {
  COUNT_BASELINE_LEVEL_SPREAD,
  COUNT_BASELINE_REACH_IN_WINDOWS,
  CountBaselinePlan,
  CountBaselineWeek,
  CountBaselineWeekCounts,
  CountBaselineWindowRow,
} from "../../../../Server/Utils/Monitor/CountWindowBaseline";
import { MetricBaselineService } from "../../../../Server/Services/MetricBaselineService";
import {
  AnomalyDetectionMethod,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * The baseline of a Logs or Traces monitor's window: which earlier weeks it
 * reads, how their minutes become samples, and what those samples do to a
 * verdict. The behaviour below compares what the read did before with what
 * it does now, on traffic drawn from a seed, because each finding here was
 * of the kind a reading of the code argues about and a run of it settles.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const WEEK: number = 7 * DAY;
const MINUTES_PER_WEEK: number = WEEK / MINUTE;

// A Monday, so an hour of the week here is an hour of the day.
const MONDAY: number = Date.UTC(2026, 10, 2);

const planFor: (data: {
  windowEnd: number;
  windowSeconds: number;
  windowDays?: number;
}) => CountBaselinePlan = (data: {
  windowEnd: number;
  windowSeconds: number;
  windowDays?: number;
}): CountBaselinePlan => {
  return CountWindowBaseline.getPlan({
    ...data,
    windowEnd: new Date(data.windowEnd),
  });
};

// A plan's windows as times, for reading what a week reaches.
const reachOf: (
  plan: CountBaselinePlan,
  week: CountBaselineWeek,
) => { start: number; end: number } = (
  plan: CountBaselinePlan,
  week: CountBaselineWeek,
): { start: number; end: number } => {
  return {
    start: week.firstWindow * plan.windowMinutes * MINUTE,
    end: (week.firstWindow + week.windowCount) * plan.windowMinutes * MINUTE,
  };
};

const LEVEL: number = COUNT_BASELINE_LEVEL_SPREAD;

// Whole minutes in a whole hour's window, so the numbers below read plainly.
const SOME_WINDOW_END: number = MONDAY + 9 * HOUR + 40 * MINUTE;

describe("CountWindowBaseline.getPlan", () => {
  test("a window reads an hour around the same time of each earlier week", () => {
    const plan: CountBaselinePlan = planFor({
      windowEnd: SOME_WINDOW_END,
      windowSeconds: 60,
    });

    expect(plan.windowDays).toBe(14);
    expect(plan.windowMinutes).toBe(1);

    expect(
      plan.weeks.map((week: CountBaselineWeek): number => {
        return week.weeksBack;
      }),
    ).toEqual([1, 2]);

    for (const week of plan.weeks) {
      const { start, end } = reachOf(plan, week);
      const middle: number =
        SOME_WINDOW_END - 30 * 1000 - week.weeksBack * WEEK;

      expect(start).toBeLessThanOrEqual(middle - 30 * MINUTE);
      expect(end).toBeGreaterThanOrEqual(middle + 30 * MINUTE);
      expect(end - start).toBeLessThanOrEqual(62 * MINUTE);
    }
  });

  test("a long window reads three of its own, so it has some to compare with", () => {
    const plan: CountBaselinePlan = planFor({
      windowEnd: SOME_WINDOW_END,
      windowSeconds: 21600,
    });

    expect(COUNT_BASELINE_REACH_IN_WINDOWS).toBe(3);

    for (const week of plan.weeks) {
      const { start, end } = reachOf(plan, week);

      expect(end - start).toBeGreaterThanOrEqual(18 * HOUR);
    }
  });

  test.each([
    [5, 1, 60],
    [60, 1, 60],
    [90, 2, 30],
    [300, 5, 12],
    [900, 15, 4],
    [1800, 30, 3],
    [3600, 60, 3],
    [21600, 360, 3],
    [86400, 1440, 3],
  ])(
    "a window of %d seconds is folded from %d minutes, about %d samples a week",
    (windowSeconds: number, windowMinutes: number, samples: number) => {
      const plan: CountBaselinePlan = planFor({
        windowEnd: SOME_WINDOW_END,
        windowSeconds,
      });

      expect(plan.windowMinutes).toBe(windowMinutes);

      for (const week of plan.weeks) {
        expect(week.windowCount).toBeGreaterThanOrEqual(samples);
        expect(week.windowCount).toBeLessThanOrEqual(samples + 1);
      }
    },
  );

  test("the cells read are the hours of the week the windows fall in", () => {
    expect(
      planFor({ windowEnd: SOME_WINDOW_END, windowSeconds: 60 }).hoursOfWeek,
    ).toEqual([9, 10]);
  });

  test("a read across the end of the week reads both ends of it", () => {
    expect(
      planFor({
        windowEnd: MONDAY + 10 * MINUTE,
        windowSeconds: 60,
      }).hoursOfWeek.sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([0, 167]);
  });

  test("the days read run from the oldest window to the newest", () => {
    const plan: CountBaselinePlan = planFor({
      windowEnd: SOME_WINDOW_END,
      windowSeconds: 60,
      windowDays: 28,
    });

    expect(plan.firstDay).toBe("2026-10-05");
    expect(plan.lastDay).toBe("2026-10-26");
  });

  test("a read across midnight names the days it touches", () => {
    const plan: CountBaselinePlan = planFor({
      windowEnd: MONDAY + 10 * MINUTE,
      windowSeconds: 60,
    });

    expect(plan.firstDay).toBe("2026-10-18");
    expect(plan.lastDay).toBe("2026-10-26");
  });

  test.each([
    [14, 2],
    [28, 4],
    [60, 8],
    [90, 12],
    [500, 12],
    [7, 1],
    [5, 0],
  ])(
    "a baseline window of %d days is %d earlier weeks",
    (windowDays: number, weeks: number) => {
      expect(
        planFor({ windowEnd: SOME_WINDOW_END, windowSeconds: 60, windowDays })
          .weeks,
      ).toHaveLength(weeks);
    },
  );

  test("a window of a week or more has no earlier week of its own", () => {
    expect(
      planFor({ windowEnd: SOME_WINDOW_END, windowSeconds: 7 * 24 * 3600 })
        .weeks,
    ).toEqual([]);
  });

  test("the window being judged is never part of what it is judged against", () => {
    const random: SeededRandom = seededRandom(5472);
    const windows: Array<number> = [
      5, 60, 90, 900, 3600, 21600, 86400, 200000, 604799,
    ];

    for (let index: number = 0; index < 2000; index++) {
      const windowEnd: number = MONDAY + random(WEEK);
      const windowSeconds: number = windows[random(windows.length)]!;
      const plan: CountBaselinePlan = planFor({ windowEnd, windowSeconds });
      const newest: CountBaselineWeek = plan.weeks[0]!;

      expect(reachOf(plan, newest).end).toBeLessThanOrEqual(
        windowEnd - windowSeconds * 1000 + plan.windowMinutes * MINUTE,
      );
    }
  });

  test("a window's own time, not the time it is read at, picks the hour", () => {
    expect(
      planFor({
        windowEnd: MONDAY + 25 * HOUR + 30 * MINUTE,
        windowSeconds: 60,
      }).hourOfWeek,
    ).toBe(25);
  });
});

describe("CountWindowBaseline.toWeekCounts", () => {
  const plan: CountBaselinePlan = {
    ...planFor({ windowEnd: SOME_WINDOW_END, windowSeconds: 900 }),
    weeks: [
      { weeksBack: 1, firstWindow: 1000, windowCount: 3 },
      { weeksBack: 2, firstWindow: 900, windowCount: 3 },
    ],
  };

  const countsOf: (
    rows: Array<CountBaselineWindowRow>,
  ) => Array<Array<number>> = (
    rows: Array<CountBaselineWindowRow>,
  ): Array<Array<number>> => {
    return CountWindowBaseline.toWeekCounts({ plan, rows }).map(
      (week: CountBaselineWeekCounts): Array<number> => {
        return week.counts;
      },
    );
  };

  test("a window with no row is a zero, in the week it falls in", () => {
    expect(
      countsOf([
        { windowIndex: 1000, count: 4 },
        { windowIndex: 1002, count: 6 },
        { windowIndex: 901, count: 8 },
      ]),
    ).toEqual([
      [4, 0, 6],
      [0, 8, 0],
    ]);
  });

  test("a row outside the windows asked for is left out", () => {
    expect(
      countsOf([
        { windowIndex: 999, count: 4 },
        { windowIndex: 1003, count: 6 },
        { windowIndex: 903, count: 8 },
      ]),
    ).toEqual([
      [0, 0, 0],
      [0, 0, 0],
    ]);
  });

  test("a row of nothing that matched still says the services were reporting", () => {
    const weeks: Array<CountBaselineWeekCounts> =
      CountWindowBaseline.toWeekCounts({
        plan,
        rows: [{ windowIndex: 1001, count: 0 }],
      });

    expect(weeks[0]!.hasRows).toBe(true);
    expect(weeks[1]!.hasRows).toBe(false);
  });
});

describe("CountWindowBaseline.getSamples", () => {
  const sorted: (samples: Array<number> | undefined) => Array<number> = (
    samples: Array<number> | undefined,
  ): Array<number> => {
    return [...(samples || [])].sort((a: number, b: number) => {
      return a - b;
    });
  };

  test("nothing to read is nothing to sample", () => {
    expect(CountWindowBaseline.getSamples([])).toBeUndefined();
  });

  test("a busy scope's samples are its windows, as they always were", () => {
    expect(
      sorted(
        CountWindowBaseline.getSamples([
          [4, 6, 5],
          [3, 7, 9],
        ]),
      ),
    ).toEqual([3, 4, 5, 6, 7, 9]);
  });

  test("a quiet scope's empty windows are samples", () => {
    expect(
      sorted(
        CountWindowBaseline.getSamples([
          [0, 3, 0, 0],
          [0, 0, 5, 0],
        ]),
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 3, 5]);
  });

  test("a week a busy scope stopped in is left to the other weeks", () => {
    expect(
      sorted(
        CountWindowBaseline.getSamples([
          [10, 12, 11, 9],
          [10, 0, 0, 9],
        ]),
      ),
    ).toEqual([9, 9, 10, 10, 11, 12]);
  });

  test("empty windows every week has are the scope's normal, however one week went", () => {
    expect(
      sorted(
        CountWindowBaseline.getSamples([
          [10, 0, 12, 9],
          [10, 0, 0, 0],
        ]),
      ),
    ).toEqual([0, 0, 9, 10, 10, 12]);
  });
});

describe("CountWindowBaseline.summarize", () => {
  const windowEnd: number = SOME_WINDOW_END;

  const summaryOf: (data: {
    weeks: Array<Array<number>>;
    windowSeconds?: number;
    minSamples?: number;
    windowDays?: number;
  }) => CountBaselineSummary = (data: {
    weeks: Array<Array<number>>;
    windowSeconds?: number;
    minSamples?: number;
    windowDays?: number;
  }): CountBaselineSummary => {
    return CountWindowBaseline.summarize({
      plan: planFor({
        windowEnd,
        windowSeconds: data.windowSeconds || 60,
        ...(data.windowDays ? { windowDays: data.windowDays } : {}),
      }),
      weeks: data.weeks,
      minSamples: data.minSamples,
    })!;
  };

  test("no samples is no baseline", () => {
    expect(
      CountWindowBaseline.summarize({
        plan: planFor({ windowEnd, windowSeconds: 60 }),
        weeks: [],
      }),
    ).toBeNull();
  });

  test("a busy one-minute window is the plain statistics of its minutes, with the level added", () => {
    const counts: Array<number> = [40, 80, 60, 20, 100, 30, 90, 50];
    const plain: CountBaselineStats = CountAnomaly.computeStats(counts)!;
    const summary: CountBaselineSummary = summaryOf({
      weeks: [counts, counts],
    });

    expect(summary).toMatchObject({
      mean: plain.mean,
      median: plain.median,
      minObserved: plain.minObserved,
      maxObserved: plain.maxObserved,
      sampleCount: 16,
    });
    expect(summary.stddev).toBeCloseTo(
      Math.hypot(plain.stddev, LEVEL * plain.mean),
      10,
    );
    expect(summary.madSigma).toBeCloseTo(
      Math.hypot(plain.madSigma, LEVEL * plain.median),
      10,
    );
    expect(summary.nonEmpty).toBeUndefined();
  });

  test("the summary says what it read", () => {
    expect(summaryOf({ weeks: [[5], [5]], windowDays: 28 })).toMatchObject({
      windowDays: 28,
      hourOfWeek: 9,
    });
  });

  test("a window's samples are given back as a per-minute rate", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [600, 900],
        [750, 750],
      ],
      windowSeconds: 900,
    });

    expect(summary.mean).toBe(50);
    expect(summary.minObserved).toBe(40);
    expect(summary.maxObserved).toBe(60);
    expect(summary.stddev).toBeCloseTo(
      Math.hypot(
        CountAnomaly.computeStats([600, 900, 750, 750])!.stddev / 15,
        LEVEL * 50,
      ),
      10,
    );
  });

  test("a window under a minute is as noisy as chance makes a count that short", () => {
    const counts: Array<number> = [3600, 3600, 3600, 3600];
    const summary: CountBaselineSummary = summaryOf({
      weeks: [counts, counts],
      windowSeconds: 5,
    });

    // 300 logs in 5 seconds vary by 17, which is 208 a minute.
    expect(summary.mean).toBeCloseTo(3600, 8);
    expect(summary.stddev).toBeCloseTo(
      Math.hypot(Math.sqrt(300) * 12, LEVEL * 3600),
      8,
    );
  });

  test("a rate that moves for other reasons moves as much in a short window", () => {
    const counts: Array<number> = [8000, 12000, 8000, 12000];
    const oneMinute: CountBaselineSummary = summaryOf({
      weeks: [counts, counts],
    });
    const fiveSeconds: CountBaselineSummary = summaryOf({
      weeks: [counts, counts],
      windowSeconds: 5,
    });

    expect(oneMinute.stddev).toBeCloseTo(Math.hypot(2000, LEVEL * 10000), 8);
    expect(fiveSeconds.stddev).toBeGreaterThan(oneMinute.stddev);
    expect(fiveSeconds.stddev).toBeLessThan(oneMinute.stddev * 1.05);
  });

  test("a flat history has the spread a count has by chance, not none", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [25, 25, 25, 25, 25],
        [25, 25, 25, 25, 25],
      ],
    });

    expect(summary.stddev).toBeCloseTo(Math.hypot(5, LEVEL * 25), 10);
    expect(summary.madSigma).toBeCloseTo(Math.hypot(5, LEVEL * 25), 10);
  });

  test("the counting noise is the window's, not the minute's", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [150, 150, 150, 150],
        [150, 150, 150, 150],
      ],
      windowSeconds: 900,
    });

    expect(summary.mean).toBe(10);
    expect(summary.stddev).toBeCloseTo(
      Math.hypot(Math.sqrt(150) / 15, LEVEL * 10),
      10,
    );
  });

  test("a rate that holds still for two weeks is not taken for steadier than a rate can be", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [20000, 20000, 20000, 20000],
        [20000, 20000, 20000, 20000],
      ],
    });

    expect(LEVEL).toBe(0.04);
    expect(summary.stddev).toBeCloseTo(Math.hypot(Math.sqrt(20000), 800), 8);
    expect(summary.madSigma).toBeCloseTo(summary.stddev, 8);
  });

  test("the median method's level is the median's", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [10000, 10000, 10000, 40000],
        [10000, 10000, 10000, 40000],
      ],
    });

    expect(summary.median).toBe(10000);
    expect(summary.madSigma).toBeCloseTo(Math.hypot(Math.sqrt(17500), 400), 8);
  });

  test("a spread much wider than the level hardly moves", () => {
    const counts: Array<number> = [18000, 22000, 18000, 22000];
    const stddev: number = summaryOf({ weeks: [counts, counts] }).stddev;

    expect(stddev).toBeCloseTo(Math.hypot(2000, 800), 8);
    expect(stddev).toBeLessThan(2000 * 1.1);
  });

  test("the windows that held something have a level too", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [0, 0, 10000, 0, 0, 0],
        [0, 0, 0, 10000, 0, 0],
      ],
    });

    expect(summary.nonEmpty!.stddev).toBeCloseTo(
      Math.hypot(100, LEVEL * 10000),
      8,
    );
  });

  test("a history of nothing is judged against nothing", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
    });

    expect(summary).toMatchObject({ mean: 0, stddev: 1, sampleCount: 10 });
    expect(summary.isReliable).toBe(true);
    expect(summary.nonEmpty).toBeUndefined();
  });

  test("when empty windows are normal, the windows that held something are kept apart", () => {
    const summary: CountBaselineSummary = summaryOf({
      weeks: [
        [0, 0, 0, 100, 0, 0],
        [0, 0, 110, 0, 0, 0],
      ],
    });

    expect(summary.mean).toBe(17.5);
    expect(summary.sampleCount).toBe(12);
    expect(summary.nonEmpty).toMatchObject({ mean: 105, sampleCount: 2 });
  });

  test("a busy scope has no second set of statistics", () => {
    expect(
      summaryOf({
        weeks: [
          [10, 12, 11, 9],
          [10, 0, 0, 9],
        ],
      }).nonEmpty,
    ).toBeUndefined();
  });

  describe("reliability", () => {
    const week: Array<number> = new Array<number>(20).fill(10);

    test("two weeks of history are reliable", () => {
      expect(summaryOf({ weeks: [week, week] }).isReliable).toBe(true);
    });

    test("one week of a two-week baseline window is still learning", () => {
      expect(summaryOf({ weeks: [week] }).isReliable).toBe(false);
    });

    test("a baseline window of one week asks for the one it has", () => {
      expect(summaryOf({ weeks: [week], windowDays: 7 }).isReliable).toBe(true);
    });

    test("too few windows is still learning", () => {
      expect(summaryOf({ weeks: [[10, 12], [11]] }).isReliable).toBe(false);
    });

    test("minSamples counts minutes, as it did when a window was one", () => {
      const twoWeeks: Array<Array<number>> = [
        [600, 900, 750, 800],
        [650, 700, 800, 900],
      ];

      expect(
        summaryOf({ weeks: twoWeeks, windowSeconds: 900, minSamples: 120 })
          .isReliable,
      ).toBe(true);
      expect(
        summaryOf({ weeks: twoWeeks, windowSeconds: 900, minSamples: 121 })
          .isReliable,
      ).toBe(false);
    });
  });
});

/*
 * What a window of a monitor gets judged against, then and now, on a minute
 * by minute history of a scope.
 */

interface Traffic {
  counts: Float64Array;
  // The minute since the epoch the first count is of.
  start: number;
}

const poisson: (random: SeededRandom, mean: number) => number = (
  random: SeededRandom,
  mean: number,
): number => {
  if (mean <= 0) {
    return 0;
  }

  if (mean > 40) {
    const normal: number =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

    return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal));
  }

  const limit: number = Math.exp(-mean);
  let count: number = 0;
  let product: number = 1;

  do {
    count++;
    product *= random();
  } while (product > limit);

  return count - 1;
};

const normal: (random: SeededRandom) => number = (
  random: SeededRandom,
): number => {
  return (
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  );
};

/*
 * A scope's minutes: a day's rhythm, a weekend, days that differ from one
 * another by `wobble`, a rate that drifts within the day by `drift`, and
 * chance on top.
 */
const trafficOf: (data: {
  seed: number;
  perMinute: number;
  weeks: number;
  wobble?: number;
  drift?: number;
  rhythm?: number;
}) => Traffic = (data: {
  seed: number;
  perMinute: number;
  weeks: number;
  wobble?: number;
  drift?: number;
  rhythm?: number;
}): Traffic => {
  const random: SeededRandom = seededRandom(data.seed);
  const length: number = data.weeks * MINUTES_PER_WEEK;
  const counts: Float64Array = new Float64Array(length);
  const wobble: Array<number> = [];
  const persistence: number = 0.97;
  const step: number =
    (data.drift ?? 0.06) * Math.sqrt(1 - persistence * persistence);
  const rhythm: number = data.rhythm ?? 0.6;
  let level: number = 0;

  for (let day: number = 0; day <= data.weeks * 7; day++) {
    wobble.push(1 + (data.wobble ?? 0.03) * normal(random));
  }

  for (let minute: number = 0; minute < length; minute++) {
    const day: number = Math.floor(minute / 1440);
    const hour: number = (minute % 1440) / 60;
    const daily: number =
      1 + rhythm * Math.sin(((hour - 8) / 24) * 2 * Math.PI);
    const weekly: number = rhythm > 0 && day % 7 >= 5 ? 0.5 : 1;

    level = persistence * level + step * normal(random);
    counts[minute] = poisson(
      random,
      data.perMinute * daily * weekly * wobble[day]! * Math.exp(level),
    );
  }

  return { counts, start: MONDAY / MINUTE };
};

// What the read does now, from the minutes a rollup would return.
const baselineNow: (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
}) => CountBaselineSummary | null = (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
}): CountBaselineSummary | null => {
  const plan: CountBaselinePlan = planFor({
    windowEnd: data.windowEnd * MINUTE,
    windowSeconds: data.windowSeconds,
  });

  return CountWindowBaseline.summarize({
    plan,
    weeks: plan.weeks.map((week: CountBaselineWeek): Array<number> => {
      const counts: Array<number> = [];

      for (let index: number = 0; index < week.windowCount; index++) {
        let count: number = 0;

        for (let minute: number = 0; minute < plan.windowMinutes; minute++) {
          count +=
            data.traffic.counts[
              (week.firstWindow + index) * plan.windowMinutes +
                minute -
                data.traffic.start
            ] || 0;
        }

        counts.push(count);
      }

      return counts;
    }),
  });
};

// The same windows' statistics as measured, as a per-minute rate of a window.
const measuredStatsOf: (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
}) => CountBaselineStats = (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
}): CountBaselineStats => {
  const plan: CountBaselinePlan = planFor({
    windowEnd: data.windowEnd * MINUTE,
    windowSeconds: data.windowSeconds,
  });
  const perMinute: number = 1 / plan.windowMinutes;
  const samples: Array<number> = [];

  for (const week of plan.weeks) {
    for (let index: number = 0; index < week.windowCount; index++) {
      let count: number = 0;

      for (let minute: number = 0; minute < plan.windowMinutes; minute++) {
        count +=
          data.traffic.counts[
            (week.firstWindow + index) * plan.windowMinutes +
              minute -
              data.traffic.start
          ] || 0;
      }

      samples.push(count * perMinute);
    }
  }

  return CountAnomaly.computeStats(samples)!;
};

/*
 * What the read did before: the minutes of the clock hour that held
 * something, in the earlier weeks and in this hour so far.
 */
const baselineBefore: (data: {
  traffic: Traffic;
  windowEnd: number;
  countThisHour?: boolean;
}) => CountBaselineStats | null = (data: {
  traffic: Traffic;
  windowEnd: number;
  countThisHour?: boolean;
}): CountBaselineStats | null => {
  const hourStart: number = data.windowEnd - (data.windowEnd % 60);
  const samples: Array<number> = [];

  for (let weeksBack: number = 2; weeksBack >= 0; weeksBack--) {
    for (let minute: number = 0; minute < 60; minute++) {
      const time: number = hourStart - weeksBack * MINUTES_PER_WEEK + minute;
      const count: number = data.traffic.counts[time - data.traffic.start] || 0;

      if (
        count > 0 &&
        time < data.windowEnd &&
        (weeksBack > 0 || data.countThisHour !== false)
      ) {
        samples.push(count);
      }
    }
  }

  return samples.length >= 5 ? CountAnomaly.computeStats(samples) : null;
};

const windowCount: (data: {
  traffic: Traffic;
  windowEnd: number;
  minutes: number;
}) => number = (data: {
  traffic: Traffic;
  windowEnd: number;
  minutes: number;
}): number => {
  let count: number = 0;

  for (let minute: number = 1; minute <= data.minutes; minute++) {
    count += data.traffic.counts[data.windowEnd - minute - data.traffic.start]!;
  }

  return count;
};

const breachNow: (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
  count: number;
  filterType: FilterType;
  sigmaCount?: number;
}) => CountWindowBreach | null = (data: {
  traffic: Traffic;
  windowEnd: number;
  windowSeconds: number;
  count: number;
  filterType: FilterType;
  sigmaCount?: number;
}): CountWindowBreach | null => {
  const baseline: CountBaselineSummary | null = baselineNow(data);

  if (!baseline?.isReliable) {
    return null;
  }

  return CountAnomaly.findBreach({
    observed: (data.count * 60) / data.windowSeconds,
    count: data.count,
    baseline,
    sigmaCount: data.sigmaCount ?? 3,
    method: AnomalyDetectionMethod.MeanStddev,
    filterType: data.filterType,
    minimumCount: 10,
  });
};

const breachBefore: (data: {
  stats: CountBaselineStats | null;
  observed: number;
  filterType: FilterType;
}) => boolean = (data: {
  stats: CountBaselineStats | null;
  observed: number;
  filterType: FilterType;
}): boolean => {
  return Boolean(
    data.stats &&
      CountAnomaly.evaluate({
        observed: data.observed,
        stats: data.stats,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: data.filterType,
      })?.breaches,
  );
};

// The minutes checked: every one of `days` days, from the third week on.
const minutesToCheck: (data: {
  traffic: Traffic;
  days: number;
  every?: number;
}) => Array<number> = (data: {
  traffic: Traffic;
  days: number;
  every?: number;
}): Array<number> => {
  const first: number = data.traffic.start + 3 * MINUTES_PER_WEEK + 1440;
  const minutes: Array<number> = [];

  for (
    let minute: number = first;
    minute < first + data.days * 1440;
    minute += data.every || 1
  ) {
    minutes.push(minute);
  }

  return minutes;
};

// How many times a verdict over consecutive checks turned into an alert.
const alertsAmong: (verdicts: Array<boolean>) => number = (
  verdicts: Array<boolean>,
): number => {
  return verdicts.filter((fired: boolean, index: number): boolean => {
    return fired && !verdicts[index - 1];
  }).length;
};

// Each check as if a change had run for `minutes` before it, on clean history.
const withChange: <T>(data: {
  traffic: Traffic;
  windowEnd: number;
  minutes: number;
  factor: number;
  read: () => T;
}) => T = <T>(data: {
  traffic: Traffic;
  windowEnd: number;
  minutes: number;
  factor: number;
  read: () => T;
}): T => {
  const from: number = data.windowEnd - data.minutes - data.traffic.start;
  const to: number = data.windowEnd - data.traffic.start;
  const saved: Float64Array = data.traffic.counts.slice(from, to);

  for (let index: number = from; index < to; index++) {
    data.traffic.counts[index] = Math.round(
      data.traffic.counts[index]! * data.factor,
    );
  }

  const result: T = data.read();

  data.traffic.counts.set(saved, from);

  return result;
};

const shareOf: (verdicts: Array<boolean>) => number = (
  verdicts: Array<boolean>,
): number => {
  return (
    verdicts.filter((fired: boolean): boolean => {
      return fired;
    }).length / verdicts.length
  );
};

describe("what a busy monitor catches", () => {
  const traffic: Traffic = trafficOf({
    seed: 5472,
    perMinute: 2000,
    weeks: 5,
  });
  const checks: Array<number> = minutesToCheck({ traffic, days: 7, every: 37 });

  /*
   * The arithmetic of the finding. Once this hour's minutes are a share p of
   * the samples, a change that lasts tops out at sqrt((1 - p) / p) standard
   * deviations, whatever its size. Three, at a tenth: 14 of the 134 samples
   * of a two-week baseline, so the 14th minute of any change was its last.
   */
  test("the hour being judged used to cap how far a lasting change could read", () => {
    const history: Array<number> = new Array<number>(120).fill(100);
    const change: number = 1000000;

    const firesAfter: (minutes: number) => boolean | undefined = (
      minutes: number,
    ): boolean | undefined => {
      return CountAnomaly.evaluate({
        observed: change,
        stats: CountAnomaly.computeStats([
          ...history,
          ...new Array<number>(minutes).fill(change),
        ])!,
        sigmaCount: 3,
        method: AnomalyDetectionMethod.MeanStddev,
        filterType: FilterType.AnomalouslyHigh,
      })?.breaches;
    };

    expect(firesAfter(13)).toBe(true);
    expect(firesAfter(14)).toBe(false);
  });

  test("a doubling that lasts half an hour is caught, where it mostly was not", () => {
    const before: number = shareOf(
      checks.map((windowEnd: number): boolean => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 30,
          factor: 2,
          read: (): boolean => {
            return breachBefore({
              stats: baselineBefore({ traffic, windowEnd }),
              observed: windowCount({ traffic, windowEnd, minutes: 1 }),
              filterType: FilterType.AnomalouslyHigh,
            });
          },
        });
      }),
    );

    const now: number = shareOf(
      checks.map((windowEnd: number): boolean => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 30,
          factor: 2,
          read: (): boolean => {
            return Boolean(
              breachNow({
                traffic,
                windowEnd,
                windowSeconds: 60,
                count: windowCount({ traffic, windowEnd, minutes: 1 }),
                filterType: FilterType.AnomalouslyHigh,
              }),
            );
          },
        });
      }),
    );

    expect(before).toBeLessThan(0.35);
    expect(now).toBeGreaterThan(0.9);
  });

  test("a halving that lasts half an hour is caught, where it mostly was not", () => {
    const before: number = shareOf(
      checks.map((windowEnd: number): boolean => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 30,
          factor: 0.5,
          read: (): boolean => {
            return breachBefore({
              stats: baselineBefore({ traffic, windowEnd }),
              observed: windowCount({ traffic, windowEnd, minutes: 1 }),
              filterType: FilterType.AnomalouslyLow,
            });
          },
        });
      }),
    );

    const now: number = shareOf(
      checks.map((windowEnd: number): boolean => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 30,
          factor: 0.5,
          read: (): boolean => {
            return Boolean(
              breachNow({
                traffic,
                windowEnd,
                windowSeconds: 60,
                count: windowCount({ traffic, windowEnd, minutes: 1 }),
                filterType: FilterType.AnomalouslyLow,
              }),
            );
          },
        });
      }),
    );

    expect(before).toBeLessThan(0.35);
    expect(now).toBeGreaterThan(0.6);
  });

  /*
   * What a wider read would cost. Three hours of a daily rhythm widen the
   * range with the rhythm itself, and a rise of a third in its first minutes
   * goes from caught two times in three to one in four.
   */
  test("a change in its first minutes is caught about as often as it was", () => {
    const fresh: Array<{ before: boolean; now: boolean }> = checks.map(
      (windowEnd: number): { before: boolean; now: boolean } => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 3,
          factor: 1.3,
          read: () => {
            const count: number = windowCount({
              traffic,
              windowEnd,
              minutes: 1,
            });

            return {
              before: breachBefore({
                stats: baselineBefore({ traffic, windowEnd }),
                observed: count,
                filterType: FilterType.AnomalouslyHigh,
              }),
              now: Boolean(
                breachNow({
                  traffic,
                  windowEnd,
                  windowSeconds: 60,
                  count,
                  filterType: FilterType.AnomalouslyHigh,
                }),
              ),
            };
          },
        });
      },
    );

    const share: (key: "before" | "now") => number = (
      key: "before" | "now",
    ): number => {
      return shareOf(
        fresh.map((check: { before: boolean; now: boolean }): boolean => {
          return check[key];
        }),
      );
    };

    expect(Math.abs(share("now") - share("before"))).toBeLessThan(0.15);
  });

  test("a change does not raise the baseline it is judged against", () => {
    const windowEnd: number = checks[0]!;
    const quiet: CountBaselineSummary = baselineNow({
      traffic,
      windowEnd,
      windowSeconds: 60,
    })!;
    const during: CountBaselineSummary = withChange({
      traffic,
      windowEnd,
      minutes: 45,
      factor: 50,
      read: () => {
        return baselineNow({ traffic, windowEnd, windowSeconds: 60 })!;
      },
    });

    expect(during).toEqual(quiet);
  });

  test("a 15-minute window catches a rise a per-minute spread hid", () => {
    const rises: Array<{ before: boolean; now: boolean }> = checks.map(
      (windowEnd: number): { before: boolean; now: boolean } => {
        return withChange({
          traffic,
          windowEnd,
          minutes: 30,
          factor: 1.5,
          read: () => {
            const count: number = windowCount({
              traffic,
              windowEnd,
              minutes: 15,
            });

            return {
              before: breachBefore({
                stats: baselineBefore({ traffic, windowEnd }),
                observed: count / 15,
                filterType: FilterType.AnomalouslyHigh,
              }),
              now: Boolean(
                breachNow({
                  traffic,
                  windowEnd,
                  windowSeconds: 900,
                  count,
                  filterType: FilterType.AnomalouslyHigh,
                }),
              ),
            };
          },
        });
      },
    );

    const share: (key: "before" | "now") => number = (
      key: "before" | "now",
    ): number => {
      return shareOf(
        rises.map((rise: { before: boolean; now: boolean }): boolean => {
          return rise[key];
        }),
      );
    };

    expect(share("before")).toBeLessThan(0.35);
    expect(share("now")).toBeGreaterThan(0.6);
  });
});

describe("how often a busy monitor alerts", () => {
  /*
   * The cost of the fix, measured. Taking this hour out of its baseline
   * would, alone, roughly triple a busy monitor's alerts: its blindness was
   * what kept it quiet. Adding the level two weeks cannot see is what keeps
   * them where they were.
   */
  const scopes: Array<{ perMinute: number; seed: number }> = [
    { perMinute: 2000, seed: 2718 },
    { perMinute: 20000, seed: 3141 },
  ];

  test.each(scopes)(
    "a one-minute window at $perMinute a minute alerts about as often as it did",
    (scope: { perMinute: number; seed: number }) => {
      const traffic: Traffic = trafficOf({ ...scope, weeks: 5 });
      const checks: Array<number> = minutesToCheck({ traffic, days: 10 });

      const count: (windowEnd: number) => number = (
        windowEnd: number,
      ): number => {
        return windowCount({ traffic, windowEnd, minutes: 1 });
      };

      const before: number = alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return breachBefore({
            stats: baselineBefore({ traffic, windowEnd }),
            observed: count(windowEnd),
            filterType: FilterType.Anomalous,
          });
        }),
      );

      const earlierWeeksOnly: number = alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return breachBefore({
            stats: baselineBefore({
              traffic,
              windowEnd: windowEnd - (windowEnd % 60) + 60,
              countThisHour: false,
            }),
            observed: count(windowEnd),
            filterType: FilterType.Anomalous,
          });
        }),
      );

      const now: number = alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return Boolean(
            breachNow({
              traffic,
              windowEnd,
              windowSeconds: 60,
              count: count(windowEnd),
              filterType: FilterType.Anomalous,
            }),
          );
        }),
      );

      expect(earlierWeeksOnly).toBeGreaterThan(before * 2);
      expect(now).toBeLessThan(before * 1.5);
    },
  );

  test("a busy one-minute window keeps the center it always had", () => {
    const traffic: Traffic = trafficOf({
      seed: 1618,
      perMinute: 20000,
      weeks: 5,
      rhythm: 0,
      drift: 0,
      wobble: 0,
    });

    for (const windowEnd of minutesToCheck({ traffic, days: 3, every: 61 })) {
      const now: CountBaselineSummary = baselineNow({
        traffic,
        windowEnd,
        windowSeconds: 60,
      })!;
      const before: CountBaselineStats = baselineBefore({
        traffic,
        windowEnd,
        countThisHour: false,
      })!;

      expect(Math.abs(now.mean - before.mean) / before.mean).toBeLessThan(
        0.005,
      );
      expect(now.nonEmpty).toBeUndefined();
    }
  });

  /*
   * Over a few seeds: a flat rate's alerts depend on how its days happen to
   * fall, so one seed says little about how often it alerts.
   */
  test("a flat rate alerts about as often as it did, where two weeks alone would flood it", () => {
    let before: number = 0;
    let measuredOnly: number = 0;
    let now: number = 0;

    for (const seed of [2047, 2053, 2063]) {
      const traffic: Traffic = trafficOf({
        seed,
        perMinute: 2000,
        weeks: 5,
        rhythm: 0,
        drift: 0.02,
      });
      const checks: Array<number> = minutesToCheck({ traffic, days: 7 });

      const count: (windowEnd: number) => number = (
        windowEnd: number,
      ): number => {
        return windowCount({ traffic, windowEnd, minutes: 5 });
      };

      before += alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return breachBefore({
            stats: baselineBefore({ traffic, windowEnd }),
            observed: count(windowEnd) / 5,
            filterType: FilterType.Anomalous,
          });
        }),
      );

      // The same read, without the level two weeks cannot see.
      measuredOnly += alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return breachBefore({
            stats: measuredStatsOf({ traffic, windowEnd, windowSeconds: 300 }),
            observed: count(windowEnd) / 5,
            filterType: FilterType.Anomalous,
          });
        }),
      );

      now += alertsAmong(
        checks.map((windowEnd: number): boolean => {
          return Boolean(
            breachNow({
              traffic,
              windowEnd,
              windowSeconds: 300,
              count: count(windowEnd),
              filterType: FilterType.Anomalous,
            }),
          );
        }),
      );
    }

    expect(measuredOnly).toBeGreaterThan(before * 3);
    expect(now).toBeLessThan(before * 2);
  });

  test("a flat rate's real change still shows", () => {
    const traffic: Traffic = trafficOf({
      seed: 2069,
      perMinute: 2000,
      weeks: 5,
      rhythm: 0,
      drift: 0.02,
    });

    const fired: Array<boolean> = minutesToCheck({
      traffic,
      days: 7,
      every: 37,
    }).map((windowEnd: number): boolean => {
      return withChange({
        traffic,
        windowEnd,
        minutes: 30,
        factor: 1.3,
        read: (): boolean => {
          return Boolean(
            breachNow({
              traffic,
              windowEnd,
              windowSeconds: 300,
              count: windowCount({ traffic, windowEnd, minutes: 5 }),
              filterType: FilterType.AnomalouslyHigh,
            }),
          );
        },
      });
    });

    expect(shareOf(fired)).toBeGreaterThan(0.9);
  });

  test("a stop in an earlier week leaves what a busy scope is judged by", () => {
    const traffic: Traffic = trafficOf({
      seed: 8128,
      perMinute: 2000,
      weeks: 5,
    });
    const windowEnd: number = minutesToCheck({ traffic, days: 1 })[100]!;
    const before: CountBaselineSummary = baselineNow({
      traffic,
      windowEnd,
      windowSeconds: 60,
    })!;

    const stopped: CountBaselineSummary = withChange({
      traffic,
      windowEnd: windowEnd - MINUTES_PER_WEEK,
      minutes: 30,
      factor: 0,
      read: () => {
        return baselineNow({ traffic, windowEnd, windowSeconds: 60 })!;
      },
    });

    expect(stopped.nonEmpty).toBeUndefined();
    expect(Math.abs(stopped.mean - before.mean) / before.mean).toBeLessThan(
      0.02,
    );
    expect(stopped.stddev).toBeLessThan(before.stddev * 1.2);
  });
});

describe("a window that is not a minute long", () => {
  const traffic: Traffic = trafficOf({
    seed: 4669,
    perMinute: 2000,
    weeks: 5,
  });
  const checks: Array<number> = minutesToCheck({ traffic, days: 7, every: 17 });

  test("a 6-hour window of a daily rhythm is judged by the hours it covers", () => {
    const before: Array<boolean> = checks.map((windowEnd: number): boolean => {
      return breachBefore({
        stats: baselineBefore({ traffic, windowEnd }),
        observed: windowCount({ traffic, windowEnd, minutes: 360 }) / 360,
        filterType: FilterType.Anomalous,
      });
    });

    const now: Array<boolean> = checks.map((windowEnd: number): boolean => {
      return Boolean(
        breachNow({
          traffic,
          windowEnd,
          windowSeconds: 21600,
          count: windowCount({ traffic, windowEnd, minutes: 360 }),
          filterType: FilterType.Anomalous,
        }),
      );
    });

    expect(shareOf(before)).toBeGreaterThan(0.4);
    expect(shareOf(now)).toBeLessThan(0.02);
  });

  test("a 5-second window of a steady scope stops firing on chance", () => {
    const steady: Traffic = trafficOf({
      seed: 6626,
      perMinute: 600,
      weeks: 5,
      rhythm: 0,
      drift: 0,
      wobble: 0,
    });
    const random: SeededRandom = seededRandom(1729);
    const windows: Array<number> = minutesToCheck({
      traffic: steady,
      days: 7,
      every: 17,
    });

    const fired: Array<{ before: boolean; now: boolean }> = windows.map(
      (windowEnd: number): { before: boolean; now: boolean } => {
        // 5 seconds of a steady 10 a second.
        const count: number = poisson(random, 50);

        return {
          before: breachBefore({
            stats: baselineBefore({ traffic: steady, windowEnd }),
            observed: count * 12,
            filterType: FilterType.Anomalous,
          }),
          now: Boolean(
            breachNow({
              traffic: steady,
              windowEnd,
              windowSeconds: 5,
              count,
              filterType: FilterType.Anomalous,
            }),
          ),
        };
      },
    );

    expect(
      shareOf(
        fired.map((check: { before: boolean; now: boolean }): boolean => {
          return check.before;
        }),
      ),
    ).toBeGreaterThan(0.1);
    expect(
      shareOf(
        fired.map((check: { before: boolean; now: boolean }): boolean => {
          return check.now;
        }),
      ),
    ).toBeLessThan(0.02);
  });
});

describe("a sparse scope", () => {
  // Minutes of a scope, zero unless `busy` says otherwise.
  const scopeOf: (busy: (minute: number) => number) => Traffic = (
    busy: (minute: number) => number,
  ): Traffic => {
    const counts: Float64Array = new Float64Array(5 * MINUTES_PER_WEEK);

    for (let minute: number = 0; minute < counts.length; minute++) {
      counts[minute] = busy(minute);
    }

    return { counts, start: MONDAY / MINUTE };
  };

  const hourlyJob: Traffic = scopeOf((minute: number): number => {
    return minute % 60 === 30 ? 100 + (minute % 7) : 0;
  });

  test("a job that logs 100 lines an hour is not an outlier once an hour", () => {
    for (const windowEnd of minutesToCheck({
      traffic: hourlyJob,
      days: 3,
    })) {
      const count: number = windowCount({
        traffic: hourlyJob,
        windowEnd,
        minutes: 1,
      });

      expect(
        breachNow({
          traffic: hourlyJob,
          windowEnd,
          windowSeconds: 60,
          count,
          filterType: FilterType.Anomalous,
        }),
      ).toBeNull();
    }
  });

  test("a burst well past the job's usual one is", () => {
    const windowEnd: number = minutesToCheck({
      traffic: hourlyJob,
      days: 1,
    })[100]!;

    expect(
      breachNow({
        traffic: hourlyJob,
        windowEnd,
        windowSeconds: 60,
        count: 500,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).not.toBeNull();
  });

  test("the empty minutes of a scope that runs now and then are not unusually low", () => {
    const random: SeededRandom = seededRandom(1234);
    const runsOften: Traffic = scopeOf((): number => {
      return random() < 0.3 ? 15 + random(6) : 0;
    });

    const checks: Array<number> = minutesToCheck({
      traffic: runsOften,
      days: 3,
    });

    const before: Array<boolean> = checks.map((windowEnd: number): boolean => {
      return breachBefore({
        stats: baselineBefore({ traffic: runsOften, windowEnd }),
        observed: windowCount({ traffic: runsOften, windowEnd, minutes: 1 }),
        filterType: FilterType.AnomalouslyLow,
      });
    });

    const now: Array<boolean> = checks.map((windowEnd: number): boolean => {
      return Boolean(
        breachNow({
          traffic: runsOften,
          windowEnd,
          windowSeconds: 60,
          count: windowCount({ traffic: runsOften, windowEnd, minutes: 1 }),
          filterType: FilterType.AnomalouslyLow,
        }),
      );
    });

    expect(shareOf(before)).toBeGreaterThan(0.5);
    expect(shareOf(now)).toBe(0);
  });

  test("a heartbeat that stops is caught, where a flat history was skipped", () => {
    const heartbeat: Traffic = scopeOf((): number => {
      return 60;
    });
    const windowEnd: number = minutesToCheck({
      traffic: heartbeat,
      days: 1,
    })[100]!;

    expect(
      breachBefore({
        stats: baselineBefore({ traffic: heartbeat, windowEnd }),
        observed: 0,
        filterType: FilterType.AnomalouslyLow,
      }),
    ).toBe(false);

    expect(
      breachNow({
        traffic: heartbeat,
        windowEnd,
        windowSeconds: 60,
        count: 0,
        filterType: FilterType.AnomalouslyLow,
      }),
    ).not.toBeNull();
  });

  test("a quiet scope's first burst is judged, and its first few lines are not", () => {
    const quiet: Traffic = scopeOf((): number => {
      return 0;
    });
    const windowEnd: number = minutesToCheck({ traffic: quiet, days: 1 })[100]!;

    expect(
      breachNow({
        traffic: quiet,
        windowEnd,
        windowSeconds: 60,
        count: 9,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).toBeNull();

    expect(
      breachNow({
        traffic: quiet,
        windowEnd,
        windowSeconds: 60,
        count: 10,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).not.toBeNull();
  });

  test("a rise in how often a job runs shows in a window long enough to see it", () => {
    const everyTenMinutes: Traffic = scopeOf((minute: number): number => {
      return minute % 10 === 0 ? 20 : 0;
    });
    const windowEnd: number = minutesToCheck({
      traffic: everyTenMinutes,
      days: 1,
    })[100]!;

    // Every minute instead of every ten: 300 in 15 minutes, not 30.
    expect(
      breachNow({
        traffic: everyTenMinutes,
        windowEnd,
        windowSeconds: 900,
        count: 300,
        filterType: FilterType.AnomalouslyHigh,
      }),
    ).not.toBeNull();
  });
});

describe("the rollups' hours and the plan's", () => {
  test("the plan's cells are MetricBaselineService's hours", () => {
    const windowEnd: number = MONDAY + 2 * DAY + 13 * HOUR;
    const plan: CountBaselinePlan = planFor({ windowEnd, windowSeconds: 60 });

    expect(plan.hourOfWeek).toBe(
      MetricBaselineService.computeHourOfWeek(new Date(windowEnd - 30 * 1000)),
    );
  });
});
