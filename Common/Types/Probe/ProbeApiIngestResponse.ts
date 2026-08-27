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

/**
 * One criteria that matched on this evaluation, together with the
 * series it matched. Grouped (per-series) monitors accumulate one entry
 * per matching criteria instead of stopping at the first one, so a host
 * breaching the "warning" band still gets its alert while another host
 * holds the monitor in "critical".
 */
export interface MatchedCriteriaResult {
  criteriaId: string;
  rootCause: string;
  /**
   * The series this criteria matched. Empty is impossible here — a
   * criteria with no matching series is not recorded as matched for a
   * grouped monitor.
   */
  perSeriesMatches: Array<PerSeriesCriteriaMatch>;
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
  /**
   * Every criteria that matched on this evaluation, in criteria order.
   *
   * Only populated for monitors that fan out per series (grouped metric
   * monitors and grouped incoming-request monitors). Ungrouped monitors
   * keep the historical "first matching criteria wins, stop there"
   * semantics and leave this undefined, in which case `criteriaMetId` +
   * `rootCause` + `perSeriesMatches` are the whole story.
   *
   * `criteriaMetId` always stays the FIRST match — the monitor has a
   * single status and that is what sets it.
   */
  matchedCriteria?: Array<MatchedCriteriaResult> | undefined;
  /**
   * The ids of every criteria that was actually evaluated on this tick
   * (matched or not, excluding disabled ones and — for ungrouped
   * monitors — everything after the winner).
   *
   * The resolve pass needs this to tell "this criteria was evaluated and
   * this series is no longer breaching it" (resolve) apart from "this
   * criteria never ran, so its open records are none of my business"
   * (leave alone).
   */
  evaluatedCriteriaIds?: Array<string> | undefined;
}
