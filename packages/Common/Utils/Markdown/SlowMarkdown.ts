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
 *     line of "*a " took 53 s, of "[a](" 13 s, of "![a](" 20 s, of "`a" 3 s.
 *     And between two of those it reads the text up to the next "@" it
 *     could make an email address of: a line of "_a" took 14 s, of "a!" 6 s.
 *   - remark (the dashboard) did the same with different shapes - a line of
 *     "a* " took 9 s, of "a*" 26 s, of "](" 13 s, of "a.a." 8 s (an email
 *     address it tries from every dot), and 64 KB of snake_case words 0.9 s
 *     - and its time grows faster than linearly with the blocks of a text:
 *     a list of 16,000 items took 6 s, 4,000 small tables 8 s.
 *   - slackify (Slack) was slow on all of these, and on plain long blocks
 *     as well: a paragraph of 16,000 lines took 4 s, a line of "hello! "
 *     2 s.
 *   - marked, remark and slackify all ran out of stack on a line nested a
 *     few thousand quotes deep ("> > > ...").
 *
 * A notification can carry any of these: a response body, a log, a pasted
 * table. So before such a parser reads Markdown longer than
 * SLOW_MARKDOWN_MIN_LENGTH, its blocks are measured in one pass, and the
 * blocks that would cost it too much are held back whole. A block here is a
 * run of lines with no blank line between them, outside fenced code. Each
 * stretch of blocks held back becomes one token, and the caller writes the
 * text back where the parser put it, as it was written, a line on each line:
 * Markdown in it reads as written. What a run costs:
 *
 *   - its inline work, the most the parsers look through (getInlineWork):
 *     for each paragraph, list item or heading in it, the characters that
 *     can start inline Markdown (getInlineCharacterCount) times its length;
 *     and for each word - characters with no space between them - its
 *     punctuation times its length, which bounds what a parser reads from
 *     every punctuation character of a word to its end. The runs of the
 *     text together may cost limits.maxInlineWork; the costliest are held
 *     back until they do.
 *   - for marked (limits.countAsMarked: the emails), each line as marked
 *     reads it (readMarkedLine, #7228): a link, an image or a reference
 *     whose label closes costs it a copy of its block, not a look through
 *     the rest of it; what a complete link's parentheses or a definition
 *     hold is read once; a "&" or a "]" costs nothing; and a run of an
 *     email address's characters before an "@" costs the run times itself
 *     and the domain after it.
 *   - its lines: a run may have limits.maxRunLines, and all the runs and
 *     fenced code read as Markdown limits.maxLines together (the dashboard
 *     and Slack only: marked reads lines in linear time).
 *   - its longest paragraph, list item or heading, in lines
 *     (limits.maxUnitLines) and in characters (limits.maxUnitLength):
 *     Slack only - slackify reads a long list in good time, but not one
 *     long paragraph.
 *   - how deep its lines nest quotes and lists (limits.maxNestingDepth),
 *     and how many cells a table row of it has (limits.maxCellsPerLine).
 *
 * Fenced code is read in linear time by every parser: its content costs no
 * inline work, and a code block is only held back - whole, as text - when
 * there are more lines than limits.maxLines. With
 * limits.holdBackCodeBlockContent, where the lines of code would hold back
 * more than that, the content of each code block is held back as one token
 * instead, so a parser whose time grows with lines (remark, slackify) reads
 * one - the caller writes it back as it was, in the code block. A text whose
 * lines are within limits.maxLines with its code as written keeps its code
 * as it is.
 *
 * The measuring is conservative: when it cannot tell whether two lines are
 * one block or two for the parser, it counts them as one, which can only
 * make a run look costlier than it is. A fence is only taken for one where
 * every parser takes it the same way (readSegments); after a line that
 * could open or close a fence some other way, nothing more is skipped as
 * code. And anything held back is text to the parser, so a run that was
 * misjudged is shown as written, never parsed slowly.
 *
 * A text of at most SLOW_MARKDOWN_MIN_LENGTH characters renders in good
 * time in every shape but one, and renders exactly as it always has: only
 * a line nested deeper than limits.maxNestingDepth is held back from it -
 * remark ran out of stack on 2 KB of ">".
 *
 * Pure, with no Node or browser APIs, and no regular expression runs over
 * the text: the dashboard and the server both use it.
 */

import {
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../RegExpCharacterClasses";

/*
 * Markdown of at most this many characters is given to a parser as it is:
 * its slowest shapes take a few hundredths of a second.
 */
export const SLOW_MARKDOWN_MIN_LENGTH: number = 2048;

// How much of each kind of work a parser is given at most.
export interface SlowMarkdownLimits {
  /*
   * The inline work of all the runs read as Markdown together
   * (getInlineWork).
   */
  maxInlineWork: number;
  // The lines one run may have.
  maxRunLines: number;
  /*
   * The lines all the runs and code blocks read as Markdown may have
   * together - a code block's as the parser reads them.
   */
  maxLines: number;
  // The lines one paragraph, list item or heading may have.
  maxUnitLines: number;
  // The characters one paragraph, list item or heading may have.
  maxUnitLength: number;
  // The quote and list markers a line may start with.
  maxNestingDepth: number;
  // The "|" a line may have: the cells of a table row.
  maxCellsPerLine: number;
  // Whether the content of fenced code is held back as one token.
  holdBackCodeBlockContent: boolean;
  /*
   * Whether where a web or email address can start without brackets counts
   * toward inline work (getInlineCharacterCount): remark reads each of them
   * through the rest of its paragraph, marked does not.
   */
  countUrlLiterals: boolean;
  /*
   * Whether an "_" inside a word counts toward inline work: remark's GFM
   * reads each one through the rest of its paragraph (64 KB of snake_case
   * words took 0.9 s, four times as long 9 s); marked passes it by.
   */
  countWordUnderscores: boolean;
  /*
   * Whether a line is counted as marked (the emails) reads it
   * (readMarkedLine): a link or a reference whose brackets close costs
   * marked a copy of its block, not a look through the rest of it, and
   * what a link's parentheses or a definition hold after its label it
   * reads once. remark and slackify read these otherwise.
   */
  countAsMarked: boolean;
}

/*
 * What every parser takes in good time: inline work of 2^22 is about a
 * sixth of a second for marked, the slowest of them, in a long-running
 * process (39 ns for each character it looks through, at worst).
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
   * Whole lines - one or more runs or code blocks, with the blank lines
   * between - that the parser would take too long to read. Written back as
   * text, a line on each line.
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
  // Its paragraph, list item or heading of the most lines: how many.
  longestUnitLines: number;
  nestingDepth: number;
  cellsPerLine: number;
}

/*
 * A fenced code block: where its opening fence starts and its closing fence
 * ends (the text's end when it is never closed), where its content starts
 * and ends, and how many lines the parser reads for it.
 */
interface CodeBlock {
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  contentLines: number;
}

// The text read as runs of lines and fenced code blocks, in order.
type Segment =
  | { kind: "run"; run: SlowMarkdownRun }
  | { kind: "code"; block: CodeBlock };

// How the inline work of a run is counted (see SlowMarkdownLimits).
interface InlineCounting {
  countUrlLiterals: boolean;
  countWordUnderscores: boolean;
  countAsMarked: boolean;
}

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
const ASTERISK: number = 0x2a;
const UNDERSCORE: number = 0x5f;
const OPEN_BRACKET: number = 0x5b;
const CLOSE_BRACKET: number = 0x5d;
const OPEN_PARENTHESIS: number = 0x28;
const CLOSE_PARENTHESIS: number = 0x29;
const COLON: number = 0x3a;
const QUOTATION_MARK: number = 0x22;
const APOSTROPHE: number = 0x27;
const AT_SIGN: number = 0x40;
const SLASH: number = 0x2f;
const EXCLAMATION_MARK: number = 0x21;
const QUESTION_MARK: number = 0x3f;

const WORD_CHARACTER: RegExp = /[\p{L}\p{N}]/u;

// What a backslash escapes for marked: punctuation or a symbol, any script.
const PUNCTUATION_OR_SYMBOL: RegExp = /[\p{P}\p{S}]/u;

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

// Whether text[index, end) starts with "www." (any case).
const startsWithWww: (text: string, index: number, end: number) => boolean = (
  text: string,
  index: number,
  end: number,
): boolean => {
  return (
    index + 4 <= end &&
    (text.charCodeAt(index) | 0x20) === 0x77 &&
    (text.charCodeAt(index + 1) | 0x20) === 0x77 &&
    (text.charCodeAt(index + 2) | 0x20) === 0x77 &&
    text.charCodeAt(index + 3) === 0x2e
  );
};

/*
 * The characters of text[start, end) that can start or end inline Markdown,
 * and so make a parser look ahead through the rest of a block: emphasis and
 * strikethrough delimiters ("*", "_", "~") that can open or close - not
 * those with whitespace on both sides, nor an "_" inside a word unless
 * `counting.countWordUnderscores` - every backtick, "[" and "]", a "<" that
 * can start a tag or an autolink, a "\" that escapes, and a "&" that can
 * start an entity. With `counting.countUrlLiterals`, also where a web
 * address or an email address can start without brackets ("www.", "://",
 * "@"): remark reads each of those through the rest of its paragraph.
 */
export const getInlineCharacterCount: (
  text: string,
  start: number,
  end: number,
  counting?: Partial<InlineCounting>,
) => number = (
  text: string,
  start: number,
  end: number,
  counting: Partial<InlineCounting> = {},
): number => {
  let count: number = 0;
  let index: number = start;

  while (index < end) {
    const code: number = text.charCodeAt(index);

    if (code === ASTERISK || code === UNDERSCORE || code === TILDE) {
      let runEnd: number = index + 1;

      while (runEnd < end && text.charCodeAt(runEnd) === code) {
        runEnd++;
      }

      const before: number = index > start ? text.charCodeAt(index - 1) : NaN;
      const after: number = runEnd < end ? text.charCodeAt(runEnd) : NaN;

      const canNeitherOpenNorClose: boolean =
        isWhitespaceOrNothing(before) && isWhitespaceOrNothing(after);
      const isInsideWord: boolean =
        code === UNDERSCORE &&
        !counting.countWordUnderscores &&
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
      (isAsciiLetter(next) || next === 0x2f || next === 0x21 || next === 0x3f)
    ) {
      count++;
    } else if (code === BACKSLASH && isAsciiPunctuation(next)) {
      count++;
    } else if (code === 0x26 && (next === NUMBER_SIGN || isAsciiLetter(next))) {
      count++;
    } else if (
      counting.countUrlLiterals &&
      (code === 0x40 ||
        (code === 0x3a &&
          next === 0x2f &&
          index + 2 < end &&
          text.charCodeAt(index + 2) === 0x2f) ||
        ((code | 0x20) === 0x77 && startsWithWww(text, index, end)))
    ) {
      count++;
    }

    index++;
  }

  return count;
};

/*
 * For each word of text[start, end) - characters with no space or tab
 * between them - its ASCII punctuation times its length, summed. A parser
 * can read from a punctuation character to the end of its word: marked
 * reads ahead for an "@" from every "!", "*", "_", "~" or backtick of a
 * word, remark for one from every ".", "-", "+" or "_". Spoken text has
 * short words, and costs next to nothing here; a line of minified JSON or
 * "a.a.a." costs the square of its length.
 */
export const getWordPunctuationWork: (
  text: string,
  start: number,
  end: number,
) => number = (text: string, start: number, end: number): number => {
  let work: number = 0;
  let wordStart: number = start;
  let punctuation: number = 0;

  for (let index: number = start; index <= end; index++) {
    const code: number = index < end ? text.charCodeAt(index) : SPACE;

    if (isSpaceOrTab(code)) {
      work += punctuation * (index - wordStart);
      wordStart = index + 1;
      punctuation = 0;
    } else if (isAsciiPunctuation(code)) {
      punctuation++;
    }
  }

  return work;
};

/*
 * HOW MARKED READS A LINE (counting.countAsMarked: the emails, #7228).
 *
 * Measured on marked 12 where V8 compiles regular expressions unoptimized,
 * some shapes that the other parsers look ahead through cost marked far
 * less, and one costs it more:
 *
 *   - A link, an image or a reference whose label closes - "[text](address)",
 *     "![alt][label]", "[label][]", "[label]" - marked reads up to its
 *     closing bracket. But before it reads a block it masks each of them,
 *     each "<...>" and each escape, with a copy of the block: so each costs
 *     a copy of its unit, which is a sixteenth of a look through it or less
 *     (MARKED_MASKED_ITEM_SHARE). A paragraph of 1,000 references, one on
 *     each line, took marked 9 ms; one of 18,724 (256 KB) took 5.5 s.
 *   - What a complete link's parentheses hold - its address and its title -
 *     and a definition marked takes, label and all, marked takes as one
 *     piece and never reads as inline Markdown: it is counted once, not as
 *     the punctuation of a word times the word's length. A link to a
 *     megabyte of a query took marked 65 ms.
 *   - A "&" and a "]" cost it no more than a letter: a megabyte of "&amp;"
 *     took 140 ms, of "]" 103 ms.
 *   - A run of the characters an email address can hold, right before an
 *     "@", marked reads from each of its characters to the "@" and through
 *     the domain after it: the run times itself and the domain. 64 KB of
 *     letters before an "@" took it 26 s.
 *
 * A bracket that does not close, or a link whose address or title does not
 * close on its line, costs as it does for the other parsers - a look
 * through the rest of its unit - as do emphasis, code spans, tags and the
 * punctuation of words, and a link past what the tails of its line may
 * read (MARKED_TAIL_READING_SHARE).
 */

/*
 * What a link, a reference, a "<...>" or an escape that marked masks costs
 * it, as a share of a character it looks ahead from: a copy of the unit,
 * where that character is a look through it. Measured, a copy cost from a
 * fiftieth (references, in text of Latin letters) to a sixteenth (escapes
 * of symbols, in text of other scripts) of a look.
 */
export const MARKED_MASKED_ITEM_SHARE: number = 16;

/*
 * The longest label read as one that closes; past it a "[" counts as one
 * that never does. A link label of CommonMark is at most 999 characters.
 */
export const MAX_MARKED_LABEL_LENGTH: number = 999;

// What the unit of a run being read costs so far (measureRun).
interface UnitWork {
  // Characters that make a parser look ahead through the rest of the unit.
  characters: number;
  // What marked masks with a copy of the unit (readMarkedLine).
  maskedItems: number;
  /*
   * Work that does not grow with the unit: the punctuation of words, and
   * for marked what it reads once and the runs before an "@".
   */
  work: number;
  // For marked: whether a "<" is open that a ">" would close into "<...>".
  isLessThanOpen: boolean;
  // For marked: whether every line of the unit so far is a definition.
  mayDefine: boolean;
}

const newUnitWork: () => UnitWork = (): UnitWork => {
  return {
    characters: 0,
    maskedItems: 0,
    work: 0,
    isLessThanOpen: false,
    mayDefine: true,
  };
};

/*
 * What marked reads as a character of an email address before its "@":
 * ASCII letters, digits and .!#$%&'*+/=?_`{|}~-
 */
const isMarkedEmailCode: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    isAsciiLetter(code) ||
    isDigit(code) ||
    (code >= 0x23 && code <= 0x27) ||
    code === EXCLAMATION_MARK ||
    code === ASTERISK ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e ||
    code === SLASH ||
    code === 0x3d ||
    code === QUESTION_MARK ||
    code === UNDERSCORE ||
    code === BACKTICK ||
    (code >= 0x7b && code <= TILDE)
  );
};

