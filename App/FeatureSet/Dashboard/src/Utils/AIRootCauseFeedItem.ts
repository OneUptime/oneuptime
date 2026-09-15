import {
  InvestigationReportSection,
  InvestigationReportSectionKind,
  ParsedInvestigationReport,
  getCitationMarkerRegex,
  parseInvestigationReport,
} from "Common/Utils/AI/InvestigationReport";

/*
 * The incident and alert feeds used to repeat an AI investigation report in
 * full: brand heading, every section, raw "[C2][C3]" citation markers, the
 * "Evidence checked" list and the footer. The overview page already lays that
 * report out in the AI Investigation card, so the feed only needs the gist.
 *
 * These helpers turn a structured report into a short feed entry (a lead,
 * the Summary and the root cause, without citation markers) and move the
 * whole report behind the feed item's "More Information" button. Reports the
 * parser cannot structure are left exactly as they were posted.
 *
 * Everything returned is still model-authored markdown: the feeds keep
 * rendering it with safeMode.
 */

export const AI_ROOT_CAUSE_FEED_LEAD: string =
  "OneUptime AI posted a root cause analysis";

export const DEFAULT_AI_ROOT_CAUSE_LABEL: string = "Most likely root cause";

export interface AIRootCauseFeedContent {
  text: string;
  moreInformationInMarkdown?: string | undefined;
}

export interface FeedItemMarkdownInput {
  // True only for items the feed already classifies as AI investigations.
  isAIInvestigation: boolean;
  feedInfoInMarkdown?: string | undefined;
  moreInformationInMarkdown?: string | undefined;
}

export interface FeedItemMarkdown {
  textInMarkdown: string;
  moreTextInMarkdown: string;
}

const FENCE_OPEN_REGEX: RegExp = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_REGEX: RegExp = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/*
 * A body whose first line opens a list, heading, quote, fence, table, HTML
 * block, indented code or thematic break cannot share a line with the label.
 */
const BLOCK_START_REGEX: RegExp =
  /^(?:[ \t]*(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|`{3,}|~{3,}|\||<)| {4}|\t)/;
const THEMATIC_BREAK_REGEX: RegExp =
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

// Characters that would change the markdown of a bold "**Label:**" lead-in.
const LABEL_MARKDOWN_CHARACTERS_REGEX: RegExp = /[*_`[\]<>\\#|~]/g;
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;
const MAX_LABEL_LENGTH: number = 80;

/*
 * After a removed marker these characters attach to the previous word
 * ("pool [C1]." -> "pool.", "**pool [C1]**" -> "**pool**"); anything else
 * gets one separating space.
 */
const ATTACHES_TO_PREVIOUS_WORD_REGEX: RegExp = /[\s.,;:!?)\]}%…'"*_~]/;

/*
 * A run of citation markers: "[C1]", "[C1][C2]", "[C1] [C2]", "[C1], [C2]".
 * Built from the shared marker pattern so the two can never drift apart.
 */
function getCitationRunRegex(): RegExp {
  const marker: string = getCitationMarkerRegex().source;

  return new RegExp(`${marker}(?:[ \\t]*(?:[,;][ \\t]*)?${marker})*`, "g");
}

function isSpaceOrTab(character: string): boolean {
  return character === " " || character === "\t";
}

function trimTrailingSpacesAndTabs(value: string): string {
  let end: number = value.length;

  while (end > 0 && isSpaceOrTab(value.charAt(end - 1))) {
    end--;
  }

  return value.slice(0, end);
}

/*
 * Lines that belong to a fenced code block, fence lines included. Mirrors
 * the report parser: any indentation may open a fence, a backtick fence's
 * info string cannot contain a backtick, and an unclosed fence runs to the
 * end of the text.
 */
