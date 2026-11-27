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
  /*
   * What else is known about the series, for its alert's or incident's
   * words only (SeriesLabelDisplay): a device's name and model beside the
   * install it is grouped by (#9925). Never part of `fingerprint`.
   */
  context?: JSONObject | undefined;
  /** The context of the first filter this series matched. */
  metricContext?: MetricCriteriaContext | undefined;
  /**
   * The context of EVERY filter this series matched, in filter order. Under
   * an "Any" criteria two series can match on different filters; a reader
   * that describes one filter picks that filter's context from here rather
   * than trusting `metricContext` to be about it.
   */
  metricContexts?: Array<MetricCriteriaContext> | undefined;
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
   * The series this criteria matched. A criteria with no matching series
   * is not recorded as matched for a grouped monitor, with one exception:
   * a recovery criteria that counts a missing series as zero, once every
   * series is gone (GroupedSeriesGone). It has no series to name, and opens
   * nothing.
   */
  perSeriesMatches: Array<PerSeriesCriteriaMatch>;
}

/**
 * A series behind a grouped monitor's status that has not met a recovery
 * criteria yet, so the monitor keeps its status (GroupedMonitorRecovery).
 */
export interface SeriesKeepingStatus {
  fingerprint: string;
  // The series' labels as the check read them, to name it (SeriesLabelDisplay).
  labels: JSONObject;
  // What else is known about it, for its name only.
  context?: JSONObject | undefined;
}

export default interface ProbeApiIngestResponse {
  monitorId: ObjectID;
  ingestedMonitorStepId?: ObjectID | undefined;
  nextMonitorStepId?: ObjectID | undefined;
  /*
   * The first criteria that matched: what acts on the check - the incidents
   * and alerts it opens and resolves. Its status is the monitor's only when
   * it changes one (statusCriteriaId).
   */
  criteriaMetId?: string | undefined;
  rootCause: string | null; // this is in markdown format
  /*
   * The criteria that sets the monitor's status on this check: the first
   * that matched among those that change the status
   * (MonitorCriteriaInstance.changesMonitorStatus), in the order given -
   * criteriaMetId whenever that criteria changes the status, as it does on
   * every monitor whose criteria all do. Unset when none of them matched:
   * the status then goes where a check that matched nothing takes it (its
   * default status, unless a recovery criteria is waited for or nothing was
   * read), whatever criteria that change no status matched (#11238).
   */
  statusCriteriaId?: string | undefined;
  // That criteria's own root cause, for the status change it makes.
  statusRootCause?: string | null | undefined;
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
   * `criteriaMetId` always stays the FIRST match, and the first match that
   * changes the status is `statusCriteriaId` - the monitor has a single
   * status. A recovery criteria that waits for the series behind the
   * monitor's status (GroupedMonitorRecovery) is not a match.
   */
  matchedCriteria?: Array<MatchedCriteriaResult> | undefined;
  /**
   * A grouped monitor's series behind its status that have not met a
   * recovery criteria yet (GroupedMonitorRecovery). Set when no criteria
   * that changes the status matched while some wait: the monitor then keeps
   * its status rather than going to its default status. Unset otherwise.
   */
  seriesKeepingStatus?: Array<SeriesKeepingStatus> | undefined;
  /**
   * A monitor that judges no series on its own, whose status a problem
   * criteria set while its step has a recovery criteria
   * (GroupedMonitorRecovery.judgeWholeMonitor, #10743): on a check no
   * criteria that changes the status matched, it keeps its status rather
   * than go to its default status, until one of these recovery criteria
   * matches. Said whatever the check matched - it reads only the monitor's
   * statuses and criteria, so it holds for every probe's check alike, and
   * probes can agree that nothing matched a check this one matched - and
   * read only when no criteria that changes the status sets it. Unset
   * otherwise.
   */
  statusKeptForRecoveryCriteriaIds?: Array<string> | undefined;
  /**
   * The series behind a grouped monitor's status after this check, for
   * MonitorResource to keep for the next one (SeriesBehindStatus): an empty
   * list deletes what was kept. Unset when there is nothing to write.
   */
  seriesBehindStatus?: Array<string> | undefined;
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
