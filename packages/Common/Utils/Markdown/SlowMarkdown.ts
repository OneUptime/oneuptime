/*
 * MARKDOWN OF A SHAPE A PARSER READS SLOWLY.
 *
 * OverLongText keeps text too long for a Markdown parser away from it. Some
 * shapes of text are slow to parse long before they are that long, because
 * the parsers' time grows with the square of them. Measured on 64 KB in the
 * state a long-running server reaches (V8 compiling regular expressions
 * unoptimized), before anything here held them back:
 *
 *   - marked (the emails) looks for the end of every "*", "_", "~", code
 *     span or link it meets, from where it is to the end of the block: a
 *     line of "*a " took 75 s, of "[a](" 13 s, of "`a``" 2.5 s, and an
 *     address ending in underscores over 90 s.
 *   - remark (the dashboard) did the same with different shapes - a line of
 *     "a* " took 29 s, of "[[[...]]]" 69 s - and grows faster than linearly
 *     with long lists and tables: a list of 16,000 items took 8 s.
 *   - slackify (Slack) was slow on all of these, and on plain long blocks
 *     as well: a paragraph of 16,000 lines took 4 s, and one line of 32 KB
 *     of words a quarter of a second - three quarters when the words were
 *     web addresses.
 *   - marked, remark and slackify all ran out of stack on a line nested a
 *     few thousand quotes deep ("> > > ...").
 *
 * A notification can carry any of these: a response body, a log, a pasted
 * table. So before such a parser reads Markdown longer than
 * SLOW_MARKDOWN_MIN_LENGTH, its blocks are measured in one pass, and the
 * blocks that would cost it too much are held back whole. A block here is a
 * run of lines with no blank line between them, outside fenced code. Each
 * stretch of runs held back becomes one token, and the caller writes the
 * text back where the parser put it, as it was written, a line on each line:
 * Markdown in it reads as written. What a run costs:
 *
 *   - its inline work: for each paragraph, list item or heading in it, the
 *     characters that can start inline Markdown (getInlineCharacterCount)
 *     times its length - the most that marked, and remark, look through.
 *     The runs of the text together may cost limits.maxInlineWork; the
 *     costliest are held back until they do.
 *   - its lines: a run may have limits.maxRunLines, all the runs read as
 *     Markdown limits.maxLines (the dashboard and Slack only: marked reads
 *     lines in linear time).
 *   - its longest paragraph, list item or heading, in characters:
 *     limits.maxUnitLength (the dashboard and Slack only).
 *   - how deep its lines nest quotes and lists (limits.maxNestingDepth),
 *     and how many cells a table row of it has (limits.maxCellsPerLine).
 *
 * Fenced code is read in linear time by every parser: it costs nothing, and
 * is never held back. limits.holdBackCodeBlockContent holds back its content
 * as one token, so a parser whose time grows with lines (slackify) reads one
 * - the caller writes it back as it was, in the code block.
 *
 * The measuring is conservative: when it cannot tell whether two lines are
 * one block or two for the parser, it counts them as one, which can only
 * make a run look costlier than it is. And anything it holds back is text to
 * the parser, so a run it misjudged is shown as written, never parsed slowly.
 *
 * A text of at most SLOW_MARKDOWN_MIN_LENGTH characters renders in good
 * time in every shape but one, and renders exactly as it always has: only
 * a line nested deeper than limits.maxNestingDepth is held back from it -
 * remark ran out of stack on 2 KB of ">".
 *
 * Pure, with no Node or browser APIs, and no regular expression runs over
 * the text: the dashboard and the server both use it.
 */

/*
 * Markdown of at most this many characters is given to a parser as it is:
 * its slowest shapes take a few hundredths of a second.
 */
export const SLOW_MARKDOWN_MIN_LENGTH: number = 2048;

// How much of each kind of work a parser is given at most.
export interface SlowMarkdownLimits {
  /*
   * The inline work of all the runs read as Markdown together: for each
   * paragraph, list item or heading, its inline characters times its length.
   */
  maxInlineWork: number;
  // The lines one run may have.
  maxRunLines: number;
  // The lines all the runs read as Markdown may have together.
  maxLines: number;
  // The characters one paragraph, list item or heading may have.
  maxUnitLength: number;
  // The quote and list markers a line may start with.
  maxNestingDepth: number;
  // The "|" a line may have: the cells of a table row.
  maxCellsPerLine: number;
  // Whether the content of fenced code is held back as one token.
  holdBackCodeBlockContent: boolean;
}

