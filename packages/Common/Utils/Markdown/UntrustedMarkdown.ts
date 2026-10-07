import {
  WORD_JOINER,
  escapeMarkdownInline,
  neutralizeChatControlSequences,
} from "./MarkdownEscape";
import { Lexer, Token, Tokens } from "marked";

/*
 * MARKDOWN WRITTEN BY SOMEBODY OUTSIDE - an incident form's reporter, who
 * needs no account, only the form's link - made safe to store as an
 * incident's own text.
 *
 * Nobody reads such text over before it is posted: the incident's title and
 * description go straight into its "Incident Created" feed item, which is
 * posted to the project's Slack and Microsoft Teams channels, and the
 * description and Markdown custom field answers are rendered for every
 * responder who opens the incident (the dashboard renders incident text
 * without the viewer's safe mode) and in the owners' and on-call emails.
 * Three things in it act on their own there, before anybody decides to
 * click anything:
 *
 *   - CHAT CONTROL SEQUENCES. Slack reads <!channel>, <!here>, <!everyone>,
 *     <!subteam^ID>, <@U123> and <#C123> in a bot's message as mentions, so
 *     a stranger could make OneUptime's bot notify a whole channel.
 *     neutralizeChatControlSequences puts an invisible word joiner (U+2060)
 *     between the "<" and the "!", "@" or "#": the text reads as typed, but
 *     is no longer a sequence Slack (or slackify, which then escapes the
 *     lone "<") recognises. It is applied everywhere in the text, code
 *     included: slackify passes code through untouched, so a mention inside
 *     a code span would reach Slack as it is. Only what Slack acts on is
 *     broken - "<!" and a word, "<@" or "<#" and an id - so an HTML comment
 *     (<!--), CDATA, a <!DOCTYPE html> or a PowerShell "<# ... #>" pasted
 *     into a report is stored exactly as typed.
 *
 *   - IMAGES. ![alt](https://tracker.example/p.png) is fetched from the
 *     outsider's server by every responder's browser and mail client that
 *     shows the incident: a zero-click beacon of who looked, when, and from
 *     where. Each image becomes a plain link to the same address, so nothing
 *     is fetched until somebody chooses to follow it: the "!" is escaped,
 *     which is the one change that turns an image into a link without
 *     rewriting anything else, and an image with no alt text is given its
 *     address as the link's text, so the link is not an empty, invisible
 *     one. Reference-style images (![alt][ref], ![ref]) are covered: they
 *     start with the same "![".
 *
 *   - MERMAID DIAGRAMS. A ```mermaid fence is rendered as a diagram, which
 *     runs mermaid's renderer (and can load images) in the responder's
 *     browser. Its language becomes "text", so it shows as the code the
 *     reporter typed.
 *
 * WHAT MAKES IT SAFE DOES NOT DEPEND ON HOW ANY ONE RENDERER READS THE TEXT.
 * The same text is read by marked (the emails), by remark with its GitHub
 * extensions, footnotes included (the dashboard), and by slackify, and they
 * do not agree on everything. "[a]: https://a.example" followed by an
 * indented "![x](...)" line, or a footnote's indented paragraph, is an
 * indented code block to marked and a paragraph - with a live image - to
 * the dashboard; a footnote definition is no more than a link definition to
 * marked. So the guarantee is made on the characters, where every renderer
 * agrees:
 *
 *   - Nothing is an image unless it starts with "![" (an entity is only
 *     text, and raw HTML is shown as text in the dashboard and escaped in
 *     the emails). Every "![" whose "!" is not already escaped, and which
 *     something after it could complete - a "](" or "][" before its
 *     paragraph can end at a blank line, or, anywhere in the text, a line
 *     that could define a link reference ("[label]:" after nothing but
 *     indentation, block quote and list markers, a task list item's box or
 *     a footnote's label) - is broken:
 *     a backslash goes before the "!", or an invisible word joiner between
 *     the "!" and the "[". Either way no renderer finds an image there.
 *     The one exception is fenced code that every renderer reads as such
 *     (see findTrustedCode): no renderer finds an image in it, so it is
 *     left byte for byte.
 *   - The dashboard draws a diagram only for a fenced code block whose
 *     language is "mermaid" - and CommonMark decodes character references
 *     in a fence's info string, so ```&#109;ermaid is one too. After the
 *     first fence run of every line, every "mermaid" in the info string as
 *     the dashboard decodes it is broken: a real fence's language is
 *     renamed "text", and any other "mermaid" gets a word joiner before it,
 *     so no language reads "mermaid" and no class reads "language-mermaid".
 *
 * A real Markdown lexer (marked) only decides which of those the text gets,
 * so that it still reads as typed: an image it finds gets the backslash (and
 * its address as link text when it had no alt text); a "![" inside what it
 * reads as a code span, a code block or raw HTML - where a backslash would
 * show - gets the invisible joiner; any other "![" gets the backslash, which
 * every renderer turns back into the "!" as typed, in a link's address too.
 * A mermaid fence it finds is renamed; any other "mermaid" after a fence run
 * gets the joiner. The joiner cannot be seen, but it is a character: a copy
 * of the text keeps it. Code with no image syntax that could be completed -
 * "Wow![sic]", Rust's vec![1, 2] in a paragraph of its own, anything inside
 * a fenced block every renderer reads as code - is left byte for byte.
 *
 * The lexer does not say where in the text a token came from, so every place
 * to change is first tagged with a numbered marker the lexer passes through
 * untouched (private use characters, inert to Markdown); a marker that ends
 * up right before an image token, inside a code span, a code block or HTML,
 * or at the start of a code block's language, says what that place is.
 *
 * THE LEXER ONLY READS SHORT TEXT. marked takes time that grows with the
 * square of the text on some shapes - emphasis next to image syntax, a long
 * run of unclosed emphasis - and a description may be 20000 characters of
 * them: seconds of one process's CPU, from anyone holding a form's link.
 * Everything else here is linear, and the lexer is used only for a text of
 * at most LEXED_TEXT_MAX_LENGTH characters. A longer one, or one the lexer
 * fails on, is decided without it (findWithoutLexing): a "![" on an
 * indented line or inside a code span of its own line gets the joiner, any
 * other the backslash - and an image with no alt text still gets its
 * address as link text when its address can be read on its line - while
 * only a fence every renderer reads as one is renamed "text"; every other
 * "mermaid" gets the joiner. Just as safe, and a little less tidy where a
 * backslash lands in code.
 *
 * Links are left alone: a reporter linking the page that is broken is the
 * point of a report, and a link does nothing until somebody clicks it.
 *
 * Pure, with no database or React imports.
 */

