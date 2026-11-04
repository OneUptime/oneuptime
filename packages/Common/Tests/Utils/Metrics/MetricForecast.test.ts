import MetricForecast, {
  MetricForecastPoint,
  MetricForecastResult,
  MetricLinearTrend,
} from "../../../Utils/Metrics/MetricForecast";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TREND A FORECAST CRITERIA FOLLOWS.
 *
 * A disk that fills up a little every day reaches 90% days after it starts
 * to look worrying, and a threshold on today's value alerts on the day it
 * gets there. A forecast criteria fits a straight line through the window's
 * data points and alerts when the line will be past the threshold at the end
 * of the horizon. These tests pin the line, where it says the metric will
 * be, when it says the metric crosses the threshold, and the cases where no
 * forecast is made: too little history, and data that stopped coming.
 */

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// The evaluation: noon on a Tuesday, so the window ends here.
const NOW: number = Date.UTC(2026, 10, 3, 12, 0, 0);
const WEEK_AGO: number = NOW - 7 * DAY;

// One point an hour across the window, from `from` to the last hour before now.
function hourly(
  value: (hoursAgo: number) => number,
  data: { fromHoursAgo?: number; toHoursAgo?: number } = {},
): Array<MetricForecastPoint> {
  const points: Array<MetricForecastPoint> = [];

  for (
    let hoursAgo: number = data.fromHoursAgo ?? 168;
    hoursAgo >= (data.toHoursAgo ?? 1);
    hoursAgo--
  ) {
    points.push({ timeMs: NOW - hoursAgo * HOUR, value: value(hoursAgo) });
  }

  return points;
}

function forecast(data: {
  points: Array<MetricForecastPoint>;
  threshold: number;
  filterType?: FilterType;
  horizonMs?: number;
  freshnessReferenceMs?: number;
  dataPointMs?: number;
}): MetricForecastResult {
  return MetricForecast.forecast({
    points: data.points,
    windowStartMs: WEEK_AGO,
    windowEndMs: NOW,
    horizonMs: data.horizonMs ?? 7 * DAY,
    threshold: data.threshold,
    filterType: data.filterType ?? FilterType.ForecastAbove,
    dataPointMs: data.dataPointMs ?? HOUR,
    freshnessReferenceMs: data.freshnessReferenceMs,
  });
}

describe("MetricForecast.fitTrend", () => {
  test("a straight line is found exactly", () => {
    // 50% a week ago, rising 1% a day.
    const trend: MetricLinearTrend = MetricForecast.fitTrend(
      hourly((hoursAgo: number) => {
        return 57 - hoursAgo / 24;
      }),
    )!;

    expect(trend.slopePerMs * DAY).toBeCloseTo(1, 9);
    expect(MetricForecast.valueAt(trend, NOW)).toBeCloseTo(57, 9);
    expect(MetricForecast.valueAt(trend, NOW + 3 * DAY)).toBeCloseTo(60, 9);
  });

  test("fewer than three points, or all at one time, fit no line", () => {
    expect(
      MetricForecast.fitTrend([
        { timeMs: NOW - DAY, value: 1 },
        { timeMs: NOW, value: 2 },
      ]),
    ).toBeNull();
    expect(
      MetricForecast.fitTrend([
        { timeMs: NOW, value: 1 },
        { timeMs: NOW, value: 2 },
        { timeMs: NOW, value: 3 },
      ]),
    ).toBeNull();
  });

  test("points that are not numbers are left out of the fit", () => {
    const points: Array<MetricForecastPoint> = hourly((hoursAgo: number) => {
      return 100 - hoursAgo;
    });
    points.push({ timeMs: NOW - HOUR / 2, value: Number.NaN });
    points.push({ timeMs: Number.NaN, value: 5 });
    points.push({ timeMs: NOW, value: Number.POSITIVE_INFINITY });

    const trend: MetricLinearTrend = MetricForecast.fitTrend(points)!;

    expect(trend.slopePerMs * HOUR).toBeCloseTo(1, 9);
  });

  test("bytes in the terabytes at epoch milliseconds lose no precision", () => {
    // 2 TB of a disk, 40 GB more every day.
    const terabyte: number = 1e12;
    const trend: MetricLinearTrend = MetricForecast.fitTrend(
      hourly((hoursAgo: number) => {
        return 2 * terabyte - ((hoursAgo / 24) * 40 * terabyte) / 1000;
      }),
    )!;

    expect((trend.slopePerMs * DAY) / 1e9).toBeCloseTo(40, 6);
  });

  test("noise around the trend averages out over a week", () => {
    const random: SeededRandom = seededRandom(5377);
    // Rising 2% a day, with readings up to 1% either side of the line.
    const trend: MetricLinearTrend = MetricForecast.fitTrend(
      hourly((hoursAgo: number) => {
        return 60 - (2 * hoursAgo) / 24 + (random() - 0.5) * 2;
      }),
    )!;

    expect(Math.abs(trend.slopePerMs * DAY - 2)).toBeLessThan(0.1);
  });
});