/*
 * What every parser takes in good time: inline work of 2^22 is about a
 * fifth of a second for marked, the slowest of them, in a long-running
 * process (53 ns for each character it looks through).
 */
export const SLOW_MARKDOWN_MAX_INLINE_WORK: number = 4 * 1024 * 1024;

// No real text nests quotes and lists this deep; a few thousand broke them.
export const SLOW_MARKDOWN_MAX_NESTING_DEPTH: number = 16;

/*
 * How the caller holds text back, by what the text is. Each returns the
 * token the caller puts in its place, and writes the text back as it was
 * written where the parser put the token.
 */
export interface SlowMarkdownHolder {
  /*
   * Whole lines - one or more runs of them, with the blank lines between -
   * that the parser would take too long to read. Written back as text, a
   * line on each line.
   */
  holdLines: (text: string) => string;
  /*
   * The content of a fenced code block (limits.holdBackCodeBlockContent).
   * Written back as it was: it is still in the code block.
   */
  holdCode: (text: string) => string;
}

// What one run of lines costs (see the top of this file).
export interface SlowMarkdownRun {
  // Where its first line starts, and its last line ends (before its "\n").
  start: number;
  end: number;
  lines: number;
  inlineWork: number;
  // Its longest paragraph, list item or heading, in characters.
  longestUnit: number;
  nestingDepth: number;
  cellsPerLine: number;
}

// A fenced code block: where its content starts and ends (before a closer).
interface CodeBlock {
  contentStart: number;
  contentEnd: number;
}

// The text read as runs of lines and fenced code blocks, in order.
type Segment =
  | { kind: "run"; run: SlowMarkdownRun }
  | { kind: "code"; block: CodeBlock };

const SPACE: number = 0x20;
const TAB: number = 0x09;
const CARRIAGE_RETURN: number = 0x0d;
const LINE_FEED: number = 0x0a;
const GREATER_THAN: number = 0x3e;
const BACKTICK: number = 0x60;
const TILDE: number = 0x7e;
const LESS_THAN: number = 0x3c;
const NUMBER_SIGN: number = 0x23;
const PIPE: number = 0x7c;
const BACKSLASH: number = 0x5c;

const WORD_CHARACTER: RegExp = /[\p{L}\p{N}]/u;

const isSpaceOrTab: (code: number) => boolean = (code: number): boolean => {
  return code === SPACE || code === TAB;
};

const isAsciiLetter: (code: number) => boolean = (code: number): boolean => {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
};

const isDigit: (code: number) => boolean = (code: number): boolean => {
  return code >= 0x30 && code <= 0x39;
};

// ASCII punctuation: what a backslash escapes.
const isAsciiPunctuation: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
};

// Whitespace as emphasis rules read it - a line's start or end counts too.
const isWhitespaceOrNothing: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    Number.isNaN(code) ||
    code === SPACE ||
    code === TAB ||
    code === LINE_FEED ||
    code === CARRIAGE_RETURN ||
    code === 0xa0 ||
    code === 0x3000
  );
};

/*
 * Whether the character at `index` - a letter or a digit in any script - is
 * part of a word: an "_" between two of them cannot start or end emphasis.
 * Tested on the one character, with a surrogate pair read whole.
 */
const isWordCharacterAt: (text: string, index: number) => boolean = (
  text: string,
  index: number,
): boolean => {
  if (index < 0 || index >= text.length) {
    return false;
  }

  const code: number = text.charCodeAt(index);

  if (isAsciiLetter(code) || isDigit(code)) {
    return true;
  }

  if (code < 0x80) {
    return false;
  }

  // The character as a whole code point, the low half of a pair included.
  const codePoint: number | undefined =
    code >= 0xdc00 && code <= 0xdfff && index > 0
      ? text.codePointAt(index - 1)
      : text.codePointAt(index);

  return (
    codePoint !== undefined &&
    WORD_CHARACTER.test(String.fromCodePoint(codePoint))
  );
};