/*
 * neutralizeChatControlSequences lives with the Markdown escapers
 * (MarkdownEscape), which break chat control sequences too: a title or a name
 * placed into a feed item or a chat message is posted to Slack as well. It is
 * exported from here as before.
 */
export {
  neutralizeChatControlSequences,
  type NeutralizeChatControlSequencesFunction,
} from "./MarkdownEscape";

/*
 * Private use characters, which nobody types and Markdown treats as plain
 * text: MARKER_START, a number and MARKER_END tag one place in the probe.
 * A marker only steers which change a place gets, never whether it gets
 * one, so a reporter who does type these characters decides nothing.
 */
const MARKER_START: string = "\uE000";
const MARKER_END: string = "\uE001";
const MARKER_PATTERN: RegExp = /\uE000(\d+)\uE001/g;
const MARKER_AT_END_PATTERN: RegExp = /\uE000(\d+)\uE001$/;
const MARKER_AT_START_PATTERN: RegExp = /^\uE000(\d+)\uE001/;

/*
 * The longest text the lexer is given (see "THE LEXER ONLY READS SHORT
 * TEXT" above). The worst shapes found take about 20 milliseconds at this
 * length, four times that at twice it, and seconds at the 20000 characters
 * a description may have.
 */
export const LEXED_TEXT_MAX_LENGTH: number = 1000;

/*
 * A fence run: three or more backticks or tildes. The first one in a line
 * is where a fenced code block's info string could begin, whatever comes
 * before it - a block quote or a list item's marker, indentation, or text
 * no renderer reads as a fence at all (which is only broken for nothing).
 */
const FENCE_RUN_PATTERN: RegExp = /`{3,}|~{3,}/;

// A fence run at the very start of a line, and the info string after it.
const OPENING_FENCE_PATTERN: RegExp = /^(?:(`{3,})[^`]*|(~{3,}).*)$/;

// The spaces or tabs between a fence run and its info string.
const FENCE_INFO_INDENT_PATTERN: RegExp = /^[ \t]*/;

/*
 * Raw HTML that starts a block which blank lines do not end (CommonMark's
 * HTML blocks 1 to 5: <script>, <pre>, <style> and <textarea>, comments,
 * processing instructions, declarations and CDATA) - anywhere in a line, to
 * be sure of catching every one.
 */
const RAW_HTML_BLOCK_START_PATTERN: RegExp =
  /<(?:[!?]|script|pre|style|textarea)/i;

const BLANK_LINE_TEXT_PATTERN: RegExp = /^[ \t]*$/;

// What marked allows after a closing fence's run: backticks, tildes, spaces.
const MARKED_CLOSING_FENCE_REST_PATTERN: RegExp = /^[~`]* *$/;

const MERMAID: string = "mermaid";
const DEMOTED_LANGUAGE: string = "text";

/*
 * A numeric character reference - decimal or hexadecimal - as CommonMark
 * decodes one in a fence's info string: ```&#109;ermaid is a mermaid fence
 * to the dashboard. More digits are allowed than CommonMark allows, so a
 * reference no renderer decodes can only be broken for nothing. Nothing
 * else needs decoding to find every "mermaid": a named reference never
 * stands for a letter of the English alphabet, and a backslash escape only
 * ever stands for punctuation (reading "\&#109;" as a reference anyway only
 * breaks what was never a diagram).
 */
const NUMERIC_CHARACTER_REFERENCE_PATTERN: RegExp =
  /^&#(?:[xX]([0-9a-fA-F]{1,32})|([0-9]{1,32}));/;
const NUMERIC_CHARACTER_REFERENCE_MAX_LENGTH: number = 36;
const REPLACEMENT_CHARACTER: string = "\uFFFD";

/*
 * What can complete an image after its "![": a closing bracket followed by
 * an address, "](", or by a reference label, "][" - with spaces or tabs
 * allowed between, although no renderer here allows them. None can reach
 * past a blank line, where every paragraph ends; and a link reference
 * definition anywhere in the text could complete any "![label]".
 */
const IMAGE_COMPLETION_PATTERN: RegExp = /\][ \t]*[([]/g;
const BLANK_LINE_PATTERN: RegExp = /\n[ \t]*(?=\n|$)/g;

/*
 * What may come before a link reference definition's "[" on its line:
 * indentation; the markers of block quotes and list items; a task list
 * item's box, which marked takes off "- [ ] [a]: https://..." before it
 * reads the rest as the item's own blocks; footnote definitions (a
 * footnote's content, "[^1]: [a]: https://...", may itself start with
 * one); and a byte order mark, which the dashboard's parser skips at the
 * start of the text. A "]:" anywhere else - a Python slice, a TypeScript
 * index signature after code, "sshd[1]:" in a log - defines nothing.
 */
const REFERENCE_DEFINITION_PREFIX_PATTERN: RegExp =
  /^(?:[ \t>*+\-.)0-9\uFEFF]|\[[^\]\n]\][ \t]*|\[\^[^\]\n]*\]:)*/;

