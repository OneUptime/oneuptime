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
  | "probe-agreement";

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
}

export interface MonitorEvaluationEvent {
  type: MonitorEvaluationEventType;
  title: string;
  message?: string | undefined;
  relatedCriteriaId?: string | undefined;
  relatedIncidentId?: string | undefined;
  relatedIncidentNumber?: number | undefined;
  relatedAlertId?: string | undefined;
  relatedAlertNumber?: number | undefined;
  at?: Date | undefined;
}

export default interface MonitorEvaluationSummary {
  evaluatedAt: Date;
  criteriaResults: Array<MonitorEvaluationCriteriaResult>;
  events: Array<MonitorEvaluationEvent>;
}
