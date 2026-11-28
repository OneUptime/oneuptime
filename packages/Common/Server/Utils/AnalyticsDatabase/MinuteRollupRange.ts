import InBetween from "../../../Types/BaseDatabase/InBetween";

const MINUTE_MS: number = 60 * 1000;

/*
 * A check's window split so a one-minute rollup serves most of it (issue
 * #11373): its whole minutes, [wholeFrom, wholeTo), from the rollup's
 * buckets, and the partial minute at each end - [start, wholeFrom) and
 * [wholeTo, end), either of which may be empty - from the raw rows.
 */
export interface MinuteRollupSplit {
  start: Date;
  wholeFrom: Date;
  wholeTo: Date;
  end: Date;
}

// One stretch of a split read from the raw rows: from `from` up to, not including, `to`.
export interface MinuteRollupEdge {
  from: Date;
  to: Date;
}

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
 * serves a check's window whole only when both its ends are whole minutes -
 * its buckets are then exactly the window, from its start up to its end.
 *
 * Otherwise a window of half an hour or more is split (issue #11373): the
 * rollup serves its whole minutes and the raw rows its two partial ones.
 * A check's window ends at its monitor's own moment, to the millisecond, so
 * its ends are almost never whole minutes, and read whole from the raw rows
 * a long window cost a long read: an ungrouped Host check over the past hour
 * read every point its host's metric had that hour, where the rollup holds
 * sixty rows. A bucket starts at its minute and holds it whole, so the
 * window's whole minutes are exactly the rollup's buckets from `wholeFrom`
 * up to `wholeTo`. Each partial minute is a bucket of its own, partly outside
 * the window, so the raw rows serve it, from the window's start or up to its
 * end. The parts follow on - every instant of the window is in exactly one -
 * so every record in the window is read once, and the one on its end, which
 * belongs to the next check, by none.
 */
export default class MinuteRollupRange {
  /*
   * The shortest check's window that is split. Measured on a busy project
   * (TelemetryMonitorLongWindowsClickhouse: 400 hosts of one series, 10 of
   * 64 series, 1,500 spans a minute), a window under half an hour reads
   * little from the raw rows already, and its two edges' reads read as
   * many rows or a granule more, a few milliseconds slower. From half an
   * hour on the split reads at most what the raw read did and less with
   * every minute: three hours of the dense hosts' metric, 92 thousand rows
   * and 6 MB where the raw read read 691 thousand and 66 MB; of a
   * service's spans, 21 thousand where it read 270 thousand.
   */
  public static readonly MIN_WINDOW_TO_SPLIT_MS: number = 30 * MINUTE_MS;

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

  /*
   * A check's window the rollup cannot serve whole, split into its whole
   * minutes and its partial ones (see above); null for a range the rollup
   * serves whole (canServe), a range it cannot read, and a window shorter
   * than MIN_WINDOW_TO_SPLIT_MS, which the raw rows serve.
   */
  public static split(
    range: InBetween<Date | string | number>,
  ): MinuteRollupSplit | null {
    if (MinuteRollupRange.canServe(range)) {
      return null;
    }

    const startMs: number = new Date(range.startValue).getTime();
    const endMs: number = new Date(range.endValue).getTime();

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs - startMs < MinuteRollupRange.MIN_WINDOW_TO_SPLIT_MS
    ) {
      return null;
    }

    const wholeFromMs: number = Math.ceil(startMs / MINUTE_MS) * MINUTE_MS;
    const wholeToMs: number = Math.floor(endMs / MINUTE_MS) * MINUTE_MS;

    return {
      start: new Date(startMs),
      wholeFrom: new Date(wholeFromMs),
      wholeTo: new Date(wholeToMs),
      end: new Date(endMs),
    };
  }

  // The stretches of a split the raw rows serve: its partial minutes, the empty ones left out.
  public static getEdges(split: MinuteRollupSplit): Array<MinuteRollupEdge> {
    const edges: Array<MinuteRollupEdge> = [];

    if (split.start.getTime() < split.wholeFrom.getTime()) {
      edges.push({ from: split.start, to: split.wholeFrom });
    }

    if (split.wholeTo.getTime() < split.end.getTime()) {
      edges.push({ from: split.wholeTo, to: split.end });
    }

    return edges;
  }

  private static isWholeMinute(value: Date | string | number): boolean {
    const atMs: number = new Date(value).getTime();

    return Number.isFinite(atMs) && atMs % MINUTE_MS === 0;
  }
}
