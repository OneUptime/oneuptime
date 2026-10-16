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
 * that (a metric exported every five minutes).
 *
 * So a brand-new series - a new deployment, host or container - waits until
 * it has data for the whole window, and so does one that was gone and came
 * back, one with a hole of more than one missing point, and one whose
 * newest point is stale.
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

  public static judge(input: {
    window: MetricEvaluationWindow;
    samples: Array<AggregateModel>;
  }): MetricWindowCoverageResult {
    const dataPointMs: number = MetricWindowCoverage.getDataPointMs(
      input.window,
    );

    const readingTimesMs: Array<number> = [];

    for (const sample of input.samples) {
      const timeMs: number | null = MetricWindowCoverage.toMs(
        sample.timestamp,
      );

      if (timeMs !== null) {
        readingTimesMs.push(timeMs);
      }
    }

    /*
     * Never finer than the buckets: two points cannot be closer than one
     * bucket apart. Coarser when the series itself reports less often.
     */
    const intervalMs: number = Math.max(
      dataPointMs,
      WindowCoverage.getTypicalIntervalMs(readingTimesMs) || 0,
    );

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
    });

    return {
      ...coverage,
      windowStartMs: windowStartMs,
      windowEndMs: input.window.endMs,
      configuredWindowMs: input.window.endMs - input.window.startMs,
      dataPointMs: dataPointMs,
      intervalMs: intervalMs,
      isCutByRowLimit: input.window.completeFromMs !== null,
    };
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
