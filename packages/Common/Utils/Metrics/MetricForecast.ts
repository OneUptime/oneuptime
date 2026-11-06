import { FilterType } from "../../Types/Monitor/CriteriaFilter";

/**
 * Where a metric is headed: a straight line fitted through one series' data
 * points by least squares, followed past now to the end of a horizon and
 * compared with a threshold. This is what a forecast criteria judges
 * (FilterType.ForecastAbove / ForecastBelow): "this disk is forecast to be
 * above 90% within 7 days", from how it has filled over the last 7 days.
 *
 * The line is the one Prometheus' predict_linear fits, and the one the Ceph
 * pools' Time to Full is read from: the slope is the series' average change
 * per unit of time, and its noise averages out over the window. It is wrong
 * for growth that is not steady - a disk filled in one go by a batch job, a
 * log that is rotated every night - unless the window spans several of
 * those cycles, which is why a forecast reads a long window.
 *
 * A series is forecast only once its data covers half the window, so a
 * host that started reporting an hour ago is not judged from one hour of
 * data, and only while its data is fresh, so a host that stopped reporting
 * is not forecast forever from the trend it had. Fresh is judged by when its
 * data last arrived, when that is known: a series whose data still arrives,
 * late, is forecast from as far as its data reaches.
 */

export interface MetricForecastPoint {
  timeMs: number;
  value: number;
}

// The fitted line: it passes through (meanTimeMs, meanValue) with this slope.
export interface MetricLinearTrend {
  slopePerMs: number;
  meanTimeMs: number;
  meanValue: number;
}

/*
 * - "Forecast": the series was forecast; `isMet` says whether the forecast
 *   passed the threshold.
 * - "Learning": its data does not cover enough of the window to fit a trend
 *   yet.
 * - "Stale": its newest data point is too old to forecast from.
 */
export type MetricForecastState = "Forecast" | "Learning" | "Stale";