/*
 * The characters of text[start, end) that can start or end inline Markdown,
 * and so make a parser look ahead through the rest of a block: emphasis and
 * strikethrough delimiters ("*", "_", "~") that can open or close - not
 * those with whitespace on both sides, nor an "_" inside a word - every
 * backtick, "[" and "]", a "<" that can start a tag or an autolink, a "\"
 * that escapes, and a "&" that can start an entity.
 */
export const getInlineCharacterCount: (
  text: string,
  start: number,
  end: number,
) => number = (text: string, start: number, end: number): number => {
  let count: number = 0;
  let index: number = start;

  while (index < end) {
    const code: number = text.charCodeAt(index);

    if (code === 0x2a || code === 0x5f || code === TILDE) {
      let runEnd: number = index + 1;

      while (runEnd < end && text.charCodeAt(runEnd) === code) {
        runEnd++;
      }

      const before: number = index > start ? text.charCodeAt(index - 1) : NaN;
      const after: number = runEnd < end ? text.charCodeAt(runEnd) : NaN;

      const canNeitherOpenNorClose: boolean =
        isWhitespaceOrNothing(before) && isWhitespaceOrNothing(after);
      const isInsideWord: boolean =
        code === 0x5f &&
        index > start &&
        runEnd < end &&
        isWordCharacterAt(text, index - 1) &&
        isWordCharacterAt(text, runEnd);

      if (!canNeitherOpenNorClose && !isInsideWord) {
        count += runEnd - index;
      }

      index = runEnd;
      continue;
    }

    const next: number = index + 1 < end ? text.charCodeAt(index + 1) : NaN;

    if (code === BACKTICK || code === 0x5b || code === 0x5d) {
      count++;
    } else if (
      code === LESS_THAN &&
      (isAsciiLetter(next) ||
        next === 0x2f ||
        next === 0x21 ||
        next === 0x3f)
    ) {
      count++;
    } else if (code === BACKSLASH && isAsciiPunctuation(next)) {
      count++;
    } else if (code === 0x26 && (next === NUMBER_SIGN || isAsciiLetter(next))) {
      count++;
    }

    index++;
  }

  return count;
};

// Where the line that starts at `start` ends: its "\n", or the text's end.
const getLineEnd: (text: string, start: number) => number = (
  text: string,
  start: number,
): number => {
  const lineEnd: number = text.indexOf("\n", start);

  return lineEnd === -1 ? text.length : lineEnd;
};

// The line text[start, end) without a "\r" its "\r\n" line break left.
const withoutCarriageReturn: (
  text: string,
  start: number,
  end: number,
) => number = (text: string, start: number, end: number): number => {
  return end > start && text.charCodeAt(end - 1) === CARRIAGE_RETURN
    ? end - 1
    : end;
};

const isBlankLine: (text: string, start: number, end: number) => boolean = (
  text: string,
  start: number,
  end: number,
): boolean => {
  for (let index: number = start; index < end; index++) {
    const code: number = text.charCodeAt(index);

    if (!isSpaceOrTab(code) && code !== CARRIAGE_RETURN) {
      return false;
    }
  }

  return true;
};

/*
 * A fence that opens a code block, as every parser reads one wherever this
 * reads one: at the very start of a line, three or more backticks with no
 * backtick after them, or three or more tildes. The run of fence
 * characters, or null.
 */
const getFenceOpening: (
  text: string,
  start: number,
  end: number,
) => { character: number; length: number } | null = (
  text: string,
  start: number,
  end: number,
): { character: number; length: number } | null => {
  const character: number = text.charCodeAt(start);

  if (character !== BACKTICK && character !== TILDE) {
    return null;
  }

  let runEnd: number = start;

  while (runEnd < end && text.charCodeAt(runEnd) === character) {
    runEnd++;
  }

  if (runEnd - start < 3) {
    return null;
  }

  if (character === BACKTICK) {
    for (let index: number = runEnd; index < end; index++) {
      if (text.charCodeAt(index) === BACKTICK) {
        return null;
      }
    }
  }

  return { character: character, length: runEnd - start };
};

/*
 * Whether the line closes a fence of `length` `character`s - leniently: up
 * to three spaces, then at least as long a run of the character, whatever
 * follows. A parser closes a fence there or does not close it, never
 * closes it where this does not, so this never takes a line the parser
 * reads as Markdown for code.
 */
