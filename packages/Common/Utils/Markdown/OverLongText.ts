/*
 * TEXT TOO LONG FOR A MARKDOWN PARSER TO READ.
 *
 * A notification's Markdown carries what monitored systems and people put
 * in it: a response body or a log that a description template places, a
 * log pasted into a note. That can be megabytes on one line, or a paragraph
 * of a hundred thousand lines. marked (the emails) and remark (the
 * dashboard, and slackify for Slack) read a line, and a paragraph, with
 * regular expressions, and V8 matches a regular expression on a
 * backtracking stack that can grow with every character a quantifier
 * takes. A process that has compiled enough code - a server that has been
 * up a while, a CI test worker - compiles regular expressions unoptimized,
 * and then marked runs out of stack ("Maximum call stack size exceeded") on
 * a line, or a paragraph, of about three and a half million characters, and
 * the email is never rendered. remark breaks on less, and slows down
 * sharply on long lines of some shapes (a line of JSON, a run of links).
 *
 * So a parser is never given such text. Before it reads the Markdown, the
 * caller holds back:
 *
 *   - the middle of every line longer than OVER_LONG_LINE_LENGTH
 *     characters. The line keeps its first and last OVER_LONG_LINE_KEPT_LENGTH
 *     characters, so it keeps what makes it a list item, a quote, a heading
 *     or a table row, and whatever wraps it - a code span's backticks, the
 *     asterisks of bold, a link's brackets - on both ends.
 *   - in every run of lines with no blank line between them that is longer
 *     than OVER_LONG_RUN_LENGTH characters, each group of consecutive lines
 *     that only continue the block they are in (isContinuationLine: plain
 *     text, starting no list, quote, heading, table, fence or HTML, and
 *     holding no image, code or line break). A group is held back as one
 *     line, indented as its first line was, so the run keeps every line that
 *     gives it its structure.
 *
 * The caller puts a short token where it held something back (`hold`), and
 * writes the text out again where the parser put the token: as escaped text
 * in HTML. A held-back line of plain text reads exactly as the parser would
 * have rendered it; what it loses is Markdown inside it - emphasis, a link -
 * which then reads as written.
 *
 * A text of at most OVER_LONG_RUN_LENGTH characters has no line or run that
 * long: nothing is held back, and it renders exactly as it always has.
 *
 * Pure, with no Node or browser APIs, and no regular expression runs over
 * the text - it is scanned with indexOf and loops: the dashboard and the
 * server both use it.
 */

// A line longer than this is too long for a parser to read.
export const OVER_LONG_LINE_LENGTH: number = 65536;

// What an over-long line keeps of its start, and of its end.
export const OVER_LONG_LINE_KEPT_LENGTH: number = 1024;

/*
 * A run of lines - no blank line between them - longer than this is too
 * long for a parser to read as one paragraph.
 */
export const OVER_LONG_RUN_LENGTH: number = 65536;

/*
 * Holds back `text` and returns the token the caller puts in its place.
 * What is held back can contain tokens the same function returned before
 * (a run's lines contain the tokens of their over-long lines): the caller
 * resolves those, so it always keeps the text as it was written.
 */
export type HoldBackFunction = (text: string) => string;

const CARRIAGE_RETURN: number = 0x0d;
const SPACE: number = 0x20;
const TAB: number = 0x09;
const GREATER_THAN: number = 0x3e;

const isHighSurrogate: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xd800 && code <= 0xdbff;
};

const isLowSurrogate: (code: number) => boolean = (code: number): boolean => {
  return code >= 0xdc00 && code <= 0xdfff;
};

const isSpaceOrTab: (code: number) => boolean = (code: number): boolean => {
  return code === SPACE || code === TAB;
};

const isDigit: (code: number) => boolean = (code: number): boolean => {
  return code >= 0x30 && code <= 0x39;
};

/*
 * The characters a line may not start with (after its indentation) to be
 * held back as a continuation: each can start a block of its own - a
 * heading, a quote, a list item or thematic break, a setext underline, a
 * fence, a table row, HTML, or a link reference definition.
 */
const BLOCK_START_CHARACTERS: string = "#>-+*_=~`|<[";

/*
 * Characters a held-back line may not hold anywhere: a code span or fence
 * (`), a table cell (|), HTML and the end of an HTML block (< and >).
 */
const LINE_STOP_CHARACTERS: string = "`|<>";

/*
 * Whether `text`, scanned for nothing but its length, could have anything
 * held back: a line or a run is no longer than the text it is in.
 */
export const mayHoldBack: (text: string) => boolean = (
  text: string,
): boolean => {
  return (
    typeof text === "string" &&
    text.length > Math.min(OVER_LONG_LINE_LENGTH, OVER_LONG_RUN_LENGTH)
  );
};

