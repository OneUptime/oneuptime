import {
  isAsciiLetterCode,
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
  isWordCode,
} from "../RegExpCharacterClasses";

/*
 * LINK REFERENCE DEFINITIONS, FOUND WHERE MARKED FINDS THEM.
 *
 * A description can define an image or a link once and point at it many
 * times - a synthetic monitor's screenshot above all:
 *
 *   ![Home][home]
 *   ![Home, again][home]
 *
 *   [home]: data:image/jpeg;base64,/9j/4AAQSkZJRg...
 *
 * marked reads a definition wherever a block may start, and a reference
 * finds it however far away it is - most often at the end of the text. So
 * an email field cut to fit keeps the definitions its kept references need
 * (Server/Types/Markdown, cutEmailMarkdown, #6963), and a field sent as text
 * shows a definition's screenshot rather than its base64 (getEmailTextHtml).
 *
 * Read with loops and indexOf, never a regular expression over the text: a
 * definition's address can be megabytes of base64 on one line
 * (Docs/notifications/README.md, "Megabyte-long values"). Every definition
 * of a text is found in time linear in its length, whatever its shape: what
 * is looked for ahead of a line - a title's closing quote, a setext
 * heading's underline, the blank line that ends an HTML block - is
 * remembered, not looked for again.
 *
 * A definition, as marked 12 reads one (its block "def" rule, once line
 * breaks are "\n" and the tabs that start a line are spaces):
 *
 *   - up to three spaces, "[", a label, "]:". The label is at least one
 *     character and not all white space, and holds no "[" or "]" unless a
 *     backslash escapes it - a backslash always takes the character after
 *     it, and never a line break. It may run over lines.
 *   - spaces, and at most one line break with the spaces after it.
 *   - an address: "<", then up to the first ">" on that line after which
 *     the rest reads; or a run of characters that are not white space, the
 *     first not "<".
 *   - perhaps a title, after spaces, a line break or both: in double quotes,
 *     where a backslash before a quote keeps it in the title, over any
 *     number of lines; in single quotes, over lines but never a blank one;
 *     or in parentheses with none inside.
 *   - spaces, then the end of the line or of the text. A title the line
 *     does not end after is no title: the definition ends after its
 *     address, and the title's line is text.
 *
 * A label matches whatever its case and however its white space runs
 * (normalizeLinkLabel), and of two definitions of one label marked reads
 * the first.
 *
 * Where marked reads a definition: where a block starts, unless the block
 * before it is a paragraph, which the definition then carries on. That is
 * at the first line, after a blank line, and right after a definition, a
 * heading (an ATX one, or a setext one over "===" or "---"), a thematic
 * break, a code block, an HTML block, a table, a block quote or a list -
 * and the same inside a block quote, each line read after the quote markers
 * marked strips, and inside a list item, each line read after the item's
 * indentation, however they nest. Never inside code or an HTML block (a
 * comment or <pre> over blank lines too), and never on a line that carries
 * on a paragraph, a quote's or a list item's lazy lines among them. So this
 * reads the text's blocks as marked's lexer does (Lexer.blockTokens: its
 * rules in the order it tries them, a list item's lines as its list
 * tokenizer reads them), without reading any inline Markdown: a definition
 * is a block. It reads quotes and lists down to MAX_DEFINITION_NESTING_DEPTH
 * deep: an email holds back Markdown nested deeper.
 *
 * A definition in a quote or a list item is found where it is in the text,
 * and with `nested`: the definition as marked reads it there, without the
 * markers and indentation of its lines - a definition on lines of its own.
 *
 * Line breaks are "\n": a caller with "\r\n" or "\r" in its text reads them
 * as marked does first, and finds the definitions in that.
 *
 * Pure, with no Node or browser APIs.
 */

/*
 * A definition inside a block quote or a list item, as marked reads it
 * there: what a cut field writes on lines of its own (cutEmailMarkdown).
 */
export interface NestedLinkReferenceDefinition {
  /*
   * The definition without the quote markers or the list item's
   * indentation of its lines: from the up to three spaces ahead of its "["
   * to its end.
   */
  text: string;
  // Its label in `text`: from after its "[" to its "]".
  labelStart: number;
  labelEnd: number;
  // After its address in `text`.
  destinationEnd: number;
}

export interface LinkReferenceDefinition {
  /*
   * Where its line starts - before a quote's markers or a list item's
   * bullet, and the up to three spaces ahead of its "[".
   */
  start: number;
  // Its label, as written: from after its "[" to its "]".
  labelStart: number;
  labelEnd: number;
  // Its label as a reference matches it (normalizeLinkLabel).
  label: string;
  // Its address as written - angle brackets and all - from its first character to after its last.
  destinationStart: number;
  destinationEnd: number;
  /*
   * After its title's closing quote or parenthesis, or after its address
   * when it has no title: what follows is spaces, then the end of its line.
   */
  end: number;
  // When it is inside a block quote or a list item: as marked reads it there.
  nested?: NestedLinkReferenceDefinition;
}

/*
 * How many block quotes and list items deep a definition is still found:
 * the depth past which an email holds Markdown back from marked
 * (SLOW_MARKDOWN_MAX_NESTING_DEPTH, Utils/Markdown/SlowMarkdown), where a
 * definition is text.
 */
export const MAX_DEFINITION_NESTING_DEPTH: number = 16;

const SPACE: number = 0x20;
const TAB: number = 0x09;
const LINE_FEED: number = 0x0a;
const EXCLAMATION_MARK: number = 0x21;
const DOUBLE_QUOTE: number = 0x22;
const HASH: number = 0x23;
const SINGLE_QUOTE: number = 0x27;
const OPEN_PARENTHESIS: number = 0x28;
const CLOSE_PARENTHESIS: number = 0x29;
const ASTERISK: number = 0x2a;
const PLUS: number = 0x2b;
const DASH: number = 0x2d;
const DOT: number = 0x2e;
const SLASH: number = 0x2f;
const DIGIT_ONE: number = 0x31;
const COLON: number = 0x3a;
const LESS_THAN: number = 0x3c;
const EQUALS: number = 0x3d;
const GREATER_THAN: number = 0x3e;
const QUESTION_MARK: number = 0x3f;
const OPEN_BRACKET: number = 0x5b;
const BACKSLASH: number = 0x5c;
const CLOSE_BRACKET: number = 0x5d;
const UNDERSCORE: number = 0x5f;
const BACKTICK: number = 0x60;
const PIPE: number = 0x7c;
const TILDE: number = 0x7e;
const LOWER_X: number = 0x78;
const UPPER_X: number = 0x58;
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

/*
 * The tags an HTML block of marked's sixth kind opens with (its "html"
 * rule, which reads them whatever their case). Written in lower case, they
 * also end a paragraph.
 */
const BLOCK_TAG_NAMES: ReadonlySet<string> = new Set<string>([
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "meta",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul",
]);

const LONGEST_BLOCK_TAG_NAME: number = 10;

/*
 * The tags an HTML block of the first kind opens with, which runs to the
 * line of its closing tag. Written in lower case, they end a paragraph too.
 */
const RAW_TEXT_TAG_NAMES: ReadonlyArray<string> = [
  "script",
  "pre",
  "style",
  "textarea",
];

/*
 * A label as marked matches it: in lower case, each run of white space one
 * space. Not trimmed - "[ home ]" is not "[home]" to marked - and escapes
 * stay as written. Read with a loop: a label can be as long as its text.
 */
export const normalizeLinkLabel: (label: string) => string = (
  label: string,
): string => {
  const lowered: string = label.toLowerCase();
  let normalized: string = "";
  let copiedUpTo: number = 0;
  let index: number = 0;

  while (index < lowered.length) {
    if (!isWhiteSpaceCode(lowered.charCodeAt(index))) {
      index++;
      continue;
    }

    let runEnd: number = index + 1;

    while (
      runEnd < lowered.length &&
      isWhiteSpaceCode(lowered.charCodeAt(runEnd))
    ) {
      runEnd++;
    }

    // One space is already as marked makes it.
    if (runEnd - index > 1 || lowered.charCodeAt(index) !== SPACE) {
      normalized += `${lowered.slice(copiedUpTo, index)} `;
      copiedUpTo = runEnd;
    }

    index = runEnd;
  }

  return copiedUpTo === 0 ? lowered : normalized + lowered.slice(copiedUpTo);
};

