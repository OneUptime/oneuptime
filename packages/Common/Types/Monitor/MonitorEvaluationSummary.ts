import Dictionary from "../Dictionary";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";
import { EvaluationSentence } from "./EvaluationSentence";

export type MonitorEvaluationEventType =
  | "criteria-met"
  | "criteria-not-met"
  | "incident-created"
  | "incident-resolved"
  | "incident-skipped"
  | "alert-created"
  | "alert-resolved"
  | "alert-skipped"
  | "monitor-status-changed"
  /*
   * A grouped monitor kept its status on a check no criteria matched: its
   * recovery criteria wait for the series behind its status
   * (GroupedMonitorRecovery).
   */
  | "monitor-status-kept"
  | "probe-agreement"
  /*
   * How an Incoming Request criteria that groups by a payload field handled
   * a request it matched: one for the whole monitor, because the request had
   * no value to group by, or nothing new, because its values recovered.
   */
  | "grouping"
  /*
   * Requests to an Incoming Request monitor that evaluates every request
   * which were skipped before this one: more were waiting than a monitor
   * keeps, or evaluating them failed every time (#10582).
   */
  | "requests-skipped";

export type MonitorEvaluationCriteriaSkipCause =
  | "disabled"
  | "earlier-criterion-matched"
  // Judged only during its active hours, and the check was outside them.
  | "outside-active-hours";

/*
 * What a grouping event says, for the Dashboard to word in the reader's
 * language (EvaluationLogList): the event's title and message are the same
 * note in English, as stored.
 *
 *   no-value            The request has no value at the path, so the
 *                       criteria handled it without grouping, once for the
 *                       whole monitor.
 *   no-request          The criteria matched because requests stopped
 *                       arriving: the same, with no request to read.
 *   values-recovered    Every value the request has at the path reported
 *                       recovered, so nothing new opened.
 *   no-value-recovered  No value at the path, and the request reported
 *                       recovered, so nothing new opened.
 *   re-read             The background check re-read the last request,
 *                       whose values were handled when it arrived.
 *   some-without-value  The request's values opened their own, and
 *                       itemsWithoutValue of its items had none.
 */
export type MonitorEvaluationGroupingOutcome =
  | "no-value"
  | "no-request"
  | "values-recovered"
  | "no-value-recovered"
  | "re-read"
  | "some-without-value";

export interface MonitorEvaluationGroupingNote {
  outcome: MonitorEvaluationGroupingOutcome;
  /*
   * The criteria that groups, by name. Absent for a criteria without one:
   * the Dashboard names it as its criteria list does (relatedCriteriaId).
   */
  criteriaName?: string | undefined;
  // Its grouping path as the project wrote it, when the note names it.
  path?: string | undefined;
  /*
   * Items of the request with no value at the path, which opened nothing of
   * their own: some-without-value, and values-recovered when it has any.
   */
  itemsWithoutValue?: number | undefined;
}

export interface MonitorEvaluationFilterResult {
  checkOn: CheckOn;
  filterType?: FilterType | undefined;
  value?: string | number | undefined;
  message: string;
  /*
   * The message as the sentence it was filled from, for the Dashboard to
   * word in each reader's language (EvaluationSentence). Absent for a
   * message the engine does not write as one yet: it reads as stored.
   */
  messageSentence?: EvaluationSentence | undefined;
  met: boolean;
}

export interface MonitorEvaluationCriteriaResult {
  criteriaId?: string | undefined;
  criteriaName?: string | undefined;
  filterCondition: FilterCondition;
  met: boolean;
  message: string;
  filters: Array<MonitorEvaluationFilterResult>;
  skipped?: boolean | undefined;
  skipReason?: string | undefined;
  skipCause?: MonitorEvaluationCriteriaSkipCause | undefined;
}

