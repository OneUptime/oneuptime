import type { Ionicons } from "@expo/vector-icons";

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * THE WORDS A SECURITY CASE IS READ IN - the values the server stores and the
 * sentences the dashboard says of them (Common/Types/SecurityCase/
 * SecurityCaseVerdict, SecurityCaseAiVerdict and SecurityEntity), kept here
 * because the app is built without Common's runtime code. Common's
 * SecurityCaseMobileParity suite reads this file and holds every value and
 * sentence to Common's, so a verdict added or reworded there fails until it
 * is here too.
 */

/*
 * What a closed case turned out to be, in the order the close sheet offers
 * them, each with what it means.
 */
export type SecurityCaseVerdict =
  | "True Positive"
  | "Benign Positive"
  | "False Positive"
  | "Undetermined";

export interface SecurityCaseVerdictTerm {
  verdict: SecurityCaseVerdict;
  description: string;
}

export const SECURITY_CASE_VERDICTS: ReadonlyArray<SecurityCaseVerdictTerm> = [
  {
    verdict: "True Positive",
    description: "Malicious or unauthorized activity really happened.",
  },
  {
    verdict: "Benign Positive",
    description:
      "The activity was real but expected, such as a penetration test or an admin task.",
  },
  {
    verdict: "False Positive",
    description:
      "The detection was wrong: the rule or the data misread normal activity.",
  },
  {
    verdict: "Undetermined",
    description: "There was not enough information to tell.",
  },
];

export function isSecurityCaseVerdict(
  value: unknown,
): value is SecurityCaseVerdict {
  return SECURITY_CASE_VERDICTS.some(
    (term: SecurityCaseVerdictTerm): boolean => {
      return term.verdict === value;
    },
  );
}

/*
 * What OneUptime AI made of a case when it triaged it: its read, never the
 * case's verdict, which a person sets. Each read lines up with the verdict a
 * close starts on; Inconclusive suggests none.
 */
export type SecurityCaseAiVerdict =
  | "Likely Malicious"
  | "Likely Benign"
  | "Likely False Positive"
  | "Inconclusive";

export type SecurityCaseAiTone = "danger" | "warning" | "success" | "neutral";

export interface SecurityCaseAiVerdictTerm {
  verdict: SecurityCaseAiVerdict;
  description: string;
  suggestedCloseVerdict?: SecurityCaseVerdict | undefined;
  // The colour family of the verdict it suggests, as the dashboard draws it.
  tone: SecurityCaseAiTone;
}

// In the order a reader weighs them: the worst first.
export const SECURITY_CASE_AI_VERDICTS: ReadonlyArray<SecurityCaseAiVerdictTerm> =
  [
    {
      verdict: "Likely Malicious",
      description: "The evidence points at malicious or unauthorized activity.",
      suggestedCloseVerdict: "True Positive",
      tone: "danger",
    },
    {
      verdict: "Likely Benign",
      description:
        "The activity looks real but expected, such as an admin task or a scan your team runs.",
      suggestedCloseVerdict: "Benign Positive",
      tone: "warning",
    },
    {
      verdict: "Likely False Positive",
      description: "The detection looks like it misread normal activity.",
      suggestedCloseVerdict: "False Positive",
      tone: "success",
    },
    {
      verdict: "Inconclusive",
      description:
        "There was not enough evidence to tell. A person has to look.",
      tone: "neutral",
    },
  ];

export function getAiVerdictTerm(
  value: unknown,
): SecurityCaseAiVerdictTerm | undefined {
  return SECURITY_CASE_AI_VERDICTS.find(
    (term: SecurityCaseAiVerdictTerm): boolean => {
      return term.verdict === value;
    },
  );
}

/*
 * The kinds of things a case is about, as the server types them, each with
 * the icon the app draws it with and the words a reader sees.
 */
export type SecurityEntityType =
  | "User"
  | "Host"
  | "IP Address"
  | "Domain"
  | "URL"
  | "File Hash"
  | "Process"
  | "Data Store"
  | "Other";

