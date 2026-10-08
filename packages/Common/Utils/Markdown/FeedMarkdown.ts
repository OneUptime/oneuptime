import {
  WORD_JOINER,
  escapeMarkdownInline,
  escapeMarkdownValue,
  markdownCodeSpan,
  neutralizeChatControlSequences,
  neutralizeChatLinkSequences,
} from "./MarkdownEscape";
import {
  neutralizeAiWrittenMarkdown,
  neutralizeUntrustedMarkdown,
  neutralizeUntrustedValue,
} from "./UntrustedMarkdown";
import type URL from "../../Types/API/URL";
import type ObjectID from "../../Types/ObjectID";

/*
 * FEED AND CHAT MARKDOWN, ESCAPED BY DEFAULT.
 *
 * Feed items - of incidents, alerts, episodes, scheduled maintenance events,
 * monitors, on-call policies, SLOs and every infrastructure resource - are
 * Markdown that the dashboard renders without its safe mode, that the emails
 * render with marked, and that is posted to Slack and Microsoft Teams. So are
 * the Slack and Teams messages OneUptime writes. Each is a sentence OneUptime
 * wrote around text it did not: a name, a title, a state, a label, a rule, a
 * team, a person, a host or a cluster an agent reported. Placed into Markdown
 * as it is, such text turns into a link whose words hide where it goes, an
 * image fetched when the feed is opened, raw HTML, a heading or a Slack
 * mention - and an ordinary name with a "*" or a "_" in it does not read as
 * it was typed.
 *
 * Escaping each value by hand where it is placed (escapeMarkdownValue,
 * escapeMarkdownInline, markdownCodeSpan) works until one value is missed, and
 * every new feed sentence was another chance to miss one. So feed and chat
 * Markdown is written with the `mdText` tag instead:
 *
 *   mdText`🏷️ Added **${label.name}** to [Monitor ${monitor.name}](${link})`
 *
 * (Named mdText, not md: Prettier formats a template tagged `md` or
 * `markdown` as Markdown of its own, which would rewrite the text.)
 *
 * Every value is text, unless it is a MarkdownText - a piece written with
 * `mdText` or made by a FeedMarkdown helper - which is placed as it is. A value
 * is escaped for the place it sits in the sentence, which the tag reads from
 * the template's own text:
 *
 *   - In a sentence: escapeMarkdownValue (brackets, "<", backslashes, chat
 *     mentions, line breaks), and also the characters that would restyle it -
 *     "`", "*", "_" and "~" - an "&" that would be read as a character
 *     reference, a "|" in a table row, and a heading, list, quote or fence
 *     marker when the value starts a line (after a list marker too).
 *   - In a link's text: escapeMarkdownInline, as above.
 *   - As a link's address: characters that would end the address are
 *     percent-encoded, and only a web, mailto or relative address is kept.
 *   - Inside a code span: the span is written again around the value with
 *     markdownCodeSpan, so a backtick in the value cannot close it.
 *   - Inside a fenced code block: the fence is made longer than any fence in
 *     the value, and chat mentions and Slack links are broken.
 *
 * Every escape is a backslash before ASCII punctuation, which every renderer
 * here turns back into the character typed, so a value reads exactly as it
 * was typed, wherever it is placed, and never becomes Markdown.
 *
 * Markdown that is meant to be Markdown - a description or a note somebody
 * wrote, Markdown OneUptime AI wrote - is placed with FeedMarkdown.asMarkdown
 * or FeedMarkdown.aiWritten, by name, so the places that do so can be found.
 *
 * A sink - a feed item's feedInfoInMarkdown, a chat message's text - takes a
 * string: hand it the MarkdownText's toString(). Pieces stay MarkdownText
 * until then; a piece turned into a string and placed into `mdText` again would
 * be escaped a second time.
 *
 * This module is the one way into MarkdownEscape and UntrustedMarkdown: code
 * outside Utils/Markdown calls FeedMarkdown, never those helpers (the guard
 * FeedAndChatPlainTextEscapedGuard holds it to that). Text that goes into
 * Markdown somebody else assembles - a template a person wrote, a value
 * stored for later - has its own entry points here too: templateText,
 * reportedValue and withoutChatSequences.
 *
 * Pure, with no database or React imports.
 */

/*
 * A MarkdownText is recognised by this mark rather than by instanceof, so a
 * piece made by another copy of this module is recognised too.
 */
const MARKDOWN_TEXT_MARK: unique symbol = Symbol.for(
  "oneuptime.FeedMarkdown.MarkdownText",
);

/*
 * The one way to make a MarkdownText: a module-private key the constructor
 * checks, so nothing outside this module turns a string into one except
 * through a helper that says what the string is.
 */
const CONSTRUCTION_KEY: unique symbol = Symbol("FeedMarkdown construction key");

export class MarkdownText {
  private readonly markdown: string;

  public readonly [MARKDOWN_TEXT_MARK] = true as const;

  public constructor(key: typeof CONSTRUCTION_KEY, markdown: string) {
    if (key !== CONSTRUCTION_KEY) {
      throw new Error(
        "A MarkdownText is made with the mdText tag or a FeedMarkdown helper.",
      );
    }

    this.markdown = markdown;
  }

