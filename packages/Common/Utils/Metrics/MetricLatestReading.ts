/*
 * A metric monitor that judges each series on its latest reading
 * (judgeLatestReading on an IoT Device monitor's or a Metrics monitor's
 * step): every query's and formula's result keeps only its newest row, so
 * a criteria compares what the series says now, not everything it said in
 * the window. A result with no rows stays empty, so a series that sent
 * nothing in the window is still judged by its no-data policy.
 *
 * Shared by both monitors' workers, which read their windows the same way
 * (MonitorTelemetryMonitor), so "latest" means one thing for both.
 */

interface TimedRow {
  timestamp: Date | string;
}

interface RowsOf<TRow extends TimedRow> {
  data: Array<TRow>;
}

interface SeriesOf<TRow extends TimedRow> {
  aggregatedResults: Array<RowsOf<TRow>>;
}

function timeOf(row: TimedRow): number {
  const time: number = new Date(row.timestamp).getTime();

  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export default class MetricLatestReading {
  /*
   * The result with only its newest row (the first of two stamped alike,
   * which a read grouped by its time buckets never returns). A copy, so the
   * result read from the database is never changed under its other readers.
   */
  public static keepLatestRow<TRow extends TimedRow, T extends RowsOf<TRow>>(
    result: T,
  ): T {
    let latest: TRow | undefined = undefined;

    for (const row of result.data || []) {
      if (!latest || timeOf(row) > timeOf(latest)) {
        latest = row;
      }
    }

    return { ...result, data: latest ? [latest] : [] };
  }

  // Every result of a monitor's read, each with only its newest row.
  public static keepLatestRows<TRow extends TimedRow, T extends RowsOf<TRow>>(
    results: Array<T>,
  ): Array<T> {
    return results.map((result: T): T => {
      return MetricLatestReading.keepLatestRow<TRow, T>(result);
    });
  }

  // A per-series breakdown, each series' results with only their newest row.
  public static keepLatestReadings<
    TRow extends TimedRow,
    T extends SeriesOf<TRow>,
  >(series: Array<T>): Array<T> {
    return series.map((entry: T): T => {
      return {
        ...entry,
        aggregatedResults: MetricLatestReading.keepLatestRows<
          TRow,
          RowsOf<TRow>
        >(entry.aggregatedResults),
      };
    });
  }
}
