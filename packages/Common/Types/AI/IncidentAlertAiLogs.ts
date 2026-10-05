/*
 * Everything OneUptime AI did for a project's incidents, or for its alerts,
 * newest first: the response of the AI Logs page of the Incidents and Alerts
 * menus' AI section (POST /ai-activity/incident/logs and
 * POST /ai-activity/alert/logs). The product-wide twin of a cluster's or a
 * resource's AI Logs (KubernetesClusterAiLogs, ResourceAiLogs), which list
 * the same kinds of work for what happened on one cluster or resource.
 *
 * One chronological record of four kinds of entry, each linked to the
 * incident or alert it was for:
 *
 *   - Investigation: an AI investigation (AIRun, runType Investigation) and
 *     the one-line finding it published (its TL;DR).
 *   - Fix: a fix AI proposed or applied, the auto-remediation suggestion a
 *     rule or a cluster's or resource's Fixes setting produced: a runbook or
 *     a command plan, how it ran and how its verification turned out.
 *   - FixTask: a fix pull request AI was asked to open (AIRun, runType
 *     CodeFix): the root cause an investigation found, or the telemetry an
 *     inconclusive one was missing.
 *   - Command: a command AI ran while investigating or fixing (RunnerJob).
 *
 * Summaries only: never a prompt, a command's output or a command plan, and
 * nothing about an incident or alert the caller may not read. Fixes need
 * read access to auto-remediation suggestions and commands need read access
 * to Runner jobs, the tables they come from; without it the kind is listed
 * in hiddenKinds rather than shown as empty.
 */

export type IncidentAlertAiSubjectKind = "incident" | "alert";

export const INCIDENT_ALERT_AI_SUBJECT_KINDS: ReadonlyArray<IncidentAlertAiSubjectKind> =
  ["incident", "alert"];

export const INCIDENT_ALERT_AI_LOGS_PATHS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: "/ai-activity/incident/logs",
  alert: "/ai-activity/alert/logs",
};

export enum IncidentAlertAiLogKind {
  Investigation = "Investigation",
  Fix = "Fix",
  FixTask = "FixTask",
  Command = "Command",
}

export const INCIDENT_ALERT_AI_LOG_KINDS: ReadonlyArray<IncidentAlertAiLogKind> =
  [
    IncidentAlertAiLogKind.Investigation,
    IncidentAlertAiLogKind.Fix,
    IncidentAlertAiLogKind.FixTask,
    IncidentAlertAiLogKind.Command,
  ];

// How many entries a page holds, at most (a tie with the last one may add a few).
export const INCIDENT_ALERT_AI_LOGS_PAGE_SIZE: number = 50;

// How much of a fix's rationale, and of a failed command's error, travels.
export const INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH: number = 300;

// How much of a command, as the agent displays it, travels.
export const INCIDENT_ALERT_AI_LOGS_COMMAND_MAX_LENGTH: number = 500;

// The incident or alert an entry was for.
export interface IncidentAlertAiLogSubject {
  kind: IncidentAlertAiSubjectKind;
  id: string;
  title?: string | undefined;
  number?: number | undefined;
  // The number with the project's prefix ("INC-42"), when it has one.
  numberWithPrefix?: string | undefined;
}

export interface IncidentAlertAiLogEntry {
  kind: IncidentAlertAiLogKind;
  // The row's own id: the AI run, the suggestion or the Runner job.
  id: string;
  // ISO: when it was created.
  at: string;
  subject: IncidentAlertAiLogSubject;
  /*
   * In the row's own vocabulary: AIRunStatus (Investigation, FixTask),
   * AutoRemediationSuggestionStatus (Fix), RunnerJobStatus (Command).
   */
  status?: string | undefined;
  // ISO: when an investigation or a fix task finished.
  completedAt?: string | undefined;

  // Investigation: its TL;DR, what people and the grader made of it.
  summary?: string | undefined;
  // AIRunHumanVerdict and AIRunAutoGrade.
  humanVerdict?: string | undefined;
  autoGrade?: string | undefined;

  /*
   * Fix.
   * AutoRemediationSuggestionType and AutoRemediationExecutionMode.
   */
  suggestionType?: string | undefined;
  executionMode?: string | undefined;
  // The first INCIDENT_ALERT_AI_LOGS_TEXT_MAX_LENGTH characters.
  rationale?: string | undefined;
  // AutoRemediationVerificationStatus.
  verificationStatus?: string | undefined;
  runbookName?: string | undefined;
  ruleName?: string | undefined;

  // FixTask: the task's number and its recipe (CodeFixTaskType).
  taskNumber?: number | undefined;
  codeFixTaskType?: string | undefined;

  // Command: what ran, why (RunnerJobOrigin), and how it ended.
  command?: string | undefined;
  commandOrigin?: string | undefined;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

export interface IncidentAlertAiLogsRequest {
  /*
   * ISO: only entries created before this moment, as the previous page's
   * nextBefore said. The newest entries when left out.
   */
  before?: string | undefined;
  // Only these kinds; every kind when left out.
  kinds?: Array<IncidentAlertAiLogKind> | undefined;
}

export interface IncidentAlertAiLogs {
  subjectKind: IncidentAlertAiSubjectKind;
  // Newest first.
  entries: Array<IncidentAlertAiLogEntry>;
  /*
   * ISO: where the next page starts (its request's `before`). Null once the
   * start of the record is reached.
   */
  nextBefore: string | null;
  // Kinds the caller may not read: left out, rather than empty.
  hiddenKinds: Array<IncidentAlertAiLogKind>;
}