// Whether text[start, end) is all white space, as \s reads it: true when empty.
const isAllWhiteSpace: (text: string, start: number, end: number) => boolean = (
  text: string,
  start: number,
  end: number,
): boolean => {
  for (let index: number = start; index < end; index++) {
    if (!isWhiteSpaceCode(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
};

// After the spaces - only spaces - from `index`.
const skipSpaces: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  let at: number = index;

  while (text.charCodeAt(at) === SPACE) {
    at++;
  }

  return at;
};

// After the up to three spaces from `index`.
const skipUpToThreeSpaces: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  let at: number = index;

  while (at - index < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

  return at;
};

// After the line breaks from `index`.
const skipLineBreaks: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  let at: number = index;

  while (text.charCodeAt(at) === LINE_FEED) {
    at++;
  }

  return at;
};

const isSpaceOrTab: (code: number) => boolean = (code: number): boolean => {
  return code === SPACE || code === TAB;
};

// Where the line `from` is on ends: at its line break, or the end of the text.
const getLineEnd: (text: string, from: number) => number = (
  text: string,
  from: number,
): number => {
  const lineBreak: number = text.indexOf("\n", from);

  return lineBreak === -1 ? text.length : lineBreak;
};

/*
 * Where the line ends if only spaces come after `index` on it: its line
 * break, or the end of the text. -1 when anything else does.
 */
const lineEndAfterSpaces: (text: string, index: number) => number = (
  text: string,
  index: number,
): number => {
  const at: number = skipSpaces(text, index);

  if (at >= text.length || text.charCodeAt(at) === LINE_FEED) {
    return Math.min(at, text.length);
  }

  return -1;
};

// The start of the line after the one whose line break, or end, is `lineEnd`.
const nextLineStart: (text: string, lineEnd: number) => number = (
  text: string,
  lineEnd: number,
): number => {
  return lineEnd >= text.length ? text.length : lineEnd + 1;
};

/*
 * The next position at or after a given one where something is, or -1: the
 * last answer is remembered, and a position it already answers for is not
 * looked for again. Definitions are read in the order of the text, so the
 * text after them is read once, however many lines look ahead through it.
 */
type NextPositionFunction = (from: number) => number;

const remembered: (find: NextPositionFunction) => NextPositionFunction = (
  find: NextPositionFunction,
): NextPositionFunction => {
  let askedFrom: number = Number.POSITIVE_INFINITY;
  let found: number = -1;

  return (from: number): number => {
    if (from < askedFrom || (found !== -1 && from > found)) {
      askedFrom = from;
      found = find(from);
    }

    return found;
  };
};

// What a definition's title is looked for with, in one text.
interface TitleFinders {
  // The next '"' a backslash does not keep in a title: none right before it.
  freeDoubleQuote: NextPositionFunction;
  // The next "'".
  singleQuote: NextPositionFunction;
  // The next blank line: two line breaks in a row.
  blankLine: NextPositionFunction;
  openParenthesis: NextPositionFunction;
  closeParenthesis: NextPositionFunction;
  /*
   * The last '"' with a backslash right before it that only spaces follow
   * on its line, at or after `from` and before `before`; -1 when none is.
   */
  lastEscapedQuoteEndingLine: (from: number, before: number) => number;
}

const getTitleFinders: (text: string) => TitleFinders = (
  text: string,
): TitleFinders => {
  const indexOf: (part: string) => NextPositionFunction = (
    part: string,
  ): NextPositionFunction => {
    return remembered((from: number): number => {
      return text.indexOf(part, from);
    });
  };

  // Made the first time a title asks: most texts never do.
  let escapedQuotesEndingLines: Array<number> | null = null;

  return {
    freeDoubleQuote: remembered((from: number): number => {
      let quote: number = text.indexOf('"', from);

      while (quote > 0 && text.charCodeAt(quote - 1) === BACKSLASH) {
        quote = text.indexOf('"', quote + 1);
      }

      return quote;
    }),
    singleQuote: indexOf("'"),
    blankLine: indexOf("\n\n"),
    openParenthesis: indexOf("("),
    closeParenthesis: indexOf(")"),
    lastEscapedQuoteEndingLine: (from: number, before: number): number => {
      if (escapedQuotesEndingLines === null) {
        escapedQuotesEndingLines = [];

        for (
          let quote: number = text.indexOf('"');
          quote !== -1;
          quote = text.indexOf('"', quote + 1)
        ) {
          if (
            quote > 0 &&
            text.charCodeAt(quote - 1) === BACKSLASH &&
            lineEndAfterSpaces(text, quote + 1) !== -1
          ) {
            escapedQuotesEndingLines.push(quote);
          }
        }
      }

      // The last one before `before`, by halves.
      let low: number = 0;
      let high: number = escapedQuotesEndingLines.length;

      while (low < high) {
        const middle: number = Math.floor((low + high) / 2);

        if (escapedQuotesEndingLines[middle]! < before) {
          low = middle + 1;
        } else {
          high = middle;
        }
      }

      const last: number | undefined = escapedQuotesEndingLines[low - 1];

      return last !== undefined && last >= from ? last : -1;
    },
  };
};

/*
 * After the title that opens at `titleStart`, where only spaces follow it on
 * its line; -1 when no title opens there that its line ends after.
 */
const readTitle: (
  text: string,
  titleStart: number,
  finders: TitleFinders,
) => number = (
  text: string,
  titleStart: number,
  finders: TitleFinders,
): number => {
  const opening: number = text.charCodeAt(titleStart);

  if (opening === DOUBLE_QUOTE) {
    /*
     * marked's title runs to the first quote no backslash keeps; when its
     * line does not end there, it takes a quote a backslash kept as the
     * closing one, the last first.
     */
    const free: number = finders.freeDoubleQuote(titleStart + 1);

    if (free !== -1 && lineEndAfterSpaces(text, free + 1) !== -1) {
      return free + 1;
    }

    const escaped: number = finders.lastEscapedQuoteEndingLine(
      titleStart + 2,
      free === -1 ? text.length : free,
    );

    return escaped === -1 ? -1 : escaped + 1;
  }

  if (opening === SINGLE_QUOTE) {
    const close: number = finders.singleQuote(titleStart + 1);

    if (close === -1) {
      return -1;
    }

    const blankLine: number = finders.blankLine(titleStart + 1);

    if (blankLine !== -1 && blankLine + 2 <= close) {
      return -1;
    }

    return lineEndAfterSpaces(text, close + 1) === -1 ? -1 : close + 1;
  }

  if (opening === OPEN_PARENTHESIS) {
    const close: number = finders.closeParenthesis(titleStart + 1);

    if (close === -1) {
      return -1;
    }

    const open: number = finders.openParenthesis(titleStart + 1);

    if (open !== -1 && open < close) {
      return -1;
    }

    return lineEndAfterSpaces(text, close + 1) === -1 ? -1 : close + 1;
  }

  return -1;
};

/*
 * A definition read, and where the block after it starts: past the line
 * breaks after its line, which it takes.
 */
interface DefinitionReading {
  definition: LinkReferenceDefinition;
  next: number;
}

/*
 * The rest of a definition whose address ends at `destinationEnd`: its
 * title if it has one its line ends after, else nothing but spaces to the
 * end of the address's line. null when neither.
 */
const readAfterDestination: (
  text: string,
  definition: Omit<LinkReferenceDefinition, "destinationEnd" | "end">,
  destinationEnd: number,
  finders: TitleFinders,
) => DefinitionReading | null = (
  text: string,
  definition: Omit<LinkReferenceDefinition, "destinationEnd" | "end">,
  destinationEnd: number,
  finders: TitleFinders,
): DefinitionReading | null => {
  const afterSpaces: number = skipSpaces(text, destinationEnd);

  // A title comes after spaces, a line break, or both.
  if (
    afterSpaces > destinationEnd ||
    text.charCodeAt(afterSpaces) === LINE_FEED
  ) {
    const titleStart: number =
      text.charCodeAt(afterSpaces) === LINE_FEED
        ? skipSpaces(text, afterSpaces + 1)
        : afterSpaces;
    const titleEnd: number = readTitle(text, titleStart, finders);

    if (titleEnd !== -1) {
      return {
        definition: {
          ...definition,
          destinationEnd: destinationEnd,
          end: titleEnd,
        },
        next: skipLineBreaks(
          text,
          nextLineStart(text, lineEndAfterSpaces(text, titleEnd)),
        ),
      };
    }
  }

  const lineEnd: number = lineEndAfterSpaces(text, destinationEnd);

  if (lineEnd === -1) {
    return null;
  }

  return {
    definition: {
      ...definition,
      destinationEnd: destinationEnd,
      end: destinationEnd,
    },
    next: skipLineBreaks(text, nextLineStart(text, lineEnd)),
  };
};

/*
 * After the label that starts at `labelStart` - at its "]" - or -1 when the
 * brackets close on no label: a "[" comes first, or a backslash before a
 * line break or the end of the text.
 */
const findLabelEnd: (text: string, labelStart: number) => number = (
  text: string,
  labelStart: number,
): number => {
  for (let at: number = labelStart; at < text.length; at++) {
    const code: number = text.charCodeAt(at);

    if (code === BACKSLASH) {
      if (
        at + 1 >= text.length ||
        isLineTerminatorCode(text.charCodeAt(at + 1))
      ) {
        return -1;
      }

      at++;
      continue;
    }

    if (code === OPEN_BRACKET) {
      return -1;
    }

    if (code === CLOSE_BRACKET) {
      return at;
    }
  }

  return -1;
};

/*
 * The definition that starts at `blockStart` of a text whose lines start
 * with spaces, never tabs (a BlockLevel's text), if one starts there.
 */
const readDefinition: (
  text: string,
  blockStart: number,
  finders: TitleFinders,
) => DefinitionReading | null = (
  text: string,
  blockStart: number,
  finders: TitleFinders,
): DefinitionReading | null => {
  const at: number = skipUpToThreeSpaces(text, blockStart);

  if (text.charCodeAt(at) !== OPEN_BRACKET) {
    return null;
  }

  const labelStart: number = at + 1;
  const labelEnd: number = findLabelEnd(text, labelStart);

  if (
    labelEnd === -1 ||
    text.charCodeAt(labelEnd + 1) !== COLON ||
    isAllWhiteSpace(text, labelStart, labelEnd)
  ) {
    return null;
  }

  let destinationStart: number = skipSpaces(text, labelEnd + 2);

  if (text.charCodeAt(destinationStart) === LINE_FEED) {
    destinationStart = skipSpaces(text, destinationStart + 1);
  }

  if (destinationStart >= text.length) {
    return null;
  }

  const definition: Omit<LinkReferenceDefinition, "destinationEnd" | "end"> = {
    start: blockStart,
    labelStart: labelStart,
    labelEnd: labelEnd,
    label: normalizeLinkLabel(text.slice(labelStart, labelEnd)),
    destinationStart: destinationStart,
  };

  if (text.charCodeAt(destinationStart) === LESS_THAN) {
    // Each ">" on the line, the first first, until the rest reads.
    for (
      let close: number = destinationStart + 1;
      close < text.length;
      close++
    ) {
      const code: number = text.charCodeAt(close);

      if (isLineTerminatorCode(code)) {
        return null;
      }

      if (code === GREATER_THAN) {
        const reading: DefinitionReading | null = readAfterDestination(
          text,
          definition,
          close + 1,
          finders,
        );

        if (reading !== null) {
          return reading;
        }
      }
    }

    return null;
  }

  if (isWhiteSpaceCode(text.charCodeAt(destinationStart))) {
    return null;
  }

  let destinationEnd: number = destinationStart + 1;

  while (
    destinationEnd < text.length &&
    !isWhiteSpaceCode(text.charCodeAt(destinationEnd))
  ) {
    destinationEnd++;
  }

  return readAfterDestination(text, definition, destinationEnd, finders);
};

/*
 * THE LEVELS OF BLOCKS MARKED LEXES.
 *
 * marked lexes the whole text's blocks, then what each block quote and
 * each list item holds, as a text of its own (Lexer.blockTokens): a quote's
 * lines without their quote markers, an item's without its bullet and
 * indentation - and each with the tabs that start its lines made four
 * spaces each. A level is such a text, made the same way, and where each of
 * its lines is in the whole text: what a level makes of a line only ever
 * changes the spaces, tabs and markers it starts with, so from the first of
 * its characters that is neither a space nor a tab on, a line is the whole
 * text's, character for character.
 *
 * Or nearly: marked makes those replacements with "^" in multiline mode
 * (`/^( *)(\t+)/gm`, and a quote's `/^ *>[ \t]?/gm`), and there "^" also
 * matches right after a line or paragraph separator (U+2028, U+2029),
 * which is no line break to its block rules. So after such a separator a
 * line's tabs are made spaces too, and a quote's marker stripped, and the
 * line is the whole text's again from the first character after them: a
 * line is pieces, each the whole text's from where it starts.
 */
interface LevelLines {
  /*
   * Where each piece of a line starts in the level's text: the line's start,
   * and after each separator that marked changes what follows.
   */
  starts: Array<number>;
  // Where the line of the whole text it comes from starts, markers and all.
  wholeLineStarts: Array<number>;
  /*
   * From where the piece is the whole text's, in the level's text and in the
   * whole text: its line's first character that is neither a space nor a
   * tab (its end, when it has none), or a later piece's start.
   */
  solidStarts: Array<number>;
  wholeSolidStarts: Array<number>;
  // The piece asked of last: positions are asked of in order, mostly.
  cursor: number;
}

interface BlockLevel {
  text: string;
  // How many block quotes and list items it is inside: 0 for the whole text.
  depth: number;
  // null when `text` is the whole text itself.
  lines: LevelLines | null;
  // Where its line and paragraph separators are, in order: found when asked.
  separators: ReadonlyArray<number> | null;
}

// Where `part` is in `text`, in order.
const findEvery: (text: string, part: string) => Array<number> = (
  text: string,
  part: string,
): Array<number> => {
  const found: Array<number> = [];

  for (
    let at: number = text.indexOf(part);
    at !== -1;
    at = text.indexOf(part, at + 1)
  ) {
    found.push(at);
  }

  return found;
};

/*
 * Where the line and paragraph separators (U+2028, U+2029) of a level's
 * text are, in order: found the first time they are asked.
 */
const NO_POSITIONS: ReadonlyArray<number> = [];

const getSeparators: (level: BlockLevel) => ReadonlyArray<number> = (
  level: BlockLevel,
): ReadonlyArray<number> => {
  if (level.separators === null) {
    const text: string = level.text;

    // Most texts have none: a level of each list item is made.
    level.separators =
      text.indexOf(LINE_SEPARATOR) === -1 &&
      text.indexOf(PARAGRAPH_SEPARATOR) === -1
        ? NO_POSITIONS
        : findEvery(text, LINE_SEPARATOR)
            .concat(findEvery(text, PARAGRAPH_SEPARATOR))
            .sort((one: number, other: number): number => {
              return one - other;
            });
  }

  return level.separators;
};

// The index of the first of the ordered `positions` at or after `from`, by halves.
const firstAtOrAfter: (
  positions: ReadonlyArray<number>,
  from: number,
) => number = (positions: ReadonlyArray<number>, from: number): number => {
  let low: number = 0;
  let high: number = positions.length;

  while (low < high) {
    const middle: number = Math.floor((low + high) / 2);

    if (positions[middle]! < from) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
};

// The piece of `lines` that `position` is in: the last to start at or before it.
const getLevelLine: (lines: LevelLines, position: number) => number = (
  lines: LevelLines,
  position: number,
): number => {
  const starts: Array<number> = lines.starts;

  for (
    let line: number = lines.cursor;
    line < Math.min(lines.cursor + 2, starts.length);
    line++
  ) {
    if (
      starts[line]! <= position &&
      (line + 1 >= starts.length || starts[line + 1]! > position)
    ) {
      lines.cursor = line;
      return line;
    }
  }

  // By halves, when it is further on or back.
  let low: number = 0;
  let high: number = starts.length - 1;

  while (low < high) {
    const middle: number = Math.ceil((low + high) / 2);

    if (starts[middle]! <= position) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  lines.cursor = low;
  return low;
};

/*
 * Where a position of the level's text is in the whole text: one at or
 * after the first character of its line that is neither a space nor a tab,
 * and not among the spaces marked makes of tabs after a separator.
 */
const toWhole: (level: BlockLevel, position: number) => number = (
  level: BlockLevel,
  position: number,
): number => {
  if (level.lines === null) {
    return position;
  }

  const line: number = getLevelLine(level.lines, position);

  return (
    level.lines.wholeSolidStarts[line]! +
    (position - level.lines.solidStarts[line]!)
  );
};

// Where the line of the whole text that `position` is on starts.
const getWholeLineStart: (level: BlockLevel, position: number) => number = (
  level: BlockLevel,
  position: number,
): number => {
  if (level.lines === null) {
    return level.text.lastIndexOf("\n", position - 1) + 1;
  }

  return level.lines.wholeLineStarts[getLevelLine(level.lines, position)]!;
};

/*
 * A line of a level to be made: `lead` spaces marked writes ahead of it,
 * then text[from, to) of the level it is made from.
 */
interface LevelLine {
  lead: number;
  from: number;
  to: number;
}

/*
 * After the run of `code` in text[at, to): where the first other character
 * is, or `to`.
 */
const skipRun: (
  text: string,
  at: number,
  to: number,
  code: number,
) => number = (text: string, at: number, to: number, code: number): number => {
  let end: number = at;

  while (end < to && text.charCodeAt(end) === code) {
    end++;
  }

  return end;
};

/*
 * Adds to `made`, the lines of a level made from `source`, a piece that
 * starts at `start` and is the whole text's from `solid` - `sourceSolid` in
 * the source - on.
 */
const addPiece: (
  made: LevelLines,
  source: BlockLevel,
  start: number,
  wholeLineStart: number,
  solid: number,
  sourceSolid: number,
) => void = (
  made: LevelLines,
  source: BlockLevel,
  start: number,
  wholeLineStart: number,
  solid: number,
  sourceSolid: number,
): void => {
  made.starts.push(start);
  made.wholeLineStarts.push(wholeLineStart);
  made.solidStarts.push(solid);
  made.wholeSolidStarts.push(toWhole(source, sourceSolid));
};

/*
 * The level of `lines` of `source`, as blockTokens makes it: the tabs that
 * start each line made four spaces each, and so the tabs that come right
 * after a line or paragraph separator, spaces before them or none - and, in
 * a block quote (`stripsQuoteMarkers`), a quote's marker right after such a
 * separator stripped first, spaces before it and a space or a tab after it,
 * as marked strips each line's.
 */
const makeLevel: (
  source: BlockLevel,
  lines: Array<LevelLine>,
  depth: number,
  stripsQuoteMarkers: boolean,
) => BlockLevel = (
  source: BlockLevel,
  lines: Array<LevelLine>,
  depth: number,
  stripsQuoteMarkers: boolean,
): BlockLevel => {
  const text: string = source.text;
  const separators: ReadonlyArray<number> = getSeparators(source);
  let separator: number =
    lines.length > 0 ? firstAtOrAfter(separators, lines[0]!.from) : 0;
  const pieces: Array<string> = [];
  const made: LevelLines = {
    starts: [],
    wholeLineStarts: [],
    solidStarts: [],
    wholeSolidStarts: [],
    cursor: 0,
  };
  let length: number = 0;

  for (let index: number = 0; index < lines.length; index++) {
    const line: LevelLine = lines[index]!;

    if (index > 0) {
      pieces.push("\n");
      length++;
    }

    let spacesEnd: number = line.from;

    while (spacesEnd < line.to && text.charCodeAt(spacesEnd) === SPACE) {
      spacesEnd++;
    }

    let tabsEnd: number = spacesEnd;

    while (tabsEnd < line.to && text.charCodeAt(tabsEnd) === TAB) {
      tabsEnd++;
    }

    let spaces: number = line.lead;
    let copiedFrom: number = line.from;

    if (tabsEnd > spacesEnd) {
      spaces += spacesEnd - line.from + 4 * (tabsEnd - spacesEnd);
      copiedFrom = tabsEnd;
    }

    let solid: number = copiedFrom;

    while (solid < line.to && isSpaceOrTab(text.charCodeAt(solid))) {
      solid++;
    }

    const wholeLineStart: number = getWholeLineStart(source, line.from);

    addPiece(
      made,
      source,
      length,
      wholeLineStart,
      length + spaces + (solid - copiedFrom),
      solid,
    );

    if (spaces > 0) {
      pieces.push(" ".repeat(spaces));
      length += spaces;
    }

    // The rest of the line, and what marked makes of it after a separator.
    let copyFrom: number = copiedFrom;

    while (
      separator < separators.length &&
      separators[separator]! < copiedFrom
    ) {
      separator++;
    }

    for (
      ;
      separator < separators.length && separators[separator]! < line.to;
      separator++
    ) {
      const after: number = separators[separator]! + 1;
      let rest: number = after;

      if (stripsQuoteMarkers) {
        const marker: number = skipRun(text, after, line.to, SPACE);

        if (marker < line.to && text.charCodeAt(marker) === GREATER_THAN) {
          rest = marker + 1;

          if (rest < line.to && isSpaceOrTab(text.charCodeAt(rest))) {
            rest++;
          }
        }
      }

      const restSpacesEnd: number = skipRun(text, rest, line.to, SPACE);
      const restTabsEnd: number = skipRun(text, restSpacesEnd, line.to, TAB);
      const restSpaces: number =
        restSpacesEnd - rest + 4 * (restTabsEnd - restSpacesEnd);

      /*
       * Up to the separator's end as it is, then its spaces and its tabs as
       * spaces, and a piece from the first character after them: from there
       * the line is the whole text's again - after the spaces of tabs the
       * level it is made from made spaces too, which this piece reads past.
       */
      pieces.push(text.slice(copyFrom, after));
      length += after - copyFrom;

      if (restSpaces > 0) {
        pieces.push(" ".repeat(restSpaces));
        length += restSpaces;
      }

      copyFrom = restTabsEnd;
      addPiece(made, source, length, wholeLineStart, length, copyFrom);
    }

    if (line.to > copyFrom) {
      pieces.push(text.slice(copyFrom, line.to));
      length += line.to - copyFrom;
    }
  }

  return {
    text: pieces.join(""),
    depth: depth,
    lines: made,
    separators: null,
  };
};

/*
 * The whole text as a level: a copy only when a line of it starts with a
 * tab, or a separator comes right before tabs, spaces before them or none.
 */
const getWholeLevel: (text: string) => BlockLevel = (
  text: string,
): BlockLevel => {
  const whole: BlockLevel = {
    text: text,
    depth: 0,
    lines: null,
    separators: null,
  };

  if (text.indexOf("\t") === -1) {
    return whole;
  }

  const lines: Array<LevelLine> = [];
  let startsWithTab: boolean = false;

  for (let lineStart: number = 0; lineStart <= text.length; ) {
    const lineEnd: number = getLineEnd(text, lineStart);

    startsWithTab =
      startsWithTab || text.charCodeAt(skipSpaces(text, lineStart)) === TAB;
    lines.push({ lead: 0, from: lineStart, to: lineEnd });
    lineStart = lineEnd + 1;
  }

  for (const separator of getSeparators(whole)) {
    startsWithTab =
      startsWithTab || text.charCodeAt(skipSpaces(text, separator + 1)) === TAB;
  }

  return startsWithTab ? makeLevel(whole, lines, 0, false) : whole;
};

/*
 * What a level is read with: its finders, made the first time they are
 * asked, and what a setext heading's underline was last looked for to.
 */
interface LevelReading {
  level: BlockLevel;
  definitions: Array<LinkReferenceDefinition>;
  finders: TitleFinders | null;
  // The next "]:", which a definition holds.
  nextDefinitionColon: NextPositionFunction;
  // The next line break a line of spaces and a line break come after.
  nextBlankLineBreak: NextPositionFunction;
  /*
   * A setext heading looked for at `setextFrom` found none before
   * `setextStop`: none is found at a block starting after the one, up to the
   * other.
   */
  setextFrom: number;
  setextStop: number;
}

const startReading: (
  level: BlockLevel,
  definitions: Array<LinkReferenceDefinition>,
) => LevelReading = (
  level: BlockLevel,
  definitions: Array<LinkReferenceDefinition>,
): LevelReading => {
  const text: string = level.text;

  return {
    level: level,
    definitions: definitions,
    finders: null,
    nextDefinitionColon: remembered((from: number): number => {
      return text.indexOf("]:", from);
    }),
    nextBlankLineBreak: remembered((from: number): number => {
      for (
        let lineBreak: number = text.indexOf("\n", from);
        lineBreak !== -1;
        lineBreak = text.indexOf("\n", lineBreak + 1)
      ) {
        if (text.charCodeAt(skipSpaces(text, lineBreak + 1)) === LINE_FEED) {
          return lineBreak;
        }
      }

      return -1;
    }),
    setextFrom: -1,
    setextStop: -1,
  };
};

const getFinders: (reading: LevelReading) => TitleFinders = (
  reading: LevelReading,
): TitleFinders => {
  reading.finders = reading.finders ?? getTitleFinders(reading.level.text);

  return reading.finders;
};

/*
 * The first line or paragraph separator (U+2028, U+2029) in text[from,
 * to), or -1: what "." does not match either, so a line that holds one is
 * no heading, table row or setext heading's line to marked.
 */
const findSeparator: (
  reading: LevelReading,
  from: number,
  to: number,
) => number = (reading: LevelReading, from: number, to: number): number => {
  const separators: ReadonlyArray<number> = getSeparators(reading.level);
  const first: number | undefined =
    separators[firstAtOrAfter(separators, from)];

  return first !== undefined && first < to ? first : -1;
};

/*
 * Whether a definition's "]:" is in text[from, to): what a quote or a list
 * item must hold to define anything.
 */
const holdsDefinitionColon: (
  reading: LevelReading,
  from: number,
  to: number,
) => boolean = (reading: LevelReading, from: number, to: number): boolean => {
  const colon: number = reading.nextDefinitionColon(from);

  return colon !== -1 && colon < to;
};

/*
 * THE SHAPES OF LINES MARKED'S BLOCK RULES READ.
 *
 * Each is asked of a line of a level, from `at` - a line's start, or where
 * an HTML block of the third to fifth kind ended on its line.
 */

/*
 * Whether the line is a thematic break: up to three spaces, then three or
 * more of one of "-", "_" and "*", with nothing but spaces and tabs between
 * and after them.
 */
const isThematicBreak: (
  text: string,
  lineStart: number,
  lineEnd: number,
) => boolean = (text: string, lineStart: number, lineEnd: number): boolean => {
  const at: number = skipUpToThreeSpaces(text, lineStart);
  const mark: number = text.charCodeAt(at);

  if (mark !== DASH && mark !== UNDERSCORE && mark !== ASTERISK) {
    return false;
  }

  let marks: number = 0;

  for (let index: number = at; index < lineEnd; index++) {
    const code: number = text.charCodeAt(index);

    if (code === mark) {
      marks++;
    } else if (!isSpaceOrTab(code)) {
      return false;
    }
  }

  return marks >= 3;
};

/*
 * Whether an ATX heading starts the line: up to three spaces, one to six
 * "#", then white space or the end of the text. What ends a paragraph.
 */
const startsAtxHeading: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  const hashes: number = skipUpToThreeSpaces(text, at);
  let end: number = hashes;

  while (text.charCodeAt(end) === HASH) {
    end++;
  }

  return (
    end - hashes >= 1 &&
    end - hashes <= 6 &&
    (end >= text.length || isWhiteSpaceCode(text.charCodeAt(end)))
  );
};

/*
 * Whether the line is an ATX heading: one starts it, and no line or
 * paragraph separator is on it - marked's heading rule reads the line with
 * ".", and such a line is text.
 */
const isAtxHeading: (
  reading: LevelReading,
  at: number,
  lineEnd: number,
) => boolean = (
  reading: LevelReading,
  at: number,
  lineEnd: number,
): boolean => {
  return (
    startsAtxHeading(reading.level.text, at) &&
    findSeparator(reading, at, lineEnd) === -1
  );
};

// Whether a block quote starts the line: up to three spaces, then ">".
const startsBlockQuote: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  return text.charCodeAt(skipUpToThreeSpaces(text, at)) === GREATER_THAN;
};

// The run of backticks or tildes a fenced code block opened with.
interface Fence {
  code: number;
  length: number;
}

/*
 * The fence the line opens, as marked's "fences" rule reads it: up to three
 * spaces, then three or more backticks with no backtick after them on the
 * line, or three or more tildes. null when it opens none.
 */
const getOpeningFence: (
  text: string,
  lineStart: number,
  lineEnd: number,
) => Fence | null = (
  text: string,
  lineStart: number,
  lineEnd: number,
): Fence | null => {
  const at: number = skipUpToThreeSpaces(text, lineStart);
  const code: number = text.charCodeAt(at);

  if (code !== BACKTICK && code !== TILDE) {
    return null;
  }

  let runEnd: number = at;

  while (runEnd < lineEnd && text.charCodeAt(runEnd) === code) {
    runEnd++;
  }

  if (runEnd - at < 3) {
    return null;
  }

  if (code === BACKTICK) {
    for (let index: number = runEnd; index < lineEnd; index++) {
      if (text.charCodeAt(index) === BACKTICK) {
        return null;
      }
    }
  }

  return { code: code, length: runEnd - at };
};

/*
 * Whether the line closes `fence`: up to three spaces, the fence's run, any
 * more backticks or tildes, then spaces alone.
 */
const closesFence: (
  text: string,
  lineStart: number,
  lineEnd: number,
  fence: Fence,
) => boolean = (
  text: string,
  lineStart: number,
  lineEnd: number,
  fence: Fence,
): boolean => {
  let at: number = skipUpToThreeSpaces(text, lineStart);

  for (let index: number = 0; index < fence.length; index++) {
    if (text.charCodeAt(at + index) !== fence.code) {
      return false;
    }
  }

  at += fence.length;

  while (
    at < lineEnd &&
    (text.charCodeAt(at) === BACKTICK || text.charCodeAt(at) === TILDE)
  ) {
    at++;
  }

  return skipSpaces(text, at) >= lineEnd;
};

/*
 * Whether a list's bullet that ends a paragraph starts the line: up to three
 * spaces, "*", "+", "-", "1." or "1)", then a space.
 */
const startsListInParagraph: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  const bullet: number = skipUpToThreeSpaces(text, at);
  const code: number = text.charCodeAt(bullet);
  let after: number = bullet + 1;

  if (code === DIGIT_ONE) {
    const delimiter: number = text.charCodeAt(bullet + 1);

    if (delimiter !== DOT && delimiter !== CLOSE_PARENTHESIS) {
      return false;
    }

    after = bullet + 2;
  } else if (code !== ASTERISK && code !== PLUS && code !== DASH) {
    return false;
  }

  return text.charCodeAt(after) === SPACE;
};

