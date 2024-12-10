import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import InBetween from "../../BaseDatabase/InBetween";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";

export default interface MetricMonitorResponse {
  startAndEndDate?: InBetween<Date>;
  metricResult: Array<AggregatedResult>;
  metricViewConfig: MetricsViewConfig;
  monitorId: ObjectID;
}
