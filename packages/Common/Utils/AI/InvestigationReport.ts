/*
 * Pure helpers for reading an AI investigation report.
 *
 * The investigation engine posts one markdown blob: a branded heading, the
 * model's own "Summary / Most likely root cause / Evidence / Suggested next
 * steps" note, a server-authored "Evidence checked" list and a footer
 * (AIInvestigationEngine.buildBrandedMarkdown). The dashboard wants to lay
 * those parts out separately, and the server wants the evidence labels and
 * the incident/alert numbers the note mentions.
 *
 * Everything here is text-only and dependency-free so it loads the same in
 * the dashboard bundle, the API server and Common jest. None of it turns
 * model-authored text into links or HTML: callers get plain strings and
 * numbers, and resolve anything clickable from their own database rows.
 */

export const AI_ROOT_CAUSE_HEADING_TEXT: string =
  "AI — Automated Root Cause Analysis";

export enum InvestigationReportSectionKind {
  Summary = "Summary",
  RootCause = "RootCause",
  Evidence = "Evidence",
  NextSteps = "NextSteps",
  Other = "Other",
}

export interface InvestigationReportSection {
  kind: InvestigationReportSectionKind;
  // The label as written, e.g. "Most likely root cause".
  title: string;
  // Section body, label and its trailing separator removed, trimmed.
  markdown: string;
}

export interface InvestigationEvidenceCheckedEntry {
  // "C1"
  citationId: string;
  label: string;
  /*
   * Rows for a telemetry query. A cluster tool's line carries no rows and
   * reads as the engine counts it: a kubectl command that succeeded is 1,
   * one that returned an error (or never gave a result) is 0, and a
   * cluster listing is the number of clusters it listed.
   */
  rowCount: number;
  /*
   * What a cluster tool's line says in place of a row count, as written:
   * "succeeded", "kubectl returned an error", "2 cluster(s)". Absent for a
   * telemetry query's "N row(s)".
   */
  outcome?: string | undefined;
}

export interface InvestigationReportFooter {
  // Footer text without the surrounding * emphasis markers.
  text: string;
  modelName?: string | undefined;
  // "N queries run across your own telemetry" — telemetry queries only.
  queryCount?: number | undefined;
  /*
   * "M kubectl commands run on your Kubernetes clusters", which the footer
   * of a run that used cluster tools states (0 for "no telemetry queries or
   * kubectl commands run"). Absent when the footer does not say.
   */
  kubectlCommandCount?: number | undefined;
}

export interface ParsedInvestigationReport {
  /*
   * True when a Summary or a Most likely root cause section with a body was
   * recognised — i.e. the report is worth laying out section by section.
   */
  isStructured: boolean;
  /*
   * Markdown before the first recognised section, brand heading removed,
   * trimmed ("" when there is none). With no recognised section at all this
   * is the whole body.
   */
  preamble: string;
  /*
   * Recognised sections with a non-empty body, in document order. The
   * Evidence checked block and the footer are NOT included.
   */
  sections: Array<InvestigationReportSection>;
  // Convenience: the first section body of each kind, or undefined.
  summary?: string | undefined;
  rootCause?: string | undefined;
  evidence?: string | undefined;
  nextSteps?: string | undefined;
  /*
   * The server-authored "Evidence checked" list: the LAST such block, unless
   * the footer's query count shows the server could not have written it.
   */
  evidenceChecked: Array<InvestigationEvidenceCheckedEntry>;
  footer?: InvestigationReportFooter | undefined;
  /*
   * The whole report with the brand heading, the Evidence checked block and
   * the footer removed.
   */
  bodyMarkdown: string;
}

export interface InvestigationEventReferenceToken {
  // null = no qualifier word; the caller applies a default.
  kind: "incident" | "alert" | null;
  number: number;
  // Index of "#" in the input.
  start: number;
  // Index after the last digit.
  end: number;
}

export interface ExtractedInvestigationEventReference {
  kind: "incident" | "alert";
  number: number;
}

export const DEFAULT_EVENT_REFERENCE_LIMIT: number = 25;

/*
 * Citation marker "[C12]". A fresh RegExp per call because the global flag
 * makes a shared instance stateful (lastIndex) across callers.
 */
export function getCitationMarkerRegex(): RegExp {
  return /\[(C\d{1,3})\]/g;
}

// "EvidenceChecked" is internal: it is parsed into entries, never a section.
type LabelKind = InvestigationReportSectionKind | "EvidenceChecked";

/*
 * Known labels, keyed by their normalised (lower-cased, whitespace-collapsed)
 * text. A Map rather than an object literal so a heading such as
 * "constructor" can never resolve to an Object.prototype member.
 */
const KNOWN_LABELS: Map<string, LabelKind> = new Map<string, LabelKind>([
  ["summary", InvestigationReportSectionKind.Summary],
  ["tl;dr", InvestigationReportSectionKind.Summary],
  ["tl; dr", InvestigationReportSectionKind.Summary],
  ["tldr", InvestigationReportSectionKind.Summary],
  ["most likely root cause", InvestigationReportSectionKind.RootCause],
  ["likely root cause", InvestigationReportSectionKind.RootCause],
  ["probable root cause", InvestigationReportSectionKind.RootCause],
  ["root cause", InvestigationReportSectionKind.RootCause],
  ["root cause hypothesis", InvestigationReportSectionKind.RootCause],
  ["evidence", InvestigationReportSectionKind.Evidence],
  ["key evidence", InvestigationReportSectionKind.Evidence],
  ["supporting evidence", InvestigationReportSectionKind.Evidence],
  ["key findings", InvestigationReportSectionKind.Evidence],
  ["findings", InvestigationReportSectionKind.Evidence],
  ["suggested next steps", InvestigationReportSectionKind.NextSteps],
  ["next steps", InvestigationReportSectionKind.NextSteps],
  ["recommended next steps", InvestigationReportSectionKind.NextSteps],
  ["recommended actions", InvestigationReportSectionKind.NextSteps],
  ["recommendations", InvestigationReportSectionKind.NextSteps],
  ["evidence checked", "EvidenceChecked"],
]);

const BRAND_HEADING_MARKER: string = "automated root cause analysis";
const FOOTER_PREFIX: string = "Investigated automatically by OneUptime AI";

const LINE_ENDING_REGEX: RegExp = /\r\n?/g;
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;
const BLANK_LINE_SPLIT_REGEX: RegExp = /\n[ \t]*\n/;

// Fences may sit inside list items, so any indentation opens one.
const FENCE_OPEN_REGEX: RegExp = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_REGEX: RegExp = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

// Four spaces or a tab is an indented code block, never a section label.
const INDENTED_CODE_REGEX: RegExp = /^(?: {4}|\t)/;
const ATX_HEADING_REGEX: RegExp = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/;
const THEMATIC_BREAK_REGEX: RegExp =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

const LEADING_PARENTHETICAL_REGEX: RegExp = /^[ \t]*(\([^()]{1,80}\))/;
/*
 * Longest text worth looking up as a label: the longest known label plus a
 * decorative prefix, a colon and a "(medium confidence)" style qualifier.
 */
