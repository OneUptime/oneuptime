import MetricHourBaseline, {
  MetricBaselineDayRow,
  MetricHourReading,
} from "../../../../Server/Utils/Monitor/MetricHourBaseline";
import {
  BaselineBand,
  BaselineSummary,
  MetricBaselineService,
} from "../../../../Server/Services/MetricBaselineService";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A METRIC'S ANOMALY CONDITION IS JUDGED AGAINST.
 *
 * The first half pins the read: MetricHourBaseline's arithmetic, on rows. The
 * second half runs that read over simulated traffic, next to what it replaced,
 * on the same seeds: how often a monitor alerts, and what it catches.
 * MetricBaselineService's SQL is in MetricBaselineService.test.ts, and what a
 * real ClickHouse makes of it in MonitorMetricBaselineClickhouse.test.ts
 * (packages/App).
 *
 * The traffic is simulated, so trust the shape of these numbers more than the
 * numbers. Nothing here has been measured on real metrics.
 */

jest.setTimeout(120000);

const MINUTES_PER_HOUR: number = 60;
const MINUTES_PER_DAY: number = 1440;
const MINUTES_PER_WEEK: number = 7 * MINUTES_PER_DAY;

// A Monday: minute 0 of every simulation, and hour 0 of the week.
const MONDAY: number = Date.UTC(2026, 10, 2);

const dayText: (day: number) => string = (day: number): string => {
  return MetricHourBaseline.toDayText(
    new Date(MONDAY + day * MINUTES_PER_DAY * 60000),
  );
};

const rowOf: (data: {
  day: number;
  hourOfWeek?: number;
  mean: number;
  sampleCount?: number;
  low?: number;
  high?: number;
}) => MetricBaselineDayRow = (data: {
  day: number;
  hourOfWeek?: number;
  mean: number;
  sampleCount?: number;
  low?: number;
  high?: number;
}): MetricBaselineDayRow => {
  return {
    day: dayText(data.day),
    hourOfWeek: data.hourOfWeek ?? (data.day % 7) * 24 + 9,
    sampleCount: data.sampleCount ?? 120,
    mean: data.mean,
    minObserved: data.low ?? data.mean - 1,
    maxObserved: data.high ?? data.mean + 1,
  };
};

// The hour at 09:00 on each of `days` days, ending the day before day 21.
const daysOf: (
  mean: (day: number) => number,
  days?: number,
) => Array<MetricBaselineDayRow> = (
  mean: (day: number) => number,
  days: number = 14,
): Array<MetricBaselineDayRow> => {
  const rows: Array<MetricBaselineDayRow> = [];

  for (let day: number = 21 - days; day < 21; day++) {
    rows.push(rowOf({ day, mean: mean(day) }));
  }

  return rows;
};

// Hour 9 of the Monday, which day 21 is.
const HOUR: number = 9;
const JUDGED_DAY: string = dayText(21);

const readOf: (data: {
  rows: Array<MetricBaselineDayRow>;
  stddev?: number;
  windowDays?: number;
  minSamples?: number;
}) => MetricHourReading = (data: {
  rows: Array<MetricBaselineDayRow>;
  stddev?: number;
  windowDays?: number;
  minSamples?: number;
}): MetricHourReading => {
  return MetricHourBaseline.read({
    rows: data.rows,
    hourOfWeek: HOUR,
    judgedDay: JUDGED_DAY,
    stddev: data.stddev ?? 1,
    windowDays: data.windowDays ?? 14,
    minSamples: data.minSamples ?? 5,
  });
};

describe("MetricHourBaseline.toDayText", () => {
  test("a day is the UTC day, as the rollup's day column holds it", () => {
    expect(
      MetricHourBaseline.toDayText(new Date("2026-11-02T23:59:59.999Z")),
    ).toBe("2026-11-02");
    expect(
      MetricHourBaseline.toDayText(new Date("2026-11-03T00:00:00.000Z")),
    ).toBe("2026-11-03");
  });
});

describe("MetricHourBaseline.getHoursOfDay", () => {
  test("the same hour of every day of the week", () => {
    expect(MetricHourBaseline.getHoursOfDay(9)).toEqual([
      9, 33, 57, 81, 105, 129, 153,
    ]);
    expect(MetricHourBaseline.getHoursOfDay(153)).toEqual(
      MetricHourBaseline.getHoursOfDay(9),
    );
  });

  test("the last hour of the week is in it", () => {
    expect(MetricHourBaseline.getHoursOfDay(167)).toContain(167);
    expect(MetricHourBaseline.getHoursOfDay(0)).toContain(0);
  });
});

describe("MetricHourBaseline.getLevelMove", () => {
  const steady: (day: number) => number = (day: number): number => {
    // Levels that differ from day to day, by the same fixed amounts each run.
    return 100 + [3, -2, 1, 4, -3, 2, -1, -4, 2, 3, -1, 1, -2, 4][day % 14]!;
  };

  test("nothing to read says nothing", () => {
    expect(MetricHourBaseline.getLevelMove([])).toBe(0);
    expect(
      MetricHourBaseline.getLevelMove(
        daysOf(() => {
          return 100;
        }, 8),
      ),
    ).toBe(0);
  });

  test("a level that does not move does not move", () => {
    expect(
      MetricHourBaseline.getLevelMove(
        daysOf(() => {
          return 100;
        }),
      ),
    ).toBe(0);
  });

  test("a level that moves shows", () => {
    expect(MetricHourBaseline.getLevelMove(daysOf(steady))).toBeGreaterThan(1);
  });

  test("a weekly cycle is not a move", () => {
    const weekend: (day: number) => number = (day: number): number => {
      return day % 7 >= 5 ? 50 : 100;
    };

    expect(MetricHourBaseline.getLevelMove(daysOf(weekend))).toBe(0);
  });

  test("a climb is not a move: the weeks' own spread is what sees one", () => {
    const climb: (day: number) => number = (day: number): number => {
      return 100 + 2 * day;
    };

    expect(MetricHourBaseline.getLevelMove(daysOf(climb))).toBeCloseTo(0, 9);
  });

  /*
   * What a plain move from one week to the next got wrong. A change that lasts
   * is in every such move for a week, so the band caught up with it on the
   * second or third day: the same blindness, more slowly.
   */
  test.each([1, 2, 3, 5])(
    "a change that has lasted %i days does not read as a level that moves",
    (daysLasted: number) => {
      const changed: (day: number) => number = (day: number): number => {
        return steady(day) + (day >= 21 - daysLasted ? 1000 : 0);
      };

      expect(MetricHourBaseline.getLevelMove(daysOf(changed))).toBeLessThan(
        3 * MetricHourBaseline.getLevelMove(daysOf(steady)),
      );
    },
  );

  test("an incident on one day is left out", () => {
    const incident: (day: number) => number = (day: number): number => {
      return steady(day) + (day === 17 ? 5000 : 0);
    };

    expect(MetricHourBaseline.getLevelMove(daysOf(incident))).toBeLessThan(
      4 * MetricHourBaseline.getLevelMove(daysOf(steady)),
    );
  });

  test("a day with no rows leaves the moves that needed it out", () => {
    const rows: Array<MetricBaselineDayRow> = daysOf(steady).filter(
      (row: MetricBaselineDayRow): boolean => {
        return row.day !== dayText(16);
      },
    );

    expect(Number.isFinite(MetricHourBaseline.getLevelMove(rows))).toBe(true);
  });
});

