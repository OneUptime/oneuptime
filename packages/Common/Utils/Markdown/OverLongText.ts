import { isWhiteSpaceCode } from "../RegExpCharacterClasses";

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
 *     asterisks of bold, a link's brackets - on both ends. A link that goes
 *     on from the kept start into the middle keeps its structure: its
 *     address and its title are held back apart, with what parts them in
 *     view (holdBackMiddle). So does one that goes on from the middle
 *     into the kept end: its "[" and "](" stay in view - and a link whose
 *     text crosses a cut keeps its "[" and "](" in view too, and a bare
 *     address from the middle into the kept end its scheme and domain
 *     (#7600). The cut moves a little where it would stand inside a link's
 *     text as the parser reads it - in brackets nested in it, a code span,
 *     an escape - or inside a reference's label, so the link stays a link
 *     (#8238). The brackets the middle leaves unmatched that pair with
 *     brackets in view stay in view too (#8668).
 *   - in every run of lines with no blank line between them that is longer
 *     than OVER_LONG_RUN_LENGTH characters, each group of consecutive lines
 *     that only continue the block they are in (isContinuationLine: plain
 *     text, starting no list, quote, heading, table, fence or HTML, and
 *     holding no image, code or line break). A group is held back as one
 *     line, indented as its first line was, so the run keeps every line that
 *     gives it its structure. A group of fewer than OVER_LONG_GROUP_MIN_LENGTH
 *     characters stays: holding it back would spare the parser nothing.
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
 * A group of continuation lines in an over-long run is held back when it
 * holds at least this many characters: a shorter one - a line of text
 * between table rows - is left for the parser, its Markdown and all.
 */
export const OVER_LONG_GROUP_MIN_LENGTH: number = OVER_LONG_LINE_KEPT_LENGTH;

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
 * A LINK ACROSS THE START OF A LINE'S MIDDLE.
 *
 * A link, an image or a link reference definition can start in an
 * over-long line's kept start and go on into its middle: an address longer
 * than the kept start (a signed URL, a dashboard link with a long query),
 * then a title - an error message or a log a template placed there. Held
 * back in one piece, the rest of the address, the white space after it and
 * the title became one token: the parser read an address with no end - no
 * space, no title, no ")" - and no link at all. An email showed "[Run](" as
 * text and then a link to the address, the space, the quote and the whole
 * title, percent-encoded (issue #7229).
 *
 * So the middle is held back in pieces that leave the link's own structure
 * where the parser reads it: the rest of the address is one piece and the
 * rest of the title another, and what parts them - the white space between
 * them, the title's quotes, the ">" of an address in angle brackets, the
 * ")" that closes the link - stays in view. The parser reads the link it
 * would have read in the whole line, and the address and the title are put
 * back into it. An autolink ("<https://...>") keeps its ">" the same way.
 *
 * A word the middle starts inside of that is in no link - a bare address -
 * is held back to its end on its own, so an address written as text does
 * not run on into the text after it. The punctuation that ends it stays in
 * view, for the parser to judge as it judges the end of a whole address:
 * "." and ")" end a sentence, not an address. And what follows a link is
 * held back from the white space after it on, so it never joins the link's
 * address either - where the parser reads no link there after all.
 *
 * Where the link is is read from the start of the line to the cut - at
 * most OVER_LONG_LINE_KEPT_LENGTH characters - and then on to where its
 * address or title ends: each character of the line once.
 *
 * A LINK ACROSS THE END OF A LINE'S MIDDLE.
 *
 * The same holds at the middle's other end: a link or an image can start
 * in the middle and go on into the line's kept end - a long address at the
 * end of a long log line, with or without a title. Held back in one piece
 * with the rest of the middle, its "[text](" went into the token, and the
 * parser read what the kept end holds of its address as text: an email
 * showed "[Run](https://..." as text. So the middle's last pieces leave
 * such a link's "[" - an image's "![" - and its "](" in view, with its
 * text as written between them (held back past MAX_KEPT_LINK_TEXT_LENGTH),
 * and hold back its address and its title apart, as above. An autolink
 * keeps its "<" and its scheme. The link is found as the rest of the
 * middle is read, on from where a link across its start ended: each
 * character once, with at most MAX_OPEN_LABELS labels' starts remembered.
 */

// The parts of a link a line is read in (readLinkUnit).
type LinkPart =
  | "text"
  | "autolink"
  | "beforeDestination"
  | "rawDestination"
  | "angleDestination"
  | "afterDestination"
  | "title"
  | "afterTitle";

interface LinkReading {
  part: LinkPart;
  /*
   * Whether the link is an inline one, "[text](...)", which a ")" closes -
   * and its address too, where the ")" closes more parentheses than the
   * address opened. A link reference definition's address ends at white
   * space alone.
   */
  isInline: boolean;
  // The parentheses an inline link's address has opened and not closed.
  depth: number;
  // What closes the title: '"', "'" or ")".
  closer: number;
  // Whether white space has come after the address: a title follows some.
  spaced: boolean;
}

const BACKSLASH: number = 0x5c;
const OPEN_BRACKET: number = 0x5b;
const CLOSE_BRACKET: number = 0x5d;
const OPEN_PARENTHESIS: number = 0x28;
const CLOSE_PARENTHESIS: number = 0x29;
const LESS_THAN: number = 0x3c;
const COLON: number = 0x3a;
const QUOTATION_MARK: number = 0x22;
const APOSTROPHE: number = 0x27;
const EXCLAMATION_MARK: number = 0x21;

// The most characters an autolink's scheme has (CommonMark: 2 to 32).
const MAX_SCHEME_LENGTH: number = 32;

/*
 * The most labels, one inside another, whose start is remembered as the
 * middle is read for a link across its end: a "](" that closes one opened
 * deeper - a line of "[" - finds no start, and its link stays in one
 * piece with the rest of the middle, as before.
 */
const MAX_OPEN_LABELS: number = 1024;

/*
 * The longest text of a link across the end of a line's middle that stays
 * in view as written - "**Run 42**" bold, as in the whole line. A longer
 * one is held back between its "[" and its "](", read as plain text.
 */
const MAX_KEPT_LINK_TEXT_LENGTH: number = OVER_LONG_LINE_KEPT_LENGTH;

/*
 * The most white space kept in view between a link's parts in a line's
 * middle - between its address and its title, its title and its ")". A
 * longer run is held back with what follows it, all but its first
 * MAX_KEPT_SEPARATOR_LENGTH characters, which keep the address apart from
 * it. And the most text kept in view after a link before the white space
 * that ends it.
 */
const MAX_KEPT_SEPARATOR_LENGTH: number = 64;

/*
 * What ends a bare address without being part of it - marked and remark
 * take it off the end of an address written as text (GFM's autolinks) -
 * and is kept in view after a word held back to its end. Not "*", "_" or
 * "~": those can close emphasis.
 */
const ADDRESS_END_PUNCTUATION: string = "?!.,:;'\")";

const isAsciiLetter: (code: number) => boolean = (code: number): boolean => {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
};

/*
 * Whether text[index] - a "<" - starts an autolink's address: an ASCII
 * letter, then letters, digits, "+", "." or "-", MAX_SCHEME_LENGTH
 * characters at most and two at least, then ":".
 */
const startsAutolink: (text: string, index: number) => boolean = (
  text: string,
  index: number,
): boolean => {
  if (!isAsciiLetter(text.charCodeAt(index + 1))) {
    return false;
  }

  for (
    let at: number = index + 2;
    at <= index + MAX_SCHEME_LENGTH + 1 && at < text.length;
    at++
  ) {
    const code: number = text.charCodeAt(at);

    if (code === COLON) {
      return at - index - 1 >= 2;
    }

    if (
      !isAsciiLetter(code) &&
      !isDigit(code) &&
      code !== 0x2b &&
      code !== 0x2e &&
      code !== 0x2d
    ) {
      return false;
    }
  }

  return false;
};

/*
 * Where the character the backslash at `index` escapes ends: past both
 * halves of a surrogate pair - an emoji - so a piece held back never
 * starts or ends between them.
 */
const getEscapeEnd: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  return isHighSurrogate(text.charCodeAt(index + 1)) &&
    isLowSurrogate(text.charCodeAt(index + 2))
    ? index + 3
    : index + 2;
};

/*
 * Reads one character of a line - or a backslash and the character it
 * escapes - in `reading`, moving it to the part of the link the character
 * starts, and returns where the next character starts. A character that
 * only shows that a part has ended - the white space after an address, an
 * address's first character - is not read: it is read again, in the next
 * part.
 */
const readLinkUnit: (
  text: string,
  index: number,
  reading: LinkReading,
) => number = (text: string, index: number, reading: LinkReading): number => {
  const code: number = text.charCodeAt(index);

  switch (reading.part) {
    case "text":
      if (code === BACKSLASH) {
        return getEscapeEnd(text, index);
      }

      if (
        code === CLOSE_BRACKET &&
        text.charCodeAt(index + 1) === OPEN_PARENTHESIS
      ) {
        reading.part = "beforeDestination";
        reading.isInline = true;
        reading.depth = 0;
        reading.spaced = false;

        return index + 2;
      }

      if (code === LESS_THAN && startsAutolink(text, index)) {
        reading.part = "autolink";
      }

      return index + 1;

    case "autolink":
      if (code === GREATER_THAN) {
        reading.part = "text";

        return index + 1;
      }

      if (code === LESS_THAN || isWhiteSpaceCode(code)) {
        reading.part = "text";

        return index;
      }

      return index + 1;

    case "beforeDestination":
      if (isWhiteSpaceCode(code)) {
        return index + 1;
      }

      if (code === LESS_THAN) {
        reading.part = "angleDestination";

        return index + 1;
      }

      if (code === CLOSE_PARENTHESIS && reading.isInline) {
        reading.part = "text";

        return index + 1;
      }

      reading.part = "rawDestination";

      return index;

    case "rawDestination":
      if (isWhiteSpaceCode(code)) {
        reading.part = "afterDestination";
        reading.spaced = false;

        return index;
      }

      if (code === BACKSLASH) {
        return isWhiteSpaceCode(text.charCodeAt(index + 1))
          ? index + 1
          : getEscapeEnd(text, index);
      }

      if (reading.isInline && code === OPEN_PARENTHESIS) {
        reading.depth++;
      } else if (reading.isInline && code === CLOSE_PARENTHESIS) {
        if (reading.depth === 0) {
          reading.part = "text";
        } else {
          reading.depth--;
        }
      }

      return index + 1;

    case "angleDestination":
      if (code === BACKSLASH) {
        return getEscapeEnd(text, index);
      }

      if (code === GREATER_THAN) {
        reading.part = "afterDestination";
        reading.spaced = false;
      } else if (code === LESS_THAN) {
        reading.part = "text";
      }

      return index + 1;

    case "afterDestination":
      if (isWhiteSpaceCode(code)) {
        reading.spaced = true;

        return index + 1;
      }

      if (
        reading.spaced &&
        (code === QUOTATION_MARK ||
          code === APOSTROPHE ||
          code === OPEN_PARENTHESIS)
      ) {
        reading.part = "title";
        reading.closer = code === OPEN_PARENTHESIS ? CLOSE_PARENTHESIS : code;

        return index + 1;
      }

      reading.part = "text";

      return code === CLOSE_PARENTHESIS && reading.isInline ? index + 1 : index;

    case "title":
      if (code === BACKSLASH) {
        return getEscapeEnd(text, index);
      }

      if (code === reading.closer) {
        reading.part = "afterTitle";
      }

      return index + 1;

    case "afterTitle":
      if (isWhiteSpaceCode(code)) {
        return index + 1;
      }

      reading.part = "text";

      return code === CLOSE_PARENTHESIS && reading.isInline ? index + 1 : index;
  }
};

/*
 * Whether `reading` is in a link, or an autolink: readLinkUnit moves it
 * from part to part.
 */
const isInLink: (reading: LinkReading) => boolean = (
  reading: LinkReading,
): boolean => {
  return reading.part !== "text";
};

/*
 * A LINK'S TEXT ACROSS A CUT (#7600, #8238).
 *
 * A link's text can be longer than what a line keeps on its side of a cut
 * - a run's name, an error's first line. Where its "[" is in the middle and
 * its "](" in the kept end, the "[" went into the middle's token, and an
 * email showed "run run ... run](https://example.com/x)", the address
 * autolinked; where its "[" is in the kept start and its "](" in the
 * middle, the "](" and the address went into the token, and it showed
 * "[run run ..." as text. So such a link keeps its "[" and its "](" in
 * view, and the part of its text the middle holds is held back as a piece
 * of its own, read as plain text between them. A full reference,
 * "[text][label]", keeps its "[" and its "][label]" in view the same way.
 *
 * The token stands for text, so it must stand where the link's text reads
 * plainly - in no brackets nested in it, no code span, and not between a
 * backslash and the character it escapes - or the parser reads what is
 * around it differently: "[run [42 <token> run] x](...)" closes the nested
 * brackets with nothing open, and the link with them. So the piece's edge
 * moves to where the text reads plainly nearest the cut, on the kept side
 * (#8238): past the cut, into the kept end, to where what is open there
 * closes - before the link's "](", which is in the kept end too - and back
 * from the cut, into the kept start, to where it opened. A backslash right
 * before the end's cut stays in view with what it escapes.
 *
 * marked and remark read a link's text each in a way of its own, so it is
 * read as the parser that reads the text reads it (OverLongTextParser):
 *
 *   - marked (its `_inlineLabel`): brackets nested one deep - a "[" in
 *     them reads no link - a backslash escaping any character but a line
 *     break, and a code span between two single backticks, outside nested
 *     brackets; then the text found is read again as a code span closes
 *     (see "Code spans" below), within the text.
 *   - remark (micromark): brackets nested as deep as they go, a code span
 *     as it closes, in the whole line - a "]" in it closes nothing - and no
 *     link inside the text: a "](" in nested brackets is a link of its own,
 *     and remark reads none around it.
 *
 * The first "[" whose text closes with "](" or "][label]" across the cut
 * opens the link, as marked takes the first, of the last
 * MAX_CROSSING_LINK_TEXTS labels left open there - the one remark closes
 * last - and at most MAX_CROSSING_LINK_TEXTS are read past the cut, so a
 * line is read in time in line with its length.
 *
 * A collapsed reference, "[label][]", and a shortcut one, "[label]", are
 * looked up by their text: a token in it would name no definition. So a
 * label of at most MAX_LABEL_LENGTH characters the cut is inside of stays
 * in view whole: the middle ends before it, or the kept start after it.
 */

/*
 * The parser that reads a text once it is held back: marked, which
 * renders the emails, or remark - micromark and its GitHub extensions -
 * which renders the dashboard's viewer (see "A link's text across a cut").
 */
export type OverLongTextParser = "marked" | "remark";

// The most labels open at a cut that are read to see whether they close across it.
const MAX_CROSSING_LINK_TEXTS: number = 4;

/*
 * The longest label a reference has (CommonMark's, which remark keeps to):
 * a longer one names no definition there.
 */
const MAX_LABEL_LENGTH: number = 999;

/*
 * How far from a cut the places where a link's text reads plainly are
 * noted for marked (readLinkTextAsMarked): as far as a kept side and the
 * space a cut looks for reach.
 */
const PLAIN_WINDOW_LENGTH: number =
  OVER_LONG_LINE_KEPT_LENGTH + CUT_SEARCH_LENGTH;

const BACKTICK: number = 0x60;

// The characters JavaScript's "." matches none of: what marked's "\\." escapes no more than.
const isLineTerminator: (code: number) => boolean = (code: number): boolean => {
  return (
    code === 0x0a ||
    code === CARRIAGE_RETURN ||
    code === 0x2028 ||
    code === 0x2029
  );
};

// Where the character at `index` ends: past both halves of a surrogate pair.
const getCharacterEnd: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  return isHighSurrogate(text.charCodeAt(index)) &&
    isLowSurrogate(text.charCodeAt(index + 1))
    ? index + 2
    : index + 1;
};

/*
 * CODE SPANS.
 *
 * marked and remark close a code span as CommonMark does: a run of
 * backticks opens one where a later run of exactly as many closes it, and
 * is text where none does; what is in it - brackets, backslashes - is
 * text. marked reads a paragraph so, and the text of a link once it has
 * found where the text ends; remark reads a link's text so too.
 *
 * A line can hold a run of every length, none of them closed, and a search
 * for what closes each would read on to the line's end every time. So the
 * first search that finds nothing notes, as it reads on to the end, where
 * the last run of each length starts (as markdown-it does): every later
 * search knows at once that nothing closes its run, or finds the run that
 * does - and is read on from past it, so no two searches read the same
 * characters, and a line is read in time in line with its length.
 */
interface CodeSpanSearch {
  text: string;
  // Where a code span may close at the latest: the end of its line, or of a link's text.
  end: number;
  /*
   * Once a search has read on to `end` and found nothing, where the last
   * run of each length after the run it was for starts, and where that run
   * is: later searches are for runs after it.
   */
  lastRunStarts: Map<number, number> | null;
  searchedFrom: number;
}

const newCodeSpanSearch: (text: string, end: number) => CodeSpanSearch = (
  text: string,
  end: number,
): CodeSpanSearch => {
  return { text: text, end: end, lastRunStarts: null, searchedFrom: -1 };
};

// Where the run of backticks that starts at `index` ends.
const getBacktickRunEnd: (
  text: string,
  index: number,
  end: number,
) => number = (text: string, index: number, end: number): number => {
  let runEnd: number = index;

  while (runEnd < end && text.charCodeAt(runEnd) === BACKTICK) {
    runEnd++;
  }

  return runEnd;
};

/*
 * Where the code span that the run of backticks starting at `index` opens
 * ends - just past the run that closes it - or -1 when no run closes it
 * before the search's end: the run is then text. A loop, not indexOf: that
 * would read on past the line's end.
 */
const getCodeSpanEnd: (search: CodeSpanSearch, index: number) => number = (
  search: CodeSpanSearch,
  index: number,
): number => {
  const text: string = search.text;
  const runEnd: number = getBacktickRunEnd(text, index, search.end);
  const length: number = runEnd - index;
  const isKnown: boolean =
    search.lastRunStarts !== null && index >= search.searchedFrom;

  if (isKnown && !((search.lastRunStarts!.get(length) ?? -1) > index)) {
    return -1;
  }

  const lastRunStarts: Map<number, number> = new Map<number, number>();
  let at: number = runEnd;

  while (at < search.end) {
    if (text.charCodeAt(at) !== BACKTICK) {
      at++;
      continue;
    }

    const nextRunEnd: number = getBacktickRunEnd(text, at, search.end);

    if (nextRunEnd - at === length) {
      return nextRunEnd;
    }

    if (!isKnown) {
      lastRunStarts.set(nextRunEnd - at, at);
    }

    at = nextRunEnd;
  }

  if (!isKnown) {
    search.lastRunStarts = lastRunStarts;
    search.searchedFrom = index;
  }

  return -1;
};

/*
 * Where the code span a backtick at `index` opens ends, or - where nothing
 * closes it - where its run ends, as text: what a reader reads on from.
 */
const getPastBackticks: (search: CodeSpanSearch, index: number) => number = (
  search: CodeSpanSearch,
  index: number,
): number => {
  const spanEnd: number = getCodeSpanEnd(search, index);

  return spanEnd !== -1
    ? spanEnd
    : getBacktickRunEnd(search.text, index, search.end);
};

// Whether text[index] is the "[" of an image's "![": the token may not part them.
const isImageBracket: (text: string, index: number) => boolean = (
  text: string,
  index: number,
): boolean => {
  return (
    text.charCodeAt(index) === OPEN_BRACKET &&
    text.charCodeAt(index - 1) === EXCLAMATION_MARK
  );
};

/*
 * A link's text read past a cut: where the "]" that closes it is, and the
 * last place at or before the cut and the first at or after it where the
 * text reads plainly, as the parser reads it - where the token may stand.
 */
interface LinkTextAcross {
  close: number;
  plainBefore: number;
  plainAfter: number;
}

interface LinkTextReading {
  text: string;
  // Where the text starts: just after its "[".
  from: number;
  cut: number;
  // Where the text is read to at most, and where its line ends.
  end: number;
  lineEnd: number;
  // Asked once, when the reading reaches the cut: whether to read on past it.
  isRead: () => boolean;
}

/*
 * Reads a link's text as remark does (see "A link's text across a cut"):
 * null when it closes before the cut, cannot close - a link inside it -
 * or reads on to `end` without closing, or when `isRead` says, at the cut,
 * not to read on.
 */
const readLinkTextAsRemark: (
  reading: LinkTextReading,
) => LinkTextAcross | null = (
  reading: LinkTextReading,
): LinkTextAcross | null => {
  const text: string = reading.text;
  // A code span in a link's text can close past the text - and hide its "]".
  const codeSpans: CodeSpanSearch = newCodeSpanSearch(text, reading.lineEnd);
  let depth: number = 0;
  let plainBefore: number = reading.from;
  let plainAfter: number = -1;
  let isPastCut: boolean = false;
  let index: number = reading.from;

  while (index < reading.end) {
    if (!isPastCut && index >= reading.cut) {
      if (!reading.isRead()) {
        return null;
      }

      isPastCut = true;
    }

    if (depth === 0 && !isImageBracket(text, index)) {
      if (index <= reading.cut) {
        plainBefore = index;
      }

      if (index >= reading.cut && plainAfter === -1) {
        plainAfter = index;
      }
    }

    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      index = getEscapeEnd(text, index);
      continue;
    }

    if (code === BACKTICK) {
      index = getPastBackticks(codeSpans, index);
      continue;
    }

    if (code === OPEN_BRACKET) {
      depth++;
    } else if (code === CLOSE_BRACKET) {
      if (depth === 0) {
        return index >= reading.cut
          ? { close: index, plainBefore: plainBefore, plainAfter: plainAfter }
          : null;
      }

      // A link inside the text: remark reads no link around it.
      if (text.charCodeAt(index + 1) === OPEN_PARENTHESIS) {
        return null;
      }

      depth--;
    }

    index = getCharacterEnd(text, index);
  }

  return null;
};

/*
 * Reads a link's text as marked does (see "A link's text across a cut"):
 * first as its link rule reads it, to where it closes, then that text as
 * marked reads it once found, for its code spans. A place reads plainly
 * where it does both ways. Null as readLinkTextAsRemark returns it - and
 * when the text has a "[" in brackets nested in it, or a backslash before
 * a line break, or a single backtick that nothing closes.
 */
const readLinkTextAsMarked: (
  reading: LinkTextReading,
) => LinkTextAcross | null = (
  reading: LinkTextReading,
): LinkTextAcross | null => {
  const text: string = reading.text;
  // Where the text reads plainly near the cut: 1 as the rule reads it, 2 as its code spans do.
  const windowStart: number = Math.max(
    reading.from,
    reading.cut - PLAIN_WINDOW_LENGTH,
  );
  const windowEnd: number = reading.cut + PLAIN_WINDOW_LENGTH;
  const plain: Uint8Array = new Uint8Array(windowEnd - windowStart + 1);

  const notePlain: (index: number, way: number) => void = (
    index: number,
    way: number,
  ): void => {
    if (index >= windowStart && index <= windowEnd) {
      plain[index - windowStart] = plain[index - windowStart]! | way;
    }
  };

  let isNested: boolean = false;
  let isPastCut: boolean = false;
  let close: number = -1;
  let index: number = reading.from;

  while (index < reading.end) {
    if (!isPastCut && index >= reading.cut) {
      if (!reading.isRead()) {
        return null;
      }

      isPastCut = true;
    }

    if (!isNested && !isImageBracket(text, index)) {
      notePlain(index, 1);
    }

    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      if (
        index + 1 >= reading.end ||
        isLineTerminator(text.charCodeAt(index + 1))
      ) {
        return null;
      }

      index = getEscapeEnd(text, index);
      continue;
    }

    if (code === BACKTICK && !isNested) {
      // The rule's code: a single backtick, then all but one, then one.
      let closing: number = index + 1;

      while (closing < reading.end && text.charCodeAt(closing) !== BACKTICK) {
        closing++;
      }

      if (closing >= reading.end) {
        return null;
      }

      index = closing + 1;
      continue;
    }

    if (code === OPEN_BRACKET) {
      if (isNested) {
        return null;
      }

      isNested = true;
    } else if (code === CLOSE_BRACKET) {
      if (!isNested) {
        close = index;
        break;
      }

      isNested = false;
    }

    index = getCharacterEnd(text, index);
  }

  if (close === -1 || close < reading.cut) {
    return null;
  }

  // The text as marked then reads it: its code spans close within it.
  const codeSpans: CodeSpanSearch = newCodeSpanSearch(text, close);

  index = reading.from;

  while (index < close) {
    notePlain(index, 2);

    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      index = getEscapeEnd(text, index);
    } else if (code === BACKTICK) {
      index = getPastBackticks(codeSpans, index);
    } else {
      index = getCharacterEnd(text, index);
    }
  }

  notePlain(close, 2);

  // The text's start and its "]" read plainly both ways: where nothing nearer does.
  let plainBefore: number = reading.from;
  let plainAfter: number = close;

  for (
    let at: number = Math.min(reading.cut, windowEnd);
    at >= windowStart;
    at--
  ) {
    if (plain[at - windowStart] === 3) {
      plainBefore = at;
      break;
    }
  }

  for (let at: number = reading.cut; at <= Math.min(close, windowEnd); at++) {
    if (plain[at - windowStart] === 3) {
      plainAfter = at;
      break;
    }
  }

  return { close: close, plainBefore: plainBefore, plainAfter: plainAfter };
};