const MAX_KNOWN_LABEL_INPUT_LENGTH: number = 160;
const LEADING_NUMBERING_REGEX: RegExp = /^\d{1,2}[.)][ \t]+/;
const ENDS_WITH_SENTENCE_PUNCTUATION_REGEX: RegExp = /[.!?]$/;
// A label needs some text beyond emphasis markers and punctuation ("**_**").
const HAS_LABEL_TEXT_REGEX: RegExp = /[^\s*_~`#:.—–-]/;
const CITATION_MARKER_TEST_REGEX: RegExp = /\[C\d{1,3}\]/;

/*
 * "**Label** rest" / "__Label__ rest". The optional second group lets
 * "***Label***" (bold italic) unwrap cleanly instead of leaving a stray "*".
 */
const STRONG_LEAD_REGEX: RegExp = /^(\*\*|__)(\*|_)?(.+?)\2?\1(.*)$/;
const SEPARATOR_PREFIX_REGEX: RegExp = /^(?:[:—–]|-{1,2})[ \t]*/;
// The text before the first ":" of a plain "Summary: body" line.
const PLAIN_LABEL_REGEX: RegExp = /^[A-Za-z][A-Za-z \t;,()]{0,60}$/;

// Bold-only lines longer than this read as emphasised prose, not a label.
const MAX_BOLD_LABEL_LENGTH: number = 80;

// Bold and plain labels rank below every ATX heading level (1-6).
const BOLD_LABEL_RANK: number = 7;

const LIST_ITEM_REGEX: RegExp = /^[ \t]*(?:[-*+]|\d{1,3}[.)])(?:[ \t]+|$)/;
const LIST_CONTINUATION_REGEX: RegExp = /^[ \t]{2,}\S/;
const LEADING_WHITESPACE_REGEX: RegExp = /^[ \t]/;
/*
 * "- **[C1]** label — 7 row(s)", or a cluster tool's line, which says what
 * the call did instead of counting rows: "— succeeded", "— kubectl returned
 * an error", "— 2 cluster(s)" (and "— never ran" / "— result unknown" for a
 * kubectl command that gave no result). The label is greedy so a label
 * that itself contains " — " keeps everything up to the LAST " — <outcome>".
 */
const EVIDENCE_CHECKED_ENTRY_REGEX: RegExp =
  /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+(?:\*\*|__)?\[(C\d{1,3})\](?:\*\*|__)?(.+)[ \t][—–-][ \t]+(\d+[ \t]+(?:rows?|clusters?)(?:\(s\))?|succeeded|kubectl[ \t]+returned[ \t]+an[ \t]+error|never[ \t]+ran|did[ \t]+not[ \t]+run|(?:kubectl[ \t]+)?result[ \t]+unknown|unknown)[ \t]*$/i;
// The entry regex backtracks over the label; never feed it a runaway line.
const MAX_EVIDENCE_CHECKED_LINE_LENGTH: number = 2000;

// How one entry's outcome (group 3 of the entry regex) reads.
const EVIDENCE_ROWS_OUTCOME_REGEX: RegExp = /^(\d+)[ \t]+rows?(?:\(s\))?$/i;
const EVIDENCE_CLUSTERS_OUTCOME_REGEX: RegExp =
  /^(\d+)[ \t]+clusters?(?:\(s\))?$/i;
const EVIDENCE_KUBECTL_SUCCEEDED_REGEX: RegExp = /^succeeded$/i;

const FOOTER_EMPHASIS_REGEX: RegExp = /^(\*\*|__|\*|_)([\s\S]+)\1$/;
const FOOTER_USING_REGEX: RegExp = /\busing[ \t]+/;
const FOOTER_QUERIES_RUN_REGEX: RegExp = /\bquer(?:y|ies)[ \t]+run\b/i;
// "... and 2 kubectl commands run on your Kubernetes clusters" -> 2.
const FOOTER_KUBECTL_COMMANDS_RUN_REGEX: RegExp =
  /\b(\d{1,9})[ \t]+kubectl[ \t]+commands?[ \t]+run\b/i;
// A run that used cluster tools but cited no query and no kubectl command.
const FOOTER_NOTHING_RUN_REGEX: RegExp =
  /\bno[ \t]+telemetry[ \t]+queries[ \t]+or[ \t]+kubectl[ \t]+commands[ \t]+run\b/i;
const DIGIT_REGEX: RegExp = /\d/;

const EVENT_REFERENCE_PATTERN: string = "#(\\d{1,9})(?!\\w)";
const WORD_CHARACTER_REGEX: RegExp = /\w/;
const WHITESPACE_CHARACTER_REGEX: RegExp = /\s/;
const FORBIDDEN_BEFORE_REFERENCE: string = "&/#";
/*
 * Punctuation that may sit between a qualifier word and its "#": "incidents:
 * #1", "alerts (#2", "alert [#3]" and, where the raw markdown is scanned,
 * "**Alerts** #4". Bounded so a stray word far back is never read.
 */
const QUALIFIER_GAP_PUNCTUATION: string = ":([*_";
const MAX_QUALIFIER_GAP_PUNCTUATION: number = 4;
/*
 * Words that put a "#N" in some other numbering: a scheduled maintenance
 * event, an episode, a pull request, a build, a list position. The number is
 * not an incident or an alert, so it must not fall back to the subject's
 * kind and link to whichever record happens to share it.
 */
const NON_EVENT_QUALIFIER_WORDS: Set<string> = new Set<string>([
  "maintenance",
  "maintenances",
  "episode",
  "episodes",
  "pr",
  "prs",
  "mr",
  "mrs",
  "pull",
  "request",
  "requests",
  "issue",
  "issues",
  "ticket",
  "tickets",
  "bug",
  "bugs",
  "commit",
  "commits",
  "build",
  "builds",
  "deploy",
  "deploys",
  "deployment",
  "deployments",
  "release",
  "releases",
  "version",
  "versions",
  "run",
  "runs",
  "job",
  "jobs",
  "pipeline",
  "pipelines",
  "step",
  "steps",
  "attempt",
  "attempts",
  "retry",
  "retries",
  "item",
  "items",
  "line",
  "lines",
  "row",
  "rows",
  "port",
  "ports",
  "pod",
  "pods",
  "replica",
  "replicas",
  "node",
  "nodes",
  "shard",
  "shards",
  "worker",
  "workers",
  "instance",
  "instances",
  "page",
  "pages",
  "phase",
  "phases",
  "stage",
  "stages",
  "option",
  "options",
  "rank",
  "priority",
  "no",
  "number",
  "monitor",
  "monitors",
]);
// Longer than any qualifier or non-event word: never worth lower-casing.
const MAX_QUALIFIER_WORD_LENGTH: number = 16;
const SIBLING_SEPARATOR_REGEX: RegExp =
  /^(?:[ \t\n]*,[ \t\n]*(?:(?:and|or)[ \t\n]+)?|[ \t\n]+(?:and|or)[ \t\n]+)$/i;
// ", and " with generous whitespace; a longer gap is never a list separator.
const MAX_SIBLING_SEPARATOR_LENGTH: number = 16;

/*
 * Stands in for an inline code span while scanning for references: not
 * whitespace (so a qualifier cannot reach across it), not a word character
 * and not one of the characters that block a reference.
 */
const CODE_SPAN_PLACEHOLDER: string = String.fromCharCode(0xfffc);

interface LabelLineMatch {
  // null: not a known label (it may still open an "Other" section).
  kind: LabelKind | null;
  title: string;
  inlineBody: string;
  /*
   * A heading, or a bold-only line that reads like a label. Only these may
   * open an "Other" section or an Evidence checked block.
   */
  isBare: boolean;
  // The ATX heading level (1-6); 0 or undefined for a bold or plain label.
  headingLevel?: number | undefined;
}

interface SectionStart {
  index: number;
  kind: InvestigationReportSectionKind;
  title: string;
  inlineBody: string;
  headingLevel: number;
  /*
   * Set when the section's label turned out to be a group heading: it had no
   * body of its own and was directly followed by another label. The depth
   * rank of that first sub-label (see getLabelRank); later labels at that
   * rank or deeper stay inside the section too.
   */
  subLabelRank?: number | undefined;
}

interface SectionCandidate {
  index: number;
  match: LabelLineMatch;
}

interface FooterMatch {
  breakIndex: number;
  footer: InvestigationReportFooter;
}

function normaliseLineEndings(markdown: string): string {
  if (typeof markdown !== "string") {
    return "";
  }

  return markdown.replace(LINE_ENDING_REGEX, "\n");
}

/*
 * Marks every line that belongs to a fenced code block, fence lines
 * included. Nothing inside a fence may start a section, a footer or an
 * evidence block. An unclosed fence runs to the end of the document, as it
 * does when the markdown is rendered.
 */
function markFencedLines(lines: Array<string>): Array<boolean> {
  const fenced: Array<boolean> = [];
  let openFence: string | null = null;

  for (const line of lines) {
    if (openFence === null) {
      const open: RegExpExecArray | null = FENCE_OPEN_REGEX.exec(line);
      const marker: string = open?.[1] || "";
      const info: string = open?.[2] || "";

      // A backtick fence's info string cannot contain a backtick ("```a```" is inline code).
      if (marker && !(marker.charAt(0) === "`" && info.includes("`"))) {
        openFence = marker;
        fenced.push(true);
        continue;
      }

      fenced.push(false);
      continue;
    }

    fenced.push(true);

    const close: RegExpExecArray | null = FENCE_CLOSE_REGEX.exec(line);
    const closeMarker: string = close?.[1] || "";

    if (
      closeMarker &&
      closeMarker.charAt(0) === openFence.charAt(0) &&
      closeMarker.length >= openFence.length
    ) {
      openFence = null;
    }
  }

  return fenced;
}

// Emoji and pictographic symbols a model likes to put in front of a heading.
function isDecorativeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2000 && codePoint <= 0x2bff) ||
    codePoint >= 0x1f000 ||
    codePoint === 0xfe0f ||
    codePoint === 0x200d
  );
}

function stripLeadingDecoration(label: string): string {
  let cursor: number = 0;

  while (cursor < label.length) {
    const codePoint: number = label.codePointAt(cursor) || 0;
    const character: string = String.fromCodePoint(codePoint);

    if (
      !WHITESPACE_CHARACTER_REGEX.test(character) &&
      !isDecorativeCodePoint(codePoint)
    ) {
      break;
    }

    cursor += character.length;
  }

  return label.slice(cursor).replace(LEADING_NUMBERING_REGEX, "");
}

/*
 * The trailing-edge helpers below are plain string scans on purpose. The
 * obvious regexes (/[ \t]*:[ \t]*$/, /(?:^|[ \t]+)#+[ \t]*$/ ...) backtrack
 * quadratically over a long run of spaces, and this text is model-authored:
 * one 20 KB line froze the parser for a minute when they were regexes.
 */
function endsWithColon(value: string): boolean {
  return value.trimEnd().endsWith(":");
}

function stripTrailingColon(value: string): string {
  const trimmed: string = value.trimEnd();

  return trimmed.endsWith(":") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

// "Most likely root cause (medium confidence)" -> "Most likely root cause".
function stripTrailingParenthetical(value: string): string {
  const trimmed: string = value.trimEnd();

  if (!trimmed.endsWith(")")) {
    return trimmed;
  }

  const open: number = trimmed.lastIndexOf("(");

  if (open === -1 || trimmed.slice(open + 1, -1).includes(")")) {
    return trimmed;
  }

  return trimmed.slice(0, open).trimEnd();
}

// "## Summary ##" -> "Summary"; "## C#" keeps its hash.
function stripAtxClosingSequence(value: string): string {
  const trimmed: string = value.trimEnd();
  let end: number = trimmed.length;

  while (end > 0 && trimmed.charAt(end - 1) === "#") {
    end--;
  }

  if (end === trimmed.length) {
    return trimmed;
  }

  if (end === 0) {
    return "";
  }

  const before: string = trimmed.charAt(end - 1);

  return before === " " || before === "\t"
    ? trimmed.slice(0, end).trimEnd()
    : trimmed;
}

/*
 * Splits "Summary — body" / "Summary – body" / "Summary - body" at the first
 * dash separator. A hyphen only separates with whitespace on both sides, so
 * "on-call" never splits.
 */
function splitAtFirstDash(
  value: string,
): { label: string; rest: string } | null {
  for (let index: number = 0; index < value.length; index++) {
    const character: string = value.charAt(index);

    if (character === "—" || character === "–") {
      return { label: value.slice(0, index), rest: value.slice(index + 1) };
    }

    if (character !== "-" || index === 0) {
      continue;
    }

    const previous: string = value.charAt(index - 1);
    let after: number = index + 1;

    if (value.charAt(after) === "-") {
      after++;
    }

    const next: string = value.charAt(after);

    if (
      (previous === " " || previous === "\t") &&
      (next === " " || next === "\t")
    ) {
      return { label: value.slice(0, index), rest: value.slice(after) };
    }
  }

  return null;
}

/*
 * Removes wrapping emphasis and a trailing colon, inside or outside the
 * emphasis: "**Summary:**", "**Summary**:", "__Summary__", "***Summary***".
 */
function cleanLabel(raw: string): string {
  let label: string = stripTrailingColon(raw.trim());

  for (const delimiter of ["**", "__", "*", "_"]) {
    const isWrapped: boolean =
      label.length > delimiter.length * 2 &&
      label.startsWith(delimiter) &&
      label.endsWith(delimiter) &&
      !label
        .slice(delimiter.length, label.length - delimiter.length)
        .includes(delimiter);

    if (isWrapped) {
      label = stripTrailingColon(
        label.slice(delimiter.length, label.length - delimiter.length).trim(),
      );
    }
  }

  return label;
}

function tidyTitle(label: string): string {
  const collapsed: string = label.replace(WHITESPACE_RUN_REGEX, " ").trim();
  const stripped: string = stripLeadingDecoration(collapsed).trim();

  return stripped || collapsed;
}

function lookupLabel(label: string): LabelKind | null {
  // Every known label is short; anything longer is prose.
  if (label.length > MAX_KNOWN_LABEL_INPUT_LENGTH) {
    return null;
  }

  const key: string = stripTrailingColon(
    stripTrailingParenthetical(stripLeadingDecoration(label)),
  )
    .replace(WHITESPACE_RUN_REGEX, " ")
    .trim()
    .toLowerCase();

  return KNOWN_LABELS.get(key) || null;
}

function looksLikeBoldLabel(title: string): boolean {
  return (
    HAS_LABEL_TEXT_REGEX.test(title) &&
    title.length <= MAX_BOLD_LABEL_LENGTH &&
    !ENDS_WITH_SENTENCE_PUNCTUATION_REGEX.test(title) &&
    !CITATION_MARKER_TEST_REGEX.test(title)
  );
}

/*
 * "**Label**", "**Label:**", "**Label** — body", "**Label:** body",
 * "**Label** (medium confidence) — body". A bold phrase followed by prose
 * with no separator ("**Root cause** is unclear") is not a label line.
 */
function matchStrongLead(content: string): LabelLineMatch | null {
  const lead: RegExpExecArray | null = STRONG_LEAD_REGEX.exec(content);

  if (!lead) {
    return null;
  }

  const inner: string = lead[3] || "";
  let rest: string = lead[4] || "";
  const label: string = cleanLabel(inner);

  if (!label) {
    return null;
  }

  const innerEndsWithColon: boolean = endsWithColon(inner);
  let qualifier: string = "";
  const parenthetical: RegExpExecArray | null =
    LEADING_PARENTHETICAL_REGEX.exec(rest);

  if (parenthetical) {
    qualifier = parenthetical[1] || "";
    rest = rest.slice(parenthetical[0].length);
  }

  const restTrimmed: string = rest.trim();
  let inlineBody: string = "";
  let isBare: boolean = false;

  if (restTrimmed === "" || restTrimmed === ":") {
    isBare = qualifier === "";
  } else {
    const separator: RegExpExecArray | null =
      SEPARATOR_PREFIX_REGEX.exec(restTrimmed);

    if (separator) {
      inlineBody = restTrimmed.slice(separator[0].length).trim();
    } else if (innerEndsWithColon) {
      // "**Root cause:** body" and "**Root cause:** (medium confidence) body".
      inlineBody = restTrimmed;
    } else {
      return null;
    }
  }

  const title: string = tidyTitle(qualifier ? `${label} ${qualifier}` : label);
  const kind: LabelKind | null = lookupLabel(label);

  isBare = isBare && looksLikeBoldLabel(title);

  if (kind === null && !isBare) {
    return null;
  }

  return { kind, title, inlineBody, isBare };
}

// "Summary: body" — only for known labels.
function matchPlainLabel(content: string): LabelLineMatch | null {
  const colon: number = content.indexOf(":");

  if (colon <= 0) {
    return null;
  }

  const label: string = content.slice(0, colon).trim();

  if (!PLAIN_LABEL_REGEX.test(label)) {
    return null;
  }

  const kind: LabelKind | null = lookupLabel(label);

  if (kind === null) {
    return null;
  }

  const inlineBody: string = content.slice(colon + 1).trim();

  return {
    kind,
    title: tidyTitle(label),
    inlineBody,
    isBare: inlineBody === "",
  };
}

function matchHeading(headingText: string): LabelLineMatch | null {
  const text: string = stripAtxClosingSequence(headingText).trim();

  if (!text) {
    return null;
  }

  const full: string = cleanLabel(text);
  const fullKind: LabelKind | null = lookupLabel(full);

  if (fullKind !== null) {
    return {
      kind: fullKind,
      title: tidyTitle(full),
      inlineBody: "",
      isBare: true,
    };
  }

  // "## Summary: body", "## **Summary** — body", "## Summary — body".
  const lead: LabelLineMatch | null =
    text.startsWith("**") || text.startsWith("__")
      ? matchStrongLead(text)
      : matchPlainLabel(text);

  if (lead && lead.kind !== null) {
    return { ...lead, isBare: lead.inlineBody === "" };
  }

  const dash: { label: string; rest: string } | null = splitAtFirstDash(text);

  if (dash) {
    const dashLabel: string = cleanLabel(dash.label);
    const dashKind: LabelKind | null = lookupLabel(dashLabel);
    const dashBody: string = dash.rest.trim();

    if (dashKind !== null) {
      return {
        kind: dashKind,
        title: tidyTitle(dashLabel),
        inlineBody: dashBody,
        isBare: dashBody === "",
      };
    }
  }

  // Any other heading may open an "Other" section, titled as written.
  return {
    kind: null,
    title: tidyTitle(full || text),
    inlineBody: "",
    isBare: true,
  };
}

// "### Evidence" -> 3. Only called on a line ATX_HEADING_REGEX accepted.
function countLeadingHashes(line: string): number {
  const content: string = line.trimStart();
  let level: number = 0;

  while (level < content.length && content.charAt(level) === "#") {
    level++;
  }

  return level;
}

/*
 * How deep a label sits in the outline: its heading level, with bold and
 * plain labels below every heading.
 */
function getLabelRank(match: LabelLineMatch): number {
  return match.headingLevel || BOLD_LABEL_RANK;
}

function matchSectionStart(line: string): LabelLineMatch | null {
  // "*****" is a thematic break, not an empty bold label.
  if (INDENTED_CODE_REGEX.test(line) || THEMATIC_BREAK_REGEX.test(line)) {
    return null;
  }

  const heading: RegExpExecArray | null = ATX_HEADING_REGEX.exec(line);

  if (heading) {
    const headingMatch: LabelLineMatch | null = matchHeading(heading[1] || "");

    return headingMatch
      ? { ...headingMatch, headingLevel: countLeadingHashes(line) }
      : null;
  }

  const content: string = line.trim();

  if (!content) {
    return null;
  }

  if (content.startsWith("**") || content.startsWith("__")) {
    return matchStrongLead(content);
  }

  return matchPlainLabel(content);
}

function isBrandHeading(line: string): boolean {
  const heading: RegExpExecArray | null = ATX_HEADING_REGEX.exec(line);

  return Boolean(
    heading && (heading[1] || "").toLowerCase().includes(BRAND_HEADING_MARKER),
  );
}

/*
 * The footer is the LAST thematic break (outside code) followed by nothing
 * but one emphasis paragraph starting with the OneUptime AI footer text.
 */
function findFooter(
  lines: Array<string>,
  fenced: Array<boolean>,
): FooterMatch | null {
  let breakIndex: number = -1;

  for (let index: number = lines.length - 1; index >= 0; index--) {
    if (!fenced[index] && THEMATIC_BREAK_REGEX.test(lines[index] || "")) {
      breakIndex = index;
      break;
    }
  }

  if (breakIndex < 0) {
    return null;
  }

  const trailing: string = lines
    .slice(breakIndex + 1)
    .join("\n")
    .trim();

  if (!trailing || BLANK_LINE_SPLIT_REGEX.test(trailing)) {
    return null;
  }

  const paragraph: string = trailing
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .join(" ");

  const emphasis: RegExpExecArray | null =
    FOOTER_EMPHASIS_REGEX.exec(paragraph);
  const text: string = (emphasis?.[2] || "").trim();

  if (!text.startsWith(FOOTER_PREFIX)) {
    return null;
  }

  const footer: InvestigationReportFooter = { text };

  const modelName: string | undefined = readFooterModelName(text);

  if (modelName) {
    footer.modelName = modelName;
  }

  const nothingRun: boolean = FOOTER_NOTHING_RUN_REGEX.test(text);

  const queryCount: number | undefined = nothingRun
    ? 0
    : readFooterQueryCount(text);

  if (queryCount !== undefined) {
    footer.queryCount = queryCount;
  }

  const kubectlCommandCount: number | undefined = nothingRun
    ? 0
    : readFooterKubectlCommandCount(text);

  if (kubectlCommandCount !== undefined) {
    footer.kubectlCommandCount = kubectlCommandCount;
  }

  return { breakIndex, footer };
}

// "... and 2 kubectl commands run on ..." / "1 kubectl command run" -> 2 / 1.
function readFooterKubectlCommandCount(text: string): number | undefined {
  const commands: RegExpExecArray | null =
    FOOTER_KUBECTL_COMMANDS_RUN_REGEX.exec(text);

  return commands ? parseInt(commands[1] || "0", 10) : undefined;
}

/*
 * "... telemetry using gpt-4.1-mini. This is ..." -> "gpt-4.1-mini". The
 * name ends at the first "." followed by whitespace or the end, so dots
 * inside a model name survive. A scan rather than a lazy regex, which
 * rescans the rest of the text for every "using".
 */
function readFooterModelName(text: string): string | undefined {
  const using: RegExpExecArray | null = FOOTER_USING_REGEX.exec(text);

  if (!using) {
    return undefined;
  }

  const start: number = using.index + using[0].length;

  for (let index: number = start; index < text.length; index++) {
    if (
      text.charAt(index) === "." &&
      (index + 1 === text.length ||
        WHITESPACE_CHARACTER_REGEX.test(text.charAt(index + 1)))
    ) {
      return text.slice(start, index).trim() || undefined;
    }
  }

  return undefined;
}

// "... 7 queries run ..." / "... 1 query run ..." -> 7 / 1.
function readFooterQueryCount(text: string): number | undefined {
  const queries: RegExpExecArray | null = FOOTER_QUERIES_RUN_REGEX.exec(text);

  if (!queries) {
    return undefined;
  }

  let cursor: number = queries.index - 1;
  const spaceEnd: number = cursor;

  while (
    cursor >= 0 &&
    (text.charAt(cursor) === " " || text.charAt(cursor) === "\t")
  ) {
    cursor--;
  }

  if (cursor === spaceEnd) {
    return undefined;
  }

  const digitsEnd: number = cursor + 1;

  while (cursor >= 0 && DIGIT_REGEX.test(text.charAt(cursor))) {
    cursor--;
  }

  const digits: string = text.slice(cursor + 1, digitsEnd);

  // The engine's tool-call budget is tiny; a huge number is not a count.
  if (!digits || digits.length > 9) {
    return undefined;
  }

  return parseInt(digits, 10);
}

/*
 * The lines an "Evidence checked" block owns: its label line, then list
 * items (with their indented continuations) and the blank lines between
 * them. The first other line ends the block, so prose that follows it is
 * never swallowed.
 */
function findEvidenceCheckedBlockEnd(
  lines: Array<string>,
  fenced: Array<boolean>,
  labelIndex: number,
  contentEnd: number,
): number {
  let end: number = labelIndex + 1;
  let cursor: number = labelIndex + 1;
  let insideList: boolean = false;

  while (cursor < contentEnd) {
    const line: string = lines[cursor] || "";

    if (fenced[cursor]) {
      break;
    }

    if (!line.trim()) {
      cursor++;
      continue;
    }

    if (LIST_ITEM_REGEX.test(line)) {
      insideList = true;
    } else if (!(insideList && LIST_CONTINUATION_REGEX.test(line))) {
      break;
    }

    cursor++;
    end = cursor;
  }

  return end;
}

/*
 * What kind of tool call an Evidence checked line is about, which decides
 * which count of the footer it must fit in: a telemetry query ("N row(s)"),
 * a kubectl command, or a cluster listing (which the footer never counts).
 */
type EvidenceCheckedEntryKind = "query" | "kubectl" | "clusters";

interface ParsedEvidenceCheckedEntry {
  entry: InvestigationEvidenceCheckedEntry;
  kind: EvidenceCheckedEntryKind;
}

function readEvidenceCheckedOutcome(outcomeText: string): {
  kind: EvidenceCheckedEntryKind;
  rowCount: number;
  outcome?: string | undefined;
} {
  const outcome: string = outcomeText.trim().replace(WHITESPACE_RUN_REGEX, " ");

  const rows: RegExpExecArray | null =
    EVIDENCE_ROWS_OUTCOME_REGEX.exec(outcome);

  if (rows) {
    return { kind: "query", rowCount: parseInt(rows[1] || "0", 10) };
  }

  const clusters: RegExpExecArray | null =
    EVIDENCE_CLUSTERS_OUTCOME_REGEX.exec(outcome);

  if (clusters) {
    return {
      kind: "clusters",
      rowCount: parseInt(clusters[1] || "0", 10),
      outcome,
    };
  }

  /*
   * The engine counts a kubectl command that succeeded as 1 and one that
   * returned an error as 0; a command with no result has nothing to count.
   */
  return {
    kind: "kubectl",
    rowCount: EVIDENCE_KUBECTL_SUCCEEDED_REGEX.test(outcome) ? 1 : 0,
    outcome,
  };
}

function parseEvidenceCheckedEntries(
  lines: Array<string>,
): Array<ParsedEvidenceCheckedEntry> {
  const entries: Array<ParsedEvidenceCheckedEntry> = [];
  const seen: Set<string> = new Set<string>();

  for (const line of lines) {
    if (line.length > MAX_EVIDENCE_CHECKED_LINE_LENGTH) {
      continue;
    }

    const match: RegExpExecArray | null =
      EVIDENCE_CHECKED_ENTRY_REGEX.exec(line);

    if (!match) {
      continue;
    }

    const citationId: string = (match[1] || "").toUpperCase();
    const label: string = (match[2] || "").trim();

    if (!citationId || !label || seen.has(citationId)) {
      continue;
    }

    const read: {
      kind: EvidenceCheckedEntryKind;
      rowCount: number;
      outcome?: string | undefined;
    } = readEvidenceCheckedOutcome(match[3] || "");

    const entry: InvestigationEvidenceCheckedEntry = {
      citationId,
      label,
      rowCount: read.rowCount,
    };

    if (read.outcome !== undefined) {
      entry.outcome = read.outcome;
    }

    seen.add(citationId);
    entries.push({ entry, kind: read.kind });
  }

  return entries;
}

/*
 * Whether an "Evidence checked" block can be the server's, going by the
 * footer's counts. The server writes one entry per citation, at most one
 * citation per call, and no block at all when nothing was cited. So a
 * block with more query lines than the footer's telemetry queries, or more
 * kubectl lines than its kubectl commands, was written by the model. A
 * cluster listing is cited but never counted in the footer, so its lines
 * fit any footer that counts something — or the cluster-tool footer that
 * says nothing else ran ("no telemetry queries or kubectl commands run"),
 * the one run whose only citations are listings. A footer saying "0
 * queries run" never goes with a block. Without a readable count (no
 * footer, an older format) the block is trusted.
 */
function isServerEvidenceCheckedBlock(
  entries: Array<ParsedEvidenceCheckedEntry>,
  footer: InvestigationReportFooter | undefined,
): boolean {
  const queryCount: number | undefined = footer?.queryCount;
  const kubectlCommandCount: number | undefined = footer?.kubectlCommandCount;

  if (queryCount === undefined && kubectlCommandCount === undefined) {
    return true;
  }

  let queryLines: number = 0;
  let kubectlLines: number = 0;
  let clusterLines: number = 0;

  for (const parsed of entries) {
    if (parsed.kind === "query") {
      queryLines++;
    } else if (parsed.kind === "kubectl") {
      kubectlLines++;
    } else {
      clusterLines++;
    }
  }

  if (queryLines > (queryCount ?? 0)) {
    return false;
  }

  if (kubectlLines > (kubectlCommandCount ?? 0)) {
    return false;
  }

  if ((queryCount ?? 0) + (kubectlCommandCount ?? 0) > 0) {
    return true;
  }

  return kubectlCommandCount !== undefined && clusterLines > 0;
}

function createEmptyReport(): ParsedInvestigationReport {
  return {
    isStructured: false,
    preamble: "",
    sections: [],
    summary: undefined,
    rootCause: undefined,
    evidence: undefined,
    nextSteps: undefined,
    evidenceChecked: [],
    footer: undefined,
    bodyMarkdown: "",
  };
}

/*
 * Joins the kept lines of [from, to). Untrimmed on purpose: a section body
 * is appended to its inline first line, and the blank line between them is
 * what keeps them separate paragraphs.
 */
function joinKeptLines(
  lines: Array<string>,
  kept: Array<boolean>,
  from: number,
  to: number,
): string {
  const output: Array<string> = [];
  let lastWasRemoved: boolean = false;

  for (let index: number = from; index < to; index++) {
    if (!kept[index]) {
      lastWasRemoved = true;
      continue;
    }

    const line: string = lines[index] || "";
    const previous: string | undefined = output[output.length - 1];

    /*
     * Keep a blank line where a block was cut out, so the text on either
     * side cannot merge into one paragraph.
     */
    if (
      lastWasRemoved &&
      line.trim() !== "" &&
      (previous === undefined || previous.trim() !== "")
    ) {
      output.push("");
    }

    lastWasRemoved = false;
    output.push(line);
  }

  return output.join("\n");
}

/*
 * Every kept line outside code that reads like a section label, in order.
 * An indented line inside a list continues a list item ("1. Roll back", then
 * "   Evidence: pool at 100%"), so it never starts a section: that would cut
 * the list in two and could hand the rest of it to another section kind.
 */
function findSectionCandidates(
  lines: Array<string>,
  fenced: Array<boolean>,
  kept: Array<boolean>,
  contentEnd: number,
): Array<SectionCandidate> {
  const candidates: Array<SectionCandidate> = [];
  let insideList: boolean = false;

  for (let index: number = 0; index < contentEnd; index++) {
    const line: string = lines[index] || "";

    // Blank lines keep the list context: a list item may span paragraphs.
    if (!kept[index] || fenced[index] || !line.trim()) {
      continue;
    }

    const isIndented: boolean = LEADING_WHITESPACE_REGEX.test(line);

    if (THEMATIC_BREAK_REGEX.test(line)) {
      insideList = false;
    } else if (LIST_ITEM_REGEX.test(line)) {
      insideList = true;
    } else if (!isIndented) {
      insideList = false;
    } else if (insideList) {
      continue;
    }

    const match: LabelLineMatch | null = matchSectionStart(line);

    if (match) {
      candidates.push({ index, match });
    }
  }

  return candidates;
}

/*
 * Turns label candidates into the section starts the report is cut at.
 *
 * Recognised labels always start a section (one with no body is dropped
 * later, as before). Unknown headings and bold-only labels, including a
 * model-authored "Evidence checked", start an "Other" section only once the
 * structured part of the note has begun, and only when they are not part of
 * the section already open:
 *
 *   - a heading deeper than the recognised heading that opened the section
 *     ("## Evidence" then "### Metrics") belongs to it;
 *   - a label directly under a label with no body of its own makes that
 *     label a group heading ("## Most likely root cause" then "### Pool
 *     exhaustion"), and the group's later labels at the same depth or deeper
 *     stay in it too;
 *   - a label with nothing under it ("**Confidence: medium**" at the end) is
 *     a line of the open section, not an empty section of its own.
 *
 * So a section title is never lost because its body opens with a sub-label,
 * and no content is ever dropped.
 */
function resolveSectionStarts(
  lines: Array<string>,
  kept: Array<boolean>,
  allCandidates: Array<SectionCandidate>,
  contentEnd: number,
): Array<SectionStart> {
  /*
   * Kept lines with text before each index, so "is there any content in
   * [from, to)" is O(1) however many labels a section swallows.
   */
  const contentBefore: Array<number> = [0];

  for (let index: number = 0; index < lines.length; index++) {
    const hasText: boolean =
      kept[index] === true && (lines[index] || "").trim() !== "";
    contentBefore.push((contentBefore[index] || 0) + (hasText ? 1 : 0));
  }

  const hasKeptContent: (from: number, to: number) => boolean = (
    from: number,
    to: number,
  ): boolean => {
    return (
      to > from && (contentBefore[to] || 0) - (contentBefore[from] || 0) > 0
    );
  };

  const isRecognised: (match: LabelLineMatch) => boolean = (
    match: LabelLineMatch,
  ): boolean => {
    return match.kind !== null && match.kind !== "EvidenceChecked";
  };

  /*
   * A heading at the same or a shallower level than the heading before it is
   * its peer, never its sub-label ("## Impact" then "## Timeline").
   */
  const isPeerHeading: (openLevel: number, match: LabelLineMatch) => boolean = (
    openLevel: number,
    match: LabelLineMatch,
  ): boolean => {
    const level: number = match.headingLevel || 0;

    return openLevel > 0 && level > 0 && level <= openLevel;
  };

  // A label with inline text ("Evidence checked: logs") is just a line of prose.
  const candidates: Array<SectionCandidate> = allCandidates.filter(
    (candidate: SectionCandidate): boolean => {
      return (
        kept[candidate.index] === true &&
        (isRecognised(candidate.match) || candidate.match.isBare)
      );
    },
  );

  /*
   * Whether an "Other" label at this position has a body: text before the
   * next label, or a next label that would become its sub-label and itself
   * has a body. Walked backwards so a run of labels costs linear time.
   */
  const hasBody: Array<boolean> = candidates.map((): boolean => {
    return false;
  });

  for (
    let position: number = candidates.length - 1;
    position >= 0;
    position--
  ) {
    const candidate: SectionCandidate | undefined = candidates[position];
    const next: SectionCandidate | undefined = candidates[position + 1];

    if (!candidate) {
      continue;
    }

    hasBody[position] =
      hasKeptContent(candidate.index + 1, next ? next.index : contentEnd) ||
      Boolean(
        next &&
          !isRecognised(next.match) &&
          !isPeerHeading(candidate.match.headingLevel || 0, next.match) &&
          hasBody[position + 1],
      );
  }

  const starts: Array<SectionStart> = [];

  candidates.forEach((candidate: SectionCandidate, position: number): void => {
    const match: LabelLineMatch = candidate.match;
    const headingLevel: number = match.headingLevel || 0;

    if (match.kind !== null && match.kind !== "EvidenceChecked") {
      starts.push({
        index: candidate.index,
        kind: match.kind,
        title: match.title,
        inlineBody: match.inlineBody,
        headingLevel,
      });
      return;
    }

    const open: SectionStart | undefined = starts[starts.length - 1];

    // Before the first recognised section, labels are preamble content.
    if (!open) {
      return;
    }

    const rank: number = getLabelRank(match);

    // A sub-heading of the recognised heading that opened the section.
    if (
      open.kind !== InvestigationReportSectionKind.Other &&
      open.headingLevel > 0 &&
      headingLevel > open.headingLevel
    ) {
      return;
    }

    // The first label under a label with no body: that label is a group heading.
    if (
      open.inlineBody === "" &&
      !hasKeptContent(open.index + 1, candidate.index) &&
      !isPeerHeading(open.headingLevel, match)
    ) {
      open.subLabelRank = rank;
      return;
    }

    // The group's later labels, at its sub-labels' depth or deeper.
    if (open.subLabelRank !== undefined && rank >= open.subLabelRank) {
      return;
    }

    // A label with nothing under it is a line of the open section.
    if (!hasBody[position]) {
      return;
    }

    starts.push({
      index: candidate.index,
      kind: InvestigationReportSectionKind.Other,
      title: match.title,
      inlineBody: "",
      headingLevel,
    });
  });

  return starts;
}

export function parseInvestigationReport(
  markdown: string,
): ParsedInvestigationReport {
  const normalised: string = normaliseLineEndings(markdown);

  if (!normalised.trim()) {
    return createEmptyReport();
  }

  const lines: Array<string> = normalised.split("\n");
  const fenced: Array<boolean> = markFencedLines(lines);
  const kept: Array<boolean> = lines.map((): boolean => {
    return true;
  });

  // 1. The branded heading, when it is the first thing in the document.
  const firstContentIndex: number = lines.findIndex((line: string): boolean => {
    return line.trim() !== "";
  });

  if (
    firstContentIndex >= 0 &&
    !fenced[firstContentIndex] &&
    isBrandHeading(lines[firstContentIndex] || "")
  ) {
    kept[firstContentIndex] = false;
  }

  // 2. The footer.
  const footerMatch: FooterMatch | null = findFooter(lines, fenced);
  const contentEnd: number = footerMatch
    ? footerMatch.breakIndex
    : lines.length;

  for (let index: number = contentEnd; index < lines.length; index++) {
    kept[index] = false;
  }

  // 3. Every line that could start a section.
  const candidates: Array<SectionCandidate> = findSectionCandidates(
    lines,
    fenced,
    kept,
    contentEnd,
  );

  /*
   * 4. Only the LAST bare "Evidence checked" label can be the server's list.
   * Earlier ones were written by the model and stay ordinary content.
   */
  let evidenceChecked: Array<InvestigationEvidenceCheckedEntry> = [];
  let evidenceCheckedIndex: number = -1;

  for (const candidate of candidates) {
    if (candidate.match.kind === "EvidenceChecked" && candidate.match.isBare) {
      evidenceCheckedIndex = candidate.index;
    }
  }

  if (evidenceCheckedIndex >= 0) {
    const blockEnd: number = findEvidenceCheckedBlockEnd(
      lines,
      fenced,
      evidenceCheckedIndex,
      contentEnd,
    );
    const entries: Array<ParsedEvidenceCheckedEntry> =
      parseEvidenceCheckedEntries(
        lines.slice(evidenceCheckedIndex + 1, blockEnd),
      );

    /*
     * A block the footer's counts rule out was written by the model: it
     * stays in the body as model content (isServerEvidenceCheckedBlock).
     */
    const isServerBlock: boolean = isServerEvidenceCheckedBlock(
      entries,
      footerMatch?.footer,
    );

    if (isServerBlock) {
      evidenceChecked = entries.map(
        (
          parsed: ParsedEvidenceCheckedEntry,
        ): InvestigationEvidenceCheckedEntry => {
          return parsed.entry;
        },
      );

      for (
        let index: number = evidenceCheckedIndex;
        index < blockEnd;
        index++
      ) {
        kept[index] = false;
      }
    }
  }

  // 5. Resolve candidates into section starts.
  const starts: Array<SectionStart> = resolveSectionStarts(
    lines,
    kept,
    candidates,
    contentEnd,
  );

  const firstStart: SectionStart | undefined = starts[0];
  const preamble: string = joinKeptLines(
    lines,
    kept,
    0,
    firstStart ? firstStart.index : contentEnd,
  ).trim();

  const sections: Array<InvestigationReportSection> = [];

  starts.forEach((start: SectionStart, position: number): void => {
    const next: SectionStart | undefined = starts[position + 1];
    const body: string = joinKeptLines(
      lines,
      kept,
      start.index + 1,
      next ? next.index : contentEnd,
    );
    const sectionMarkdown: string = `${start.inlineBody}\n${body}`.trim();

    if (!sectionMarkdown) {
      return;
    }

    sections.push({
      kind: start.kind,
      title: start.title,
      markdown: sectionMarkdown,
    });
  });

  const firstOfKind: (
    kind: InvestigationReportSectionKind,
  ) => string | undefined = (
    kind: InvestigationReportSectionKind,
  ): string | undefined => {
    return sections.find((section: InvestigationReportSection): boolean => {
      return section.kind === kind;
    })?.markdown;
  };

  const summary: string | undefined = firstOfKind(
    InvestigationReportSectionKind.Summary,
  );
  const rootCause: string | undefined = firstOfKind(
    InvestigationReportSectionKind.RootCause,
  );

  return {
    isStructured: summary !== undefined || rootCause !== undefined,
    preamble,
    sections,
    summary,
    rootCause,
    evidence: firstOfKind(InvestigationReportSectionKind.Evidence),
    nextSteps: firstOfKind(InvestigationReportSectionKind.NextSteps),
    evidenceChecked,
    footer: footerMatch?.footer,
    bodyMarkdown: joinKeptLines(lines, kept, 0, lines.length).trim(),
  };
}

type EventReferenceQualifier = "incident" | "alert" | "blocked";

/*
 * The qualifier word directly before a reference: "incident #12", "Alerts
 * #3", "prior incidents: #6954", "alerts (#100". "blocked" means a word from
 * another numbering ("PR #45"). Scans backwards over a bounded gap and word,
 * so the cost never grows with the text.
 */
function readQualifierBefore(
  text: string,
  hashIndex: number,
): EventReferenceQualifier | null {
  let cursor: number = hashIndex - 1;
  let punctuationCount: number = 0;

  while (cursor >= 0) {
    const character: string = text.charAt(cursor);

    if (WHITESPACE_CHARACTER_REGEX.test(character)) {
      cursor--;
      continue;
    }

    if (
      QUALIFIER_GAP_PUNCTUATION.includes(character) &&
      punctuationCount < MAX_QUALIFIER_GAP_PUNCTUATION
    ) {
      punctuationCount++;
      cursor--;
      continue;
    }

    break;
  }

  // Nothing between the word and "#" ("incident-#12" has a hyphen there).
  if (cursor === hashIndex - 1) {
    return null;
  }

  const wordEnd: number = cursor + 1;
  const wordStartLimit: number = wordEnd - MAX_QUALIFIER_WORD_LENGTH - 1;

  while (
    cursor >= 0 &&
    cursor >= wordStartLimit &&
    WORD_CHARACTER_REGEX.test(text.charAt(cursor))
  ) {
    cursor--;
  }

  // The word runs on past the longest qualifier, so it is none of them.
  if (cursor >= 0 && WORD_CHARACTER_REGEX.test(text.charAt(cursor))) {
    return null;
  }

  let wordStart: number = cursor + 1;

  // "__Alerts__ #3": "_" is a word character, but here it is emphasis.
  while (wordStart < wordEnd && text.charAt(wordStart) === "_") {
    wordStart++;
  }

  const word: string = text.slice(wordStart, wordEnd).toLowerCase();

  if (word === "incident" || word === "incidents") {
    return "incident";
  }

  if (word === "alert" || word === "alerts") {
    return "alert";
  }

  if (NON_EVENT_QUALIFIER_WORDS.has(word)) {
    return "blocked";
  }

  return null;
}

interface ScannedEventReference {
  qualifier: EventReferenceQualifier | null;
  number: number;
  start: number;
  end: number;
}

/*
 * Every "#123" in one text run with the qualifier it reads, "blocked" ones
 * included. tokenizeEventReferences documents the rules.
 */
function scanEventReferences(text: string): Array<ScannedEventReference> {
  const scanned: Array<ScannedEventReference> = [];

  if (typeof text !== "string" || !text.includes("#")) {
    return scanned;
  }

  const referenceRegex: RegExp = new RegExp(EVENT_REFERENCE_PATTERN, "g");
  let match: RegExpExecArray | null = referenceRegex.exec(text);

  while (match) {
    const start: number = match.index;
    const digits: string = match[1] || "";
    const before: string = start > 0 ? text.charAt(start - 1) : "";
    const isBlocked: boolean =
      before !== "" &&
      (WORD_CHARACTER_REGEX.test(before) ||
        FORBIDDEN_BEFORE_REFERENCE.includes(before));

    if (!isBlocked && digits) {
      const end: number = start + 1 + digits.length;
      const previous: ScannedEventReference | undefined =
        scanned[scanned.length - 1];
      let qualifier: EventReferenceQualifier | null = readQualifierBefore(
        text,
        start,
      );

      if (
        qualifier === null &&
        previous &&
        previous.qualifier !== null &&
        start - previous.end <= MAX_SIBLING_SEPARATOR_LENGTH &&
        SIBLING_SEPARATOR_REGEX.test(text.slice(previous.end, start))
      ) {
        qualifier = previous.qualifier;
      }

      scanned.push({
        qualifier,
        number: parseInt(digits, 10),
        start,
        end,
      });
    }

    match = referenceRegex.exec(text);
  }

  return scanned;
}

/*
 * Finds "#123" style references in plain text (one text run). A reference is
 * "#" + 1-9 digits, not preceded by a word character, "&", "/" or "#", and not
 * followed by a word character.
 *
 * An immediately preceding qualifier word ("incident", "incidents", "alert",
 * "alerts", case-insensitive) sets `kind`. It may be separated from the "#"
 * by whitespace and a little punctuation (":", "(", "[", "*", "_"). A
 * qualifier also carries to directly following comma/"and"/"or"-separated
 * siblings ("incidents #1, #2 and #3").
 *
 * A number after a word from another numbering ("scheduled maintenance #42",
 * "PR #45", "step #1") is not returned at all, and neither are its siblings
 * ("PRs #45, #46"): it is not an incident or alert of any kind.
 */
export function tokenizeEventReferences(
  text: string,
): Array<InvestigationEventReferenceToken> {
  const tokens: Array<InvestigationEventReferenceToken> = [];

  for (const reference of scanEventReferences(text)) {
    if (reference.qualifier === "blocked") {
      continue;
    }

    tokens.push({
      kind: reference.qualifier,
      number: reference.number,
      start: reference.start,
      end: reference.end,
    });
  }

  return tokens;
}

/*
 * Replaces inline code spans with a placeholder so references inside them
 * are ignored. A span opens with a run of N backticks and closes at the next
 * run of exactly N; an unmatched run is literal text.
 */
function maskInlineCode(text: string): string {
  if (!text.includes("`")) {
    return text;
  }

  let output: string = "";
  let cursor: number = 0;

  while (cursor < text.length) {
    const openStart: number = text.indexOf("`", cursor);

    if (openStart === -1) {
      output += text.slice(cursor);
      break;
    }

    let openEnd: number = openStart;

    while (openEnd < text.length && text.charAt(openEnd) === "`") {
      openEnd++;
    }

    const runLength: number = openEnd - openStart;
    let search: number = openEnd;
    let closeEnd: number = -1;

    while (search < text.length) {
      const nextStart: number = text.indexOf("`", search);

      if (nextStart === -1) {
        break;
      }

      let nextEnd: number = nextStart;

      while (nextEnd < text.length && text.charAt(nextEnd) === "`") {
        nextEnd++;
      }

      if (nextEnd - nextStart === runLength) {
        closeEnd = nextEnd;
        break;
      }

      search = nextEnd;
    }

    if (closeEnd === -1) {
      output += text.slice(cursor, openEnd);
      cursor = openEnd;
      continue;
    }

    output += text.slice(cursor, openStart) + CODE_SPAN_PLACEHOLDER;
    cursor = closeEnd;
  }

  return output;
}

