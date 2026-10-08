import {
  AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN,
  AiActivityCoverage,
  AiActivityFinding,
  AiActivityFixOutcomes,
  AiActivityFixTaskOutcomes,
  AiActivityHotspot,
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsightTone,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityNamedResource,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivityResourceHotspot,
  AiActivitySubject,
  AiActivityTimeOfDay,
  AiActivityTrendDay,
} from "Common/Types/AI/AiActivityInsights";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import { InvestigationNotStartedCode } from "Common/Types/AI/InvestigationNotStartedReason";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { Gray500, Red500, Yellow500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  translatableTerm,
  translatePlural,
  translateTemplate,
  translateTerm,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The pure half of an AI Insights page (AiActivityInsightsPage): how the
 * page reads the insights route's body (AiActivityInsights, from POST
 * /kubernetes-cluster/ai-access/insights, /resource-ai-access/insights or
 * /ai-activity/{incident|alert}/insights) and the words for each part of
 * it. The server sends numbers, keys and the names and titles the system
 * holds, never prose of its own; every sentence is built here, in the
 * reader's language. The only words from the server are an investigation's
 * own (a finding, a suggested step), and the page says whose they are.
 *
 * What the page says first is what is worth knowing about the reader's
 * system (the insights): the problem that keeps coming back and why, the
 * part behind most of the trouble, what AI fixed on its own and what it
 * would fix if allowed, the risks it spotted before anything paged. How much
 * AI did comes last, as a footnote with its own health notes.
 *
 * Shared by every scope's Insights page — a cluster, each resource with a
 * resource AI agent, and a project's incidents and its alerts — so nothing
 * here knows which scope it is about beyond the noun and the subject kind it
 * is given, and the sections only the incidents' and alerts' pages have
 * (coverage, monitors and services, fix pull requests) are worded only when
 * the body has them.
 *
 * Import-clean on purpose (Common types and the translation helpers only),
 * so the suites read it without a browser. Server text — titles, findings,
 * suggested steps, label values — is only ever rendered as plain text.
 */

export const AI_INSIGHTS_PAGE_TITLE: string = translationKey("AI Insights");

export const AI_INSIGHTS_EMPTY_TITLE: string = translationKey(
  "Nothing to show yet",
);

