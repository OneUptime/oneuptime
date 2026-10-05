/*
 * What OneUptime AI has learned about one scope from its own work there —
 * today a Kubernetes cluster or a resource served by a resource AI agent —
 * and what of it deserves attention: the response of the scope's AI
 * Insights page (POST /kubernetes-cluster/ai-access/insights,
 * POST /resource-ai-access/insights).
 *
 * The AI pages share one vocabulary, so the pages that follow (incidents
 * and alerts) can reuse this contract and its builder:
 *
 *   - Logs: the chronological record of everything AI did — each
 *     investigation, fix and command (KubernetesClusterAiLogs,
 *     ResourceAiLogs).
 *   - Insights (this): aggregated, derived findings and patterns that say
 *     what to pay attention to.
 *
 * Every number and sentence here is derived from rows the system already
 * has: the AI investigations that concern the scope and the incidents and
 * alerts they investigated, what those investigations concluded (their
 * TL;DR, or their report's own Summary), the verdicts people and the grader
 * gave them, the fixes AI proposed and how their verification turned out,
 * the commands AI ran there, and the preventive AIInsight findings filed
 * against the scope's own telemetry. Nothing is invented and no model is
 * called to build it. Summaries only: no command output, prompt or command
 * plan, and nothing about an incident or alert the caller may not read.
 */

// The window everything here covers, ending now.
export const AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS: number = 30;

// The "recent" part of the window a recurring problem is judged on.
export const AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS: number = 7;

/*
 * How many investigations, and how many fixes, of the window are read at
 * most (newest first). A window holding more says so (isPartial).
 */
export const AI_ACTIVITY_INSIGHTS_MAX_INVESTIGATIONS: number = 500;
export const AI_ACTIVITY_INSIGHTS_MAX_FIXES: number = 500;

// How many of each list the route returns.
export const AI_ACTIVITY_INSIGHTS_MAX_PROBLEMS: number = 10;
export const AI_ACTIVITY_INSIGHTS_MAX_HOTSPOTS: number = 8;
export const AI_ACTIVITY_INSIGHTS_MAX_ATTENTION_ITEMS: number = 6;
export const AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS: number = 5;
// How many affected objects a problem names.
export const AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS: number = 3;

/*
 * A problem is recurring once it was investigated this many times in the
 * window; it needs attention at AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN.
 */
export const AI_ACTIVITY_INSIGHTS_RECURRING_MIN: number = 2;
export const AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN: number = 3;

// An incident or alert an investigation was about.
export interface AiActivitySubject {
  kind: "incident" | "alert";
  id: string;
  title?: string | undefined;
  // The incident's or alert's number, when it has one.
  number?: number | undefined;
}

/*
 * One part of the scope a problem was about, named the way alerts name it
 * (SeriesLabelDisplay): "Namespace" / "default", "Pod" / "web-7d9f-2xk",
 * "Virtual Machine" / "db-01".
 */
export interface AiActivityObject {
  name: string;
  value: string;
}

// What an investigation concluded.
export interface AiActivityFinding {
  aiRunId: string;
  text: string;
  /*
   * "tldr": the run's AI-written TL;DR. "report": the Summary its posted
   * report opens with, for a run whose TL;DR call failed.
   */
  source: "tldr" | "report";
  // ISO: when the investigation finished (or started, without an end).
  at?: string | undefined;
}

/*
 * The incidents and alerts AI investigated here, grouped by what raised
 * them: the monitor (one problem however many pods or hosts it fired for),
 * else the subject's title.
 */
export interface AiActivityProblem {
  // Opaque and stable for the same grouping: links attention items to it.
  key: string;
  // The latest subject's title without the series identity alerts append.
  title: string;
  investigationCount: number;
  // Distinct incidents and alerts.
  subjectCount: number;
  isRecurring: boolean;
  // ISO.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  latestSubject: AiActivitySubject;
  // The parts of the scope it fired for, most frequent first.
  objects: Array<AiActivityObject & { count: number }>;
  latestFinding?: AiActivityFinding | undefined;
  // What people (verdicts) and the grader (grades) said of its findings.
  verdicts: {
    confirmed: number;
    rejected: number;
    matched: number;
    partlyMatched: number;
    mismatched: number;
  };
  // The fixes AI proposed for its incidents and alerts, and how they went.
  fixes: {
    proposed: number;
    applied: number;
    verified: number;
    failed: number;
    awaitingApproval: number;
  };
}