/*
 * References across a whole markdown document, skipping fenced code blocks
 * and inline code spans. Returns unique {kind, number} pairs in first-seen
 * order, with null kinds replaced by `defaultKind`, capped at `limit`. An
 * unqualified number the document also qualifies as the other kind is left
 * out (see below). Callers resolving a posted report should pass its
 * bodyMarkdown, so the server's own evidence labels are not read as prose.
 */
export function extractEventReferences(
  markdown: string,
  defaultKind: "incident" | "alert",
  limit: number = DEFAULT_EVENT_REFERENCE_LIMIT,
): Array<ExtractedInvestigationEventReference> {
  const references: Array<ExtractedInvestigationEventReference> = [];
  const maxReferences: number = Math.floor(limit);

  if (!(maxReferences > 0)) {
    return references;
  }

  const normalised: string = normaliseLineEndings(markdown);

  if (!normalised.includes("#")) {
    return references;
  }

  const lines: Array<string> = normalised.split("\n");
  const fenced: Array<boolean> = markFencedLines(lines);

  /*
   * Group the non-code lines into blocks separated by fences and blank
   * lines: a code span never crosses either, so an unmatched backtick in one
   * paragraph cannot hide references in the next.
   */
  const blocks: Array<string> = [];
  let current: Array<string> = [];

  lines.forEach((line: string, index: number): void => {
    if (fenced[index] || !line.trim()) {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      return;
    }

    current.push(line);
  });

  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }

  const scanned: Array<ScannedEventReference> = [];

  for (const block of blocks) {
    for (const reference of scanEventReferences(maskInlineCode(block))) {
      scanned.push(reference);
    }
  }

  /*
   * An unqualified "#12" is taken as the subject's kind, except when the
   * same document also names 12 as something else: explicitly the OTHER
   * kind ("alert #12 fired ... #12 kept firing" on an incident) or in another
   * numbering ("scheduled maintenance #12 ... during #12"). The bare number
   * most likely means that, so it is not looked up as the subject's kind at
   * all: it stays plain text rather than linking to an unrelated record.
   */
  const otherKind: "incident" | "alert" =
    defaultKind === "incident" ? "alert" : "incident";
  const numbersNamedOtherwise: Set<number> = new Set<number>();

  for (const reference of scanned) {
    if (
      reference.qualifier === otherKind ||
      reference.qualifier === "blocked"
    ) {
      numbersNamedOtherwise.add(reference.number);
    }
  }

  const seen: Set<string> = new Set<string>();

  for (const token of scanned) {
    if (
      token.qualifier === "blocked" ||
      (token.qualifier === null && numbersNamedOtherwise.has(token.number))
    ) {
      continue;
    }

    const kind: "incident" | "alert" = token.qualifier || defaultKind;
    const key: string = `${kind}:${token.number}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    references.push({ kind, number: token.number });

    if (references.length >= maxReferences) {
      return references;
    }
  }

  return references;
}