const isFenceClosing: (
  text: string,
  start: number,
  end: number,
  fence: { character: number; length: number },
) => boolean = (
  text: string,
  start: number,
  end: number,
  fence: { character: number; length: number },
): boolean => {
  let index: number = start;

  while (index < end && index - start < 3 && text.charCodeAt(index) === SPACE) {
    index++;
  }

  let runEnd: number = index;

  while (runEnd < end && text.charCodeAt(runEnd) === fence.character) {
    runEnd++;
  }

  return runEnd - index >= fence.length;
};

/*
 * The HTML blocks that run on past a blank line (CommonMark types 1 to 5),
 * by how they start, and what ends them. Inside one, a fence is HTML, not
 * code: no fence is looked for until it ends.
 */
const HTML_BLOCK_KINDS: ReadonlyArray<{
  starts: ReadonlyArray<string>;
  ends: ReadonlyArray<string>;
}> = [
  {
    starts: ["<script", "<pre", "<style", "<textarea"],
    ends: ["</script>", "</pre>", "</style>", "</textarea>"],
  },
  { starts: ["<!--"], ends: ["-->"] },
  { starts: ["<?"], ends: ["?>"] },
  { starts: ["<![cdata["], ends: ["]]>"] },
  { starts: ["<!"], ends: [">"] },
];

/*
 * The ends of the HTML block the line starts (after up to three spaces), if
 * it starts one that runs on past a blank line and does not end on the line
 * itself - else null.
 */
const getOpenHtmlBlockEnds: (
  text: string,
  start: number,
  end: number,
) => ReadonlyArray<string> | null = (
  text: string,
  start: number,
  end: number,
): ReadonlyArray<string> | null => {
  let index: number = start;

  while (index < end && index - start < 3 && text.charCodeAt(index) === SPACE) {
    index++;
  }

  if (text.charCodeAt(index) !== LESS_THAN) {
    return null;
  }

  // Lower case, and short: the longest start is "<![cdata[".
  const head: string = text.slice(index, Math.min(end, index + 10)).toLowerCase();

  for (const kind of HTML_BLOCK_KINDS) {
    const opener: string | undefined = kind.starts.find(
      (candidate: string): boolean => {
        return head.startsWith(candidate);
      },
    );

    if (opener === undefined) {
      continue;
    }

    if (kind.starts[0] === "<script") {
      // The tag name must end there: "<pre>" or "<pre " opens one, "<press" not.
      const after: number = head.charCodeAt(opener.length);

      if (
        !Number.isNaN(after) &&
        after !== GREATER_THAN &&
        !isSpaceOrTab(after) &&
        after !== CARRIAGE_RETURN
      ) {
        return null;
      }
    }

    if (opener === "<!" && !isAsciiLetter(head.charCodeAt(2))) {
      return null;
    }

    const rest: string = text.slice(index + opener.length, end).toLowerCase();

    return kind.ends.some((ending: string): boolean => {
      return rest.includes(ending);
    })
      ? null
      : kind.ends;
  }

  return null;
};

// Whether the line holds one of `ends` (case-insensitively).
const lineHoldsOneOf: (
  text: string,
  start: number,
  end: number,
  ends: ReadonlyArray<string>,
) => boolean = (
  text: string,
  start: number,
  end: number,
  ends: ReadonlyArray<string>,
): boolean => {
  const line: string = text.slice(start, end).toLowerCase();

  return ends.some((ending: string): boolean => {
    return line.includes(ending);
  });
};

/*
 * How a line of a run starts: whether it starts a list item or a heading of
 * its own - a new unit of inline work - and how deep its quote and list
 * markers nest.
 */
interface LineStart {
  // Where the line's inline text starts: past its markers.
  contentStart: number;
  // Quote and list markers it starts with, one in another.
  nestingDepth: number;
  /*
   * What it starts as a unit of its own, if anything: "bullet",
   * "ordered." or "ordered)" (a numbered item, by its delimiter), or
   * "heading".
   */
  unitStart: string | null;
  // A numbered item's number is 1: it starts a list wherever it is.
  isFirstOrdered: boolean;
}

/*
 * Whether text[start, end) is a thematic break: three or more of the same
 * "*", "-" or "_", with spaces or tabs between them and nothing else. Its
 * "* " are not nested list items.
 */