// A part of the scope that keeps showing up in what AI investigated.
export interface AiActivityHotspot extends AiActivityObject {
  investigationCount: number;
  // How many different problems it showed up in.
  problemCount: number;
  // ISO.
  lastSeenAt?: string | undefined;
}

// The fixes of the window by where they ended up.
export interface AiActivityFixOutcomes {
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

// One UTC day of the window.
export interface AiActivityTrendDay {
  // YYYY-MM-DD.
  date: string;
  investigations: number;
  // Investigations that ended in an error or timed out.
  failedInvestigations: number;
  fixes: number;
}

/*
 * An open preventive AIInsight finding filed against the scope itself: its
 * own telemetry spiked, regressed or drifted (the AI → Insights inbox).
 */
export interface AiActivityPreventiveInsight {
  id: string;
  title: string;
  // AIInsightType.
  insightType: string;
  // AIInsightSeverity.
  severity: string;
  // AIInsightStatus.
  status: string;
  // ISO.
  lastSeenAt?: string | undefined;
  occurrenceCount?: number | undefined;
}

export enum AiActivityAttentionKind {
  // Fixes AI applied whose verification failed.
  FixesFailed = "FixesFailed",
  // One problem investigated again and again.
  RecurringProblem = "RecurringProblem",
  // Fixes waiting for someone to approve them.
  FixesAwaitingApproval = "FixesAwaitingApproval",
  // Investigations that ended in an error or timed out.
  InvestigationsFailed = "InvestigationsFailed",
  // Commands the agent never picked up.
  CommandsTimedOut = "CommandsTimedOut",
  // Findings people rejected, or the grader found wrong.
  FindingsRejected = "FindingsRejected",
  // An open High or Medium preventive insight about the scope.
  PreventiveInsight = "PreventiveInsight",
  // One part of the scope in most of the investigations.
  Hotspot = "Hotspot",
}

export enum AiActivityAttentionSeverity {
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

/*
 * One thing worth a look, most important first. The dashboard words it
 * from these fields; the server never sends prose here.
 */
export interface AiActivityAttentionItem {
  kind: AiActivityAttentionKind;
  severity: AiActivityAttentionSeverity;
  // How many (fixes, investigations, commands, findings, occurrences).
  count: number;
  // Out of how many, where the sentence reads that way.
  total?: number | undefined;
  // RecurringProblem: in the recent part of the window.
  recentCount?: number | undefined;
  // RecurringProblem: the problem; PreventiveInsight: the insight's title.
  problemKey?: string | undefined;
  title?: string | undefined;
  // Hotspot.
  object?: AiActivityObject | undefined;
  // Where to act, when it is an incident or alert the caller may read.
  subject?: AiActivitySubject | undefined;
  // PreventiveInsight.
  insightId?: string | undefined;
  insightSeverity?: string | undefined;
}

export interface AiActivityInsightsTotals {
  investigations: number;
  completedInvestigations: number;
  // Ended in an error, or timed out.
  failedInvestigations: number;
  // Queued, running, or waiting for approval.
  activeInvestigations: number;
  problems: number;
  recurringProblems: number;
  fixes: number;
  // Commands AI ran on the scope; the AI agent page's connection tests are not counted.
  commands: number;
  // Commands that ran and failed (a non-zero exit, or the agent's error).
  failedCommands: number;
  // Commands the agent never picked up in time.
  timedOutCommands: number;
}

export interface AiActivityInsights {
  windowInDays: number;
  // ISO.
  windowStart: string;
  generatedAt: string;
  totals: AiActivityInsightsTotals;
  attention: Array<AiActivityAttentionItem>;
  problems: Array<AiActivityProblem>;
  hotspots: Array<AiActivityHotspot>;
  fixOutcomes: AiActivityFixOutcomes;
  // One entry per day of the window, oldest first.
  trend: Array<AiActivityTrendDay>;
  preventiveInsights: Array<AiActivityPreventiveInsight>;
  /*
   * True when the window held more investigations, fixes or commands than
   * were read, so the numbers cover the newest of them only.
   */
  isPartial: boolean;
}
