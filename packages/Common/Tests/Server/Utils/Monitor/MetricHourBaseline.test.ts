import MetricHourBaseline, {
  MetricBaselineDayRow,
  MetricBaselineSource,
  MetricDataPointCell,
  MetricDataPointDayRow,
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
 * numbers. Nothing here has been measured on real metrics, and a simulation
 * only shows what it was told: the rollup's hours went wrong on a real server
 * for as long as nothing ran there.
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

describe("MetricHourBaseline.toStoredHour", () => {
  /*
   * What a real server stores, seen on one: Tuesday 0..23 up to Sunday
   * 120..143, Monday 232..255, and nothing at all from 144 to 231.
   */
  test("Tuesday is stored first, and Monday wraps past the end of the week", () => {
    expect(MetricHourBaseline.toStoredHour(0)).toBe(232);
    expect(MetricHourBaseline.toStoredHour(9)).toBe(241);
    expect(MetricHourBaseline.toStoredHour(23)).toBe(255);
    expect(MetricHourBaseline.toStoredHour(24)).toBe(0);
    expect(MetricHourBaseline.toStoredHour(167)).toBe(143);
  });

  test("it is the view's arithmetic, at any moment", () => {
    const random: SeededRandom = seededRandom(9417);

    for (let index: number = 0; index < 2000; index++) {
      const time: Date = new Date(
        MONDAY + random(52 * MINUTES_PER_WEEK) * 60000,
      );
      // toDayOfWeek(time, 1): Monday is 0.
      const dayOfWeek: number = (time.getUTCDay() + 6) % 7;
      const stored: number =
        ((((dayOfWeek - 1) * 24 + time.getUTCHours()) % 256) + 256) % 256;

      expect(
        MetricHourBaseline.toStoredHour(
          MetricBaselineService.computeHourOfWeek(time),
        ),
      ).toBe(stored);
    }
  });

  test("every hour of the week has a number of its own, and comes back from it", () => {
    const stored: Set<number> = new Set<number>();

    for (let hour: number = 0; hour < 168; hour++) {
      stored.add(MetricHourBaseline.toStoredHour(hour));

      expect(
        MetricHourBaseline.fromStoredHour(
          MetricHourBaseline.toStoredHour(hour),
        ),
      ).toBe(hour);
    }

    expect(stored.size).toBe(168);
  });
});

describe("MetricHourBaseline.fromStoredHourSql", () => {
  /*
   * The same translation in ClickHouse, for a read that works a row's hour out
   * in SQL (CountWindowBaseline). That ClickHouse makes of it what this says is
   * in MonitorCountBaselineClickhouse.test.ts.
   */
  test("adds a day and keeps what a UInt8 holds, as fromStoredHour does", () => {
    expect(MetricHourBaseline.fromStoredHourSql("hourOfWeek")).toBe(
      "((hourOfWeek + 24) % 256)",
    );
  });

  test("every stored number comes back as its hour of the week, Monday's included", () => {
    for (let hour: number = 0; hour < 168; hour++) {
      const stored: number = MetricHourBaseline.toStoredHour(hour);

      // The SQL's arithmetic, on the number the view stored.
      expect((stored + 24) % 256).toBe(hour);
      expect(MetricHourBaseline.fromStoredHour(stored)).toBe(hour);
    }
  });
});

describe("MetricHourBaseline.getHourStarts", () => {
  test("the hour on each day of the window, the day judged last", () => {
    const starts: Array<string> = MetricHourBaseline.getHourStarts({
      hourOfWeek: 9,
      judgedDay: "2026-11-30",
      windowDays: 14,
    });

    expect(starts).toHaveLength(15);
    expect(starts[0]).toBe("2026-11-16 09:00:00");
    expect(starts[14]).toBe("2026-11-30 09:00:00");
  });

  test("across the end of a month and of the week", () => {
    expect(
      MetricHourBaseline.getHourStarts({
        hourOfWeek: 167,
        judgedDay: "2026-12-01",
        windowDays: 2,
      }),
    ).toEqual([
      "2026-11-29 23:00:00",
      "2026-11-30 23:00:00",
      "2026-12-01 23:00:00",
    ]);
  });
});

describe("MetricHourBaseline.getSource", () => {
  const plain: Parameters<typeof MetricHourBaseline.getSource>[0] = {
    isTotal: false,
    isPercentile: false,
    isDistribution: false,
    isNarrowedByAttributes: false,
    bucketInMinutes: 1,
  };

  test("what is on its samples' scale keeps the hourly rollup's 90 days", () => {
    expect(MetricHourBaseline.getSource(plain)).toBe(
      MetricBaselineSource.Samples,
    );
    expect(MetricHourBaseline.getSource({ ...plain, isPercentile: true })).toBe(
      MetricBaselineSource.Samples,
    );
  });

  test("so does one narrowed by something that cannot be read back", () => {
    expect(
      MetricHourBaseline.getSource({ ...plain, isNarrowedByAttributes: true }),
    ).toBe(MetricBaselineSource.Samples);
  });

  describe("a query narrowed by attributes it can name", () => {
    const narrowed: typeof plain = {
      ...plain,
      isNarrowedByAttributes: true,
      hasScope: true,
    };

    test.each([
      ["an average", {}],
      ["a percentile", { isPercentile: true }],
      ["a total", { isTotal: true }],
      ["an average of a histogram", { isDistribution: true }],
      ["a total of a histogram", { isDistribution: true, isTotal: true }],
    ])("%s reads its own rows", (_: string, data: Partial<typeof plain>) => {
      expect(MetricHourBaseline.getSource({ ...narrowed, ...data })).toBe(
        MetricBaselineSource.Rows,
      );
    });

    test.each([
      ["an average", {}],
      ["a total", { isTotal: true }],
    ])(
      "%s filtered to one entity reads its rollup",
      (_: string, data: Partial<typeof plain>) => {
        expect(
          MetricHourBaseline.getSource({
            ...narrowed,
            ...data,
            hasEntityRollup: true,
          }),
        ).toBe(MetricBaselineSource.EntityRollup);
      },
    );

    test.each([
      ["a percentile", { isPercentile: true }],
      ["anything of a histogram", { isDistribution: true }],
    ])(
      "%s is not in that rollup, which holds sums and counts of plain values",
      (_: string, data: Partial<typeof plain>) => {
        expect(
          MetricHourBaseline.getSource({
            ...narrowed,
            ...data,
            hasEntityRollup: true,
          }),
        ).toBe(MetricBaselineSource.Rows);
      },
    );

    test("a percentile of a histogram still has none: only its buckets say", () => {
      expect(
        MetricHourBaseline.getSource({
          ...narrowed,
          isDistribution: true,
          isPercentile: true,
        }),
      ).toBeNull();
    });

    test.each([
      ["an average keeps the cell", {}, MetricBaselineSource.Samples],
      ["a total has none", { isTotal: true }, null],
    ])(
      "over a data point of more than an hour, %s",
      (
        _: string,
        data: Partial<typeof plain>,
        source: MetricBaselineSource | null,
      ) => {
        expect(
          MetricHourBaseline.getSource({
            ...narrowed,
            ...data,
            bucketInMinutes: 1440,
          }),
        ).toBe(source);
      },
    );
  });

  test("a total of a plain metric is in the minute rollup", () => {
    expect(MetricHourBaseline.getSource({ ...plain, isTotal: true })).toBe(
      MetricBaselineSource.MinuteRollup,
    );
  });

  test.each([
    ["an average", { isDistribution: true }],
    ["a total", { isDistribution: true, isTotal: true }],
  ])(
    "%s of a histogram is in its rows",
    (_: string, data: Partial<typeof plain>) => {
      expect(MetricHourBaseline.getSource({ ...plain, ...data })).toBe(
        MetricBaselineSource.Rows,
      );
    },
  );

  test.each([
    [
      "a total narrowed by an attribute",
      { isTotal: true, isNarrowedByAttributes: true },
    ],
    [
      "a histogram narrowed by an attribute",
      { isDistribution: true, isNarrowedByAttributes: true },
    ],
    [
      "a percentile of a histogram",
      { isDistribution: true, isPercentile: true },
    ],
    ["a total of more than an hour", { isTotal: true, bucketInMinutes: 1440 }],
    [
      "a histogram's data point of more than an hour",
      { isDistribution: true, bucketInMinutes: 1440 },
    ],
  ])("%s has none", (_: string, data: Partial<typeof plain>) => {
    expect(MetricHourBaseline.getSource({ ...plain, ...data })).toBeNull();
  });

  test("a data point of an hour is still inside its hour", () => {
    expect(
      MetricHourBaseline.getSource({
        ...plain,
        isTotal: true,
        bucketInMinutes: 60,
      }),
    ).toBe(MetricBaselineSource.MinuteRollup);
  });
});

describe("MetricHourBaseline.fold", () => {
  const momentsOf: (values: Array<number>) => {
    mean: number;
    variance: number;
  } = (values: Array<number>): { mean: number; variance: number } => {
    const mean: number =
      values.reduce((sum: number, value: number): number => {
        return sum + value;
      }, 0) / values.length;

    return {
      mean,
      variance:
        values.reduce((sum: number, value: number): number => {
          return sum + Math.pow(value - mean, 2);
        }, 0) / values.length,
    };
  };

  const rowFrom: (
    day: number,
    values: Array<number>,
  ) => MetricDataPointDayRow = (
    day: number,
    values: Array<number>,
  ): MetricDataPointDayRow => {
    const { mean, variance } = momentsOf(values);

    return {
      ...rowOf({
        day,
        mean,
        sampleCount: values.length,
        low: Math.min(...values),
        high: Math.max(...values),
      }),
      variance,
      median: mean,
      p95: Math.max(...values),
    };
  };

  test("days merge as the states of a cell do, whatever their sizes", () => {
    const random: SeededRandom = seededRandom(7741);

    for (let round: number = 0; round < 200; round++) {
      const first: Array<number> = new Array<number>(1 + random(60))
        .fill(0)
        .map((): number => {
          return 100 + 40 * random();
        });
      const second: Array<number> = new Array<number>(1 + random(60))
        .fill(0)
        .map((): number => {
          return 300 + 40 * random();
        });
      const cell: MetricDataPointCell = MetricHourBaseline.fold({
        rows: [rowFrom(7, first), rowFrom(14, second)],
        hourOfWeek: HOUR,
        judgedDay: JUDGED_DAY,
      })!;
      const all: { mean: number; variance: number } = momentsOf([
        ...first,
        ...second,
      ]);

      expect(cell.sampleCount).toBe(first.length + second.length);
      expect(cell.mean).toBeCloseTo(all.mean, 9);
      expect(cell.stddev).toBeCloseTo(Math.sqrt(all.variance), 9);
      expect(cell.minObserved).toBe(Math.min(...first, ...second));
      expect(cell.maxObserved).toBe(Math.max(...first, ...second));
    }
  });

  test("what is judged is not what it is judged against", () => {
    const cell: MetricDataPointCell = MetricHourBaseline.fold({
      rows: [rowFrom(14, [100, 100]), rowFrom(21, [9000, 9000])],
      hourOfWeek: HOUR,
      judgedDay: JUDGED_DAY,
    })!;

    expect(cell.mean).toBe(100);
    expect(cell.sampleCount).toBe(2);
  });

  test("other hours of the day are only for the level", () => {
    expect(
      MetricHourBaseline.fold({
        rows: [{ ...rowFrom(13, [100]), hourOfWeek: HOUR + 144 }],
        hourOfWeek: HOUR,
        judgedDay: JUDGED_DAY,
      }),
    ).toBeNull();
  });

  test("nothing earlier is nothing", () => {
    expect(
      MetricHourBaseline.fold({
        rows: [],
        hourOfWeek: HOUR,
        judgedDay: JUDGED_DAY,
      }),
    ).toBeNull();
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

describe("MetricHourBaseline.read of a query's own data points", () => {
  const readDataPointsOf: (
    rows: Array<MetricBaselineDayRow>,
    minSamples?: number,
  ) => MetricHourReading = (
    rows: Array<MetricBaselineDayRow>,
    minSamples: number = 5,
  ): MetricHourReading => {
    return MetricHourBaseline.read({
      rows,
      hourOfWeek: 9,
      judgedDay: dayText(21),
      stddev: 0,
      windowDays: 14,
      minSamples,
      isOfDataPoints: true,
    });
  };

  const earlier: (mean: number, sampleCount?: number) => Array<MetricBaselineDayRow> =
    (mean: number, sampleCount: number = 2): Array<MetricBaselineDayRow> => {
      return [7, 14].map((day: number): MetricBaselineDayRow => {
        return rowOf({
          day,
          hourOfWeek: 9,
          mean,
          sampleCount,
          low: mean,
          high: mean,
        });
      });
    };

  /*
   * A check asks for an hour it holds a data point of, so a metric reporting
   * every half hour, with four earlier data points, does not learn for ever.
   */
  test("the data point being judged counts towards minSamples", () => {
    expect(readDataPointsOf(earlier(10)).isReliable).toBe(true);
    expect(readDataPointsOf(earlier(10), 6).isReliable).toBe(false);
  });

  test("two earlier weeks are still asked for", () => {
    expect(
      readDataPointsOf(earlier(10, 30).slice(1)).isReliable,
    ).toBe(false);
  });

  // Nothing of the hour is read, so nothing can say it has left: any point can.
  test("a history with no spread is held to its value", () => {
    expect(readDataPointsOf(earlier(10)).leftFlatHistory).toBe(true);
  });

  test("a history with a spread is not", () => {
    expect(
      readDataPointsOf([
        rowOf({ day: 7, hourOfWeek: 9, mean: 10, sampleCount: 30 }),
        rowOf({ day: 14, hourOfWeek: 9, mean: 12, sampleCount: 30 }),
      ]).leftFlatHistory,
    ).toBe(false);
  });
});

describe("MetricHourBaseline.keepsWeeksNeeded", () => {
  const rowKept: (day: number, keptDays?: number) => MetricDataPointDayRow = (
    day: number,
    keptDays?: number,
  ): MetricDataPointDayRow => {
    return {
      ...rowOf({ day, hourOfWeek: 9, mean: 1, sampleCount: 60 }),
      variance: 0,
      median: 1,
      p95: 1,
      ...(keptDays !== undefined
        ? {
            keptUntil: `${dayText(day + keptDays)} 09:30:00`,
          }
        : {}),
    };
  };

  test.each([
    ["the 15 days telemetry is kept by default", 15, true],
    ["14 days", 14, true],
    ["a longer retention", 90, true],
    ["13 days", 13, false],
    ["7 days", 7, false],
  ])(
    "%s",
    (_: string, keptDays: number, keeps: boolean) => {
      expect(
        MetricHourBaseline.keepsWeeksNeeded({
          rows: [rowKept(6, keptDays)],
          windowDays: 14,
        }),
      ).toBe(keeps);
    },
  );

  test("the newest row says, for a retention that was changed", () => {
    expect(
      MetricHourBaseline.keepsWeeksNeeded({
        rows: [rowKept(0, 7), rowKept(6, 30), rowKept(3, 7)],
        windowDays: 14,
      }),
    ).toBe(true);
  });

  test("a row that does not say holds nothing back", () => {
    expect(
      MetricHourBaseline.keepsWeeksNeeded({
        rows: [rowKept(6)],
        windowDays: 14,
      }),
    ).toBe(true);
  });

  test("a window of a week asks for a week", () => {
    expect(
      MetricHourBaseline.keepsWeeksNeeded({
        rows: [rowKept(6, 7)],
        windowDays: 7,
      }),
    ).toBe(true);
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

/*
 * What getBaseline reads for a query's own data points, through the code that
 * reads them: the hour on the days before the one judged, and nothing of it.
 */
const readDataPoints: Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  judgedDay: number;
  sigmaCount: number;
  windowDays: number;
}): BaselineBand | null => {
  const hourOfDay: number = data.hourOfWeek % 24;
  const rows: Array<MetricDataPointDayRow> = [];

  for (
    let day: number = Math.max(0, data.judgedDay - data.windowDays);
    day < data.judgedDay;
    day++
  ) {
    const start: number = day * MINUTES_PER_DAY + hourOfDay * MINUTES_PER_HOUR;
    const moments: HourMoments = hourMoments(data.traffic, start);

    if (moments.count > 0) {
      const mean: number = moments.sum / moments.count;

      rows.push({
        day: dayText(day),
        hourOfWeek: hourOfWeekOf(start),
        sampleCount: moments.count,
        mean,
        variance: Math.max(0, moments.square / moments.count - mean * mean),
        median: mean,
        p95: mean,
        minObserved: moments.low,
        maxObserved: moments.high,
      });
    }
  }

  const judgedDay: string = dayText(data.judgedDay);
  const cell: MetricDataPointCell | null = MetricHourBaseline.fold({
    rows,
    hourOfWeek: data.hourOfWeek,
    judgedDay,
  });

  if (!cell) {
    return null;
  }

  const reading: MetricHourReading = MetricHourBaseline.read({
    rows,
    hourOfWeek: data.hourOfWeek,
    judgedDay,
    stddev: cell.stddev,
    windowDays: data.windowDays,
    minSamples: MetricBaselineService.DEFAULT_MIN_SAMPLES,
    isOfDataPoints: true,
  });

  if (!reading.isReliable) {
    return null;
  }

  return MetricBaselineService.getBand({
    baseline: {
      ...cell,
      stddev: reading.stddev,
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

/*
 * A band from one traffic and data points from another: what a query's value
 * is compared with, when it is not on the scale of what it is compared with.
 */
const bandFrom: (cell: Traffic, read: Read) => Read = (
  cell: Traffic,
  read: Read,
): Read => {
  return (data: Parameters<Read>[0]): BaselineBand | null => {
    return read({ ...data, traffic: cell });
  };
};

// One data point a minute, as a traffic of its own: a cell of those points.
const pointsOf: (values: Float64Array) => Traffic = (
  values: Float64Array,
): Traffic => {
  return trafficOf({ series: [values], samplesPerMinute: 1 });
};

const foldEachMinute: (
  traffic: Traffic,
  fold: (minute: number) => number,
) => Float64Array = (
  traffic: Traffic,
  fold: (minute: number) => number,
): Float64Array => {
  return new Float64Array(traffic.series[0]!.length).map(
    (_: number, minute: number): number => {
      return fold(minute);
    },
  );
};

// Alerts a day and the share of checks firing, over a week of checks.
const rateOf: (data: {
  points: Traffic;
  read: Read;
  direction?: Direction;
}) => { perDay: number; firing: number } = (data: {
  points: Traffic;
  read: Read;
  direction?: Direction;
}): { perDay: number; firing: number } => {
  const reading: Read = remembering(data.read);
  const verdicts: Array<boolean> = minutesToCheck({ days: 7 }).map(
    (now: number): boolean => {
      return fires({
        traffic: data.points,
        now,
        read: reading,
        ...(data.direction ? { direction: data.direction } : {}),
      });
    },
  );

  return { perDay: alertsAmong(verdicts) / 7, firing: shareOf(verdicts) };
};

// The mean of a measure over every seed.
const meanOverSeeds: (measure: (seed: number) => number) => number = (
  measure: (seed: number) => number,
): number => {
  return (
    SEEDS.reduce((total: number, seed: number): number => {
      return total + measure(seed);
    }, 0) / SEEDS.length
  );
};

/*
 * What every check read until the rollup's hours were translated. The number a
 * check asked for was stored by the next weekday, so its cell and its rows were
 * that weekday's. A Sunday's number was never stored, and neither the hour's
 * own rows nor any Monday were ever read.
 */
const readNextWeekday: Read = (data: {
  traffic: Traffic;
  hourOfWeek: number;
  judgedDay: number;
  now: number;
  sigmaCount: number;
  windowDays: number;
}): BaselineBand | null => {
  const firstDay: number = data.judgedDay - data.windowDays;
  const hourOfDay: number = data.hourOfWeek % 24;
  const rows: Array<MetricBaselineDayRow> = [];
  const cell: Array<HourMoments> = [];

  for (let day: number = firstDay; day <= data.judgedDay; day++) {
    const start: number = day * MINUTES_PER_DAY + hourOfDay * MINUTES_PER_HOUR;
    const storedAs: number = hourOfWeekOf(start) - 24;

    if (start < 0 || start > data.now || storedAs < 0) {
      continue;
    }

    const moments: HourMoments =
      start + MINUTES_PER_HOUR <= data.now
        ? hourMoments(data.traffic, start)
        : momentsBetween(data.traffic, start, data.now);

    rows.push({
      day: dayText(day),
      hourOfWeek: storedAs,
      sampleCount: moments.count,
      mean: moments.sum / moments.count,
      minObserved: moments.low,
      maxObserved: moments.high,
    });

    if (storedAs === data.hourOfWeek && day < data.judgedDay) {
      cell.push(moments);
    }
  }

  const earlier: { count: number; mean: number; variance: number } =
    merge(cell);

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

  return reading.isReliable
    ? bandOf({
        mean: earlier.mean,
        variance: reading.stddev * reading.stddev,
        sigmaCount: data.sigmaCount,
      })
    : null;
};

describe("the rollup's hours", () => {
  const WEEKLY: Shape = {
    rhythm: 0.4,
    weekend: true,
    wobble: 0.03,
    drift: 0.04,
    noise: 0.03,
  };

  const onDay: (day: number) => number = (day: number): number => {
    return 3 * MINUTES_PER_WEEK + day * MINUTES_PER_DAY;
  };

  // How many of a day's checks fire, on traffic with nothing wrong with it.
  const firingOn: (read: Read, day: number) => number = (
    read: Read,
    day: number,
  ): number => {
    const reading: Read = remembering(read);

    return meanOverSeeds((seed: number): number => {
      const traffic: Traffic = gaugeOf({ ...WEEKLY, seed });
      const checks: Array<number> = [];

      for (let minute: number = 0; minute < MINUTES_PER_DAY; minute += 7) {
        checks.push(onDay(day) + minute);
      }

      return shareOf(
        checks.map((now: number): boolean => {
          return fires({ traffic, now, read: reading });
        }),
      );
    });
  };

  /*
   * The last weekday was judged by the first day of the weekend, when a metric
   * with a weekend is at half of it. Nothing was wrong with those Fridays.
   */
  test("a Friday was judged by a Saturday, and fired for most of the day", () => {
    expect(firingOn(readNextWeekday, 4)).toBeGreaterThan(0.5);
    expect(firingOn(readNow, 4)).toBeLessThan(0.1);
  });

  test("a Sunday had nothing to read: its hours were never stored as asked for", () => {
    const traffic: Traffic = gaugeOf({ ...WEEKLY, seed: 2718 });
    const sunday: number = onDay(6) + 9 * MINUTES_PER_HOUR;

    expect(
      readNextWeekday({
        traffic,
        hourOfWeek: hourOfWeekOf(sunday),
        judgedDay: dayOf(sunday),
        now: sunday,
        sigmaCount: 3,
        windowDays: 14,
      }),
    ).toBeNull();
    expect(
      readNow({
        traffic,
        hourOfWeek: hourOfWeekOf(sunday),
        judgedDay: dayOf(sunday),
        now: sunday,
        sigmaCount: 3,
        windowDays: 14,
      }),
    ).not.toBeNull();
  });

  test("a metric with a weekend alerts less over a week than it did, and sees Sundays", () => {
    const week: (read: Read) => number = (read: Read): number => {
      return meanOverSeeds((seed: number): number => {
        return rateOf({ points: gaugeOf({ ...WEEKLY, seed }), read }).firing;
      });
    };

    expect(week(readNow)).toBeLessThan(0.3 * week(readNextWeekday));
  });
});

describe("a monitor on one service of a project", () => {
  const fleetOf: (data: {
    shape: Shape;
    seed: number;
    bases: Array<number>;
  }) => { fleet: Traffic; watched: Traffic } = (data: {
    shape: Shape;
    seed: number;
    bases: Array<number>;
  }): { fleet: Traffic; watched: Traffic } => {
    const parts: Array<Traffic> = data.bases.map(
      (base: number, index: number): Traffic => {
        return gaugeOf({
          ...data.shape,
          base,
          seed: data.seed + 101 * index,
        });
      },
    );

    return {
      watched: parts[0]!,
      fleet: trafficOf({
        series: parts.flatMap((part: Traffic): Array<Float64Array> => {
          return part.series;
        }),
        withinMinute: parts.flatMap((part: Traffic): Array<Float64Array> => {
          return part.withinMinute;
        }),
      }),
    };
  };

  const SMALL_AMONG_BIG: Array<number> = [10, 100, 120, 80];
  const PEERS: Array<number> = [100, 70, 130, 110];

  /*
   * The spread of a project's cell is mostly the spread between its services,
   * and a small one's value sits far inside it: doubled or halved, it stays in.
   */
  test.each(SHAPES)(
    "$name: a small service was blind in a project of big ones, and sees now",
    (scenario: { shape: Shape }) => {
      const { fleet, watched } = fleetOf({
        shape: scenario.shape,
        seed: 2718,
        bases: SMALL_AMONG_BIG,
      });

      expect(
        caughtOf({
          traffic: fleet,
          read: readNow,
          series: [0],
          query: { series: [0] },
          minutes: 30,
          factor: 2,
          direction: "High",
        }),
      ).toBe(0);
      expect(
        caughtOf({
          traffic: watched,
          read: readNow,
          minutes: 30,
          factor: 2,
          direction: "High",
        }),
      ).toBeGreaterThan(0.95);
    },
  );

  test.each(SHAPES)(
    "$name: a service among its peers sees a halving it could not",
    (scenario: { shape: Shape }) => {
      const { fleet, watched } = fleetOf({
        shape: scenario.shape,
        seed: 3141,
        bases: PEERS,
      });
      const change: { minutes: number; factor: number; direction: Direction } =
        { minutes: 30, factor: 0.5, direction: "Low" };

      expect(
        caughtOf({
          traffic: fleet,
          read: readNow,
          series: [0],
          query: { series: [0] },
          ...change,
        }),
      ).toBeLessThan(0.1);
      expect(
        caughtOf({ traffic: watched, read: readNow, ...change }),
      ).toBeGreaterThan(0.9);
    },
  );

  /*
   * What it costs. A band that no longer holds the other services alerts as
   * often as a project with one service always did: no more, and not none.
   */
  test.each(SHAPES)(
    "$name alerts as a project of one service does",
    (scenario: { shape: Shape }) => {
      const alone: number = meanOverSeeds((seed: number): number => {
        return alertsOf(gaugeOf({ ...scenario.shape, seed }), readNow) / 7;
      });
      const scoped: number = meanOverSeeds((seed: number): number => {
        const { watched } = fleetOf({
          shape: scenario.shape,
          seed,
          bases: PEERS,
        });

        return alertsOf(watched, readNow) / 7;
      });

      expect(scoped).toBeLessThan(5);
      expect(Math.abs(scoped - alone)).toBeLessThan(2);
    },
  );
});

/*
 * What the rollup cannot be narrowed to. It knows the service and no attribute,
 * so a filter on a host used to be judged against every host's samples. Read
 * from its own data points instead, the same host is judged by what it does.
 */
describe("a query narrowed by an attribute", () => {
  const hostsOf: (seed: number, shape?: Shape) => Array<Traffic> = (
    seed: number,
    shape: Shape = FLAT,
  ): Array<Traffic> => {
    const random: SeededRandom = seededRandom(seed);

    return new Array<number>(12).fill(0).map((_: number, index: number) => {
      return gaugeOf({
        ...shape,
        base: 100 * Math.exp(0.5 * normal(random)),
        seed: seed + 101 * index,
      });
    });
  };

  const fleetOf: (hosts: Array<Traffic>) => Traffic = (
    hosts: Array<Traffic>,
  ): Traffic => {
    return trafficOf({
      series: hosts.flatMap((host: Traffic): Array<Float64Array> => {
        return host.series;
      }),
      withinMinute: hosts.flatMap((host: Traffic): Array<Float64Array> => {
        return host.withinMinute;
      }),
    });
  };

  // A host's data points: its samples' average of each minute.
  const pointsOfHost: (host: Traffic) => Traffic = (host: Traffic): Traffic => {
    return pointsOf(
      foldEachMinute(host, (minute: number): number => {
        return host.sums[minute]! / host.counts[minute]!;
      }),
    );
  };

  const middleOf: (hosts: Array<Traffic>) => number = (
    hosts: Array<Traffic>,
  ): number => {
    const levels: Array<number> = hosts.map((host: Traffic): number => {
      return host.sums[0]! / host.counts[0]!;
    });

    return levels.indexOf(
      [...levels].sort((a: number, b: number): number => {
        return a - b;
      })[6]!,
    );
  };

  // The same change to the same host, judged by the fleet and then by itself.
  const caughtBoth: (data: {
    hosts: Array<Traffic>;
    host: number;
    factor: number;
    direction: Direction;
  }) => { fleet: number; own: number } = (data: {
    hosts: Array<Traffic>;
    host: number;
    factor: number;
    direction: Direction;
  }): { fleet: number; own: number } => {
    const change: { minutes: number; factor: number; direction: Direction } = {
      minutes: 30,
      factor: data.factor,
      direction: data.direction,
    };

    return {
      fleet: caughtOf({
        traffic: fleetOf(data.hosts),
        read: readNow,
        series: [data.host],
        query: { series: [data.host] },
        ...change,
      }),
      own: caughtOf({
        traffic: pointsOfHost(data.hosts[data.host]!),
        read: readDataPoints,
        ...change,
      }),
    };
  };

  test("is quiet against the fleet: its cell is wide enough for any of its hosts", () => {
    for (const seed of SEEDS) {
      const hosts: Array<Traffic> = hostsOf(seed);
      const read: Read = bandFrom(fleetOf(hosts), readNow);

      for (const host of hosts) {
        expect(
          rateOf({ points: pointsOfHost(host), read }).firing,
        ).toBeLessThan(0.05);
      }
    }
  });

  test.each(SHAPES)(
    "$name: a middling host doubles inside the fleet's band, and outside its own",
    (scenario: { shape: Shape }) => {
      const hosts: Array<Traffic> = hostsOf(2718, scenario.shape);
      const caught: { fleet: number; own: number } = caughtBoth({
        hosts,
        host: middleOf(hosts),
        factor: 2,
        direction: "High",
      });

      expect(caught.fleet).toBeLessThan(0.2);
      expect(caught.own).toBeGreaterThan(0.95);
    },
  );

  test.each(SHAPES)(
    "$name: no host halves below the fleet's band, and it leaves its own",
    (scenario: { shape: Shape }) => {
      const hosts: Array<Traffic> = hostsOf(3141, scenario.shape);
      const caught: { fleet: number; own: number } = caughtBoth({
        hosts,
        host: middleOf(hosts),
        factor: 0.5,
        direction: "Low",
      });

      expect(caught.fleet).toBe(0);
      expect(caught.own).toBeGreaterThan(0.75);
    },
  );

  /*
   * What it costs. Against the fleet a host hardly alerts, because it hardly
   * can. Against itself it alerts as a project of one service always has: no
   * more, and not none. A monitor grouped by host alerts that often for each.
   */
  test.each(SHAPES)(
    "$name alerts as a project of one service does, one host with another",
    (scenario: { shape: Shape }) => {
      const hosts: Array<Traffic> = hostsOf(2718, scenario.shape);
      const read: Read = bandFrom(fleetOf(hosts), readNow);
      const own: Array<{ perDay: number; firing: number }> = hosts.map(
        (host: Traffic): { perDay: number; firing: number } => {
          const points: Traffic = pointsOfHost(host);

          expect(rateOf({ points, read }).perDay).toBeLessThan(1.5);

          return rateOf({ points, read: readDataPoints });
        },
      );
      const meanOf: (values: Array<number>) => number = (
        values: Array<number>,
      ): number => {
        return (
          values.reduce((sum: number, value: number): number => {
            return sum + value;
          }, 0) / values.length
        );
      };

      expect(
        meanOf(
          own.map((rate: { perDay: number }): number => {
            return rate.perDay;
          }),
        ),
      ).toBeLessThan(5);
      expect(
        meanOf(
          own.map((rate: { firing: number }): number => {
            return rate.firing;
          }),
        ),
      ).toBeLessThan(0.05);

      for (const rate of own) {
        expect(rate.firing).toBeLessThan(0.1);
      }
    },
  );

  test("a disk that climbs does not fire on its own history, and one that jumps does", () => {
    const points: Traffic = pointsOfHost(hostsOf(2718, DISK)[3]!);

    expect(rateOf({ points, read: readDataPoints }).firing).toBe(0);
    expect(
      caughtOf({
        traffic: points,
        read: readDataPoints,
        minutes: 30,
        factor: 1.3,
        direction: "High",
      }),
    ).toBeGreaterThan(0.95);
  });

  describe("a host that held one value", () => {
    test("is left alone while it stays there", () => {
      const traffic: Traffic = flatOf(1);

      expect(
        minutesToCheck({ days: 2, every: 7 }).some((now: number): boolean => {
          return fires({ traffic, now, read: readDataPoints });
        }),
      ).toBe(false);
    });

    test.each([
      ["1 falling to 0", 1, { factor: 0 }],
      ["100 rising 1%", 100, { factor: 1.01 }],
      ["0 rising to 5", 0, { offset: 5 }],
    ])(
      "%s fires, for as long as it lasts",
      (
        _: string,
        value: number,
        change: { factor?: number; offset?: number },
      ) => {
        expect(
          caughtOf({
            traffic: flatOf(value),
            read: readDataPoints,
            minutes: 30,
            ...change,
          }),
        ).toBeGreaterThan(0.95);
      },
    );
  });
});

describe("a query's Sum or Count", () => {
  const FLEETS: Array<{
    name: string;
    seriesCount: number;
    seriesSpread: number;
  }> = [
    {
      name: "one series reporting twice a minute",
      seriesCount: 1,
      seriesSpread: 0,
    },
    { name: "ten series alike", seriesCount: 10, seriesSpread: 0 },
    { name: "ten series far apart", seriesCount: 10, seriesSpread: 0.3 },
  ];

  const sumOf: (traffic: Traffic) => Traffic = (traffic: Traffic): Traffic => {
    return pointsOf(
      foldEachMinute(traffic, (minute: number): number => {
        return traffic.sums[minute]!;
      }),
    );
  };

  describe.each(FLEETS)(
    "$name",
    (fleet: { seriesCount: number; seriesSpread: number }) => {
      const build: (shape: Shape, seed: number) => Traffic = (
        shape: Shape,
        seed: number,
      ): Traffic => {
        return gaugeOf({ ...shape, ...fleet, seed });
      };

      test.each(SHAPES)(
        "$name: a Sum fired on every check against raw samples",
        (scenario: { shape: Shape }) => {
          const traffic: Traffic = build(scenario.shape, 2718);

          expect(
            rateOf({
              points: sumOf(traffic),
              read: bandFrom(traffic, readNow),
            }).firing,
          ).toBe(1);
        },
      );

      test.each(SHAPES)(
        "$name: read from its own data points it alerts like any metric",
        (scenario: { shape: Shape }) => {
          const rate: number = meanOverSeeds((seed: number): number => {
            return rateOf({
              points: sumOf(build(scenario.shape, seed)),
              read: readNow,
            }).perDay;
          });

          expect(rate).toBeLessThan(5);
        },
      );

      test.each(SHAPES)(
        "$name: and it catches a doubling and a halving",
        (scenario: { shape: Shape }) => {
          const traffic: Traffic = sumOf(build(scenario.shape, 3141));

          expect(
            caughtOf({
              traffic,
              read: readNow,
              minutes: 30,
              factor: 2,
              direction: "High",
            }),
          ).toBeGreaterThan(0.95);
          expect(
            caughtOf({
              traffic,
              read: readNow,
              minutes: 30,
              factor: 0.5,
              direction: "Low",
            }),
          ).toBeGreaterThan(0.75);
        },
      );
    },
  );

  /*
   * What was tried first. The cell scaled by how many samples a minute holds
   * needs no other table, and it is only right for series that are alike: their
   * spread between series is in the cell, and it scales with them. Scaled by
   * the root of that instead, as chance would, a fleet that moves together
   * floods.
   */
  describe("the samples' cell, scaled", () => {
    const readScaled: (data: {
      cell: Traffic;
      power: number;
    }) => Read = (data: { cell: Traffic; power: number }): Read => {
      return (input: Parameters<Read>[0]): BaselineBand | null => {
        const samples: number =
          data.cell.samplesPerMinute * data.cell.series.length;
        const band: BaselineBand | null = readNow({
          ...input,
          traffic: data.cell,
        });

        if (!band) {
          return null;
        }

        const middle: number = (band.expectedHigh + band.expectedLow) / 2;
        const half: number = (band.expectedHigh - band.expectedLow) / 2;

        return {
          expectedHigh: middle * samples + half * Math.pow(samples, data.power),
          expectedLow: middle * samples - half * Math.pow(samples, data.power),
        };
      };
    };

    test("by how many there are, it cannot see a doubling of series far apart", () => {
      const cell: Traffic = gaugeOf({
        ...DAILY,
        seed: 2718,
        seriesCount: 10,
        seriesSpread: 0.3,
      });
      const sum: Traffic = sumOf(cell);
      const fresh: {
        traffic: Traffic;
        minutes: number;
        factor: number;
        direction: Direction;
      } = { traffic: sum, minutes: 3, factor: 1.3, direction: "High" };

      expect(
        caughtOf({
          ...fresh,
          read: readScaled({ cell, power: 1 }),
        }),
      ).toBe(0);
      expect(caughtOf({ ...fresh, read: readNow })).toBeGreaterThan(0.5);
    });

    test("by its root, ten series that move together flood", () => {
      const cell: Traffic = gaugeOf({ ...DAILY, seed: 2718, seriesCount: 10 });

      expect(
        rateOf({
          points: sumOf(cell),
          read: readScaled({ cell, power: 0.5 }),
        }).firing,
      ).toBeGreaterThan(0.4);
    });
  });

  /*
   * A Count is how many samples a minute holds: flat on a steady fleet, and
   * nothing to do with the values in the cell.
   */
  describe("a Count", () => {
    const countOf: (traffic: Traffic) => Traffic = (
      traffic: Traffic,
    ): Traffic => {
      return pointsOf(
        foldEachMinute(traffic, (minute: number): number => {
          return traffic.counts[minute]!;
        }),
      );
    };

    test.each(SHAPES)(
      "$name fired on every check against raw samples",
      (scenario: { shape: Shape }) => {
        const traffic: Traffic = gaugeOf({
          ...scenario.shape,
          seed: 2718,
          seriesCount: 10,
        });

        expect(
          rateOf({
            points: countOf(traffic),
            read: bandFrom(traffic, readNow),
          }).firing,
        ).toBeGreaterThan(0.9);
      },
    );

    test("a steady fleet's is flat, and is left alone", () => {
      const points: Traffic = countOf(
        gaugeOf({ ...FLAT, seed: 2718, seriesCount: 10 }),
      );

      expect(rateOf({ points, read: readNow }).firing).toBe(0);
    });

    test("and fires when a series goes away", () => {
      const points: Traffic = countOf(
        gaugeOf({ ...FLAT, seed: 2718, seriesCount: 10 }),
      );

      expect(
        caughtOf({
          traffic: points,
          read: readNow,
          minutes: 3,
          factor: 0.9,
          direction: "Low",
        }),
      ).toBeGreaterThan(0.95);
    });
  });
});

/*
 * A histogram's datapoint holds `count` observations and their sum. The cell
 * folds the sums, and a query's average is sum(sum) / sum(count).
 */
describe("a histogram", () => {
  interface Histogram {
    // The cell: each datapoint's sum.
    sums: Traffic;
    average: Traffic;
    observations: Traffic;
  }

  const histogramOf: (data: {
    shape: Shape;
    seed: number;
    seriesCount?: number;
    latencySpread?: number;
  }) => Histogram = (data: {
    shape: Shape;
    seed: number;
    seriesCount?: number;
    latencySpread?: number;
  }): Histogram => {
    const seriesCount: number = data.seriesCount ?? 1;
    const latency: Traffic = gaugeOf({
      ...data.shape,
      seed: data.seed,
      base: 250,
      seriesCount,
      seriesSpread: data.latencySpread ?? 0,
    });
    const rate: Traffic = gaugeOf({
      rhythm: 0.4,
      weekend: true,
      wobble: 0.03,
      drift: 0.05,
      noise: 0.02,
      seed: data.seed + 7,
      base: 300,
      seriesCount,
      seriesSpread: 0.5,
    });
    const sums: Array<Float64Array> = latency.series.map(
      (values: Float64Array, index: number): Float64Array => {
        return values.map((value: number, minute: number): number => {
          return value * rate.series[index]![minute]!;
        });
      },
    );
    const total: (series: Array<Float64Array>, minute: number) => number = (
      series: Array<Float64Array>,
      minute: number,
    ): number => {
      return series.reduce((sum: number, values: Float64Array): number => {
        return sum + values[minute]!;
      }, 0);
    };

    return {
      sums: trafficOf({ series: sums, samplesPerMinute: 1 }),
      average: pointsOf(
        foldEachMinute(latency, (minute: number): number => {
          return total(sums, minute) / total(rate.series, minute);
        }),
      ),
      observations: pointsOf(
        foldEachMinute(rate, (minute: number): number => {
          return total(rate.series, minute);
        }),
      ),
    };
  };

  describe("one series", () => {
    /*
     * The band sits at a sum of hundreds of observations, far above any one of
     * them, and its spread is the traffic's.
     */
    test.each(SHAPES)(
      "$name: Anomalous fired on nearly every check, and Anomalously High on none",
      (scenario: { shape: Shape }) => {
        const histogram: Histogram = histogramOf({
          shape: scenario.shape,
          seed: 2718,
        });
        const read: Read = bandFrom(histogram.sums, readNow);

        expect(
          rateOf({ points: histogram.average, read }).firing,
        ).toBeGreaterThan(0.9);
        expect(
          caughtOf({
            traffic: histogram.average,
            read,
            minutes: 30,
            factor: 2,
            direction: "High",
          }),
        ).toBe(0);
      },
    );

    test("so did its Count", () => {
      const histogram: Histogram = histogramOf({ shape: FLAT, seed: 2718 });

      expect(
        rateOf({
          points: histogram.observations,
          read: bandFrom(histogram.sums, readNow),
        }).firing,
      ).toBeGreaterThan(0.9);
    });
  });

  describe("routes far apart", () => {
    const routes: { seriesCount: number; latencySpread: number } = {
      seriesCount: 6,
      latencySpread: 0.6,
    };

    /*
     * The cell of sums, or of each datapoint's mean, is mostly the spread
     * between routes. So the one thing a rollup could be changed to fold does
     * not help here, and the average of a service is not its routes' average.
     */
    test.each(SHAPES)(
      "$name: nothing moved it out of the cell",
      (scenario: { shape: Shape }) => {
        const histogram: Histogram = histogramOf({
          shape: scenario.shape,
          seed: 2718,
          ...routes,
        });

        expect(
          caughtOf({
            traffic: histogram.average,
            read: bandFrom(histogram.sums, readNow),
            minutes: 30,
            factor: 2,
            direction: "High",
          }),
        ).toBe(0);
      },
    );
  });

  describe.each([
    { name: "one series", seriesCount: 1, latencySpread: 0 },
    { name: "routes far apart", seriesCount: 6, latencySpread: 0.6 },
  ])(
    "read from its own data points, $name",
    (fleet: { seriesCount: number; latencySpread: number }) => {
      test.each(SHAPES)(
        "$name alerts like any metric",
        (scenario: { shape: Shape }) => {
          const rate: number = meanOverSeeds((seed: number): number => {
            return rateOf({
              points: histogramOf({ shape: scenario.shape, seed, ...fleet })
                .average,
              read: readNow,
            }).perDay;
          });

          expect(rate).toBeLessThan(6);
        },
      );

      test.each(SHAPES)(
        "$name catches its latency doubling, and halving",
        (scenario: { shape: Shape }) => {
          const { average } = histogramOf({
            shape: scenario.shape,
            seed: 3141,
            ...fleet,
          });

          expect(
            caughtOf({
              traffic: average,
              read: readNow,
              minutes: 30,
              factor: 2,
              direction: "High",
            }),
          ).toBeGreaterThan(0.95);
          expect(
            caughtOf({
              traffic: average,
              read: readNow,
              minutes: 30,
              factor: 0.5,
              direction: "Low",
            }),
          ).toBeGreaterThan(0.75);
        },
      );

      test("its Count alerts like any metric, and sees traffic halve", () => {
        const { observations } = histogramOf({
          shape: FLAT,
          seed: 3141,
          ...fleet,
        });

        expect(
          rateOf({ points: observations, read: readNow }).perDay,
        ).toBeLessThan(5);
        expect(
          caughtOf({
            traffic: observations,
            read: readNow,
            minutes: 30,
            factor: 0.5,
            direction: "Low",
          }),
        ).toBeGreaterThan(0.75);
      });
    },
  );
});

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