// What marked reads as a character of an email address's domain.
const isMarkedDomainCode: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    isAsciiLetter(code) ||
    isDigit(code) ||
    code === 0x2e ||
    code === UNDERSCORE ||
    code === 0x2d
  );
};

/*
 * The code units of the character at `index` - after a "\" - when marked
 * masks the escape (punctuation or a symbol, of any script), or 0.
 */
const getEscapedLength: (text: string, index: number, end: number) => number = (
  text: string,
  index: number,
  end: number,
): number => {
  if (index >= end) {
    return 0;
  }

  const code: number = text.charCodeAt(index);

  if (code < 0x80) {
    return isAsciiPunctuation(code) ? 1 : 0;
  }

  const codePoint: number = text.codePointAt(index) ?? code;

  if (!PUNCTUATION_OR_SYMBOL.test(String.fromCodePoint(codePoint))) {
    return 0;
  }

  return codePoint > 0xffff ? 2 : 1;
};

/*
 * Where the label whose "[" is at `open` closes: the index of its "]" - or
 * -1 when a "[", a backtick or the line's end comes first, or the label is
 * longer than MAX_MARKED_LABEL_LENGTH. A "\" escapes the character after
 * it. A code span inside a label can hold a "]" for marked, so a label
 * with a backtick counts as one that never closes.
 */
