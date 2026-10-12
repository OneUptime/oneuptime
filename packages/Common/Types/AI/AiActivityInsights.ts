import { InvestigationNotStartedCode } from "./InvestigationNotStartedReason";

/*
 * What OneUptime AI found out about one scope — a Kubernetes cluster, a
 * resource served by a resource AI agent, or a project's incidents or its
 * alerts — over the last 30 days: the response of the scope's AI Insights
 * page (POST /kubernetes-cluster/ai-access/insights,
 * POST /resource-ai-access/insights, POST /ai-activity/incident/insights,
 * POST /ai-activity/alert/insights).
 *
 * The AI pages share one vocabulary:
 *
 *   - Logs: the chronological record of everything AI did — each
 *     investigation, fix and command (KubernetesClusterAiLogs,
 *     ResourceAiLogs, IncidentAlertAiLogs).
 *   - Insights (this): what is worth knowing about the reader's own system,
 *     the way a senior engineer who read every investigation would put it —
 *     the problem that keeps coming back and why, the node or service behind
 *     most of the trouble, what AI fixed on its own and what it would fix if
 *     allowed, the risks it spotted before anything paged. Each insight is
 *     specific, carries the incidents and alerts behind it, and has one next
 *     step. How much AI itself did is the page's footnote, not its headline.
 *
 * Every number and sentence here is derived from rows the system already
 * has: the incidents and alerts of the scope, the AI investigations of them
 * and what those concluded (their TL;DR, or their report's own Summary, and
 * the first step their report suggests), the verdicts people and the grader
 * gave them, the fixes AI proposed and how their verification turned out,
 * the commands AI ran there, and the preventive AIInsight findings filed
 * against the scope's own telemetry. Nothing is invented and no model is
 * called to build it: the words that are AI's own (a finding, a suggested
 * step) were written by the investigation that found them, and are shown as
 * that investigation's. Summaries only: no command output, prompt or command
 * plan, and nothing about an incident or alert the caller may not read.
 *
 * The incidents' and alerts' pages (IncidentAlertAiInsights) are this
 * contract, built by the same builder, plus what only a whole product has:
 * how many of the window's incidents AI looked at and why it skipped the
 * rest, the monitors and services that keep failing, and the fix pull
 * requests. Those are the optional sections at the end of
 * AiActivityInsights, left out for a cluster or a resource.
 */

// The window everything here covers, ending now.
export const AI_ACTIVITY_INSIGHTS_WINDOW_IN_DAYS: number = 30;

/*
 * The "recent" part of the window a problem is judged on: what happened in
 * the last 7 days, against the 7 days before them.
 */
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
export const AI_ACTIVITY_INSIGHTS_MAX_PREVENTIVE_INSIGHTS: number = 5;
// How many affected objects a problem names.
export const AI_ACTIVITY_INSIGHTS_MAX_PROBLEM_OBJECTS: number = 3;

/*
 * How many insights the page leads with, and how many of one kind: the
 * problems that keep coming back, and the risks spotted before they paged.
 */
export const AI_ACTIVITY_INSIGHTS_MAX_INSIGHTS: number = 8;
export const AI_ACTIVITY_INSIGHTS_MAX_RECURRING_INSIGHTS: number = 2;
export const AI_ACTIVITY_INSIGHTS_MAX_RISK_INSIGHTS: number = 2;
export const AI_ACTIVITY_INSIGHTS_MAX_STOPPED_INSIGHTS: number = 2;

// How many of the incidents and alerts behind an insight it names.
export const AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE: number = 3;

/*
 * A problem is recurring once it came up this many times in the window
 * (incidents and alerts, investigated or not); it is worth an insight of its
 * own at AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN.
 */
export const AI_ACTIVITY_INSIGHTS_RECURRING_MIN: number = 2;
export const AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN: number = 3;

/*
 * A problem that kept coming back "has stopped" once nothing of it came up
 * for this many days after a fix that verification confirmed.
 */
export const AI_ACTIVITY_INSIGHTS_STOPPED_MIN_DAYS: number = 3;

/*
 * Your team approved every fix AI proposed: worth saying once it approved
 * this many.
 */
