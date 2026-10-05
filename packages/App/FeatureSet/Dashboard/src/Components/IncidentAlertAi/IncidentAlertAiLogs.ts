import { describeSubject } from "../AI/ActivityInsights/AiActivityInsightsData";
import {
  ResourceAiStatusLook,
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
  getResourceInvestigationSummary,
} from "../ResourceAiAgent/ResourceAiLogs";
import AIRunAutoGrade from "Common/Types/AI/AIRunAutoGrade";
import AIRunHumanVerdict from "Common/Types/AI/AIRunHumanVerdict";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  INCIDENT_ALERT_AI_LOG_KINDS,
  IncidentAlertAiLogKind,
  IncidentAlertAiSubjectKind,
} from "Common/Types/AI/IncidentAlertAiLogs";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import { JSONObject } from "Common/Types/JSON";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of the AI Logs page of the Incidents and Alerts menus
 * (IncidentAlertAiLogsPage): how the page reads the logs route's body
 * (Common/Types/AI/IncidentAlertAiLogs.ts) and the words for each entry.
 * Import-clean (Common types and the shared AI pages' word helpers only),
 * so the suites read it without a browser. Every label is English, wrapped
 * in translationKey() so the extractor finds it, and translated where it is
 * drawn.
 *
 * What a cluster's and a resource's AI Logs say too is theirs, said the same
 * way here: an investigation's and a fix's status (ResourceAiLogs), what an
 * investigation found - its TL;DR, else its report's own Summary - and how
 * an incident or alert is named (AiActivityInsightsData). What only this
 * record has (fix pull requests, commands with their incident, the filter
 * and the pages) is its own.
 */

export const AI_LOGS_PAGE_TITLE: string = translationKey("AI Logs");

export const AI_LOGS_PAGE_SUBTITLES: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "Everything OneUptime AI did for your incidents, newest first: every investigation, fix and command, each linked to its incident.",
  ),
  alert: translationKey(
    "Everything OneUptime AI did for your alerts, newest first: every investigation, fix and command, each linked to its alert.",
  ),
};

export const AI_LOGS_EMPTY_TITLE: string = translationKey(
  "OneUptime AI has not done anything here yet",
);

export const AI_LOGS_EMPTY_DESCRIPTIONS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "When OneUptime AI investigates an incident, proposes or applies a fix, opens a fix pull request or runs a command, it is recorded here.",
  ),
  alert: translationKey(
    "When OneUptime AI investigates an alert, proposes or applies a fix, opens a fix pull request or runs a command, it is recorded here.",
  ),
};

// The filter above the record: everything, or one kind of entry.
export const ALL_KINDS_FILTER: string = "All";

export interface AiLogsFilterOption {
  value: string;
  label: string;
}

export const AI_LOGS_FILTER_OPTIONS: Array<AiLogsFilterOption> = [
  { value: ALL_KINDS_FILTER, label: translationKey("Everything") },
  {
    value: IncidentAlertAiLogKind.Investigation,
    label: translationKey("Investigations"),
  },
  { value: IncidentAlertAiLogKind.Fix, label: translationKey("Fixes") },
  {
    value: IncidentAlertAiLogKind.FixTask,
    label: translationKey("Fix pull requests"),
  },
  { value: IncidentAlertAiLogKind.Command, label: translationKey("Commands") },
];

// The kinds a filter value asks the route for; undefined is every kind.
export function getKindsForFilter(
  filter: string,
): Array<IncidentAlertAiLogKind> | undefined {
  return INCIDENT_ALERT_AI_LOG_KINDS.includes(filter as IncidentAlertAiLogKind)
    ? [filter as IncidentAlertAiLogKind]
    : undefined;
}

/*
 * Why a kind is missing from the record, for a caller whose role may not read
 * it (the route's hiddenKinds).
 */
export const AI_LOGS_HIDDEN_KIND_NOTES: Partial<
  Record<IncidentAlertAiLogKind, string>
> = {
  [IncidentAlertAiLogKind.Fix]: translationKey(
    "Fixes are not shown: seeing them needs permission to read auto-remediation suggestions.",
  ),
  [IncidentAlertAiLogKind.Command]: translationKey(
    "Commands are not shown: seeing them needs permission to read Runner jobs.",
  ),
};

/*
 * The rows below are the page's normalised reading of the route's body:
 * every field the contract leaves optional is null here when it is missing
 * or unreadable.
 */
export interface AiLogsSubject {
  kind: IncidentAlertAiSubjectKind;
  id: string;
  title: string | null;
  number: number | null;
  numberWithPrefix: string | null;
}