const readLinkText: (
  reading: LinkTextReading,
  parser: OverLongTextParser,
) => LinkTextAcross | null = (
  reading: LinkTextReading,
  parser: OverLongTextParser,
): LinkTextAcross | null => {
  return parser === "remark"
    ? readLinkTextAsRemark(reading)
    : readLinkTextAsMarked(reading);
};

/*
 * Whether text[from, close) - just after a "[" - reads as a link's text
 * that the "]" at `close` closes, as the parser reads one.
 */
const readsAsLinkText: (data: {
  text: string;
  from: number;
  close: number;
  lineEnd: number;
  parser: OverLongTextParser;
}) => boolean = (data: {
  text: string;
  from: number;
  close: number;
  lineEnd: number;
  parser: OverLongTextParser;
}): boolean => {
  const read: LinkTextAcross | null = readLinkText(
    {
      text: data.text,
      from: data.from,
      cut: data.close,
      end: data.close + 1,
      lineEnd: data.lineEnd,
      isRead: (): boolean => {
        return true;
      },
    },
    data.parser,
  );

  return read !== null && read.close === data.close;
};

/*
 * Where the "]" that closes a reference's label - read from `from`, just
 * after its "[" - is: at most MAX_LABEL_LENGTH characters, with no bracket
 * in them but an escaped one, and not white space alone, as both parsers
 * read a label; `from` itself for "[]". -1 when there is none before
 * `end`.
 */