export const AI_ACTIVITY_INSIGHTS_READY_FOR_AUTOMATIC_MIN_APPROVED: number = 3;

/*
 * When a problem tends to happen: the busiest stretch of this many hours of
 * the (UTC) day, said only when the problem came up at least
 * TIME_OF_DAY_MIN_OCCURRENCES times on at least TIME_OF_DAY_MIN_DAYS days,
 * on at least TIME_OF_DAY_MIN_DAY_PERCENT percent of those days inside the
 * stretch, and at least TIME_OF_DAY_MIN_OCCURRENCE_PERCENT percent of the
 * times — a problem that fires all day long has no time of day.
 */
export const AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_HOURS: number = 3;
export const AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCES: number = 5;
export const AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAYS: number = 3;
export const AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_DAY_PERCENT: number = 75;
export const AI_ACTIVITY_INSIGHTS_TIME_OF_DAY_MIN_OCCURRENCE_PERCENT: number = 60;

// An incident or alert an insight or an investigation was about.
export interface AiActivitySubject {
  kind: "incident" | "alert";
  id: string;
  title?: string | undefined;
  // The incident's or alert's number, when it has one.
  number?: number | undefined;
  // The number with the project's prefix ("INC-42"), when the page reads it.
  numberWithPrefix?: string | undefined;
}

// A monitor or a service, by the name the caller may read.
export interface AiActivityNamedResource {
  id: string;
  name: string;
}

/*
 * One part of the scope a problem was about, named the way alerts name it
 * (SeriesLabelDisplay): "Namespace" / "default", "Pod" / "web-7d9f-2xk",
 * "Virtual Machine" / "db-01".
 */
