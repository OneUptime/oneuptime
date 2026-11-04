/*
 * When a metric series' data arrived at OneUptime, beside the time each data
 * point says it measured.
 *
 * Every metric row carries both: `time`, the moment its source says it took
 * the reading, and `createdAt`, the second OneUptime's ingest wrote the row
 * (getIngestionStamp in OtelMetricsIngestService, and every other writer of
 * the Metric table). The two are seconds apart for a collector that sends
 * what it reads as it reads it. They are minutes apart for a source that is
 * late by design (CloudWatch's receiver reads periods ten minutes old), for a
 * collector whose clock runs behind, and while a collector catches up.
 *
 * By `time` alone a late series and a stopped one look the same: both have
 * no data point near now. By `createdAt` they do not - a late series' rows
 * keep arriving. So "All Values" and the forecasts judge whether a series
 * went stale by when its data last arrived (MetricWindowCoverage), and judge
 * its window as far as its data reaches.
 *
 * The telemetry worker reads these from the Metric table when a series looks
 * behind (MetricService.readSeriesArrivals), and hands them to the evaluator
 * as durations measured when it read them, so the evaluator never reads a
 * clock of its own for them.
 */
export default interface MetricSeriesArrival {
  /*
   * How long before the read nothing new of the series had arrived: the read
   * time minus the newest createdAt of its rows in the window. The series'
   * staleness.
   */
  sinceNewestArrivalMs: number;
  /*
   * How long after its own time the series' newest data point arrived: its
   * row's createdAt minus its time. The series' lag. 0 for a data point that
   * arrived within the second it was taken, and for one stamped by a clock
   * that runs ahead.
   */
  lagMs: number;
  /*
   * How often the series' rows arrive, as the window shows it: from its first
   * arrival to its newest, shared out over the minutes something arrived in.
   * A source that delivers five minutes of data at once every five minutes
   * arrives every five minutes, however often its data points are. Null when
   * everything arrived within one minute.
   */
  arrivalIntervalMs: number | null;
}