const isThematicBreak: (text: string, start: number, end: number) => boolean =
  (text: string, start: number, end: number): boolean => {
    let marker: number = NaN;
    let count: number = 0;

    for (let index: number = start; index < end; index++) {
      const code: number = text.charCodeAt(index);

      if (isSpaceOrTab(code)) {
        continue;
      }

      if (code !== 0x2a && code !== 0x2d && code !== 0x5f) {
        return false;
      }

      if (count > 0 && code !== marker) {
        return false;
      }

      marker = code;
      count++;
    }

    return count >= 3;
  };

/*
 * Reads the markers the line text[start, end) starts with: quote markers
 * (">"), bullets ("-", "*" or "+") and numbers ("1." or "1)") followed by a
 * space, a tab or the line's end.
 *
 * The line starts a unit of its own when, past its quote markers (inside a
 * quote, the same rules hold), its first marker is a bullet, a number or a
 * heading's "#", at most three spaces in, with text after it: an empty item
 * cannot interrupt a paragraph, and an item indented further may be a
 * paragraph's next line. Any other line - quote markers alone included -
 * continues the unit before it.
 */
const readLineStart: (text: string, start: number, end: number) => LineStart =
  (text: string, start: number, end: number): LineStart => {
    if (isThematicBreak(text, start, end)) {
      return {
        contentStart: end,
        nestingDepth: 0,
        unitStart: null,
        isFirstOrdered: false,
      };
    }

    let index: number = start;
    let nestingDepth: number = 0;
    let firstMarker: string | null = null;
    let firstMarkerIndentation: number = 0;
    let isFirstOrdered: boolean = false;

    for (;;) {
      let afterSpaces: number = index;

      while (afterSpaces < end && isSpaceOrTab(text.charCodeAt(afterSpaces))) {
        afterSpaces++;
      }

      if (afterSpaces >= end) {
        index = afterSpaces;
        break;
      }

      const indentation: number = afterSpaces - index;
      const code: number = text.charCodeAt(afterSpaces);

      // The character after a one-character marker: a space, a tab or the end.
      const endsMarker: (position: number) => boolean = (
        position: number,
      ): boolean => {
        return position >= end || isSpaceOrTab(text.charCodeAt(position));
      };

      if (code === GREATER_THAN && indentation <= 3 && firstMarker === null) {
        nestingDepth++;
        index = afterSpaces + 1;

        if (index < end && isSpaceOrTab(text.charCodeAt(index))) {
          index++;
        }

        continue;
      }

      if (code === GREATER_THAN && firstMarker !== null) {
        // A quote inside a list item: it nests as deep.
        nestingDepth++;
        index = afterSpaces + 1;
        continue;
      }

      if (
        (code === 0x2d || code === 0x2a || code === 0x2b) &&
        endsMarker(afterSpaces + 1)
      ) {
        nestingDepth++;

        if (firstMarker === null) {
          firstMarker = "bullet";
          firstMarkerIndentation = indentation;
        }

        index = afterSpaces + 1;
        continue;
      }

      if (isDigit(code)) {
        let digitsEnd: number = afterSpaces;

        while (
          digitsEnd < end &&
          digitsEnd - afterSpaces < 9 &&
          isDigit(text.charCodeAt(digitsEnd))
        ) {
          digitsEnd++;
        }

        const delimiter: number = text.charCodeAt(digitsEnd);

        if (
          digitsEnd < end &&
          (delimiter === 0x2e || delimiter === 0x29) &&
          endsMarker(digitsEnd + 1)
        ) {
          nestingDepth++;

          if (firstMarker === null) {
            firstMarker = delimiter === 0x2e ? "ordered." : "ordered)";
            firstMarkerIndentation = indentation;
            isFirstOrdered =
              digitsEnd - afterSpaces === 1 &&
              text.charCodeAt(afterSpaces) === 0x31;
          }

          index = digitsEnd + 1;
          continue;
        }
      }

      if (code === NUMBER_SIGN && firstMarker === null && indentation <= 3) {
        let hashesEnd: number = afterSpaces;

        while (hashesEnd < end && text.charCodeAt(hashesEnd) === NUMBER_SIGN) {
          hashesEnd++;
        }

        if (hashesEnd - afterSpaces <= 6 && endsMarker(hashesEnd)) {
          firstMarker = "heading";
          firstMarkerIndentation = indentation;
        }
      }

      index = afterSpaces;
      break;
    }

    const hasText: boolean = index < end;

    return {
      contentStart: index,
      nestingDepth: nestingDepth,
      unitStart:
        firstMarker !== null && firstMarkerIndentation <= 3 && hasText
          ? firstMarker
          : null,
      isFirstOrdered: isFirstOrdered,
    };
  };

