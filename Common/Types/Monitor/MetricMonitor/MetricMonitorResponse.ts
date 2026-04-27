import AggregatedResult from "../../BaseDatabase/AggregatedResult";
import InBetween from "../../BaseDatabase/InBetween";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";
import MetricsViewConfig from "../../Metrics/MetricsViewConfig";
import ObjectID from "../../ObjectID";
import Dictionary from "../../Dictionary";
import MetricSeriesResult from "./MetricSeriesResult";

export interface KubernetesAffectedResource {
  podName?: string | undefined;
  namespace?: string | undefined;
  nodeName?: string | undefined;
  containerName?: string | undefined;
  workloadType?: string | undefined;
  workloadName?: string | undefined;
  metricValue: number;
}

export interface KubernetesResourceBreakdown {
  clusterName: string;
  metricName: string;
  metricFriendlyName: string;
  affectedResources: Array<KubernetesAffectedResource>;
  attributes: Dictionary<string>;
}

export default interface MetricMonitorResponse {
  projectId: ObjectID;
  startAndEndDate?: InBetween<Date>;
  metricResult: Array<AggregatedResult>;
  metricViewConfig: MetricsViewConfig;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  kubernetesResourceBreakdown?: KubernetesResourceBreakdown | undefined;
  /**
   * Per-series breakdown when any queryConfig sets groupByAttributeKeys.
   * Each entry carries a fingerprint, the label values identifying that
   * series, and the aggregated-per-query results scoped to that series
   * (including per-series formula results). Absent for traditional
   * whole-monitor evaluation, in which case criteria evaluate against
   * `metricResult` as before.
   */
  seriesBreakdown?: Array<MetricSeriesResult> | undefined;
}