const readClosedLabel: (text: string, open: number, end: number) => number = (
  text: string,
  open: number,
  end: number,
): number => {
  const limit: number = Math.min(end, open + 2 + MAX_MARKED_LABEL_LENGTH);
  let index: number = open + 1;

  while (index < limit) {
    const code: number = text.charCodeAt(index);

    if (code === CLOSE_BRACKET) {
      return index;
    }

    if (code === OPEN_BRACKET || code === BACKTICK) {
      return -1;
    }

    index += code === BACKSLASH ? 2 : 1;
  }

  return -1;
};

/*
 * Where the title whose quote or "(" is at `open` ends - past its closing
 * character - or -1 where it does not close on the line. A "\" escapes in
 * every title of a link (`isInLink`); in a definition's, only in one in
 * '"', and one in "()" holds no "(".
 */
const readTitleEnd: (
  text: string,
  open: number,
  end: number,
  isInLink: boolean,
) => number = (
  text: string,
  open: number,
  end: number,
  isInLink: boolean,
): number => {
  const opener: number = text.charCodeAt(open);
  const closer: number =
    opener === OPEN_PARENTHESIS ? CLOSE_PARENTHESIS : opener;
  const escapes: boolean = isInLink || opener === QUOTATION_MARK;

  if (
    opener !== QUOTATION_MARK &&
    opener !== APOSTROPHE &&
    opener !== OPEN_PARENTHESIS
  ) {
    return -1;
  }

  let index: number = open + 1;

  while (index < end) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH && escapes) {
      index += 2;
      continue;
    }

    if (code === closer) {
      return index + 1;
    }

    if (code === OPEN_PARENTHESIS && opener === OPEN_PARENTHESIS && !isInLink) {
      return -1;
    }

    index++;
  }

  return -1;
};

/*
 * How much the link tails of a line may read (readLinkTail), as a multiple
 * of the line. A tail that closes is read once - the line is read on from
 * its end - but one whose address or title does not close is read again by
 * each tail inside it: a line of 64 KB of "[a](" would cost the measure the
 * square of the line - 2.9 s, and a megabyte of such lines 40 s. Past this
 * a tail reads as one that does not close: a look through the rest of its
 * unit, which only makes the line look costlier. Tails read more than
 * their line only inside tails that do not close, which marked reads again
 * for each of them too.
 */
export const MARKED_TAIL_READING_SHARE: number = 8;

// What the link tails of the line being read may still read, in characters.
interface TailReading {
  left: number;
}

