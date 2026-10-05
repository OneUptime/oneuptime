import {
  IncidentAlertAiAttentionKind,
  IncidentAlertAiAttentionSeverity,
} from "Common/Types/AI/IncidentAlertAiInsights";
import { IncidentAlertAiSubjectKind } from "Common/Types/AI/IncidentAlertAiLogs";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "Common/Types/JSON";
import {
  PluralTemplate,
  TemplateValues,
  translatableTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { AiLogsSubject } from "./IncidentAlertAiLogs";

/*
 * The pure half of the AI Insights page of the Incidents and Alerts menus
 * (IncidentAlertAiInsightsPage): how the page reads the insights route's
 * body (Common/Types/AI/IncidentAlertAiInsights.ts) and the words for what
 * it shows. Import-clean (Common types only), so the suites read it without
 * a browser. Every sentence is English, kept whole - with its numbers as
 * {{placeholders}}, and a PluralTemplate where a count changes the wording -
 * and translated where it is drawn. The server sends numbers and names,
 * never prose.
 */

export const AI_INSIGHTS_PAGE_TITLE: string = translationKey("AI Insights");

export const AI_INSIGHTS_PAGE_SUBTITLES: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "What OneUptime AI learned from your incidents over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
  ),
  alert: translationKey(
    "What OneUptime AI learned from your alerts over the last 30 days: what keeps happening, what its investigations found, which monitors and services keep failing, and how its fixes turned out.",
  ),
};

export const AI_INSIGHTS_EMPTY_TITLE: string = translationKey(
  "Nothing to learn from yet",
);

export const AI_INSIGHTS_EMPTY_DESCRIPTIONS: Record<
  IncidentAlertAiSubjectKind,
  string
> = {
  incident: translationKey(
    "OneUptime AI has not investigated or fixed an incident in the last 30 days. Once it does, what keeps happening, what it found and how its fixes turned out show here.",
  ),
  alert: translationKey(
    "OneUptime AI has not investigated or fixed an alert in the last 30 days. Once it does, what keeps happening, what it found and how its fixes turned out show here.",
  ),
};

export const AI_INSIGHTS_PARTIAL_NOTE: string = translationKey(
  "There was more AI work in the last 30 days than these insights read at once, so they cover the most recent of it.",
);

export const AI_INSIGHTS_FIXES_HIDDEN_NOTE: string = translationKey(
  "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
);

/*
 * The page's reading of the route's body: every number is a number (0
 * when missing), every list a list, and anything optional null when it is
 * missing or unreadable. A list item without what it needs to be shown is
 * dropped.
 */
export interface AiInsightsNamedResource {
  id: string;
  name: string;
}

export interface AiInsightsFinding {
  aiRunId: string;
  text: string;
  at: string | null;
}

export interface AiInsightsProblem {
  key: string;
  title: string;
  investigationCount: number;
  subjectCount: number;
  isRecurring: boolean;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestSubject: AiLogsSubject;
  monitors: Array<AiInsightsNamedResource>;
  latestFinding: AiInsightsFinding | null;
  verdicts: {
    confirmed: number;
    rejected: number;
    matched: number;
    partlyMatched: number;
    mismatched: number;
  };
  fixes: {
    proposed: number;
    applied: number;
    verified: number;
    failed: number;
    awaitingApproval: number;
  };
}

export interface AiInsightsHotspot extends AiInsightsNamedResource {
  subjectCount: number;
  investigationCount: number;
  problemCount: number;
  lastSeenAt: string | null;
}

export interface AiInsightsAttentionItem {
  kind: IncidentAlertAiAttentionKind;
  severity: IncidentAlertAiAttentionSeverity;
  count: number;
  total: number | null;
  recentCount: number | null;
  problemKey: string | null;
  title: string | null;
  reason: InvestigationNotStartedCode | null;
  monitor: AiInsightsNamedResource | null;
  subject: AiLogsSubject | null;
}

