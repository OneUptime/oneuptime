import {
  AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS,
  AiActivityAttentionItem,
  AiActivityAttentionKind,
  AiActivityAttentionSeverity,
  AiActivityCoverage,
  AiActivityFinding,
  AiActivityFixOutcomes,
  AiActivityFixTaskOutcomes,
  AiActivityHotspot,
  AiActivityInsights,
  AiActivityInsightsTotals,
  AiActivityNamedResource,
  AiActivityObject,
  AiActivityPreventiveInsight,
  AiActivityProblem,
  AiActivityResourceHotspot,
  AiActivitySubject,
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
 * /kubernetes-cluster/ai-access/insights or /resource-ai-access/insights)
 * and the words for each part of it. The server sends numbers and keys,
 * never prose; every sentence is built here, in the reader's language.
 *
 * Shared by every scope's Insights page — a cluster, each resource with a
 * resource AI agent, and a project's incidents and its alerts — so nothing
 * here knows which scope it is about beyond the noun it is given, and the
 * sections only the incidents' and alerts' pages have (coverage, monitors
 * and services, fix pull requests) are worded only when the body has them.
 *
 * Import-clean on purpose (Common types and the translation helpers only),
 * so the suites read it without a browser. Server text — titles, findings,
 * label values — is only ever rendered as plain text.
 */

export const AI_INSIGHTS_PAGE_TITLE: string = translationKey("AI Insights");

export const AI_INSIGHTS_EMPTY_TITLE: string = translationKey(
  "No AI activity in the last 30 days",
);

export function getAiInsightsPageSubtitle(noun: string): string {
  return translateTemplate(
    "What OneUptime AI has learned about this {{noun}} in the last 30 days, and what deserves your attention.",
    { noun: translatableTerm(noun, { inSentence: true }) },
  );
}

