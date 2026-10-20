import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";

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
  | "probe-agreement"
  /*
   * How an Incoming Request criteria that groups by a payload field handled
   * a request it matched: one for the whole monitor, because the request had
   * no value to group by, or nothing new, because its values recovered.
   */
  | "grouping";

export type MonitorEvaluationCriteriaSkipCause =
  | "disabled"
  | "earlier-criterion-matched";

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

export default interface MonitorEvaluationSummary {
  evaluatedAt: Date;
  criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  events: Array<MonitorEvaluationEvent>;
}