/*
 * Where the link whose "(" is at `open` - right after its label's "]" -
 * ends as marked ends it: past the ")" after its address and title, or -1
 * where they do not close on the line (marked can close them on a later
 * line: counted as not closing, which only makes the line look costlier).
 *
 * The address is in "<>" - no "<" inside, a "\" escaping - or runs to
 * white space or a control character, with its parentheses balanced: a ")"
 * with none open ends the link. After white space, a title in '"', "'" or
 * "()" may follow, then white space and the ")".
 *
 * Where white space comes before an address that a ")" with none open
 * ends, marked ends the link that many characters before its ")", and
 * reads the end of the address as inline Markdown: such a link counts as
 * not closing.
 *
 * It reads no more than `reading` has left, and takes what it read from
 * it: a tail that would read past that counts as not closing.
 */
const readLinkTail: (
  text: string,
  open: number,
  end: number,
  reading: TailReading,
) => number = (
  text: string,
  open: number,
  end: number,
  reading: TailReading,
): number => {
  const limit: number = Math.min(end, open + 1 + Math.max(reading.left, 0));

  // Takes what was read, up to `readTo`, and returns where the tail ends.
  const read: (tailEnd: number, readTo: number) => number = (
    tailEnd: number,
    readTo: number,
  ): number => {
    reading.left -= readTo - open;
    return tailEnd;
  };

  let index: number = open + 1;

  while (index < limit && isWhiteSpaceCode(text.charCodeAt(index))) {
    index++;
  }

  const hasSpaceBefore: boolean = index > open + 1;

  if (index < limit && text.charCodeAt(index) === LESS_THAN) {
    index++;

    for (;;) {
      if (index >= limit) {
        return read(-1, limit);
      }

      const code: number = text.charCodeAt(index);

      if (code === BACKSLASH) {
        index += 2;
        continue;
      }

      if (code === LESS_THAN) {
        return read(-1, index + 1);
      }

      index++;

      if (code === GREATER_THAN) {
        break;
      }
    }
  } else {
    let depth: number = 0;

    while (index < limit) {
      const code: number = text.charCodeAt(index);

      if (isWhiteSpaceCode(code) || code < SPACE) {
        break;
      }

      if (code === BACKSLASH && index + 1 < limit) {
        const escaped: number = text.charCodeAt(index + 1);

        index += isWhiteSpaceCode(escaped) || escaped < SPACE ? 1 : 2;
        continue;
      }

      if (code === OPEN_PARENTHESIS) {
        depth++;
      } else if (code === CLOSE_PARENTHESIS) {
        if (depth === 0) {
          return read(hasSpaceBefore ? -1 : index + 1, index + 1);
        }

        depth--;
      }

      index++;
    }

    if (depth !== 0) {
      return read(-1, index);
    }
  }

  // White space, a title after it if any, white space, and the ")".
  let afterSpace: number = index;

  while (afterSpace < limit && isWhiteSpaceCode(text.charCodeAt(afterSpace))) {
    afterSpace++;
  }

  if (afterSpace < limit && text.charCodeAt(afterSpace) === CLOSE_PARENTHESIS) {
    return read(afterSpace + 1, afterSpace + 1);
  }

  const opener: number = afterSpace < limit ? text.charCodeAt(afterSpace) : NaN;

  if (
    afterSpace === index ||
    (opener !== QUOTATION_MARK &&
      opener !== APOSTROPHE &&
      opener !== OPEN_PARENTHESIS)
  ) {
    return read(-1, afterSpace);
  }

  let titleEnd: number = readTitleEnd(text, afterSpace, limit, true);

  if (titleEnd === -1) {
    // A title that does not close is read to the limit.
    return read(-1, limit);
  }

  while (titleEnd < limit && isWhiteSpaceCode(text.charCodeAt(titleEnd))) {
    titleEnd++;
  }

  return read(
    titleEnd < limit && text.charCodeAt(titleEnd) === CLOSE_PARENTHESIS
      ? titleEnd + 1
      : -1,
    titleEnd + 1,
  );
};

/*
 * Where the link or image whose label's "[" is at `open` ends for marked -
 * past the ")" after its address and title - or -1 where its label or its
 * address does not close on the line (getMarkedLineWork reads it as a look
 * through the rest of its unit there). Exported for tests.
 */
export const getMarkedLinkEnd: (
  text: string,
  open: number,
  end: number,
) => number = (text: string, open: number, end: number): number => {
  const close: number = readClosedLabel(text, open, end);

  if (
    close === -1 ||
    close + 1 >= end ||
    text.charCodeAt(close + 1) !== OPEN_PARENTHESIS
  ) {
    return -1;
  }

  return readLinkTail(text, close + 1, end, {
    left: Number.POSITIVE_INFINITY,
  });
};

/*
 * Where the address of the link reference definition text[start, end) is
 * starts - or -1 when the line is not one marked takes whole: "[label]:",
 * spaces, an address in "<>" or up to white space, and, after spaces, an
 * optional title, then spaces to the line's end. Exported for tests.
 */
export const getMarkedDefinitionAddressStart: (
  text: string,
  start: number,
  end: number,
) => number = (text: string, start: number, end: number): number => {
  if (start >= end || text.charCodeAt(start) !== OPEN_BRACKET) {
    return -1;
  }

  const close: number = readClosedLabel(text, start, end);

  if (
    close === -1 ||
    close + 1 >= end ||
    text.charCodeAt(close + 1) !== COLON
  ) {
    return -1;
  }

  // A label of white space alone is no label.
  let hasText: boolean = false;

  for (let index: number = start + 1; index < close && !hasText; index++) {
    hasText = !isWhiteSpaceCode(text.charCodeAt(index));
  }

  if (!hasText) {
    return -1;
  }

  let index: number = close + 2;

  while (index < end && text.charCodeAt(index) === SPACE) {
    index++;
  }

  const addressStart: number = index;

  if (index >= end) {
    return -1;
  }

  if (text.charCodeAt(index) === LESS_THAN) {
    index++;

    while (index < end && text.charCodeAt(index) !== GREATER_THAN) {
      if (isLineTerminatorCode(text.charCodeAt(index))) {
        return -1;
      }

      index++;
    }

    if (index >= end) {
      return -1;
    }

    index++;
  } else {
    while (index < end && !isWhiteSpaceCode(text.charCodeAt(index))) {
      index++;
    }
  }

  let afterSpaces: number = index;

  while (afterSpaces < end && text.charCodeAt(afterSpaces) === SPACE) {
    afterSpaces++;
  }

  if (afterSpaces >= end) {
    return addressStart;
  }

  if (afterSpaces === index) {
    return -1;
  }

  let titleEnd: number = readTitleEnd(text, afterSpaces, end, false);

  if (titleEnd === -1) {
    return -1;
  }

  while (titleEnd < end && text.charCodeAt(titleEnd) === SPACE) {
    titleEnd++;
  }

  return titleEnd >= end ? addressStart : -1;
};