// The "|" in text[start, end) that a backslash does not escape.
const getPipeCount: (text: string, start: number, end: number) => number = (
  text: string,
  start: number,
  end: number,
): number => {
  let count: number = 0;

  for (let index: number = start; index < end; index++) {
    if (
      text.charCodeAt(index) === PIPE &&
      (index === 0 || text.charCodeAt(index - 1) !== BACKSLASH)
    ) {
      count++;
    }
  }

  return count;
};

/*
 * What the run of lines that start at `lineStarts` costs (see
 * SlowMarkdownRun).
 *
 * Its inline work is summed over its units: a line that starts a list item
 * or a heading (readLineStart) starts a unit, and any other line continues
 * the unit before it, as a paragraph's next line does - two lines are only
 * counted apart where every parser reads them apart. A numbered item that
 * is not "1." starts a unit only right after a unit that a numbered item of
 * the same kind started: elsewhere it can be a paragraph's next line.
 */
const measureRun: (text: string, lineStarts: Array<number>) => SlowMarkdownRun =
  (text: string, lineStarts: Array<number>): SlowMarkdownRun => {
    let inlineWork: number = 0;
    let longestUnit: number = 0;
    let nestingDepth: number = 0;
    let cellsPerLine: number = 0;
    let unitLength: number = 0;
    let unitCharacters: number = 0;
    // What started the unit being read, if a marker did.
    let unitKind: string | null = null;

    for (const lineStart of lineStarts) {
      const lineEnd: number = withoutCarriageReturn(
        text,
        lineStart,
        getLineEnd(text, lineStart),
      );
      const start: LineStart = readLineStart(text, lineStart, lineEnd);

      const startsUnit: boolean =
        start.unitStart === "bullet" ||
        start.unitStart === "heading" ||
        (start.unitStart !== null &&
          (start.isFirstOrdered || start.unitStart === unitKind));

      if (startsUnit) {
        inlineWork += unitCharacters * unitLength;
        longestUnit = Math.max(longestUnit, unitLength);
        unitLength = 0;
        unitCharacters = 0;
        unitKind = start.unitStart;
      }

      unitLength += lineEnd - lineStart + 1;
      unitCharacters += getInlineCharacterCount(
        text,
        start.contentStart,
        lineEnd,
      );
      nestingDepth = Math.max(nestingDepth, start.nestingDepth);
      cellsPerLine = Math.max(
        cellsPerLine,
        getPipeCount(text, start.contentStart, lineEnd),
      );
    }

    inlineWork += unitCharacters * unitLength;
    longestUnit = Math.max(longestUnit, unitLength);

    return {
      start: lineStarts[0]!,
      end: getLineEnd(text, lineStarts[lineStarts.length - 1]!),
      lines: lineStarts.length,
      inlineWork: inlineWork,
      longestUnit: longestUnit,
      nestingDepth: nestingDepth,
      cellsPerLine: cellsPerLine,
    };
  };

/*
 * The text read as runs of lines and fenced code blocks (see the top of this
 * file). A fence is only read as one where every parser reads one: it opens
 * at the start of a line after a blank line (or at the text's start), never
 * inside an HTML block that runs on past blank lines, and closes leniently.
 */