  public toString(): string {
    return this.markdown;
  }

  public isEmpty(): boolean {
    return this.markdown.length === 0;
  }
}

// What may be placed into `mdText`: text, numbers, OneUptime's own values, Markdown.
export type MarkdownValue =
  | MarkdownText
  | string
  | number
  | bigint
  | URL
  | ObjectID
  | null
  | undefined;

type MakeMarkdownTextFunction = (markdown: string) => MarkdownText;

const makeMarkdownText: MakeMarkdownTextFunction = (
  markdown: string,
): MarkdownText => {
  return new MarkdownText(CONSTRUCTION_KEY, markdown);
};

type IsMarkdownTextFunction = (value: unknown) => value is MarkdownText;

export const isMarkdownText: IsMarkdownTextFunction = (
  value: unknown,
): value is MarkdownText => {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [MARKDOWN_TEXT_MARK]?: unknown })[MARKDOWN_TEXT_MARK] === true
  );
};

type ToTextFunction = (value: MarkdownValue) => string;

// A value as text: nothing for null and undefined, as the escapers have it.
const toText: ToTextFunction = (value: MarkdownValue): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

/*
 * THE TEMPLATE'S OWN TEXT.
 *
 * The tag reads where each value sits from the template's literal text with
 * one character standing in for each value: the skeleton. The skeleton is
 * written by OneUptime's own code, so only the Markdown such code writes is
 * read - fenced code blocks, code spans, links (and images), table rows, and
 * the start of a line - and no value is ever read as part of it.
 */

// Stands in for a value in the skeleton. Never part of a template's text.
const VALUE_STAND_IN: string = "￼";
const VALUE_STAND_IN_PATTERN: RegExp = /￼/g;

enum ValuePlace {
  Sentence = "Sentence",
  LinkText = "LinkText",
  LinkAddress = "LinkAddress",
  CodeSpan = "CodeSpan",
  FencedCode = "FencedCode",
  FenceLine = "FenceLine",
}

interface PlacedValue {
  place: ValuePlace;
  // Sentence: the value starts a line, after any list or quote markers.
  startsLine: boolean;
  // Sentence: the value sits in a table row, where "|" ends a cell.
  inTableRow: boolean;
}

/*
 * A run of the skeleton that is written again as a whole around the values
 * in it: a code span, or a fenced code block.
 */
interface RewrittenRun {
  kind: "CodeSpan" | "FencedCode";
  // [start, end) in the skeleton.
  start: number;
  end: number;
  // FencedCode: the fence lines and what is between them.
  fence?: {
    character: string;
    length: number;
    // [start, end) of the opening fence line, without its line break.
    openingLineStart: number;
    openingLineEnd: number;
    // [start, end) of the closing fence line, or null when it is not closed.
    closingLineStart: number | null;
    closingLineEnd: number | null;
  };
}

interface TemplateReading {
  // The template's text with VALUE_STAND_IN where each value goes.
  text: string;
  // Where each value is in `text`, in order.
  valuePositions: Array<number>;
  places: Array<PlacedValue>;
  // Runs written again, by their start; only those with a value in them.
  runsByStart: Map<number, RewrittenRun>;
}