export interface AiActivityObject {
  name: string;
  value: string;
  /*
   * The series label it was read from, normalised ("k8s.node.name"): what a
   * page needs to link the part to its own page, when it has one.
   */
  key?: string | undefined;
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
 * When a problem tends to happen: the busiest stretch of the day, in UTC
 * hours. A page says it in the reader's own time.
 */
export interface AiActivityTimeOfDay {
  // 0-23: the UTC hour the stretch starts at.
  startHourUtc: number;
  // How long the stretch is.
  hours: number;
  // The times the problem came up inside the stretch, out of all of them.
  count: number;
  total: number;
  // The days it came up inside the stretch, out of the days it came up at all.
  days: number;
  totalDays: number;
}

/*
 * What keeps going wrong here: the incidents and alerts AI investigated,
 * grouped by what raised them — the monitor (one problem however many pods
 * or hosts it fired for), else the subject's title — with every incident and
 * alert of the window that the same thing raised, investigated or not.
 */
export interface AiActivityProblem {
  // Opaque and stable for the same grouping: links insights to it.
  key: string;
  // The latest subject's title without the series identity alerts append.
  title: string;
  /*
   * How many times it came up in the window: its incidents and alerts,
   * investigated or not, and how many of them in the last 7 days and in the
   * 7 days before them.
   */
  occurrenceCount: number;
  recentOccurrenceCount: number;
  previousOccurrenceCount: number;
  // How often AI investigated it, across how many incidents and alerts.
  investigationCount: number;
  subjectCount: number;
  isRecurring: boolean;
  // ISO: when it first and last came up in the window.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  latestSubject: AiActivitySubject;
  // The parts of the scope it fired for, most frequent first.
  objects: Array<AiActivityObject & { count: number }>;
  /*
   * The monitors that raised it, the ones the caller may read, by name: on
   * the incidents' and alerts' pages, which read monitor names.
   */
  monitors?: Array<AiActivityNamedResource> | undefined;
  latestFinding?: AiActivityFinding | undefined;
  /*
   * The first step the latest finding's report suggested, in its own words
   * (plain text, capped): what OneUptime AI would do about it.
   */
  latestNextStep?: string | undefined;
  // When it tends to happen, when it keeps to one part of the day.
  timeOfDay?: AiActivityTimeOfDay | undefined;
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

// A part of the scope that keeps showing up in what went wrong here.
export interface AiActivityHotspot extends AiActivityObject {
  // The incidents and alerts of the window it was part of.
  occurrenceCount: number;
  // How many investigations it showed up in.
  investigationCount: number;
  // How many different problems it showed up in.
  problemCount: number;
  // ISO.
  lastSeenAt?: string | undefined;
}

/*
 * A monitor or service that keeps failing: one the incidents (or alerts) of
 * the window were raised for or affected, counted once per incident.
 */
export interface AiActivityResourceHotspot extends AiActivityNamedResource {
  // The window's incidents (or alerts) it was part of, investigated or not.
  occurrenceCount: number;
  // Distinct incidents (or alerts) AI investigated that it was part of.
  subjectCount: number;
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

/*
 * The fix pull requests of the window (AIRun, runType CodeFix) by where they
 * ended up.
 */
export interface AiActivityFixTaskOutcomes {
  total: number;
  pullRequestsOpened: number;
  noFixFound: number;
  inProgress: number;
  failed: number;
  cancelled: number;
}

/*
 * How much of the window AI looked at: the incidents (or alerts) created in
 * it that the caller may read, how many AI investigated, and why the others
 * were not, as each one's creation recorded it (most common first).
 */
export interface AiActivityCoverage {
  subjects: number;
  investigatedSubjects: number;
  notInvestigated: Array<{
    code: InvestigationNotStartedCode;
    count: number;
  }>;
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
 * own telemetry spiked, regressed or drifted, before anything paged (the
 * AI → Insights inbox).
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

// What an insight is about.
export enum AiActivityInsightKind {
  /*
   * A problem that keeps coming back: how often, whether it is getting
   * worse, when it tends to happen, what the investigations found and the
   * step they suggest.
   */
  RecurringProblem = "RecurringProblem",
  /*
   * One part of the scope (a node, a pod, a VM) — or, on the incidents' and
   * alerts' pages, one service or monitor — behind several different
   * problems and most of what came up.
   */
  Hotspot = "Hotspot",
  // A problem that kept coming back and stopped after a fix that held.
  ProblemStopped = "ProblemStopped",
  // Fixes AI applied on its own, and how many held.
  FixedAutomatically = "FixedAutomatically",
  // Fixes that were applied and did not solve the problem.
  FixesDidNotHelp = "FixesDidNotHelp",
  // Fixes waiting for someone to approve them.
  FixesAwaitingApproval = "FixesAwaitingApproval",
  /*
   * Your team approved every fix AI proposed here: AI could apply fixes
   * like these on its own, if it were allowed to.
   */
  ReadyForAutomaticFixes = "ReadyForAutomaticFixes",
  /*
   * Incidents (or alerts) AI could not look at, and what would let it: the
   * incidents' and alerts' pages.
   */
  NotInvestigated = "NotInvestigated",
  /*
   * An open High or Medium preventive finding about the scope's own
   * telemetry: a risk spotted before anything paged.
   */
  RiskSpotted = "RiskSpotted",
}

// How an insight reads, and how it ranks: the most urgent first.
export enum AiActivityInsightTone {
  // Something is wrong now, or getting worse.
  Critical = "Critical",
  // Worth acting on.
  Warning = "Warning",
  // Worth knowing: a pattern.
  Pattern = "Pattern",
  // Good news.
  Positive = "Positive",
}

/*
 * One thing worth knowing about the scope, most important first. The
 * dashboard words it from these fields; the server never sends prose here
 * of its own — only titles and names as the system holds them, and the
 * words an investigation wrote (finding, nextStep).
 */
export interface AiActivityInsight {
  kind: AiActivityInsightKind;
  tone: AiActivityInsightTone;
  /*
   * The number it is about: how many times a problem came up, how many
   * incidents and alerts a hotspot was part of, how many fixes.
   */
  count: number;
  // Out of how many, where the sentence reads that way.
  total?: number | undefined;
  /*
   * RecurringProblem: how many times in the last 7 days, and in the 7 days
   * before them.
   */
  recentCount?: number | undefined;
  previousCount?: number | undefined;
  // The problem it is about, by its key and its title.
  problemKey?: string | undefined;
  title?: string | undefined;
  // ISO: when the problem first and last came up in the window.
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  // ProblemStopped, ISO: when the fix that stopped it was applied.
  fixedAt?: string | undefined;
  // What OneUptime AI found, and the step its report suggested.
  finding?: AiActivityFinding | undefined;
  nextStep?: string | undefined;
  // RecurringProblem: when it tends to happen.
  timeOfDay?: AiActivityTimeOfDay | undefined;
  /*
   * Where: the part of the scope (Hotspot) or the parts a problem fired for
   * (RecurringProblem); the monitor or service (a Hotspot on the incidents'
   * and alerts' pages), or the monitors that raised a problem there.
   */
  object?: AiActivityObject | undefined;
  objects?: Array<AiActivityObject> | undefined;
  monitor?: AiActivityNamedResource | undefined;
  service?: AiActivityNamedResource | undefined;
  monitors?: Array<AiActivityNamedResource> | undefined;
  // Hotspot: how many different problems it was part of.
  problemCount?: number | undefined;
  /*
   * The incident or alert its next step opens (the newest one behind it),
   * when it is one the caller may read.
   */
  subject?: AiActivitySubject | undefined;
  /*
   * The incidents and alerts behind it the caller may read, newest first
   * (at most AI_ACTIVITY_INSIGHTS_MAX_EVIDENCE), and how many there are in
   * all.
   */
  evidence?: Array<AiActivitySubject> | undefined;
  evidenceCount?: number | undefined;
  // FixedAutomatically, ReadyForAutomaticFixes: how many were checked and held.
  verifiedCount?: number | undefined;
  // RiskSpotted.
  insightId?: string | undefined;
  insightSeverity?: string | undefined;
  insightType?: string | undefined;
  // NotInvestigated: why, the most common reason worth acting on.
  reason?: InvestigationNotStartedCode | undefined;
}

export interface AiActivityInsightsTotals {
  /*
   * The incidents and alerts of the window the page read (the scope's, the
   * ones the caller may read), investigated or not.
   */
  occurrences: number;
  investigations: number;
  completedInvestigations: number;
  // Ended in an error, or timed out.
  failedInvestigations: number;
  // Queued, running, or waiting for approval.
  activeInvestigations: number;
  // What people confirmed (or the grader matched), and what they rejected (or the grader did not).
  confirmedFindings: number;
  rejectedFindings: number;
  problems: number;
  recurringProblems: number;
  fixes: number;
  // Commands AI ran on the scope; the AI agent page's connection tests are not counted.
  commands: number;
  // Commands that ran and failed (a non-zero exit, or the agent's error).
  failedCommands: number;
  // Commands the agent never picked up in time.
  timedOutCommands: number;
  // The fix pull requests AI was asked to open (the incidents' and alerts' pages).
  fixTasks?: number | undefined;
}

export interface AiActivityInsights {
  windowInDays: number;
  // ISO.
  windowStart: string;
  generatedAt: string;
  totals: AiActivityInsightsTotals;
  // What is worth knowing, most important first.
  insights: Array<AiActivityInsight>;
  problems: Array<AiActivityProblem>;
  hotspots: Array<AiActivityHotspot>;
  fixOutcomes: AiActivityFixOutcomes;
  // One entry per day of the window, oldest first.
  trend: Array<AiActivityTrendDay>;
  preventiveInsights: Array<AiActivityPreventiveInsight>;
  /*
   * True when the window held more incidents, alerts, investigations, fixes
   * or commands than were read, so the numbers cover the newest of them only.
   */
  isPartial: boolean;

  /*
   * The sections only a project's incidents' or alerts' page has; a
   * cluster's and a resource's leave them out.
   */
  // The product the page is about: every subject is of this kind.
  subjectKind?: "incident" | "alert" | undefined;
  coverage?: AiActivityCoverage | undefined;
  // The monitors and services that keep failing, the most incidents first.
  monitors?: Array<AiActivityResourceHotspot> | undefined;
  services?: Array<AiActivityResourceHotspot> | undefined;
  fixTaskOutcomes?: AiActivityFixTaskOutcomes | undefined;
  /*
   * True when the caller may not read fixes (auto-remediation suggestions):
   * every fix number is then 0 and the page says why instead of showing them.
   */
  fixesHidden?: boolean | undefined;
}
