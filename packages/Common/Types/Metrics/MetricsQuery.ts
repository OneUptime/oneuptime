import Includes from "../BaseDatabase/Includes";
import Search from "../BaseDatabase/Search";
import Dictionary from "../Dictionary";
import MetricsAggregationType from "./MetricsAggregationType";

export default interface MetricsQuery {
  metricName: string;
  attributes: Dictionary<string | boolean | number | Search<string> | Includes>;
  aggegationType: MetricsAggregationType;
  aggregateBy: Dictionary<boolean>;

  /*
   * The telemetry services the query reads its metric for, by id: the rows'
   * service (primaryEntityId), which no attribute filter can name. A Metrics
   * monitor limited to some services reads every query this way
   * (MonitorStepMetricMonitor.telemetryServiceIds), so its charts carry it
   * (MonitorStepMetricQueries, issue #6266). Absent or empty: every service.
   */
  telemetryServiceIds?: Array<string> | undefined;

  /*
   * This is used for example for probes.
   * To display US probe and EU probe in chart for example.
   * In this case groupByAttribute is "probeId"
   * and attributeValueToLegendMap is { "xx-xx-xx-xx": "US Probe", "yy-yyy-yyy-yy-yy": "EU Probe" }
   */

  groupByAttribute?: string | undefined;
  attributeValueToLegendMap?: Dictionary<string>;
}