/*
 * Which of the lower case `names` the text at `at` starts with - in any
 * case when `anyCase` - or null when none.
 */
const startsWithAny: (
  text: string,
  at: number,
  names: ReadonlyArray<string>,
  anyCase: boolean,
) => string | null = (
  text: string,
  at: number,
  names: ReadonlyArray<string>,
  anyCase: boolean,
): string | null => {
  for (const name of names) {
    const written: string = text.slice(at, at + name.length);

    if ((anyCase ? written.toLowerCase() : written) === name) {
      return name;
    }
  }

  return null;
};

/*
 * After a block tag opening or closing at "<" - `</?(tag)(?: +|\n|\/?>)` of
 * marked's "html" rule, which reads it whatever its case, and of its
 * paragraph rule, which reads it in lower case alone (`anyCase` false). -1
 * when none is there.
 */
const readBlockTag: (text: string, open: number, anyCase: boolean) => number = (
  text: string,
  open: number,
  anyCase: boolean,
): number => {
  let name: number = open + 1;

  if (text.charCodeAt(name) === SLASH) {
    name++;
  }

  let nameEnd: number = name;

  while (
    nameEnd - name <= LONGEST_BLOCK_TAG_NAME &&
    (isAsciiLetterCode(text.charCodeAt(nameEnd)) ||
      isDigitCode(text.charCodeAt(nameEnd)))
  ) {
    nameEnd++;
  }

  const written: string = text.slice(name, nameEnd);

  if (
    nameEnd - name > LONGEST_BLOCK_TAG_NAME ||
    !BLOCK_TAG_NAMES.has(anyCase ? written.toLowerCase() : written)
  ) {
    return -1;
  }

  const after: number = text.charCodeAt(nameEnd);

  if (after === SPACE) {
    return skipSpaces(text, nameEnd);
  }

  if (after === LINE_FEED || after === GREATER_THAN) {
    return nameEnd + 1;
  }

  if (after === SLASH && text.charCodeAt(nameEnd + 1) === GREATER_THAN) {
    return nameEnd + 2;
  }

  return -1;
};