describe("MetricHourBaseline.getLevelVariance", () => {
  const hoursOf: (
    rows: Array<MetricBaselineDayRow>,
  ) => Array<MetricBaselineDayRow> = (
    rows: Array<MetricBaselineDayRow>,
  ): Array<MetricBaselineDayRow> => {
    return rows.filter((row: MetricBaselineDayRow): boolean => {
      return row.hourOfWeek === HOUR;
    });
  };

  test("no earlier hour has nothing to add", () => {
    expect(MetricHourBaseline.getLevelVariance({ days: [], hours: [] })).toBe(
      0,
    );
  });

  test("what the earlier weeks do not hold of a prediction: 2 / W of a level's variance", () => {
    const rows: Array<MetricBaselineDayRow> = daysOf((day: number): number => {
      return 100 + [3, -2, 1, 4, -3, 2, -1, -4, 2, 3, -1, 1, -2, 4][day % 14]!;
    });
    const levelMove: number = MetricHourBaseline.getLevelMove(rows);

    // Two weeks that agree, so that the days are all there is to read.
    const agreeing: Array<MetricBaselineDayRow> = [
      rowOf({ day: 7, mean: 100 }),
      rowOf({ day: 14, mean: 100 }),
    ];

    expect(
      MetricHourBaseline.getLevelVariance({ days: rows, hours: agreeing }),
    ).toBeCloseTo(levelMove * levelMove, 9);
  });

  /*
   * A steady climb sits exactly three standard deviations from two earlier
   * weeks. It is what the weeks' own spread is scaled for: it sits at sqrt(3)
   * from any number of them, so no sensitivity reads a climb as a change.
   */
  test.each([2, 4, 8, 12])(
    "a steady climb reads sqrt(3) from %i earlier weeks",
    (weeks: number) => {
      const hours: Array<MetricBaselineDayRow> = [];
      const perWeek: number = 10;

      for (let week: number = weeks; week >= 1; week--) {
        hours.push(
          rowOf({
            day: 21 - 7 * week,
            mean: 1000 - perWeek * week,
          }),
        );
      }

      const mean: number = 1000 - (perWeek * (weeks + 1)) / 2;
      const measured: number =
        hours.reduce((sum: number, row: MetricBaselineDayRow): number => {
          return sum + Math.pow(row.mean - mean, 2);
        }, 0) / weeks;

      const variance: number =
        measured + MetricHourBaseline.getLevelVariance({ days: hours, hours });

      expect((1000 - mean) / Math.sqrt(variance)).toBeCloseTo(Math.sqrt(3), 9);
    },
  );

  test("the means of a constant metric are not quite equal, and that is not a move", () => {
    const rows: Array<MetricBaselineDayRow> = daysOf((day: number): number => {
      return 0.1 + (day % 3) * 1e-16;
    });

    expect(
      MetricHourBaseline.getLevelVariance({ days: rows, hours: hoursOf(rows) }),
    ).toBe(0);
  });
});

describe("MetricHourBaseline.read", () => {
  const twoWeeks: Array<MetricBaselineDayRow> = [
    rowOf({ day: 7, mean: 100 }),
    rowOf({ day: 14, mean: 100 }),
  ];

  describe("what is judged is not what it is judged against", () => {
    test("the day judged has no say in the spread", () => {
      const without: MetricHourReading = readOf({ rows: twoWeeks });
      const withIt: MetricHourReading = readOf({
        rows: [...twoWeeks, rowOf({ day: 21, mean: 1000000 })],
      });

      expect(withIt.stddev).toBe(without.stddev);
    });

    test("nor do the days after it, when an older moment is judged", () => {
      expect(
        readOf({
          rows: [...twoWeeks, rowOf({ day: 28, mean: 1000000 })],
        }).stddev,
      ).toBe(readOf({ rows: twoWeeks }).stddev);
    });
  });

  describe("the spread", () => {
    test("a level that does not move leaves the spread as measured", () => {
      expect(readOf({ rows: twoWeeks, stddev: 7 }).stddev).toBe(7);
    });

    test("it adds to what was measured as a variance", () => {
      const rows: Array<MetricBaselineDayRow> = [
        rowOf({ day: 7, mean: 90 }),
        rowOf({ day: 14, mean: 110 }),
      ];

      // The weeks are 10 from their mean, so 2 * 100 of variance is missing.
      expect(readOf({ rows, stddev: 10 }).stddev).toBeCloseTo(
        Math.sqrt(100 + 200),
        9,
      );
    });
  });

  describe("reliability", () => {
    test("two earlier weeks are reliable", () => {
      expect(readOf({ rows: twoWeeks }).isReliable).toBe(true);
    });

    /*
     * One week shows nothing of how far a week moves: on one, a metric that
     * climbs reads as anomalous on every check.
     */
    test("one earlier week is still learning", () => {
      expect(readOf({ rows: [twoWeeks[1]!] }).isReliable).toBe(false);
    });

    test("a metric with only its own samples is still learning, however many", () => {
      expect(
        readOf({
          rows: [rowOf({ day: 21, mean: 100, sampleCount: 100000 })],
        }).isReliable,
      ).toBe(false);
    });

    test("a window of a week asks for the one week it can hold", () => {
      expect(readOf({ rows: [twoWeeks[1]!], windowDays: 7 }).isReliable).toBe(
        true,
      );
    });

    test("rows of other hours are not weeks of this one", () => {
      expect(
        readOf({
          rows: [
            twoWeeks[1]!,
            rowOf({ day: 13, hourOfWeek: HOUR + 144, mean: 100 }),
          ],
        }).isReliable,
      ).toBe(false);
    });

    test("too few samples is still learning", () => {
      expect(
        readOf({
          rows: [
            rowOf({ day: 7, mean: 100, sampleCount: 2 }),
            rowOf({ day: 14, mean: 100, sampleCount: 2 }),
          ],
        }).isReliable,
      ).toBe(false);
    });

    /*
     * A metric reporting every half hour holds four earlier samples on a
     * 14-day baseline. Counting only those would leave it learning for ever,
     * where it was judged before.
     */
    test("the hour's own samples count towards them, as they always did", () => {
      expect(
        readOf({
          rows: [
            rowOf({ day: 7, mean: 100, sampleCount: 2 }),
            rowOf({ day: 14, mean: 100, sampleCount: 2 }),
            rowOf({ day: 21, mean: 100, sampleCount: 1 }),
          ],
        }).isReliable,
      ).toBe(true);
    });

    test("a metric that reports hourly stays learning on 14 days, as it did", () => {
      expect(
        readOf({
          rows: [
            rowOf({ day: 7, mean: 100, sampleCount: 1 }),
            rowOf({ day: 14, mean: 100, sampleCount: 1 }),
            rowOf({ day: 21, mean: 100, sampleCount: 1 }),
          ],
        }).isReliable,
      ).toBe(false);
    });

    test("a raised minSamples is held to", () => {
      expect(readOf({ rows: twoWeeks, minSamples: 241 }).isReliable).toBe(
        false,
      );
      expect(readOf({ rows: twoWeeks, minSamples: 240 }).isReliable).toBe(true);
    });
  });

  describe("a history with no spread", () => {
    const flat: Array<MetricBaselineDayRow> = [
      rowOf({ day: 7, mean: 1, low: 1, high: 1 }),
      rowOf({ day: 14, mean: 1, low: 1, high: 1 }),
    ];

    test("has none, whatever rounding the measured spread holds", () => {
      expect(readOf({ rows: flat, stddev: 1e-8 }).stddev).toBe(0);
    });

    test("the metric has not moved while its samples stay on the value", () => {
      expect(
        readOf({
          rows: [...flat, rowOf({ day: 21, mean: 1, low: 1, high: 1 })],
          stddev: 0,
        }).leftFlatHistory,
      ).toBe(false);
    });

    test.each([
      ["below", 0],
      ["above", 2],
    ])("it has once a sample goes %s it", (_: string, value: number) => {
      expect(
        readOf({
          rows: [
            ...flat,
            rowOf({
              day: 21,
              mean: 1,
              low: Math.min(1, value),
              high: Math.max(1, value),
            }),
          ],
          stddev: 0,
        }).leftFlatHistory,
      ).toBe(true);
    });

    test("a history that has a spread has not left anything", () => {
      expect(
        readOf({
          rows: [
            rowOf({ day: 7, mean: 1, low: 0, high: 2 }),
            rowOf({ day: 14, mean: 1, low: 0, high: 2 }),
            rowOf({ day: 21, mean: 50, low: 50, high: 50 }),
          ],
        }).leftFlatHistory,
      ).toBe(false);
    });

    test("an hour flat in itself on days that move has a spread: those days'", () => {
      const rows: Array<MetricBaselineDayRow> = daysOf(
        (day: number): number => {
          return (
            100 + [3, -2, 1, 4, -3, 2, -1, -4, 2, 3, -1, 1, -2, 4][day % 14]!
          );
        },
      ).map((row: MetricBaselineDayRow): MetricBaselineDayRow => {
        return row.hourOfWeek === HOUR
          ? { ...row, mean: 100, minObserved: 100, maxObserved: 100 }
          : row;
      });

      expect(readOf({ rows, stddev: 0 }).stddev).toBeGreaterThan(0);
    });
  });
});

