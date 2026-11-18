import OneUptimeDate from "../Date";
import { FilterType } from "./CriteriaFilter";
import TelemetryAlertRuleUtil from "./TelemetryAlertRule";

/*
 * What a telemetry rule would have caught: the count it compares, one
 * window at a time, over the hours before now.
 *
 * A Logs, Traces or Exceptions monitor counts what matched in the last N
 * seconds, every minute. The rule editor shows that count for every
 * window of the same length back from now, beside the threshold, so the
 * person setting the rule sees what is normal and when it would have fired
 * before they save it. The server counts (one ClickHouse read with the
 * monitor's own query, grouped by window); this module says which windows,
 * and reads the answer.
 *
 * Bounded on purpose: at most PREVIEW_WINDOW_COUNT windows, so a one-minute
 * rule reads 2.4 hours back, a five-minute rule 12 hours and a fifteen-minute
 * rule 36 hours, and nothing reads more than MAX_PREVIEW_RANGE_IN_SECONDS.
 *
 * The windows end at now, each a whole window long: the newest is the very
 * count the monitor's next check makes - what matched in the last N seconds
 * - and each before it the N seconds before that. They used to end on the
 * last multiple of their length before now, so that the newest would not be
 * half filled; but that left the window in progress unread, and a service's
 * first logs, younger than one window, were in none of them: the preview
 * said "Nothing matched in this time." beside a Matching logs list that
 * showed them, and the monitor alerted once saved (#7470). Counted back from
 * now, no window is half filled either.
 */

export const PREVIEW_WINDOW_COUNT: number = 144;
export const MAX_PREVIEW_RANGE_IN_SECONDS: number = 7 * 24 * 60 * 60;
export const MIN_PREVIEW_WINDOW_IN_SECONDS: number = 5;
export const MAX_PREVIEW_WINDOW_IN_SECONDS: number = 24 * 60 * 60;

export interface TelemetryRulePreviewRange {
  startTime: Date;
  endTime: Date;
  windowInSeconds: number;
}

// One window's count, as the server answers it.
export interface TelemetryRulePreviewBucket {
  time: string;
  value: number;
}

export interface TelemetryRulePreviewAnswer {
  buckets: Array<TelemetryRulePreviewBucket>;
  windowInSeconds: number;
  startTime: string;
  endTime: string;
}

export interface TelemetryRulePreviewPoint {
  time: Date;
  value: number;
}

export interface TelemetryRulePreviewSummary {
  /*
   * Whether anything matched in any window. Without it there is nothing to
   * judge: the rule's monitor may not have been sending yet.
   */
  hasData: boolean;
  /*
   * How many windows were judged: from the first that held anything, since
   * the windows before it say only that nothing was sending yet.
   */
  windowCount: number;
  // How many of them the rule matches.
  matchedWindowCount: number;
  /*
   * How many times the rule would have started matching: a run of matched
   * windows opens one alert or incident.
   */
  timesItWouldHaveFired: number;
  highest: number;
  lowest: number;
  // The median window: what is normal.
  typical: number;
  // The newest window, up to now: what the monitor's next check counts.
  latest: number | undefined;
}

export default class TelemetryRulePreviewUtil {
  /*
   * The windows to read for a rule whose window is `windowInSeconds`, back
   * from `now`: the newest ends at now, on its whole second, as the windows
   * the server counts start on whole seconds. The window is clamped to what
   * the monitor forms offer.
   */
  public static getRange(data: {
    windowInSeconds: number;
    now: Date;
  }): TelemetryRulePreviewRange {
    const windowInSeconds: number = TelemetryRulePreviewUtil.clampWindow(
      data.windowInSeconds,
    );
    const windowInMs: number = windowInSeconds * 1000;

    const windowCount: number = Math.max(
      1,
      Math.min(
        PREVIEW_WINDOW_COUNT,
        Math.floor(MAX_PREVIEW_RANGE_IN_SECONDS / windowInSeconds),
      ),
    );

    const endMs: number = Math.floor(data.now.getTime() / 1000) * 1000;
    const startMs: number = endMs - windowCount * windowInMs;

    return {
      startTime: new Date(startMs),
      endTime: new Date(endMs),
      windowInSeconds,
    };
  }

  public static clampWindow(windowInSeconds: number): number {
    if (!Number.isFinite(windowInSeconds) || windowInSeconds <= 0) {
      return 60;
    }

    return Math.min(
      MAX_PREVIEW_WINDOW_IN_SECONDS,
      Math.max(MIN_PREVIEW_WINDOW_IN_SECONDS, Math.round(windowInSeconds)),
    );
  }

