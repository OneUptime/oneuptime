import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../../../Types/Date";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import WindowCoverage, {
  WindowCoverageResult,
  WindowCoverageShortfall,
} from "./WindowCoverage";

// The evaluation window a metric monitor's data was read over.
export interface MetricEvaluationWindow {
  startMs: number;
  endMs: number;
  /*
   * When a read was cut at its row limit it holds only the newest rows, so
   * the data is complete only from here (MetricMonitorResponse
   * .dataCompleteFrom). Null when every read was whole.
   */
  completeFromMs: number | null;
}

export interface MetricWindowCoverageResult extends WindowCoverageResult {
  // The window the series was judged over: its start moved up to completeFromMs.
  windowStartMs: number;
  windowEndMs: number;
  // The configured window's length, whatever could be read of it.
  configuredWindowMs: number;
  // How long one data point stands for: the width of the time buckets.
  dataPointMs: number;
  // The cadence the series was judged against.
  intervalMs: number;
  // The data could not be read back to the start of the configured window.
  isCutByRowLimit: boolean;
  /*
   * No series of the monitor has two data points in the window, so nothing
   * showed how often the metric reports, and this series' only data point -
   * inside the window, not at either edge of it - was taken to cover it.
   */
  isLoneDataPoint: boolean;
}

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

/**
 * Whether one metric series' data points cover its monitor's window: what
 * "All Values" over a metric monitor's time range needs before it can say
 * the condition held for the whole range (issue #4793).
 *
 * The data points are time buckets - a minute each for a range of up to
 * three hours - each stamped with the start of its bucket. A series covers
 * the window when its points reach from the start of the window to its end
 * with no hole wider than its cadence allows, by the rule WindowCoverage
 * holds for every over-time window. Its cadence is the bucket width, or the
 * gap between its points most of the time when it reports less often than
 * that (a metric exported every five minutes). A series with too few points
 * to show its own cadence goes by how often the monitor's other series
 * report.
 *
 * So a brand-new series - a new deployment, host or container - waits until
 * it has data for the whole window, and so does one that was gone and came
 * back, one with a hole of more than one missing point, and one whose
 * newest point is stale: too far before the end of the window or - for a
 * monitor whose data may all arrive late - before the monitor's newest
 * data point.
 */
export default class MetricWindowCoverage {
  /*
   * The window of a metric monitor's response. Null when the response does
   * not say - a payload from before windows were recorded - in which case
   * nothing can be judged against it.
   */
  public static getWindow(
    response: MetricMonitorResponse | undefined,
  ): MetricEvaluationWindow | null {
    const window: { startValue?: unknown; endValue?: unknown } | undefined =
      response?.startAndEndDate as unknown as
        | { startValue?: unknown; endValue?: unknown }
        | undefined;

    const startMs: number | null = MetricWindowCoverage.toMs(
      window?.startValue,
    );
    const endMs: number | null = MetricWindowCoverage.toMs(window?.endValue);

    if (startMs === null || endMs === null || endMs <= startMs) {
      return null;
    }

    const completeFromMs: number | null = MetricWindowCoverage.toMs(
      response?.dataCompleteFrom,
    );

    return {
      startMs: startMs,
      endMs: endMs,
      completeFromMs:
        completeFromMs !== null && completeFromMs > startMs
          ? Math.min(completeFromMs, endMs)
          : null,
    };
  }