describe("MetricBaselineService.getBand", () => {
  const baselineOf: (data: Partial<BaselineSummary>) => BaselineSummary = (
    data: Partial<BaselineSummary>,
  ): BaselineSummary => {
    return {
      sampleCount: 240,
      mean: 100,
      stddev: 10,
      median: 100,
      p95: 120,
      minObserved: 70,
      maxObserved: 130,
      isReliable: true,
      windowDays: 14,
      hourOfWeek: HOUR,
      ...data,
    };
  };

  test("a spread makes a band", () => {
    expect(
      MetricBaselineService.getBand({
        baseline: baselineOf({}),
        sigmaCount: 3,
      }),
    ).toEqual({ expectedHigh: 130, expectedLow: 70 });
  });

  test("no spread and a metric that has not moved judges nothing", () => {
    expect(
      MetricBaselineService.getBand({
        baseline: baselineOf({ stddev: 0 }),
        sigmaCount: 3,
      }),
    ).toBeNull();
  });

  test("a spread that is not a number judges nothing", () => {
    expect(
      MetricBaselineService.getBand({
        baseline: baselineOf({ stddev: NaN }),
        sigmaCount: 3,
      }),
    ).toBeNull();
  });

  test("a metric that left a flat history is judged on that value alone", () => {
    const band: BaselineBand = MetricBaselineService.getBand({
      baseline: baselineOf({ stddev: 0, leftFlatHistory: true }),
      sigmaCount: 3,
    })!;

    expect(101).toBeGreaterThan(band.expectedHigh);
    expect(99).toBeLessThan(band.expectedLow);
  });

  test("the rounding of an average of that value is not off it", () => {
    const band: BaselineBand = MetricBaselineService.getBand({
      baseline: baselineOf({ mean: 0.3, stddev: 0, leftFlatHistory: true }),
      sigmaCount: 3,
    })!;

    expect(0.1 + 0.2).toBeLessThan(band.expectedHigh);
    expect(0.1 + 0.2).toBeGreaterThan(band.expectedLow);
  });

  test("a history of nothing but zeros is left by anything", () => {
    const band: BaselineBand = MetricBaselineService.getBand({
      baseline: baselineOf({ mean: 0, stddev: 0, leftFlatHistory: true }),
      sigmaCount: 3,
    })!;

    expect(0.001).toBeGreaterThan(band.expectedHigh);
    expect(-0.001).toBeLessThan(band.expectedLow);
    expect(0).toBe(band.expectedHigh);
  });
});

/*
 * Simulated traffic, kept as a cell keeps it: per minute, how many samples
 * arrived, their sum and the sum of their squares, which merge as countMerge,
 * avgMerge and stddevPopMerge do.
 */

interface Traffic {
  // Each series' mean sample of each minute, which its data point is.
  series: Array<Float64Array>;
  // The spread of a series' samples within a minute, as a variance.
  withinMinute: Array<Float64Array>;
  samplesPerMinute: number;
  counts: Float64Array;
  sums: Float64Array;
  squares: Float64Array;
  lows: Float64Array;
  highs: Float64Array;
  hours: Map<number, HourMoments>;
}

interface HourMoments {
  count: number;
  sum: number;
  square: number;
  low: number;
  high: number;
}

const trafficOf: (data: {
  series: Array<Float64Array>;
  withinMinute?: Array<Float64Array>;
  samplesPerMinute?: number;
}) => Traffic = (data: {
  series: Array<Float64Array>;
  withinMinute?: Array<Float64Array>;
  samplesPerMinute?: number;
}): Traffic => {
  const length: number = data.series[0]!.length;
  const samplesPerMinute: number = data.samplesPerMinute ?? 2;
  const withinMinute: Array<Float64Array> =
    data.withinMinute ??
    data.series.map((): Float64Array => {
      return new Float64Array(length);
    });
  const traffic: Traffic = {
    series: data.series,
    withinMinute,
    samplesPerMinute,
    counts: new Float64Array(length),
    sums: new Float64Array(length),
    squares: new Float64Array(length),
    lows: new Float64Array(length).fill(Infinity),
    highs: new Float64Array(length).fill(-Infinity),
    hours: new Map<number, HourMoments>(),
  };

  for (let minute: number = 0; minute < length; minute++) {
    refreshMinute(traffic, minute);
  }

  return traffic;
};

function refreshMinute(traffic: Traffic, minute: number): void {
  let count: number = 0;
  let sum: number = 0;
  let square: number = 0;
  let low: number = Infinity;
  let high: number = -Infinity;

  for (let index: number = 0; index < traffic.series.length; index++) {
    const mean: number = traffic.series[index]![minute]!;
    const within: number = traffic.withinMinute[index]![minute]!;

    count += traffic.samplesPerMinute;
    sum += traffic.samplesPerMinute * mean;
    square += traffic.samplesPerMinute * (mean * mean + within);
    low = Math.min(low, mean - Math.sqrt(within));
    high = Math.max(high, mean + Math.sqrt(within));
  }

  traffic.counts[minute] = count;
  traffic.sums[minute] = sum;
  traffic.squares[minute] = square;
  traffic.lows[minute] = low;
  traffic.highs[minute] = high;
}

const momentsBetween: (
  traffic: Traffic,
  from: number,
  to: number,
) => HourMoments = (
  traffic: Traffic,
  from: number,
  to: number,
): HourMoments => {
  const moments: HourMoments = {
    count: 0,
    sum: 0,
    square: 0,
    low: Infinity,
    high: -Infinity,
  };

  for (
    let minute: number = Math.max(0, from);
    minute < Math.min(to, traffic.counts.length);
    minute++
  ) {
    moments.count += traffic.counts[minute]!;
    moments.sum += traffic.sums[minute]!;
    moments.square += traffic.squares[minute]!;
    moments.low = Math.min(moments.low, traffic.lows[minute]!);
    moments.high = Math.max(moments.high, traffic.highs[minute]!);
  }

  return moments;
};

// A finished hour, kept. A change over several hours clears this.
const hourMoments: (traffic: Traffic, start: number) => HourMoments = (
  traffic: Traffic,
  start: number,
): HourMoments => {
  let moments: HourMoments | undefined = traffic.hours.get(start);

  if (!moments) {
    moments = momentsBetween(traffic, start, start + MINUTES_PER_HOUR);
    traffic.hours.set(start, moments);
  }

  return moments;
};

const hourOfWeekOf: (minute: number) => number = (minute: number): number => {
  return Math.floor((minute % MINUTES_PER_WEEK) / MINUTES_PER_HOUR);
};

const dayOf: (minute: number) => number = (minute: number): number => {
  return Math.floor(minute / MINUTES_PER_DAY);
};

// The start of a cell's hour on each day of [firstDay, lastDay] it falls on.
const hoursOfCell: (
  hourOfWeek: number,
  firstDay: number,
  lastDay: number,
) => Array<number> = (
  hourOfWeek: number,
  firstDay: number,
  lastDay: number,
): Array<number> => {
  const starts: Array<number> = [];

  for (let day: number = firstDay; day <= lastDay; day++) {
    if (Math.floor(hourOfWeek / 24) === day % 7) {
      starts.push(day * MINUTES_PER_DAY + (hourOfWeek % 24) * MINUTES_PER_HOUR);
    }
  }

  return starts;
};

const merge: (moments: Array<HourMoments>) => {
  count: number;
  mean: number;
  variance: number;
} = (
  moments: Array<HourMoments>,
): { count: number; mean: number; variance: number } => {
  let count: number = 0;
  let sum: number = 0;
  let square: number = 0;

  for (const hour of moments) {
    count += hour.count;
    sum += hour.sum;
    square += hour.square;
  }

  const mean: number = count > 0 ? sum / count : 0;

  return {
    count,
    mean,
    variance: count > 0 ? Math.max(0, square / count - mean * mean) : 0,
  };
};

