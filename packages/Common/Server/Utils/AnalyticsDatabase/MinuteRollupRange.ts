import InBetween from "../../../Types/BaseDatabase/InBetween";

const MINUTE_MS: number = 60 * 1000;

/*
 * WHEN A ONE-MINUTE ROLLUP MAY SERVE A RANGE (issue #11334).
 *
 * The span projections (SpanService) and the metric rollups (MetricService:
 * MetricItemAggMV1m and the per-entity ones) keep whole minutes, so a read
 * they serve is rounded to the minute at both ends. That is what a chart or
 * a person's filter asks for, a range that holds both its ends, and it
 * stays as it is.
 *
 * A telemetry check's window (TelemetryCheckWindow) leaves out its end, and
 * is judged exactly: its start is where the check before it ended, its end
 * where the next one starts. Rounded, a 60-second window from 10:00:07 read
 * the whole minutes it touched. A Traces check counted the spans of 10:00 to
 * 10:01:59, so the minute it shared with the next check was counted by both.
 * A Metrics check's rollup read was the one bucket starting inside its
 * window, 10:01 to 10:02, which mostly lies after the window. So a rollup
 * serves a check's window only when both its ends are whole minutes - its
 * buckets are then exactly the window, from its start up to its end - and
 * the raw rows serve it otherwise.
 */
export default class MinuteRollupRange {
  public static canServe(range: InBetween<Date | string | number>): boolean {
    if (range.includesEnd) {
      return true;
    }

    return (
      MinuteRollupRange.isWholeMinute(range.startValue) &&
      MinuteRollupRange.isWholeMinute(range.endValue)
    );
  }

  // How a rollup read compares its bucket with the range's end.
  public static getEndOperator(
    range: InBetween<Date | string | number>,
  ): "<" | "<=" {
    return range.includesEnd ? "<=" : "<";
  }

  private static isWholeMinute(value: Date | string | number): boolean {
    const atMs: number = new Date(value).getTime();

    return Number.isFinite(atMs) && atMs % MINUTE_MS === 0;
  }
}