const readLabelClose: (text: string, from: number, end: number) => number = (
  text: string,
  from: number,
  end: number,
): number => {
  const limit: number = Math.min(end, from + MAX_LABEL_LENGTH + 1);
  let isBlank: boolean = true;

  for (let index: number = from; index < limit; index++) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      if (isLineTerminator(text.charCodeAt(index + 1))) {
        return -1;
      }

      isBlank = false;
      index++;
    } else if (code === OPEN_BRACKET) {
      return -1;
    } else if (code === CLOSE_BRACKET) {
      return isBlank && index > from ? -1 : index;
    } else if (!isWhiteSpaceCode(code)) {
      isBlank = false;
    }
  }

  return -1;
};

/*
 * Where what makes a link of a text whose "]" is at `close` ends: past
 * its "](" (an inline link: its address and title follow) or its
 * "][label]" (a full reference). -1 when neither follows: a collapsed
 * reference, "[label][]", or a shortcut one, or no link - or a label with
 * a backtick in it, which stays in view: a code span it opens could close
 * past it, where the closing backticks are held back.
 */
const getLinkTextSuffixEnd: (
  text: string,
  close: number,
  lineEnd: number,
) => number = (text: string, close: number, lineEnd: number): number => {
  const next: number = text.charCodeAt(close + 1);

  if (next === OPEN_PARENTHESIS) {
    return close + 2;
  }

  if (next !== OPEN_BRACKET) {
    return -1;
  }

  const labelClose: number = readLabelClose(text, close + 2, lineEnd);

  if (labelClose === -1 || labelClose === close + 2) {
    return -1;
  }

  for (let index: number = close + 2; index < labelClose; index++) {
    if (text.charCodeAt(index) === BACKTICK) {
      return -1;
    }
  }

  return labelClose + 1;
};