export interface AiLogsEntry {
  kind: IncidentAlertAiLogKind;
  id: string;
  at: string;
  subject: AiLogsSubject;
  status: string | null;
  completedAt: string | null;
  summary: string | null;
  reportSummary: string | null;
  humanVerdict: string | null;
  autoGrade: string | null;
  suggestionType: string | null;
  executionMode: string | null;
  rationale: string | null;
  verificationStatus: string | null;
  runbookName: string | null;
  ruleName: string | null;
  taskNumber: number | null;
  codeFixTaskType: string | null;
  command: string | null;
  commandOrigin: string | null;
  exitCode: number | null;
  errorMessage: string | null;
}

export interface AiLogs {
  entries: Array<AiLogsEntry>;
  nextBefore: string | null;
  hiddenKinds: Array<IncidentAlertAiLogKind>;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A string the server may have sent bare or in its serialized
 * { _type, value } envelope (ObjectID, DateTime). Anything else - a number,
 * an empty string, an object without a string value - is no value.
 */
function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (isObject(value) && typeof value["value"] === "string") {
    return value["value"].trim() ? value["value"] : null;
  }

  return null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readDate(value: unknown): string | null {
  const text: string | null = readString(value);

  if (!text || Number.isNaN(Date.parse(text))) {
    return null;
  }

  return text;
}

function parseSubject(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiLogsSubject | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);

  // An entry about the other product's subject has nowhere to link.
  if (!id || (value["kind"] !== undefined && value["kind"] !== subjectKind)) {
    return null;
  }

  return {
    kind: subjectKind,
    id,
    title: readString(value["title"]),
    number: readNumber(value["number"]),
    numberWithPrefix: readString(value["numberWithPrefix"]),
  };
}