export interface SecurityEntityTerm {
  type: SecurityEntityType;
  label: string;
  icon: IconName;
}

export const SECURITY_ENTITY_TERMS: ReadonlyArray<SecurityEntityTerm> = [
  { type: "User", label: "User", icon: "person-outline" },
  { type: "Host", label: "Host", icon: "desktop-outline" },
  { type: "IP Address", label: "IP address", icon: "globe-outline" },
  { type: "Domain", label: "Domain", icon: "at-outline" },
  { type: "URL", label: "URL", icon: "link-outline" },
  { type: "File Hash", label: "File hash", icon: "document-outline" },
  { type: "Process", label: "Process", icon: "terminal-outline" },
  { type: "Data Store", label: "Data store", icon: "server-outline" },
  { type: "Other", label: "Other", icon: "ellipse-outline" },
];

export function getEntityTerm(type: unknown): SecurityEntityTerm {
  return (
    SECURITY_ENTITY_TERMS.find((term: SecurityEntityTerm): boolean => {
      return term.type === type;
    }) || SECURITY_ENTITY_TERMS[SECURITY_ENTITY_TERMS.length - 1]!
  );
}

export interface SecurityEntity {
  type: SecurityEntityType;
  value: string;
}

/*
 * A case's stored entities, read defensively: an entry without a value is
 * dropped, an unknown type reads as Other, and a value that appears twice
 * (whatever its case) is listed once, as the server merges them.
 */
export function readCaseEntities(value: unknown): Array<SecurityEntity> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen: Set<string> = new Set();
  const entities: Array<SecurityEntity> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: Record<string, unknown> = item as Record<string, unknown>;
    const entityValue: string =
      typeof record["value"] === "string" ? record["value"].trim() : "";

    if (!entityValue || seen.has(entityValue.toLowerCase())) {
      continue;
    }

    seen.add(entityValue.toLowerCase());
    entities.push({
      type: getEntityTerm(record["type"]).type,
      value: entityValue,
    });
  }

  return entities;
}

/*
 * What opened the case, as the server names its sources, in the words the
 * phone reads them in. A source this build does not know reads as stored.
 */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "Detection Rule": "Detection rule",
  "Threat Intel": "Threat intel",
  "Connected Product": "Connected product",
  "Entity Risk": "Entity risk",
  "Data Security": "Data security",
  Manual: "A person",
};

export function describeCaseSource(source: unknown): string {
  if (typeof source !== "string" || !source.trim()) {
    return "";
  }

  return SOURCE_LABELS[source] || source;
}

/*
 * How the triage report's own heads-up starts, when the case's data held text
 * written to steer an AI (Common/Utils/AI/InvestigationReport,
 * SECURITY_CASE_TRIAGE_INJECTION_LEAD_PREFIX). The AI section says the same
 * first, as a warning, so the report is drawn without it.
 */
export const TRIAGE_INJECTION_LEAD_PREFIX: string =
  "**Heads up:** some text in this case's data reads like instructions to an AI";

/*
 * The triage report as the phone draws it, under its own "OneUptime AI"
 * heading: without the report's brand heading ("## 🧠 AI — Security Case
 * Triage") and without the runner's heads-up paragraph, which the section
 * shows as a warning instead. Anything the model wrote stays as written.
 */
export function getTriageReportBody(markdown: unknown): string {
  if (typeof markdown !== "string") {
    return "";
  }

  const lines: Array<string> = markdown.split("\n");
  const isFilled: (line: string) => boolean = (line: string): boolean => {
    return line.trim() !== "";
  };

  let index: number = lines.findIndex(isFilled);

  if (index !== -1 && lines[index]!.trim().startsWith("## ")) {
    lines.splice(index, 1);
    index = lines.findIndex(isFilled);
  }

  if (
    index !== -1 &&
    lines[index]!.trim().startsWith(TRIAGE_INJECTION_LEAD_PREFIX)
  ) {
    lines.splice(index, 1);
  }

  return lines.join("\n").trim();
}