/*
 * Whether the line text[start, end) - without its line break - only
 * continues the block it is in: a paragraph's next line (its lazy
 * continuation inside a quote or a list item), or a code block's. Its first
 * character after the indentation starts no block (BLOCK_START_CHARACTERS,
 * or digits and "." or ")": an ordered list item), it holds no code, table
 * cell, HTML or image ("![") anywhere, and it does not end in a hard line
 * break (two spaces, or a backslash). A blank line is not one.
 *
 * A token in its place starts nothing either, so the run keeps its
 * structure, and its text, plain, renders as the parser would have
 * rendered it.
 */
export const isContinuationLine: (
  text: string,
  start: number,
  end: number,
) => boolean = (text: string, start: number, end: number): boolean => {
  let lineEnd: number = end;

  // A line break written as \r\n is a line break: the \r is not text.
  if (lineEnd > start && text.charCodeAt(lineEnd - 1) === CARRIAGE_RETURN) {
    lineEnd--;
  }

  let first: number = start;

  while (first < lineEnd && isSpaceOrTab(text.charCodeAt(first))) {
    first++;
  }

  if (first === lineEnd) {
    return false;
  }

  if (BLOCK_START_CHARACTERS.indexOf(text.charAt(first)) !== -1) {
    return false;
  }

  if (isDigit(text.charCodeAt(first))) {
    let afterDigits: number = first;

    while (afterDigits < lineEnd && isDigit(text.charCodeAt(afterDigits))) {
      afterDigits++;
    }

    const next: string = text.charAt(afterDigits);

    if (next === "." || next === ")") {
      return false;
    }
  }

  for (let index: number = first; index < lineEnd; index++) {
    const character: string = text.charAt(index);

    if (LINE_STOP_CHARACTERS.indexOf(character) !== -1) {
      return false;
    }

    if (character === "!" && text.charAt(index + 1) === "[") {
      return false;
    }
  }

  const last: string = text.charAt(lineEnd - 1);

  if (last === "\\") {
    return false;
  }

  return !(
    lineEnd - first >= 2 &&
    last === " " &&
    text.charAt(lineEnd - 2) === " "
  );
};

// How far before a cut a space is looked for (see getCut).
const CUT_SEARCH_LENGTH: number = 64;

/*
 * Where to cut text near `position`: right after the last space or tab in
 * the CUT_SEARCH_LENGTH characters before it, so the token sits between
 * words as the text it stands for did - a word with an underscore or an
 * asterisk in it stays one word, and emphasis around the cut is read as
 * it was. With no space there (base64, minified JSON) at `position`
 * itself, or one before it when that would part the two halves of a
 * surrogate pair, such as an emoji.
 */
const getCut: (text: string, position: number) => number = (
  text: string,
  position: number,
): number => {
  for (
    let index: number = position - 1;
    index >= position - CUT_SEARCH_LENGTH;
    index--
  ) {
    if (isSpaceOrTab(text.charCodeAt(index))) {
      return index + 1;
    }
  }

  if (
    isHighSurrogate(text.charCodeAt(position - 1)) &&
    isLowSurrogate(text.charCodeAt(position))
  ) {
    return position - 1;
  }

  return position;
};

/*
 * `text` with the middle of every line longer than OVER_LONG_LINE_LENGTH
 * held back (see the top of this file). The middle starts and ends right
 * after a space where there is one near (getCut), and never between the two
 * halves of a surrogate pair, such as an emoji.
 */
export const holdBackOverLongLines: (
  text: string,
  hold: HoldBackFunction,
) => string = (text: string, hold: HoldBackFunction): string => {
  if (!mayHoldBack(text)) {
    return text;
  }

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;
  let lineStart: number = 0;

  while (lineStart <= text.length) {
    let lineEnd: number = text.indexOf("\n", lineStart);

    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    if (lineEnd - lineStart > OVER_LONG_LINE_LENGTH) {
      const middleStart: number = getCut(
        text,
        lineStart + OVER_LONG_LINE_KEPT_LENGTH,
      );
      const middleEnd: number = getCut(
        text,
        lineEnd - OVER_LONG_LINE_KEPT_LENGTH,
      );

      pieces.push(
        text.slice(copiedUpTo, middleStart),
        hold(text.slice(middleStart, middleEnd)),
      );
      copiedUpTo = middleEnd;
    }

    lineStart = lineEnd + 1;
  }

  if (pieces.length === 0) {
    return text;
  }

  pieces.push(text.slice(copiedUpTo));

  return pieces.join("");
};

interface Line {
  start: number;
  // Where the line ends, before its "\n".
  end: number;
}

const isBlankLine: (text: string, line: Line) => boolean = (
  text: string,
  line: Line,
): boolean => {
  for (let index: number = line.start; index < line.end; index++) {
    const code: number = text.charCodeAt(index);

    if (!isSpaceOrTab(code) && code !== CARRIAGE_RETURN) {
      return false;
    }
  }

  return true;
};