/*
 * Whether HTML that ends a paragraph starts the line - right at its start,
 * in lower case: a block tag, or "<script", "<pre", "<style", "<textarea"
 * or "<!--".
 */
const startsHtmlInParagraph: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  if (text.charCodeAt(at) !== LESS_THAN) {
    return false;
  }

  return (
    startsWithAny(text, at + 1, RAW_TEXT_TAG_NAMES, false) !== null ||
    text.startsWith("!--", at + 1) ||
    readBlockTag(text, at, false) !== -1
  );
};

/*
 * After a cell of a table's delimiter row at `at` - ":?-+:? *" - or -1
 * when none is there.
 */
const readDelimiterCell: (text: string, at: number) => number = (
  text: string,
  at: number,
): number => {
  let end: number = at;

  if (text.charCodeAt(end) === COLON) {
    end++;
  }

  const dashes: number = end;

  while (text.charCodeAt(end) === DASH) {
    end++;
  }

  if (end === dashes) {
    return -1;
  }

  if (text.charCodeAt(end) === COLON) {
    end++;
  }

  return skipSpaces(text, end);
};

/*
 * How many cells the line text[lineStart, lineEnd) holds as a table's
 * delimiter row - up to three spaces, then cells of "-" with a ":" at
 * either end or none, between pipes, the first and last pipe left out or
 * not - and whether a pipe or a colon is in it. null when it is no such row.
 */