/*
 * THE TRIAGE'S SUMMARY, READ BEFORE ANYTHING IS TAPPED.
 *
 * The triage writes its report in sections, as bold headings, Summary first
 * (Common/Server/Utils/AI/Security/SecurityCaseTriagePrompt): "two sentences
 * the analyst can read in five seconds: what happened and what it most
 * likely is". The dashboard lifts that Summary above the rest of the report
 * (InvestigationReportView); the phone shows it at once too, and folds the
 * rest under it.
 *
 * Only a report that opens with its Summary has one to lift: a Summary
 * label on the report's first line - "**Summary**", "**Summary:** text",
 * "**Summary** - text", "## Summary" or "Summary: text" - and then its first
 * paragraph, which ends sooner at any line that could open another section
 * (a heading, a bold label, a rule, a fence, "Evidence: ..."). So what the
 * phone lifts is the start of the Summary Common's report parser reads
 * (parseInvestigationReport), never anything after it, and whatever is not
 * lifted stays in the folded report. Any other shape lifts nothing, and the
 * whole report folds, as written. Common's SecurityCaseMobileParity holds
 * this to the parser. Each line is read by position, in time in line with
 * its length.
 */

// The labels a Summary goes by, lower-cased (Common's KNOWN_LABELS).
const SUMMARY_LABELS: ReadonlySet<string> = new Set([
  "summary",
  "tl;dr",
  "tl; dr",
  "tldr",
]);

// The parser's other known labels: "Evidence: ..." opens a section of its own.
const OTHER_SECTION_LABELS: ReadonlySet<string> = new Set([
  "most likely root cause",
  "likely root cause",
  "probable root cause",
  "root cause",
  "root cause hypothesis",
  "evidence",
  "key evidence",
  "supporting evidence",
  "key findings",
  "findings",
  "suggested next steps",
  "next steps",
  "recommended next steps",
  "recommended actions",
  "recommendations",
  "evidence checked",
]);

const WHITESPACE_RUN: RegExp = /\s+/;

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

/*
 * A label as the parser looks it up: "Summary:", "summary" and "Summary
 * (high confidence)" are all Summary.
 */
function toLabelKey(label: string): string {
  let key: string = label.trim();

  if (key.endsWith(":")) {
    key = key.slice(0, -1).trimEnd();
  }

  const open: number = key.lastIndexOf("(");

  if (
    key.endsWith(")") &&
    open !== -1 &&
    !key.slice(open + 1, -1).includes(")")
  ) {
    key = key.slice(0, open).trimEnd();
  }

  if (key.endsWith(":")) {
    key = key.slice(0, -1);
  }

  return key.split(WHITESPACE_RUN).filter(Boolean).join(" ").toLowerCase();
}

// "- text", ": text", "— text" after a label: the text; null without a separator.
function textAfterSeparator(rest: string): string | null {
  for (const separator of [":", "—", "–", "--", "-"]) {
    if (rest.startsWith(separator)) {
      return rest.slice(separator.length).trim();
    }
  }

  return null;
}

/*
 * The Summary label a report opens with, and any text after it on that
 * line; null for a line that is not one. A bold phrase followed by prose
 * with no separator ("**Summary** is below") is prose, as the parser reads
 * it.
 */