/*
 * Where the content of the line text[start, end) starts: after its block
 * quote markers - each a ">" with up to three spaces before it and one
 * space or tab after it. The line's start when it is in no quote.
 */
const getQuotePrefixEnd: (text: string, start: number, end: number) => number = (
  text: string,
  start: number,
  end: number,
): number => {
  let prefixEnd: number = start;

  for (;;) {
    let index: number = prefixEnd;

    while (
      index < end &&
      index - prefixEnd < 3 &&
      text.charCodeAt(index) === SPACE
    ) {
      index++;
    }

    if (index >= end || text.charCodeAt(index) !== GREATER_THAN) {
      return prefixEnd;
    }

    index++;

    if (index < end && isSpaceOrTab(text.charCodeAt(index))) {
      index++;
    }

    prefixEnd = index;
  }
};

/*
 * `text` with every group of continuation lines held back in each run of
 * lines longer than OVER_LONG_RUN_LENGTH (see the top of this file). A
 * group is consecutive continuation lines in the same block quotes (or in
 * none), and becomes one line: the quote markers and indentation of its
 * first line, then the token. What it holds back is its lines as the
 * parser reads them - without their quote markers - one per line.
 */
export const holdBackOverLongRuns: (
  text: string,
  hold: HoldBackFunction,
) => string = (text: string, hold: HoldBackFunction): string => {
  if (!mayHoldBack(text)) {
    return text;
  }

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;

  // The lines of the run being read.
  let run: Array<Line> = [];

  const holdBackGroups: () => void = (): void => {
    if (run.length === 0) {
      return;
    }

    const runLength: number = run[run.length - 1]!.end - run[0]!.start;

    if (runLength > OVER_LONG_RUN_LENGTH) {
      let index: number = 0;

      while (index < run.length) {
        const first: Line = run[index]!;
        const prefixEnd: number = getQuotePrefixEnd(
          text,
          first.start,
          first.end,
        );

        if (!isContinuationLine(text, prefixEnd, first.end)) {
          index++;
          continue;
        }

        /*
         * The group's lines are in the same block quotes (or none), so
         * the token line is in them too: what the group holds back is each
         * line without its quote markers, as the parser reads it.
         */
        const prefix: string = text.slice(first.start, prefixEnd);

        let textStart: number = prefixEnd;

        while (
          textStart < first.end &&
          isSpaceOrTab(text.charCodeAt(textStart))
        ) {
          textStart++;
        }

        const heldLines: Array<string> = [text.slice(textStart, first.end)];
        let last: Line = first;

        while (index + 1 < run.length) {
          const next: Line = run[index + 1]!;
          const nextPrefixEnd: number = getQuotePrefixEnd(
            text,
            next.start,
            next.end,
          );

          if (
            nextPrefixEnd - next.start !== prefix.length ||
            text.slice(next.start, nextPrefixEnd) !== prefix ||
            !isContinuationLine(text, nextPrefixEnd, next.end)
          ) {
            break;
          }

          heldLines.push(text.slice(nextPrefixEnd, next.end));
          last = next;
          index++;
        }

        pieces.push(
          text.slice(copiedUpTo, textStart),
          hold(heldLines.join("\n")),
        );
        copiedUpTo = last.end;
        index++;
      }
    }

    run = [];
  };

  let lineStart: number = 0;

  while (lineStart <= text.length) {
    let lineEnd: number = text.indexOf("\n", lineStart);

    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    const line: Line = { start: lineStart, end: lineEnd };

    if (isBlankLine(text, line)) {
      holdBackGroups();
    } else {
      run.push(line);
    }

    lineStart = lineEnd + 1;
  }

  holdBackGroups();

  if (pieces.length === 0) {
    return text;
  }

  pieces.push(text.slice(copiedUpTo));

  return pieces.join("");
};

/*
 * `text` with everything too long for a parser held back: the middles of
 * its over-long lines, then the continuation lines of its over-long runs.
 * The same as `text` when it is no longer than OVER_LONG_RUN_LENGTH.
 */
export const holdBackOverLongText: (
  text: string,
  hold: HoldBackFunction,
) => string = (text: string, hold: HoldBackFunction): string => {
  return holdBackOverLongRuns(holdBackOverLongLines(text, hold), hold);
};

/*
 * Whether `text` has a line longer than OVER_LONG_LINE_LENGTH: such a line
 * is held back in part, so it does not render as Markdown.
 */
export const hasOverLongLine: (text: string) => boolean = (
  text: string,
): boolean => {
  if (!mayHoldBack(text)) {
    return false;
  }

  let lineStart: number = 0;

  while (lineStart <= text.length) {
    let lineEnd: number = text.indexOf("\n", lineStart);

    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    if (lineEnd - lineStart > OVER_LONG_LINE_LENGTH) {
      return true;
    }

    lineStart = lineEnd + 1;
  }

  return false;
};
