import { describeSubject } from "../ActivityInsights/AiActivityInsightsData";
import {
  describeFixKind,
  describeVerdicts,
} from "../../IncidentAlertAi/IncidentAlertAiLogs";
import {
  AI_OUTCOMES_PARTS,
  AiOutcomesPart,
  AiOutcomesRecord,
  AiOutcomesRecordSubject,
  AiOutcomesRecords,
  isAiOutcomesPartOutcome,
} from "Common/Types/AI/AiOutcomes";
import { JSONObject } from "Common/Types/JSON";
import {
  getGlobalTranslator,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE RECORDS BEHIND AN AI RESULTS NUMBER (issue #7768): the words and the
 * reading of the list a breakdown's part opens - "Paged: the hold time ran
 * out (4)" opens the four held pages, each with its incident or alert;
 * "Missed the root cause (15)" the fifteen investigations, each with what
 * it found and how it was judged; "Still happening after the fix (2)" the
 * two fix pull requests.
 *
 * The server lists exactly what the number counts (POST
 * /ai-activity/outcomes/records, AiOutcomesReader.readRecords), so the
 * dialog's count is the card's. Import-clean (Common types, the
 * translation helpers and the AI pages' word helpers), so the suites read
 * it without a browser.
 */

// What its legend entry says it opens, in English: on hover and read after it.
export const AI_RESULTS_RECORDS_CLICK_HINTS: Record<AiOutcomesPart, string> = {
  [AiOutcomesPart.Pages]: translationKey("Show the incidents and alerts"),
  [AiOutcomesPart.RemediationFixes]: translationKey(
    "Show the incidents and alerts",
  ),
  [AiOutcomesPart.PullRequestFixes]: translationKey("Show the pull requests"),
  [AiOutcomesPart.RootCauses]: translationKey("Show the incidents and alerts"),
  [AiOutcomesPart.IssueVerdicts]: translationKey("Show the issues"),
};

/*
 * The line under the dialog's title: how many it lists, and what. The
 * headlines are plain literals the extractor reads as one count-dependent
 * sentence each.
 */
export const AI_RESULTS_RECORDS_COUNTS: Record<AiOutcomesPart, PluralTemplate> =
  {
    [AiOutcomesPart.Pages]: {
      one: "{{count}} held page over the last 12 weeks.",
      other: "{{count}} held pages over the last 12 weeks, newest first.",
    },
    [AiOutcomesPart.RemediationFixes]: {
      one: "{{count}} fix OneUptime AI ran over the last 12 weeks.",
      other:
        "{{count}} fixes OneUptime AI ran over the last 12 weeks, newest first.",
    },
    [AiOutcomesPart.PullRequestFixes]: {
      one: "{{count}} fix pull request OneUptime AI opened over the last 12 weeks.",
      other:
        "{{count}} fix pull requests OneUptime AI opened over the last 12 weeks, newest first.",
    },
    [AiOutcomesPart.RootCauses]: {
      one: "{{count}} investigation OneUptime AI finished over the last 12 weeks.",
      other:
        "{{count}} investigations OneUptime AI finished over the last 12 weeks, newest first.",
    },
    [AiOutcomesPart.IssueVerdicts]: {
      one: "{{count}} Data Security issue OneUptime AI analyzed over the last 12 weeks.",
      other:
        "{{count}} Data Security issues OneUptime AI analyzed over the last 12 weeks, newest first.",
    },
  };

// Nothing counts under the number any more: it changed after the page counted it.
export const AI_RESULTS_RECORDS_EMPTY: string = translationKey(
  "None any more: this changed after the page counted it. Reload the page for the latest numbers.",
);

export const AI_RESULTS_RECORDS_WHAT_FAILED: string = translationKey(
  "Couldn't read what this number counts.",
);

export const AI_RESULTS_RECORDS_TEST_ID: string = "ai-results-records";

export function describeRecordsCount(
  part: AiOutcomesPart,
  total: number,
  translator: Translator = getGlobalTranslator(),
): string {
  return translator.translatePlural(AI_RESULTS_RECORDS_COUNTS[part], total);
}

/*
 * ---------------------------------------------------------------------------
 * Reading the server's answer.
 * ---------------------------------------------------------------------------
 */

// What a pull request's link may be: a web address, never a script.
const WEB_ADDRESS: RegExp = /^https?:\/\//i;

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readSubject(value: unknown): AiOutcomesRecordSubject | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const kind: unknown = value["kind"];
  const id: string | undefined = readText(value["id"]);

  if (
    (kind !== "incident" && kind !== "alert" && kind !== "dataSecurityIssue") ||
    !id
  ) {
    return undefined;
  }

  return {
    kind,
    id,
    ...(readText(value["title"]) ? { title: readText(value["title"]) } : {}),
    ...(isCount(value["number"]) ? { number: value["number"] } : {}),
    ...(readText(value["numberWithPrefix"])
      ? { numberWithPrefix: readText(value["numberWithPrefix"]) }
      : {}),
  };
}

function readRecord(value: unknown): AiOutcomesRecord | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | undefined = readText(value["id"]);
  const at: string | undefined = readText(value["at"]);

  if (!id || !at || Number.isNaN(new Date(at).getTime())) {
    return null;
  }

  const subject: AiOutcomesRecordSubject | undefined = readSubject(
    value["subject"],
  );
  const url: string | undefined = readText(value["pullRequestUrl"]);

  const texts: Array<keyof AiOutcomesRecord> = [
    "runbookName",
    "suggestionType",
    "pullRequestTitle",
    "summary",
    "humanVerdict",
    "autoGrade",
    "issueVerdict",
    "issueStatus",
  ];

  const record: AiOutcomesRecord = { id, at };

  if (subject) {
    record.subject = subject;
  }

  for (const key of texts) {
    const text: string | undefined = readText(value[key]);

    if (text) {
      (record as unknown as Record<string, string>)[key] = text;
    }
  }

  if (isCount(value["pullRequestNumber"])) {
    record.pullRequestNumber = value["pullRequestNumber"];
  }

  // A link only to a web address.
  if (url && WEB_ADDRESS.test(url)) {
    record.pullRequestUrl = url;
  }

  return record;
}

/*
 * The server's AiOutcomesRecords, or null when it is not something the
 * dialog can draw. A record it cannot read is left out.
 */
export function parseAiOutcomesRecords(
  data: unknown,
): AiOutcomesRecords | null {
  if (!isObject(data)) {
    return null;
  }

  const part: unknown = data["part"];
  const outcome: unknown = data["outcome"];

  if (
    typeof part !== "string" ||
    !AI_OUTCOMES_PARTS.includes(part as AiOutcomesPart) ||
    typeof outcome !== "string" ||
    !isAiOutcomesPartOutcome(part as AiOutcomesPart, outcome) ||
    !isCount(data["total"]) ||
    !Array.isArray(data["records"])
  ) {
    return null;
  }

  const nextSkip: unknown = data["nextSkip"];

  return {
    part: part as AiOutcomesPart,
    outcome,
    total: data["total"],
    records: (data["records"] as Array<unknown>)
      .map(readRecord)
      .filter((record: AiOutcomesRecord | null): boolean => {
        return Boolean(record);
      }) as Array<AiOutcomesRecord>,
    nextSkip: isCount(nextSkip) ? nextSkip : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * The words of a record.
 * ---------------------------------------------------------------------------
 */

// How its incident or alert is named: "Incident INC-42: Checkout is down".
export function describeRecordSubject(
  subject: AiOutcomesRecordSubject,
): string {
  // A Data Security issue is named by its title, OneUptime's words for its check (#10369).
  if (subject.kind === "dataSecurityIssue") {
    const translator: Translator = getGlobalTranslator();

    return (
      translator.translateText(subject.title) ||
      subject.title ||
      translator.translateText(DATA_SECURITY_ISSUE) ||
      DATA_SECURITY_ISSUE
    );
  }

  return describeSubject(subject as Parameters<typeof describeSubject>[0]);
}

const DATA_SECURITY_ISSUE: string = translationKey("Data Security issue");

/*
 * What an analyzed issue's record says under it (#10369): OneUptime AI's
 * verdict, and where the issue stands now.
 */
export const ISSUE_VERDICT_FACTS: Readonly<Record<string, string>> = {
  Real: translationKey("OneUptime AI said: real"),
  LikelyByDesign: translationKey("OneUptime AI said: likely by design"),
  LikelyWrongFinding: translationKey(
    "OneUptime AI said: likely a wrong finding",
  ),
  CannotTell: translationKey("OneUptime AI could not tell"),
};

export const ISSUE_STATUS_FACTS: Readonly<Record<string, string>> = {
  Open: translationKey("Still open"),
  Resolved: translationKey("Fixed: its check passes"),
  Accepted: translationKey("Its risk was accepted"),
  "Not an issue": translationKey("Marked not an issue"),
};

/*
 * The small grey facts under a record, as translation keys: what kind of
 * fix it was, and how an investigation was judged - by your team on its AI
 * card, and against the root cause written when it was resolved.
 */
export function getRecordFacts(
  part: AiOutcomesPart,
  record: AiOutcomesRecord,
): Array<string> {
  if (part === AiOutcomesPart.IssueVerdicts) {
    return [
      ISSUE_VERDICT_FACTS[record.issueVerdict || ""] || "",
      ISSUE_STATUS_FACTS[record.issueStatus || ""] || "",
    ].filter((fact: string): boolean => {
      return fact.length > 0;
    });
  }

  if (part === AiOutcomesPart.RemediationFixes) {
    // A runbook says its name instead (Runbook: {{name}}).
    if (record.runbookName) {
      return [];
    }

    const kind: string | null = describeFixKind(record.suggestionType || null);

    return kind ? [kind] : [];
  }

  if (part === AiOutcomesPart.RootCauses) {
    return describeVerdicts({
      humanVerdict: record.humanVerdict || null,
      autoGrade: record.autoGrade || null,
    });
  }

  return [];
}