export interface MonitorEvaluationEvent {
  type: MonitorEvaluationEventType;
  title: string;
  message?: string | undefined;
  /*
   * The title and the message as the sentences they were filled from, for
   * the Dashboard to word in each reader's language (EvaluationSentence):
   * `title` and `message` are their English, as stored.
   */
  titleSentence?: EvaluationSentence | undefined;
  messageSentence?: EvaluationSentence | undefined;
  relatedCriteriaId?: string | undefined;
  relatedIncidentId?: string | undefined;
  relatedIncidentNumber?: number | undefined;
  relatedIncidentNumberWithPrefix?: string | undefined;
  relatedIncidentCreatedAt?: Date | undefined;
  relatedAlertId?: string | undefined;
  relatedAlertNumber?: number | undefined;
  relatedAlertNumberWithPrefix?: string | undefined;
  relatedAlertCreatedAt?: Date | undefined;
  // When this action occurred, distinct from an already-active entity's creation.
  at?: Date | undefined;
  // A "grouping" event's note, for the Dashboard to word (see above).
  grouping?: MonitorEvaluationGroupingNote | undefined;
}

/*
 * What a grouped check's latest value of a series counts: a metric's value
 * in its unit, or a group's logs or spans.
 */
export enum MonitorEvaluationSeriesValueKind {
  Metric = "Metric",
  Logs = "Logs",
  Spans = "Spans",
}

/*
 * A series' labels as the summary keeps them: each label's value as the text
 * it reads as (SeriesLabelDisplay), the empty ones and repeats left out, so
 * they name the series as its incidents and alerts do. Text, and not the
 * check's JSONObject: a Server monitor keeps its last summary on the monitor
 * itself (ServerMonitorResponse.evaluationSummary), and every typed write of
 * the monitor would spell out each value a JSONObject can hold, which is past
 * what TypeScript can check (TS2589).
 */
export type MonitorEvaluationSeriesLabels = Dictionary<string>;

/*
 * One series a grouped check read, as the Series card on the monitor's
 * Overview lists it (#10062): what names it, its latest value, the criteria
 * it met, and whether it keeps the monitor's status (GroupedMonitorRecovery).
 */
export interface MonitorEvaluationSeriesRow {
  fingerprint: string;
  // Its labels, as its incidents and alerts name it.
  labels: MonitorEvaluationSeriesLabels;
  // What else is known about it, for its name only.
  context?: MonitorEvaluationSeriesLabels | undefined;
  valueKind: MonitorEvaluationSeriesValueKind;
  /*
   * Its newest value of what the criteria compare, in `unit`. Absent when
   * the series had no data in the window.
   */
  value?: number | undefined;
  unit?: string | undefined;
  // The metric the value is of, which says how its unit reads.
  metricName?: string | undefined;
  // The criteria it met on this check, by id, in criteria order.
  metCriteriaIds: Array<string>;
  /*
   * It met a criteria that changed the monitor's status and no criteria that
   * brings it back yet, and nothing else matched: it keeps the status.
   */
  isKeepingStatus?: boolean | undefined;
}

export interface MonitorEvaluationSeries {
  // How many series the check read.
  count: number;
  /*
   * At most MAX_SERIES_TABLE_ROWS of them (MonitorSeriesTable): the ones
   * that keep the status or met a criteria that changes it first, then the
   * ones that met another criteria, then the rest, each in the check's order.
   */
  rows: Array<MonitorEvaluationSeriesRow>;
}

export default interface MonitorEvaluationSummary {
  evaluatedAt: Date;
  criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  events: Array<MonitorEvaluationEvent>;
  /*
   * The series of a grouped check (#10062). Absent for a monitor that does
   * not judge series on its own.
   */
  series?: MonitorEvaluationSeries | undefined;
  /*
   * How long the evaluation took, in milliseconds of wall-clock time: from
   * when it began - a telemetry check's first read - until its monitor log
   * entry was written (#10317). Absent from a summary captured before the
   * evaluation ended (an incident's or an alert's), and from older ones.
   */
  durationInMs?: number | undefined;
  /*
   * How many series its criteria judged: every series of a grouped check,
   * those that read no data among them (MonitorStoredCheck.countSeries).
   * Absent for a check that is not split into series.
   */
  seriesJudged?: number | undefined;
  /*
   * How often its monitor is evaluated, in milliseconds, when it runs on a
   * schedule: what durationInMs is weighed against
   * (MonitorEvaluationTime.isSlow).
   */
  intervalInMs?: number | undefined;
}
