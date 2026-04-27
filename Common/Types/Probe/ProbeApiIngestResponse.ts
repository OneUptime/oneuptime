import ObjectID from "../ObjectID";
import MonitorEvaluationSummary from "../Monitor/MonitorEvaluationSummary";
import { JSONObject } from "../JSON";
import MetricCriteriaContext from "../Monitor/MetricMonitor/MetricCriteriaContext";

/**
 * One per-series match produced by a metric monitor with
 * groupByAttributeKeys set. The criteria evaluator emits an entry per
 * series that breached the threshold, and MonitorResource fans this
 * out into one incident + one alert per (criteria, incident template,
 * fingerprint) triple.
 */
export interface PerSeriesCriteriaMatch {
  criteriaMetId: string;
  fingerprint: string;
  labels: JSONObject;
  rootCause: string;
  metricContext?: MetricCriteriaContext | undefined;
}

export default interface ProbeApiIngestResponse {
  monitorId: ObjectID;
  ingestedMonitorStepId?: ObjectID | undefined;
  nextMonitorStepId?: ObjectID | undefined;
  criteriaMetId?: string | undefined;
  rootCause: string | null; // this is in markdown format
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  /**
   * Set when a metric monitor with group-by attributes produced one or
   * more per-series matches. MonitorResource uses this to create one
   * incident/alert per breaching series. When undefined (non-metric
   * monitors or ungrouped metric monitors), the scalar `criteriaMetId`
   * + `rootCause` still drive the legacy single-incident path.
   */
  perSeriesMatches?: Array<PerSeriesCriteriaMatch> | undefined;
}