/*
 * What the line text[start, end) costs marked, added to its unit (see
 * HOW MARKED READS A LINE): characters it looks ahead from through the
 * unit, what it masks with a copy of the unit, and the line's work that
 * does not grow with the unit - the punctuation of its words as
 * getWordPunctuationWork counts it, what a complete link's parentheses
 * hold, once, and the runs before an "@". A definition marked takes costs
 * its length, once. A definition is one marked takes only as the first
 * line of its unit or after others: after a paragraph's line, marked reads
 * it as the paragraph's text.
 */
const readMarkedLine: (
  text: string,
  start: number,
  end: number,
  counting: InlineCounting,
  unit: UnitWork,
) => void = (
  text: string,
  start: number,
  end: number,
  counting: InlineCounting,
  unit: UnitWork,
): void => {
  unit.mayDefine =
    unit.mayDefine && getMarkedDefinitionAddressStart(text, start, end) !== -1;

  if (unit.mayDefine) {
    /*
     * marked's block rule takes the definition whole, its label too: no
     * part of it is inline Markdown, so it costs its length, once - and a
     * block of many definitions costs no more than their length.
     */
    unit.work += end - start;
    return;
  }

  // What marked reads once and is not counted otherwise: [skipFrom, skipTo).
  let skipFrom: number = -1;
  let skipTo: number = end;
  let wordStart: number = start;
  let wordPunctuation: number = 0;
  // Where the run of an email address's characters being read starts.
  let emailRunStart: number = start;
  /*
   * Characters from here on are read for inline Markdown: an escape or a
   * delimiter run took the ones before.
   */
  let inlineFrom: number = start;
  /*
   * Where the last reference's label closed, and whether it was the label
   * of a "[text][label]": the label after the text is one masked item.
   */
  let referenceEnd: number = -1;
  let wasLabelOfText: boolean = false;
  // What the line's link tails may still read (readLinkTail).
  const tailReading: TailReading = {
    left: MARKED_TAIL_READING_SHARE * (end - start),
  };
  let index: number = start;

  while (index < end) {
    if (index === skipFrom) {
      unit.work += skipTo - skipFrom;
      index = skipTo;
      emailRunStart = index;
      inlineFrom = index;
      skipFrom = -1;
      continue;
    }

    const code: number = text.charCodeAt(index);

    // The punctuation of words, as getWordPunctuationWork counts it.
    if (isSpaceOrTab(code)) {
      unit.work += wordPunctuation * (index - wordStart);
      wordStart = index + 1;
      wordPunctuation = 0;
    } else if (isAsciiPunctuation(code)) {
      wordPunctuation++;
    }

    if (code === AT_SIGN && index > emailRunStart) {
      let domainEnd: number = index + 1;

      while (
        domainEnd < end &&
        isMarkedDomainCode(text.charCodeAt(domainEnd))
      ) {
        domainEnd++;
      }

      const run: number = index - emailRunStart;

      unit.work += run * (run + domainEnd - index - 1);
    }

    if (!isMarkedEmailCode(code)) {
      emailRunStart = index + 1;
    }

    if (index < inlineFrom) {
      index++;
      continue;
    }

    const next: number = index + 1 < end ? text.charCodeAt(index + 1) : NaN;

    if (code === ASTERISK || code === UNDERSCORE || code === TILDE) {
      let runEnd: number = index + 1;

      while (runEnd < end && text.charCodeAt(runEnd) === code) {
        runEnd++;
      }

      const before: number = index > start ? text.charCodeAt(index - 1) : NaN;
      const after: number = runEnd < end ? text.charCodeAt(runEnd) : NaN;
      const canNeitherOpenNorClose: boolean =
        isWhitespaceOrNothing(before) && isWhitespaceOrNothing(after);
      const isInsideWord: boolean =
        code === UNDERSCORE &&
        !counting.countWordUnderscores &&
        index > start &&
        runEnd < end &&
        isWordCharacterAt(text, index - 1) &&
        isWordCharacterAt(text, runEnd);

      if (!canNeitherOpenNorClose && !isInsideWord) {
        unit.characters += runEnd - index;
      }

      inlineFrom = runEnd;
    } else if (code === BACKTICK) {
      unit.characters++;
    } else if (code === OPEN_BRACKET) {
      const close: number = readClosedLabel(text, index, end);
      const tailEnd: number =
        close !== -1 &&
        close + 1 < end &&
        text.charCodeAt(close + 1) === OPEN_PARENTHESIS
          ? readLinkTail(text, close + 1, end, tailReading)
          : -2;

      if (close === -1 || tailEnd === -1) {
        // A label or an address that does not close: a look through.
        unit.characters++;
      } else if (tailEnd >= 0) {
        unit.maskedItems++;
        skipFrom = close + 1;
        skipTo = tailEnd;
        referenceEnd = -1;
      } else {
        if (index === referenceEnd && !wasLabelOfText) {
          wasLabelOfText = true;
        } else {
          unit.maskedItems++;
          wasLabelOfText = false;
        }

        referenceEnd = close + 1;
      }
    } else if (code === LESS_THAN) {
      if (
        isAsciiLetter(next) ||
        next === SLASH ||
        next === EXCLAMATION_MARK ||
        next === QUESTION_MARK
      ) {
        unit.characters++;
        unit.isLessThanOpen = false;
      } else {
        unit.isLessThanOpen = true;
      }
    } else if (code === GREATER_THAN) {
      if (unit.isLessThanOpen) {
        unit.maskedItems++;
        unit.isLessThanOpen = false;
      }
    } else if (code === BACKSLASH) {
      const escaped: number = getEscapedLength(text, index + 1, end);

      if (escaped > 0) {
        unit.maskedItems++;
        inlineFrom = index + 1 + escaped;
      }
    } else if (
      counting.countUrlLiterals &&
      (code === AT_SIGN ||
        (code === COLON &&
          next === SLASH &&
          index + 2 < end &&
          text.charCodeAt(index + 2) === SLASH) ||
        ((code | 0x20) === 0x77 && startsWithWww(text, index, end)))
    ) {
      unit.characters++;
    }

    index++;
  }

  unit.work += wordPunctuation * (end - wordStart);
};

// What one line costs marked (getMarkedLineWork).
export interface MarkedLineWork {
  // Characters marked looks ahead from through the rest of the unit.
  characters: number;
  // What it masks with a copy of the unit (MARKED_MASKED_ITEM_SHARE).
  maskedItems: number;
  // What does not grow with the unit (see readMarkedLine).
  work: number;
  // Whether the line is a definition marked takes, its address read once.
  isDefinition: boolean;
}

/*
 * What the line text[start, end) costs marked as the first line of its
 * unit (readMarkedLine). Exported for tests.
 */