// Where the "[" of the label that starts at `start` - its "[", or the "!" of an image's "![" - is.
const getLabelOpen: (text: string, start: number) => number = (
  text: string,
  start: number,
): number => {
  return text.charCodeAt(start) === OPEN_BRACKET ? start : start + 1;
};

// A link's text across a cut (findLinkTextAcross).
interface LinkAcross extends LinkTextAcross {
  // Where the link starts: its "[", or the "!" of an image's "![".
  start: number;
  // Where its "](" or "][label]" ends (getLinkTextSuffixEnd).
  suffixEnd: number;
}

/*
 * Of the labels `opens` - where each "[" or "![" is, the first first -
 * whose "[" is at or after `from`, the first whose text closes with "](" or
 * "][label]" at or past `cut` (reading on to `end`), as the parser reads
 * it. Null when none does. At most MAX_CROSSING_LINK_TEXTS of them are read
 * past the cut.
 */
const findLinkTextAcross: (data: {
  text: string;
  opens: ReadonlyArray<number>;
  from: number;
  cut: number;
  end: number;
  lineEnd: number;
  parser: OverLongTextParser;
}) => LinkAcross | null = (data: {
  text: string;
  opens: ReadonlyArray<number>;
  from: number;
  cut: number;
  end: number;
  lineEnd: number;
  parser: OverLongTextParser;
}): LinkAcross | null => {
  let readPastCut: number = 0;

  const isRead: () => boolean = (): boolean => {
    readPastCut++;
    return readPastCut <= MAX_CROSSING_LINK_TEXTS;
  };

  for (const start of data.opens) {
    if (start < data.from) {
      continue;
    }

    const read: LinkTextAcross | null = readLinkText(
      {
        text: data.text,
        from: getLabelOpen(data.text, start) + 1,
        cut: data.cut,
        end: data.end,
        lineEnd: data.lineEnd,
        isRead: isRead,
      },
      data.parser,
    );

    if (read !== null) {
      const suffixEnd: number = getLinkTextSuffixEnd(
        data.text,
        read.close,
        data.lineEnd,
      );

      if (suffixEnd !== -1) {
        return { ...read, start: start, suffixEnd: suffixEnd };
      }
    }

    if (readPastCut >= MAX_CROSSING_LINK_TEXTS) {
      return null;
    }
  }

  return null;
};

/*
 * Where the kept start ends, past the cut, so that a reference the cut is
 * inside of stays in view whole: a label whose "[" is the last the kept
 * start opens - a collapsed or shortcut reference's, or a full one's - or
 * one that starts right at the cut after a "]", a full or collapsed
 * reference's. Past its "]", and the "[]" or "[label]" after it. -1 when
 * there is none, or it ends past `middleEnd`.
 */
const getReferenceEndAcrossStart: (data: {
  text: string;
  opens: ReadonlyArray<number>;
  middleStart: number;
  middleEnd: number;
  lineEnd: number;
}) => number = (data: {
  text: string;
  opens: ReadonlyArray<number>;
  middleStart: number;
  middleEnd: number;
  lineEnd: number;
}): number => {
  const text: string = data.text;
  let open: number = -1;

  if (
    text.charCodeAt(data.middleStart) === OPEN_BRACKET &&
    text.charCodeAt(data.middleStart - 1) === CLOSE_BRACKET
  ) {
    open = data.middleStart;
  } else if (data.opens.length > 0) {
    open = data.opens[data.opens.length - 1]!;
  }

  if (open === -1) {
    return -1;
  }

  const close: number = readLabelClose(text, open + 1, data.lineEnd);

  if (close < data.middleStart) {
    return -1;
  }

  let end: number = close + 1;

  if (text.charCodeAt(end) === OPEN_BRACKET) {
    const labelClose: number = readLabelClose(text, end + 1, data.lineEnd);

    if (labelClose !== -1) {
      end = labelClose + 1;
    }
  }

  return end <= data.middleEnd ? end : -1;
};

/*
 * A reference that goes on from a line's middle into its kept end
 * (getReferenceAcrossEnd): either the middle ends at `keepFrom`, before the
 * reference, which stays in view whole, or - a full reference - its
 * text's "[" stays in view, its text is held back as a piece of its own up
 * to its "]", at `textClose`, and the middle ends there.
 */
type ReferenceAcrossEnd =
  | { keepFrom: number }
  | { textStart: number; textClose: number };

/*
 * The reference the end of a line's middle is inside of, as it stays in
 * view (ReferenceAcrossEnd). `top` is the innermost label open at the cut
 * (-1 when none or not known), and `lastClosedStart` and `lastClosedEnd`
 * where the label the last "]" closed starts, and that "]". A label part,
 * "[label]" or "[]", across the cut - or right at it - after a text the
 * "]" just before it closes is a full or a collapsed reference's; else a
 * label across the cut is a shortcut reference's. Null when there is none.
 */