export function getAiInsightsPageSubtitle(noun: string): string {
  return translateTemplate(
    "What OneUptime AI found out about this {{noun}} in the last 30 days: what keeps going wrong and why, and what to do about it.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
}

export function getAiInsightsEmptyDescription(noun: string): string {
  return translateTemplate(
    "When an alert or incident fires on this {{noun}}, OneUptime AI investigates it. This page then tells you what keeps coming back and why, what is behind most of the trouble, what AI fixed on its own, and the risks it spots before anything pages.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
}

/*
 * ------------------------------------------------------------------------
 * Reading the body.
 * ------------------------------------------------------------------------
 */

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A non-blank string, or null.
function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// A finite, non-negative whole count; anything else is 0.
function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readOptionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function readList<T>(
  value: unknown,
  readRow: (row: unknown) => T | null,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<T> = [];

  for (const row of value) {
    const read: T | null = readRow(row);

    if (read) {
      rows.push(read);
    }
  }

  return rows;
}

function readSubject(value: unknown): AiActivitySubject | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  const kind: unknown = value["kind"];

  if (!id || (kind !== "incident" && kind !== "alert")) {
    return null;
  }

  const title: string | null = readString(value["title"]);
  const number: number | undefined = readOptionalCount(value["number"]);
  const numberWithPrefix: string | null = readString(value["numberWithPrefix"]);

  return {
    kind,
    id,
    ...(title ? { title } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(numberWithPrefix ? { numberWithPrefix } : {}),
  };
}

function readNamedResource(value: unknown): AiActivityNamedResource | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  const name: string | null = readString(value["name"]);

  return id && name ? { id, name } : null;
}

function readResourceHotspot(value: unknown): AiActivityResourceHotspot | null {
  const resource: AiActivityNamedResource | null = readNamedResource(value);

  if (!resource || !isObject(value)) {
    return null;
  }

  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const subjectCount: number = readCount(value["subjectCount"]);

  return {
    ...resource,
    // A body from before occurrences were counted: its investigated ones.
    occurrenceCount: readCount(value["occurrenceCount"]) || subjectCount,
    subjectCount,
    investigationCount: readCount(value["investigationCount"]),
    problemCount: readCount(value["problemCount"]),
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

function readCoverage(value: JSONObject): AiActivityCoverage {
  return {
    subjects: readCount(value["subjects"]),
    investigatedSubjects: readCount(value["investigatedSubjects"]),
    notInvestigated: readList(
      value["notInvestigated"],
      (
        row: unknown,
      ): { code: InvestigationNotStartedCode; count: number } | null => {
        if (!isObject(row)) {
          return null;
        }

        const code: string | null = readString(row["code"]);
        const count: number = readCount(row["count"]);

        return code && count > 0
          ? { code: code as InvestigationNotStartedCode, count }
          : null;
      },
    ),
  };
}

function readFixTaskOutcomes(value: JSONObject): AiActivityFixTaskOutcomes {
  return {
    total: readCount(value["total"]),
    pullRequestsOpened: readCount(value["pullRequestsOpened"]),
    noFixFound: readCount(value["noFixFound"]),
    inProgress: readCount(value["inProgress"]),
    failed: readCount(value["failed"]),
    cancelled: readCount(value["cancelled"]),
  };
}

function readObject(value: unknown): AiActivityObject | null {
  if (!isObject(value)) {
    return null;
  }

  const name: string | null = readString(value["name"]);
  const objectValue: string | null = readString(value["value"]);
  const key: string | null = readString(value["key"]);

  return name && objectValue
    ? { name, value: objectValue, ...(key ? { key } : {}) }
    : null;
}

function readFinding(value: unknown): AiActivityFinding | null {
  if (!isObject(value)) {
    return null;
  }

  const aiRunId: string | null = readString(value["aiRunId"]);
  const text: string | null = readString(value["text"]);

  if (!aiRunId || !text) {
    return null;
  }

  const at: string | null = readString(value["at"]);

  return {
    aiRunId,
    text,
    source: value["source"] === "report" ? "report" : "tldr",
    ...(at ? { at } : {}),
  };
}

function readTimeOfDay(value: unknown): AiActivityTimeOfDay | null {
  if (!isObject(value)) {
    return null;
  }

  const startHourUtc: number | undefined = readOptionalCount(
    value["startHourUtc"],
  );
  const hours: number = readCount(value["hours"]);

  if (startHourUtc === undefined || startHourUtc > 23 || hours === 0) {
    return null;
  }

  return {
    startHourUtc,
    hours: Math.min(hours, 24),
    count: readCount(value["count"]),
    total: readCount(value["total"]),
    days: readCount(value["days"]),
    totalDays: readCount(value["totalDays"]),
  };
}

function readProblem(value: unknown): AiActivityProblem | null {
  if (!isObject(value)) {
    return null;
  }

  const key: string | null = readString(value["key"]);
  const latestSubject: AiActivitySubject | null = readSubject(
    value["latestSubject"],
  );

  if (!key || !latestSubject) {
    return null;
  }

  const verdicts: JSONObject = isObject(value["verdicts"])
    ? value["verdicts"]
    : {};
  const fixes: JSONObject = isObject(value["fixes"]) ? value["fixes"] : {};
  const finding: AiActivityFinding | null = readFinding(value["latestFinding"]);
  const nextStep: string | null = readString(value["latestNextStep"]);
  const timeOfDay: AiActivityTimeOfDay | null = readTimeOfDay(
    value["timeOfDay"],
  );
  const firstSeenAt: string | null = readString(value["firstSeenAt"]);
  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const investigationCount: number = readCount(value["investigationCount"]);
  const subjectCount: number = readCount(value["subjectCount"]);

  return {
    key,
    title: readString(value["title"]) || "",
    // A body from before occurrences were counted: its investigated ones.
    occurrenceCount:
      readCount(value["occurrenceCount"]) || Math.max(subjectCount, 1),
    recentOccurrenceCount: readCount(value["recentOccurrenceCount"]),
    previousOccurrenceCount: readCount(value["previousOccurrenceCount"]),
    investigationCount,
    subjectCount,
    isRecurring: value["isRecurring"] === true,
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    latestSubject,
    objects: readList(
      value["objects"],
      (row: unknown): (AiActivityObject & { count: number }) | null => {
        const object: AiActivityObject | null = readObject(row);
        return object && isObject(row)
          ? { ...object, count: Math.max(readCount(row["count"]), 1) }
          : null;
      },
    ),
    ...(Array.isArray(value["monitors"])
      ? { monitors: readList(value["monitors"], readNamedResource) }
      : {}),
    ...(finding ? { latestFinding: finding } : {}),
    ...(nextStep ? { latestNextStep: nextStep } : {}),
    ...(timeOfDay ? { timeOfDay } : {}),
    verdicts: {
      confirmed: readCount(verdicts["confirmed"]),
      rejected: readCount(verdicts["rejected"]),
      matched: readCount(verdicts["matched"]),
      partlyMatched: readCount(verdicts["partlyMatched"]),
      mismatched: readCount(verdicts["mismatched"]),
    },
    fixes: {
      proposed: readCount(fixes["proposed"]),
      applied: readCount(fixes["applied"]),
      verified: readCount(fixes["verified"]),
      failed: readCount(fixes["failed"]),
      awaitingApproval: readCount(fixes["awaitingApproval"]),
    },
  };
}

function readHotspot(value: unknown): AiActivityHotspot | null {
  const object: AiActivityObject | null = readObject(value);

  if (!object || !isObject(value)) {
    return null;
  }

  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const investigationCount: number = readCount(value["investigationCount"]);

  return {
    ...object,
    // A body from before occurrences were counted: its investigations.
    occurrenceCount: readCount(value["occurrenceCount"]) || investigationCount,
    investigationCount,
    problemCount: readCount(value["problemCount"]),
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
}

function readTrendDay(value: unknown): AiActivityTrendDay | null {
  if (!isObject(value)) {
    return null;
  }

  const date: string | null = readString(value["date"]);

  return date
    ? {
        date,
        investigations: readCount(value["investigations"]),
        failedInvestigations: readCount(value["failedInvestigations"]),
        fixes: readCount(value["fixes"]),
      }
    : null;
}

function readPreventiveInsight(
  value: unknown,
): AiActivityPreventiveInsight | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  const title: string | null = readString(value["title"]);

  if (!id || !title) {
    return null;
  }

  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const occurrenceCount: number | undefined = readOptionalCount(
    value["occurrenceCount"],
  );

  return {
    id,
    title,
    insightType: readString(value["insightType"]) || "",
    severity: readString(value["severity"]) || "",
    status: readString(value["status"]) || "",
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(occurrenceCount !== undefined ? { occurrenceCount } : {}),
  };
}

const INSIGHT_KINDS: ReadonlyArray<string> = Object.values(
  AiActivityInsightKind,
);
const INSIGHT_TONES: ReadonlyArray<string> = Object.values(
  AiActivityInsightTone,
);

function readInsight(value: unknown): AiActivityInsight | null {
  if (!isObject(value)) {
    return null;
  }

  // A kind or tone a newer server added cannot be worded: skipped.
  if (
    !INSIGHT_KINDS.includes(String(value["kind"])) ||
    !INSIGHT_TONES.includes(String(value["tone"]))
  ) {
    return null;
  }

  const total: number | undefined = readOptionalCount(value["total"]);
  const recentCount: number | undefined = readOptionalCount(
    value["recentCount"],
  );
  const previousCount: number | undefined = readOptionalCount(
    value["previousCount"],
  );
  const problemCount: number | undefined = readOptionalCount(
    value["problemCount"],
  );
  const evidenceCount: number | undefined = readOptionalCount(
    value["evidenceCount"],
  );
  const verifiedCount: number | undefined = readOptionalCount(
    value["verifiedCount"],
  );
  const problemKey: string | null = readString(value["problemKey"]);
  const title: string | null = readString(value["title"]);
  const firstSeenAt: string | null = readString(value["firstSeenAt"]);
  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const fixedAt: string | null = readString(value["fixedAt"]);
  const finding: AiActivityFinding | null = readFinding(value["finding"]);
  const nextStep: string | null = readString(value["nextStep"]);
  const timeOfDay: AiActivityTimeOfDay | null = readTimeOfDay(
    value["timeOfDay"],
  );
  const object: AiActivityObject | null = readObject(value["object"]);
  const monitor: AiActivityNamedResource | null = readNamedResource(
    value["monitor"],
  );
  const service: AiActivityNamedResource | null = readNamedResource(
    value["service"],
  );
  const subject: AiActivitySubject | null = readSubject(value["subject"]);
  const insightId: string | null = readString(value["insightId"]);
  const insightSeverity: string | null = readString(value["insightSeverity"]);
  const insightType: string | null = readString(value["insightType"]);
  const reason: string | null = readString(value["reason"]);

  return {
    kind: value["kind"] as AiActivityInsightKind,
    tone: value["tone"] as AiActivityInsightTone,
    count: readCount(value["count"]),
    ...(total !== undefined ? { total } : {}),
    ...(recentCount !== undefined ? { recentCount } : {}),
    ...(previousCount !== undefined ? { previousCount } : {}),
    ...(problemKey ? { problemKey } : {}),
    ...(title ? { title } : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(fixedAt ? { fixedAt } : {}),
    ...(finding ? { finding } : {}),
    ...(nextStep ? { nextStep } : {}),
    ...(timeOfDay ? { timeOfDay } : {}),
    ...(object ? { object } : {}),
    ...(Array.isArray(value["objects"])
      ? { objects: readList(value["objects"], readObject) }
      : {}),
    ...(monitor ? { monitor } : {}),
    ...(service ? { service } : {}),
    ...(Array.isArray(value["monitors"])
      ? { monitors: readList(value["monitors"], readNamedResource) }
      : {}),
    ...(problemCount !== undefined ? { problemCount } : {}),
    ...(subject ? { subject } : {}),
    ...(Array.isArray(value["evidence"])
      ? { evidence: readList(value["evidence"], readSubject) }
      : {}),
    ...(evidenceCount !== undefined ? { evidenceCount } : {}),
    ...(verifiedCount !== undefined ? { verifiedCount } : {}),
    ...(insightId ? { insightId } : {}),
    ...(insightSeverity ? { insightSeverity } : {}),
    ...(insightType ? { insightType } : {}),
    ...(reason ? { reason: reason as InvestigationNotStartedCode } : {}),
  };
}

/*
 * The insights as the route returns them, or null when the body is not
 * that shape at all (no totals). Every count is a non-negative number
 * (0 when missing), every list a list, and a row without what it is keyed
 * or worded by is dropped.
 */
export function parseAiActivityInsights(
  value: unknown,
): AiActivityInsights | null {
  if (!isObject(value) || !isObject(value["totals"])) {
    return null;
  }

  const totals: JSONObject = value["totals"];
  const fixOutcomes: JSONObject = isObject(value["fixOutcomes"])
    ? value["fixOutcomes"]
    : {};
  const subjectKind: unknown = value["subjectKind"];
  const fixesHidden: unknown = value["fixesHidden"];

  const readTotals: AiActivityInsightsTotals = {
    occurrences: readCount(totals["occurrences"]),
    investigations: readCount(totals["investigations"]),
    completedInvestigations: readCount(totals["completedInvestigations"]),
    failedInvestigations: readCount(totals["failedInvestigations"]),
    activeInvestigations: readCount(totals["activeInvestigations"]),
    confirmedFindings: readCount(totals["confirmedFindings"]),
    rejectedFindings: readCount(totals["rejectedFindings"]),
    problems: readCount(totals["problems"]),
    recurringProblems: readCount(totals["recurringProblems"]),
    fixes: readCount(totals["fixes"]),
    commands: readCount(totals["commands"]),
    failedCommands: readCount(totals["failedCommands"]),
    timedOutCommands: readCount(totals["timedOutCommands"]),
    ...(totals["fixTasks"] !== undefined
      ? { fixTasks: readCount(totals["fixTasks"]) }
      : {}),
  };

  const readFixOutcomes: AiActivityFixOutcomes = {
    total: readCount(fixOutcomes["total"]),
    planning: readCount(fixOutcomes["planning"]),
    awaitingApproval: readCount(fixOutcomes["awaitingApproval"]),
    appliedAutomatically: readCount(fixOutcomes["appliedAutomatically"]),
    appliedAfterApproval: readCount(fixOutcomes["appliedAfterApproval"]),
    dismissed: readCount(fixOutcomes["dismissed"]),
    noFixFound: readCount(fixOutcomes["noFixFound"]),
    verified: readCount(fixOutcomes["verified"]),
    failed: readCount(fixOutcomes["failed"]),
    verifying: readCount(fixOutcomes["verifying"]),
  };

  return {
    windowInDays: readCount(value["windowInDays"]) || 30,
    windowStart: readString(value["windowStart"]) || "",
    generatedAt: readString(value["generatedAt"]) || "",
    totals: readTotals,
    insights: readList(value["insights"], readInsight),
    problems: readList(value["problems"], readProblem),
    hotspots: readList(value["hotspots"], readHotspot),
    fixOutcomes: readFixOutcomes,
    trend: readList(value["trend"], readTrendDay),
    preventiveInsights: readList(
      value["preventiveInsights"],
      readPreventiveInsight,
    ),
    isPartial: value["isPartial"] === true,
    // The incidents' and alerts' own sections, only when the body has them.
    ...(subjectKind === "incident" || subjectKind === "alert"
      ? { subjectKind }
      : {}),
    ...(isObject(value["coverage"])
      ? { coverage: readCoverage(value["coverage"]) }
      : {}),
    ...(Array.isArray(value["monitors"])
      ? { monitors: readList(value["monitors"], readResourceHotspot) }
      : {}),
    ...(Array.isArray(value["services"])
      ? { services: readList(value["services"], readResourceHotspot) }
      : {}),
    ...(isObject(value["fixTaskOutcomes"])
      ? { fixTaskOutcomes: readFixTaskOutcomes(value["fixTaskOutcomes"]) }
      : {}),
    ...(typeof fixesHidden === "boolean" ? { fixesHidden } : {}),
  };
}

/*
 * Whether the window holds anything AI did or found. With nothing, the
 * page shows one empty state instead of a row of zeros.
 */
export function hasAiActivity(insights: AiActivityInsights): boolean {
  return (
    insights.totals.investigations > 0 ||
    insights.totals.fixes > 0 ||
    insights.totals.commands > 0 ||
    (insights.totals.fixTasks || 0) > 0 ||
    insights.preventiveInsights.length > 0
  );
}

/*
 * ------------------------------------------------------------------------
 * How an insight looks.
 * ------------------------------------------------------------------------
 */

export interface AiInsightLook {
  icon: IconProp;
  // The round badge behind the icon, and the icon's colour (Theme.css remaps both).
  badgeClassName: string;
  // What the tone means, for a screen reader.
  label: string;
}

const TONE_CLASS_NAMES: Record<AiActivityInsightTone, string> = {
  [AiActivityInsightTone.Critical]: "bg-red-50 text-red-600",
  [AiActivityInsightTone.Warning]: "bg-amber-50 text-amber-600",
  [AiActivityInsightTone.Pattern]: "bg-indigo-50 text-indigo-600",
  [AiActivityInsightTone.Positive]: "bg-green-50 text-green-600",
};

const TONE_LABELS: Record<AiActivityInsightTone, string> = {
  [AiActivityInsightTone.Critical]: translationKey("Needs attention now"),
  [AiActivityInsightTone.Warning]: translationKey("Worth acting on"),
  [AiActivityInsightTone.Pattern]: translationKey("Worth knowing"),
  [AiActivityInsightTone.Positive]: translationKey("Good news"),
};

const KIND_ICONS: Record<AiActivityInsightKind, IconProp> = {
  [AiActivityInsightKind.RecurringProblem]: IconProp.ArrowPath,
  [AiActivityInsightKind.Hotspot]: IconProp.MapPin,
  [AiActivityInsightKind.ProblemStopped]: IconProp.CheckCircle,
  [AiActivityInsightKind.FixedAutomatically]: IconProp.WrenchScrewdriver,
  [AiActivityInsightKind.FixesDidNotHelp]: IconProp.ExclaimationCircle,
  [AiActivityInsightKind.FixesAwaitingApproval]: IconProp.HandRaised,
  [AiActivityInsightKind.ReadyForAutomaticFixes]: IconProp.Bolt,
  [AiActivityInsightKind.NotInvestigated]: IconProp.EyeSlash,
  [AiActivityInsightKind.RiskSpotted]: IconProp.Eye,
};

export function getInsightLook(insight: AiActivityInsight): AiInsightLook {
  return {
    icon: KIND_ICONS[insight.kind] || IconProp.LightBulb,
    badgeClassName:
      TONE_CLASS_NAMES[insight.tone] ||
      TONE_CLASS_NAMES[AiActivityInsightTone.Pattern],
    label:
      TONE_LABELS[insight.tone] || TONE_LABELS[AiActivityInsightTone.Pattern],
  };
}

const PREVENTIVE_SEVERITY_COLORS: Record<string, Color> = {
  [AIInsightSeverity.High]: Red500,
  [AIInsightSeverity.Medium]: Yellow500,
  [AIInsightSeverity.Low]: Gray500,
};

export function getPreventiveSeverityColor(severity: string): Color {
  return PREVENTIVE_SEVERITY_COLORS[severity] || Gray500;
}

/*
 * ------------------------------------------------------------------------
 * Names.
 * ------------------------------------------------------------------------
 */

/*
 * How a subject is named in a sentence or a link: "Incident #42: Checkout
 * is down", "Alert #7: Disk full", or the kind alone without more to say.
 */
export function describeSubject(subject: AiActivitySubject): string {
  const title: string | undefined = subject.title;
  const number: number | undefined = subject.number;
  // The number as the project writes it ("INC-42"), when the page read it.
  const numberWithPrefix: string | undefined = subject.numberWithPrefix;

  if (subject.kind === "incident") {
    if (numberWithPrefix && title) {
      return translateTemplate("Incident {{number}}: {{title}}", {
        number: numberWithPrefix,
        title,
      });
    }

    if (numberWithPrefix) {
      return translateTemplate("Incident {{number}}", {
        number: numberWithPrefix,
      });
    }

    if (number !== undefined && title) {
      return translateTemplate("Incident #{{number}}: {{title}}", {
        number,
        title,
      });
    }

    if (number !== undefined) {
      return translateTemplate("Incident #{{number}}", { number });
    }

    return title
      ? translateTemplate("Incident: {{title}}", { title })
      : translateTerm("Incident");
  }

  if (numberWithPrefix && title) {
    return translateTemplate("Alert {{number}}: {{title}}", {
      number: numberWithPrefix,
      title,
    });
  }

  if (numberWithPrefix) {
    return translateTemplate("Alert {{number}}", { number: numberWithPrefix });
  }

  if (number !== undefined && title) {
    return translateTemplate("Alert #{{number}}: {{title}}", { number, title });
  }

  if (number !== undefined) {
    return translateTemplate("Alert #{{number}}", { number });
  }

  return title
    ? translateTemplate("Alert: {{title}}", { title })
    : translateTerm("Alert");
}

/*
 * A subject named by its number alone — "Alert #812", "Incident INC-42" —
 * for the short links under an insight; its title when it has no number.
 */
export function describeSubjectShort(subject: AiActivitySubject): string {
  if (subject.numberWithPrefix || subject.number !== undefined) {
    return describeSubject({
      kind: subject.kind,
      id: subject.id,
      ...(subject.numberWithPrefix
        ? { numberWithPrefix: subject.numberWithPrefix }
        : {}),
      ...(subject.number !== undefined ? { number: subject.number } : {}),
    });
  }

  return describeSubject(subject);
}

/*
 * A problem's heading: its title as the server stripped it of the series
 * identity, else what its latest incident or alert is called.
 */
export function getProblemTitle(problem: AiActivityProblem): string {
  return problem.title || describeSubject(problem.latestSubject);
}

// "Deployment: oneuptime-home" — the way alert titles name a part.
export function describeObject(object: AiActivityObject): string {
  return `${translateTerm(object.name)}: ${object.value}`;
}

// "Node gke-pool-3" — a part as a sentence names it.
export function describeObjectInSentence(object: AiActivityObject): string {
  return translateTemplate("{{name}} {{value}}", {
    name: translatableTerm(object.name),
    value: object.value,
  });
}

// "last seen 2 hours ago", or null without a readable date.
export function describeLastSeen(at: string | undefined): string | null {
  if (!at) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(at);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return translateTemplate("last seen {{when}}", {
    when: OneUptimeDate.fromNow(date),
  });
}

// "2 hours ago", or null without a readable date.
function describeWhen(at: string | undefined): string | null {
  if (!at) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(at);

  return Number.isNaN(date.getTime()) ? null : OneUptimeDate.fromNow(date);
}

// "Oct 1" in the reader's own time, or null without a readable date.
function describeDay(at: string | undefined): string | null {
  if (!at) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(at);

  return Number.isNaN(date.getTime())
    ? null
    : OneUptimeDate.getDateAsLocalDayMonthString(date);
}

/*
 * ------------------------------------------------------------------------
 * The insights.
 * ------------------------------------------------------------------------
 */

// What every sentence about an insight needs to know about the page.
export interface AiInsightWordingContext {
  windowInDays: number;
  // The incidents' or alerts' own page's product; none for a cluster or a resource.
  subjectKind?: "incident" | "alert" | undefined;
  // The scope in sentences, for a cluster's or a resource's page.
  noun: string;
  // When the insights were made: what "this week" and "new" are measured from.
  generatedAt?: string | undefined;
}

// A short badge beside an insight's or a problem's heading.
export interface AiInsightBadge {
  label: string;
  tone: AiActivityInsightTone;
}

/*
 * Whether a problem started within the last 7 days of the window: it is
 * new.
 */
export function isNewProblem(
  firstSeenAt: string | undefined,
  generatedAt: string | undefined,
): boolean {
  if (!firstSeenAt || !generatedAt) {
    return false;
  }

  const first: number = Date.parse(firstSeenAt);
  const now: number = Date.parse(generatedAt);

  return (
    Number.isFinite(first) &&
    Number.isFinite(now) &&
    now - first < AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS * 24 * 3600 * 1000
  );
}

/*
 * Whether a problem is getting worse: it came up at least
 * AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN times in the last 7 days, and
 * more than in the 7 days before.
 */
export function isGettingWorse(recent: number, previous: number): boolean {
  return (
    recent >= AI_ACTIVITY_INSIGHTS_RECURRING_ATTENTION_MIN && recent > previous
  );
}

/*
 * The badge beside a problem that keeps coming back: "New" when it started
 * this week, else "Getting worse" when this week was worse than the last.
 */
export function getRecurringBadge(data: {
  firstSeenAt?: string | undefined;
  recentCount: number;
  previousCount: number;
  generatedAt?: string | undefined;
}): AiInsightBadge | null {
  if (isNewProblem(data.firstSeenAt, data.generatedAt)) {
    return {
      label: translationKey("New this week"),
      tone: AiActivityInsightTone.Warning,
    };
  }

  if (isGettingWorse(data.recentCount, data.previousCount)) {
    return {
      label: translationKey("Getting worse"),
      tone: AiActivityInsightTone.Critical,
    };
  }

  return null;
}

export function getInsightBadge(
  insight: AiActivityInsight,
  context: AiInsightWordingContext,
): AiInsightBadge | null {
  if (insight.kind !== AiActivityInsightKind.RecurringProblem) {
    return null;
  }

  return getRecurringBadge({
    firstSeenAt: insight.firstSeenAt,
    recentCount: insight.recentCount || 0,
    previousCount: insight.previousCount || 0,
    generatedAt: context.generatedAt,
  });
}

/*
 * "the incidents and alerts on this cluster", "the incidents", "the alerts":
 * what everything that came up is, in the sentences that count it.
 */
function describeEverything(
  count: number,
  context: AiInsightWordingContext,
  shown: number,
): string {
  if (context.subjectKind === "incident") {
    return translatePlural(
      {
        one: "That is {{shown}} of the {{count}} incident created in the last {{days}} days.",
        other:
          "That is {{shown}} of the {{count}} incidents created in the last {{days}} days.",
      },
      count,
      { shown, days: context.windowInDays },
    );
  }

  if (context.subjectKind === "alert") {
    return translatePlural(
      {
        one: "That is {{shown}} of the {{count}} alert created in the last {{days}} days.",
        other:
          "That is {{shown}} of the {{count}} alerts created in the last {{days}} days.",
      },
      count,
      { shown, days: context.windowInDays },
    );
  }

  return translatePlural(
    {
      one: "That is {{shown}} of the {{count}} incident or alert on this {{noun}} in the last {{days}} days.",
      other:
        "That is {{shown}} of the {{count}} incidents and alerts on this {{noun}} in the last {{days}} days.",
    },
    count,
    {
      shown,
      days: context.windowInDays,
      noun: translatableTerm(context.noun, { inSentence: true }),
    },
  );
}

// An insight's heading: what is worth knowing, in one line.
export function describeInsightHeadline(
  insight: AiActivityInsight,
  context: AiInsightWordingContext,
): string {
  switch (insight.kind) {
    case AiActivityInsightKind.RecurringProblem:
      return insight.title
        ? translateTemplate("{{title}} keeps coming back", {
            title: insight.title,
          })
        : translateTemplate("A problem keeps coming back");

    case AiActivityInsightKind.Hotspot: {
      if (insight.service) {
        return translatePlural(
          {
            one: "The {{name}} service is behind {{count}} problem",
            other: "The {{name}} service is behind {{count}} different problems",
          },
          insight.problemCount || 0,
          { name: insight.service.name },
        );
      }

      if (insight.monitor) {
        return translatePlural(
          {
            one: "The {{name}} monitor is behind {{count}} problem",
            other: "The {{name}} monitor is behind {{count}} different problems",
          },
          insight.problemCount || 0,
          { name: insight.monitor.name },
        );
      }

      return translatePlural(
        {
          one: "{{name}} is behind {{count}} problem",
          other: "{{name}} is behind {{count}} different problems",
        },
        insight.problemCount || 0,
        {
          name: insight.object
            ? describeObjectInSentence(insight.object)
            : translateTerm("One part"),
        },
      );
    }

    case AiActivityInsightKind.ProblemStopped:
      return insight.title
        ? translateTemplate("{{title}} has stopped", { title: insight.title })
        : translateTemplate("A problem that kept coming back has stopped");

    case AiActivityInsightKind.FixedAutomatically:
      return translatePlural(
        {
          one: "OneUptime AI applied a fix on its own",
          other: "OneUptime AI applied {{count}} fixes on its own",
        },
        insight.count,
      );

    case AiActivityInsightKind.FixesDidNotHelp:
      return translatePlural(
        {
          one: "A fix did not solve the problem it was for",
          other: "{{count}} fixes did not solve the problems they were for",
        },
        insight.count,
      );

    case AiActivityInsightKind.FixesAwaitingApproval:
      return translatePlural(
        {
          one: "A fix is waiting for your approval",
          other: "{{count}} fixes are waiting for your approval",
        },
        insight.count,
      );

    case AiActivityInsightKind.ReadyForAutomaticFixes:
      return translateTemplate(
        "Your team approved every fix OneUptime AI proposed here",
      );

    case AiActivityInsightKind.NotInvestigated:
      return context.subjectKind === "alert"
        ? translatePlural(
            {
              one: "OneUptime AI did not look into {{count}} alert",
              other: "OneUptime AI did not look into {{count}} alerts",
            },
            insight.count,
          )
        : translatePlural(
            {
              one: "OneUptime AI did not look into {{count}} incident",
              other: "OneUptime AI did not look into {{count}} incidents",
            },
            insight.count,
          );

    case AiActivityInsightKind.RiskSpotted:
      return translateTemplate("Spotted before anything paged: {{title}}", {
        title: insight.title || "",
      });

    default:
      return "";
  }
}

/*
 * The sentences under an insight's heading: the numbers behind it, in
 * order. Each is a whole sentence of its own.
 */
export function describeInsightFacts(
  insight: AiActivityInsight,
  context: AiInsightWordingContext,
): Array<string> {
  const facts: Array<string> = [];

  switch (insight.kind) {
    case AiActivityInsightKind.RecurringProblem: {
      const recent: number = insight.recentCount || 0;
      const previous: number = insight.previousCount || 0;

      facts.push(
        translatePlural(
          {
            one: "It happened {{count}} time in the last {{days}} days.",
            other: "It happened {{count}} times in the last {{days}} days.",
          },
          insight.count,
          { days: context.windowInDays },
        ),
      );

      const started: string | null = describeWhen(insight.firstSeenAt);

      if (recent >= insight.count && started) {
        facts.push(translateTemplate("It started {{when}}.", { when: started }));
      } else if (recent > 0 && recent > previous) {
        facts.push(
          translatePlural(
            {
              one: "{{count}} of them was in the last 7 days, up from {{previous}} the 7 days before.",
              other:
                "{{count}} of them were in the last 7 days, up from {{previous}} the 7 days before.",
            },
            recent,
            { previous },
          ),
        );
      } else if (recent > 0 && recent < previous) {
        facts.push(
          translatePlural(
            {
              one: "{{count}} of them was in the last 7 days, down from {{previous}} the 7 days before.",
              other:
                "{{count}} of them were in the last 7 days, down from {{previous}} the 7 days before.",
            },
            recent,
            { previous },
          ),
        );
      } else if (recent > 0) {
        facts.push(
          translatePlural(
            {
              one: "{{count}} of them was in the last 7 days.",
              other: "{{count}} of them were in the last 7 days.",
            },
            recent,
          ),
        );
      }

      // Half of everything or more: worth saying how much.
      if (
        insight.total &&
        insight.total > insight.count &&
        insight.count * 2 >= insight.total
      ) {
        facts.push(describeEverything(insight.total, context, insight.count));
      }

      return facts;
    }

    case AiActivityInsightKind.Hotspot:
      if (insight.total) {
        facts.push(
          context.subjectKind === "incident"
            ? translatePlural(
                {
                  one: "It was part of {{shown}} of the {{count}} incident created in the last {{days}} days.",
                  other:
                    "It was part of {{shown}} of the {{count}} incidents created in the last {{days}} days.",
                },
                insight.total,
                { shown: insight.count, days: context.windowInDays },
              )
            : context.subjectKind === "alert"
              ? translatePlural(
                  {
                    one: "It was part of {{shown}} of the {{count}} alert created in the last {{days}} days.",
                    other:
                      "It was part of {{shown}} of the {{count}} alerts created in the last {{days}} days.",
                  },
                  insight.total,
                  { shown: insight.count, days: context.windowInDays },
                )
              : translatePlural(
                  {
                    one: "It was part of {{shown}} of the {{count}} incident or alert on this {{noun}} in the last {{days}} days.",
                    other:
                      "It was part of {{shown}} of the {{count}} incidents and alerts on this {{noun}} in the last {{days}} days.",
                  },
                  insight.total,
                  {
                    shown: insight.count,
                    days: context.windowInDays,
                    noun: translatableTerm(context.noun, { inSentence: true }),
                  },
                ),
        );
      }

      facts.push(
        translateTemplate(
          "Problems that share one place often share one cause: look there first.",
        ),
      );

      return facts;

    case AiActivityInsightKind.ProblemStopped: {
      const fixedOn: string | null = describeDay(insight.fixedAt);

      facts.push(
        fixedOn
          ? translatePlural(
              {
                one: "It happened {{count}} time, and not once since the fix on {{date}}.",
                other:
                  "It happened {{count}} times, and not once since the fix on {{date}}.",
              },
              insight.count,
              { date: fixedOn },
            )
          : translatePlural(
              {
                one: "It happened {{count}} time, and not once since its fix.",
                other: "It happened {{count}} times, and not once since its fix.",
              },
              insight.count,
            ),
      );
      facts.push(
        translateTemplate(
          "OneUptime AI checked the fix afterwards: the problem was gone.",
        ),
      );

      return facts;
    }

    case AiActivityInsightKind.FixedAutomatically: {
      const verified: number = insight.verifiedCount || 0;

      if (verified > 0 && verified >= insight.count) {
        facts.push(
          translatePlural(
            {
              one: "It checked afterwards: the problem was gone.",
              other: "It checked each one afterwards: the problem was gone every time.",
            },
            insight.count,
          ),
        );
      } else if (verified > 0) {
        facts.push(
          translatePlural(
            {
              one: "{{count}} of them was checked afterwards and solved the problem.",
              other:
                "{{count}} of them were checked afterwards and solved the problem.",
            },
            verified,
          ),
        );
      }

      facts.push(
        translatePlural(
          {
            one: "Nobody had to approve it first.",
            other: "Nobody had to approve them first.",
          },
          insight.count,
        ),
      );

      return facts;
    }

    case AiActivityInsightKind.FixesDidNotHelp:
      facts.push(
        translatePlural(
          {
            one: "OneUptime AI checked after it was applied: the problem was still there.",
            other:
              "OneUptime AI checked after they were applied: the problems were still there.",
          },
          insight.count,
        ),
      );

      if (insight.total && insight.total > insight.count) {
        facts.push(
          translatePlural(
            {
              one: "That is {{shown}} of the {{count}} fix applied in the last {{days}} days.",
              other:
                "That is {{shown}} of the {{count}} fixes applied in the last {{days}} days.",
            },
            insight.total,
            { shown: insight.count, days: context.windowInDays },
          ),
        );
      }

      return facts;

    case AiActivityInsightKind.FixesAwaitingApproval:
      facts.push(
        translatePlural(
          {
            one: "OneUptime AI has it ready: it runs as soon as someone approves it.",
            other:
              "OneUptime AI has them ready: each runs as soon as someone approves it.",
          },
          insight.count,
        ),
      );

      return facts;

    case AiActivityInsightKind.ReadyForAutomaticFixes: {
      facts.push(
        translatePlural(
          {
            one: "That is {{count}} fix in the last {{days}} days, and none dismissed.",
            other:
              "That is {{count}} fixes in the last {{days}} days, and none dismissed.",
          },
          insight.count,
          { days: context.windowInDays },
        ),
      );

      if ((insight.verifiedCount || 0) > 0) {
        facts.push(
          translatePlural(
            {
              one: "{{count}} of them was checked afterwards and solved the problem.",
              other:
                "{{count}} of them were checked afterwards and solved the problem.",
            },
            insight.verifiedCount || 0,
          ),
        );
      }

      facts.push(
        translateTemplate(
          "Let OneUptime AI apply fixes like these on its own, and they run the moment the problem starts.",
        ),
      );

      return facts;
    }

    case AiActivityInsightKind.NotInvestigated: {
      const kind: "incident" | "alert" =
        context.subjectKind === "alert" ? "alert" : "incident";

      facts.push(describeNotInvestigatedReason(kind, insight.reason));

      if (insight.total) {
        facts.push(
          kind === "alert"
            ? translatePlural(
                {
                  one: "That is {{shown}} of the {{count}} alert created in the last {{days}} days.",
                  other:
                    "That is {{shown}} of the {{count}} alerts created in the last {{days}} days.",
                },
                insight.total,
                { shown: insight.count, days: context.windowInDays },
              )
            : translatePlural(
                {
                  one: "That is {{shown}} of the {{count}} incident created in the last {{days}} days.",
                  other:
                    "That is {{shown}} of the {{count}} incidents created in the last {{days}} days.",
                },
                insight.total,
                { shown: insight.count, days: context.windowInDays },
              ),
        );
      }

      return facts;
    }

    case AiActivityInsightKind.RiskSpotted: {
      const lastSeen: string | null = describeWhen(insight.lastSeenAt);

      facts.push(
        lastSeen
          ? translatePlural(
              {
                one: "Seen {{count}} time so far, last {{when}}.",
                other: "Seen {{count}} times so far, last {{when}}.",
              },
              insight.count,
              { when: lastSeen },
            )
          : translatePlural(
              {
                one: "Seen {{count}} time so far.",
                other: "Seen {{count}} times so far.",
              },
              insight.count,
            ),
      );
      facts.push(
        translateTemplate(
          "OneUptime AI's watch on the telemetry found it; nothing has paged anyone for it yet.",
        ),
      );

      return facts;
    }

    default:
      return facts;
  }
}

/*
 * An hour of the UTC day as the reader's own clock reads it today:
 * "1:00 AM", "13:00".
 */
export function formatUtcHour(hourUtc: number, reference: Date): string {
  const at: Date = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      ((hourUtc % 24) + 24) % 24,
      0,
      0,
    ),
  );

  return OneUptimeDate.getLocalTimeString(at, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/*
 * When a problem tends to happen, in the reader's own time: "It usually
 * starts between 1:00 AM and 4:00 AM (UTC): on 9 of the 10 days it
 * happened." — or, when it kept to that time every day it happened, "on
 * every one of the 10 days it happened".
 */
export function describeTimeOfDay(
  timeOfDay: AiActivityTimeOfDay,
  generatedAt?: string | undefined,
): string {
  const parsed: number = generatedAt ? Date.parse(generatedAt) : NaN;
  const reference: Date = Number.isFinite(parsed)
    ? new Date(parsed)
    : new Date();
  const startsAt: Date = new Date(
    Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
      timeOfDay.startHourUtc,
    ),
  );

  const values: {
    start: string;
    end: string;
    zone: string;
    days: number;
  } = {
    start: formatUtcHour(timeOfDay.startHourUtc, reference),
    end: formatUtcHour(timeOfDay.startHourUtc + timeOfDay.hours, reference),
    zone: OneUptimeDate.getLocalZoneAbbr(startsAt),
    days: timeOfDay.days,
  };

  if (timeOfDay.days >= timeOfDay.totalDays) {
    return translatePlural(
      {
        one: "It starts between {{start}} and {{end}} ({{zone}}) on the {{count}} day it happened.",
        other:
          "It starts between {{start}} and {{end}} ({{zone}}) on every one of the {{count}} days it happened.",
      },
      timeOfDay.totalDays,
      values,
    );
  }

  return translatePlural(
    {
      one: "It usually starts between {{start}} and {{end}} ({{zone}}): on {{days}} of the {{count}} day it happened.",
      other:
        "It usually starts between {{start}} and {{end}} ({{zone}}): on {{days}} of the {{count}} days it happened.",
    },
    timeOfDay.totalDays,
    values,
  );
}

/*
 * The label over an investigation's own words, and a note when they come
 * from its report because its TL;DR could not be written.
 */
export const AI_INSIGHTS_FINDING_LABEL: string = translationKey(
  "What OneUptime AI found",
);
export const AI_INSIGHTS_NEXT_STEP_LABEL: string = translationKey(
  "What it suggests",
);
export const AI_INSIGHTS_FROM_REPORT_NOTE: string = translationKey(
  "(from the investigation's report)",
);

/*
 * ------------------------------------------------------------------------
 * The problems and the parts behind them.
 * ------------------------------------------------------------------------
 */

/*
 * A problem's line under its title: how often it came up, how much of it
 * in the last 7 days, and when last — separate phrases, joined like a list.
 */
export function describeProblemCount(problem: AiActivityProblem): string {
  const parts: Array<string> = [
    translatePlural(
      { one: "{{count}} time", other: "{{count}} times" },
      problem.occurrenceCount,
    ),
  ];

  if (
    problem.recentOccurrenceCount > 0 &&
    problem.recentOccurrenceCount < problem.occurrenceCount
  ) {
    parts.push(
      translateTemplate("{{count}} in the last 7 days", {
        count: problem.recentOccurrenceCount,
      }),
    );
  }

  if (problem.investigationCount > 0) {
    parts.push(
      translatePlural(
        { one: "investigated {{count}} time", other: "investigated {{count}} times" },
        problem.investigationCount,
      ),
    );
  }

  const lastSeen: string | null = describeLastSeen(problem.lastSeenAt);

  if (lastSeen) {
    parts.push(lastSeen);
  }

  return parts.join(" · ");
}

// A preventive insight's line: how often it was seen, and when last.
export function describePreventiveInsight(
  insight: AiActivityPreventiveInsight,
): string {
  const parts: Array<string> = [];

  if (insight.occurrenceCount !== undefined) {
    parts.push(
      translatePlural(
        { one: "seen {{count}} time", other: "seen {{count}} times" },
        insight.occurrenceCount,
      ),
    );
  }

  const lastSeen: string | null = describeLastSeen(insight.lastSeenAt);

  if (lastSeen) {
    parts.push(lastSeen);
  }

  return parts.join(" · ");
}

/*
 * What happened to the fixes proposed for a problem, in one line, or null
 * when none was proposed. Only the parts that are not zero are said.
 */
export function describeProblemFixes(
  problem: AiActivityProblem,
): string | null {
  const fixes: AiActivityProblem["fixes"] = problem.fixes;

  if (fixes.proposed <= 0) {
    return null;
  }

  const parts: Array<string> = [
    translatePlural(
      { one: "{{count}} fix proposed", other: "{{count}} fixes proposed" },
      fixes.proposed,
    ),
  ];

  if (fixes.applied > 0) {
    parts.push(
      translateTemplate("{{count}} applied", { count: fixes.applied }),
    );
  }

  if (fixes.verified > 0) {
    parts.push(
      translateTemplate("{{count}} verified", { count: fixes.verified }),
    );
  }

  if (fixes.failed > 0) {
    parts.push(
      translateTemplate("{{count}} did not help", { count: fixes.failed }),
    );
  }

  if (fixes.awaitingApproval > 0) {
    parts.push(
      translateTemplate("{{count}} waiting for approval", {
        count: fixes.awaitingApproval,
      }),
    );
  }

  return parts.join(" · ");
}

/*
 * What people and the grader said of a problem's findings, or null when
 * nobody said anything.
 */
export function describeProblemVerdicts(
  problem: AiActivityProblem,
): string | null {
  const verdicts: AiActivityProblem["verdicts"] = problem.verdicts;
  const parts: Array<string> = [];

  if (verdicts.confirmed > 0) {
    parts.push(
      translatePlural(
        {
          one: "your team confirmed {{count}} finding",
          other: "your team confirmed {{count}} findings",
        },
        verdicts.confirmed,
      ),
    );
  }

  if (verdicts.rejected > 0) {
    parts.push(
      translatePlural(
        {
          one: "your team rejected {{count}} finding",
          other: "your team rejected {{count}} findings",
        },
        verdicts.rejected,
      ),
    );
  }

  if (verdicts.matched + verdicts.partlyMatched > 0) {
    parts.push(
      translatePlural(
        {
          one: "{{count}} finding matched the root cause recorded later",
          other: "{{count}} findings matched the root cause recorded later",
        },
        verdicts.matched + verdicts.partlyMatched,
      ),
    );
  }

  if (verdicts.mismatched > 0) {
    parts.push(
      translatePlural(
        {
          one: "{{count}} finding did not match the root cause recorded later",
          other:
            "{{count}} findings did not match the root cause recorded later",
        },
        verdicts.mismatched,
      ),
    );
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/*
 * A part's line: how many incidents and alerts it was part of, in how many
 * problems, and when last — separate phrases, joined like a list.
 */
export function describeHotspot(hotspot: AiActivityHotspot): string {
  const parts: Array<string> = [
    translatePlural(
      { one: "{{count}} time", other: "{{count}} times" },
      hotspot.occurrenceCount,
    ),
    translatePlural(
      { one: "{{count}} problem", other: "{{count}} problems" },
      hotspot.problemCount,
    ),
  ];
  const lastSeen: string | null = describeLastSeen(hotspot.lastSeenAt);

  if (lastSeen) {
    parts.push(lastSeen);
  }

  return parts.join(" · ");
}

/*
 * A monitor's or service's line: in how many of the window's incidents (or
 * alerts), across how many problems, and when last.
 */
export function describeResourceHotspot(
  hotspot: AiActivityResourceHotspot,
  subjectKind: "incident" | "alert",
): string {
  const parts: Array<string> = [
    subjectKind === "alert"
      ? translatePlural(
          { one: "{{count}} alert", other: "{{count}} alerts" },
          hotspot.occurrenceCount,
        )
      : translatePlural(
          { one: "{{count}} incident", other: "{{count}} incidents" },
          hotspot.occurrenceCount,
        ),
    translatePlural(
      { one: "{{count}} problem", other: "{{count}} problems" },
      hotspot.problemCount,
    ),
  ];
  const lastSeen: string | null = describeLastSeen(hotspot.lastSeenAt);

  if (lastSeen) {
    parts.push(lastSeen);
  }

  return parts.join(" · ");
}

/*
 * ------------------------------------------------------------------------
 * What AI did: the page's footnote.
 * ------------------------------------------------------------------------
 */

export enum AiActivityHealthKind {
  // Investigations that ended in an error or timed out.
  InvestigationsFailed = "InvestigationsFailed",
  // Commands the agent never picked up.
  CommandsTimedOut = "CommandsTimedOut",
  // Findings people rejected, or the grader found wrong.
  FindingsRejected = "FindingsRejected",
}

// A note on how AI's own work went: said under what it did, with a link.
export interface AiActivityHealthNote {
  kind: AiActivityHealthKind;
  sentence: string;
}

/*
 * What went wrong with AI's own work, worth a line under what it did:
 * investigations that failed, commands no agent ran, findings people
 * rejected. Never the page's headline — it is about AI, not the system.
 */
export function getActivityHealthNotes(
  totals: AiActivityInsightsTotals,
  context: { windowInDays: number },
): Array<AiActivityHealthNote> {
  const notes: Array<AiActivityHealthNote> = [];

  if (totals.failedInvestigations > 0) {
    notes.push({
      kind: AiActivityHealthKind.InvestigationsFailed,
      sentence: translatePlural(
        {
          one: "{{count}} investigation failed or timed out in the last {{days}} days.",
          other:
            "{{count}} investigations failed or timed out in the last {{days}} days.",
        },
        totals.failedInvestigations,
        { days: context.windowInDays },
      ),
    });
  }

  if (totals.timedOutCommands > 0) {
    notes.push({
      kind: AiActivityHealthKind.CommandsTimedOut,
      sentence: translatePlural(
        {
          one: "{{count}} command OneUptime AI sent was never picked up by the agent.",
          other:
            "{{count}} commands OneUptime AI sent were never picked up by the agent.",
        },
        totals.timedOutCommands,
      ),
    });
  }

  if (totals.rejectedFindings > 0) {
    notes.push({
      kind: AiActivityHealthKind.FindingsRejected,
      sentence: translatePlural(
        {
          one: "{{count}} finding was rejected by your team or did not match the root cause recorded later.",
          other:
            "{{count}} findings were rejected by your team or did not match the root cause recorded later.",
        },
        totals.rejectedFindings,
      ),
    });
  }

  return notes;
}

/*
 * What people and the grader thought of AI's findings, or null when nobody
 * said: "Your team confirmed 9 findings and rejected 1."
 */
export function describeFindingsTrust(
  totals: AiActivityInsightsTotals,
): string | null {
  if (totals.confirmedFindings <= 0) {
    return null;
  }

  return translatePlural(
    {
      one: "{{count}} finding was confirmed by your team or matched the root cause recorded later.",
      other:
        "{{count}} findings were confirmed by your team or matched the root cause recorded later.",
    },
    totals.confirmedFindings,
  );
}

/*
 * Why an incident (or alert) was not investigated, as its creation recorded
 * it: one sentence each, standing on its own, about the skipped ones.
 */
export const NOT_INVESTIGATED_REASONS: Record<
  "incident" | "alert",
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
    project_daily_limit_reached: translationKey(
      "The project had reached its own daily AI limit.",
    ),
    no_investigation_rule_matched: translationKey(
      "They matched none of the investigation rules.",
    ),
    severity_below_threshold: translationKey(
      "They were below the minimum severity to investigate.",
    ),
    monitor_cooldown: translationKey(
      "Their monitor had just been investigated, inside the re-investigation cooldown.",
    ),
    created_resolved: translationKey("They were created already resolved."),
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
    project_daily_limit_reached: translationKey(
      "The project had reached its own daily AI limit.",
    ),
    no_investigation_rule_matched: translationKey(
      "They matched none of the investigation rules.",
    ),
    severity_below_threshold: translationKey(
      "They were below the minimum severity to investigate.",
    ),
    monitor_cooldown: translationKey(
      "Their monitor had just been investigated, inside the re-investigation cooldown.",
    ),
    created_resolved: translationKey("They were created already resolved."),
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
  subjectKind: "incident" | "alert",
  code: string | undefined,
): string {
  const reasons: Record<InvestigationNotStartedCode, string> =
    NOT_INVESTIGATED_REASONS[subjectKind];
  // Only a code of the table: never one of an object's own properties.
  const reason: string | undefined =
    code && Object.prototype.hasOwnProperty.call(reasons, code)
      ? reasons[code as InvestigationNotStartedCode]
      : undefined;

  return translateTemplate(
    reason || translationKey("For a reason this page does not know yet."),
  );
}

/*
 * Investigations in the last seven days of the trend, and in the seven
 * before them: the trend's one-line summary.
 */
export function getTrendWeeks(trend: Array<AiActivityTrendDay>): {
  thisWeek: number;
  lastWeek: number;
} {
  const sum: (days: Array<AiActivityTrendDay>) => number = (
    days: Array<AiActivityTrendDay>,
  ): number => {
    return days.reduce((total: number, day: AiActivityTrendDay): number => {
      return total + day.investigations;
    }, 0);
  };

  return {
    thisWeek: sum(trend.slice(-7)),
    lastWeek: sum(trend.slice(-14, -7)),
  };
}

export function describeTrendWeeks(trend: Array<AiActivityTrendDay>): string {
  const weeks: { thisWeek: number; lastWeek: number } = getTrendWeeks(trend);

  return translatePlural(
    {
      one: "{{count}} investigation in the last 7 days ({{lastWeek}} the 7 days before).",
      other:
        "{{count}} investigations in the last 7 days ({{lastWeek}} the 7 days before).",
    },
    weeks.thisWeek,
    { lastWeek: weeks.lastWeek },
  );
}

/*
 * A day's bar, on hover. Without the fixes for a reader who may not see
 * them: their 0 would read as "no fixes".
 */
export function describeTrendDay(
  day: AiActivityTrendDay,
  options: { fixesHidden?: boolean | undefined } = {},
): string {
  if (options.fixesHidden) {
    return translateTemplate(
      "{{date}}: {{investigations}} investigations, {{failed}} failed",
      {
        date: day.date,
        investigations: day.investigations,
        failed: day.failedInvestigations,
      },
    );
  }

  return translateTemplate(
    "{{date}}: {{investigations}} investigations, {{failed}} failed, {{fixes}} fixes",
    {
      date: day.date,
      investigations: day.investigations,
      failed: day.failedInvestigations,
      fixes: day.fixes,
    },
  );
}

// One segment of the fixes bar.
export interface AiInsightsFixSegment {
  label: string;
  value: number;
  // A Tailwind background class, as StackedProgressBar takes it.
  color: string;
}

/*
 * The fixes of the window by where they ended up, for the fixes bar:
 * applied first, then waiting, then the ones that went nowhere.
 */
export function getFixSegments(
  outcomes: AiActivityFixOutcomes,
): Array<AiInsightsFixSegment> {
  return [
    {
      label: translationKey("Applied automatically"),
      value: outcomes.appliedAutomatically,
      color: "bg-green-500",
    },
    {
      label: translationKey("Applied after approval"),
      value: outcomes.appliedAfterApproval,
      color: "bg-emerald-400",
    },
    {
      label: translationKey("Waiting for approval"),
      value: outcomes.awaitingApproval,
      color: "bg-amber-400",
    },
    {
      label: translationKey("Planning"),
      value: outcomes.planning,
      color: "bg-sky-300",
    },
    {
      label: translationKey("Dismissed"),
      value: outcomes.dismissed,
      color: "bg-gray-300",
    },
    {
      label: translationKey("No fix found"),
      value: outcomes.noFixFound,
      color: "bg-gray-200",
    },
  ].filter((segment: AiInsightsFixSegment): boolean => {
    return segment.value > 0;
  });
}

// How applied fixes' verification went, or null when nothing was verified.
export function describeFixVerification(
  outcomes: AiActivityFixOutcomes,
): string | null {
  if (outcomes.verified + outcomes.failed + outcomes.verifying <= 0) {
    return null;
  }

  return translateTemplate(
    "Verification: {{verified}} resolved the problem, {{failed}} did not, {{verifying}} still being checked.",
    {
      verified: outcomes.verified,
      failed: outcomes.failed,
      verifying: outcomes.verifying,
    },
  );
}

/*
 * ------------------------------------------------------------------------
 * The incidents' and alerts' own sections.
 * ------------------------------------------------------------------------
 */

export const AI_INSIGHTS_FIXES_HIDDEN_NOTE: string = translationKey(
  "Fix numbers are not shown: seeing them needs permission to read auto-remediation suggestions.",
);

/*
 * The fix pull requests of the window by where they ended up, for the fixes
 * second bar: opened first, then the ones still running, then the ones
 * that went nowhere.
 */
export function getFixTaskSegments(
  outcomes: AiActivityFixTaskOutcomes,
): Array<AiInsightsFixSegment> {
  return [
    {
      label: translationKey("Pull request opened"),
      value: outcomes.pullRequestsOpened,
      color: "bg-green-500",
    },
    {
      label: translationKey("In progress"),
      value: outcomes.inProgress,
      color: "bg-sky-300",
    },
    {
      label: translationKey("No fix found"),
      value: outcomes.noFixFound,
      color: "bg-gray-200",
    },
    {
      label: translationKey("Failed"),
      value: outcomes.failed,
      color: "bg-red-400",
    },
    {
      label: translationKey("Cancelled"),
      value: outcomes.cancelled,
      color: "bg-gray-300",
    },
  ].filter((segment: AiInsightsFixSegment): boolean => {
    return segment.value > 0;
  });
}

/*
 * How much of the window AI looked at: "OneUptime AI investigated 12 of the
 * 40 incidents created in the last 30 days."
 */
export function describeCoverage(
  coverage: AiActivityCoverage,
  subjectKind: "incident" | "alert",
): string {
  return subjectKind === "alert"
    ? translatePlural(
        {
          one: "OneUptime AI investigated {{investigated}} of the {{count}} alert created in the last 30 days.",
          other:
            "OneUptime AI investigated {{investigated}} of the {{count}} alerts created in the last 30 days.",
        },
        coverage.subjects,
        { investigated: coverage.investigatedSubjects },
      )
    : translatePlural(
        {
          one: "OneUptime AI investigated {{investigated}} of the {{count}} incident created in the last 30 days.",
          other:
            "OneUptime AI investigated {{investigated}} of the {{count}} incidents created in the last 30 days.",
        },
        coverage.subjects,
        { investigated: coverage.investigatedSubjects },
      );
}