const readSegments: (text: string) => Array<Segment> = (
  text: string,
): Array<Segment> => {
  const segments: Array<Segment> = [];
  let runLineStarts: Array<number> = [];
  let previousLineWasBlank: boolean = true;
  let fence: { character: number; length: number } | null = null;
  let fenceContentStart: number = 0;
  let htmlBlockEnds: ReadonlyArray<string> | null = null;

  const endRun: () => void = (): void => {
    if (runLineStarts.length > 0) {
      segments.push({ kind: "run", run: measureRun(text, runLineStarts) });
      runLineStarts = [];
    }
  };

  let lineStart: number = 0;

  while (lineStart <= text.length) {
    const lineBreak: number = getLineEnd(text, lineStart);
    const lineEnd: number = withoutCarriageReturn(text, lineStart, lineBreak);

    if (fence !== null) {
      if (isFenceClosing(text, lineStart, lineEnd, fence)) {
        segments.push({
          kind: "code",
          block: {
            contentStart: fenceContentStart,
            // Before the closer's line, and a "\r" its line break left.
            contentEnd: Math.max(
              fenceContentStart,
              withoutCarriageReturn(text, fenceContentStart, lineStart - 1),
            ),
          },
        });
        fence = null;
        previousLineWasBlank = false;
      }

      lineStart = lineBreak + 1;
      continue;
    }

    const isBlank: boolean = isBlankLine(text, lineStart, lineEnd);

    if (isBlank) {
      endRun();
      previousLineWasBlank = true;
      lineStart = lineBreak + 1;
      continue;
    }

    if (htmlBlockEnds !== null) {
      if (lineHoldsOneOf(text, lineStart, lineEnd, htmlBlockEnds)) {
        htmlBlockEnds = null;
      }
    } else {
      const opening: { character: number; length: number } | null =
        previousLineWasBlank ? getFenceOpening(text, lineStart, lineEnd) : null;

      if (opening !== null) {
        endRun();
        fence = opening;
        fenceContentStart = Math.min(text.length, lineBreak + 1);
        previousLineWasBlank = false;
        lineStart = lineBreak + 1;
        continue;
      }

      htmlBlockEnds = getOpenHtmlBlockEnds(text, lineStart, lineEnd);
    }

    runLineStarts.push(lineStart);
    previousLineWasBlank = false;
    lineStart = lineBreak + 1;
  }

  if (fence !== null) {
    // A fence never closed runs to the end of the text, but its line break.
    let contentEnd: number = text.length;

    if (contentEnd > fenceContentStart && text.charCodeAt(contentEnd - 1) === LINE_FEED) {
      contentEnd--;
    }

    segments.push({
      kind: "code",
      block: {
        contentStart: fenceContentStart,
        contentEnd: Math.max(
          fenceContentStart,
          withoutCarriageReturn(text, fenceContentStart, contentEnd),
        ),
      },
    });
  }

  endRun();

  return segments;
};

/*
 * Which runs to hold back: each that breaks a limit of its own (lines, the
 * length of a unit, nesting, cells), then the costliest by inline work until the rest are
 * within limits.maxInlineWork, then the longest by lines until the rest are
 * within limits.maxLines - the later of two equal ones first, so the start
 * of a text stays as it was written.
 */
const chooseRunsToHoldBack: (
  runs: Array<SlowMarkdownRun>,
  limits: SlowMarkdownLimits,
) => Set<SlowMarkdownRun> = (
  runs: Array<SlowMarkdownRun>,
  limits: SlowMarkdownLimits,
): Set<SlowMarkdownRun> => {
  const heldBack: Set<SlowMarkdownRun> = new Set<SlowMarkdownRun>();

  for (const run of runs) {
    if (
      run.lines > limits.maxRunLines ||
      run.longestUnit > limits.maxUnitLength ||
      run.nestingDepth > limits.maxNestingDepth ||
      run.cellsPerLine > limits.maxCellsPerLine
    ) {
      heldBack.add(run);
    }
  }

  const holdBackUntil: (
    measure: (run: SlowMarkdownRun) => number,
    limit: number,
  ) => void = (
    measure: (run: SlowMarkdownRun) => number,
    limit: number,
  ): void => {
    const kept: Array<{ run: SlowMarkdownRun; position: number }> = [];
    let total: number = 0;

    runs.forEach((run: SlowMarkdownRun, position: number): void => {
      if (!heldBack.has(run)) {
        kept.push({ run: run, position: position });
        total += measure(run);
      }
    });

    if (total <= limit) {
      return;
    }

    kept.sort(
      (
        a: { run: SlowMarkdownRun; position: number },
        b: { run: SlowMarkdownRun; position: number },
      ): number => {
        return measure(b.run) - measure(a.run) || b.position - a.position;
      },
    );

    for (const candidate of kept) {
      if (total <= limit) {
        return;
      }

      heldBack.add(candidate.run);
      total -= measure(candidate.run);
    }
  };

  holdBackUntil((run: SlowMarkdownRun): number => {
    return run.inlineWork;
  }, limits.maxInlineWork);

  holdBackUntil((run: SlowMarkdownRun): number => {
    return run.lines;
  }, limits.maxLines);

  return heldBack;
};

