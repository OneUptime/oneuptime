import { InvestigationNotStartedCode } from "./InvestigationNotStartedReason";
import {
  IncidentAlertAiLogSubject,
  IncidentAlertAiSubjectKind,
} from "./IncidentAlertAiLogs";

/*
 * What OneUptime AI has learned across a project's incidents, or its alerts,
 * over the last INCIDENT_ALERT_AI_INSIGHTS_WINDOW_IN_DAYS days: the response
 * of the AI Insights page of the Incidents and Alerts menus' AI section
 * (POST /ai-activity/incident/insights and POST /ai-activity/alert/insights).
 *
 * The AI pages share one vocabulary: Logs is the chronological record of
 * everything AI did (IncidentAlertAiLogs); Insights (this) is what that
 * record adds up to and what deserves attention. Its problems, fix outcomes,
 * trend and attention items have the shape a cluster's and a resource's AI
 * Insights give them, so the dashboard words them the same way.
 *
 * Every number and sentence is derived from rows the system already has -
 * the window's AI investigations of the product's incidents (or alerts) and
 * what they concluded (their TL;DR), the verdicts people and the grader gave
 * them, the fixes AI proposed and how their verification turned out, the
 * fix pull requests it was asked to open, the commands it ran, the monitors
 * and services those incidents were raised for, and why the ones it did not
 * investigate were skipped. Nothing is invented and no model is called to
 * build it. Summaries only: no command output, prompt or command plan, and
 * nothing about an incident, alert, monitor or service the caller may not
 * read.
 */

export const INCIDENT_ALERT_AI_INSIGHTS_PATHS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: "/ai-activity/incident/insights",
  alert: "/ai-activity/alert/insights",
};

// The window everything here covers: this many UTC days, ending today.
export const INCIDENT_ALERT_AI_INSIGHTS_WINDOW_IN_DAYS: number = 30;

// The "recent" part of the window a recurring problem is judged on.
export const INCIDENT_ALERT_AI_INSIGHTS_RECENT_WINDOW_IN_DAYS: number = 7;

/*
 * How many of the window's newest investigations, fixes and fix pull
 * requests are read at most. A window holding more says so (isPartial).
 */
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_INVESTIGATIONS: number = 1000;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_FIXES: number = 1000;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_FIX_TASKS: number = 1000;

// How many of each list the route returns.
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEMS: number = 10;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_HOTSPOTS: number = 8;
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_ATTENTION_ITEMS: number = 6;
// How many monitors a problem names.
export const INCIDENT_ALERT_AI_INSIGHTS_MAX_PROBLEM_MONITORS: number = 3;

/*
 * A problem is recurring once it was investigated this many times in the
 * window; it needs attention at
 * INCIDENT_ALERT_AI_INSIGHTS_RECURRING_ATTENTION_MIN.
 */
export const INCIDENT_ALERT_AI_INSIGHTS_RECURRING_MIN: number = 2;
export const INCIDENT_ALERT_AI_INSIGHTS_RECURRING_ATTENTION_MIN: number = 3;

// A monitor or service is a hotspot once this many investigations named it.
export const INCIDENT_ALERT_AI_INSIGHTS_HOTSPOT_MIN: number = 2;

// The incident or alert something was about.
export type IncidentAlertAiInsightsSubject = IncidentAlertAiLogSubject;

// What an investigation concluded: its TL;DR.
export interface IncidentAlertAiFinding {
  aiRunId: string;
  text: string;
  // ISO: when the investigation finished (or started, without an end).
  at?: string | undefined;
}

// A monitor or service, by the name the caller may read.
export interface IncidentAlertAiNamedResource {
  id: string;
  name: string;
}

/*
 * The incidents (or alerts) AI investigated, grouped by what raised them:
 * their monitors (one problem however many hosts or pods a monitor fired
 * for), else their title.
 */
export interface IncidentAlertAiProblem {
  // Opaque and stable for the same grouping: links attention items to it.
  key: string;
  // The latest subject's title, without the series identity alerts append.
  title: string;
  investigationCount: number;
  // Distinct incidents (or alerts).
  subjectCount: number;
  isRecurring: boolean;
  // ISO.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  latestSubject: IncidentAlertAiInsightsSubject;
  // The monitors that raised it, the ones the caller may read.
  monitors: Array<IncidentAlertAiNamedResource>;
  latestFinding?: IncidentAlertAiFinding | undefined;
  // What people (verdicts) and the grader (grades) said of its findings.
  verdicts: {
    confirmed: number;
    rejected: number;
    matched: number;
    partlyMatched: number;
    mismatched: number;
  };
  // The fixes AI proposed for its incidents (or alerts), and how they went.
  fixes: {
    proposed: number;
    applied: number;
    verified: number;
    failed: number;
    awaitingApproval: number;
  };
}

// A monitor or service that keeps showing up in what AI investigated.
export interface IncidentAlertAiHotspot extends IncidentAlertAiNamedResource {
  // Distinct incidents (or alerts) AI investigated that it was part of.
  subjectCount: number;
  investigationCount: number;
  // How many different problems it showed up in.
  problemCount: number;
  // ISO.
  lastSeenAt?: string | undefined;
}

