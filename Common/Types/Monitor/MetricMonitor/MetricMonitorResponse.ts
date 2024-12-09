import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";

export default interface MetricMonitorResponse {
  metricResult: Array<AggregatedResult>;
  metricViewConfig: MetricsViewConfig;
  monitorId: ObjectID;
}