export const getMarkedLineWork: (
  text: string,
  start: number,
  end: number,
  counting?: Partial<InlineCounting>,
) => MarkedLineWork = (
  text: string,
  start: number,
  end: number,
  counting: Partial<InlineCounting> = {},
): MarkedLineWork => {
  const unit: UnitWork = newUnitWork();

  readMarkedLine(
    text,
    start,
    end,
    {
      countUrlLiterals: Boolean(counting.countUrlLiterals),
      countWordUnderscores: Boolean(counting.countWordUnderscores),
      countAsMarked: true,
    },
    unit,
  );

  return {
    characters: unit.characters,
    maskedItems: unit.maskedItems,
    work: unit.work,
    isDefinition: unit.mayDefine,
  };
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

// The fence a code block opened with: its character, and how many of it.
interface Fence {
  character: number;
  length: number;
}

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
) => Fence | null = (
  text: string,
  start: number,
  end: number,
): Fence | null => {
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
 * Whether the line text[start, end) starts - after spaces, tabs, and any
 * quote and list markers - with a run of three or more backticks or tildes
 * that a parser could read as a fence in some container: a run of
 * backticks with another backtick after it on the line is the start of a
 * code span, never a fence.
 */
const isFenceLikeLine: (text: string, start: number, end: number) => boolean = (
  text: string,
  start: number,
  end: number,
): boolean => {
  let index: number = start;

  // Spaces, tabs, quote markers and list markers ("-", "*", "+", "1.").
  while (index < end) {
    const code: number = text.charCodeAt(index);

    if (
      isSpaceOrTab(code) ||
      code === GREATER_THAN ||
      code === 0x2d ||
      code === ASTERISK ||
      code === 0x2b ||
      isDigit(code) ||
      code === 0x2e ||
      code === 0x29
    ) {
      index++;
      continue;
    }

    break;
  }

  const character: number = text.charCodeAt(index);

  if (character !== BACKTICK && character !== TILDE) {
    return false;
  }

  let runEnd: number = index;

  while (runEnd < end && text.charCodeAt(runEnd) === character) {
    runEnd++;
  }

  if (runEnd - index < 3) {
    return false;
  }

  if (character === BACKTICK) {
    for (let after: number = runEnd; after < end; after++) {
      if (text.charCodeAt(after) === BACKTICK) {
        return false;
      }
    }
  }

  return true;
};

/*
 * Whether the line closes a fence of `fence.length` `fence.character`s as
 * every parser reads one: up to three spaces, at least as long a run of the
 * character, then nothing but spaces. (marked also closes on a run followed
 * by other backticks and tildes, CommonMark on one followed by tabs: such a
 * line is one a parser may read either way - see readSegments.)
 */
const isFenceClosing: (
  text: string,
  start: number,
  end: number,
  fence: Fence,
) => boolean = (
  text: string,
  start: number,
  end: number,
  fence: Fence,
): boolean => {
  let index: number = start;

  while (index < end && index - start < 3 && text.charCodeAt(index) === SPACE) {
    index++;
  }

  let runEnd: number = index;

  while (runEnd < end && text.charCodeAt(runEnd) === fence.character) {
    runEnd++;
  }

  if (runEnd - index < fence.length) {
    return false;
  }

  for (let after: number = runEnd; after < end; after++) {
    if (text.charCodeAt(after) !== SPACE) {
      return false;
    }
  }

  return true;
};

/*
 * Whether some parser could close a fence of `fence.length`
 * `fence.character`s on the line: up to three spaces, then at least as long
 * a run of the character, whatever follows (see isFenceClosing).
 */
const mayCloseFence: (
  text: string,
  start: number,
  end: number,
  fence: Fence,
) => boolean = (
  text: string,
  start: number,
  end: number,
  fence: Fence,
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
 * code.
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
  const head: string = text
    .slice(index, Math.min(end, index + 10))
    .toLowerCase();

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
  /*
   * Quote and list markers it starts with, one in another - or, when it
   * has markers and more, its indentation in fours of columns.
   */
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
const isThematicBreak: (text: string, start: number, end: number) => boolean = (
  text: string,
  start: number,
  end: number,
): boolean => {
  let marker: number = NaN;
  let count: number = 0;

  for (let index: number = start; index < end; index++) {
    const code: number = text.charCodeAt(index);

    if (isSpaceOrTab(code)) {
      continue;
    }

    if (code !== ASTERISK && code !== 0x2d && code !== UNDERSCORE) {
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
const readLineStart: (text: string, start: number, end: number) => LineStart = (
  text: string,
  start: number,
  end: number,
): LineStart => {
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
  // The columns of whitespace before and between the markers (a tab is 4).
  let indentationColumns: number = 0;

  // The character after a one-character marker: a space, a tab or the end.
  const endsMarker: (position: number) => boolean = (
    position: number,
  ): boolean => {
    return position >= end || isSpaceOrTab(text.charCodeAt(position));
  };

  for (;;) {
    let afterSpaces: number = index;

    while (afterSpaces < end && isSpaceOrTab(text.charCodeAt(afterSpaces))) {
      indentationColumns += text.charCodeAt(afterSpaces) === TAB ? 4 : 1;
      afterSpaces++;
    }

    if (afterSpaces >= end) {
      index = afterSpaces;
      break;
    }

    const indentation: number = afterSpaces - index;
    const code: number = text.charCodeAt(afterSpaces);

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
      (code === 0x2d || code === ASTERISK || code === 0x2b) &&
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
    /*
     * A list nests by indentation as well as by markers: an item indented
     * a column or two more than the one before is an item inside it, so
     * on a line with markers every four columns of indentation count as a
     * level. A line with none - indented code, pretty-printed JSON - does
     * not nest.
     */
    nestingDepth:
      nestingDepth > 0 || firstMarker !== null
        ? Math.max(nestingDepth, Math.floor(indentationColumns / 4))
        : nestingDepth,
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
 * the same kind started: elsewhere it can be a paragraph's next line. The
 * punctuation of its words is added to it, line by line
 * (getWordPunctuationWork).
 */
const measureRun: (
  text: string,
  lineStarts: Array<number>,
  counting: InlineCounting,
) => SlowMarkdownRun = (
  text: string,
  lineStarts: Array<number>,
  counting: InlineCounting,
): SlowMarkdownRun => {
  let inlineWork: number = 0;
  let longestUnit: number = 0;
  let longestUnitLines: number = 0;
  let nestingDepth: number = 0;
  let cellsPerLine: number = 0;
  let unitLength: number = 0;
  let unitLines: number = 0;
  let unit: UnitWork = newUnitWork();
  // What started the unit being read, if a marker did.
  let unitKind: string | null = null;

  // Adds what the unit read costs: marked's copies of it in their share.
  const addUnit: () => void = (): void => {
    inlineWork +=
      unit.characters * unitLength +
      Math.ceil((unit.maskedItems * unitLength) / MARKED_MASKED_ITEM_SHARE) +
      unit.work;
    longestUnit = Math.max(longestUnit, unitLength);
    longestUnitLines = Math.max(longestUnitLines, unitLines);
  };

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
      addUnit();
      unitLength = 0;
      unitLines = 0;
      unit = newUnitWork();
      unitKind = start.unitStart;
    }

    unitLength += lineEnd - lineStart + 1;
    unitLines++;

    if (counting.countAsMarked) {
      readMarkedLine(text, start.contentStart, lineEnd, counting, unit);
    } else {
      unit.characters += getInlineCharacterCount(
        text,
        start.contentStart,
        lineEnd,
        counting,
      );
      unit.work += getWordPunctuationWork(text, start.contentStart, lineEnd);
    }

    nestingDepth = Math.max(nestingDepth, start.nestingDepth);
    cellsPerLine = Math.max(
      cellsPerLine,
      getPipeCount(text, start.contentStart, lineEnd),
    );
  }

  addUnit();

  const lastLineStart: number = lineStarts[lineStarts.length - 1]!;

  return {
    start: lineStarts[0]!,
    end: withoutCarriageReturn(
      text,
      lastLineStart,
      getLineEnd(text, lastLineStart),
    ),
    lines: lineStarts.length,
    inlineWork: inlineWork,
    longestUnit: longestUnit,
    longestUnitLines: longestUnitLines,
    nestingDepth: nestingDepth,
    cellsPerLine: cellsPerLine,
  };
};

/*
 * The text read as runs of lines and fenced code blocks (see the top of this
 * file).
 *
 * A code block's content costs no inline work, so a line read as code here
 * must be code to the parser too. A fence is only read as one where every
 * parser reads one the same way: it opens at the very start of a line after
 * a blank line (or at the text's start) - marked can read a fence right
 * after a paragraph's line as part of a heading - never inside an HTML block
 * that runs on past blank lines, and it closes on a line every parser
 * closes it on (isFenceClosing). Any other line that a parser could read as
 * a fence - indented, in a quote or a list item, after a paragraph's line,
 * or one that closes the block for one parser only - could leave this and
 * the parser apart on which lines are code from there on: after it, no
 * more code is read as code, and every line left is measured as Markdown.
 */
const readSegments: (
  text: string,
  counting: InlineCounting,
) => Array<Segment> = (
  text: string,
  counting: InlineCounting,
): Array<Segment> => {
  const segments: Array<Segment> = [];
  let runLineStarts: Array<number> = [];
  let previousLineWasBlank: boolean = true;
  let fence: Fence | null = null;
  let fenceStart: number = 0;
  let fenceContentStart: number = 0;
  let fenceContentLines: number = 0;
  let htmlBlockEnds: ReadonlyArray<string> | null = null;
  // Whether a fence may still be read as one (see above).
  let isFenceReadable: boolean = true;

  const endRun: () => void = (): void => {
    if (runLineStarts.length > 0) {
      segments.push({
        kind: "run",
        run: measureRun(text, runLineStarts, counting),
      });
      runLineStarts = [];
    }
  };

  const pushCode: (contentEnd: number, end: number) => void = (
    contentEnd: number,
    end: number,
  ): void => {
    segments.push({
      kind: "code",
      block: {
        start: fenceStart,
        end: end,
        contentStart: fenceContentStart,
        contentEnd: Math.max(
          fenceContentStart,
          withoutCarriageReturn(text, fenceContentStart, contentEnd),
        ),
        contentLines: fenceContentLines,
      },
    });
  };

  let lineStart: number = 0;

  while (lineStart <= text.length) {
    const lineBreak: number = getLineEnd(text, lineStart);
    const lineEnd: number = withoutCarriageReturn(text, lineStart, lineBreak);

    if (fence !== null) {
      if (isFenceClosing(text, lineStart, lineEnd, fence)) {
        // Before the closer's line, and a "\r" its line break left.
        pushCode(Math.max(fenceContentStart, lineStart - 1), lineEnd);
        fence = null;
        // A new block starts on the next line, as after a blank line.
        previousLineWasBlank = true;
        lineStart = lineBreak + 1;
        continue;
      }

      if (!mayCloseFence(text, lineStart, lineEnd, fence)) {
        fenceContentLines++;
        lineStart = lineBreak + 1;
        continue;
      }

      /*
       * A line a parser may close the block on, and another not: the code
       * block ends here for this count, and this line and every line after
       * it are measured as Markdown.
       */
      pushCode(
        Math.max(fenceContentStart, lineStart - 1),
        withoutCarriageReturn(text, fenceStart, lineStart - 1),
      );
      fence = null;
      isFenceReadable = false;
    }

    const isBlank: boolean = isBlankLine(text, lineStart, lineEnd);

    if (isBlank) {
      endRun();
      previousLineWasBlank = true;
      lineStart = lineBreak + 1;
      continue;
    }

    const isFenceLike: boolean = isFenceLikeLine(text, lineStart, lineEnd);

    if (htmlBlockEnds !== null) {
      if (lineHoldsOneOf(text, lineStart, lineEnd, htmlBlockEnds)) {
        htmlBlockEnds = null;
      }

      if (isFenceLike) {
        isFenceReadable = false;
      }
    } else {
      const opening: Fence | null =
        isFenceReadable && previousLineWasBlank
          ? getFenceOpening(text, lineStart, lineEnd)
          : null;

      if (opening !== null) {
        endRun();
        fence = opening;
        fenceStart = lineStart;
        fenceContentStart = Math.min(text.length, lineBreak + 1);
        fenceContentLines = 0;
        previousLineWasBlank = false;
        lineStart = lineBreak + 1;
        continue;
      }

      if (isFenceLike) {
        isFenceReadable = false;
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

    if (
      contentEnd > fenceContentStart &&
      text.charCodeAt(contentEnd - 1) === LINE_FEED
    ) {
      contentEnd--;
    }

    pushCode(contentEnd, text.length);
  }

  endRun();

  return segments;
};

/*
 * The lines a parser reads for a code block: its fences, and its content -
 * one line when the content is held back as one token.
 */
const getCodeBlockLines: (
  block: CodeBlock,
  limits: SlowMarkdownLimits,
) => number = (block: CodeBlock, limits: SlowMarkdownLimits): number => {
  return (
    2 +
    (limits.holdBackCodeBlockContent
      ? Math.min(1, block.contentLines)
      : block.contentLines)
  );
};

/*
 * Which segments to hold back: each run that breaks a limit of its own
 * (lines, the lines and length of a unit, nesting, cells), then the
 * costliest runs by inline work until the rest are within
 * limits.maxInlineWork, then the longest runs and code blocks by lines
 * until the rest are within limits.maxLines - the later of two equal ones
 * first, so the start of a text stays as it was written.
 */
const chooseSegmentsToHoldBack: (
  segments: Array<Segment>,
  limits: SlowMarkdownLimits,
) => Set<Segment> = (
  segments: Array<Segment>,
  limits: SlowMarkdownLimits,
): Set<Segment> => {
  const heldBack: Set<Segment> = new Set<Segment>();

  for (const segment of segments) {
    if (segment.kind !== "run") {
      continue;
    }

    const run: SlowMarkdownRun = segment.run;

    if (
      run.lines > limits.maxRunLines ||
      run.longestUnitLines > limits.maxUnitLines ||
      run.longestUnit > limits.maxUnitLength ||
      run.nestingDepth > limits.maxNestingDepth ||
      run.cellsPerLine > limits.maxCellsPerLine
    ) {
      heldBack.add(segment);
    }
  }

  const holdBackUntil: (
    measure: (segment: Segment) => number | null,
    limit: number,
  ) => void = (
    measure: (segment: Segment) => number | null,
    limit: number,
  ): void => {
    const kept: Array<{ segment: Segment; size: number; position: number }> =
      [];
    let total: number = 0;

    segments.forEach((segment: Segment, position: number): void => {
      const size: number | null = measure(segment);

      if (size === null || heldBack.has(segment)) {
        return;
      }

      kept.push({ segment: segment, size: size, position: position });
      total += size;
    });

    if (total <= limit) {
      return;
    }

    kept.sort(
      (
        a: { size: number; position: number },
        b: { size: number; position: number },
      ): number => {
        return b.size - a.size || b.position - a.position;
      },
    );

    for (const candidate of kept) {
      if (total <= limit) {
        return;
      }

      heldBack.add(candidate.segment);
      total -= candidate.size;
    }
  };

  if (Number.isFinite(limits.maxInlineWork)) {
    holdBackUntil((segment: Segment): number | null => {
      return segment.kind === "run" ? segment.run.inlineWork : null;
    }, limits.maxInlineWork);
  }

  if (Number.isFinite(limits.maxLines)) {
    holdBackUntil((segment: Segment): number => {
      return segment.kind === "run"
        ? segment.run.lines
        : getCodeBlockLines(segment.block, limits);
    }, limits.maxLines);
  }

  return heldBack;
};

// Whether two sets of segments hold the same segments.
const isSameSegmentSet: (a: Set<Segment>, b: Set<Segment>) => boolean = (
  a: Set<Segment>,
  b: Set<Segment>,
): boolean => {
  if (a.size !== b.size) {
    return false;
  }

  for (const segment of a) {
    if (!b.has(segment)) {
      return false;
    }
  }

  return true;
};

// Where a segment's first line starts, and its last line ends.
const getSegmentStart: (segment: Segment) => number = (
  segment: Segment,
): number => {
  return segment.kind === "run" ? segment.run.start : segment.block.start;
};

const getSegmentEnd: (segment: Segment) => number = (
  segment: Segment,
): number => {
  return segment.kind === "run" ? segment.run.end : segment.block.end;
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
      maxUnitLines: Number.POSITIVE_INFINITY,
      maxUnitLength: Number.POSITIVE_INFINITY,
      maxNestingDepth: limits.maxNestingDepth,
      maxCellsPerLine: Number.POSITIVE_INFINITY,
      holdBackCodeBlockContent: false,
      countUrlLiterals: false,
      countWordUnderscores: false,
      countAsMarked: false,
    };
  }

  const segments: Array<Segment> = readSegments(text, {
    countUrlLiterals: appliedLimits.countUrlLiterals,
    countWordUnderscores: appliedLimits.countWordUnderscores,
    countAsMarked: appliedLimits.countAsMarked,
  });

  let heldBack: Set<Segment> = chooseSegmentsToHoldBack(
    segments,
    appliedLimits,
  );

  /*
   * The content of fenced code is held back as one token only where that
   * keeps something from being held back as text: when the code, as
   * written, holds back nothing more, every code block stays as it is.
   */
  if (appliedLimits.holdBackCodeBlockContent) {
    const codeAsWritten: SlowMarkdownLimits = {
      ...appliedLimits,
      holdBackCodeBlockContent: false,
    };
    const heldWithCodeAsWritten: Set<Segment> = chooseSegmentsToHoldBack(
      segments,
      codeAsWritten,
    );

    if (isSameSegmentSet(heldWithCodeAsWritten, heldBack)) {
      appliedLimits = codeAsWritten;
      heldBack = heldWithCodeAsWritten;
    }
  }

  const pieces: Array<string> = [];
  let copiedUpTo: number = 0;
  // The stretch of segments held back being read: where it starts and ends.
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
    if (heldBack.has(segment)) {
      if (stretchStart === -1) {
        stretchStart = getSegmentStart(segment);
      }

      stretchEnd = getSegmentEnd(segment);
      continue;
    }

    endStretch();

    if (segment.kind !== "code") {
      continue;
    }

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
  counting?: Partial<InlineCounting>,
) => Array<SlowMarkdownRun> = (
  text: string,
  counting: Partial<InlineCounting> = {},
): Array<SlowMarkdownRun> => {
  const runs: Array<SlowMarkdownRun> = [];

  for (const segment of readSegments(typeof text === "string" ? text : "", {
    countUrlLiterals: Boolean(counting.countUrlLiterals),
    countWordUnderscores: Boolean(counting.countWordUnderscores),
    countAsMarked: Boolean(counting.countAsMarked),
  })) {
    if (segment.kind === "run") {
      runs.push(segment.run);
    }
  }

  return runs;
};

/*
 * The code blocks of `text` as they are measured (see readSegments): where
 * each starts and ends, for tests.
 */
export const measureSlowMarkdownCodeBlocks: (
  text: string,
) => Array<{ start: number; end: number; contentLines: number }> = (
  text: string,
): Array<{ start: number; end: number; contentLines: number }> => {
  const blocks: Array<{ start: number; end: number; contentLines: number }> =
    [];

  for (const segment of readSegments(typeof text === "string" ? text : "", {
    countUrlLiterals: false,
    countWordUnderscores: false,
    countAsMarked: false,
  })) {
    if (segment.kind === "code") {
      blocks.push({
        start: segment.block.start,
        end: segment.block.end,
        contentLines: segment.block.contentLines,
      });
    }
  }

  return blocks;
};