export function readSummaryLabel(line: string): { text: string } | null {
  const content: string = line.trim();

  if (content.startsWith("#")) {
    let level: number = 0;

    while (content[level] === "#") {
      level += 1;
    }

    let heading: string = content.slice(level);

    if (level > 6 || (heading !== "" && !isSpace(heading[0]!))) {
      return null;
    }

    heading = heading.trim();

    // "## Summary ##": an ATX heading may close with hashes of its own.
    let end: number = heading.length;

    while (end > 0 && heading[end - 1] === "#") {
      end -= 1;
    }

    if (end < heading.length && isSpace(heading[end - 1] || "")) {
      heading = heading.slice(0, end);
    }

    return SUMMARY_LABELS.has(toLabelKey(heading)) ? { text: "" } : null;
  }

  const marker: string | undefined = ["***", "___", "**", "__"].find(
    (candidate: string): boolean => {
      return content.startsWith(candidate);
    },
  );

  if (marker) {
    const close: number = content.indexOf(marker, marker.length);

    if (close <= marker.length) {
      return null;
    }

    const inner: string = content.slice(marker.length, close);
    const after: string = content.slice(close + marker.length).trim();

    if (!SUMMARY_LABELS.has(toLabelKey(inner))) {
      return null;
    }

    if (after === "" || after === ":") {
      return { text: "" };
    }

    const separated: string | null = textAfterSeparator(after);

    if (separated !== null) {
      return { text: separated };
    }

    return inner.trimEnd().endsWith(":") ? { text: after } : null;
  }

  const colon: number = content.indexOf(":");
  const plainLabel: string = colon > 0 ? content.slice(0, colon).trim() : "";

  return isPlainLabel(plainLabel) && SUMMARY_LABELS.has(toLabelKey(plainLabel))
    ? { text: content.slice(colon + 1).trim() }
    : null;
}

function isLetter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

/*
 * The words before a plain label's colon, as the parser takes them: a
 * letter first, then letters, spaces and ";,()" - "Summary", "TL;DR" - and
 * no more than 61 characters.
 */
function isPlainLabel(label: string): boolean {
  return (
    label.length > 0 &&
    label.length <= 61 &&
    isLetter(label[0]!) &&
    [...label].every((character: string): boolean => {
      return isLetter(character) || " \t;,()".includes(character);
    })
  );
}

// "---", "***", "_ _ _": a rule, which the report's footer starts with.
function isRule(content: string): boolean {
  const character: string = content[0] || "";
  let count: number = 0;

  if (character !== "-" && character !== "*" && character !== "_") {
    return false;
  }

  for (const next of content) {
    if (next === character) {
      count += 1;
    } else if (!isSpace(next)) {
      return false;
    }
  }

  return count >= 3;
}

/*
 * Whether a line ends the Summary's first paragraph: a blank line, or a
 * line that could open another section or a block of its own.
 */
function endsSummary(line: string): boolean {
  const content: string = line.trim();

  if (
    content === "" ||
    isRule(content) ||
    ["#", "**", "__", "```", "~~~"].some((start: string): boolean => {
      return content.startsWith(start);
    })
  ) {
    return true;
  }

  const colon: number = content.indexOf(":");

  if (colon <= 0) {
    return false;
  }

  const key: string = toLabelKey(content.slice(0, colon));

  return SUMMARY_LABELS.has(key) || OTHER_SECTION_LABELS.has(key);
}

export interface TriageReportParts {
  // The start of the report's Summary, as written, or "" when it has none to lift.
  summary: string;
  // Everything after it, as written: the whole report when nothing was lifted.
  rest: string;
}

export function splitTriageReport(markdown: unknown): TriageReportParts {
  const body: string = getTriageReportBody(markdown);
  const none: TriageReportParts = { summary: "", rest: body };
  const lines: Array<string> = body.split("\n");
  const label: { text: string } | null = readSummaryLabel(lines[0] || "");

  if (!label) {
    return none;
  }

  const summaryLines: Array<string> = label.text ? [label.text] : [];
  let index: number = 1;

  // Blank lines between the label and its text.
  while (
    summaryLines.length === 0 &&
    index < lines.length &&
    !lines[index]!.trim()
  ) {
    index += 1;
  }

  while (index < lines.length && !endsSummary(lines[index]!)) {
    summaryLines.push(lines[index]!);
    index += 1;
  }

  const summary: string = summaryLines.join("\n").trim();

  return summary
    ? { summary, rest: lines.slice(index).join("\n").trim() }
    : none;
}