const getReferenceAcrossEnd: (data: {
  text: string;
  top: number;
  lastClosedStart: number;
  lastClosedEnd: number;
  position: number;
  middleEnd: number;
  lineEnd: number;
  parser: OverLongTextParser;
}) => ReferenceAcrossEnd | null = (data: {
  text: string;
  top: number;
  lastClosedStart: number;
  lastClosedEnd: number;
  position: number;
  middleEnd: number;
  lineEnd: number;
  parser: OverLongTextParser;
}): ReferenceAcrossEnd | null => {
  const text: string = data.text;

  // The label part right at the cut, or the innermost label across it.
  for (const labelPart of [data.middleEnd, data.top]) {
    if (
      labelPart === -1 ||
      text.charCodeAt(labelPart) !== OPEN_BRACKET ||
      data.lastClosedEnd !== labelPart - 1 ||
      data.lastClosedStart < data.position
    ) {
      continue;
    }

    const labelClose: number = readLabelClose(
      text,
      labelPart + 1,
      data.lineEnd,
    );
    const textOpen: number = getLabelOpen(text, data.lastClosedStart);

    if (labelClose === labelPart + 1) {
      // "[label][]": its text is its label, read whole.
      if (readLabelClose(text, textOpen + 1, labelPart) === labelPart - 1) {
        return { keepFrom: data.lastClosedStart };
      }
    } else if (
      labelClose !== -1 &&
      readsAsLinkText({
        text: text,
        from: textOpen + 1,
        close: labelPart - 1,
        lineEnd: data.lineEnd,
        parser: data.parser,
      })
    ) {
      // "[text][label]": its text is a link's.
      return { textStart: data.lastClosedStart, textClose: labelPart - 1 };
    }
  }

  if (data.top !== -1 && data.top >= data.position) {
    const close: number = readLabelClose(
      text,
      getLabelOpen(text, data.top) + 1,
      data.lineEnd,
    );

    if (close >= data.middleEnd) {
      return { keepFrom: data.top };
    }
  }

  return null;
};

/*
 * A BARE ADDRESS ACROSS THE END OF A LINE'S MIDDLE (#7600).
 *
 * An address written as text - a GFM autolink literal, "https://",
 * "http://", "ftp://" or "www." and what follows - can start in the middle
 * and run into the kept end: a signed URL of 2 KB at the end of a long log
 * line. Its start went into the middle's token, and the kept end showed
 * the rest of it as text. So its start - the scheme and the domain, and a
 * "/" after it - stays in view, and the rest of it the middle holds is held
 * back as a piece of its own, which the parser reads as part of the
 * address: no white space or "<" ends it. The white space before it stays
 * in view too, where a parser needs it before "www.". A word with a
 * backtick or a "<" in it before the cut is left as it was: it may be code
 * or a tag.
 */

// The schemes that start an address written as text, in lower case.
const ADDRESS_SCHEMES: ReadonlyArray<string> = [
  "https://",
  "http://",
  "ftp://",
  "www.",
];

// Whether text[index] is a character of an address's domain: a letter, a digit, "-" or ".".
const isDomainCode: (code: number) => boolean = (code: number): boolean => {
  return isAsciiLetter(code) || isDigit(code) || code === 0x2d || code === 0x2e;
};

/*
 * The scheme that text[index] starts, as one of ADDRESS_SCHEMES - any case
 * - with a domain's character after it; null when it starts none.
 */
const getAddressSchemeAt: (text: string, index: number) => string | null = (
  text: string,
  index: number,
): string | null => {
  // "h", "f" or "w", in either case: most characters start no scheme.
  const first: number = text.charCodeAt(index) | 0x20;

  if (first !== 0x68 && first !== 0x66 && first !== 0x77) {
    return null;
  }

  for (const scheme of ADDRESS_SCHEMES) {
    if (
      text.slice(index, index + scheme.length).toLowerCase() === scheme &&
      isDomainCode(text.charCodeAt(index + scheme.length)) &&
      text.charCodeAt(index + scheme.length) !== 0x2e
    ) {
      return scheme;
    }
  }

  return null;
};

/*
 * Where to keep a bare address that starts in text[from, cut) and runs on
 * past `cut` in view: from where the address - or the white space before
 * it - starts, to past its scheme, its domain and a "/" after it (at most
 * MAX_KEPT_SEPARATOR_LENGTH characters of the domain). Null when the cut is
 * not inside such an address.
 */
const findAddressAcrossEnd: (
  text: string,
  from: number,
  cut: number,
) => { start: number; keepEnd: number } | null = (
  text: string,
  from: number,
  cut: number,
): { start: number; keepEnd: number } | null => {
  if (
    cut <= from ||
    isWhiteSpaceCode(text.charCodeAt(cut - 1)) ||
    isWhiteSpaceCode(text.charCodeAt(cut))
  ) {
    return null;
  }

  let wordStart: number = cut - 1;

  while (
    wordStart > from &&
    !isWhiteSpaceCode(text.charCodeAt(wordStart - 1))
  ) {
    wordStart--;
  }

  if (wordStart === from && !isWhiteSpaceCode(text.charCodeAt(from - 1))) {
    // The word goes on before what is left to hold back: as it was.
    return null;
  }

  for (let index: number = wordStart; index < cut; index++) {
    const code: number = text.charCodeAt(index);

    if (code === BACKTICK || code === LESS_THAN) {
      return null;
    }
  }

  for (let index: number = wordStart; index < cut; index++) {
    const scheme: string | null = getAddressSchemeAt(text, index);

    if (scheme === null) {
      continue;
    }

    let keepEnd: number = index + scheme.length;
    const domainLimit: number = Math.min(
      cut,
      keepEnd + MAX_KEPT_SEPARATOR_LENGTH,
    );

    while (keepEnd < domainLimit && isDomainCode(text.charCodeAt(keepEnd))) {
      keepEnd++;
    }

    if (keepEnd < cut && text.charCodeAt(keepEnd) === 0x2f) {
      keepEnd++;
    }

    return {
      start: index === wordStart && index > from ? index - 1 : index,
      keepEnd: Math.min(keepEnd, cut),
    };
  }

  return null;
};

/*
 * Where the address of the link reference definition on the line that
 * starts at `lineStart` starts to be read - just after its "]:" - or -1
 * when the line holds none before `limit`: a "[" that starts the line once
 * the markers of the quotes and list items it is in are read, a label with
 * no bracket in it but an escaped one, "]" and ":".
 */
const readDefinitionStart: (
  text: string,
  lineStart: number,
  limit: number,
) => number = (text: string, lineStart: number, limit: number): number => {
  let index: number = lineStart;

  for (;;) {
    while (index < limit && isSpaceOrTab(text.charCodeAt(index))) {
      index++;
    }

    if (index < limit && text.charCodeAt(index) === GREATER_THAN) {
      index++;
      continue;
    }

    let markerEnd: number = index;

    while (markerEnd < limit && isDigit(text.charCodeAt(markerEnd))) {
      markerEnd++;
    }

    const marker: string = text.charAt(markerEnd);
    const isBullet: boolean =
      markerEnd === index &&
      (marker === "-" || marker === "+" || marker === "*");
    const isNumber: boolean =
      markerEnd > index && (marker === "." || marker === ")");

    if (
      markerEnd + 1 < limit &&
      (isBullet || isNumber) &&
      isSpaceOrTab(text.charCodeAt(markerEnd + 1))
    ) {
      index = markerEnd + 1;
      continue;
    }

    break;
  }

  if (index >= limit || text.charCodeAt(index) !== OPEN_BRACKET) {
    return -1;
  }

  for (let at: number = index + 1; at < limit; at++) {
    const code: number = text.charCodeAt(at);

    if (code === BACKSLASH) {
      at++;
    } else if (code === OPEN_BRACKET) {
      return -1;
    } else if (code === CLOSE_BRACKET) {
      return at + 1 < limit && text.charCodeAt(at + 1) === COLON ? at + 2 : -1;
    }
  }

  return -1;
};

/*
 * BRACKETS THE MIDDLE LEAVES UNMATCHED (#8668).
 *
 * The middle's brackets pair with brackets in view: a "]" in it closes a
 * label the kept start left open, and a "[" in it that nothing in it
 * closes is closed by a "]" in the kept end. Held back, they are gone: the
 * kept start's label read on, past the token, to a "](" in the kept end - a
 * link across the whole middle that no parser reads in the whole line - and
 * a "]" in the kept end closed a label of the kept start instead, so a link
 * there was lost, or read from the wrong "[".
 *
 * Reduced to what pairs with brackets outside it, the middle's brackets
 * are some "]" and then some "[": the "]"s that close labels opened before
 * it, then the "["s it leaves open. So the first of those "]"s - as many as
 * the kept start leaves labels open - stay in view, each between two
 * pieces of the middle, and so do the last of those "["s, as many as the
 * kept end has "]"s that close nothing of its own: each parser pairs them
 * with what is in view as it pairs them in the whole line. A "]" kept so is
 * followed by a token, so it closes no link; a "[" is kept for marked only
 * where marked reads its label in the whole line, so it opens none that
 * marked does not read there. At most MAX_KEPT_BRACKETS of each are kept,
 * found as the middle is read (each character once) and counted in the
 * kept end.
 */

