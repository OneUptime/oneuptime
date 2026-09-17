/*
 * A widget-stored binding to an external Data Source. Persisted inside
 * `Dashboard.dashboardViewConfig` on chart/value/gauge/table components, so
 * every field must survive JSON round-trips (plain strings/numbers only —
 * dataSourceId is a string, not an ObjectID instance).
 */
export default interface DataSourceQueryConfig {
  /*
   * Stable identity for this query within the widget (mirrors
   * MetricQueryConfigData.id) so editor UI state survives reorders.
   */
  id?: string | undefined;

  // _id of the project's DataSource record this query runs against.
  dataSourceId: string;

  /*
   * Query text in the source's native language: PromQL, SQL, LogQL,
   * Elasticsearch Query DSL JSON, or the REST request descriptor JSON.
   * SQL queries may use the $__startTime / $__endTime / $__startTimeMs /
   * $__endTimeMs / $__rangeSeconds macros, replaced server-side with the
   * dashboard's current time window.
   */
  query: string;

  /*
   * Optional legend template for chart series. Supports {{label}}
   * placeholders resolved against each series' group keys (e.g. Prometheus
   * label values). Absent ⇒ series are named from their group keys.
   */
  legend?: string | undefined;
}

/*
 * What shape of result the widget wants back from the query endpoint.
 * Charts/values/gauges consume time series; the table widget consumes rows.
 */
export enum DataSourceResultKind {
  TimeSeries = "TimeSeries",
  Table = "Table",
}