export interface AiInsightsFixOutcomes {
  total: number;
  planning: number;
  awaitingApproval: number;
  appliedAutomatically: number;
  appliedAfterApproval: number;
  dismissed: number;
  noFixFound: number;
  verified: number;
  failed: number;
  verifying: number;
}

export interface AiInsightsFixTaskOutcomes {
  total: number;
  pullRequestsOpened: number;
  noFixFound: number;
  inProgress: number;
  failed: number;
  cancelled: number;
}

export interface AiInsightsTrendDay {
  date: string;
  investigations: number;
  failedInvestigations: number;
  fixes: number;
}

export interface AiInsights {
  windowInDays: number;
  windowStart: string | null;
  generatedAt: string | null;
  totals: {
    investigations: number;
    completedInvestigations: number;
    failedInvestigations: number;
    activeInvestigations: number;
    problems: number;
    recurringProblems: number;
    fixes: number | null;
    fixTasks: number;
    commands: number;
    failedCommands: number;
    timedOutCommands: number;
  };
  coverage: {
    subjects: number;
    investigatedSubjects: number;
    notInvestigated: Array<{
      code: InvestigationNotStartedCode;
      count: number;
    }>;
  };
  attention: Array<AiInsightsAttentionItem>;
  problems: Array<AiInsightsProblem>;
  monitors: Array<AiInsightsHotspot>;
  services: Array<AiInsightsHotspot>;
  fixOutcomes: AiInsightsFixOutcomes | null;
  fixTaskOutcomes: AiInsightsFixTaskOutcomes;
  verdicts: {
    confirmed: number;
    rejected: number;
    matched: number;
    partlyMatched: number;
    mismatched: number;
  };
  trend: Array<AiInsightsTrendDay>;
  isPartial: boolean;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (isObject(value) && typeof value["value"] === "string") {
    return value["value"].trim() ? value["value"] : null;
  }

  return null;
}

// A count: a finite number, never below zero; 0 when missing.
function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readOptionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function readDate(value: unknown): string | null {
  const text: string | null = readString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function readList<T>(
  value: unknown,
  readItem: (item: unknown) => T | null,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const items: Array<T> = [];

  for (const item of value) {
    const read: T | null = readItem(item);

    if (read) {
      items.push(read);
    }
  }

  return items;
}

function readCounts<K extends string>(
  value: unknown,
  keys: ReadonlyArray<K>,
): Record<K, number> {
  const source: JSONObject = isObject(value) ? value : {};
  const counts: Record<K, number> = {} as Record<K, number>;

  for (const key of keys) {
    counts[key] = readCount(source[key]);
  }

  return counts;
}

function readSubject(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiLogsSubject | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);

  if (!id || (value["kind"] !== undefined && value["kind"] !== subjectKind)) {
    return null;
  }

  return {
    kind: subjectKind,
    id,
    title: readString(value["title"]),
    number:
      typeof value["number"] === "number" && Number.isFinite(value["number"])
        ? (value["number"] as number)
        : null,
    numberWithPrefix: readString(value["numberWithPrefix"]),
  };
}

function readNamed(value: unknown): AiInsightsNamedResource | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  const name: string | null = readString(value["name"]);

  return id && name ? { id, name } : null;
}

function readHotspot(value: unknown): AiInsightsHotspot | null {
  const named: AiInsightsNamedResource | null = readNamed(value);

  if (!named || !isObject(value)) {
    return null;
  }

  return {
    ...named,
    subjectCount: readCount(value["subjectCount"]),
    investigationCount: readCount(value["investigationCount"]),
    problemCount: readCount(value["problemCount"]),
    lastSeenAt: readDate(value["lastSeenAt"]),
  };
}

const VERDICT_KEYS: ReadonlyArray<
  "confirmed" | "rejected" | "matched" | "partlyMatched" | "mismatched"
> = ["confirmed", "rejected", "matched", "partlyMatched", "mismatched"];

const PROBLEM_FIX_KEYS: ReadonlyArray<
  "proposed" | "applied" | "verified" | "failed" | "awaitingApproval"
> = ["proposed", "applied", "verified", "failed", "awaitingApproval"];

