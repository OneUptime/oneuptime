import {
  AiActivityCoverage,
  AiActivityFixTaskOutcomes,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityResourceHotspot,
} from "./AiActivityInsights";
import { IncidentAlertAiSubjectKind } from "./IncidentAlertAiLogs";

/*
 * What OneUptime AI has learned across a project's incidents, or its alerts,
 * over the last AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS days: the response of the
 * AI Insights page of the Incidents and Alerts menus' AI section
 * (POST /ai-activity/incident/insights and POST /ai-activity/alert/insights).
 *
 * It is a cluster's and a resource's AI Insights (AiActivityInsights), built
 * by the same builder over the product's own rows - the same problems and
 * findings, fix outcomes, trend and attention items, worded the same way by
 * the same page - with the sections only a whole product has filled in:
 *
 *   - coverage: how many of the window's incidents AI investigated, and why
 *     it skipped the others, as each one's creation recorded it;
 *   - monitors and services: the ones that keep failing, by the incidents
 *     AI investigated that they raised or affected;
 *   - fixTaskOutcomes: the fix pull requests AI was asked to open;
 *   - fixesHidden: a role that may not read auto-remediation suggestions
 *     gets no fix numbers, and the page says so instead of showing zeros.
 *
 * A project has no parts of its own the way a cluster has pods, so it has no
 * part hotspots: its monitors and services stand in for them.
 */

export const INCIDENT_ALERT_AI_INSIGHTS_PATHS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: "/ai-activity/incident/insights",
  alert: "/ai-activity/alert/insights",
};

/*
 * How many of the window's newest investigations, fixes and fix pull
 * requests are read at most: twice a cluster's, since every incident (or
 * alert) of the project is in scope. A window holding more says so
 * (isPartial).
 */
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_INVESTIGATIONS: number = 1000;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_FIXES: number = 1000;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_FIX_TASKS: number = 1000;

// How many monitors a problem names.
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS: number = 3;

// A monitor or service is a hotspot once this many investigations named it.
export const INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN: number = 2;

export interface IncidentAlertAiInsights extends AiActivityInsights {
  subjectKind: IncidentAlertAiSubjectKind;
  totals: AiActivityInsightsTotals & { fixTasks: number };
  coverage: AiActivityCoverage;
  monitors: Array<AiActivityResourceHotspot>;
  services: Array<AiActivityResourceHotspot>;
  fixTaskOutcomes: AiActivityFixTaskOutcomes;
  fixesHidden: boolean;
}