// The most unmatched brackets of a line's middle kept in view, at each end.
const MAX_KEPT_BRACKETS: number = 8;

/*
 * How many "]" text[from, end) has that close no "[" of its own - outside
 * code spans, and not escaped.
 */
const countUnmatchedClosers: (data: {
  text: string;
  from: number;
  end: number;
  lineEnd: number;
}) => number = (data: {
  text: string;
  from: number;
  end: number;
  lineEnd: number;
}): number => {
  const text: string = data.text;
  const codeSpans: CodeSpanSearch = newCodeSpanSearch(text, data.lineEnd);
  let open: number = 0;
  let unmatched: number = 0;
  let index: number = data.from;

  while (index < data.end) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      index = getEscapeEnd(text, index);
      continue;
    }

    if (code === BACKTICK) {
      index = getPastBackticks(codeSpans, index);
      continue;
    }

    if (code === OPEN_BRACKET) {
      open++;
    } else if (code === CLOSE_BRACKET) {
      if (open > 0) {
        open--;
      } else {
        unmatched++;
      }
    }

    index++;
  }

  return unmatched;
};

/*
 * Holds back the middle text[middleStart, middleEnd) of the over-long line
 * that starts at `lineStart` - in pieces where a link, or a word, goes on
 * into it from the line's kept start, or a link goes on from it into the
 * kept end (see "A link across the start of a line's middle" and "A link
 * across the end of a line's middle" above) - and adds to `pieces` what is
 * in view from `keptFrom` on, then what stands for the middle. Returns
 * where the kept end starts: the middle can end a little past middleEnd,
 * or before it, so that the token never stands inside a link's text where
 * it reads otherwise, or inside a reference's label (see "A link's text
 * across a cut"), and the kept start can end a little before middleStart
 * or past it for the same reasons.
 */
