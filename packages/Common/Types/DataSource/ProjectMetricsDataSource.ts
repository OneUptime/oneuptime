/*
 * THE DATA SOURCE WIDGETS' BUILT-IN SOURCE: THIS PROJECT'S OWN METRICS, IN
 * PROMQL (issue #7713).
 *
 * The Chart, Value, Gauge and Table data source widgets read a system
 * OneUptime does not own through a Data Source record. This source is no
 * record: picked by its own id, the widget's PromQL runs over the
 * project's own metrics with the PromQL engine the Metrics page's PromQL
 * tab and the Prometheus API use, as the person looking at the dashboard,
 * with exactly the services they may read. Nothing is created, so it needs
 * no plan a Data Source record needs, and no Prometheus pointed at
 * OneUptime itself.
 *
 * Stored in a widget's query (DataSourceQueryConfig.dataSourceId) as this
 * id, which no record's id (a UUID) can be. Never rename it.
 */
export const PROJECT_METRICS_DATA_SOURCE_ID: string = "oneuptime-metrics";

export class ProjectMetricsDataSourceUtil {
  // Whether a widget's query reads the project's own metrics.
  public static isProjectMetrics(dataSourceId: unknown): boolean {
    return dataSourceId === PROJECT_METRICS_DATA_SOURCE_ID;
  }
}
