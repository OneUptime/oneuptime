import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import InBetween from "../../BaseDatabase/InBetween";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";

export default interface MetricMonitorResponse {
  projectId: ObjectID;
  startAndEndDate?: InBetween<Date>;
  metricResult: Array<AggregatedResult>;
  metricViewConfig: MetricsViewConfig;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
