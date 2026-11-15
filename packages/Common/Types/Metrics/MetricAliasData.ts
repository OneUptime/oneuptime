export default interface MetricAliasData {
  metricVariable: string | undefined;
  title: string | undefined;
  description: string | undefined;
  legend: string | undefined;
  legendUnit: string | undefined;
  /*
   * The description is the metric's own, as its MetricType stores it - a
   * key of OneUptime's for a monitor's series (#8356), or the telemetry's
   * own words - not one a person typed. A chart looks it up once where it
   * draws it, so a key reads in the reader's language and anything else
   * as written (#8572). The stored English stays as it is.
   */
  isMetricTypeDescription?: boolean | undefined;
}