export function getAiInsightsEmptyDescription(noun: string): string {
  return translateTemplate(
    "When OneUptime AI investigates incidents and alerts on this {{noun}}, what it learns shows up here: the problems that keep coming back, the parts of the {{noun}} they hit, what the investigations found and how fixes turned out.",
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

  return {
    ...resource,
    subjectCount: readCount(value["subjectCount"]),
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

  return name && objectValue ? { name, value: objectValue } : null;
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
  const firstSeenAt: string | null = readString(value["firstSeenAt"]);
  const lastSeenAt: string | null = readString(value["lastSeenAt"]);
  const investigationCount: number = readCount(value["investigationCount"]);

  return {
    key,
    title: readString(value["title"]) || "",
    investigationCount,
    subjectCount: readCount(value["subjectCount"]),
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

  return {
    ...object,
    investigationCount: readCount(value["investigationCount"]),
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

const ATTENTION_KINDS: ReadonlyArray<string> = Object.values(
  AiActivityAttentionKind,
);
const ATTENTION_SEVERITIES: ReadonlyArray<string> = Object.values(
  AiActivityAttentionSeverity,
);

function readAttentionItem(value: unknown): AiActivityAttentionItem | null {
  if (!isObject(value)) {
    return null;
  }

  // A kind or severity a newer server added cannot be worded: skipped.
  if (
    !ATTENTION_KINDS.includes(String(value["kind"])) ||
    !ATTENTION_SEVERITIES.includes(String(value["severity"]))
  ) {
    return null;
  }

  const total: number | undefined = readOptionalCount(value["total"]);
  const recentCount: number | undefined = readOptionalCount(
    value["recentCount"],
  );
  const problemKey: string | null = readString(value["problemKey"]);
  const title: string | null = readString(value["title"]);
  const object: AiActivityObject | null = readObject(value["object"]);
  const subject: AiActivitySubject | null = readSubject(value["subject"]);
  const insightId: string | null = readString(value["insightId"]);
  const insightSeverity: string | null = readString(value["insightSeverity"]);
  const reason: string | null = readString(value["reason"]);
  const monitor: AiActivityNamedResource | null = readNamedResource(
    value["monitor"],
  );

  return {
    kind: value["kind"] as AiActivityAttentionKind,
    severity: value["severity"] as AiActivityAttentionSeverity,
    count: readCount(value["count"]),
    ...(total !== undefined ? { total } : {}),
    ...(recentCount !== undefined ? { recentCount } : {}),
    ...(problemKey ? { problemKey } : {}),
    ...(title ? { title } : {}),
    ...(object ? { object } : {}),
    ...(subject ? { subject } : {}),
    ...(insightId ? { insightId } : {}),
    ...(insightSeverity ? { insightSeverity } : {}),
    ...(reason ? { reason: reason as InvestigationNotStartedCode } : {}),
    ...(monitor ? { monitor } : {}),
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
    investigations: readCount(totals["investigations"]),
    completedInvestigations: readCount(totals["completedInvestigations"]),
    failedInvestigations: readCount(totals["failedInvestigations"]),
    activeInvestigations: readCount(totals["activeInvestigations"]),
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
    attention: readList(value["attention"], readAttentionItem),
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
 * Whether the window holds anything to show. With nothing, the page shows
 * one empty state instead of a row of zeros.
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
 * The words.
 * ------------------------------------------------------------------------
 */

export interface AiInsightsLook {
  color: Color;
  icon: IconProp;
  label: string;
}

const ATTENTION_LOOKS: Record<AiActivityAttentionSeverity, AiInsightsLook> = {
  [AiActivityAttentionSeverity.High]: {
    color: Red500,
    icon: IconProp.ExclaimationCircle,
    label: translationKey("Needs attention now"),
  },
  [AiActivityAttentionSeverity.Medium]: {
    color: Yellow500,
    icon: IconProp.Alert,
    label: translationKey("Worth a look"),
  },
  [AiActivityAttentionSeverity.Low]: {
    color: Gray500,
    icon: IconProp.Info,
    label: translationKey("Good to know"),
  },
};

export function getAttentionLook(
  severity: AiActivityAttentionSeverity,
): AiInsightsLook {
  return ATTENTION_LOOKS[severity] || ATTENTION_LOOKS.Low;
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

/*
 * A problem's line under its title: how often it was investigated, across
 * how many incidents and alerts (or, on the incidents' or alerts' own page,
 * how many incidents, or alerts), and when last.
 */
export function describeProblemCount(
  problem: AiActivityProblem,
  subjectKind?: "incident" | "alert" | undefined,
): string {
  const parts: Array<string> = [
    translatePlural(
      {
        one: "Investigated {{count}} time",
        other: "Investigated {{count}} times",
      },
      problem.investigationCount,
    ),
  ];

  if (problem.subjectCount > 1) {
    parts.push(
      subjectKind === "incident"
        ? translatePlural(
            { one: "{{count}} incident", other: "{{count}} incidents" },
            problem.subjectCount,
          )
        : subjectKind === "alert"
          ? translatePlural(
              { one: "{{count}} alert", other: "{{count}} alerts" },
              problem.subjectCount,
            )
          : translateTemplate("{{count}} incidents and alerts", {
              count: problem.subjectCount,
            }),
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
 * A hotspot's line: how many investigations and problems it showed up in,
 * and when last — separate phrases, joined like a list.
 */
export function describeHotspot(hotspot: AiActivityHotspot): string {
  const parts: Array<string> = [
    translatePlural(
      { one: "{{count}} investigation", other: "{{count}} investigations" },
      hotspot.investigationCount,
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
 * The sentence an attention item says, in the reader's language. The link
 * next to it (the incident or alert, the insight, the logs) is the page's.
 * subjectKind is the incidents' or alerts' own page's product.
 */
export function describeAttentionItem(
  item: AiActivityAttentionItem,
  context: {
    windowInDays: number;
    subjectKind?: "incident" | "alert" | undefined;
  },
): string {
  switch (item.kind) {
    case AiActivityAttentionKind.FixesFailed:
      return translatePlural(
        {
          one: "{{count}} fix OneUptime AI applied did not resolve the problem it was for.",
          other:
            "{{count}} fixes OneUptime AI applied did not resolve the problems they were for.",
        },
        item.count,
      );

    case AiActivityAttentionKind.RecurringProblem: {
      const recurring: string = translatePlural(
        {
          one: "{{title}} keeps coming back: OneUptime AI investigated it {{count}} time in the last {{days}} days.",
          other:
            "{{title}} keeps coming back: OneUptime AI investigated it {{count}} times in the last {{days}} days.",
        },
        item.count,
        {
          title: item.title || translateTerm("A problem"),
          days: context.windowInDays,
        },
      );

      if (!item.recentCount) {
        return recurring;
      }

      return `${recurring} ${translatePlural(
        {
          one: "{{count}} of those was in the last {{days}} days.",
          other: "{{count}} of those were in the last {{days}} days.",
        },
        item.recentCount,
        { days: AI_ACTIVITY_INSIGHTS_RECENT_WINDOW_IN_DAYS },
      )}`;
    }

    case AiActivityAttentionKind.PreventiveInsight:
      return translateTemplate("An open preventive insight: {{title}}", {
        title: item.title || "",
      });

    case AiActivityAttentionKind.FixesAwaitingApproval:
      return translatePlural(
        {
          one: "{{count}} fix OneUptime AI proposed is waiting for approval.",
          other:
            "{{count}} fixes OneUptime AI proposed are waiting for approval.",
        },
        item.count,
      );

    case AiActivityAttentionKind.InvestigationsFailed:
      return translatePlural(
        {
          one: "{{count}} investigation failed or timed out in the last {{days}} days.",
          other:
            "{{count}} investigations failed or timed out in the last {{days}} days.",
        },
        item.count,
        { days: context.windowInDays },
      );

    case AiActivityAttentionKind.CommandsTimedOut:
      return translatePlural(
        {
          one: "{{count}} command OneUptime AI sent was never picked up by the agent.",
          other:
            "{{count}} commands OneUptime AI sent were never picked up by the agent.",
        },
        item.count,
      );

    case AiActivityAttentionKind.FindingsRejected:
      return translatePlural(
        {
          one: "{{count}} finding was rejected by your team or did not match the root cause recorded later.",
          other:
            "{{count}} findings were rejected by your team or did not match the root cause recorded later.",
        },
        item.count,
      );

    case AiActivityAttentionKind.Hotspot:
      return translatePlural(
        {
          one: "{{object}} shows up in {{shown}} of the {{count}} investigation here.",
          other:
            "{{object}} shows up in {{shown}} of the {{count}} investigations here.",
        },
        item.total || item.count,
        {
          object: item.object ? describeObject(item.object) : "",
          shown: item.count,
        },
      );

    case AiActivityAttentionKind.InvestigationsNotStarted:
      return context.subjectKind === "alert"
        ? translatePlural(
            {
              one: "{{count}} alert created in the last {{days}} days was not investigated.",
              other:
                "{{count}} alerts created in the last {{days}} days were not investigated.",
            },
            item.count,
            { days: context.windowInDays },
          )
        : translatePlural(
            {
              one: "{{count}} incident created in the last {{days}} days was not investigated.",
              other:
                "{{count}} incidents created in the last {{days}} days were not investigated.",
            },
            item.count,
            { days: context.windowInDays },
          );

    case AiActivityAttentionKind.MonitorHotspot:
      return translatePlural(
        {
          one: "{{name}} was behind {{shown}} of the {{count}} investigation here.",
          other:
            "{{name}} was behind {{shown}} of the {{count}} investigations here.",
        },
        item.total || item.count,
        { name: item.monitor?.name || "", shown: item.count },
      );

    default:
      return "";
  }
}

/*
 * The line under an attention item's sentence, when it has one: why the
 * incidents (or alerts) were not investigated.
 */
export function describeAttentionDetail(
  item: AiActivityAttentionItem,
  context: { subjectKind?: "incident" | "alert" | undefined },
): string | null {
  if (item.kind === AiActivityAttentionKind.InvestigationsNotStarted) {
    return describeNotInvestigatedReason(
      context.subjectKind === "alert" ? "alert" : "incident",
      item.reason,
    );
  }

  return null;
}

/*
 * Investigations in the last seven days of the trend, and in the seven
 * before them: the trend card's one-line summary.
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
 * The fixes of the window by where they ended up, for the fixes card's bar:
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
 * card's second bar: opened first, then the ones still running, then the
 * ones that went nowhere.
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
 * A monitor's or service's line: in how many of the incidents (or alerts)
 * AI investigated, across how many problems, and when last.
 */
export function describeResourceHotspot(
  hotspot: AiActivityResourceHotspot,
  subjectKind: "incident" | "alert",
): string {
  const parts: Array<string> = [
    subjectKind === "alert"
      ? translatePlural(
          {
            one: "{{count}} alert investigated",
            other: "{{count}} alerts investigated",
          },
          hotspot.subjectCount,
        )
      : translatePlural(
          {
            one: "{{count}} incident investigated",
            other: "{{count}} incidents investigated",
          },
          hotspot.subjectCount,
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