interface DelimiterRow {
  cells: number;
  holdsPipeOrColon: boolean;
}

const readDelimiterRow: (
  text: string,
  lineStart: number,
  lineEnd: number,
) => DelimiterRow | null = (
  text: string,
  lineStart: number,
  lineEnd: number,
): DelimiterRow | null => {
  const rowStart: number = skipUpToThreeSpaces(text, lineStart);
  let end: number = readDelimiterCell(
    text,
    text.charCodeAt(rowStart) === PIPE
      ? skipSpaces(text, rowStart + 1)
      : rowStart,
  );

  if (end === -1) {
    return null;
  }

  let cells: number = 1;

  while (text.charCodeAt(end) === PIPE) {
    const next: number = skipSpaces(text, end + 1);
    const cellEnd: number = readDelimiterCell(text, next);

    // A last pipe, with no cell after it.
    if (cellEnd === -1) {
      end = next;
      break;
    }

    cells++;
    end = cellEnd;
  }

  if (end !== lineEnd) {
    return null;
  }

  let holdsPipeOrColon: boolean = false;

  for (let index: number = rowStart; index < end; index++) {
    const code: number = text.charCodeAt(index);

    if (code === PIPE || code === COLON) {
      holdsPipeOrColon = true;
      break;
    }
  }

  return { cells: cells, holdsPipeOrColon: holdsPipeOrColon };
};

/*
 * How many cells marked splits a table's header row into (splitCells):
 * one more than the pipes no backslash escapes, less a first or last cell
 * of white space alone.
 */
const countHeaderCells: (text: string, from: number, to: number) => number = (
  text: string,
  from: number,
  to: number,
): number => {
  let pipes: number = 0;
  let firstPipe: number = -1;
  let lastPipe: number = -1;
  let backslashes: number = 0;

  for (let index: number = from; index < to; index++) {
    const code: number = text.charCodeAt(index);

    if (code === PIPE && backslashes % 2 === 0) {
      pipes++;
      firstPipe = firstPipe === -1 ? index : firstPipe;
      lastPipe = index;
    }

    backslashes = code === BACKSLASH ? backslashes + 1 : 0;
  }

  let cells: number = pipes + 1;

  if (isAllWhiteSpace(text, from, firstPipe === -1 ? to : firstPipe)) {
    cells--;
  }

  if (pipes > 0 && cells > 0 && isAllWhiteSpace(text, lastPipe + 1, to)) {
    cells--;
  }

  return cells;
};

/*
 * Whether a table's header row starts the line - the line after it a
 * delimiter row - as marked's GFM paragraph rule reads one, which ends a
 * paragraph there: spaces, then a character that is no space, and no line
 * or paragraph separator after it on the line.
 */
const startsTable: (
  reading: LevelReading,
  at: number,
  lineEnd: number,
) => boolean = (
  reading: LevelReading,
  at: number,
  lineEnd: number,
): boolean => {
  const text: string = reading.level.text;
  const header: number = skipSpaces(text, at);

  return (
    lineEnd < text.length &&
    header < lineEnd &&
    findSeparator(reading, header + 1, lineEnd) === -1 &&
    readDelimiterRow(text, lineEnd + 1, getLineEnd(text, lineEnd + 1)) !== null
  );
};

/*
 * Whether the line at `at` - not empty - ends a paragraph before it:
 * marked's paragraph rule, without the GFM tables when `withTables` is
 * false (a block quote's paragraph, whose lazy lines it ends).
 */
const endsParagraph: (
  reading: LevelReading,
  at: number,
  withTables: boolean,
) => boolean = (
  reading: LevelReading,
  at: number,
  withTables: boolean,
): boolean => {
  const text: string = reading.level.text;
  const lineEnd: number = getLineEnd(text, at);

  return (
    isThematicBreak(text, at, lineEnd) ||
    startsAtxHeading(text, at) ||
    startsBlockQuote(text, at) ||
    // A fence, its line ending in a line break.
    (lineEnd < text.length && getOpeningFence(text, at, lineEnd) !== null) ||
    startsListInParagraph(text, at) ||
    startsHtmlInParagraph(text, at) ||
    // Spaces alone, a line break after them.
    (lineEnd < text.length && skipSpaces(text, at) >= lineEnd) ||
    (withTables && startsTable(reading, at, lineEnd))
  );
};

/*
 * Whether the line, from `at`, is a setext heading's underline: up to three
 * spaces, a run of "=" or of "-", then spaces alone.
 */
const isSetextUnderline: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  const mark: number = skipUpToThreeSpaces(text, at);
  const code: number = text.charCodeAt(mark);

  if (code !== EQUALS && code !== DASH) {
    return false;
  }

  let end: number = mark;

  while (text.charCodeAt(end) === code) {
    end++;
  }

  end = skipSpaces(text, end);

  return end >= text.length || text.charCodeAt(end) === LINE_FEED;
};

/*
 * Whether the line at `at` is one a setext heading cannot run over (its
 * "lheading" rule): a bullet and a space at the very start, four spaces, a
 * fence, ">", "#", or an HTML tag that ends its line, a line break after it
 * - and, past its first line, white space alone, a line break after it.
 */
const breaksSetextHeading: (
  text: string,
  at: number,
  isFirstLine: boolean,
) => boolean = (text: string, at: number, isFirstLine: boolean): boolean => {
  if (!isFirstLine) {
    let end: number = at;

    while (
      end < text.length &&
      text.charCodeAt(end) !== LINE_FEED &&
      isWhiteSpaceCode(text.charCodeAt(end))
    ) {
      end++;
    }

    if (text.charCodeAt(end) === LINE_FEED) {
      return true;
    }
  }

  const code: number = text.charCodeAt(at);

  if (
    (code === ASTERISK || code === PLUS || code === DASH) &&
    text.charCodeAt(at + 1) === SPACE
  ) {
    return true;
  }

  let digitsEnd: number = at;

  while (digitsEnd - at < 10 && isDigitCode(text.charCodeAt(digitsEnd))) {
    digitsEnd++;
  }

  const delimiter: number = text.charCodeAt(digitsEnd);

  if (
    digitsEnd > at &&
    digitsEnd - at <= 9 &&
    (delimiter === DOT || delimiter === CLOSE_PARENTHESIS) &&
    text.charCodeAt(digitsEnd + 1) === SPACE
  ) {
    return true;
  }

  if (skipSpaces(text, at) - at >= 4) {
    return true;
  }

  const first: number = skipUpToThreeSpaces(text, at);
  const firstCode: number = text.charCodeAt(first);

  if (
    (firstCode === BACKTICK || firstCode === TILDE) &&
    text.charCodeAt(first + 1) === firstCode &&
    text.charCodeAt(first + 2) === firstCode
  ) {
    return true;
  }

  if (firstCode === GREATER_THAN || firstCode === HASH) {
    return true;
  }

  if (firstCode === LESS_THAN) {
    let end: number = first + 1;

    while (
      end < text.length &&
      text.charCodeAt(end) !== GREATER_THAN &&
      text.charCodeAt(end) !== LINE_FEED
    ) {
      end++;
    }

    return (
      end > first + 1 &&
      text.charCodeAt(end) === GREATER_THAN &&
      text.charCodeAt(end + 1) === LINE_FEED
    );
  }

  return false;
};

/*
 * THE BLOCKS, AS MARKED'S TOKENIZERS READ THEM.
 *
 * Each reads its block from `at` of a level and returns where the next
 * block starts - or -1, or `at`, when its block is not there.
 */

// Lines of spaces alone, and the line breaks after them.
const readSpace: (text: string, at: number) => number = (
  text: string,
  at: number,
): number => {
  let end: number = at;

  for (;;) {
    const spacesEnd: number = skipSpaces(text, end);

    if (spacesEnd >= text.length) {
      return text.length;
    }

    if (text.charCodeAt(spacesEnd) !== LINE_FEED) {
      return end;
    }

    end = spacesEnd + 1;
  }
};

/*
 * Indented code: lines of four spaces and something more, the lines of
 * spaces alone between and after them.
 */
const readIndentedCode: (text: string, at: number) => number = (
  text: string,
  at: number,
): number => {
  let end: number = at;

  while (
    end + 4 < text.length &&
    text.charCodeAt(end) === SPACE &&
    text.charCodeAt(end + 1) === SPACE &&
    text.charCodeAt(end + 2) === SPACE &&
    text.charCodeAt(end + 3) === SPACE &&
    text.charCodeAt(end + 4) !== LINE_FEED
  ) {
    end = getLineEnd(text, end + 4);

    if (end >= text.length) {
      break;
    }

    end++;

    for (;;) {
      const spacesEnd: number = skipSpaces(text, end);

      if (spacesEnd >= text.length) {
        end = text.length;
        break;
      }

      if (text.charCodeAt(spacesEnd) !== LINE_FEED) {
        break;
      }

      end = spacesEnd + 1;
    }
  }

  return end;
};

// A fenced code block, to its closing fence's line or the end of the text.
const readFencedCode: (text: string, at: number, lineEnd: number) => number = (
  text: string,
  at: number,
  lineEnd: number,
): number => {
  const fence: Fence | null = getOpeningFence(text, at, lineEnd);

  if (fence === null) {
    return -1;
  }

  for (
    let lineStart: number = nextLineStart(text, lineEnd);
    lineStart < text.length;

  ) {
    const closeEnd: number = getLineEnd(text, lineStart);

    if (closesFence(text, lineStart, closeEnd, fence)) {
      return closeEnd;
    }

    lineStart = nextLineStart(text, closeEnd);
  }

  return text.length;
};