// What a data point is judged against.
type Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  judgedDay: number;
  now: number;
  sigmaCount: number;
  windowDays: number;
}) => BaselineBand | null;

const bandOf: (data: {
  mean: number;
  variance: number;
  sigmaCount: number;
}) => BaselineBand | null = (data: {
  mean: number;
  variance: number;
  sigmaCount: number;
}): BaselineBand | null => {
  if (data.variance === 0) {
    return null;
  }

  const half: number = data.sigmaCount * Math.sqrt(data.variance);

  return { expectedHigh: data.mean + half, expectedLow: data.mean - half };
};

/*
 * What getBaseline read before: every day from today - N to today, the hour
 * being judged included so far as it has gone.
 */
const readBefore: Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  now: number;
  sigmaCount: number;
  windowDays: number;
}): BaselineBand | null => {
  const today: number = dayOf(data.now);
  const read: { count: number; mean: number; variance: number } = merge(
    hoursOfCell(data.hourOfWeek, today - data.windowDays, today)
      .filter((start: number): boolean => {
        return start <= data.now;
      })
      .map((start: number): HourMoments => {
        return start + MINUTES_PER_HOUR <= data.now
          ? hourMoments(data.traffic, start)
          : momentsBetween(data.traffic, start, data.now);
      }),
  );

  return read.count >= 5
    ? bandOf({
        mean: read.mean,
        variance: read.variance,
        sigmaCount: data.sigmaCount,
      })
    : null;
};

// The earlier days alone, with nothing added for how far a level moves.
const readEarlierDaysAlone: Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  judgedDay: number;
  sigmaCount: number;
  windowDays: number;
}): BaselineBand | null => {
  const read: { count: number; mean: number; variance: number } = merge(
    hoursOfCell(
      data.hourOfWeek,
      data.judgedDay - data.windowDays,
      data.judgedDay - 1,
    ).map((start: number): HourMoments => {
      return hourMoments(data.traffic, start);
    }),
  );

  return read.count >= 5
    ? bandOf({
        mean: read.mean,
        variance: read.variance,
        sigmaCount: data.sigmaCount,
      })
    : null;
};

/*
 * A read of traffic that is not changing, kept by its hour and day: what the
 * hour's earlier days say does not move within the hour, and the checks of a
 * week would otherwise read each of them sixty times over.
 */
const remembering: (read: Read) => Read = (read: Read): Read => {
  const bands: Map<string, BaselineBand | null> = new Map();

  return (data: Parameters<Read>[0]): BaselineBand | null => {
    const key: string = `${data.hourOfWeek} ${data.judgedDay}`;
    let band: BaselineBand | null | undefined = bands.get(key);

    if (band === undefined) {
      band = read(data);
      bands.set(key, band);
    }

    return band;
  };
};

// What getBaseline reads now, through the code that reads it.
const readNow: Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  judgedDay: number;
  now: number;
  sigmaCount: number;
  windowDays: number;
}): BaselineBand | null => {
  const firstDay: number = data.judgedDay - data.windowDays;
  const rows: Array<MetricBaselineDayRow> = [];
  const hourOfDay: number = data.hourOfWeek % 24;

  for (let day: number = firstDay; day <= data.judgedDay; day++) {
    const start: number = day * MINUTES_PER_DAY + hourOfDay * MINUTES_PER_HOUR;

    if (start < 0 || start > data.now) {
      continue;
    }

    const moments: HourMoments =
      start + MINUTES_PER_HOUR <= data.now
        ? hourMoments(data.traffic, start)
        : momentsBetween(data.traffic, start, data.now);

    if (moments.count > 0) {
      rows.push({
        day: dayText(day),
        hourOfWeek: hourOfWeekOf(start),
        sampleCount: moments.count,
        mean: moments.sum / moments.count,
        minObserved: moments.low,
        maxObserved: moments.high,
      });
    }
  }

  const earlier: { count: number; mean: number; variance: number } = merge(
    hoursOfCell(data.hourOfWeek, firstDay, data.judgedDay - 1)
      .filter((start: number): boolean => {
        return start >= 0;
      })
      .map((start: number): HourMoments => {
        return hourMoments(data.traffic, start);
      }),
  );

  if (earlier.count === 0) {
    return null;
  }

  const reading: MetricHourReading = MetricHourBaseline.read({
    rows,
    hourOfWeek: data.hourOfWeek,
    judgedDay: dayText(data.judgedDay),
    stddev: Math.sqrt(earlier.variance),
    windowDays: data.windowDays,
    minSamples: MetricBaselineService.DEFAULT_MIN_SAMPLES,
  });

  if (!reading.isReliable) {
    return null;
  }

  return MetricBaselineService.getBand({
    baseline: {
      sampleCount: earlier.count,
      mean: earlier.mean,
      stddev: reading.stddev,
      median: earlier.mean,
      p95: earlier.mean,
      minObserved: earlier.mean,
      maxObserved: earlier.mean,
      isReliable: reading.isReliable,
      leftFlatHistory: reading.leftFlatHistory,
      windowDays: data.windowDays,
      hourOfWeek: data.hourOfWeek,
    },
    sigmaCount: data.sigmaCount,
  });
};

type Direction = "High" | "Low" | "Either";

// The query a monitor runs: which series, and what it makes of them a minute.
interface Query {
  series?: Array<number>;
  sum?: boolean;
}

const dataPointOf: (
  traffic: Traffic,
  minute: number,
  query: Query,
) => number = (traffic: Traffic, minute: number, query: Query): number => {
  const series: Array<Float64Array> = query.series
    ? query.series.map((index: number): Float64Array => {
        return traffic.series[index]!;
      })
    : traffic.series;
  const sum: number = series.reduce(
    (total: number, values: Float64Array): number => {
      return total + values[minute]!;
    },
    0,
  );

  return query.sum ? sum : sum / series.length;
};

/*
 * One check at the end of `now`, as evaluateAnomaly makes it: every data point
 * of the window against the band of its own hour, and any that breaches fires.
 */
const fires: (data: {
  traffic: Traffic;
  now: number;
  read: Read;
  windowMinutes?: number;
  sigmaCount?: number;
  windowDays?: number;
  direction?: Direction;
  query?: Query;
}) => boolean = (data: {
  traffic: Traffic;
  now: number;
  read: Read;
  windowMinutes?: number;
  sigmaCount?: number;
  windowDays?: number;
  direction?: Direction;
  query?: Query;
}): boolean => {
  const windowMinutes: number = data.windowMinutes ?? 5;
  const firstMinute: number = data.now - windowMinutes + 1;
  const bands: Map<number, BaselineBand | null> = new Map();

  for (let minute: number = firstMinute; minute <= data.now; minute++) {
    const hourOfWeek: number = hourOfWeekOf(minute);
    let band: BaselineBand | null | undefined = bands.get(hourOfWeek);

    if (band === undefined) {
      band = data.read({
        traffic: data.traffic,
        hourOfWeek,
        judgedDay: dayOf(firstMinute),
        now: data.now + 1,
        sigmaCount: data.sigmaCount ?? 3,
        windowDays: data.windowDays ?? 14,
      });
      bands.set(hourOfWeek, band);
    }

    if (!band) {
      continue;
    }

    const value: number = dataPointOf(data.traffic, minute, data.query ?? {});

    if (data.direction !== "Low" && value > band.expectedHigh) {
      return true;
    }

    if (data.direction !== "High" && value < band.expectedLow) {
      return true;
    }
  }

  return false;
};