  /*
   * Every window of the range, in order, with its count: a window the
   * server did not answer for had nothing in it, so it is 0. A count is
   * the window's it falls in, counted from the range's start - the windows
   * end at now, not on a multiple of their length.
   */
  public static toPoints(
    answer: TelemetryRulePreviewAnswer,
  ): Array<TelemetryRulePreviewPoint> {
    const windowInMs: number =
      TelemetryRulePreviewUtil.clampWindow(answer.windowInSeconds) * 1000;
    const startMs: number = OneUptimeDate.fromString(
      answer.startTime,
    ).getTime();
    const endMs: number = OneUptimeDate.fromString(answer.endTime).getTime();

    const counts: Map<number, number> = new Map<number, number>();

    for (const bucket of answer.buckets) {
      const timeMs: number = OneUptimeDate.fromString(bucket.time).getTime();

      if (!Number.isFinite(timeMs)) {
        continue;
      }

      const alignedMs: number =
        startMs + Math.floor((timeMs - startMs) / windowInMs) * windowInMs;
      counts.set(alignedMs, (counts.get(alignedMs) || 0) + (bucket.value || 0));
    }

    const points: Array<TelemetryRulePreviewPoint> = [];

    for (
      let timeMs: number = startMs;
      timeMs < endMs && points.length < PREVIEW_WINDOW_COUNT;
      timeMs += windowInMs
    ) {
      points.push({ time: new Date(timeMs), value: counts.get(timeMs) || 0 });
    }

    return points;
  }

  /*
   * What the rule makes of those windows. An anomaly rule is judged against
   * a baseline the preview does not read, so it matches none here.
   */
  public static summarize(data: {
    points: Array<TelemetryRulePreviewPoint>;
    filterType: FilterType | undefined;
    threshold: number | undefined;
  }): TelemetryRulePreviewSummary {
    const firstWithData: number = data.points.findIndex(
      (point: TelemetryRulePreviewPoint) => {
        return point.value > 0;
      },
    );

    const values: Array<number> =
      firstWithData < 0
        ? []
        : data.points
            .slice(firstWithData)
            .map((point: TelemetryRulePreviewPoint) => {
              return point.value;
            });

    let matchedWindowCount: number = 0;
    let timesItWouldHaveFired: number = 0;
    let wasMatching: boolean = false;

    for (const value of values) {
      const isMatching: boolean = TelemetryRulePreviewUtil.isMatched({
        filterType: data.filterType,
        threshold: data.threshold,
        value,
      });

      if (isMatching) {
        matchedWindowCount++;

        if (!wasMatching) {
          timesItWouldHaveFired++;
        }
      }

      wasMatching = isMatching;
    }

    const sorted: Array<number> = [...values].sort((a: number, b: number) => {
      return a - b;
    });

    return {
      hasData: values.length > 0,
      windowCount: values.length,
      matchedWindowCount,
      timesItWouldHaveFired,
      highest: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
      lowest: sorted.length > 0 ? sorted[0]! : 0,
      typical:
        sorted.length > 0 ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0,
      latest: values.length > 0 ? values[values.length - 1] : undefined,
    };
  }

  public static isMatched(data: {
    filterType: FilterType | undefined;
    threshold: number | undefined;
    value: number;
  }): boolean {
    if (
      !data.filterType ||
      data.threshold === undefined ||
      TelemetryAlertRuleUtil.isAnomaly(data.filterType)
    ) {
      return false;
    }

    return TelemetryAlertRuleUtil.matches({
      filterType: data.filterType,
      threshold: data.threshold,
      value: data.value,
    });
  }

  /*
   * A threshold that would have stayed quiet over the windows read: above
   * the busiest window for a rule that fires on too many, below the
   * quietest for one that fires on too few. Rounded to a number people
   * write. None for an exact value or an anomaly, and none without data:
   * windows that held nothing say nothing about a number, and offering 1
   * for them read as advice to alert on the first log.
   */
  public static suggestThreshold(data: {
    points: Array<TelemetryRulePreviewPoint>;
    filterType: FilterType | undefined;
  }): number | undefined {
    if (data.points.length === 0) {
      return undefined;
    }

    const summary: TelemetryRulePreviewSummary =
      TelemetryRulePreviewUtil.summarize({
        points: data.points,
        filterType: undefined,
        threshold: undefined,
      });

    if (!summary.hasData) {
      return undefined;
    }

    switch (data.filterType) {
      case FilterType.GreaterThan:
        return TelemetryRulePreviewUtil.roundUp(
          Math.max(summary.highest * 1.2, summary.typical * 3, 1),
        );
      case FilterType.GreaterThanOrEqualTo:
        return (
          TelemetryRulePreviewUtil.roundUp(
            Math.max(summary.highest * 1.2, summary.typical * 3, 1),
          ) + 1
        );
      case FilterType.LessThan:
      case FilterType.LessThanOrEqualTo: {
        if (summary.lowest <= 0) {
          return undefined;
        }

        const below: number = Math.floor(summary.lowest / 2);

        return data.filterType === FilterType.LessThan
          ? Math.max(1, below)
          : Math.max(0, below);
      }
      default:
        return undefined;
    }
  }

  /*
   * Up to a number with two significant digits at most: 27.6 is 28, 1480
   * is 1500, 9.2 is 10.
   */
  public static roundUp(value: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    if (value <= 10) {
      return Math.ceil(value);
    }

    const magnitude: number = Math.pow(10, Math.floor(Math.log10(value)) - 1);

    return Math.ceil(value / magnitude) * magnitude;
  }
}