/*
 * A block quote: lines that start with up to three spaces and ">", each
 * carried on - when anything follows its ">" - by the lazy lines of a
 * paragraph, which only what ends a paragraph ends (blockquote rule). Its
 * lines are read again, as marked reads them, without their markers.
 */
const readBlockQuote: (reading: LevelReading, at: number) => number = (
  reading: LevelReading,
  at: number,
): number => {
  const text: string = reading.level.text;

  if (!startsBlockQuote(text, at)) {
    return -1;
  }

  let end: number = at;

  while (end < text.length && startsBlockQuote(text, end)) {
    const marker: number = skipUpToThreeSpaces(text, end);
    let groupEnd: number = getLineEnd(text, end);
    /*
     * Lazy lines carry on what follows the ">" and a space after it: none
     * when nothing does - marked reads "> " alone as a line of its own.
     */
    const afterMarker: number =
      marker + (text.charCodeAt(marker + 1) === SPACE ? 2 : 1);

    if (afterMarker < groupEnd) {
      while (groupEnd < text.length) {
        const next: number = groupEnd + 1;

        if (
          next >= text.length ||
          text.charCodeAt(next) === LINE_FEED ||
          endsParagraph(reading, next, false)
        ) {
          break;
        }

        groupEnd = getLineEnd(text, next);
      }
    }

    end = nextLineStart(text, groupEnd);
  }

  if (
    reading.level.depth < MAX_DEFINITION_NESTING_DEPTH &&
    holdsDefinitionColon(reading, at, end)
  ) {
    const lines: Array<LevelLine> = [];

    for (let lineStart: number = at; lineStart < end; ) {
      const lineEnd: number = getLineEnd(text, lineStart);

      /*
       * A lazy line that would underline a setext heading gets four spaces
       * first, so it does not; every line loses spaces, a ">" and the space
       * or tab after it.
       */
      if (lineStart > at && isSetextUnderline(text, lineStart)) {
        lines.push({
          lead: 4,
          from: skipSpaces(text, lineStart),
          to: lineEnd,
        });
      } else {
        const marker: number = skipSpaces(text, lineStart);
        let from: number = lineStart;

        if (text.charCodeAt(marker) === GREATER_THAN) {
          from = marker + 1;

          if (from < lineEnd && isSpaceOrTab(text.charCodeAt(from))) {
            from++;
          }
        }

        lines.push({ lead: 0, from: from, to: lineEnd });
      }

      lineStart = lineEnd + 1;
    }

    // No line breaks at its end.
    while (
      lines.length > 0 &&
      lines[lines.length - 1]!.lead === 0 &&
      lines[lines.length - 1]!.from >= lines[lines.length - 1]!.to
    ) {
      lines.pop();
    }

    readBlocks(
      makeLevel(reading.level, lines, reading.level.depth + 1, true),
      true,
      reading.definitions,
    );
  }

  return end;
};

/*
 * A list's bullet: where it ends, and what an item of the same list starts
 * with - the same "*", "+" or "-", or digits and the same "." or ")".
 */
interface ListBullet {
  end: number;
  mark: number;
  isOrdered: boolean;
}

const readBullet: (text: string, at: number) => ListBullet | null = (
  text: string,
  at: number,
): ListBullet | null => {
  const code: number = text.charCodeAt(at);

  if (code === ASTERISK || code === PLUS || code === DASH) {
    return { end: at + 1, mark: code, isOrdered: false };
  }

  let digitsEnd: number = at;

  while (digitsEnd - at < 10 && isDigitCode(text.charCodeAt(digitsEnd))) {
    digitsEnd++;
  }

  const delimiter: number = text.charCodeAt(digitsEnd);

  if (
    digitsEnd === at ||
    digitsEnd - at > 9 ||
    (delimiter !== DOT && delimiter !== CLOSE_PARENTHESIS)
  ) {
    return null;
  }

  return { end: digitsEnd + 1, mark: delimiter, isOrdered: true };
};

/*
 * Where the line text[from, to), after `lead` spaces, has its first
 * character that is no space - -1 when it has none - and the shapes of it
 * that end a list item, as its list tokenizer reads them with up to
 * `maxSpaces` spaces before them.
 */
const getFirstNonSpace: (
  text: string,
  line: LevelLine,
) => { index: number; at: number } = (
  text: string,
  line: LevelLine,
): { index: number; at: number } => {
  let at: number = line.from;

  while (at < line.to && text.charCodeAt(at) === SPACE) {
    at++;
  }

  return { index: at < line.to ? line.lead + (at - line.from) : -1, at: at };
};

const beginsItemBreak: (
  text: string,
  line: LevelLine,
  maxSpaces: number,
  withBullets: boolean,
) => boolean = (
  text: string,
  line: LevelLine,
  maxSpaces: number,
  withBullets: boolean,
): boolean => {
  const first: { index: number; at: number } = getFirstNonSpace(text, line);

  if (first.index === -1 || first.index > maxSpaces) {
    return false;
  }

  const at: number = first.at;
  const code: number = text.charCodeAt(at);

  // A fence: "```" or "~~~".
  if (
    (code === BACKTICK || code === TILDE) &&
    at + 2 < line.to &&
    text.charCodeAt(at + 1) === code &&
    text.charCodeAt(at + 2) === code
  ) {
    return true;
  }

  // A heading: "#".
  if (code === HASH) {
    return true;
  }

  // A thematic break of spaces and three or more of one mark.
  if (code === DASH || code === UNDERSCORE || code === ASTERISK) {
    let marks: number = 0;
    let isBreak: boolean = true;

    for (let index: number = at; index < line.to && isBreak; index++) {
      const next: number = text.charCodeAt(index);

      if (next === code) {
        marks++;
      } else if (next !== SPACE) {
        isBreak = false;
      }
    }

    if (isBreak && marks >= 3) {
      return true;
    }
  }

  // A bullet, then a space, a tab or the end of the line.
  if (withBullets) {
    const bullet: ListBullet | null = readBullet(text, at);

    return (
      bullet !== null &&
      (bullet.end >= line.to || isSpaceOrTab(text.charCodeAt(bullet.end)))
    );
  }

  return false;
};

/*
 * The item of a list whose bullet is `bullet` that starts at `at`, as its
 * list tokenizer reads it: its lines (each as the item holds it), and where
 * the line after them starts. null when no item of the list starts there.
 */
interface ListItem {
  lines: Array<LevelLine>;
  end: number;
}

const readListItem: (
  text: string,
  at: number,
  bullet: ListBullet,
) => ListItem | null = (
  text: string,
  at: number,
  bullet: ListBullet,
): ListItem | null => {
  const lineEnd: number = getLineEnd(text, at);
  const itemBullet: ListBullet | null = readBullet(
    text,
    skipUpToThreeSpaces(text, at),
  );

  if (
    itemBullet === null ||
    itemBullet.isOrdered !== bullet.isOrdered ||
    itemBullet.mark !== bullet.mark ||
    (itemBullet.end < lineEnd &&
      !isSpaceOrTab(text.charCodeAt(itemBullet.end))) ||
    isThematicBreak(text, at, lineEnd)
  ) {
    return null;
  }

  // The first line after the bullet, its first tabs three spaces each.
  const contentStart: number = itemBullet.end;
  let tabsEnd: number = contentStart;

  while (tabsEnd < lineEnd && text.charCodeAt(tabsEnd) === TAB) {
    tabsEnd++;
  }

  const firstLine: LevelLine = {
    lead: 3 * (tabsEnd - contentStart),
    from: tabsEnd,
    to: lineEnd,
  };

  /*
   * How far the item's lines are indented: to the first character after
   * the bullet that is no space - its line break too - or one space past it
   * when that is more than four.
   */
  const firstNonSpace: number = skipSpaces(text, contentStart);
  let indent: number =
    firstNonSpace < text.length ? firstNonSpace - contentStart : -1;

  indent = indent > 4 ? 1 : indent;

  /*
   * What the item holds of its first line: from its indent - all of it
   * when a tab starts it, and the last of the spaces up to the end of the
   * text when they are all it has.
   */
  let head: LevelLine = firstLine;

  if (firstLine.lead === 0) {
    head = {
      lead: 0,
      from:
        indent >= 0
          ? Math.min(contentStart + indent, lineEnd)
          : Math.max(contentStart, lineEnd - 1),
      to: lineEnd,
    };
  }

  indent += contentStart - at;

  const lines: Array<LevelLine> = [head];
  let end: number = nextLineStart(text, lineEnd);

  // An item that is no more than its bullet ends at a blank line after it.
  const isEmpty: boolean = firstLine.lead === 0 && contentStart === lineEnd;

  if (isEmpty && skipSpaces(text, end) >= getLineEnd(text, end)) {
    return {
      lines: lines,
      end: nextLineStart(text, getLineEnd(text, end)),
    };
  }

  const maxSpaces: number = Math.min(3, indent - 1);
  let hasBlankLine: boolean = false;
  let previous: LevelLine = firstLine;

  while (end < text.length) {
    const nextEnd: number = getLineEnd(text, end);
    const next: LevelLine = { lead: 0, from: end, to: nextEnd };

    if (beginsItemBreak(text, next, maxSpaces, true)) {
      break;
    }

    const isBlank: boolean = isAllWhiteSpace(text, end, nextEnd);
    const nextFirst: number = getFirstNonSpace(text, next).index;
    const dedented: LevelLine = {
      lead: 0,
      from: Math.min(end + indent, nextEnd),
      to: nextEnd,
    };

    if (nextFirst >= indent || isBlank) {
      lines.push(dedented);
    } else {
      // A lazy line carries on a paragraph alone.
      if (
        hasBlankLine ||
        getFirstNonSpace(text, previous).index >= 4 ||
        beginsItemBreak(text, previous, maxSpaces, false)
      ) {
        break;
      }

      lines.push(next);
    }

    hasBlankLine = hasBlankLine || isBlank;
    end = nextLineStart(text, nextEnd);
    previous = dedented;
  }

  // A task's "[ ] " or "[x] ", and the spaces after it, are no content.
  const content: LevelLine = lines[0]!;

  if (
    content.lead === 0 &&
    content.from + 3 < content.to &&
    text.charCodeAt(content.from) === OPEN_BRACKET &&
    (text.charCodeAt(content.from + 1) === SPACE ||
      text.charCodeAt(content.from + 1) === LOWER_X ||
      text.charCodeAt(content.from + 1) === UPPER_X) &&
    text.charCodeAt(content.from + 2) === CLOSE_BRACKET &&
    text.charCodeAt(content.from + 3) === SPACE
  ) {
    lines[0] = {
      lead: 0,
      from: Math.min(skipSpaces(text, content.from + 3), content.to),
      to: content.to,
    };
  }

  return { lines: lines, end: end };
};