// Each check as if a change had run for `minutes` before it, on clean history.
const withChange: <T>(data: {
  traffic: Traffic;
  end: number;
  minutes: number;
  factor?: number;
  offset?: number;
  series?: Array<number>;
  read: () => T;
}) => T = <T>(data: {
  traffic: Traffic;
  end: number;
  minutes: number;
  factor?: number;
  offset?: number;
  series?: Array<number>;
  read: () => T;
}): T => {
  const from: number = Math.max(0, data.end - data.minutes);
  const factor: number = data.factor ?? 1;
  const offset: number = data.offset ?? 0;
  const indexes: Array<number> =
    data.series ??
    data.traffic.series.map((_: Float64Array, index: number): number => {
      return index;
    });
  const reachesFinishedHours: boolean = data.minutes > MINUTES_PER_HOUR / 2;
  const saved: Array<[Float64Array, Float64Array]> = indexes.map(
    (index: number): [Float64Array, Float64Array] => {
      return [
        data.traffic.series[index]!.slice(from, data.end),
        data.traffic.withinMinute[index]!.slice(from, data.end),
      ];
    },
  );

  indexes.forEach((index: number): void => {
    const series: Float64Array = data.traffic.series[index]!;
    const within: Float64Array = data.traffic.withinMinute[index]!;

    for (let minute: number = from; minute < data.end; minute++) {
      series[minute] = series[minute]! * factor + offset;
      within[minute] = within[minute]! * factor * factor;
    }
  });

  for (let minute: number = from; minute < data.end; minute++) {
    refreshMinute(data.traffic, minute);
  }

  if (reachesFinishedHours) {
    data.traffic.hours.clear();
  }

  const result: T = data.read();

  indexes.forEach((index: number, position: number): void => {
    data.traffic.series[index]!.set(saved[position]![0], from);
    data.traffic.withinMinute[index]!.set(saved[position]![1], from);
  });

  for (let minute: number = from; minute < data.end; minute++) {
    refreshMinute(data.traffic, minute);
  }

  if (reachesFinishedHours) {
    data.traffic.hours.clear();
  }

  return result;
};