/*
 * `text` with the runs a parser would take too long to read held back, and,
 * with limits.holdBackCodeBlockContent, the content of its fenced code
 * blocks (see the top of this file). The same as `text` when it is no
 * longer than SLOW_MARKDOWN_MIN_LENGTH, or nothing in it is that costly.
 */
export const holdBackSlowMarkdown: (
  text: string,
  holder: SlowMarkdownHolder,
  limits: SlowMarkdownLimits,
) => string = (
  text: string,
  holder: SlowMarkdownHolder,
  limits: SlowMarkdownLimits,
): string => {
  if (typeof text !== "string") {
    return text;
  }

  let appliedLimits: SlowMarkdownLimits = limits;

  if (text.length <= SLOW_MARKDOWN_MIN_LENGTH) {
    // A short text: only a line nested too deep is held back (see above).
    if (!hasLineNestedDeeperThan(text, limits.maxNestingDepth)) {
      return text;
    }

    appliedLimits = {
      maxInlineWork: Number.POSITIVE_INFINITY,
      maxRunLines: Number.POSITIVE_INFINITY,
      maxLines: Number.POSITIVE_INFINITY,
      maxUnitLength: Number.POSITIVE_INFINITY,
      maxNestingDepth: limits.maxNestingDepth,
      maxCellsPerLine: Number.POSITIVE_INFINITY,
      holdBackCodeBlockContent: false,
    };
  }

  const segments: Array<Segment> = readSegments(text);
  const runs: Array<SlowMarkdownRun> = [];

  for (const segment of segments) {
    if (segment.kind === "run") {
      runs.push(segment.run);
    }
  }

  const heldBack: Set<SlowMarkdownRun> = chooseRunsToHoldBack(
    runs,
    appliedLimits,
  );

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;
  // The stretch of runs held back being read: where it starts and ends.
  let stretchStart: number = -1;
  let stretchEnd: number = -1;

  const endStretch: () => void = (): void => {
    if (stretchStart !== -1) {
      pieces.push(
        text.slice(copiedUpTo, stretchStart),
        holder.holdLines(text.slice(stretchStart, stretchEnd)),
      );
      copiedUpTo = stretchEnd;
      stretchStart = -1;
      stretchEnd = -1;
    }
  };

  for (const segment of segments) {
    if (segment.kind === "run") {
      if (heldBack.has(segment.run)) {
        if (stretchStart === -1) {
          stretchStart = segment.run.start;
        }

        stretchEnd = segment.run.end;
      } else {
        endStretch();
      }

      continue;
    }

    endStretch();

    const block: CodeBlock = segment.block;

    if (
      appliedLimits.holdBackCodeBlockContent &&
      block.contentEnd > block.contentStart
    ) {
      pieces.push(
        text.slice(copiedUpTo, block.contentStart),
        holder.holdCode(text.slice(block.contentStart, block.contentEnd)),
      );
      copiedUpTo = block.contentEnd;
    }
  }

  endStretch();

  if (pieces.length === 0) {
    return text;
  }

  pieces.push(text.slice(copiedUpTo));

  return pieces.join("");
};

/*
 * Whether a line of `text` starts with more than `maxDepth` quote and list
 * markers, one in another - read cheaply, with no line read further than
 * its markers.
 */
const hasLineNestedDeeperThan: (text: string, maxDepth: number) => boolean = (
  text: string,
  maxDepth: number,
): boolean => {
  let lineStart: number = 0;

  while (lineStart <= text.length) {
    const lineEnd: number = getLineEnd(text, lineStart);

    if (
      readLineStart(
        text,
        lineStart,
        withoutCarriageReturn(text, lineStart, lineEnd),
      ).nestingDepth > maxDepth
    ) {
      return true;
    }

    lineStart = lineEnd + 1;
  }

  return false;
};

/*
 * The runs of `text` and what each costs (see the top of this file): for
 * tests, and for a caller that decides with them itself.
 */
export const measureSlowMarkdownRuns: (
  text: string,
) => Array<SlowMarkdownRun> = (text: string): Array<SlowMarkdownRun> => {
  const runs: Array<SlowMarkdownRun> = [];

  for (const segment of readSegments(typeof text === "string" ? text : "")) {
    if (segment.kind === "run") {
      runs.push(segment.run);
    }
  }

  return runs;
};