const ASCII_PUNCTUATION_PATTERN: RegExp = /[!-/:-@[-`{-~]/;

/*
 * Before a value on its line: only indentation, list markers ("-", "*", "+",
 * "1." or "1)" and a space), quote markers (">") - and other values, which
 * may be empty. A value there starts a block of its own.
 */
const LINE_START_PREFIX_PATTERN: RegExp =
  /^[ \t￼]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+[ \t￼]*|>[ \t￼]*)*$/;

const TABLE_ROW_PATTERN: RegExp = /^[ \t]*\|/;

// A line that opens or closes a fenced code block, as CommonMark reads one.
const FENCE_LINE_PATTERN: RegExp = /^( {0,3})(`{3,}|~{3,})(.*)$/;

type RunLengthFunction = (text: string, start: number, end: number) => number;

// How many of the character at `start` follow one another.
const runLength: RunLengthFunction = (
  text: string,
  start: number,
  end: number,
): number => {
  const character: string = text[start]!;
  let index: number = start;

  while (index < end && text[index] === character) {
    index++;
  }

  return index - start;
};

interface Line {
  start: number;
  end: number;
}

type SplitLinesFunction = (text: string) => Array<Line>;

const splitLines: SplitLinesFunction = (text: string): Array<Line> => {
  const lines: Array<Line> = [];
  let start: number = 0;

  for (let index: number = 0; index <= text.length; index++) {
    if (index === text.length || text[index] === "\n") {
      lines.push({ start: start, end: index });
      start = index + 1;
    }
  }

  return lines;
};

interface InlineRanges {
  codeSpans: Array<{ start: number; end: number; run: number }>;
  linkTexts: Array<{ start: number; end: number }>;
  linkAddresses: Array<{ start: number; end: number }>;
}

type FindCodeSpanCloserFunction = (
  text: string,
  from: number,
  run: number,
  end: number,
) => number;

// The next run of exactly `run` backticks: where a code span opened by one ends.
const findCodeSpanCloser: FindCodeSpanCloserFunction = (
  text: string,
  from: number,
  run: number,
  end: number,
): number => {
  let index: number = from;

  while (index < end) {
    if (text[index] === "`") {
      const length: number = runLength(text, index, end);

      if (length === run) {
        return index;
      }

      index += length;
      continue;
    }

    index++;
  }

  return -1;
};

type ReadLineInlineFunction = (
  text: string,
  start: number,
  end: number,
) => InlineRanges;

/*
 * The code spans and links of one line of the template's text. Code spans
 * first, as CommonMark reads them before links; a "\" before punctuation
 * escapes it outside code. Links are "[text](address)", with brackets inside
 * the text balanced and parentheses inside the address balanced.
 */
const readLineInline: ReadLineInlineFunction = (
  text: string,
  start: number,
  end: number,
): InlineRanges => {
  const ranges: InlineRanges = {
    codeSpans: [],
    linkTexts: [],
    linkAddresses: [],
  };

  let index: number = start;

  while (index < end) {
    const character: string = text[index]!;

    if (
      character === "\\" &&
      index + 1 < end &&
      ASCII_PUNCTUATION_PATTERN.test(text[index + 1]!)
    ) {
      index += 2;
      continue;
    }

    if (character === "`") {
      const run: number = runLength(text, index, end);
      const closer: number = findCodeSpanCloser(text, index + run, run, end);

      if (closer !== -1) {
        ranges.codeSpans.push({ start: index, end: closer + run, run: run });
        index = closer + run;
        continue;
      }

      index += run;
      continue;
    }

    index++;
  }

  const isInCodeSpan: (position: number) => boolean = (
    position: number,
  ): boolean => {
    return ranges.codeSpans.some(
      (span: { start: number; end: number }): boolean => {
        return position >= span.start && position < span.end;
      },
    );
  };

  index = start;

  while (index < end) {
    if (isInCodeSpan(index)) {
      index++;
      continue;
    }

    const character: string = text[index]!;

    if (
      character === "\\" &&
      index + 1 < end &&
      ASCII_PUNCTUATION_PATTERN.test(text[index + 1]!)
    ) {
      index += 2;
      continue;
    }

    if (character !== "[") {
      index++;
      continue;
    }

    // The "]" that closes this "[": brackets in between balanced.
    let closingBracket: number = -1;
    let depth: number = 1;
    let cursor: number = index + 1;

    while (cursor < end) {
      if (isInCodeSpan(cursor)) {
        cursor++;
        continue;
      }

      const inner: string = text[cursor]!;

      if (
        inner === "\\" &&
        cursor + 1 < end &&
        ASCII_PUNCTUATION_PATTERN.test(text[cursor + 1]!)
      ) {
        cursor += 2;
        continue;
      }

      if (inner === "[") {
        depth++;
      } else if (inner === "]") {
        depth--;

        if (depth === 0) {
          closingBracket = cursor;
          break;
        }
      }

      cursor++;
    }

    if (closingBracket === -1 || text[closingBracket + 1] !== "(") {
      index++;
      continue;
    }

    // The ")" that ends the address: parentheses in between balanced.
    let closingParenthesis: number = -1;
    let parentheses: number = 0;

    cursor = closingBracket + 2;

    while (cursor < end) {
      const inner: string = text[cursor]!;

      if (
        inner === "\\" &&
        cursor + 1 < end &&
        ASCII_PUNCTUATION_PATTERN.test(text[cursor + 1]!)
      ) {
        cursor += 2;
        continue;
      }

      if (inner === "(") {
        parentheses++;
      } else if (inner === ")") {
        if (parentheses === 0) {
          closingParenthesis = cursor;
          break;
        }

        parentheses--;
      }

      cursor++;
    }

    if (closingParenthesis === -1) {
      index++;
      continue;
    }

    ranges.linkTexts.push({ start: index + 1, end: closingBracket });
    ranges.linkAddresses.push({
      start: closingBracket + 2,
      end: closingParenthesis,
    });

    index = closingParenthesis + 1;
  }

  return ranges;
};

type ReadTemplateFunction = (
  literals: ReadonlyArray<string>,
) => TemplateReading;

const readTemplate: ReadTemplateFunction = (
  literals: ReadonlyArray<string>,
): TemplateReading => {
  const valuePositions: Array<number> = [];
  let text: string = "";

  literals.forEach((literal: string, index: number): void => {
    /*
     * A stand-in typed into the template itself is not a value. (A literal
     * with an escape JavaScript cannot read is undefined: nothing.)
     */
    text += (literal ?? "").replace(VALUE_STAND_IN_PATTERN, "?");

    if (index < literals.length - 1) {
      valuePositions.push(text.length);
      text += VALUE_STAND_IN;
    }
  });

  const places: Array<PlacedValue> = valuePositions.map((): PlacedValue => {
    return {
      place: ValuePlace.Sentence,
      startsLine: false,
      inTableRow: false,
    };
  });

  const runsByStart: Map<number, RewrittenRun> = new Map<
    number,
    RewrittenRun
  >();

  const valueIndexAt: Map<number, number> = new Map<number, number>();

  valuePositions.forEach((position: number, index: number): void => {
    valueIndexAt.set(position, index);
  });

  const valuesBetween: (start: number, end: number) => Array<number> = (
    start: number,
    end: number,
  ): Array<number> => {
    const indexes: Array<number> = [];

    valuePositions.forEach((position: number, index: number): void => {
      if (position >= start && position < end) {
        indexes.push(index);
      }
    });

    return indexes;
  };

  const lines: Array<Line> = splitLines(text);

  // Fenced code blocks: a fence line opens one, a long enough one closes it.
  const fencedLines: Set<number> = new Set<number>();
  let lineIndex: number = 0;

  while (lineIndex < lines.length) {
    const line: Line = lines[lineIndex]!;
    const opening: RegExpExecArray | null = FENCE_LINE_PATTERN.exec(
      text.slice(line.start, line.end),
    );

    // A backtick fence's info string has no backtick in it.
    if (
      !opening ||
      (opening[2]!.startsWith("`") && opening[3]!.includes("`"))
    ) {
      lineIndex++;
      continue;
    }

    const character: string = opening[2]![0]!;
    const length: number = opening[2]!.length;

    let closingLine: number = -1;

    for (
      let candidate: number = lineIndex + 1;
      candidate < lines.length;
      candidate++
    ) {
      const candidateLine: Line = lines[candidate]!;
      const closing: RegExpExecArray | null = FENCE_LINE_PATTERN.exec(
        text.slice(candidateLine.start, candidateLine.end),
      );

      if (
        closing &&
        closing[2]![0] === character &&
        closing[2]!.length >= length &&
        closing[3]!.trim() === ""
      ) {
        closingLine = candidate;
        break;
      }
    }

    const lastLine: number =
      closingLine === -1 ? lines.length - 1 : closingLine;

    for (let fenced: number = lineIndex; fenced <= lastLine; fenced++) {
      fencedLines.add(fenced);
    }

    const blockStart: number = line.start;
    const blockEnd: number = lines[lastLine]!.end;
    const valuesInBlock: Array<number> = valuesBetween(blockStart, blockEnd);

    for (const valueIndex of valuesInBlock) {
      const position: number = valuePositions[valueIndex]!;
      const onFenceLine: boolean =
        (position >= line.start && position < line.end) ||
        (closingLine !== -1 &&
          position >= lines[closingLine]!.start &&
          position < lines[closingLine]!.end);

      places[valueIndex]!.place = onFenceLine
        ? ValuePlace.FenceLine
        : ValuePlace.FencedCode;
    }

    if (valuesInBlock.length > 0) {
      runsByStart.set(blockStart, {
        kind: "FencedCode",
        start: blockStart,
        end: blockEnd,
        fence: {
          character: character,
          length: length,
          openingLineStart: line.start,
          openingLineEnd: line.end,
          closingLineStart:
            closingLine === -1 ? null : lines[closingLine]!.start,
          closingLineEnd: closingLine === -1 ? null : lines[closingLine]!.end,
        },
      });
    }

    lineIndex = lastLine + 1;
  }

  // Every other line: its code spans, links, table row and line start.
  lines.forEach((line: Line, index: number): void => {
    if (fencedLines.has(index)) {
      return;
    }

    const lineText: string = text.slice(line.start, line.end);
    const ranges: InlineRanges = readLineInline(text, line.start, line.end);
    const inTableRow: boolean = TABLE_ROW_PATTERN.test(lineText);

    for (const span of ranges.codeSpans) {
      const valuesInSpan: Array<number> = valuesBetween(span.start, span.end);

      for (const valueIndex of valuesInSpan) {
        places[valueIndex]!.place = ValuePlace.CodeSpan;
      }

      if (valuesInSpan.length > 0) {
        runsByStart.set(span.start, {
          kind: "CodeSpan",
          start: span.start,
          end: span.end,
        });
      }
    }

    for (const valueIndex of valuesBetween(line.start, line.end)) {
      const placed: PlacedValue = places[valueIndex]!;

      if (placed.place === ValuePlace.CodeSpan) {
        continue;
      }

      const position: number = valuePositions[valueIndex]!;

      const inRange: (range: {
        start: number;
        end: number;
      }) => boolean = (range: { start: number; end: number }): boolean => {
        return position >= range.start && position < range.end;
      };

      if (ranges.linkAddresses.some(inRange)) {
        placed.place = ValuePlace.LinkAddress;
        continue;
      }

      if (ranges.linkTexts.some(inRange)) {
        placed.place = ValuePlace.LinkText;
        continue;
      }

      placed.place = ValuePlace.Sentence;
      placed.inTableRow = inTableRow;
      placed.startsLine = LINE_START_PREFIX_PATTERN.test(
        text.slice(line.start, position),
      );
    }
  });

  return {
    text: text,
    valuePositions: valuePositions,
    places: places,
    runsByStart: runsByStart,
  };
};

/*
 * VALUES, AS EACH PLACE NEEDS THEM.
 */

/*
 * What restyles a sentence that escapeMarkdownValue leaves alone: emphasis
 * ("*", "_"), code ("`") and strikethrough ("~"), and an "&" a renderer
 * would read as a character reference ("&lt;", "&#60;", "&#x3C;") - or that
 * ends the value, where the text after it could finish one. Each gets a
 * backslash, except:
 *
 *   - an "_" between two letters or digits ("checkout_service"), which
 *     starts no emphasis in any renderer here;
 *   - any of them inside a bare web address ("https://example.com/~ops/_x"):
 *     the renderers make a link of the address as it is written, escapes
 *     included, so an escape there would change where the link goes. The
 *     address ends before the punctuation GitHub's Markdown leaves out of
 *     such a link, which is escaped like any other.
 *
 * Any other "&" ("R&D") is left as it is.
 */
const BARE_WEB_ADDRESS_PATTERN: RegExp =
  /(?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:*_~]/gi;
const WORD_CHARACTER_PATTERN: RegExp = /[\p{L}\p{N}]/u;
const CHARACTER_REFERENCE_PATTERN: RegExp =
  /^&(?:#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{0,31};|$)/;
const CHARACTER_REFERENCE_AMPERSAND_PATTERN: RegExp =
  /&(?=#[0-9]{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z][A-Za-z0-9]{0,31};|$)/g;

type EscapeSentenceStyleFunction = (text: string) => string;

const escapeSentenceStyle: EscapeSentenceStyleFunction = (
  text: string,
): string => {
  const addresses: Array<{ start: number; end: number }> = Array.from(
    text.matchAll(BARE_WEB_ADDRESS_PATTERN),
  ).map((match: RegExpMatchArray): { start: number; end: number } => {
    return { start: match.index!, end: match.index! + match[0].length };
  });

  const isInAddress: (index: number) => boolean = (index: number): boolean => {
    return addresses.some(
      (address: { start: number; end: number }): boolean => {
        return index >= address.start && index < address.end;
      },
    );
  };

  let escaped: string = "";

  for (let index: number = 0; index < text.length; index++) {
    const character: string = text[index]!;

    if (isInAddress(index)) {
      escaped += character;
      continue;
    }

    if (character === "`" || character === "*" || character === "~") {
      escaped += `\\${character}`;
      continue;
    }

    if (character === "_") {
      const betweenWordCharacters: boolean =
        WORD_CHARACTER_PATTERN.test(text[index - 1] || "") &&
        WORD_CHARACTER_PATTERN.test(text[index + 1] || "");

      escaped += betweenWordCharacters ? character : `\\${character}`;
      continue;
    }

    if (
      character === "&" &&
      CHARACTER_REFERENCE_PATTERN.test(text.slice(index))
    ) {
      escaped += "\\&";
      continue;
    }

    escaped += character;
  }

  return escaped;
};

const TABLE_CELL_SEPARATOR_PATTERN: RegExp = /\|/g;

// What starts a block when it starts a line: a heading, a quote, a list, a fence, a table.
const LINE_START_MARKER_PATTERN: RegExp = /^[#>+\-=|]/;
const LINE_START_ORDERED_LIST_PATTERN: RegExp = /^(\d{1,9})([.)])/;

type EscapeSentenceValueFunction = (
  text: string,
  placed: PlacedValue,
) => string;

const escapeSentenceValue: EscapeSentenceValueFunction = (
  text: string,
  placed: PlacedValue,
): string => {
  let escaped: string = escapeSentenceStyle(escapeMarkdownValue(text));

  if (placed.inTableRow) {
    escaped = escaped.replace(TABLE_CELL_SEPARATOR_PATTERN, "\\|");
  }

  if (placed.startsLine) {
    if (LINE_START_MARKER_PATTERN.test(escaped)) {
      escaped = `\\${escaped}`;
    } else {
      escaped = escaped.replace(LINE_START_ORDERED_LIST_PATTERN, "$1\\$2");
    }
  }

  return escaped;
};

const STRIKETHROUGH_PATTERN: RegExp = /~/g;

type EscapeLinkTextValueFunction = (text: string) => string;

/*
 * In a link's own text: escapeMarkdownInline, which escapes every character
 * that starts something - marked reads a link's text again after undoing
 * "\[" and "\]", so brackets alone are not enough there - and the
 * strikethrough and character references it leaves alone.
 */
const escapeLinkTextValue: EscapeLinkTextValueFunction = (
  text: string,
): string => {
  return escapeMarkdownInline(text)
    .replace(STRIKETHROUGH_PATTERN, "\\~")
    .replace(CHARACTER_REFERENCE_AMPERSAND_PATTERN, "\\&");
};

// What would end or break a link's address, percent-encoded.
const LINK_ADDRESS_ENCODINGS: Record<string, string> = {
  " ": "%20",
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
  "\\": "%5C",
  "`": "%60",
  '"': "%22",
  "'": "%27",
};

const LINK_ADDRESS_UNSAFE_PATTERN: RegExp = /[\s()<>\\`"'\p{Cc}]/gu;

// A scheme: letters, then letters, digits, "+", "." or "-", then ":".
const LINK_ADDRESS_SCHEME_PATTERN: RegExp = /^([A-Za-z][A-Za-z0-9+.-]*):/;

const ALLOWED_LINK_SCHEMES: ReadonlySet<string> = new Set<string>([
  "http",
  "https",
  "mailto",
]);

type EncodeLinkAddressFunction = (address: string) => string;

/*
 * A link's address, as OneUptime writes one: the address of a page, with
 * nothing in it that would end the link or start another. An address with
 * any other scheme ("javascript:", "data:") is not linked at all.
 */
const encodeLinkAddress: EncodeLinkAddressFunction = (
  address: string,
): string => {
  const trimmed: string = address.trim();
  const scheme: RegExpExecArray | null =
    LINK_ADDRESS_SCHEME_PATTERN.exec(trimmed);

  if (scheme && !ALLOWED_LINK_SCHEMES.has(scheme[1]!.toLowerCase())) {
    return "#";
  }

  return trimmed.replace(
    LINK_ADDRESS_UNSAFE_PATTERN,
    (character: string): string => {
      return LINK_ADDRESS_ENCODINGS[character] || encodeURIComponent(character);
    },
  );
};

type NeutralizeCodeValueFunction = (text: string) => string;

/*
 * A value in a fenced code block: the characters as they are - code is
 * copied out - except that no chat mention and no Slack link is read in it
 * (Slack reads both in code).
 */
const neutralizeCodeValue: NeutralizeCodeValueFunction = (
  text: string,
): string => {
  return neutralizeChatLinkSequences(neutralizeChatControlSequences(text));
};

const FENCE_INFO_UNSAFE_PATTERN: RegExp = /[^A-Za-z0-9_+.#-]/g;
const MERMAID_WORD_PATTERN: RegExp = /mermaid/gi;

type SanitizeFenceInfoValueFunction = (text: string) => string;

// A value in a fence line's language: a language name, never a diagram.
const sanitizeFenceInfoValue: SanitizeFenceInfoValueFunction = (
  text: string,
): string => {
  return text
    .replace(FENCE_INFO_UNSAFE_PATTERN, "")
    .replace(MERMAID_WORD_PATTERN, (word: string): string => {
      return `${WORD_JOINER}${word}`;
    });
};

const TRAILING_BACKSLASHES_PATTERN: RegExp = /\\+$/;

type EndsWithUnpairedBackslashFunction = (text: string) => boolean;

/*
 * Whether the text ends in an odd run of backslashes: the last one would
 * escape whatever a value starts with.
 */
const endsWithUnpairedBackslash: EndsWithUnpairedBackslashFunction = (
  text: string,
): boolean => {
  const run: RegExpExecArray | null = TRAILING_BACKSLASHES_PATTERN.exec(text);

  return Boolean(run && run[0].length % 2 === 1);
};

type RenderValueFunction = (
  value: MarkdownValue,
  placed: PlacedValue,
) => string;

const renderValue: RenderValueFunction = (
  value: MarkdownValue,
  placed: PlacedValue,
): string => {
  if (placed.place === ValuePlace.LinkAddress) {
    return encodeLinkAddress(toText(value));
  }

  if (placed.place === ValuePlace.FenceLine) {
    return sanitizeFenceInfoValue(toText(value));
  }

  if (isMarkdownText(value)) {
    return value.toString();
  }

  const text: string = toText(value);

  switch (placed.place) {
    case ValuePlace.LinkText:
      return escapeLinkTextValue(text);
    case ValuePlace.FencedCode:
      return neutralizeCodeValue(text);
    case ValuePlace.CodeSpan:
      // Written again with the span around it (see renderRun).
      return text;
    default:
      return escapeSentenceValue(text, placed);
  }
};

type RenderRunFunction = (data: {
  run: RewrittenRun;
  original: string;
  reading: TemplateReading;
  values: ReadonlyArray<MarkdownValue>;
  valueIndexAt: Map<number, number>;
}) => string;

/*
 * A code span or a fenced code block with values in it, written again: the
 * span with markdownCodeSpan around everything in it, the block with fences
 * longer than any run of the fence character in it.
 */
const renderRun: RenderRunFunction = (data: {
  run: RewrittenRun;
  original: string;
  reading: TemplateReading;
  values: ReadonlyArray<MarkdownValue>;
  valueIndexAt: Map<number, number>;
}): string => {
  const contentOf: (start: number, end: number) => string = (
    start: number,
    end: number,
  ): string => {
    let content: string = "";

    for (let index: number = start; index < end; index++) {
      const valueIndex: number | undefined = data.valueIndexAt.get(index);

      if (valueIndex === undefined) {
        content += data.original[index]!;
        continue;
      }

      content += renderValue(
        data.values[valueIndex],
        data.reading.places[valueIndex]!,
      );
    }

    return content;
  };

  if (data.run.kind === "CodeSpan") {
    const fence: number = runLength(
      data.reading.text,
      data.run.start,
      data.run.end,
    );

    return markdownCodeSpan(
      contentOf(data.run.start + fence, data.run.end - fence),
    );
  }

  const fence: NonNullable<RewrittenRun["fence"]> = data.run.fence!;
  const opening: string = contentOf(
    fence.openingLineStart,
    fence.openingLineEnd,
  );

  // The lines between the fences: none when the closing fence comes next.
  const bodyStart: number = fence.openingLineEnd + 1;
  const bodyEnd: number =
    fence.closingLineStart === null ? data.run.end : fence.closingLineStart - 1;
  const hasBody: boolean = bodyStart <= bodyEnd && bodyStart <= data.run.end;
  const body: string = hasBody ? contentOf(bodyStart, bodyEnd) : "";

  // The longest run of the fence character that starts a line of the body.
  let longest: number = fence.length;

  for (const bodyLine of body.split("\n")) {
    const match: RegExpExecArray | null = FENCE_LINE_PATTERN.exec(bodyLine);

    if (match && match[2]![0] === fence.character) {
      longest = Math.max(longest, match[2]!.length + 1);
    }
  }

  const newFence: string = fence.character.repeat(longest);
  const openingMatch: RegExpExecArray = FENCE_LINE_PATTERN.exec(opening)!;
  const parts: Array<string> = [
    `${openingMatch[1]}${newFence}${openingMatch[3]}`,
  ];

  if (hasBody) {
    parts.push(body);
  }

  if (fence.closingLineStart !== null && fence.closingLineEnd !== null) {
    const closing: string = contentOf(
      fence.closingLineStart,
      fence.closingLineEnd,
    );
    const closingMatch: RegExpExecArray | null =
      FENCE_LINE_PATTERN.exec(closing);

    parts.push(`${closingMatch ? closingMatch[1] : ""}${newFence}`);
  }

  return parts.join("\n");
};

type RenderTemplateFunction = (
  literals: ReadonlyArray<string>,
  values: ReadonlyArray<MarkdownValue>,
  reading: TemplateReading,
) => string;

const renderTemplate: RenderTemplateFunction = (
  literals: ReadonlyArray<string>,
  values: ReadonlyArray<MarkdownValue>,
  reading: TemplateReading,
): string => {
  /*
   * The template's text as written, with a stand-in where each value goes
   * (an undefined literal joins as nothing, as readTemplate reads it).
   */
  const original: string = literals.join(VALUE_STAND_IN);

  const valueIndexAt: Map<number, number> = new Map<number, number>();

  reading.valuePositions.forEach((position: number, index: number): void => {
    valueIndexAt.set(position, index);
  });

  let output: string = "";
  let index: number = 0;

  while (index < original.length) {
    const run: RewrittenRun | undefined = reading.runsByStart.get(index);

    if (run) {
      output += renderRun({
        run: run,
        original: original,
        reading: reading,
        values: values,
        valueIndexAt: valueIndexAt,
      });
      index = run.end;
      continue;
    }

    const valueIndex: number | undefined = valueIndexAt.get(index);

    if (valueIndex === undefined) {
      output += original[index]!;
      index++;
      continue;
    }

    const placed: PlacedValue = reading.places[valueIndex]!;
    const rendered: string = renderValue(values[valueIndex], placed);

    /*
     * A backslash the template's text ends in would escape what the value
     * starts with - or undo an escape the value starts with. An invisible
     * joiner keeps them apart; the backslash stays the text it was.
     */
    if (
      rendered.length > 0 &&
      placed.place !== ValuePlace.LinkAddress &&
      endsWithUnpairedBackslash(output)
    ) {
      output += WORD_JOINER;
    }

    output += rendered;
    index++;
  }

  return output;
};

// A template's reading, kept for the template: its text never changes.
const READINGS: WeakMap<ReadonlyArray<string>, TemplateReading> = new WeakMap<
  ReadonlyArray<string>,
  TemplateReading
>();

type MdTextFunction = (
  literals: TemplateStringsArray,
  ...values: Array<MarkdownValue>
) => MarkdownText;

/**
 * Markdown, with every value placed as text (a MarkdownText as it is),
 * escaped for where it sits. See the top of this file.
 */
export const mdText: MdTextFunction = (
  literals: TemplateStringsArray,
  ...values: Array<MarkdownValue>
): MarkdownText => {
  let reading: TemplateReading | undefined = READINGS.get(literals);

  if (!reading) {
    reading = readTemplate(literals);
    READINGS.set(literals, reading);
  }

  return makeMarkdownText(renderTemplate(literals, values, reading));
};

type RenderUncachedFunction = (
  literals: ReadonlyArray<string>,
  values: ReadonlyArray<MarkdownValue>,
) => MarkdownText;

// As mdText, for literals made at run time (a join's separators).
const renderUncached: RenderUncachedFunction = (
  literals: ReadonlyArray<string>,
  values: ReadonlyArray<MarkdownValue>,
): MarkdownText => {
  return makeMarkdownText(
    renderTemplate(literals, values, readTemplate(literals)),
  );
};

export interface BulletListOptions {
  // The only bullet when there are no items, as text: "(no named labels)".
  whenEmpty?: string | undefined;
}

export default class FeedMarkdown {
  /**
   * A value as inline code, exactly as written (markdownCodeSpan): a backtick
   * in it cannot close the span, and no mention or Slack link is read in it.
   * Empty for an empty value.
   */
  public static code(value: MarkdownValue): MarkdownText {
    return makeMarkdownText(markdownCodeSpan(toText(value)));
  }

  /**
   * The items one after another with the separator - plain text between
   * them, ", " by default - each placed as `mdText` places a value.
   */
  public static join(
    items: ReadonlyArray<MarkdownValue>,
    separator: string = ", ",
  ): MarkdownText {
    if (items.length === 0) {
      return makeMarkdownText("");
    }

    const literals: Array<string> = [""];

    for (let index: number = 1; index < items.length; index++) {
      literals.push(separator);
    }

    literals.push("");

    return renderUncached(literals, items);
  }

  /**
   * One "- item" line per item, or a single `whenEmpty` bullet when there are
   * none (nothing when it is not given). No line break before the first.
   */
  public static bulletList(
    items: ReadonlyArray<MarkdownValue>,
    options?: BulletListOptions | undefined,
  ): MarkdownText {
    const bullets: ReadonlyArray<MarkdownValue> =
      items.length > 0
        ? items
        : options?.whenEmpty !== undefined
          ? [options.whenEmpty]
          : [];

    if (bullets.length === 0) {
      return makeMarkdownText("");
    }

    const literals: Array<string> = ["- "];

    for (let index: number = 1; index < bullets.length; index++) {
      literals.push("\n- ");
    }

    literals.push("");

    return renderUncached(literals, bullets);
  }

  // A link: [label](address), the label as text, the address encoded.
  public static link(
    label: MarkdownValue,
    address: MarkdownValue,
  ): MarkdownText {
    return mdText`[${label}](${address})`;
  }

  /**
   * Text that IS Markdown, placed as it was written: a description or a note
   * somebody wrote, or Markdown OneUptime built elsewhere. Never a name or a
   * title - those are text, placed into `mdText` as they are.
   */
  public static asMarkdown(markdown: string | null | undefined): MarkdownText {
    return makeMarkdownText(markdown || "");
  }

  /**
   * Markdown OneUptime AI wrote: it stays Markdown, with nothing in it that
   * acts on its own (neutralizeAiWrittenMarkdown).
   */
  public static aiWritten(markdown: string | null | undefined): MarkdownText {
    return makeMarkdownText(neutralizeAiWrittenMarkdown(markdown));
  }

  /**
   * Markdown somebody outside OneUptime wrote - an incident form's reporter:
   * no image, diagram or mention in it acts (neutralizeUntrustedMarkdown).
   */
  public static writtenOutside(
    markdown: string | null | undefined,
  ): MarkdownText {
    return makeMarkdownText(neutralizeUntrustedMarkdown(markdown));
  }

  /**
   * Plain text that spans lines - a long text answer - escaped as a sentence
   * is, line by line, with its line breaks kept.
   */
  public static multilineText(text: string | null | undefined): MarkdownText {
    const lines: Array<string> = toText(text).split(/\r\n|\r|\n/);
    const literals: Array<string> = [""];

    for (let index: number = 1; index < lines.length; index++) {
      literals.push("\n");
    }

    literals.push("");

    return renderUncached(literals, lines);
  }

  /**
   * Plain text for a Markdown template a person wrote - {{incidentTitle}} in
   * a status page's Slack message, a note template's {{monitorName}}:
   * escaped (escapeMarkdownValue), so wherever the template places it, it
   * reads as typed and is no link, image, HTML or chat mention. Line breaks
   * become spaces unless `keepLineBreaks` is set (a long text answer). A
   * string: the template engine puts it in place.
   */
  public static templateText(
    text: string | null | undefined,
    options?: { keepLineBreaks?: boolean | undefined } | undefined,
  ): string {
    return escapeMarkdownValue(text, options);
  }

  /**
   * A value a monitored system reported, or text a stranger typed, for
   * Markdown somebody else puts together - a description template's
   * {{responseBody.message}}, a form answer stored as an incident's title.
   * Wherever it lands, inside the author's code span or fence too, it reads
   * as reported and nothing in it acts (neutralizeUntrustedValue): the
   * breaks it gets are invisible. A string.
   */
  public static reportedValue(value: string | null | undefined): string {
    return neutralizeUntrustedValue(value);
  }

  /**
   * Text whose chat mentions are broken, invisibly, and nothing else - a
   * form's text answer stored for a custom field (neutralizeChatControlSequences).
   * A string.
   */
  public static withoutChatSequences(text: string | null | undefined): string {
    return neutralizeChatControlSequences(text || "");
  }

  // Nothing: a MarkdownText to build on.
  public static empty(): MarkdownText {
    return makeMarkdownText("");
  }

  public static isMarkdownText(value: unknown): value is MarkdownText {
    return isMarkdownText(value);
  }
}