export interface MetricForecastResult {
  state: MetricForecastState;
  isMet: boolean;
  // The finite data points the fit read.
  sampleCount: number;
  // From the oldest of them to the newest.
  historyMs: number;
  // The history a forecast needs: half the window.
  requiredHistoryMs: number;
  // From the newest data point to what freshness is measured against.
  sinceNewestMs: number;
  /*
   * Below: set only in the "Forecast" state.
   * The line now - where the trend says the metric is.
   */
  currentValue?: number | undefined;
  // The line at the end of the horizon.
  projectedValue?: number | undefined;
  // How much the line rises in a day: below 0 when it falls.
  slopePerDay?: number | undefined;
  /*
   * How long until the line crosses the threshold: 0 when it is past it
   * already, null when it never does - it is flat, or heading away.
   */
  reachesThresholdInMs?: number | null | undefined;
}

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export default class MetricForecast {
  // The fewest data points a line is fitted through.
  public static readonly MINIMUM_DATA_POINTS: number = 3;

  // How much of the window a series' data must cover to be forecast.
  public static readonly MINIMUM_HISTORY_SHARE: number = 0.5;

  /*
   * A series is stale - its data stopped coming - once its newest data
   * point is older than this share of the window, or than this many data
   * points, whichever is longer. A day's bucket is stamped with the start
   * of the day, so a daily series' newest data point is up to a day old by
   * design.
   */
  public static readonly STALE_AFTER_SHARE: number = 0.05;
  public static readonly STALE_AFTER_DATA_POINTS: number = 3;

  /*
   * With its arrivals known, a series that delivers its data in batches may
   * also go one and a half batches without anything new, as "All Values"
   * allows (WindowCoverage.TOLERANCE_FACTOR).
   */
  public static readonly ARRIVAL_TOLERANCE_FACTOR: number = 1.5;

  /*
   * The least-squares line through the points, or null when there are too
   * few, or they are all at one time and no slope can be read from them.
   * Times are measured from their mean, so epoch milliseconds squared never
   * lose precision.
   */
  public static fitTrend(
    points: Array<MetricForecastPoint>,
  ): MetricLinearTrend | null {
    const finite: Array<MetricForecastPoint> =
      MetricForecast.getFinitePoints(points);

    if (finite.length < MetricForecast.MINIMUM_DATA_POINTS) {
      return null;
    }

    let timeSum: number = 0;
    let valueSum: number = 0;

    for (const point of finite) {
      timeSum += point.timeMs;
      valueSum += point.value;
    }

    const meanTimeMs: number = timeSum / finite.length;
    const meanValue: number = valueSum / finite.length;

    let covariance: number = 0;
    let variance: number = 0;

    for (const point of finite) {
      const time: number = point.timeMs - meanTimeMs;
      covariance += time * (point.value - meanValue);
      variance += time * time;
    }

    if (variance <= 0) {
      return null;
    }

    return {
      slopePerMs: covariance / variance,
      meanTimeMs: meanTimeMs,
      meanValue: meanValue,
    };
  }

  // The line's value at a time.
  public static valueAt(trend: MetricLinearTrend, timeMs: number): number {
    return trend.meanValue + trend.slopePerMs * (timeMs - trend.meanTimeMs);
  }

  public static forecast(input: {
    points: Array<MetricForecastPoint>;
    // The window the points were read over; its end is now.
    windowStartMs: number;
    windowEndMs: number;
    // How far past now the line is followed.
    horizonMs: number;
    threshold: number;
    filterType: FilterType;
    // How long one data point stands for: the width of the time buckets.
    dataPointMs?: number | undefined;
    /*
     * What a series' newest data point is measured against to tell whether
     * it is fresh: the window's end, unless the monitor's data may all
     * arrive late - then its newest data point (MetricMonitorCriteria
     * .judgesFreshnessByNewestData).
     */
    freshnessReferenceMs?: number | undefined;
    /*
     * When the series' data arrived, when that was read (MetricSeriesArrival).
     * It is then stale only once nothing of it has arrived for longer than a
     * series may go quiet - or than one and a half times how often its data
     * arrives, for a source that delivers it in batches - whatever its data
     * points' own times say. sinceNewestMs still says how old the newest data
     * point is.
     */
    arrival?:
      | {
          sinceNewestArrivalMs: number;
          arrivalIntervalMs: number | null;
        }
      | undefined;
  }): MetricForecastResult {
    const points: Array<MetricForecastPoint> = MetricForecast.getFinitePoints(
      input.points,
    );
    const windowMs: number = Math.max(
      0,
      input.windowEndMs - input.windowStartMs,
    );
    const requiredHistoryMs: number =
      windowMs * MetricForecast.MINIMUM_HISTORY_SHARE;

    let oldestMs: number = Number.POSITIVE_INFINITY;
    let newestMs: number = Number.NEGATIVE_INFINITY;

    for (const point of points) {
      oldestMs = Math.min(oldestMs, point.timeMs);
      newestMs = Math.max(newestMs, point.timeMs);
    }

    const historyMs: number = points.length > 0 ? newestMs - oldestMs : 0;
    const freshnessReferenceMs: number =
      input.freshnessReferenceMs ?? input.windowEndMs;
    const sinceNewestMs: number =
      points.length > 0 ? Math.max(0, freshnessReferenceMs - newestMs) : 0;

    const notForecast: (state: MetricForecastState) => MetricForecastResult = (
      state: MetricForecastState,
    ): MetricForecastResult => {
      return {
        state: state,
        isMet: false,
        sampleCount: points.length,
        historyMs: historyMs,
        requiredHistoryMs: requiredHistoryMs,
        sinceNewestMs: sinceNewestMs,
      };
    };

    const trend: MetricLinearTrend | null = MetricForecast.fitTrend(points);

    if (!trend || historyMs < requiredHistoryMs) {
      return notForecast("Learning");
    }

    const staleAfterMs: number = Math.max(
      windowMs * MetricForecast.STALE_AFTER_SHARE,
      (input.dataPointMs || 0) * MetricForecast.STALE_AFTER_DATA_POINTS,
    );

    const arrival:
      | { sinceNewestArrivalMs: number; arrivalIntervalMs: number | null }
      | undefined =
      input.arrival && Number.isFinite(input.arrival.sinceNewestArrivalMs)
        ? input.arrival
        : undefined;

    const isStale: boolean = arrival
      ? arrival.sinceNewestArrivalMs >
        Math.max(
          staleAfterMs,
          (arrival.arrivalIntervalMs || 0) *
            MetricForecast.ARRIVAL_TOLERANCE_FACTOR,
        )
      : sinceNewestMs > staleAfterMs;

    if (isStale) {
      return notForecast("Stale");
    }

    const isAbove: boolean = input.filterType === FilterType.ForecastAbove;
    const currentValue: number = MetricForecast.valueAt(
      trend,
      input.windowEndMs,
    );
    const projectedValue: number = MetricForecast.valueAt(
      trend,
      input.windowEndMs + input.horizonMs,
    );

    return {
      state: "Forecast",
      isMet: isAbove
        ? projectedValue > input.threshold
        : projectedValue < input.threshold,
      sampleCount: points.length,
      historyMs: historyMs,
      requiredHistoryMs: requiredHistoryMs,
      sinceNewestMs: sinceNewestMs,
      currentValue: currentValue,
      projectedValue: projectedValue,
      slopePerDay: trend.slopePerMs * DAY_IN_MS,
      reachesThresholdInMs: MetricForecast.getReachesThresholdInMs({
        currentValue,
        slopePerMs: trend.slopePerMs,
        threshold: input.threshold,
        isAbove,
      }),
    };
  }

  private static getReachesThresholdInMs(data: {
    currentValue: number;
    slopePerMs: number;
    threshold: number;
    isAbove: boolean;
  }): number | null {
    const isPast: boolean = data.isAbove
      ? data.currentValue > data.threshold
      : data.currentValue < data.threshold;

    if (isPast) {
      return 0;
    }

    const isHeadingThere: boolean = data.isAbove
      ? data.slopePerMs > 0
      : data.slopePerMs < 0;

    if (!isHeadingThere) {
      return null;
    }

    return (data.threshold - data.currentValue) / data.slopePerMs;
  }

  private static getFinitePoints(
    points: Array<MetricForecastPoint>,
  ): Array<MetricForecastPoint> {
    return points.filter((point: MetricForecastPoint): boolean => {
      return Number.isFinite(point.timeMs) && Number.isFinite(point.value);
    });
  }
}