function markFencedLines(lines: Array<string>): Array<boolean> {
  const fenced: Array<boolean> = [];
  let openFence: string | null = null;

  for (const line of lines) {
    if (openFence === null) {
      const open: RegExpExecArray | null = FENCE_OPEN_REGEX.exec(line);
      const marker: string = open?.[1] || "";
      const info: string = open?.[2] || "";

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

/*
 * [start, end) ranges of the inline code spans in one block. A span opens
 * with a run of N backticks and closes at the next run of exactly N; an
 * unmatched run is literal text.
 */
function findInlineCodeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];

  if (!text.includes("`")) {
    return ranges;
  }

  let cursor: number = 0;

  while (cursor < text.length) {
    const openStart: number = text.indexOf("`", cursor);

    if (openStart === -1) {
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
      cursor = openEnd;
      continue;
    }

    ranges.push([openStart, closeEnd]);
    cursor = closeEnd;
  }

  return ranges;
}

function isInsideRanges(
  index: number,
  ranges: Array<[number, number]>,
): boolean {
  return ranges.some((range: [number, number]): boolean => {
    return index >= range[0] && index < range[1];
  });
}

/*
 * Removes citation markers from one block of non-code lines. Markers inside
 * inline code spans are literal text and stay.
 */
function stripCitationMarkersFromBlock(block: string): string {
  const codeRanges: Array<[number, number]> = findInlineCodeRanges(block);
  const regex: RegExp = getCitationRunRegex();
  let output: string = "";
  let cursor: number = 0;
  let match: RegExpExecArray | null = regex.exec(block);

  while (match) {
    const start: number = match.index;
    let end: number = start + match[0].length;

    if (isInsideRanges(start, codeRanges)) {
      match = regex.exec(block);
      continue;
    }

    const before: string = block.slice(cursor, start);
    let kept: string = output + trimTrailingSpacesAndTabs(before);
    let next: string = block.charAt(end);
    let removedParentheses: boolean = false;

    // "pool ([C1])" and "pool ([C1], [C2])" lose their now-empty parentheses.
    if (kept.endsWith("(") && next === ")") {
      kept = trimTrailingSpacesAndTabs(kept.slice(0, -1));
      end++;
      next = block.charAt(end);
      removedParentheses = true;
    }

    const lastKeptCharacter: string = kept.charAt(kept.length - 1);
    const isAtLineStart: boolean =
      lastKeptCharacter === "" || lastKeptCharacter === "\n";

    if (isAtLineStart) {
      // Keep the line's indentation; drop the gap the marker leaves after it.
      output = removedParentheses ? kept : output + before;

      while (end < block.length && isSpaceOrTab(block.charAt(end))) {
        end++;
      }
    } else {
      output = kept;

      // "pool [C1]saturated" must not become "poolsaturated".
      if (next !== "" && !ATTACHES_TO_PREVIOUS_WORD_REGEX.test(next)) {
        output += " ";
      }
    }

    cursor = end;
    regex.lastIndex = end;
    match = regex.exec(block);
  }

  output += block.slice(cursor);

  // A line that held nothing but markers would otherwise split its paragraph.
  return output
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim() !== "";
    })
    .join("\n");
}

/*
 * Removes "[C#]" citation markers, and the spaces in front of them, from
 * markdown. Fenced code blocks and inline code spans are left untouched: a
 * marker there is literal text (a log line, a query), not a citation. Line
 * endings are normalised to "\n".
 */
export function stripCitationMarkers(markdown: string): string {
  if (typeof markdown !== "string") {
    return "";
  }

  const normalised: string = markdown.replace(/\r\n?/g, "\n");

  if (!getCitationMarkerRegex().test(normalised)) {
    return normalised;
  }

  const lines: Array<string> = normalised.split("\n");
  const fenced: Array<boolean> = markFencedLines(lines);
  const output: Array<string> = [];
  let block: Array<string> = [];
  let lastWasBlank: boolean = false;

  const pushLine: (line: string, isFenced: boolean) => void = (
    line: string,
    isFenced: boolean,
  ): void => {
    const isBlank: boolean = !isFenced && line.trim() === "";

    // One blank line is enough where a markers-only paragraph disappeared.
    if (isBlank && lastWasBlank) {
      return;
    }

    output.push(line);
    lastWasBlank = isBlank;
  };

  const flushBlock: () => void = (): void => {
    if (block.length === 0) {
      return;
    }

    const stripped: string = stripCitationMarkersFromBlock(block.join("\n"));
    block = [];

    if (stripped !== "") {
      for (const line of stripped.split("\n")) {
        pushLine(line, false);
      }
    }
  };

  lines.forEach((line: string, index: number): void => {
    if (fenced[index] || line.trim() === "") {
      flushBlock();
      pushLine(line, Boolean(fenced[index]));
      return;
    }

    block.push(line);
  });

  flushBlock();

  return output.join("\n");
}