const holdBackMiddle: (data: {
  text: string;
  lineStart: number;
  keptFrom: number;
  middleStart: number;
  middleEnd: number;
  lineEnd: number;
  hold: HoldBackFunction;
  pieces: Array<string>;
  parser: OverLongTextParser;
}) => number = (data: {
  text: string;
  lineStart: number;
  keptFrom: number;
  middleStart: number;
  middleEnd: number;
  lineEnd: number;
  hold: HoldBackFunction;
  pieces: Array<string>;
  parser: OverLongTextParser;
}): number => {
  const text: string = data.text;
  const middleEnd: number = data.middleEnd;
  let position: number = data.keptFrom;

  const holdTo: (end: number) => void = (end: number): void => {
    if (end > position) {
      data.pieces.push(data.hold(text.slice(position, end)));
      position = end;
    }
  };

  const keepTo: (end: number) => void = (end: number): void => {
    if (end > position) {
      data.pieces.push(text.slice(position, end));
      position = end;
    }
  };

  /*
   * While `linkReading` is in a link, from `from` on: holds back an
   * address's and a title's own characters, and keeps what parts them in
   * view. Returns where it stopped: where the link ended, the middle's
   * end, or where the white space - or the ")" after it - that made what
   * is kept too long starts. The reading has read that part already.
   */
  const holdBackLinkParts: (
    linkReading: LinkReading,
    from: number,
  ) => number = (linkReading: LinkReading, from: number): number => {
    let at: number = from;
    // White space kept since the last address or title character.
    let separatorLength: number = 0;

    while (at < middleEnd && isInLink(linkReading)) {
      const part: LinkPart = linkReading.part;
      const next: number = Math.min(
        readLinkUnit(text, at, linkReading),
        middleEnd,
      );

      if (next === at) {
        // A part ended on a character the next part reads.
        continue;
      }

      if (
        part === "beforeDestination" ||
        part === "afterDestination" ||
        part === "afterTitle"
      ) {
        // White space between the parts, a title's opening quote, a ")": kept.
        separatorLength += next - at;

        if (separatorLength > MAX_KEPT_SEPARATOR_LENGTH) {
          break;
        }

        holdTo(at);
        keepTo(next);
      } else {
        separatorLength = 0;

        /*
         * An address's or a title's own characters are held back; what
         * ends it - a ">", a closing quote, the ")" that closes the link -
         * is kept.
         */
        if (linkReading.part !== part) {
          holdTo(at);
          keepTo(next);
        }
      }

      at = next;
    }

    return at;
  };

  /*
   * How many labels the kept start leaves open in view: the "]"s of the
   * middle that close them stay in view (see "Brackets the middle leaves
   * unmatched"). Set once the kept start is read.
   */
  let labelsOpenInView: number = 0;

  /*
   * Reads the rest of the middle, on from `from` - where `reading` is - and
   * holds it back, keeping in view what a link or an autolink that goes on
   * into the kept end needs there (see "A link across the end of a line's
   * middle" above), and the brackets it leaves unmatched that pair with
   * brackets in view (see "Brackets the middle leaves unmatched"). Returns
   * where the middle ends.
   */
  const holdBackToEnd: (from: number) => number = (from: number): number => {
    if (from >= middleEnd) {
      // The kept start's last code span, or link, runs on past the middle.
      holdTo(middleEnd);

      return middleEnd;
    }

    /*
     * Where each label the reading is in starts - its "[", or the "!" of
     * an image's "![" - the innermost last; and how many more were opened
     * inside them, past MAX_OPEN_LABELS.
     */
    const labelStarts: Array<number> = [];
    let labelsLeftOut: number = 0;
    // The start of the link the reading is in, and its "](", or -1.
    let linkStart: number = -1;
    let linkClose: number = -1;
    // The "<" of the autolink the reading is in, or -1.
    let autolinkStart: number = -1;
    // The last "!" read as text: an "[" right after it opens an image.
    let exclamationMark: number = -1;
    /*
     * Where the label the last "]" closed starts - not a link's text, which
     * "](" closes - and that "]": a reference's label may follow it.
     */
    let lastClosedStart: number = -1;
    let lastClosedEnd: number = -1;
    /*
     * Where the code span - or the run of backticks - the middle's end is
     * inside of ends, or -1; and whether the middle ends between a
     * backslash and the character it escapes.
     */
    let codeEndPastCut: number = -1;
    let isEscapeAtCut: boolean = false;
    /*
     * A bracket in a code span opens and closes no label, and a "](" in
     * one starts no link: a code span is read past (see "Code spans").
     */
    const codeSpans: CodeSpanSearch = newCodeSpanSearch(text, data.lineEnd);
    // Where the first "]"s that close no label of the middle's own are.
    const unmatchedClosers: Array<number> = [];

    const noteUnmatchedCloser: (at: number) => void = (at: number): void => {
      if (
        labelsLeftOut === 0 &&
        labelStarts.length === 0 &&
        unmatchedClosers.length < MAX_KEPT_BRACKETS
      ) {
        unmatchedClosers.push(at);
      }
    };

    // The start of the label a "]" closes, or -1 when it is not known.
    const closeLabel: () => number = (): number => {
      if (labelsLeftOut > 0) {
        labelsLeftOut--;

        return -1;
      }

      return labelStarts.pop() ?? -1;
    };

    let at: number = from;

    while (at < middleEnd) {
      const part: LinkPart = reading.part;

      if (part === "text") {
        const code: number = text.charCodeAt(at);

        if (code === BACKTICK) {
          at = getPastBackticks(codeSpans, at);

          if (at > middleEnd) {
            codeEndPastCut = at;
          }

          continue;
        }

        if (code === OPEN_BRACKET) {
          if (labelStarts.length < MAX_OPEN_LABELS) {
            labelStarts.push(exclamationMark === at - 1 ? at - 1 : at);
          } else {
            labelsLeftOut++;
          }
        } else if (code === CLOSE_BRACKET) {
          noteUnmatchedCloser(at);

          if (text.charCodeAt(at + 1) !== OPEN_PARENTHESIS) {
            lastClosedStart = closeLabel();
            lastClosedEnd = at;
          }
        } else if (code === EXCLAMATION_MARK) {
          exclamationMark = at;
        } else if (code === BACKSLASH && getEscapeEnd(text, at) > middleEnd) {
          isEscapeAtCut = true;
        }
      }

      const next: number = readLinkUnit(text, at, reading);

      if (part === "text" && reading.part === "beforeDestination") {
        // A "](" closes a label: a link starts, if a "[" opened it.
        linkStart = closeLabel();
        linkClose = at;
      } else if (part === "text" && reading.part === "autolink") {
        autolinkStart = at;
      } else if (part !== "text" && reading.part === "text") {
        linkStart = -1;
        autolinkStart = -1;
      }

      at = next;
    }

    // The "]"s that close labels the kept start left open stay in view.
    for (const closer of unmatchedClosers.slice(0, labelsOpenInView)) {
      if (closer >= position) {
        holdTo(closer);
        keepTo(closer + 1);
      }
    }

    /*
     * The "["s the middle leaves open that the kept end's "]"s close stay
     * in view - the innermost last - before `limit`, where the kept end
     * starts at `keptEnd`.
     */
    const keepOpenLabels: (keptEnd: number, limit: number) => void = (
      keptEnd: number,
      limit: number,
    ): void => {
      if (labelsLeftOut > 0) {
        return;
      }

      const count: number = Math.min(
        labelStarts.length,
        MAX_KEPT_BRACKETS,
        countUnmatchedClosers({
          text: text,
          from: keptEnd,
          end: data.lineEnd,
          lineEnd: data.lineEnd,
        }),
      );

      if (count === 0) {
        return;
      }

      const labelOpens: Array<number> = labelStarts
        .slice(-count)
        .map((start: number): number => {
          return getLabelOpen(text, start);
        });

      if (
        labelOpens[0]! < position ||
        labelOpens[labelOpens.length - 1]! >= limit
      ) {
        return;
      }

      // marked reads a label from each "[": only one it reads in the whole line.
      if (
        data.parser === "marked" &&
        !labelOpens.every((labelOpen: number): boolean => {
          return (
            readLinkTextAsMarked({
              text: text,
              from: labelOpen + 1,
              cut: middleEnd,
              end: data.lineEnd,
              lineEnd: data.lineEnd,
              isRead: (): boolean => {
                return true;
              },
            }) !== null
          );
        })
      ) {
        return;
      }

      for (const labelOpen of labelOpens) {
        holdTo(labelOpen);
        keepTo(labelOpen + 1);
      }
    };

    if (reading.part === "autolink" && autolinkStart >= position) {
      // Its "<", its scheme and the ":" after it stay in view.
      holdTo(autolinkStart);
      keepTo(Math.min(text.indexOf(":", autolinkStart) + 1, middleEnd));
    } else if (
      isInLink(reading) &&
      reading.part !== "autolink" &&
      linkStart >= position
    ) {
      /*
       * Its "[" or "![" and its "](" stay in view, and its text between
       * them as written - or, when it is longer than
       * MAX_KEPT_LINK_TEXT_LENGTH, held back.
       */
      const labelOpen: number = getLabelOpen(text, linkStart);

      holdTo(linkStart);

      if (linkClose - labelOpen - 1 > MAX_KEPT_LINK_TEXT_LENGTH) {
        keepTo(Math.min(labelOpen + 1, middleEnd));
        holdTo(Math.min(linkClose, middleEnd));
      }

      keepTo(Math.min(linkClose + 2, middleEnd));
      holdBackLinkParts(
        {
          part: "beforeDestination",
          isInline: true,
          depth: 0,
          closer: 0,
          spaced: false,
        },
        linkClose + 2,
      );
    } else if (reading.part === "text") {
      /*
       * A link whose text the middle ends inside of, with its "](" or
       * "][label]" in the kept end: its "[" or "![" stays in view, and what
       * the middle holds of its text is a piece of its own, to where the
       * text reads plainly past the cut - or to the backslash right before
       * the cut whose escape it parts (see "A link's text across a cut").
       * Not when more labels were open than are remembered: which are open
       * then is not known.
       */
      const across: LinkAcross | null =
        labelsLeftOut === 0
          ? findLinkTextAcross({
              text: text,
              opens: labelStarts.slice(-MAX_CROSSING_LINK_TEXTS),
              from: position,
              cut: middleEnd,
              end: data.lineEnd,
              lineEnd: data.lineEnd,
              parser: data.parser,
            })
          : null;

      if (across !== null) {
        const end: number =
          across.plainBefore === middleEnd - 1 &&
          text.charCodeAt(middleEnd - 1) === BACKSLASH
            ? middleEnd - 1
            : across.plainAfter;

        holdTo(across.start);
        keepTo(getLabelOpen(text, across.start) + 1);
        holdTo(end);

        return end;
      }

      // A reference the middle ends inside of stays in view whole, or keeps its text's "[" in view.
      const reference: ReferenceAcrossEnd | null =
        labelsLeftOut === 0
          ? getReferenceAcrossEnd({
              text: text,
              top:
                labelStarts.length > 0
                  ? labelStarts[labelStarts.length - 1]!
                  : -1,
              lastClosedStart: lastClosedStart,
              lastClosedEnd: lastClosedEnd,
              position: position,
              middleEnd: middleEnd,
              lineEnd: data.lineEnd,
              parser: data.parser,
            })
          : null;

      if (reference !== null && "keepFrom" in reference) {
        holdTo(reference.keepFrom);

        return reference.keepFrom;
      }

      if (reference !== null) {
        holdTo(reference.textStart);
        keepTo(getLabelOpen(text, reference.textStart) + 1);
        holdTo(reference.textClose);

        return reference.textClose;
      }

      /*
       * A code span the middle opened and its end is inside of is held
       * back to its end: its closing backticks, in view alone, would open
       * another with the next. A backslash right before the cut stays in
       * view with what it escapes.
       */
      if (codeEndPastCut !== -1) {
        keepOpenLabels(codeEndPastCut, codeEndPastCut);
        holdTo(codeEndPastCut);

        return codeEndPastCut;
      }

      const cut: number =
        isEscapeAtCut && middleEnd - 1 >= position ? middleEnd - 1 : middleEnd;

      /*
       * Else a bare address the middle ends inside of keeps its start in
       * view (see "A bare address across the end of a line's middle").
       */
      const address: { start: number; keepEnd: number } | null =
        findAddressAcrossEnd(text, position, cut);

      keepOpenLabels(cut, address !== null ? address.start : cut);

      if (address !== null) {
        holdTo(address.start);
        keepTo(address.keepEnd);
      }

      holdTo(cut);

      return cut;
    }

    holdTo(middleEnd);

    return middleEnd;
  };

  // Where the kept start leaves the line: read from the line's start.
  const reading: LinkReading = {
    part: "text",
    isInline: false,
    depth: 0,
    closer: 0,
    spaced: false,
  };
  let index: number = readDefinitionStart(
    text,
    data.lineStart,
    data.middleStart,
  );

  if (index === -1) {
    index = data.lineStart;
  } else {
    reading.part = "beforeDestination";
  }

  // The "[" the kept start opens as text - in no code span - the first first.
  const opens: Array<number> = [];
  // Where each label the kept start leaves open starts: each "]" closes the last.
  const openLabels: Array<number> = [];
  const codeSpans: CodeSpanSearch = newCodeSpanSearch(text, data.lineEnd);
  // Where the last character read - or the backslash before it - starts.
  let lastRead: number = index;
  // Where the last run of backticks read as text starts.
  let lastBackticks: number = -1;

  while (index < data.middleStart) {
    lastRead = index;

    if (reading.part === "text") {
      const code: number = text.charCodeAt(index);

      if (code === BACKTICK) {
        lastBackticks = index;
        index = getPastBackticks(codeSpans, index);
        continue;
      }

      if (code === OPEN_BRACKET) {
        if (opens.length < MAX_OPEN_LABELS) {
          opens.push(index);
        }

        openLabels.push(index);
      } else if (code === CLOSE_BRACKET) {
        openLabels.pop();
      }
    }

    index = readLinkUnit(text, index, reading);
  }

  /*
   * A link whose text the kept start ends inside of, with its "](" or
   * "][label]" in the middle: what the middle holds of its text is a
   * piece of its own, from where the text reads plainly before the cut,
   * and its "](" or "][label]" stays in view (see "A link's text across a
   * cut"). An inline link's address and title are then read as a link's
   * across the start.
   */
  const across: LinkAcross | null = isInLink(reading)
    ? null
    : findLinkTextAcross({
        text: text,
        opens: opens,
        from: data.lineStart,
        cut: data.middleStart,
        end: middleEnd,
        lineEnd: data.lineEnd,
        parser: data.parser,
      });

  if (across !== null) {
    // The labels opened before the link's: its own and those in it close in it.
    const linkOpen: number = getLabelOpen(text, across.start);

    labelsOpenInView = openLabels.filter((labelOpen: number): boolean => {
      return labelOpen < linkOpen;
    }).length;
    keepTo(across.plainBefore);
    holdTo(across.close);

    if (across.suffixEnd > middleEnd) {
      // Its "(" or "[label]" runs on into the kept end.
      keepTo(middleEnd);

      return middleEnd;
    }

    keepTo(across.suffixEnd);
    index = across.suffixEnd;

    if (text.charCodeAt(across.close + 1) === OPEN_PARENTHESIS) {
      reading.part = "beforeDestination";
      reading.isInline = true;
      reading.depth = 0;
      reading.spaced = false;
    } else {
      // A full reference: its "][label]" ends it.
      reading.part = "text";

      return holdBackToEnd(index);
    }
  } else {
    let keptStartEnd: number = data.middleStart;

    if (!isInLink(reading)) {
      /*
       * A reference the cut is inside of stays in view whole: the kept
       * start ends past it. A backslash at the kept start's end keeps
       * what it escapes in view.
       */
      const referenceEnd: number = getReferenceEndAcrossStart({
        text: text,
        opens: opens,
        middleStart: data.middleStart,
        middleEnd: middleEnd,
        lineEnd: data.lineEnd,
      });

      if (referenceEnd > index) {
        /*
         * Read on to it as the kept start was read: it stays in view only
         * where it ends as text - in no link, and in no code span, whose
         * closing backticks would be held back.
         */
        const advanced: LinkReading = { ...reading };
        const advancedLabels: Array<number> = [...openLabels];
        let at: number = index;

        while (at < referenceEnd) {
          const code: number = text.charCodeAt(at);

          if (advanced.part === "text" && code === BACKTICK) {
            at = getPastBackticks(codeSpans, at);
            continue;
          }

          if (advanced.part === "text" && code === OPEN_BRACKET) {
            advancedLabels.push(at);
          } else if (advanced.part === "text" && code === CLOSE_BRACKET) {
            advancedLabels.pop();
          }

          at = readLinkUnit(text, at, advanced);
        }

        if (at === referenceEnd && advanced.part === "text") {
          Object.assign(reading, advanced);
          openLabels.splice(0, openLabels.length, ...advancedLabels);
          index = referenceEnd;
          keptStartEnd = referenceEnd;
        }
      }

      if (keptStartEnd === data.middleStart && index > data.middleStart) {
        if (lastRead === lastBackticks && index <= middleEnd) {
          /*
           * A code span the cut is inside of that the middle closes - or a
           * run of backticks the cut parts - is held back whole: its
           * opening backticks, in view alone, would close at another run.
           */
          keptStartEnd = lastBackticks;
        } else if (text.charCodeAt(lastRead) === BACKSLASH) {
          keptStartEnd = index;
        }
      }
    }

    keepTo(keptStartEnd);
    labelsOpenInView = openLabels.length;
  }

  if (!isInLink(reading)) {
    /*
     * A word the cut is inside of - with no space near the cut, the kept
     * start ends inside one - is held back to its end on its own, and the
     * punctuation that ends it and the white space after it are kept.
     */
    if (
      !isWhiteSpaceCode(text.charCodeAt(position - 1)) &&
      !isWhiteSpaceCode(text.charCodeAt(position))
    ) {
      let wordEnd: number = position;

      while (
        wordEnd < middleEnd &&
        !isWhiteSpaceCode(text.charCodeAt(wordEnd))
      ) {
        wordEnd++;
      }

      if (wordEnd < middleEnd) {
        let heldEnd: number = wordEnd;

        while (
          heldEnd > position &&
          wordEnd - heldEnd < MAX_KEPT_SEPARATOR_LENGTH &&
          ADDRESS_END_PUNCTUATION.indexOf(text.charAt(heldEnd - 1)) !== -1
        ) {
          heldEnd--;
        }

        /*
         * A "]" in the word that closes a label the kept start leaves open
         * ends the word's piece: it stays in view (see "Brackets the middle
         * leaves unmatched"), and the rest is held back with the middle.
         */
        let closer: number = -1;

        for (
          let at: number = position;
          labelsOpenInView > 0 && at < heldEnd;
          at++
        ) {
          const code: number = text.charCodeAt(at);

          if (code === BACKSLASH) {
            at++;
          } else if (code === CLOSE_BRACKET) {
            closer = at;
            break;
          }
        }

        if (closer !== -1) {
          holdTo(closer);
        } else {
          holdTo(heldEnd);
          keepTo(wordEnd + 1);
        }
      }
    }

    return holdBackToEnd(index);
  }

  /*
   * In a link, or an autolink. What the reading took past the cut - the
   * "(" after "](", a character a backslash escapes - is kept: the
   * backslash before it is.
   */
  keepTo(Math.min(index, middleEnd));
  index = holdBackLinkParts(reading, index);

  /*
   * The link ended before the middle did - or what looked like one was
   * none. What follows it is held back from the white space after it on,
   * unless what is in view already ends in white space.
   */
  if (index < middleEnd) {
    holdTo(index);

    let wordEnd: number = isWhiteSpaceCode(text.charCodeAt(index - 1))
      ? middleEnd
      : index;

    while (
      wordEnd < middleEnd &&
      wordEnd - index < MAX_KEPT_SEPARATOR_LENGTH &&
      !isWhiteSpaceCode(text.charCodeAt(wordEnd))
    ) {
      wordEnd++;
    }

    if (wordEnd < middleEnd && isWhiteSpaceCode(text.charCodeAt(wordEnd))) {
      keepTo(wordEnd + 1);
    }
  }

  /*
   * Read on for a link across the middle's end - unless the reading is
   * still in the link across its start: it runs on to the end, or white
   * space too long to keep parts it. A ")" after white space too long
   * to keep ended the link: it is held back, and read again as text.
   */
  if (isInLink(reading)) {
    holdTo(middleEnd);

    return middleEnd;
  }

  return holdBackToEnd(index);
};

