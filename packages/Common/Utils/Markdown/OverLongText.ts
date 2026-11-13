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
 *     into the kept end: its "[" and "](" stay in view.
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
 * Holds back the middle text[middleStart, middleEnd) of the over-long line
 * that starts at `lineStart` - in pieces where a link, or a word, goes on
 * into it from the line's kept start, or a link goes on from it into the
 * kept end (see "A link across the start of a line's middle" and "A link
 * across the end of a line's middle" above) - and adds what stands for it
 * to `pieces`.
 */
const holdBackMiddle: (data: {
  text: string;
  lineStart: number;
  middleStart: number;
  middleEnd: number;
  hold: HoldBackFunction;
  pieces: Array<string>;
}) => void = (data: {
  text: string;
  lineStart: number;
  middleStart: number;
  middleEnd: number;
  hold: HoldBackFunction;
  pieces: Array<string>;
}): void => {
  const text: string = data.text;
  const middleEnd: number = data.middleEnd;
  let position: number = data.middleStart;

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
   * Reads the rest of the middle, on from `from` - where `reading` is - and
   * holds it back, keeping in view what a link or an autolink that goes on
   * into the kept end needs there (see "A link across the end of a line's
   * middle" above).
   */
  const holdBackToEnd: (from: number) => void = (from: number): void => {
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

        if (code === OPEN_BRACKET) {
          if (labelStarts.length < MAX_OPEN_LABELS) {
            labelStarts.push(exclamationMark === at - 1 ? at - 1 : at);
          } else {
            labelsLeftOut++;
          }
        } else if (
          code === CLOSE_BRACKET &&
          text.charCodeAt(at + 1) !== OPEN_PARENTHESIS
        ) {
          closeLabel();
        } else if (code === EXCLAMATION_MARK) {
          exclamationMark = at;
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
      const labelOpen: number =
        text.charCodeAt(linkStart) === OPEN_BRACKET ? linkStart : linkStart + 1;

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
    }

    holdTo(middleEnd);
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

  while (index < data.middleStart) {
    index = readLinkUnit(text, index, reading);
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

        holdTo(heldEnd);
        keepTo(wordEnd + 1);
      }
    }

    holdBackToEnd(index);

    return;
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
  } else {
    holdBackToEnd(index);
  }
};

/*
 * `text` with the middle of every line longer than OVER_LONG_LINE_LENGTH
 * held back (see the top of this file). The middle starts and ends right
 * after a space where there is one near (getCut), and never between the two
 * halves of a surrogate pair, such as an emoji. A link, or a word, that
 * goes on from the line's kept start into its middle is held back in pieces
 * (holdBackMiddle), and so is a link that goes on from the middle into the
 * line's kept end.
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

      pieces.push(text.slice(copiedUpTo, middleStart));
      holdBackMiddle({
        text: text,
        lineStart: lineStart,
        middleStart: middleStart,
        middleEnd: middleEnd,
        hold: hold,
        pieces: pieces,
      });
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