// How many times a verdict over consecutive checks turned into an alert.
const alertsAmong: (verdicts: Array<boolean>) => number = (
  verdicts: Array<boolean>,
): number => {
  return verdicts.filter((fired: boolean, index: number): boolean => {
    return fired && !verdicts[index - 1];
  }).length;
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

const normal: (random: SeededRandom) => number = (
  random: SeededRandom,
): number => {
  return (
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  );
};

interface Shape {
  // The level all day, and how far it moves.
  base?: number;
  rhythm?: number;
  weekend?: boolean;
  wobble?: number;
  drift?: number;
  // Chance, between one sample and the next.
  noise?: number;
  // How much the level climbs in a week.
  climbPerWeek?: number;
  seriesCount?: number;
  seriesSpread?: number;
}

const WEEKS_OF_TRAFFIC: number = 5;

// A gauge: a rhythm, a weekend, days that differ, drift, and chance on top.
const gaugeOf: (data: Shape & { seed: number }) => Traffic = (
  data: Shape & { seed: number },
): Traffic => {
  const random: SeededRandom = seededRandom(data.seed);
  const length: number = WEEKS_OF_TRAFFIC * MINUTES_PER_WEEK;
  const persistence: number = 0.97;
  const step: number =
    (data.drift ?? 0.02) * Math.sqrt(1 - persistence * persistence);
  const rhythm: number = data.rhythm ?? 0;
  const noise: number = data.noise ?? 0.02;
  const samplesPerMinute: number = 2;
  const levels: Float64Array = new Float64Array(length);
  const wobble: Array<number> = [];
  let drift: number = 0;

  for (let day: number = 0; day <= WEEKS_OF_TRAFFIC * 7; day++) {
    wobble.push(1 + (data.wobble ?? 0.03) * normal(random));
  }

  for (let minute: number = 0; minute < length; minute++) {
    const day: number = dayOf(minute);
    const hour: number = (minute % MINUTES_PER_DAY) / MINUTES_PER_HOUR;
    const daily: number =
      1 + rhythm * Math.sin(((hour - 8) / 24) * 2 * Math.PI);
    const weekly: number = data.weekend && day % 7 >= 5 ? 0.5 : 1;
    const climb: number =
      1 + ((data.climbPerWeek ?? 0) * minute) / MINUTES_PER_WEEK;

    drift = persistence * drift + step * normal(random);
    levels[minute] =
      (data.base ?? 100) *
      daily *
      weekly *
      wobble[day]! *
      Math.exp(drift) *
      climb;
  }

  const series: Array<Float64Array> = [];
  const withinMinute: Array<Float64Array> = [];

  for (let index: number = 0; index < (data.seriesCount ?? 1); index++) {
    const scale: number = 1 + (data.seriesSpread ?? 0) * normal(random);
    const values: Float64Array = new Float64Array(length);
    const within: Float64Array = new Float64Array(length);

    for (let minute: number = 0; minute < length; minute++) {
      const level: number = levels[minute]! * scale;
      const spread: number = level * noise;

      values[minute] =
        level + (spread / Math.sqrt(samplesPerMinute)) * normal(random);
      within[minute] = spread * spread * (1 - 1 / samplesPerMinute);
    }

    series.push(values);
    withinMinute.push(within);
  }

  return trafficOf({ series, withinMinute, samplesPerMinute });
};

// A counter as it is stored: what it has reached, never differenced.
const counterOf: (data: {
  seed: number;
  startsAt?: number;
}) => Traffic = (data: { seed: number; startsAt?: number }): Traffic => {
  const rates: Traffic = gaugeOf({
    seed: data.seed,
    rhythm: 0.3,
    wobble: 0.03,
    drift: 0.05,
    noise: 0,
  });
  const values: Float64Array = new Float64Array(rates.series[0]!.length);
  let total: number = data.startsAt ?? 0;

  for (let minute: number = 0; minute < values.length; minute++) {
    total += rates.series[0]![minute]!;
    values[minute] = total;
  }

  return trafficOf({ series: [values] });
};

const flatOf: (value: number, seriesCount?: number) => Traffic = (
  value: number,
  seriesCount: number = 1,
): Traffic => {
  return trafficOf({
    series: new Array<number>(seriesCount).fill(0).map((): Float64Array => {
      return new Float64Array(WEEKS_OF_TRAFFIC * MINUTES_PER_WEEK).fill(value);
    }),
  });
};

// The checks: every `every` minutes of `days` days, from the fourth week on.
const minutesToCheck: (data: {
  days: number;
  every?: number;
}) => Array<number> = (data: {
  days: number;
  every?: number;
}): Array<number> => {
  const first: number = 3 * MINUTES_PER_WEEK + MINUTES_PER_DAY;
  const minutes: Array<number> = [];

  for (
    let minute: number = first;
    minute < first + data.days * MINUTES_PER_DAY;
    minute += data.every ?? 1
  ) {
    minutes.push(minute);
  }

  return minutes;
};

const alertsOf: (
  traffic: Traffic,
  read: Read,
  windowMinutes?: number,
) => number = (
  traffic: Traffic,
  read: Read,
  windowMinutes: number = 5,
): number => {
  // What the hour has held so far is what the read before moved with.
  const reading: Read = read === readBefore ? read : remembering(read);

  return alertsAmong(
    minutesToCheck({ days: 7 }).map((now: number): boolean => {
      return fires({ traffic, now, read: reading, windowMinutes });
    }),
  );
};

// Share of checks caught, each as if a change had run for `minutes` before it.
const caughtOf: (data: {
  traffic: Traffic;
  read: Read;
  minutes: number;
  factor?: number;
  offset?: number;
  direction?: Direction;
  every?: number;
  sigmaCount?: number;
  windowDays?: number;
  series?: Array<number>;
  query?: Query;
}) => number = (data: {
  traffic: Traffic;
  read: Read;
  minutes: number;
  factor?: number;
  offset?: number;
  direction?: Direction;
  every?: number;
  sigmaCount?: number;
  windowDays?: number;
  series?: Array<number>;
  query?: Query;
}): number => {
  return shareOf(
    minutesToCheck({ days: 7, every: data.every ?? 37 }).map(
      (now: number): boolean => {
        return withChange({
          traffic: data.traffic,
          end: now + 1,
          minutes: data.minutes,
          ...(data.factor !== undefined ? { factor: data.factor } : {}),
          ...(data.offset !== undefined ? { offset: data.offset } : {}),
          ...(data.series ? { series: data.series } : {}),
          read: (): boolean => {
            return fires({
              traffic: data.traffic,
              now,
              read: data.read,
              ...(data.direction ? { direction: data.direction } : {}),
              ...(data.sigmaCount !== undefined
                ? { sigmaCount: data.sigmaCount }
                : {}),
              ...(data.windowDays !== undefined
                ? { windowDays: data.windowDays }
                : {}),
              ...(data.query ? { query: data.query } : {}),
            });
          },
        });
      },
    ),
  );
};

const STEADY: Shape = { wobble: 0.01, drift: 0.005, noise: 0.002 };
const FLAT: Shape = { wobble: 0.03, drift: 0.02, noise: 0.01 };
const FLAT_MOVING: Shape = { wobble: 0.08, drift: 0.02, noise: 0.01 };
const DAILY: Shape = {
  rhythm: 0.6,
  weekend: true,
  wobble: 0.03,
  drift: 0.06,
  noise: 0.05,
};
const GENTLE: Shape = { rhythm: 0.15, wobble: 0.03, drift: 0.06, noise: 0.05 };
const DISK: Shape = {
  wobble: 0,
  drift: 0.0005,
  noise: 0.0002,
  climbPerWeek: 0.01,
};

const SHAPES: Array<{ name: string; shape: Shape }> = [
  { name: "a steady gauge", shape: STEADY },
  { name: "a flat gauge moving 3% a day", shape: FLAT },
  { name: "a flat gauge moving 8% a day", shape: FLAT_MOVING },
  { name: "a daily rhythm", shape: DAILY },
  { name: "a gentle rhythm", shape: GENTLE },
];

const SEEDS: Array<number> = [2718, 3141, 5472];

// Every seed of a shape, added up: one seed says little about how often.
const overSeeds: (
  shape: Shape,
  measure: (traffic: Traffic) => number,
) => number = (shape: Shape, measure: (traffic: Traffic) => number): number => {
  return SEEDS.reduce((total: number, seed: number): number => {
    return total + measure(gaugeOf({ ...shape, seed }));
  }, 0);
};

describe("the blind spot", () => {
  /*
   * The last minute of the hour at which a change that began at the top of it
   * fires, at Medium on 14 days.
   */
  const lastFiringMinute: (data: {
    traffic: Traffic;
    series?: Array<number>;
    read: Read;
    factor: number;
  }) => number = (data: {
    traffic: Traffic;
    series?: Array<number>;
    read: Read;
    factor: number;
  }): number => {
    const hourStart: number = 3 * MINUTES_PER_WEEK + 9 * MINUTES_PER_HOUR;
    let last: number = -1;

    for (let minute: number = 1; minute <= MINUTES_PER_HOUR; minute++) {
      const end: number = hourStart + minute;
      const fired: boolean = withChange({
        traffic: data.traffic,
        end,
        minutes: minute,
        factor: data.factor,
        ...(data.series ? { series: data.series } : {}),
        read: (): boolean => {
          return fires({
            traffic: data.traffic,
            now: end - 1,
            read: data.read,
            windowMinutes: 1,
            ...(data.series ? { query: { series: data.series } } : {}),
          });
        },
      });

      if (fired) {
        last = minute;
      }
    }

    return last;
  };

  /*
   * Noise of a fixed size, in every series at every minute, so the only thing
   * that differs from one case to the next is the share of the cell.
   */
  const steadyOf: (data: {
    seriesCount: number;
    samplesPerMinute: number;
  }) => Traffic = (data: {
    seriesCount: number;
    samplesPerMinute: number;
  }): Traffic => {
    return trafficOf({
      samplesPerMinute: data.samplesPerMinute,
      series: new Array<number>(data.seriesCount)
        .fill(0)
        .map((_: number, index: number): Float64Array => {
          const values: Float64Array = new Float64Array(
            WEEKS_OF_TRAFFIC * MINUTES_PER_WEEK,
          );

          for (let minute: number = 0; minute < values.length; minute++) {
            values[minute] = 100 + ((minute * 7 + index * 3) % 5) - 2;
          }

          return values;
        }),
    });
  };

  test("a change of any size used to stop firing at its 14th minute, at any cadence", () => {
    for (const samplesPerMinute of [1, 6, 60]) {
      for (const factor of [1.5, 2, 10, 1000]) {
        expect(
          lastFiringMinute({
            traffic: steadyOf({ seriesCount: 1, samplesPerMinute }),
            read: readBefore,
            factor,
          }),
        ).toBe(13);
      }
    }
  });

  test("it does not any more", () => {
    for (const samplesPerMinute of [1, 6, 60]) {
      expect(
        lastFiringMinute({
          traffic: steadyOf({ seriesCount: 1, samplesPerMinute }),
          read: readNow,
          factor: 2,
        }),
      ).toBe(MINUTES_PER_HOUR);
    }
  });

  /*
   * The share is of the whole cell, which holds every series of the metric, so
   * a query that reads a few of them gets further than a query on all of them.
   */
  test("the share was of the cell, not of the query", () => {
    expect(
      lastFiringMinute({
        traffic: steadyOf({ seriesCount: 10, samplesPerMinute: 2 }),
        read: readBefore,
        factor: 2,
      }),
    ).toBe(13);

    expect(
      lastFiringMinute({
        traffic: steadyOf({ seriesCount: 10, samplesPerMinute: 2 }),
        series: [0, 1, 2, 3, 4],
        read: readBefore,
        factor: 2,
      }),
    ).toBe(29);

    expect(
      lastFiringMinute({
        traffic: steadyOf({ seriesCount: 10, samplesPerMinute: 2 }),
        series: [0],
        read: readBefore,
        factor: 2,
      }),
    ).toBe(MINUTES_PER_HOUR);
  });

  test("the minute moved with the sensitivity and the window, as the share says", () => {
    /*
     * The share p of k minutes of W earlier hours is k / (60 W + k), and
     * sqrt((1 - p) / p) reaches the sensitivity at k = 60 W / sigma^2. To the
     * minute or so: the traffic's noise is scaled with the change.
     */
    const cappedAt: (sigmaCount: number, windowDays: number) => number = (
      sigmaCount: number,
      windowDays: number,
    ): number => {
      const traffic: Traffic = steadyOf({
        seriesCount: 1,
        samplesPerMinute: 2,
      });
      const hourStart: number = 4 * MINUTES_PER_WEEK + 9 * MINUTES_PER_HOUR;
      let last: number = -1;

      for (let minute: number = 1; minute <= MINUTES_PER_HOUR; minute++) {
        const end: number = hourStart + minute;
        const fired: boolean = withChange({
          traffic,
          end,
          minutes: minute,
          factor: 1000,
          read: (): boolean => {
            return fires({
              traffic,
              now: end - 1,
              read: readBefore,
              windowMinutes: 1,
              sigmaCount,
              windowDays,
            });
          },
        });

        if (fired) {
          last = minute;
        }
      }

      return last;
    };

    for (const [sigmaCount, windowDays] of [
      [4, 14],
      [3, 14],
      [2, 14],
      [3, 28],
    ] as Array<[number, number]>) {
      const minute: number =
        (60 * Math.floor(windowDays / 7)) / (sigmaCount * sigmaCount);

      expect(
        Math.abs(cappedAt(sigmaCount, windowDays) - minute),
      ).toBeLessThanOrEqual(1.7);
    }
  });

  /*
   * The next hour is another cell with none of the change in it, so a change
   * that lasts was not silenced once: it opened an alert every hour.
   */
  test("a change that lasts a day opens one alert, where it opened 24", () => {
    const traffic: Traffic = steadyOf({ seriesCount: 1, samplesPerMinute: 2 });
    const start: number = 4 * MINUTES_PER_WEEK + 9 * MINUTES_PER_HOUR;

    // Applied once: no check reads past itself.
    const verdicts: (read: Read) => Array<boolean> = (
      read: Read,
    ): Array<boolean> => {
      return withChange({
        traffic,
        end: start + MINUTES_PER_DAY,
        minutes: MINUTES_PER_DAY,
        factor: 2,
        read: (): Array<boolean> => {
          const out: Array<boolean> = [];

          for (let now: number = start; now < start + MINUTES_PER_DAY; now++) {
            out.push(fires({ traffic, now, read, windowMinutes: 1 }));
          }

          return out;
        },
      });
    };

    const before: Array<boolean> = verdicts(readBefore);
    const now: Array<boolean> = verdicts(readNow);

    expect(alertsAmong(before)).toBe(24);
    expect(shareOf(before)).toBeLessThan(0.25);
    expect(alertsAmong(now)).toBe(1);
    expect(shareOf(now)).toBe(1);
  });
});

describe("what a monitor catches", () => {
  test.each(SHAPES)(
    "$name: a doubling that has lasted half an hour",
    (scenario: { shape: Shape }) => {
      const traffic: Traffic = gaugeOf({ ...scenario.shape, seed: 5472 });
      const change: { traffic: Traffic; minutes: number; factor: number } = {
        traffic,
        minutes: 30,
        factor: 2,
      };

      expect(
        caughtOf({ ...change, read: readBefore, direction: "High" }),
      ).toBeLessThan(0.4);
      expect(
        caughtOf({ ...change, read: readNow, direction: "High" }),
      ).toBeGreaterThan(0.95);
    },
  );

  test.each(SHAPES)(
    "$name: a halving that has lasted half an hour",
    (scenario: { shape: Shape }) => {
      const traffic: Traffic = gaugeOf({ ...scenario.shape, seed: 5472 });
      const change: { traffic: Traffic; minutes: number; factor: number } = {
        traffic,
        minutes: 30,
        factor: 0.5,
      };

      expect(
        caughtOf({ ...change, read: readBefore, direction: "Low" }),
      ).toBeLessThan(0.4);
      expect(
        caughtOf({ ...change, read: readNow, direction: "Low" }),
      ).toBeGreaterThan(0.75);
    },
  );

  /*
   * What a plain week-on-week move got wrong, which only a long change shows:
   * it held the change for a week, so the band caught up with it around the
   * third day. A lasting change now fires until it enters the earlier weeks.
   */
  test.each([
    [12 * 60],
    [2 * MINUTES_PER_DAY],
    [3 * MINUTES_PER_DAY],
    [5 * MINUTES_PER_DAY],
    [6 * MINUTES_PER_DAY],
  ])("a doubling that has lasted %i minutes still fires", (minutes: number) => {
    const traffic: Traffic = gaugeOf({ ...STEADY, seed: 5472 });

    expect(
      caughtOf({
        traffic,
        read: readNow,
        minutes,
        factor: 2,
        direction: "High",
        every: 503,
      }),
    ).toBe(1);
  });

  test("a change that has entered the earlier weeks is the new normal", () => {
    const traffic: Traffic = gaugeOf({ ...STEADY, seed: 5472 });

    expect(
      caughtOf({
        traffic,
        read: readNow,
        minutes: 8 * MINUTES_PER_DAY,
        factor: 2,
        direction: "High",
        every: 503,
      }),
    ).toBeLessThan(0.05);
  });

  /*
   * A wider band is what a monitor's quiet costs, and it costs fresh changes
   * some sensitivity, most on a rhythm. A steady gauge keeps all of it, which
   * is why the level is measured and not a share of the center: at 4%, a
   * change under 12% would go unseen here.
   */
  test("a steady gauge keeps its eye for a small change", () => {
    const traffic: Traffic = gaugeOf({ ...STEADY, seed: 2069 });

    expect(
      caughtOf({
        traffic,
        read: readNow,
        minutes: 3,
        factor: 1.1,
        direction: "High",
      }),
    ).toBeGreaterThan(0.95);
  });

  test("so does a disk, however it climbs", () => {
    const traffic: Traffic = gaugeOf({ ...DISK, seed: 2069 });

    expect(
      caughtOf({
        traffic,
        read: readNow,
        minutes: 3,
        factor: 1.1,
        direction: "High",
      }),
    ).toBe(1);
  });

  test.each(SHAPES)(
    "$name: most of what a +30% in its first minutes was caught at is kept",
    (scenario: { shape: Shape }) => {
      const change: { minutes: number; factor: number; direction: Direction } =
        { minutes: 3, factor: 1.3, direction: "High" };
      const caught: (read: Read) => number = (read: Read): number => {
        return overSeeds(scenario.shape, (traffic: Traffic): number => {
          return caughtOf({ traffic, read, ...change });
        });
      };

      expect(caught(readNow)).toBeGreaterThan(0.55 * caught(readBefore));
    },
  );

  test("a query reading one series of a fleet was never blind, and is as it was", () => {
    const traffic: Traffic = gaugeOf({
      seed: 2718,
      rhythm: 0.4,
      weekend: true,
      wobble: 0.03,
      drift: 0.05,
      noise: 0.05,
      seriesCount: 8,
      seriesSpread: 0.3,
    });
    const change: {
      traffic: Traffic;
      minutes: number;
      factor: number;
      series: Array<number>;
      query: Query;
      direction: Direction;
    } = {
      traffic,
      minutes: 30,
      factor: 3,
      series: [3],
      query: { series: [3] },
      direction: "High",
    };

    expect(
      Math.abs(
        caughtOf({ ...change, read: readNow }) -
          caughtOf({ ...change, read: readBefore }),
      ),
    ).toBeLessThan(0.25);
  });
});

describe("how often a monitor alerts", () => {
  /*
   * The cost of the fix, measured: the blindness was also what kept a monitor
   * quiet. Earlier days alone alert about three times as often on a rhythm.
   */
  test.each([
    { name: "a daily rhythm", shape: DAILY },
    { name: "a gentle rhythm", shape: GENTLE },
  ])(
    "$name alerts far more often on earlier days alone",
    (scenario: { shape: Shape }) => {
      const before: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readBefore);
        },
      );
      const alone: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readEarlierDaysAlone);
        },
      );

      expect(alone).toBeGreaterThan(2 * before);
    },
  );

  test.each(SHAPES)(
    "$name alerts about as often as it did, or less",
    (scenario: { shape: Shape }) => {
      const before: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readBefore);
        },
      );
      const now: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readNow);
        },
      );

      expect(now).toBeLessThan(1.5 * before);
    },
  );

  test.each(SHAPES)(
    "$name on a one-minute window, the default of a monitor's query",
    (scenario: { shape: Shape }) => {
      const before: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readBefore, 1);
        },
      );
      const now: number = overSeeds(
        scenario.shape,
        (traffic: Traffic): number => {
          return alertsOf(traffic, readNow, 1);
        },
      );

      expect(now).toBeLessThan(2 * before);
    },
  );

  /*
   * A steady climb sits exactly three standard deviations from two earlier
   * weeks, right on Medium's edge. Today's samples used to pull it inside.
   */
  describe("anything that climbs", () => {
    const climbing: Array<{ name: string; traffic: () => Traffic }> = [
      {
        name: "a disk",
        traffic: (): Traffic => {
          return gaugeOf({ ...DISK, seed: 2718 });
        },
      },
      {
        name: "a counter up for half a year",
        traffic: (): Traffic => {
          return counterOf({
            seed: 2718,
            startsAt: 26 * MINUTES_PER_WEEK * 100,
          });
        },
      },
      {
        name: "a counter from zero",
        traffic: (): Traffic => {
          return counterOf({ seed: 2718 });
        },
      },
    ];

    const firing: (
      traffic: Traffic,
      read: Read,
      sigmaCount?: number,
    ) => number = (
      traffic: Traffic,
      read: Read,
      sigmaCount: number = 3,
    ): number => {
      return shareOf(
        minutesToCheck({ days: 2, every: 7 }).map((now: number): boolean => {
          return fires({ traffic, now, read, sigmaCount });
        }),
      );
    };

    test.each(climbing)(
      "$name fires on most checks on earlier days alone",
      (scenario: { traffic: () => Traffic }) => {
        expect(
          firing(scenario.traffic(), readEarlierDaysAlone),
        ).toBeGreaterThan(0.3);
      },
    );

    test.each(climbing)(
      "$name does not fire now",
      (scenario: { traffic: () => Traffic }) => {
        expect(firing(scenario.traffic(), readNow)).toBe(0);
      },
    );

    test.each(climbing)(
      "$name fires far less at High than it did",
      (scenario: { traffic: () => Traffic }) => {
        const traffic: Traffic = scenario.traffic();

        expect(firing(traffic, readBefore, 2)).toBeGreaterThan(0.2);
        expect(firing(traffic, readNow, 2)).toBeLessThan(
          0.3 * firing(traffic, readBefore, 2),
        );
      },
    );
  });

  /*
   * A deploy that moves a level for good. It used to open an alert every hour
   * for a week. It opens one now, which clears when the new level has entered
   * the earlier weeks.
   */
  test("a level moved for good opens one alert, and it clears within the week", () => {
    const traffic: Traffic = gaugeOf({ ...STEADY, seed: 2069 });
    const step: number = 3 * MINUTES_PER_WEEK + 10 * MINUTES_PER_HOUR;
    const end: number = step + 10 * MINUTES_PER_DAY;

    for (const series of traffic.series) {
      for (let minute: number = step; minute < series.length; minute++) {
        series[minute] = series[minute]! * 1.5;
      }
    }

    for (let minute: number = step; minute < end + 1; minute++) {
      refreshMinute(traffic, minute);
    }

    traffic.hours.clear();

    const verdicts: (read: Read) => Array<boolean> = (
      read: Read,
    ): Array<boolean> => {
      const out: Array<boolean> = [];

      for (let now: number = step; now < end; now++) {
        out.push(fires({ traffic, now, read, direction: "High" }));
      }

      return out;
    };

    const before: Array<boolean> = verdicts(readBefore);
    const now: Array<boolean> = verdicts(remembering(readNow));

    expect(alertsAmong(before)).toBeGreaterThan(150);
    expect(alertsAmong(now)).toBe(1);
    expect(now.slice(0, 6 * MINUTES_PER_DAY).every(Boolean)).toBe(true);
    expect(now.slice(8 * MINUTES_PER_DAY).some(Boolean)).toBe(false);
  });
});