/*
 * `text` with the middle of every line longer than OVER_LONG_LINE_LENGTH
 * held back (see the top of this file), for `parser` to read. The middle
 * starts and ends right after a space where there is one near (getCut),
 * and never between the two halves of a surrogate pair, such as an emoji.
 * A link, or a word, that goes on from the line's kept start into its
 * middle is held back in pieces (holdBackMiddle), and so is a link that
 * goes on from the middle into the line's kept end.
 */
export const holdBackOverLongLines: (
  text: string,
  hold: HoldBackFunction,
  parser?: OverLongTextParser,
) => string = (
  text: string,
  hold: HoldBackFunction,
  parser: OverLongTextParser = "marked",
): string => {
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
      copiedUpTo = holdBackMiddle({
        text: text,
        lineStart: lineStart,
        keptFrom: copiedUpTo,
        middleStart: getCut(text, lineStart + OVER_LONG_LINE_KEPT_LENGTH),
        middleEnd: getCut(text, lineEnd - OVER_LONG_LINE_KEPT_LENGTH),
        lineEnd: lineEnd,
        hold: hold,
        pieces: pieces,
        parser: parser,
      });
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
const getQuotePrefixEnd: (
  text: string,
  start: number,
  end: number,
) => number = (text: string, start: number, end: number): number => {
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

        index++;

        if (last.end - textStart < OVER_LONG_GROUP_MIN_LENGTH) {
          continue;
        }

        pieces.push(
          text.slice(copiedUpTo, textStart),
          hold(heldLines.join("\n")),
        );
        copiedUpTo = last.end;
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
 * `text` with everything too long for a parser held back, for `parser` to
 * read: the middles of its over-long lines, then the continuation lines of
 * its over-long runs. The same as `text` when it is no longer than
 * OVER_LONG_RUN_LENGTH.
 */
export const holdBackOverLongText: (
  text: string,
  hold: HoldBackFunction,
  parser?: OverLongTextParser,
) => string = (
  text: string,
  hold: HoldBackFunction,
  parser: OverLongTextParser = "marked",
): string => {
  return holdBackOverLongRuns(holdBackOverLongLines(text, hold, parser), hold);
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

/*
 * `text` cut to at most `maxLength` characters, for a channel that can take
 * no more: at the last line break in the second half of what fits, so a
 * line of Markdown is not split where it can be helped, else between whole
 * characters - never between the two halves of a surrogate pair, such as
 * an emoji. Text that fits is returned as it is.
 */
export const cutToLength: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const lastLineBreak: number = text.lastIndexOf("\n", maxLength);

  if (lastLineBreak > maxLength / 2) {
    return text.slice(0, lastLineBreak);
  }

  let end: number = Math.max(0, maxLength);

  if (
    end > 0 &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
  ) {
    end--;
  }

  return text.slice(0, end);
};