// An image link's text, when the image had no alt text: its address.
const IMAGE_LINK_LABEL_MAX_LENGTH: number = 80;
const IMAGE_LINK_FALLBACK_LABEL: string = "image";

/*
 * How far past "![](" the address of an image with no alt text is looked
 * for when the lexer does not read the text: an address this long is
 * rare, and the link then simply keeps the text it had.
 */
const IMAGE_ADDRESS_SCAN_MAX_LENGTH: number = 2048;

// A backslash before ASCII punctuation, which marked drops from an address.
const ESCAPED_PUNCTUATION_PATTERN: RegExp = /\\([!-/:-@[-`{-~])/g;

// A line that could be an indented code block's.
const INDENTED_LINE_PATTERN: RegExp = /^(?: {4}|\t)/;

const BACKTICK_RUN_PATTERN: RegExp = /`+/g;

const IMAGE_OPENER_PATTERN: RegExp = /!(?=\[)/g;

// A "]" that a link, a reference or a link definition goes on from.
const LINK_TAIL_OPENER_PATTERN: RegExp = /\](?=[([:])/g;

enum CandidateKind {
  Image = "image",
  Mermaid = "mermaid",
}

/*
 * The info string after the first fence run of a line, when "mermaid" is in
 * it as the dashboard decodes it.
 */
interface DiagramInfoString {
  // Where it starts: after the fence run and any spaces or tabs.
  start: number;
  // Where its first word - the language - ends.
  languageEnd: number;
  // Where each "mermaid" in it starts, a reference counting from its "&".
  mermaidWords: Array<number>;
}

interface Candidate {
  kind: CandidateKind;
  /*
   * In the line-ending normalised text: where the "![" starts, or where
   * the info string of a diagram candidate starts.
   */
  position: number;
  info?: DiagramInfoString | undefined;
}

interface Edit {
  position: number;
  deleteCount: number;
  insert: string;
}

/*
 * The fenced code that every renderer reads as fenced code (see
 * findTrustedCode).
 */
interface TrustedCode {
  // Each run of its lines, as [start, end) offsets, in order.
  ranges: Array<[number, number]>;
  // Where the info string of each such fence's opening line starts.
  openingInfoStarts: Set<number>;
}

interface Line {
  start: number;
  // Where it ends, before its "\n".
  end: number;
}

type SplitLinesFunction = (source: string) => Array<Line>;

const splitLines: SplitLinesFunction = (source: string): Array<Line> => {
  const lines: Array<Line> = [];
  let start: number = 0;

  for (;;) {
    const newline: number = source.indexOf("\n", start);

    if (newline === -1) {
      lines.push({ start: start, end: source.length });
      return lines;
    }

    lines.push({ start: start, end: newline });
    start = newline + 1;
  }
};

type IsEscapedFunction = (source: string, position: number) => boolean;

// Whether an odd number of backslashes comes right before this character.
const isEscaped: IsEscapedFunction = (
  source: string,
  position: number,
): boolean => {
  let backslashes: number = 0;

  while (
    position - backslashes - 1 >= 0 &&
    source[position - backslashes - 1] === "\\"
  ) {
    backslashes++;
  }

  return backslashes % 2 !== 0;
};

type IsInTrustedCodeFunction = (code: TrustedCode, position: number) => boolean;

const isInTrustedCode: IsInTrustedCodeFunction = (
  code: TrustedCode,
  position: number,
): boolean => {
  let low: number = 0;
  let high: number = code.ranges.length - 1;

  while (low <= high) {
    const middle: number = (low + high) >> 1;
    const range: [number, number] = code.ranges[middle]!;

    if (position < range[0]) {
      high = middle - 1;
    } else if (position >= range[1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
};

type ReadClosingFenceFunction = (
  line: string,
  run: string,
) => { byCommonMark: boolean; byMarked: boolean };

/*
 * Whether a line closes a fence opened with this run, as CommonMark reads it
 * (up to three spaces, at least as long a run of the same character, then
 * only spaces or tabs) and as marked does (up to three spaces, the same run,
 * then any backticks or tildes and spaces).
 */
const readClosingFence: ReadClosingFenceFunction = (
  line: string,
  run: string,
): { byCommonMark: boolean; byMarked: boolean } => {
  let indent: number = 0;

  while (indent < line.length && line[indent] === " ") {
    indent++;
  }

  if (indent > 3) {
    return { byCommonMark: false, byMarked: false };
  }

  let end: number = indent;

  while (end < line.length && line[end] === run[0]) {
    end++;
  }

  return {
    byCommonMark:
      end - indent >= run.length &&
      BLANK_LINE_TEXT_PATTERN.test(line.slice(end)),
    byMarked:
      line.startsWith(run, indent) &&
      MARKED_CLOSING_FENCE_REST_PATTERN.test(line.slice(indent + run.length)),
  };
};

type FindTrustedCodeFunction = (
  source: string,
  lines: Array<Line>,
) => TrustedCode;

/*
 * The fenced code blocks that every renderer here reads as fenced code, and
 * so as nothing but code: no image and no diagram can be in them.
 *
 * Trusted only as far as this can be sure of: a fence opened at the very
 * start of a line (no indentation, no container) that follows a blank line,
 * the start of the text or the close of another such fence. Nothing else
 * can hold that line - a block quote, a list item or a footnote needs its
 * marker or its indentation on it, and an HTML block of the kinds a blank
 * line ends is over - except a fence or an HTML block that blank lines do
 * not end. So trust stops for good at the first line outside such a fence
 * that holds a fence run anywhere, or the start of such an HTML block
 * anywhere, and at the first line that closes a fence for one renderer but
 * not the other (marked closes "```" with "```~", CommonMark with
 * "```\t"): after it, the renderers could pair the fences that follow
 * differently.
 */
const findTrustedCode: FindTrustedCodeFunction = (
  source: string,
  lines: Array<Line>,
): TrustedCode => {
  const code: TrustedCode = {
    ranges: [],
    openingInfoStarts: new Set<number>(),
  };

  let isTrusting: boolean = true;
  // The line before was blank, closed a trusted fence, or there was none.
  let mayOpen: boolean = true;
  // The run the trusted fence the scan is in was opened with.
  let openRun: string | null = null;

  for (const line of lines) {
    const text: string = source.slice(line.start, line.end);

    if (openRun !== null) {
      const closing: { byCommonMark: boolean; byMarked: boolean } =
        readClosingFence(text, openRun);

      if (closing.byCommonMark || closing.byMarked) {
        openRun = null;
        mayOpen = true;
        isTrusting = closing.byCommonMark && closing.byMarked;
        continue;
      }

      const previous: [number, number] | undefined =
        code.ranges[code.ranges.length - 1];

      if (previous && previous[1] + 1 === line.start) {
        previous[1] = line.end;
      } else {
        code.ranges.push([line.start, line.end]);
      }

      continue;
    }

    const opening: RegExpExecArray | null =
      isTrusting && mayOpen ? OPENING_FENCE_PATTERN.exec(text) : null;

    if (opening) {
      openRun = (opening[1] || opening[2])!;

      code.openingInfoStarts.add(
        line.start +
          openRun.length +
          FENCE_INFO_INDENT_PATTERN.exec(text.slice(openRun.length))![0].length,
      );

      continue;
    }

    if (
      FENCE_RUN_PATTERN.test(text) ||
      RAW_HTML_BLOCK_START_PATTERN.test(text)
    ) {
      isTrusting = false;
    }

    mayOpen = BLANK_LINE_TEXT_PATTERN.test(text);
  }

  return code;
};

type HasPossibleReferenceDefinitionFunction = (data: {
  source: string;
  lines: Array<Line>;
  code: TrustedCode;
}) => boolean;

/*
 * Whether any renderer could read a link reference definition in the text,
 * which would complete any "![label]" in it however far away: a "[label]:"
 * outside trusted code whose "[" has nothing but REFERENCE_DEFINITION_PREFIX
 * before it on its line. Generous on purpose - it does not check what
 * follows the colon, or that the line may start a block at all.
 */
const hasPossibleReferenceDefinition: HasPossibleReferenceDefinitionFunction =
  (data: {
    source: string;
    lines: Array<Line>;
    code: TrustedCode;
  }): boolean => {
    const source: string = data.source;

    /*
     * The line the last "[" was on, and where what may come before a
     * definition ends on it. Each "[" is after the one before (see below),
     * so both only move forward.
     */
    let lineIndex: number = 0;
    let prefixEndLine: number = -1;
    let prefixEnd: number = 0;

    for (
      let colon: number = source.indexOf("]:");
      colon !== -1;
      colon = source.indexOf("]:", colon + 1)
    ) {
      if (isEscaped(source, colon)) {
        continue;
      }

      /*
       * The label's "[": the nearest bracket before, as a label cannot hold
       * one that is not escaped. Each search stops at the "]" of the one
       * before it at the latest, so together they read the text once.
       */
      let open: number = colon - 1;

      while (
        open >= 0 &&
        !(
          (source[open] === "[" || source[open] === "]") &&
          !isEscaped(source, open)
        )
      ) {
        open--;
      }

      if (
        open < 0 ||
        source[open] !== "[" ||
        isInTrustedCode(data.code, open)
      ) {
        continue;
      }

      while (data.lines[lineIndex]!.end < open) {
        lineIndex++;
      }

      if (prefixEndLine !== lineIndex) {
        const line: Line = data.lines[lineIndex]!;

        prefixEnd =
          line.start +
          REFERENCE_DEFINITION_PREFIX_PATTERN.exec(
            source.slice(line.start, line.end),
          )![0].length;
        prefixEndLine = lineIndex;
      }

      if (open <= prefixEnd) {
        return true;
      }
    }

    return false;
  };

type FindMermaidWordsFunction = (
  source: string,
  start: number,
  end: number,
) => Array<number>;

/*
 * Where each "mermaid" in source[start, end) starts, read as the dashboard
 * reads an info string - with numeric character references decoded, and
 * any letter case. One right after a word joiner is already broken.
 */
const findMermaidWords: FindMermaidWordsFunction = (
  source: string,
  start: number,
  end: number,
): Array<number> => {
  // The decoded characters, and where in the source each one starts.
  const characters: Array<string> = [];
  const starts: Array<number> = [];

  let position: number = start;

  while (position < end) {
    const reference: RegExpExecArray | null =
      source[position] === "&"
        ? NUMERIC_CHARACTER_REFERENCE_PATTERN.exec(
            source.slice(
              position,
              Math.min(end, position + NUMERIC_CHARACTER_REFERENCE_MAX_LENGTH),
            ),
          )
        : null;

    if (reference) {
      const codePoint: number = reference[1]
        ? parseInt(reference[1], 16)
        : parseInt(reference[2]!, 10);

      characters.push(
        codePoint > 0 &&
          codePoint <= 0x10ffff &&
          !(codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? String.fromCodePoint(codePoint)
          : REPLACEMENT_CHARACTER,
      );
      starts.push(position);
      position += reference[0].length;
      continue;
    }

    characters.push(source[position]!);
    starts.push(position);
    position++;
  }

  const words: Array<number> = [];

  for (let index: number = 0; index + MERMAID.length <= characters.length; ) {
    let length: number = 0;

    while (
      length < MERMAID.length &&
      characters[index + length]!.toLowerCase() === MERMAID[length]
    ) {
      length++;
    }

    if (length < MERMAID.length) {
      index++;
      continue;
    }

    if (index === 0 || characters[index - 1] !== WORD_JOINER) {
      words.push(starts[index]!);
    }

    index += MERMAID.length;
  }

  return words;
};

type FindDiagramInfoStringsFunction = (
  source: string,
  lines: Array<Line>,
) => Array<DiagramInfoString>;

/*
 * Every info string with "mermaid" in it, as the dashboard decodes it: the
 * rest of each line after its first fence run - wherever the run is, as no
 * container before it is trusted to keep it from being a fence.
 */
const findDiagramInfoStrings: FindDiagramInfoStringsFunction = (
  source: string,
  lines: Array<Line>,
): Array<DiagramInfoString> => {
  const infoStrings: Array<DiagramInfoString> = [];

  for (const line of lines) {
    const text: string = source.slice(line.start, line.end);
    const run: RegExpExecArray | null = FENCE_RUN_PATTERN.exec(text);

    if (!run) {
      continue;
    }

    const afterRun: number = run.index + run[0].length;
    const start: number =
      line.start +
      afterRun +
      FENCE_INFO_INDENT_PATTERN.exec(text.slice(afterRun))![0].length;

    const mermaidWords: Array<number> = findMermaidWords(
      source,
      start,
      line.end,
    );

    if (mermaidWords.length === 0) {
      continue;
    }

    let languageEnd: number = start;

    while (
      languageEnd < line.end &&
      source[languageEnd] !== " " &&
      source[languageEnd] !== "\t"
    ) {
      languageEnd++;
    }

    infoStrings.push({
      start: start,
      languageEnd: languageEnd,
      mermaidWords: mermaidWords,
    });
  }

  return infoStrings;
};

type LexFunction = (markdown: string) => Array<Token>;

/*
 * The options marked's own parse uses by default (GitHub flavoured, no
 * line-break extension), given afresh each time: the lexer writes into the
 * options object it is handed, and must not see what another caller set up
 * with marked.use().
 */
const lex: LexFunction = (markdown: string): Array<Token> => {
  return new Lexer({ gfm: true, breaks: false, pedantic: false }).lex(markdown);
};

type GetChildTokensFunction = (token: Token) => Array<Token>;

const getChildTokens: GetChildTokensFunction = (token: Token): Array<Token> => {
  if (token.type === "list") {
    return (token as Tokens.List).items;
  }

  if (token.type === "table") {
    const table: Tokens.Table = token as Tokens.Table;
    const cells: Array<Tokens.TableCell> = [...table.header];

    for (const row of table.rows) {
      cells.push(...row);
    }

    return cells.flatMap((cell: Tokens.TableCell): Array<Token> => {
      return cell.tokens || [];
    });
  }

  const nested: unknown = (token as { tokens?: unknown }).tokens;

  return Array.isArray(nested) ? (nested as Array<Token>) : [];
};

type WalkTokensFunction = (
  tokens: Array<Token>,
  visit: (token: Token, isLeaf: boolean) => void,
) => void;

// Every token, depth first, in the order its text appears.
const walkTokens: WalkTokensFunction = (
  tokens: Array<Token>,
  visit: (token: Token, isLeaf: boolean) => void,
): void => {
  for (const token of tokens) {
    const children: Array<Token> = getChildTokens(token);

    visit(token, children.length === 0);
    walkTokens(children, visit);
  }
};

type GetMatchPositionsFunction = (
  source: string,
  pattern: RegExp,
) => Array<number>;

// Where each match of a global pattern starts, in order.
const getMatchPositions: GetMatchPositionsFunction = (
  source: string,
  pattern: RegExp,
): Array<number> => {
  const positions: Array<number> = [];

  for (const match of source.matchAll(pattern)) {
    positions.push(match.index || 0);
  }

  return positions;
};

type FindCandidatesFunction = (data: {
  source: string;
  lines: Array<Line>;
  code: TrustedCode;
}) => Array<Candidate>;

/*
 * Every place to change, in order: each "![" that could open an image - its
 * "!" not escaped (an even number of backslashes before it), not in trusted
 * code, and something after it that could complete one (see
 * IMAGE_COMPLETION_PATTERN) - and each info string with "mermaid" in it.
 */
const findCandidates: FindCandidatesFunction = (data: {
  source: string;
  lines: Array<Line>;
  code: TrustedCode;
}): Array<Candidate> => {
  const source: string = data.source;
  const candidates: Array<Candidate> = [];

  const mayHaveDefinition: boolean = hasPossibleReferenceDefinition(data);
  const completions: Array<number> = getMatchPositions(
    source,
    IMAGE_COMPLETION_PATTERN,
  );
  const paragraphEnds: Array<number> = [
    ...getMatchPositions(source, BLANK_LINE_PATTERN),
    source.length,
  ];

  // Both only move forward, as the openers do.
  let nextCompletion: number = 0;
  let nextParagraphEnd: number = 0;

  for (
    let position: number = source.indexOf("![");
    position !== -1;
    position = source.indexOf("![", position + 1)
  ) {
    if (isEscaped(source, position) || isInTrustedCode(data.code, position)) {
      continue;
    }

    while (
      nextCompletion < completions.length &&
      completions[nextCompletion]! <= position
    ) {
      nextCompletion++;
    }

    while (paragraphEnds[nextParagraphEnd]! <= position) {
      nextParagraphEnd++;
    }

    const isCompletable: boolean =
      mayHaveDefinition ||
      (nextCompletion < completions.length &&
        completions[nextCompletion]! < paragraphEnds[nextParagraphEnd]!);

    if (isCompletable) {
      candidates.push({ kind: CandidateKind.Image, position: position });
    }
  }

  for (const info of findDiagramInfoStrings(source, data.lines)) {
    candidates.push({
      kind: CandidateKind.Mermaid,
      position: info.start,
      info: info,
    });
  }

  /*
   * A diagram candidate before an image one at the same place, so the
   * lexer reads its marker first at the start of a code block's language.
   */
  return candidates.sort((a: Candidate, b: Candidate): number => {
    return (
      a.position - b.position ||
      Number(a.kind === CandidateKind.Image) -
        Number(b.kind === CandidateKind.Image)
    );
  });
};

interface FoundInText {
  // By candidate index: the images found, with the address of each.
  images: Map<number, string>;
  // The candidates in a code span, a code block or raw HTML.
  literal: Set<number>;
  // The candidates that begin a code block's language.
  diagrams: Set<number>;
}

type FindInProbeFunction = (
  source: string,
  candidates: Array<Candidate>,
) => FoundInText;

/*
 * What the lexer makes of each candidate place: the text is lexed with
 * every one of them tagged by its number.
 */
const findInProbe: FindInProbeFunction = (
  source: string,
  candidates: Array<Candidate>,
): FoundInText => {
  const parts: Array<string> = [];
  let cursor: number = 0;

  candidates.forEach((candidate: Candidate, index: number): void => {
    parts.push(
      source.slice(cursor, candidate.position),
      `${MARKER_START}${index}${MARKER_END}`,
    );
    cursor = candidate.position;
  });

  parts.push(source.slice(cursor));

  const found: FoundInText = {
    images: new Map<number, string>(),
    literal: new Set<number>(),
    diagrams: new Set<number>(),
  };

  const markLiteral: (text: string | undefined) => void = (
    text: string | undefined,
  ): void => {
    for (const marker of (text || "").matchAll(MARKER_PATTERN)) {
      found.literal.add(Number(marker[1]));
    }
  };

  let previousLeafRaw: string = "";

  walkTokens(lex(parts.join("")), (token: Token, isLeaf: boolean): void => {
    if (token.type === "image") {
      /*
       * The marker sits right before the "!", so it ends the text the
       * lexer read just before this image.
       */
      const marker: RegExpExecArray | null =
        MARKER_AT_END_PATTERN.exec(previousLeafRaw);

      if (marker) {
        found.images.set(Number(marker[1]), (token as Tokens.Image).href);
      }
    }

    if (token.type === "code") {
      const code: Tokens.Code = token as Tokens.Code;

      const marker: RegExpExecArray | null = MARKER_AT_START_PATTERN.exec(
        (code.lang || "").trim(),
      );

      if (marker) {
        found.diagrams.add(Number(marker[1]));
      }

      // The block's content, not its info string.
      markLiteral(code.text);
    }

    if (token.type === "codespan" || token.type === "html") {
      markLiteral(token.raw);
    }

    if (isLeaf) {
      previousLeafRaw = token.raw || "";
    }
  });

  return found;
};

type GetLineCodeSpansFunction = (
  source: string,
  line: Line,
) => Array<[number, number]>;

/*
 * The code spans of one line, as [start, end) offsets: a backtick run
 * opens one that the next run of the same length on the line closes, as
 * CommonMark pairs them. (A span that goes on to another line is not seen.)
 */
const getLineCodeSpans: GetLineCodeSpansFunction = (
  source: string,
  line: Line,
): Array<[number, number]> => {
  const runs: Array<RegExpMatchArray> = Array.from(
    source.slice(line.start, line.end).matchAll(BACKTICK_RUN_PATTERN),
  );

  // For each run, the next run of the same length, found from the end.
  const nextOfSameLength: Array<number> = [];
  const lastByLength: Map<number, number> = new Map<number, number>();

  for (let index: number = runs.length - 1; index >= 0; index--) {
    const length: number = runs[index]![0].length;

    nextOfSameLength[index] = lastByLength.get(length) ?? -1;
    lastByLength.set(length, index);
  }

  const spans: Array<[number, number]> = [];

  for (let index: number = 0; index < runs.length; ) {
    const closer: number = nextOfSameLength[index]!;

    if (closer === -1) {
      index++;
      continue;
    }

    spans.push([
      line.start + (runs[index]!.index || 0),
      line.start + (runs[closer]!.index || 0) + runs[closer]![0].length,
    ]);
    index = closer + 1;
  }

  return spans;
};

type ReadImageAddressFunction = (
  source: string,
  start: number,
  limit: number,
) => string | null;

/*
 * The address of an image whose "![](" ends at start, read no further than
 * limit: "<...>" or a run without spaces (its parentheses balanced), then
 * an optional title, then ")". Null when that cannot be read before limit -
 * the image then simply gets no link text of its own.
 */
const readImageAddress: ReadImageAddressFunction = (
  source: string,
  start: number,
  limit: number,
): string | null => {
  let position: number = start;

  const skipSpaces: () => void = (): void => {
    while (
      position < limit &&
      (source[position] === " " || source[position] === "\t")
    ) {
      position++;
    }
  };

  // Where the character next occurs before limit, or -1.
  const findBeforeLimit: (character: string, from: number) => number = (
    character: string,
    from: number,
  ): number => {
    for (let index: number = from; index < limit; index++) {
      if (source[index] === character) {
        return index;
      }
    }

    return -1;
  };

  skipSpaces();

  let address: string;

  if (source[position] === "<") {
    const close: number = findBeforeLimit(">", position + 1);

    if (close === -1 || source.slice(position + 1, close).includes("<")) {
      return null;
    }

    address = source.slice(position + 1, close);
    position = close + 1;
  } else {
    const addressStart: number = position;
    let depth: number = 0;

    while (position < limit) {
      const character: string = source[position]!;

      if (character === " " || character === "\t") {
        break;
      }

      if (character === "\\") {
        position += 2;
        continue;
      }

      if (character === "(") {
        depth++;
      } else if (character === ")") {
        if (depth === 0) {
          break;
        }

        depth--;
      }

      position++;
    }

    if (depth !== 0 || position > limit) {
      return null;
    }

    address = source.slice(addressStart, position);
  }

  skipSpaces();

  const opener: string | undefined = source[position];

  if (opener === '"' || opener === "'" || opener === "(") {
    const close: number = findBeforeLimit(
      opener === "(" ? ")" : opener,
      position + 1,
    );

    if (close === -1) {
      return null;
    }

    position = close + 1;
    skipSpaces();
  }

  if (position >= limit || source[position] !== ")") {
    return null;
  }

  return address.replace(ESCAPED_PUNCTUATION_PATTERN, "$1");
};

type FindWithoutLexingFunction = (data: {
  source: string;
  lines: Array<Line>;
  candidates: Array<Candidate>;
}) => FoundInText;

/*
 * What each candidate place is taken to be when the lexer does not read the
 * text (see "THE LEXER ONLY READS SHORT TEXT" above), in one pass: a "!["
 * on a line indented as code, or in a code span of its own line, is code;
 * a "![](" whose address can be read on its line before the next candidate
 * is an image with that address. A diagram is decided by trusted code
 * alone (see getEdits).
 */
const findWithoutLexing: FindWithoutLexingFunction = (data: {
  source: string;
  lines: Array<Line>;
  candidates: Array<Candidate>;
}): FoundInText => {
  const found: FoundInText = {
    images: new Map<number, string>(),
    literal: new Set<number>(),
    diagrams: new Set<number>(),
  };

  const images: Array<number> = [];

  data.candidates.forEach((candidate: Candidate, index: number): void => {
    if (candidate.kind === CandidateKind.Image) {
      images.push(index);
    }
  });

  /*
   * The line of the last candidate, its code spans, and the first of them
   * that does not end before that candidate: all only move forward, as the
   * candidates do.
   */
  let lineIndex: number = 0;
  let spansOfLine: number = -1;
  let spans: Array<[number, number]> = [];
  let spanIndex: number = 0;

  images.forEach((index: number, order: number): void => {
    const position: number = data.candidates[index]!.position;

    while (data.lines[lineIndex]!.end < position) {
      lineIndex++;
    }

    const line: Line = data.lines[lineIndex]!;

    if (spansOfLine !== lineIndex) {
      spans = getLineCodeSpans(data.source, line);
      spansOfLine = lineIndex;
      spanIndex = 0;
    }

    while (spanIndex < spans.length && spans[spanIndex]![1] <= position) {
      spanIndex++;
    }

    const span: [number, number] | undefined = spans[spanIndex];

    if (
      INDENTED_LINE_PATTERN.test(data.source.slice(line.start, line.end)) ||
      (span && span[0] < position)
    ) {
      found.literal.add(index);
      return;
    }

    if (!data.source.startsWith("![](", position)) {
      return;
    }

    const next: Candidate | undefined =
      order + 1 < images.length
        ? data.candidates[images[order + 1]!]
        : undefined;

    const address: string | null = readImageAddress(
      data.source,
      position + 4,
      Math.min(
        line.end,
        next ? next.position : line.end,
        position + 4 + IMAGE_ADDRESS_SCAN_MAX_LENGTH,
      ),
    );

    if (address !== null) {
      found.images.set(index, address);
    }
  });

  return found;
};

type GetImageLinkLabelFunction = (href: string | undefined) => string;

/*
 * The text of the link an image without alt text becomes: its address,
 * shortened and escaped so it reads as typed, or a plain word when it has
 * none.
 */
const getImageLinkLabel: GetImageLinkLabelFunction = (
  href: string | undefined,
): string => {
  const address: string = (href || "").replace(MARKER_PATTERN, "").trim();

  if (!address) {
    return IMAGE_LINK_FALLBACK_LABEL;
  }

  return escapeMarkdownInline(
    address.length > IMAGE_LINK_LABEL_MAX_LENGTH
      ? `${address.slice(0, IMAGE_LINK_LABEL_MAX_LENGTH)}...`
      : address,
  );
};

type GetEditsFunction = (data: {
  source: string;
  candidate: Candidate;
  index: number;
  found: FoundInText;
  code: TrustedCode;
}) => Array<Edit>;

// What changes one candidate place into something that does nothing.
const getEdits: GetEditsFunction = (data: {
  source: string;
  candidate: Candidate;
  index: number;
  found: FoundInText;
  code: TrustedCode;
}): Array<Edit> => {
  const position: number = data.candidate.position;

  if (data.candidate.kind === CandidateKind.Mermaid) {
    const info: DiagramInfoString = data.candidate.info!;

    /*
     * A fence the lexer found, or one every renderer reads as a fence, is
     * given the language "text" when its language holds "mermaid"; every
     * other "mermaid" is broken.
     */
    const isRenamed: boolean =
      (data.found.diagrams.has(data.index) ||
        data.code.openingInfoStarts.has(info.start)) &&
      info.mermaidWords[0]! < info.languageEnd;

    const edits: Array<Edit> = isRenamed
      ? [
          {
            position: info.start,
            deleteCount: info.languageEnd - info.start,
            insert: DEMOTED_LANGUAGE,
          },
        ]
      : [];

    for (const word of info.mermaidWords) {
      if (!isRenamed || word >= info.languageEnd) {
        edits.push({ position: word, deleteCount: 0, insert: WORD_JOINER });
      }
    }

    return edits;
  }

  const isImage: boolean = data.found.images.has(data.index);

  // In code or HTML a backslash would show; the joiner cannot be seen.
  if (!isImage && data.found.literal.has(data.index)) {
    return [{ position: position + 1, deleteCount: 0, insert: WORD_JOINER }];
  }

  const edits: Array<Edit> = [
    { position: position, deleteCount: 0, insert: "\\" },
  ];

  /*
   * "![]" - an image with no alt text, whose link would have no text to
   * see or click. Only for an image found, whose address is known.
   */
  if (isImage && data.source.startsWith("![]", position)) {
    edits.push({
      position: position + 2,
      deleteCount: 0,
      insert: getImageLinkLabel(data.found.images.get(data.index)),
    });
  }

  return edits;
};

type ApplyEditsFunction = (source: string, edits: Array<Edit>) => string;

/*
 * The text with every edit made, in one pass from the start. An edit that
 * falls inside text an earlier one replaced is dropped: that text is gone.
 * At the same place a replacement comes first, and so wins.
 */
const applyEdits: ApplyEditsFunction = (
  source: string,
  edits: Array<Edit>,
): string => {
  const ordered: Array<Edit> = [...edits].sort((a: Edit, b: Edit): number => {
    return a.position - b.position || b.deleteCount - a.deleteCount;
  });

  const parts: Array<string> = [];
  let cursor: number = 0;

  for (const edit of ordered) {
    if (edit.position < cursor) {
      continue;
    }

    parts.push(source.slice(cursor, edit.position), edit.insert);
    cursor = edit.position + edit.deleteCount;
  }

  parts.push(source.slice(cursor));

  return parts.join("");
};

export type NeutralizeMarkdownImagesAndDiagramsFunction = (
  markdown: string | undefined | null,
) => string;

/**
 * The Markdown with every image turned into a link to the same address and
 * every mermaid diagram into a plain code block, whatever renderer reads it
 * (see above); everything else reads exactly as written. Text with neither
 * comes back unchanged; otherwise its line endings come back as "\n".
 * Linear in the text's length.
 */
export const neutralizeMarkdownImagesAndDiagrams: NeutralizeMarkdownImagesAndDiagramsFunction =
  (markdown: string | undefined | null): string => {
    if (markdown === undefined || markdown === null) {
      return "";
    }

    const original: string = String(markdown);

    // As marked reads it, so a position here is a position in what it lexed.
    const source: string = original.replace(/\r\n|\r/g, "\n");

    const lines: Array<Line> = splitLines(source);
    const code: TrustedCode = findTrustedCode(source, lines);

    const candidates: Array<Candidate> = findCandidates({
      source: source,
      lines: lines,
      code: code,
    });

    // Nothing that could be an image or a diagram.
    if (candidates.length === 0) {
      return original;
    }

    let found: FoundInText | null = null;

    if (source.length <= LEXED_TEXT_MAX_LENGTH) {
      try {
        found = findInProbe(source, candidates);
      } catch {
        // Not read at all: decided as a longer text is.
        found = null;
      }
    }

    if (!found) {
      found = findWithoutLexing({
        source: source,
        lines: lines,
        candidates: candidates,
      });
    }

    const foundInText: FoundInText = found;

    return applyEdits(
      source,
      candidates.flatMap((candidate: Candidate, index: number): Array<Edit> => {
        return getEdits({
          source: source,
          candidate: candidate,
          index: index,
          found: foundInText,
          code: code,
        });
      }),
    );
  };

export type NeutralizeUntrustedMarkdownFunction = (
  markdown: string | undefined | null,
) => string;

/**
 * Both of the above, for Markdown an outsider wrote: no image or diagram
 * that acts on its own, and no chat mention.
 */
export const neutralizeUntrustedMarkdown: NeutralizeUntrustedMarkdownFunction =
  (markdown: string | undefined | null): string => {
    return neutralizeChatControlSequences(
      neutralizeMarkdownImagesAndDiagrams(markdown),
    );
  };

export type NeutralizeUntrustedPlainTextFunction = (
  value: string | undefined | null,
) => string;

/**
 * Plain text an outsider wrote that other code places into Markdown as it
 * is - an incident's title, which episode titles, feed items, chat
 * messages and note templates take up raw. Its chat control sequences are
 * broken as above, and so, with the same invisible word joiner, is every
 * "![", every "]" that a link or a link definition would go on from, and
 * every "mermaid" after a fence run: wherever the text lands - even beside
 * other Markdown - no renderer finds a mention, an image or a diagram in it,
 * or a reference that completes one. It reads exactly as typed - in
 * Markdown, and as plain text in an email subject or a text message.
 * Idempotent.
 */
export const neutralizeUntrustedPlainText: NeutralizeUntrustedPlainTextFunction =
  (value: string | undefined | null): string => {
    if (value === undefined || value === null) {
      return "";
    }

    /*
     * Also "]" before "(", "[" or ":": joined to other Markdown - an episode
     * template puts the title and the description side by side - a title
     * could otherwise define the link reference an image in the description
     * reads ("[a]: https://tracker.example/p.png"), or complete one opened
     * there.
     */
    const text: string = neutralizeChatControlSequences(value)
      .replace(IMAGE_OPENER_PATTERN, `!${WORD_JOINER}`)
      .replace(LINK_TAIL_OPENER_PATTERN, `]${WORD_JOINER}`);

    return applyEdits(
      text,
      findDiagramInfoStrings(text, splitLines(text)).flatMap(
        (info: DiagramInfoString): Array<Edit> => {
          return info.mermaidWords.map((word: number): Edit => {
            return { position: word, deleteCount: 0, insert: WORD_JOINER };
          });
        },
      ),
    );
  };