function parseEntry(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiLogsEntry | null {
  if (!isObject(value)) {
    return null;
  }

  const kind: IncidentAlertAiLogKind = value["kind"] as IncidentAlertAiLogKind;
  const id: string | null = readString(value["id"]);
  const at: string | null = readDate(value["at"]);
  const subject: AiLogsSubject | null = parseSubject(
    value["subject"],
    subjectKind,
  );

  // A kind a newer server added has no words here yet: it is left out.
  if (!INCIDENT_ALERT_AI_LOG_KINDS.includes(kind) || !id || !at || !subject) {
    return null;
  }

  return {
    kind,
    id,
    at,
    subject,
    status: readString(value["status"]),
    completedAt: readDate(value["completedAt"]),
    summary: readString(value["summary"]),
    reportSummary: readString(value["reportSummary"]),
    humanVerdict: readString(value["humanVerdict"]),
    autoGrade: readString(value["autoGrade"]),
    suggestionType: readString(value["suggestionType"]),
    executionMode: readString(value["executionMode"]),
    rationale: readString(value["rationale"]),
    verificationStatus: readString(value["verificationStatus"]),
    runbookName: readString(value["runbookName"]),
    ruleName: readString(value["ruleName"]),
    taskNumber: readNumber(value["taskNumber"]),
    codeFixTaskType: readString(value["codeFixTaskType"]),
    command: readString(value["command"]),
    commandOrigin: readString(value["commandOrigin"]),
    exitCode: readNumber(value["exitCode"]),
    errorMessage: readString(value["errorMessage"]),
  };
}

/*
 * The logs as the route returns them, or null when the body is not that
 * shape at all. An entry the page cannot read (no id, no time, no subject
 * of this product, a kind it does not know) is dropped; everything else is
 * optional and read defensively where it is shown. Server text is only ever
 * rendered as plain text.
 */
export function parseAiLogs(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiLogs | null {
  if (!isObject(value) || !Array.isArray(value["entries"])) {
    return null;
  }

  const entries: Array<AiLogsEntry> = [];
  const seen: Set<string> = new Set<string>();

  for (const row of value["entries"]) {
    const entry: AiLogsEntry | null = parseEntry(row, subjectKind);

    if (entry && !seen.has(`${entry.kind}:${entry.id}`)) {
      seen.add(`${entry.kind}:${entry.id}`);
      entries.push(entry);
    }
  }

  const hiddenKinds: Array<IncidentAlertAiLogKind> = Array.isArray(
    value["hiddenKinds"],
  )
    ? INCIDENT_ALERT_AI_LOG_KINDS.filter(
        (kind: IncidentAlertAiLogKind): boolean => {
          return (value["hiddenKinds"] as Array<unknown>).includes(kind);
        },
      )
    : [];

  return {
    entries,
    nextBefore: readDate(value["nextBefore"]),
    hiddenKinds,
  };
}

/*
 * A next page's entries after the ones already shown. An entry already on
 * the page (the same kind and id) is not added twice.
 */
export function appendAiLogsEntries(
  shown: Array<AiLogsEntry>,
  more: Array<AiLogsEntry>,
): Array<AiLogsEntry> {
  const seen: Set<string> = new Set<string>(
    shown.map((entry: AiLogsEntry): string => {
      return `${entry.kind}:${entry.id}`;
    }),
  );

  return [
    ...shown,
    ...more.filter((entry: AiLogsEntry): boolean => {
      return !seen.has(`${entry.kind}:${entry.id}`);
    }),
  ];
}

// What each kind of entry is called, on its own line.
export const AI_LOG_KIND_LABELS: Record<IncidentAlertAiLogKind, string> = {
  [IncidentAlertAiLogKind.Investigation]: translationKey("Investigation"),
  [IncidentAlertAiLogKind.Fix]: translationKey("Fix"),
  [IncidentAlertAiLogKind.FixTask]: translationKey("Fix pull request"),
  [IncidentAlertAiLogKind.Command]: translationKey("Command"),
};

// An entry's status pill: what it says (translated where drawn) and its color.
export type AiLogsStatusLook = ResourceAiStatusLook;

/*
 * A fix pull request task finishes by opening the pull request; every other
 * status reads as an investigation's.
 */
const FIX_TASK_STATUS_LOOKS: Partial<Record<AIRunStatus, AiLogsStatusLook>> = {
  [AIRunStatus.Running]: {
    label: translationKey("In progress"),
    color: Yellow500,
  },
  [AIRunStatus.Completed]: {
    label: translationKey("Pull request opened"),
    color: Green500,
  },
};

const COMMAND_STATUS_LOOKS: Record<RunnerJobStatus, AiLogsStatusLook> = {
  [RunnerJobStatus.Pending]: {
    label: translationKey("Waiting to run"),
    color: Yellow500,
  },
  [RunnerJobStatus.Claimed]: {
    label: translationKey("Starting"),
    color: Yellow500,
  },
  [RunnerJobStatus.Running]: {
    label: translationKey("Running"),
    color: Yellow500,
  },
  [RunnerJobStatus.Succeeded]: {
    label: translationKey("Succeeded"),
    color: Green500,
  },
  [RunnerJobStatus.Failed]: { label: translationKey("Failed"), color: Red500 },
  [RunnerJobStatus.TimedOut]: {
    label: translationKey("Not picked up in time"),
    color: Red500,
  },
  [RunnerJobStatus.Cancelled]: {
    label: translationKey("Cancelled"),
    color: Gray500,
  },
};

/*
 * An entry's status pill: an investigation's and a fix's as a resource's AI
 * Logs show them. A status a newer server added shows as it is, in a
 * neutral pill; an entry without one has none.
 */
export function getAiLogStatusLook(
  entry: Pick<AiLogsEntry, "kind" | "status">,
): AiLogsStatusLook | null {
  if (!entry.status) {
    return null;
  }

  switch (entry.kind) {
    case IncidentAlertAiLogKind.Investigation:
      return getResourceInvestigationStatusLook(entry.status);
    case IncidentAlertAiLogKind.FixTask:
      return (
        FIX_TASK_STATUS_LOOKS[entry.status as AIRunStatus] ||
        getResourceInvestigationStatusLook(entry.status)
      );
    case IncidentAlertAiLogKind.Fix:
      return getResourceFixStatusLook(entry.status);
    default:
      return (
        COMMAND_STATUS_LOOKS[entry.status as RunnerJobStatus] || {
          label: entry.status,
          color: Gray500,
        }
      );
  }
}

const VERIFICATION_LABELS: Record<AutoRemediationVerificationStatus, string> = {
  [AutoRemediationVerificationStatus.Pending]: translationKey(
    "Checking whether it worked",
  ),
  [AutoRemediationVerificationStatus.Verified]: translationKey(
    "It worked: the problem cleared",
  ),
  [AutoRemediationVerificationStatus.Failed]: translationKey(
    "It did not fix the problem",
  ),
  [AutoRemediationVerificationStatus.Skipped]: translationKey(
    "Not verified: nothing to check it against",
  ),
};

export function describeVerification(status: string | null): string | null {
  return status
    ? VERIFICATION_LABELS[status as AutoRemediationVerificationStatus] || null
    : null;
}

// What kind of fix a suggestion is: a runbook, or a plan of commands.
export function describeFixKind(suggestionType: string | null): string | null {
  if (suggestionType === AutoRemediationSuggestionType.CommandPlan) {
    return translationKey("Command plan");
  }

  if (suggestionType === AutoRemediationSuggestionType.Runbook) {
    return translationKey("Runbook");
  }

  return null;
}

export function describeExecutionMode(mode: string | null): string | null {
  if (mode === AutoRemediationExecutionMode.FullAuto) {
    return translationKey("Runs without approval");
  }

  if (mode === AutoRemediationExecutionMode.Suggest) {
    return translationKey("Asks for approval");
  }

  return null;
}

const FIX_TASK_TYPE_LABELS: Partial<Record<CodeFixTaskType, string>> = {
  [CodeFixTaskType.FixFromIncident]: translationKey(
    "Fix the root cause the investigation found",
  ),
  [CodeFixTaskType.ImproveInstrumentation]: translationKey(
    "Add the telemetry the investigation was missing",
  ),
};

export function describeFixTaskType(taskType: string | null): string | null {
  return taskType
    ? FIX_TASK_TYPE_LABELS[taskType as CodeFixTaskType] || null
    : null;
}

export function describeCommandOrigin(origin: string | null): string | null {
  if (origin === RunnerJobOrigin.AiInvestigation) {
    return translationKey("While investigating (read-only)");
  }

  if (origin === RunnerJobOrigin.AiRemediation) {
    return translationKey("To fix it");
  }

  return null;
}

// What people, and the grader, made of an investigation's finding.
export function describeVerdicts(entry: {
  humanVerdict: string | null;
  autoGrade: string | null;
}): Array<string> {
  const lines: Array<string> = [];

  if (entry.humanVerdict === AIRunHumanVerdict.Confirmed) {
    lines.push(translationKey("Confirmed by your team"));
  } else if (entry.humanVerdict === AIRunHumanVerdict.Rejected) {
    lines.push(translationKey("Rejected by your team"));
  }

  if (entry.autoGrade === AIRunAutoGrade.Match) {
    lines.push(translationKey("Matched the recorded root cause"));
  } else if (entry.autoGrade === AIRunAutoGrade.Partial) {
    lines.push(translationKey("Partly matched the recorded root cause"));
  } else if (entry.autoGrade === AIRunAutoGrade.Mismatch) {
    lines.push(translationKey("Did not match the recorded root cause"));
  }

  return lines;
}

/*
 * What an entry says under its headline: an investigation's finding, a
 * fix's reason, a command, or why there is nothing to show yet. Text the
 * server wrote (a finding, a reason, a command) is shown as it is; the
 * page's own words are translated where they are drawn, except an
 * investigation's, which come translated from the resource AI Logs' own
 * helper.
 */
export interface AiLogDetail {
  text: string;
  isOwnWords: boolean;
  isCommand: boolean;
}

export function getAiLogDetail(entry: AiLogsEntry): AiLogDetail | null {
  const serverText: (text: string | null) => AiLogDetail | null = (
    text: string | null,
  ): AiLogDetail | null => {
    return text
      ? {
          text,
          isOwnWords: false,
          isCommand: entry.kind === IncidentAlertAiLogKind.Command,
        }
      : null;
  };
  const ownWords: (text: string | null) => AiLogDetail | null = (
    text: string | null,
  ): AiLogDetail | null => {
    return text ? { text, isOwnWords: true, isCommand: false } : null;
  };

  switch (entry.kind) {
    case IncidentAlertAiLogKind.Investigation:
      // Its TL;DR, its report's Summary, or why there is none.
      return serverText(
        getResourceInvestigationSummary({
          analysisTldr: entry.summary,
          reportSummary: entry.reportSummary,
          status: entry.status,
        }),
      );
    case IncidentAlertAiLogKind.Fix:
      return serverText(entry.rationale);
    case IncidentAlertAiLogKind.FixTask:
      return ownWords(describeFixTaskType(entry.codeFixTaskType));
    case IncidentAlertAiLogKind.Command:
      return serverText(entry.command);
    default:
      return null;
  }
}

/*
 * The incident or alert an entry was for, named the way every AI page names
 * one (AiActivityInsightsData.describeSubject): "Incident INC-42: Checkout
 * is down", with the project's prefix when it has one.
 */
export function getAiLogSubjectLabel(subject: AiLogsSubject): string {
  return describeSubject({
    kind: subject.kind,
    id: subject.id,
    ...(subject.title ? { title: subject.title } : {}),
    ...(subject.number !== null ? { number: subject.number } : {}),
    ...(subject.numberWithPrefix
      ? { numberWithPrefix: subject.numberWithPrefix }
      : {}),
  });
}