describe("a metric that held one value", () => {
  const moved: (data: {
    traffic: Traffic;
    read: Read;
    factor?: number;
    offset?: number;
    minutes: number;
    series?: Array<number>;
    query?: Query;
  }) => number = (data: {
    traffic: Traffic;
    read: Read;
    factor?: number;
    offset?: number;
    minutes: number;
    series?: Array<number>;
    query?: Query;
  }): number => {
    return caughtOf({ ...data, every: 37 });
  };

  test.each([
    ["1", 1],
    ["0", 0],
    ["0.1, which an average does not quite hold", 0.1],
  ])("%s, staying there, does not fire", (_: string, value: number) => {
    const traffic: Traffic = flatOf(value);

    expect(
      minutesToCheck({ days: 2, every: 7 }).some((now: number): boolean => {
        return fires({ traffic, now, read: readNow });
      }),
    ).toBe(false);
  });

  test("a sum of flat series is not the value they held, and is no change", () => {
    const traffic: Traffic = flatOf(1, 10);

    expect(
      minutesToCheck({ days: 2, every: 7 }).some((now: number): boolean => {
        return fires({ traffic, now, read: readNow, query: { sum: true } });
      }),
    ).toBe(false);
  });

  test("the same sum fires once a series has left the value", () => {
    expect(
      moved({
        traffic: flatOf(1, 10),
        read: readNow,
        factor: 0,
        minutes: 3,
        series: [0],
        query: { sum: true },
      }),
    ).toBeGreaterThan(0.95);
  });

  /*
   * Its own samples used to give such a metric the spread it was judged by,
   * so earlier days alone would never fire on one.
   */
  test("earlier days alone would never have fired on a move", () => {
    expect(
      moved({
        traffic: flatOf(1),
        read: readEarlierDaysAlone,
        factor: 0,
        minutes: 3,
      }),
    ).toBe(0);
  });

  test.each([
    ["1 falling to 0", 1, { factor: 0 }],
    ["100 rising 1%", 100, { factor: 1.01 }],
    ["0 rising to 5", 0, { offset: 5 }],
  ])(
    "%s fires, as it did, and keeps firing, as it did not",
    (
      _: string,
      value: number,
      change: { factor?: number; offset?: number },
    ) => {
      const traffic: Traffic = flatOf(value);

      expect(
        moved({ traffic, read: readBefore, minutes: 3, ...change }),
      ).toBeGreaterThan(0.95);
      expect(
        moved({ traffic, read: readNow, minutes: 3, ...change }),
      ).toBeGreaterThan(0.95);

      expect(
        moved({ traffic, read: readBefore, minutes: 30, ...change }),
      ).toBeLessThan(0.4);
      expect(
        moved({ traffic, read: readNow, minutes: 30, ...change }),
      ).toBeGreaterThan(0.95);
    },
  );
});

