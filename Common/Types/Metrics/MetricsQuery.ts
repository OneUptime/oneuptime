import Dictionary from "../Dictionary";
import MetricsAggregationType from "./MetricsAggregationType";

export default interface MetricsQuery {
  metricName: string;
  attributes: Dictionary<string | boolean | number>;
  aggegationType: MetricsAggregationType;
  aggregateBy: Dictionary<boolean>;

  /*
   * This is used for example for probes.
   * To display US probe and EU probe in chart for example.
   * In this case groupByAttribute is "probeId"
   * and attributeValueToLegendMap is { "xx-xx-xx-xx": "US Probe", "yy-yyy-yyy-yy-yy": "EU Probe" }
   */

  groupByAttribute?: string | undefined;
  attributeValueToLegendMap?: Dictionary<string>;
}