// The window's fixes by where they ended up.
export interface IncidentAlertAiFixOutcomes {
  total: number;
  planning: number;
  awaitingApproval: number;
  appliedAutomatically: number;
  appliedAfterApproval: number;
  dismissed: number;
  noFixFound: number;
  // How applied fixes' verification turned out.
  verified: number;
  failed: number;
  verifying: number;
}

// The window's fix pull requests by where they ended up.
export interface IncidentAlertAiFixTaskOutcomes {
  total: number;
  pullRequestsOpened: number;
  noFixFound: number;
  inProgress: number;
  failed: number;
  cancelled: number;
}

// What people and the grader made of the window's findings.
export interface IncidentAlertAiVerdictTotals {
  confirmed: number;
  rejected: number;
  matched: number;
  partlyMatched: number;
  mismatched: number;
}

// One UTC day of the window.
export interface IncidentAlertAiTrendDay {
  // YYYY-MM-DD.
  date: string;
  investigations: number;
  // Investigations that ended in an error or timed out.
  failedInvestigations: number;
  fixes: number;
}

/*
 * How much of the window AI looked at: the incidents (or alerts) created in
 * it that the caller may read, how many AI investigated, and why the others
 * were not, as each one's creation recorded it.
 */
export interface IncidentAlertAiCoverage {
  subjects: number;
  investigatedSubjects: number;
  notInvestigated: Array<{
    code: InvestigationNotStartedCode;
    count: number;
  }>;
}

export enum IncidentAlertAiAttentionKind {
  // Fixes AI applied whose verification failed.
  FixesFailed = "FixesFailed",
  // One problem investigated again and again.
  RecurringProblem = "RecurringProblem",
  // Incidents (or alerts) AI could not investigate: a limit, a missing provider, no credits.
  InvestigationsNotStarted = "InvestigationsNotStarted",
  // Fixes waiting for someone to approve them.
  FixesAwaitingApproval = "FixesAwaitingApproval",
  // Investigations that ended in an error or timed out.
  InvestigationsFailed = "InvestigationsFailed",
  // Commands an agent never picked up.
  CommandsTimedOut = "CommandsTimedOut",
  // Findings people rejected, or the grader found wrong.
  FindingsRejected = "FindingsRejected",
  // One monitor in most of the investigations.
  MonitorHotspot = "MonitorHotspot",
}

export enum IncidentAlertAiAttentionSeverity {
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

/*
 * One thing worth a look, most important first. The dashboard words it from
 * these fields; the server never sends prose here.
 */
export interface IncidentAlertAiAttentionItem {
  kind: IncidentAlertAiAttentionKind;
  severity: IncidentAlertAiAttentionSeverity;
  // How many (fixes, investigations, incidents, commands, findings).
  count: number;
  // Out of how many, where the sentence reads that way.
  total?: number | undefined;
  // RecurringProblem: in the recent part of the window.
  recentCount?: number | undefined;
  // RecurringProblem: the problem and its title.
  problemKey?: string | undefined;
  title?: string | undefined;
  // InvestigationsNotStarted: why, the most common reason.
  reason?: InvestigationNotStartedCode | undefined;
  // MonitorHotspot.
  monitor?: IncidentAlertAiNamedResource | undefined;
  // Where to act, when it is an incident or alert the caller may read.
  subject?: IncidentAlertAiInsightsSubject | undefined;
}

export interface IncidentAlertAiInsightsTotals {
  investigations: number;
  completedInvestigations: number;
  // Ended in an error, or timed out.
  failedInvestigations: number;
  // Queued, running, or waiting for approval.
  activeInvestigations: number;
  problems: number;
  recurringProblems: number;
  // Null when the caller may not read fixes.
  fixes: number | null;
  fixTasks: number;
  // Commands AI ran for those investigations and fixes.
  commands: number;
  // Ran and failed (a non-zero exit, or the agent's error).
  failedCommands: number;
  // An agent never picked them up in time.
  timedOutCommands: number;
}

export interface IncidentAlertAiInsights {
  subjectKind: IncidentAlertAiSubjectKind;
  windowInDays: number;
  // ISO.
  windowStart: string;
  generatedAt: string;
  totals: IncidentAlertAiInsightsTotals;
  coverage: IncidentAlertAiCoverage;
  attention: Array<IncidentAlertAiAttentionItem>;
  problems: Array<IncidentAlertAiProblem>;
  monitors: Array<IncidentAlertAiHotspot>;
  services: Array<IncidentAlertAiHotspot>;
  // Null when the caller may not read fixes.
  fixOutcomes: IncidentAlertAiFixOutcomes | null;
  fixTaskOutcomes: IncidentAlertAiFixTaskOutcomes;
  verdicts: IncidentAlertAiVerdictTotals;
  // One entry per day of the window, oldest first.
  trend: Array<IncidentAlertAiTrendDay>;
  /*
   * True when the window held more investigations, fixes, fix pull
   * requests or commands than were read, so the numbers cover the newest
   * of them only.
   */
  isPartial: boolean;
}