describe("a young metric", () => {
  // Traffic that began `days` before a check, and the check.
  const startedDaysBefore: (data: {
    shape: Shape;
    days: number;
    now: number;
  }) => Traffic = (data: {
    shape: Shape;
    days: number;
    now: number;
  }): Traffic => {
    const traffic: Traffic = gaugeOf({ ...data.shape, seed: 2718 });
    const start: number = data.now - data.days * MINUTES_PER_DAY;

    traffic.counts.fill(0, 0, start);
    traffic.sums.fill(0, 0, start);
    traffic.squares.fill(0, 0, start);
    traffic.lows.fill(Infinity, 0, start);
    traffic.highs.fill(-Infinity, 0, start);

    return traffic;
  };

  const now: number = 4 * MINUTES_PER_WEEK + 9 * MINUTES_PER_HOUR;

  /*
   * One week says nothing of how far a week moves. Judged on one, a disk fires
   * on every check.
   */
  test("one earlier week is still learning, where a disk would fire on it", () => {
    const traffic: Traffic = startedDaysBefore({
      shape: DISK,
      days: 10,
      now,
    });

    expect(
      readEarlierDaysAlone({
        traffic,
        hourOfWeek: hourOfWeekOf(now),
        judgedDay: dayOf(now),
        now,
        sigmaCount: 3,
        windowDays: 14,
      }),
    ).not.toBeNull();
    expect(
      fires({ traffic, now, read: readEarlierDaysAlone, direction: "High" }),
    ).toBe(true);
    expect(fires({ traffic, now, read: readNow })).toBe(false);
  });

  test("two earlier weeks are judged", () => {
    const traffic: Traffic = startedDaysBefore({
      shape: STEADY,
      days: 15,
      now,
    });

    expect(
      readNow({
        traffic,
        hourOfWeek: hourOfWeekOf(now),
        judgedDay: dayOf(now),
        now,
        sigmaCount: 3,
        windowDays: 14,
      }),
    ).not.toBeNull();
  });
});

describe("a window that reaches back over midnight", () => {
  /*
   * At 00:02 a 5-minute window holds 23:58 of yesterday, whose hour is
   * yesterday's: it has to be held to the days before yesterday, or the hour
   * being judged is back in its own baseline.
   */
  test("yesterday's last hour is not part of its own baseline", () => {
    const traffic: Traffic = gaugeOf({ ...STEADY, seed: 2718 });
    const midnight: number = 3 * MINUTES_PER_WEEK + 2 * MINUTES_PER_DAY;
    const now: number = midnight + 1;

    const verdict: boolean = withChange({
      traffic,
      end: now + 1,
      minutes: 50,
      factor: 2,
      read: (): boolean => {
        return fires({ traffic, now, read: readNow, direction: "High" });
      },
    });

    expect(verdict).toBe(true);
  });

  test("today's first hour is judged by the days before today", () => {
    const midnight: number = 3 * MINUTES_PER_WEEK + 2 * MINUTES_PER_DAY;
    const hourOfWeek: number = hourOfWeekOf(midnight);

    expect(
      hoursOfCell(hourOfWeek, dayOf(midnight) - 14, dayOf(midnight) - 1),
    ).toEqual([midnight - 2 * MINUTES_PER_WEEK, midnight - MINUTES_PER_WEEK]);
  });
});