/*
 * The root cause section's own title ("Probable root cause (medium
 * confidence)") as plain label text, or the default label.
 */
function getRootCauseLabel(report: ParsedInvestigationReport): string {
  const section: InvestigationReportSection | undefined = report.sections.find(
    (candidate: InvestigationReportSection): boolean => {
      return candidate.kind === InvestigationReportSectionKind.RootCause;
    },
  );

  const label: string = (section?.title || "")
    .replace(LABEL_MARKDOWN_CHARACTERS_REGEX, "")
    .replace(WHITESPACE_RUN_REGEX, " ")
    .trim();

  if (!label || label.length > MAX_LABEL_LENGTH) {
    return DEFAULT_AI_ROOT_CAUSE_LABEL;
  }

  return label.endsWith(":") ? label.slice(0, -1).trimEnd() : label;
}

function labelParagraph(label: string, body: string): string {
  const firstLine: string = body.split("\n")[0] || "";

  if (
    BLOCK_START_REGEX.test(firstLine) ||
    THEMATIC_BREAK_REGEX.test(firstLine)
  ) {
    return `**${label}:**\n\n${body}`;
  }

  return `**${label}:** ${body}`;
}

/*
 * The compact feed entry for an AI root-cause report. A structured report
 * becomes a bold lead, its Summary and its labelled root cause, with citation
 * markers removed, and the full original report as More Information.
 * Anything else comes back unchanged as the text, with no More Information.
 */
export function buildAIRootCauseFeedContent(
  markdown: string,
): AIRootCauseFeedContent {
  if (typeof markdown !== "string") {
    return { text: "" };
  }

  const report: ParsedInvestigationReport = parseInvestigationReport(markdown);

  if (!report.isStructured) {
    return { text: markdown };
  }

  const summary: string = stripCitationMarkers(report.summary || "").trim();
  const rootCause: string = stripCitationMarkers(report.rootCause || "").trim();

  // A section that was nothing but citations says nothing on its own.
  if (!summary && !rootCause) {
    return { text: markdown };
  }

  const paragraphs: Array<string> = [`**${AI_ROOT_CAUSE_FEED_LEAD}**`];

  if (summary) {
    paragraphs.push(summary);
  }

  if (rootCause) {
    paragraphs.push(labelParagraph(getRootCauseLabel(report), rootCause));
  }

  return {
    text: paragraphs.join("\n\n"),
    moreInformationInMarkdown: markdown,
  };
}

/*
 * What an incident or alert feed item shows. Only AI investigation items are
 * compacted. An item that already carries its own More Information keeps it
 * and keeps its full text too, so the report is never hidden behind a button
 * that opens something else.
 */
export function getFeedItemMarkdown(
  data: FeedItemMarkdownInput,
): FeedItemMarkdown {
  const text: string = data.feedInfoInMarkdown || "";
  const moreText: string = data.moreInformationInMarkdown || "";

  if (!data.isAIInvestigation || moreText.trim() !== "") {
    return { textInMarkdown: text, moreTextInMarkdown: moreText };
  }

  const content: AIRootCauseFeedContent = buildAIRootCauseFeedContent(text);

  return {
    textInMarkdown: content.text,
    moreTextInMarkdown: content.moreInformationInMarkdown || moreText,
  };
}