const FIX_OUTCOME_KEYS: ReadonlyArray<keyof AiInsightsFixOutcomes> = [
  "total",
  "planning",
  "awaitingApproval",
  "appliedAutomatically",
  "appliedAfterApproval",
  "dismissed",
  "noFixFound",
  "verified",
  "failed",
  "verifying",
];

const FIX_TASK_OUTCOME_KEYS: ReadonlyArray<keyof AiInsightsFixTaskOutcomes> = [
  "total",
  "pullRequestsOpened",
  "noFixFound",
  "inProgress",
  "failed",
  "cancelled",
];

const ATTENTION_KINDS: ReadonlyArray<string> = Object.values(
  IncidentAlertAiAttentionKind,
);
const ATTENTION_SEVERITIES: ReadonlyArray<string> = Object.values(
  IncidentAlertAiAttentionSeverity,
);

function readProblem(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiInsightsProblem | null {
  if (!isObject(value)) {
    return null;
  }

  const key: string | null = readString(value["key"]);
  const latestSubject: AiLogsSubject | null = readSubject(
    value["latestSubject"],
    subjectKind,
  );

  if (!key || !latestSubject) {
    return null;
  }

  const finding: unknown = value["latestFinding"];
  const findingText: string | null = isObject(finding)
    ? readString(finding["text"])
    : null;

  return {
    key,
    title: readString(value["title"]) || "",
    investigationCount: readCount(value["investigationCount"]),
    subjectCount: readCount(value["subjectCount"]),
    isRecurring: value["isRecurring"] === true,
    firstSeenAt: readDate(value["firstSeenAt"]),
    lastSeenAt: readDate(value["lastSeenAt"]),
    latestSubject,
    monitors: readList(value["monitors"], readNamed),
    latestFinding:
      isObject(finding) && findingText
        ? {
            aiRunId: readString(finding["aiRunId"]) || "",
            text: findingText,
            at: readDate(finding["at"]),
          }
        : null,
    verdicts: readCounts(value["verdicts"], VERDICT_KEYS),
    fixes: readCounts(value["fixes"], PROBLEM_FIX_KEYS),
  };
}

function readAttentionItem(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiInsightsAttentionItem | null {
  if (
    !isObject(value) ||
    !ATTENTION_KINDS.includes(String(value["kind"])) ||
    !ATTENTION_SEVERITIES.includes(String(value["severity"]))
  ) {
    return null;
  }

  return {
    kind: value["kind"] as IncidentAlertAiAttentionKind,
    severity: value["severity"] as IncidentAlertAiAttentionSeverity,
    count: readCount(value["count"]),
    total: readOptionalCount(value["total"]),
    recentCount: readOptionalCount(value["recentCount"]),
    problemKey: readString(value["problemKey"]),
    title: readString(value["title"]),
    reason: readString(value["reason"]) as InvestigationNotStartedCode | null,
    monitor: readNamed(value["monitor"]),
    subject: readSubject(value["subject"], subjectKind),
  };
}

/*
 * The insights as the route returns them, or null when the body is not
 * that shape at all (no totals). Server text (a title, a finding, a name)
 * is only ever rendered as plain text.
 */
export function parseAiInsights(
  value: unknown,
  subjectKind: IncidentAlertAiSubjectKind,
): AiInsights | null {
  if (!isObject(value) || !isObject(value["totals"])) {
    return null;
  }

  const totals: JSONObject = value["totals"] as JSONObject;
  const coverage: JSONObject = isObject(value["coverage"])
    ? (value["coverage"] as JSONObject)
    : {};

  return {
    windowInDays: readCount(value["windowInDays"]) || 30,
    windowStart: readDate(value["windowStart"]),
    generatedAt: readDate(value["generatedAt"]),
    totals: {
      investigations: readCount(totals["investigations"]),
      completedInvestigations: readCount(totals["completedInvestigations"]),
      failedInvestigations: readCount(totals["failedInvestigations"]),
      activeInvestigations: readCount(totals["activeInvestigations"]),
      problems: readCount(totals["problems"]),
      recurringProblems: readCount(totals["recurringProblems"]),
      fixes: readOptionalCount(totals["fixes"]),
      fixTasks: readCount(totals["fixTasks"]),
      commands: readCount(totals["commands"]),
      failedCommands: readCount(totals["failedCommands"]),
      timedOutCommands: readCount(totals["timedOutCommands"]),
    },
    coverage: {
      subjects: readCount(coverage["subjects"]),
      investigatedSubjects: readCount(coverage["investigatedSubjects"]),
      notInvestigated: readList(
        coverage["notInvestigated"],
        (
          item: unknown,
        ): { code: InvestigationNotStartedCode; count: number } | null => {
          if (!isObject(item)) {
            return null;
          }

          const code: string | null = readString(item["code"]);
          const count: number = readCount(item["count"]);

          return code && count > 0
            ? { code: code as InvestigationNotStartedCode, count }
            : null;
        },
      ),
    },
    attention: readList(value["attention"], (item: unknown) => {
      return readAttentionItem(item, subjectKind);
    }),
    problems: readList(value["problems"], (item: unknown) => {
      return readProblem(item, subjectKind);
    }),
    monitors: readList(value["monitors"], readHotspot),
    services: readList(value["services"], readHotspot),
    fixOutcomes: isObject(value["fixOutcomes"])
      ? readCounts(value["fixOutcomes"], FIX_OUTCOME_KEYS)
      : null,
    fixTaskOutcomes: readCounts(
      value["fixTaskOutcomes"],
      FIX_TASK_OUTCOME_KEYS,
    ),
    verdicts: readCounts(value["verdicts"], VERDICT_KEYS),
    trend: readList(
      value["trend"],
      (item: unknown): AiInsightsTrendDay | null => {
        if (!isObject(item)) {
          return null;
        }

        const date: string | null = readString(item["date"]);

        return date
          ? {
              date,
              investigations: readCount(item["investigations"]),
              failedInvestigations: readCount(item["failedInvestigations"]),
              fixes: readCount(item["fixes"]),
            }
          : null;
      },
    ),
    isPartial: value["isPartial"] === true,
  };
}

// Whether there is anything to learn from: AI did something in the window.
export function hasAiActivity(insights: AiInsights): boolean {
  return (
    insights.totals.investigations > 0 ||
    (insights.totals.fixes || 0) > 0 ||
    insights.totals.fixTasks > 0
  );
}

/*
 * Why an incident (or alert) was not investigated, as its creation
 * recorded it: one sentence each, standing on its own.
 */
export const NOT_INVESTIGATED_REASONS: Record<
  IncidentAlertAiSubjectKind,
  Record<InvestigationNotStartedCode, string>
> = {
  incident: {
    ai_disabled: translationKey("AI is turned off for this project."),
    automatic_investigation_disabled: translationKey(
      "Automatic investigation of new incidents is turned off.",
    ),
    provider_missing: translationKey(
      "There is no LLM provider OneUptime AI can use.",
    ),
    insufficient_ai_balance: translationKey(
      "The project ran out of AI credits.",
    ),
    severity_below_threshold: translationKey(
      "They were below the minimum severity to investigate.",
    ),
    monitor_cooldown: translationKey(
      "Their monitor had just been investigated, inside the re-investigation cooldown.",
    ),
    daily_budget_exhausted: translationKey(
      "The daily AI token limit was reached.",
    ),
    budget_check_failed: translationKey(
      "The daily AI token limit could not be checked.",
    ),
    enqueue_failed: translationKey("The investigation could not be queued."),
    eligibility_check_failed: translationKey(
      "The AI settings could not be checked.",
    ),
    no_run_recorded: translationKey("No investigation was recorded."),
  },
  alert: {
    ai_disabled: translationKey("AI is turned off for this project."),
    automatic_investigation_disabled: translationKey(
      "Automatic investigation of new alerts is turned off.",
    ),
    provider_missing: translationKey(
      "There is no LLM provider OneUptime AI can use.",
    ),
    insufficient_ai_balance: translationKey(
      "The project ran out of AI credits.",
    ),
    severity_below_threshold: translationKey(
      "They were below the minimum severity to investigate.",
    ),
    monitor_cooldown: translationKey(
      "Their monitor had just been investigated, inside the re-investigation cooldown.",
    ),
    daily_budget_exhausted: translationKey(
      "The daily AI token limit was reached.",
    ),
    budget_check_failed: translationKey(
      "The daily AI token limit could not be checked.",
    ),
    enqueue_failed: translationKey("The investigation could not be queued."),
    eligibility_check_failed: translationKey(
      "The AI settings could not be checked.",
    ),
    no_run_recorded: translationKey("No investigation was recorded."),
  },
};

export function describeNotInvestigatedReason(
  subjectKind: IncidentAlertAiSubjectKind,
  code: string | null,
): string {
  return (
    NOT_INVESTIGATED_REASONS[subjectKind][
      code as InvestigationNotStartedCode
    ] || translationKey("For a reason this page does not know yet.")
  );
}

// What an attention item says: a headline, and a line under it.
export interface AiInsightsAttentionWords {
  headline: { template: PluralTemplate; count: number; values: TemplateValues };
  detail:
    | { template: PluralTemplate; count: number; values: TemplateValues }
    | { text: string }
    | null;
}

const FIXES_FAILED: PluralTemplate = {
  one: "{{count}} fix OneUptime AI applied did not fix the problem",
  other: "{{count}} fixes OneUptime AI applied did not fix the problem",
};

const FIXES_APPLIED_OUT_OF: PluralTemplate = {
  one: "Out of {{count}} fix applied in the last 30 days.",
  other: "Out of {{count}} fixes applied in the last 30 days.",
};

const NOT_STARTED: Record<IncidentAlertAiSubjectKind, PluralTemplate> = {
  incident: {
    one: "{{count}} incident was not investigated",
    other: "{{count}} incidents were not investigated",
  },
  alert: {
    one: "{{count}} alert was not investigated",
    other: "{{count}} alerts were not investigated",
  },
};

const RECURRING: PluralTemplate = {
  one: "“{{title}}” was investigated {{count}} time",
  other: "“{{title}}” was investigated {{count}} times",
};

const RECURRING_RECENT: PluralTemplate = {
  one: "{{count}} of them in the last 7 days.",
  other: "{{count}} of them in the last 7 days.",
};

const AWAITING_APPROVAL: PluralTemplate = {
  one: "{{count}} fix is waiting for approval",
  other: "{{count}} fixes are waiting for approval",
};

const INVESTIGATIONS_FAILED: PluralTemplate = {
  one: "{{count}} investigation failed or timed out",
  other: "{{count}} investigations failed or timed out",
};

const INVESTIGATIONS_OUT_OF: PluralTemplate = {
  one: "Out of {{count}} investigation in the last 30 days.",
  other: "Out of {{count}} investigations in the last 30 days.",
};

const COMMANDS_TIMED_OUT: PluralTemplate = {
  one: "{{count}} command was never picked up by an agent",
  other: "{{count}} commands were never picked up by an agent",
};

const FINDINGS_REJECTED: PluralTemplate = {
  one: "{{count}} finding was rejected, or did not match the recorded root cause",
  other:
    "{{count}} findings were rejected, or did not match the recorded root cause",
};

const MONITOR_HOTSPOT: PluralTemplate = {
  one: "{{name}} was behind {{count}} investigation",
  other: "{{name}} was behind {{count}} investigations",
};

export const COMMANDS_TIMED_OUT_DETAIL: string = translationKey(
  "Check that the agents and Runners your clusters and resources are reached through are online.",
);

export const UNTITLED_PROBLEM: string = translationKey("this problem");

export function describeAttentionItem(
  item: AiInsightsAttentionItem,
  subjectKind: IncidentAlertAiSubjectKind,
): AiInsightsAttentionWords {
  switch (item.kind) {
    case IncidentAlertAiAttentionKind.FixesFailed:
      return {
        headline: { template: FIXES_FAILED, count: item.count, values: {} },
        detail:
          item.total !== null
            ? { template: FIXES_APPLIED_OUT_OF, count: item.total, values: {} }
            : null,
      };
    case IncidentAlertAiAttentionKind.InvestigationsNotStarted:
      return {
        headline: {
          template: NOT_STARTED[subjectKind],
          count: item.count,
          values: {},
        },
        detail: {
          text: describeNotInvestigatedReason(subjectKind, item.reason),
        },
      };
    case IncidentAlertAiAttentionKind.RecurringProblem:
      return {
        headline: {
          template: RECURRING,
          count: item.count,
          values: {
            title:
              item.title ||
              translatableTerm(UNTITLED_PROBLEM, { inSentence: true }),
          },
        },
        detail:
          item.recentCount !== null && item.recentCount > 0
            ? {
                template: RECURRING_RECENT,
                count: item.recentCount,
                values: {},
              }
            : null,
      };
    case IncidentAlertAiAttentionKind.FixesAwaitingApproval:
      return {
        headline: {
          template: AWAITING_APPROVAL,
          count: item.count,
          values: {},
        },
        detail: null,
      };
    case IncidentAlertAiAttentionKind.InvestigationsFailed:
      return {
        headline: {
          template: INVESTIGATIONS_FAILED,
          count: item.count,
          values: {},
        },
        detail:
          item.total !== null
            ? { template: INVESTIGATIONS_OUT_OF, count: item.total, values: {} }
            : null,
      };
    case IncidentAlertAiAttentionKind.CommandsTimedOut:
      return {
        headline: {
          template: COMMANDS_TIMED_OUT,
          count: item.count,
          values: {},
        },
        detail: { text: COMMANDS_TIMED_OUT_DETAIL },
      };
    case IncidentAlertAiAttentionKind.FindingsRejected:
      return {
        headline: {
          template: FINDINGS_REJECTED,
          count: item.count,
          values: {},
        },
        detail: null,
      };
    case IncidentAlertAiAttentionKind.MonitorHotspot:
    default:
      return {
        headline: {
          template: MONITOR_HOTSPOT,
          count: item.count,
          values: { name: item.monitor?.name || "" },
        },
        detail:
          item.total !== null
            ? { template: INVESTIGATIONS_OUT_OF, count: item.total, values: {} }
            : null,
      };
  }
}

// The dot beside an attention item.
export function getSeverityDotClass(
  severity: IncidentAlertAiAttentionSeverity,
): string {
  switch (severity) {
    case IncidentAlertAiAttentionSeverity.High:
      return "bg-rose-500";
    case IncidentAlertAiAttentionSeverity.Medium:
      return "bg-amber-500";
    default:
      return "bg-gray-400";
  }
}

export const SEVERITY_LABELS: Record<IncidentAlertAiAttentionSeverity, string> =
  {
    [IncidentAlertAiAttentionSeverity.High]: translationKey("High"),
    [IncidentAlertAiAttentionSeverity.Medium]: translationKey("Medium"),
    [IncidentAlertAiAttentionSeverity.Low]: translationKey("Low"),
  };

// The tallest day of the trend, at least 1, so an empty window draws flat.
export function getTrendScale(trend: Array<AiInsightsTrendDay>): number {
  return Math.max(
    1,
    ...trend.map((day: AiInsightsTrendDay): number => {
      return Math.max(day.investigations, day.fixes);
    }),
  );
}

// A bar's height, as a percentage of the tallest day.
export function getBarHeightPercent(value: number, scale: number): number {
  if (value <= 0 || scale <= 0) {
    return 0;
  }

  // A day with anything at all stays visible.
  return Math.max(4, Math.round((value / scale) * 100));
}

// The fixes that were applied, automatically or after approval.
export function getAppliedFixes(outcomes: AiInsightsFixOutcomes): number {
  return outcomes.appliedAutomatically + outcomes.appliedAfterApproval;
}