describe("MetricForecast.forecast", () => {
  test("a disk rising 1% a day from 85% is forecast past 90% within 7 days, and crosses it in 5", () => {
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 85 - hoursAgo / 24;
      }),
      threshold: 90,
    });

    expect(result.state).toBe("Forecast");
    expect(result.isMet).toBe(true);
    expect(result.currentValue).toBeCloseTo(85, 9);
    expect(result.projectedValue).toBeCloseTo(92, 9);
    expect(result.slopePerDay).toBeCloseTo(1, 9);
    expect(result.reachesThresholdInMs! / DAY).toBeCloseTo(5, 9);
    expect(result.sampleCount).toBe(168);
  });

  test("the same disk is not forecast past 90% within 3 days", () => {
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 85 - hoursAgo / 24;
      }),
      threshold: 90,
      horizonMs: 3 * DAY,
    });

    expect(result.state).toBe("Forecast");
    expect(result.isMet).toBe(false);
    expect(result.projectedValue).toBeCloseTo(88, 9);
    // It still gets there - just not within the horizon.
    expect(result.reachesThresholdInMs! / DAY).toBeCloseTo(5, 9);
  });

  test("a flat or emptying disk never reaches the threshold", () => {
    const flat: MetricForecastResult = forecast({
      points: hourly(() => {
        return 70;
      }),
      threshold: 90,
    });

    expect(flat.isMet).toBe(false);
    expect(flat.reachesThresholdInMs).toBeNull();

    const emptying: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 70 + hoursAgo / 24;
      }),
      threshold: 90,
    });

    expect(emptying.isMet).toBe(false);
    expect(emptying.slopePerDay).toBeCloseTo(-1, 9);
    expect(emptying.reachesThresholdInMs).toBeNull();
  });

  test("a disk past the threshold and still filling is met, and reached already", () => {
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 95 - hoursAgo / 48;
      }),
      threshold: 90,
    });

    expect(result.isMet).toBe(true);
    expect(result.reachesThresholdInMs).toBe(0);
  });

  test("a disk past the threshold but emptying fast enough is not met", () => {
    // 95% now, losing 1% a day: 88% in a week.
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 95 + hoursAgo / 24;
      }),
      threshold: 90,
    });

    expect(result.isMet).toBe(false);
    expect(result.projectedValue).toBeCloseTo(88, 9);
    expect(result.reachesThresholdInMs).toBe(0);
  });

  test("Forecast Below: free space falling 10 GB a day from 100 GB runs under 50 GB within 7 days", () => {
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 100 + (10 * hoursAgo) / 24;
      }),
      threshold: 50,
      filterType: FilterType.ForecastBelow,
    });

    expect(result.isMet).toBe(true);
    expect(result.projectedValue).toBeCloseTo(30, 9);
    expect(result.reachesThresholdInMs! / DAY).toBeCloseTo(5, 9);
  });

  test("Forecast Below is not met by a value that is rising", () => {
    const result: MetricForecastResult = forecast({
      points: hourly((hoursAgo: number) => {
        return 100 - (10 * hoursAgo) / 24;
      }),
      threshold: 50,
      filterType: FilterType.ForecastBelow,
    });

    expect(result.isMet).toBe(false);
    expect(result.reachesThresholdInMs).toBeNull();
  });

  describe("no forecast", () => {
    test("a series with data for less than half the window is still learning", () => {
      // Filling fast, but only for the last 3 days.
      const result: MetricForecastResult = forecast({
        points: hourly(
          (hoursAgo: number) => {
            return 80 - hoursAgo / 4;
          },
          { fromHoursAgo: 72 },
        ),
        threshold: 90,
      });

      expect(result.state).toBe("Learning");
      expect(result.isMet).toBe(false);
      expect(result.historyMs).toBe(71 * HOUR);
      expect(result.requiredHistoryMs).toBe(3.5 * DAY);
      expect(result.projectedValue).toBeUndefined();
    });

    test("half the window is enough", () => {
      const result: MetricForecastResult = forecast({
        points: hourly(
          (hoursAgo: number) => {
            return 80 - hoursAgo / 24;
          },
          { fromHoursAgo: 85 },
        ),
        threshold: 90,
      });

      expect(result.state).toBe("Forecast");
    });

    test("an empty window is learning, with no history", () => {
      const result: MetricForecastResult = forecast({
        points: [],
        threshold: 90,
      });

      expect(result).toEqual({
        state: "Learning",
        isMet: false,
        sampleCount: 0,
        historyMs: 0,
        requiredHistoryMs: 3.5 * DAY,
        sinceNewestMs: 0,
      });
    });

    test("a series whose data stopped coming is stale, not forecast from its old trend", () => {
      // Filled fast, then went quiet a day ago.
      const result: MetricForecastResult = forecast({
        points: hourly(
          (hoursAgo: number) => {
            return 80 - hoursAgo / 12;
          },
          { toHoursAgo: 24 },
        ),
        threshold: 90,
      });

      expect(result.state).toBe("Stale");
      expect(result.isMet).toBe(false);
      expect(result.sinceNewestMs).toBe(24 * HOUR);
    });

    test("data that is only a few buckets old is fresh", () => {
      // 5% of a week is 8.4 hours.
      const result: MetricForecastResult = forecast({
        points: hourly(
          (hoursAgo: number) => {
            return 85 - hoursAgo / 24;
          },
          { toHoursAgo: 8 },
        ),
        threshold: 90,
      });

      expect(result.state).toBe("Forecast");
    });

    test("a daily series is fresh while its newest day is less than three days old", () => {
      const daily: Array<MetricForecastPoint> = [];

      for (let daysAgo: number = 30; daysAgo >= 2; daysAgo--) {
        daily.push({ timeMs: NOW - daysAgo * DAY, value: 60 - daysAgo / 2 });
      }

      const result: MetricForecastResult = MetricForecast.forecast({
        points: daily,
        windowStartMs: NOW - 30 * DAY,
        windowEndMs: NOW,
        horizonMs: 14 * DAY,
        threshold: 60,
        filterType: FilterType.ForecastAbove,
        dataPointMs: DAY,
      });

      expect(result.state).toBe("Forecast");
      expect(result.isMet).toBe(true);
    });

    test("data that arrives late is measured against the monitor's newest data point", () => {
      // Every series 20 hours behind, as a late source's would be.
      const points: Array<MetricForecastPoint> = hourly(
        (hoursAgo: number) => {
          return 85 - hoursAgo / 24;
        },
        { toHoursAgo: 20 },
      );

      expect(forecast({ points, threshold: 90 }).state).toBe("Stale");
      expect(
        forecast({
          points,
          threshold: 90,
          freshnessReferenceMs: NOW - 20 * HOUR,
        }).state,
      ).toBe("Forecast");
    });
  });

  /*
   * With the series' arrivals known (#4912's follow-up), fresh means its data
   * still arrives: a series twenty hours behind by its own time is forecast
   * while its data keeps coming, and one whose data stopped is stale however
   * recent its data points' times look.
   */
  describe("with the series' arrivals known", () => {
    const filling: (hoursAgo: number) => number = (hoursAgo: number): number => {
      return 85 - hoursAgo / 24;
    };

    function forecastArrived(data: {
      points: Array<MetricForecastPoint>;
      sinceNewestArrivalMs: number;
      arrivalIntervalMs?: number | null;
      freshnessReferenceMs?: number;
    }): MetricForecastResult {
      return MetricForecast.forecast({
        points: data.points,
        windowStartMs: WEEK_AGO,
        windowEndMs: NOW,
        horizonMs: 7 * DAY,
        threshold: 90,
        filterType: FilterType.ForecastAbove,
        dataPointMs: HOUR,
        freshnessReferenceMs: data.freshnessReferenceMs,
        arrival: {
          sinceNewestArrivalMs: data.sinceNewestArrivalMs,
          arrivalIntervalMs: data.arrivalIntervalMs ?? null,
        },
      });
    }

    test("data twenty hours behind that still arrives is forecast", () => {
      const result: MetricForecastResult = forecastArrived({
        points: hourly(filling, { toHoursAgo: 20 }),
        sinceNewestArrivalMs: 10 * 60 * 1000,
      });

      expect(result.state).toBe("Forecast");
      // How old its newest data point is, by the window's end, is still said.
      expect(result.sinceNewestMs).toBe(20 * HOUR);
    });

    test("data right up to now that stopped arriving a day ago is stale", () => {
      const result: MetricForecastResult = forecastArrived({
        points: hourly(filling),
        sinceNewestArrivalMs: 24 * HOUR,
      });

      expect(result.state).toBe("Stale");
      expect(result.isMet).toBe(false);
      expect(result.sinceNewestMs).toBe(HOUR);
    });

    test("stale once nothing arrived for longer than the window allows - 5% of a week", () => {
      const points: Array<MetricForecastPoint> = hourly(filling);

      expect(
        forecastArrived({ points, sinceNewestArrivalMs: 8.4 * HOUR }).state,
      ).toBe("Forecast");
      expect(
        forecastArrived({ points, sinceNewestArrivalMs: 8.4 * HOUR + 1 })
          .state,
      ).toBe("Stale");
    });

    test("a source that delivers its data in batches may go one and a half batches without anything new", () => {
      const points: Array<MetricForecastPoint> = hourly(filling);

      // Delivered twice a day: 18 hours of quiet is within one and a half.
      expect(
        forecastArrived({
          points,
          sinceNewestArrivalMs: 18 * HOUR,
          arrivalIntervalMs: 12 * HOUR,
        }).state,
      ).toBe("Forecast");
      expect(
        forecastArrived({
          points,
          sinceNewestArrivalMs: 18 * HOUR + 1,
          arrivalIntervalMs: 12 * HOUR,
        }).state,
      ).toBe("Stale");
    });

    test("the monitor's newest data point is not read: the arrivals decide", () => {
      expect(
        forecastArrived({
          points: hourly(filling, { toHoursAgo: 20 }),
          sinceNewestArrivalMs: 30 * HOUR,
          freshnessReferenceMs: NOW - 20 * HOUR,
        }).state,
      ).toBe("Stale");
    });

    test("too little history is still learning, whatever arrived", () => {
      expect(
        forecastArrived({
          points: hourly(filling, { fromHoursAgo: 30 }),
          sinceNewestArrivalMs: 0,
        }).state,
      ).toBe("Learning");
    });

    test("an arrival that cannot be read leaves the data points' times to decide", () => {
      const result: MetricForecastResult = MetricForecast.forecast({
        points: hourly(filling, { toHoursAgo: 20 }),
        windowStartMs: WEEK_AGO,
        windowEndMs: NOW,
        horizonMs: 7 * DAY,
        threshold: 90,
        filterType: FilterType.ForecastAbove,
        dataPointMs: HOUR,
        arrival: { sinceNewestArrivalMs: Number.NaN, arrivalIntervalMs: null },
      });

      expect(result.state).toBe("Stale");
    });
  });
});