/*
 * A list: its items, each up to the next item of the same list (list
 * rule) - the last without the white space at its end, which the blocks
 * after the list read. Each item's lines are read again, as marked reads
 * them, without the bullet and indentation.
 */
const readList: (reading: LevelReading, at: number) => number = (
  reading: LevelReading,
  at: number,
): number => {
  const text: string = reading.level.text;
  const lineEnd: number = getLineEnd(text, at);
  const bullet: ListBullet | null = readBullet(
    text,
    skipUpToThreeSpaces(text, at),
  );

  /*
   * The first item's bullet ends its line, or a space or a tab and more
   * come after it.
   */
  if (
    bullet === null ||
    (bullet.end < lineEnd &&
      (!isSpaceOrTab(text.charCodeAt(bullet.end)) || bullet.end + 1 >= lineEnd))
  ) {
    return -1;
  }

  const items: Array<Array<LevelLine>> = [];
  let itemsEnd: number = at;

  while (itemsEnd < text.length) {
    const item: ListItem | null = readListItem(text, itemsEnd, bullet);

    if (item === null) {
      break;
    }

    items.push(item.lines);
    itemsEnd = item.end;
  }

  let end: number = itemsEnd;

  while (end > at && isWhiteSpaceCode(text.charCodeAt(end - 1))) {
    end--;
  }

  // The last item without the white space at its end.
  const last: Array<LevelLine> = items[items.length - 1]!;

  while (last.length > 0) {
    const line: LevelLine = last[last.length - 1]!;
    let to: number = line.to;

    while (to > line.from && isWhiteSpaceCode(text.charCodeAt(to - 1))) {
      to--;
    }

    if (to > line.from) {
      last[last.length - 1] = { lead: line.lead, from: line.from, to: to };
      break;
    }

    last.pop();
  }

  if (reading.level.depth < MAX_DEFINITION_NESTING_DEPTH) {
    for (const lines of items) {
      if (
        lines.length > 0 &&
        holdsDefinitionColon(
          reading,
          lines[0]!.from,
          lines[lines.length - 1]!.to,
        )
      ) {
        readBlocks(
          makeLevel(reading.level, lines, reading.level.depth + 1, false),
          false,
          reading.definitions,
        );
      }
    }
  }

  return end;
};

/*
 * After the line breaks after text[found, found + length), or the end of
 * the text when `found` is -1: the end of an HTML block of the third to
 * fifth kind, which can end inside its line.
 */
const afterAndLineBreaks: (
  text: string,
  found: number,
  length: number,
) => number = (text: string, found: number, length: number): number => {
  return found === -1 ? text.length : skipLineBreaks(text, found + length);
};

// After a line of the text from `at` that is spaces and tabs alone.
const isRestOfLineBlank: (text: string, at: number) => boolean = (
  text: string,
  at: number,
): boolean => {
  let end: number = at;

  while (isSpaceOrTab(text.charCodeAt(end))) {
    end++;
  }

  return end >= text.length || text.charCodeAt(end) === LINE_FEED;
};

/*
 * After a tag's name - a letter, then letters, digits, "_" and "-" - at
 * `at`, or -1 when no name starts there.
 */
const readTagName: (text: string, at: number) => number = (
  text: string,
  at: number,
): number => {
  if (!isAsciiLetterCode(text.charCodeAt(at))) {
    return -1;
  }

  let end: number = at + 1;

  while (isWordCode(text.charCodeAt(end)) || text.charCodeAt(end) === DASH) {
    end++;
  }

  return end;
};

/*
 * After an attribute's value at `at` - in double quotes, in single quotes,
 * on its line, or characters that are none of white space, quotes, "=",
 * "<", ">" and "`" - or -1 when none is there.
 */
const readAttributeValue: (text: string, at: number) => number = (
  text: string,
  at: number,
): number => {
  const opening: number = text.charCodeAt(at);

  if (opening === DOUBLE_QUOTE || opening === SINGLE_QUOTE) {
    for (let index: number = at + 1; index < text.length; index++) {
      const code: number = text.charCodeAt(index);

      if (code === opening) {
        return index + 1;
      }

      if (code === LINE_FEED) {
        return -1;
      }
    }

    return -1;
  }

  let end: number = at;

  while (end < text.length) {
    const code: number = text.charCodeAt(end);

    if (
      isWhiteSpaceCode(code) ||
      code === DOUBLE_QUOTE ||
      code === SINGLE_QUOTE ||
      code === EQUALS ||
      code === LESS_THAN ||
      code === GREATER_THAN ||
      code === BACKTICK
    ) {
      break;
    }

    end++;
  }

  return end > at ? end : -1;
};

/*
 * After a whole open or closing tag at "<" that only spaces and tabs
 * follow on its line - an HTML block of marked's seventh kind - or -1. Its
 * name starts with none of "script", "pre", "style" and "textarea".
 */
const readWholeTag: (text: string, open: number) => number = (
  text: string,
  open: number,
): number => {
  const isClosing: boolean = text.charCodeAt(open + 1) === SLASH;
  const name: number = open + (isClosing ? 2 : 1);

  if (startsWithAny(text, name, RAW_TEXT_TAG_NAMES, true) !== null) {
    return -1;
  }

  let end: number = readTagName(text, name);

  if (end === -1) {
    return -1;
  }

  if (isClosing) {
    while (end < text.length && isWhiteSpaceCode(text.charCodeAt(end))) {
      end++;
    }

    return text.charCodeAt(end) === GREATER_THAN &&
      isRestOfLineBlank(text, end + 1)
      ? end + 1
      : -1;
  }

  // Attributes: spaces, a name, and perhaps "=" and a value.
  for (;;) {
    const attribute: number = skipSpaces(text, end);
    const code: number = text.charCodeAt(attribute);

    if (
      attribute === end ||
      !(isAsciiLetterCode(code) || code === COLON || code === UNDERSCORE)
    ) {
      break;
    }

    end = attribute + 1;

    while (
      isWordCode(text.charCodeAt(end)) ||
      text.charCodeAt(end) === DOT ||
      text.charCodeAt(end) === COLON ||
      text.charCodeAt(end) === DASH
    ) {
      end++;
    }

    const equals: number = skipSpaces(text, end);

    if (text.charCodeAt(equals) === EQUALS) {
      // An "=" no value follows can be read no other way.
      end = readAttributeValue(text, skipSpaces(text, equals + 1));

      if (end === -1) {
        return -1;
      }
    }
  }

  let close: number = skipSpaces(text, end);

  if (text.charCodeAt(close) === SLASH) {
    close++;
  }

  return text.charCodeAt(close) === GREATER_THAN &&
    isRestOfLineBlank(text, close + 1)
    ? close + 1
    : -1;
};

/*
 * After the blank line that ends an HTML block of the sixth or seventh kind
 * from `from` - and the lines of spaces alone after it - or the end of the
 * text.
 */
const readHtmlBlockEnd: (reading: LevelReading, from: number) => number = (
  reading: LevelReading,
  from: number,
): number => {
  const text: string = reading.level.text;
  let end: number = reading.nextBlankLineBreak(from);

  if (end === -1) {
    return text.length;
  }

  for (;;) {
    const next: number = skipSpaces(text, end + 1);

    if (text.charCodeAt(next) !== LINE_FEED) {
      return end + 1;
    }

    end = next;
  }
};

/*
 * An HTML block (html rule), of the first of its kinds that starts at
 * `at`: <script>, <pre>, <style> or <textarea> to the line of its closing
 * tag; a comment, to the line of its "-->"; "<?" to "?>"; "<!" and a letter
 * to ">"; "<![CDATA[" to "]]>"; a block tag, or a whole tag alone on its
 * line, to a blank line. Each runs to the end of the text when what ends it
 * is not there.
 */
const readHtml: (reading: LevelReading, at: number) => number = (
  reading: LevelReading,
  at: number,
): number => {
  const text: string = reading.level.text;
  const open: number = skipUpToThreeSpaces(text, at);

  if (text.charCodeAt(open) !== LESS_THAN) {
    return -1;
  }

  const name: number = open + 1;
  const rawTextTag: string | null = startsWithAny(
    text,
    name,
    RAW_TEXT_TAG_NAMES,
    true,
  );
  const afterRawTextTag: number =
    rawTextTag === null ? -1 : text.charCodeAt(name + rawTextTag.length);

  if (
    rawTextTag !== null &&
    (afterRawTextTag === GREATER_THAN || isWhiteSpaceCode(afterRawTextTag))
  ) {
    // The first closing tag on a line a line break ends.
    for (
      let close: number = text.indexOf("</", name + rawTextTag.length + 1);
      close !== -1;
      close = text.indexOf("</", close + 1)
    ) {
      const tagEnd: number = close + 2 + rawTextTag.length;

      if (
        text.slice(close + 2, tagEnd).toLowerCase() === rawTextTag &&
        text.charCodeAt(tagEnd) === GREATER_THAN
      ) {
        const lineEnd: number = getLineEnd(text, tagEnd);

        return lineEnd >= text.length
          ? text.length
          : skipLineBreaks(text, lineEnd);
      }
    }

    return text.length;
  }

  if (text.startsWith("!--", name)) {
    const afterOpening: number = name + 3;
    let close: number = afterOpening + 1;

    if (text.charCodeAt(afterOpening) === DASH) {
      close = afterOpening + 2;
    }

    if (text.charCodeAt(close - 1) !== GREATER_THAN) {
      const found: number = text.indexOf("-->", afterOpening);

      close = found === -1 ? text.length : found + 3;
    }

    const lineEnd: number = getLineEnd(text, close);

    return lineEnd >= text.length ? text.length : skipLineBreaks(text, lineEnd);
  }

  if (text.charCodeAt(name) === QUESTION_MARK) {
    return afterAndLineBreaks(text, text.indexOf("?>", name + 1), 2);
  }

  if (
    text.charCodeAt(name) === EXCLAMATION_MARK &&
    isAsciiLetterCode(text.charCodeAt(name + 1))
  ) {
    return afterAndLineBreaks(text, text.indexOf(">", name + 2), 1);
  }

  if (text.slice(name, name + 8).toUpperCase() === "![CDATA[") {
    return afterAndLineBreaks(text, text.indexOf("]]>", name + 8), 3);
  }

  const afterBlockTag: number = readBlockTag(text, open, true);

  if (afterBlockTag !== -1) {
    return readHtmlBlockEnd(reading, afterBlockTag);
  }

  const afterWholeTag: number = readWholeTag(text, open);

  return afterWholeTag === -1 ? -1 : readHtmlBlockEnd(reading, afterWholeTag);
};