  // How long one data point stands for over a window: its bucket width.
  public static getDataPointMs(window: MetricEvaluationWindow): number {
    return AggregationIntervalUtil.getAggregationIntervalMs(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: new Date(window.startMs),
        endDate: new Date(window.endMs),
      }),
    );
  }

  /*
   * How often a monitor's series report, as far as the window shows it: the
   * lower median of the gaps between consecutive data points of every
   * series, pooled. It is the cadence of a series that has too few data
   * points to show its own. Null when no series has two data points in the
   * window - its time range is then no longer than the metric's reporting
   * interval.
   */
  public static getMonitorIntervalMs(
    seriesSamples: Array<Array<AggregateModel>>,
  ): number | null {
    const gapsMs: Array<number> = [];

    for (const samples of seriesSamples) {
      gapsMs.push(
        ...WindowCoverage.getGapsMs(MetricWindowCoverage.getTimesMs(samples)),
      );
    }

    return WindowCoverage.getTypicalGapMs(gapsMs);
  }

  /*
   * The newest data point of any of a monitor's series: as far as its data
   * reaches. Null when no series has one.
   */
  public static getNewestDataPointMs(
    seriesSamples: Array<Array<AggregateModel>>,
  ): number | null {
    let newestMs: number | null = null;

    for (const samples of seriesSamples) {
      for (const timeMs of MetricWindowCoverage.getTimesMs(samples)) {
        if (newestMs === null || timeMs > newestMs) {
          newestMs = timeMs;
        }
      }
    }

    return newestMs;
  }

  public static judge(input: {
    window: MetricEvaluationWindow;
    samples: Array<AggregateModel>;
    /*
     * How often the monitor's series report (getMonitorIntervalMs), for a
     * series with too few data points to show its own cadence; null when
     * no series shows one. Left out, the series is judged on its own data
     * alone.
     */
    monitorIntervalMs?: number | null | undefined;
    /*
     * The newest data point of any of the monitor's series
     * (getNewestDataPointMs), for a monitor whose data may all arrive late:
     * the series' newest data point must then be close enough to it, not
     * to the end of the window. Left out, it must be close enough to the
     * end of the window.
     */
    monitorNewestDataPointMs?: number | null | undefined;
  }): MetricWindowCoverageResult {
    const dataPointMs: number = MetricWindowCoverage.getDataPointMs(
      input.window,
    );

    const readingTimesMs: Array<number> = MetricWindowCoverage.getTimesMs(
      input.samples,
    );

    const ownGapsMs: Array<number> = WindowCoverage.getGapsMs(readingTimesMs);

    /*
     * A series goes by its own cadence once it has two gaps to go by: the
     * lower median of two is the shorter, so a hole cannot pass for the
     * cadence. With fewer - a series that only just appeared, or one whose
     * two data points straddle a hole - it goes by how often the monitor's
     * series report together: among deployments reporting every minute,
     * one recreated under an old name 13 minutes after the old one went
     * does not pass for one that reports every 13 minutes.
     */
    let cadenceMs: number = 0;

    if (ownGapsMs.length >= 2) {
      cadenceMs = WindowCoverage.getTypicalGapMs(ownGapsMs) || 0;
    } else if (typeof input.monitorIntervalMs === "number") {
      cadenceMs = input.monitorIntervalMs;
    } else {
      cadenceMs = WindowCoverage.getTypicalGapMs(ownGapsMs) || 0;
    }

    /*
     * Never finer than the buckets: two points cannot be closer than one
     * bucket apart. Coarser when the series itself reports less often.
     */
    const intervalMs: number = Math.max(dataPointMs, cadenceMs);

    const windowStartMs: number =
      input.window.completeFromMs !== null
        ? input.window.completeFromMs
        : input.window.startMs;

    const coverage: WindowCoverageResult = WindowCoverage.judge({
      windowStartMs: windowStartMs,
      windowEndMs: input.window.endMs,
      readingTimesMs: readingTimesMs,
      intervalMs: intervalMs,
      readingSpanMs: dataPointMs,
      holesBreakCoverage: true,
      /*
       * Where the monitor's data reaches - its newest data point's bucket
       * end - when its data may all arrive late. Against that, a series
       * whose data stopped while the others' kept coming is still stale;
       * one that is merely as late as all of them is not.
       */
      freshAsOfMs:
        typeof input.monitorNewestDataPointMs === "number"
          ? input.monitorNewestDataPointMs + dataPointMs
          : undefined,
    });

    const result: MetricWindowCoverageResult = {
      ...coverage,
      windowStartMs: windowStartMs,
      windowEndMs: input.window.endMs,
      configuredWindowMs: input.window.endMs - input.window.startMs,
      dataPointMs: dataPointMs,
      intervalMs: intervalMs,
      isCutByRowLimit: input.window.completeFromMs !== null,
      isLoneDataPoint: false,
    };

    /*
     * When no series of the monitor has two data points in the window, its
     * time range is no longer than the metric's reporting interval - a
     * VMware collector reading every 5 minutes, or an IoT device waking
     * every 10, watched over 5 minutes - and nothing shows how often a
     * series reports, or whether it is new. Waiting for coverage would wait
     * for ever, so a lone data point is judged on its value, as before,
     * while it sits inside the window: not while it is among the newest
     * (not yet stale), where its series may only just have started, and
     * not in the window's first data point's width, where it is the last
     * data point of a series that stopped, about to leave the window.
     */
    if (
      input.monitorIntervalMs === null &&
      ownGapsMs.length === 0 &&
      coverage.shortfall === WindowCoverageShortfall.Stale &&
      coverage.runStartMs !== null &&
      coverage.runStartMs - windowStartMs >= dataPointMs
    ) {
      return {
        ...result,
        isCovered: true,
        shortfall: null,
        isLoneDataPoint: true,
      };
    }

    return result;
  }

  // Each data point's time in milliseconds, leaving out unreadable ones.
  private static getTimesMs(samples: Array<AggregateModel>): Array<number> {
    const timesMs: Array<number> = [];

    for (const sample of samples) {
      const timeMs: number | null = MetricWindowCoverage.toMs(sample.timestamp);

      if (timeMs !== null) {
        timesMs.push(timeMs);
      }
    }

    return timesMs;
  }

  /*
   * How far the series has got, as the evaluation log says it: "Waiting for
   * 15 minutes of data: 2 of 15 minutes so far."
   */
  public static describeWait(coverage: MetricWindowCoverageResult): string {
    const windowMs: number = coverage.windowEndMs - coverage.windowStartMs;
    const window: string = MetricWindowCoverage.describeDuration(windowMs);

    let progress: string;

    if (coverage.shortfall === WindowCoverageShortfall.Stale) {
      progress = `no new data point for the last ${MetricWindowCoverage.describeDuration(
        coverage.sinceNewestReadingMs || 0,
      )}`;
    } else {
      const coveredMs: number =
        coverage.runStartMs !== null && coverage.runEndMs !== null
          ? Math.max(0, coverage.runEndMs - coverage.runStartMs)
          : 0;

      progress = `${MetricWindowCoverage.describeShareOf({
        partMs: coveredMs,
        wholeMs: windowMs,
      })} so far`;

      if (
        coverage.shortfall === WindowCoverageShortfall.Hole &&
        coverage.holeBeforeRunMs !== null
      ) {
        progress += `, since a ${MetricWindowCoverage.describeGap(
          coverage.holeBeforeRunMs,
        )} gap in its data`;
      }
    }

    let message: string = `Waiting for ${window} of data: ${progress}.`;

    if (coverage.isCutByRowLimit) {
      message += ` Only the newest ${window} of the ${MetricWindowCoverage.describeGap(
        coverage.configuredWindowMs,
      )} time range could be read: it holds more data points than one check reads.`;
    }

    return message;
  }

  /*
   * "2 of 15 minutes" when both read in one unit, "45 minutes of 2 hours"
   * when they do not.
   */
  private static describeShareOf(data: {
    partMs: number;
    wholeMs: number;
  }): string {
    if (data.partMs < MINUTE_IN_MS) {
      return `less than a minute of ${MetricWindowCoverage.describeDuration(data.wholeMs)}`;
    }

    const unitMs: number = MetricWindowCoverage.getUnitMs(
      MetricWindowCoverage.toUnit(data.wholeMs).unit,
    );
    const partInWholeUnit: number = Math.floor(data.partMs / unitMs);

    if (partInWholeUnit >= 1) {
      return `${partInWholeUnit} of ${MetricWindowCoverage.describeDuration(data.wholeMs)}`;
    }

    return `${MetricWindowCoverage.describeDuration(data.partMs)} of ${MetricWindowCoverage.describeDuration(data.wholeMs)}`;
  }

  // 15 minutes, 1 minute, 2 hours, 7 days; less than a minute below one.
  public static describeDuration(milliseconds: number): string {
    if (milliseconds < MINUTE_IN_MS) {
      return "less than a minute";
    }

    const { count, unit } = MetricWindowCoverage.toUnit(milliseconds);

    return `${count} ${count === 1 ? unit : `${unit}s`}`;
  }

  // 4-minute, as in "a 4-minute gap"; 2-hour, 3-day.
  private static describeGap(milliseconds: number): string {
    if (milliseconds < MINUTE_IN_MS) {
      return "1-minute";
    }

    const { count, unit } = MetricWindowCoverage.toUnit(milliseconds);

    return `${count}-${unit}`;
  }

  /*
   * A length in the largest unit it fills at least twice, so 90 minutes
   * stays "90 minutes" and 2 hours reads "2 hours". Whole units, rounded
   * down.
   */
  private static toUnit(milliseconds: number): { count: number; unit: string } {
    if (milliseconds >= 2 * DAY_IN_MS) {
      return { count: Math.floor(milliseconds / DAY_IN_MS), unit: "day" };
    }

    if (milliseconds >= 2 * HOUR_IN_MS) {
      return { count: Math.floor(milliseconds / HOUR_IN_MS), unit: "hour" };
    }

    return {
      count: Math.max(1, Math.floor(milliseconds / MINUTE_IN_MS)),
      unit: "minute",
    };
  }

  private static getUnitMs(unit: string): number {
    if (unit === "day") {
      return DAY_IN_MS;
    }

    if (unit === "hour") {
      return HOUR_IN_MS;
    }

    return MINUTE_IN_MS;
  }

  private static toMs(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (value instanceof Date) {
      const time: number = value.getTime();
      return Number.isFinite(time) ? time : null;
    }

    if (typeof value === "string") {
      try {
        const time: number = OneUptimeDate.fromString(value).getTime();
        return Number.isFinite(time) ? time : null;
      } catch {
        return null;
      }
    }

    return null;
  }
}