/*
 * A GFM table (table rule): a header row, a delimiter row with a pipe or a
 * colon and as many cells, then the rows up to a line that is none -
 * blank, or what starts another block - and the line breaks after them.
 */
const readTable: (
  reading: LevelReading,
  at: number,
  lineEnd: number,
) => number = (reading: LevelReading, at: number, lineEnd: number): number => {
  const text: string = reading.level.text;

  if (!startsTable(reading, at, lineEnd)) {
    return -1;
  }

  const delimiterEnd: number = getLineEnd(text, lineEnd + 1);
  const delimiter: DelimiterRow = readDelimiterRow(
    text,
    lineEnd + 1,
    delimiterEnd,
  )!;

  if (
    !delimiter.holdsPipeOrColon ||
    delimiter.cells !== countHeaderCells(text, skipSpaces(text, at), lineEnd)
  ) {
    return -1;
  }

  let rowStart: number = nextLineStart(text, delimiterEnd);

  while (rowStart < text.length) {
    const rowEnd: number = getLineEnd(text, rowStart);
    const first: number = skipSpaces(text, rowStart);

    if (
      // Spaces alone, a line break after them.
      (first === rowEnd && rowEnd < text.length) ||
      isThematicBreak(text, rowStart, rowEnd) ||
      startsAtxHeading(text, rowStart) ||
      startsBlockQuote(text, rowStart) ||
      // Four spaces, and anything after them.
      (first - rowStart >= 4 && rowStart + 4 < rowEnd) ||
      (rowEnd < text.length &&
        getOpeningFence(text, rowStart, rowEnd) !== null) ||
      startsListInParagraph(text, rowStart) ||
      startsHtmlInParagraph(text, rowStart) ||
      findSeparator(reading, rowStart, rowEnd) !== -1
    ) {
      break;
    }

    rowStart = nextLineStart(text, rowEnd);
  }

  return skipLineBreaks(text, rowStart);
};

/*
 * A setext heading (lheading rule): lines up to the first underline of "="
 * or "-" - unless a line it cannot run over, or a line or paragraph
 * separator, comes first.
 */
const readSetextHeading: (reading: LevelReading, at: number) => number = (
  reading: LevelReading,
  at: number,
): number => {
  if (reading.setextFrom < at && at <= reading.setextStop) {
    return -1;
  }

  const text: string = reading.level.text;

  if (breaksSetextHeading(text, at, true)) {
    return -1;
  }

  for (let lineStart: number = at; ; ) {
    const lineEnd: number = getLineEnd(text, lineStart);
    const separator: number = findSeparator(reading, lineStart, lineEnd);

    if (separator !== -1 || lineEnd >= text.length) {
      reading.setextFrom = at;
      reading.setextStop = separator === -1 ? text.length : separator;
      return -1;
    }

    if (isSetextUnderline(text, lineEnd + 1)) {
      return skipLineBreaks(text, getLineEnd(text, lineEnd + 1));
    }

    if (breaksSetextHeading(text, lineEnd + 1, false)) {
      reading.setextFrom = at;
      reading.setextStop = lineEnd;
      return -1;
    }

    lineStart = lineEnd + 1;
  }
};

/*
 * A paragraph whose first line ends at `lineEnd`: lines up to one that is
 * empty or ends it.
 */
const readParagraph: (reading: LevelReading, lineEnd: number) => number = (
  reading: LevelReading,
  lineEnd: number,
): number => {
  const text: string = reading.level.text;
  let end: number = lineEnd;

  while (end + 1 < text.length) {
    const next: number = end + 1;

    if (
      text.charCodeAt(next) === LINE_FEED ||
      endsParagraph(reading, next, true)
    ) {
      break;
    }

    end = getLineEnd(text, next);
  }

  return end;
};

/*
 * A definition read at `blockStart` of a level, where it is in the whole
 * text: in a quote or a list item, with what marked reads of it there.
 */
const toWholeDefinition: (
  level: BlockLevel,
  definition: LinkReferenceDefinition,
) => LinkReferenceDefinition = (
  level: BlockLevel,
  definition: LinkReferenceDefinition,
): LinkReferenceDefinition => {
  const blockStart: number = definition.start;
  const startsLine: boolean =
    blockStart === 0 || level.text.charCodeAt(blockStart - 1) === LINE_FEED;
  const whole: LinkReferenceDefinition = {
    start: startsLine
      ? getWholeLineStart(level, blockStart)
      : toWhole(level, blockStart),
    labelStart: toWhole(level, definition.labelStart),
    labelEnd: toWhole(level, definition.labelEnd),
    label: definition.label,
    destinationStart: toWhole(level, definition.destinationStart),
    destinationEnd: toWhole(level, definition.destinationEnd),
    end: toWhole(level, definition.end),
  };

  if (level.depth > 0) {
    whole.nested = {
      text: level.text.slice(blockStart, definition.end),
      labelStart: definition.labelStart - blockStart,
      labelEnd: definition.labelEnd - blockStart,
      destinationEnd: definition.destinationEnd - blockStart,
    };
  }

  return whole;
};

/*
 * Every definition marked reads in a level, read as its lexer reads the
 * level's blocks (blockTokens): `top` when its paragraphs run over lines -
 * the whole text, a quote, and a list item's lines after a list in it -
 * and not when each line is text of its own, as in a list item.
 */
const readBlocks: (
  level: BlockLevel,
  top: boolean,
  definitions: Array<LinkReferenceDefinition>,
) => void = (
  level: BlockLevel,
  top: boolean,
  definitions: Array<LinkReferenceDefinition>,
): void => {
  const reading: LevelReading = startReading(level, definitions);
  const text: string = level.text;
  let isTop: boolean = top;
  // Whether the block before is a paragraph or text: a definition carries it on.
  let carriesOn: boolean = false;
  let at: number = 0;

  while (at < text.length) {
    // One line break joins the block before it; more end a paragraph.
    const spaceEnd: number = readSpace(text, at);

    if (spaceEnd > at) {
      carriesOn = carriesOn && spaceEnd - at === 1;
      at = spaceEnd;
      continue;
    }

    // Indented code carries on a paragraph, as a definition would.
    const codeEnd: number = readIndentedCode(text, at);

    if (codeEnd > at) {
      at = codeEnd;
      continue;
    }

    const lineEnd: number = getLineEnd(text, at);
    const fenceEnd: number = readFencedCode(text, at, lineEnd);

    if (fenceEnd !== -1) {
      carriesOn = false;
      at = fenceEnd;
      continue;
    }

    if (
      isAtxHeading(reading, at, lineEnd) ||
      isThematicBreak(text, at, lineEnd)
    ) {
      carriesOn = false;
      at = nextLineStart(text, lineEnd);
      continue;
    }

    const quoteEnd: number = readBlockQuote(reading, at);

    if (quoteEnd !== -1) {
      carriesOn = false;
      at = quoteEnd;
      continue;
    }

    // After a list, marked reads paragraphs over lines (its items set "top").
    const listEnd: number = readList(reading, at);

    if (listEnd !== -1) {
      carriesOn = false;
      isTop = true;
      at = listEnd;
      continue;
    }

    const htmlEnd: number = readHtml(reading, at);

    if (htmlEnd !== -1) {
      carriesOn = false;
      at = htmlEnd;
      continue;
    }

    const definition: DefinitionReading | null = readDefinition(
      text,
      at,
      getFinders(reading),
    );

    if (definition !== null) {
      if (!carriesOn) {
        definitions.push(toWholeDefinition(level, definition.definition));
      }

      at = definition.next;
      continue;
    }

    const tableEnd: number = readTable(reading, at, lineEnd);

    if (tableEnd !== -1) {
      carriesOn = false;
      at = tableEnd;
      continue;
    }

    const headingEnd: number = readSetextHeading(reading, at);

    if (headingEnd !== -1) {
      carriesOn = false;
      at = headingEnd;
      continue;
    }

    at = isTop ? readParagraph(reading, lineEnd) : lineEnd;
    carriesOn = true;
  }
};

/*
 * Every link reference definition marked reads in `text` (see the top of
 * this file), in the order of the text: a label defined twice, twice.
 */
export const getLinkReferenceDefinitions: (
  text: string,
) => Array<LinkReferenceDefinition> = (
  text: string,
): Array<LinkReferenceDefinition> => {
  const definitions: Array<LinkReferenceDefinition> = [];

  if (typeof text !== "string" || text.indexOf("]:") === -1) {
    return definitions;
  }

  readBlocks(getWholeLevel(text), true, definitions);

  return definitions;
};

/*
 * Calls `found` with the label of every pair of brackets in text[start,
 * end) that holds no other, as a reference to a definition is written -
 * "[text][label]", "[label][]", "[label]", "![alt][label]" - normalized as
 * marked matches it (normalizeLinkLabel). More than the references marked
 * reads: a link's text, a bracket in code, a definition's own label. One
 * pass, whatever the text holds.
 */
export const forEachBracketedLabel: (
  text: string,
  start: number,
  end: number,
  found: (label: string) => void,
) => void = (
  text: string,
  start: number,
  end: number,
  found: (label: string) => void,
): void => {
  let open: number = -1;

  for (let index: number = start; index < end; index++) {
    const code: number = text.charCodeAt(index);

    if (code === BACKSLASH) {
      if (
        index + 1 < end &&
        !isLineTerminatorCode(text.charCodeAt(index + 1))
      ) {
        index++;
      }

      continue;
    }

    if (code === OPEN_BRACKET) {
      open = index;
      continue;
    }

    if (code === CLOSE_BRACKET && open !== -1) {
      if (!isAllWhiteSpace(text, open + 1, index)) {
        found(normalizeLinkLabel(text.slice(open + 1, index)));
      }

      open = -1;
    }
  }
};
