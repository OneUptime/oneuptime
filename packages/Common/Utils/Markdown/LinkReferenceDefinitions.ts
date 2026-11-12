import {
  isLineTerminatorCode,
  isWhiteSpaceCode,
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
 * definition's address can be megabytes of base64 on one line (AGENTS.md,
 * "Megabyte-long values"). Every definition of a text is found in time
 * linear in its length, whatever its shape: what is looked for ahead of a
 * line - a title's closing quote - is remembered, not looked for again.
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
 * Where marked looks for a definition: at the first line, after a blank
 * line, and right after a definition, an ATX heading, a thematic break, a
 * fenced code block or an indented one - never inside code, and never on a
 * line that carries on a paragraph, a list item, a quote, a table or an
 * HTML block. That is every definition a description writes on lines of its
 * own. marked also reads a definition inside a block quote, in a list item
 * indented four spaces or more, and right after a setext heading, which
 * this does not find; and this finds a definition-shaped line inside an
 * HTML comment or <pre> block that runs over blank lines, which marked
 * reads as HTML. Either is rare in a description, and costs no more than
 * before: a reference a cut field shows as Markdown, or a definition kept
 * that nothing reads.
 *
 * Line breaks are "\n": a caller with "\r\n" or "\r" in its text reads them
 * as marked does first, and finds the definitions in that.
 *
 * Pure, with no Node or browser APIs.
 */

export interface LinkReferenceDefinition {
  // Where its line starts: before the up to three spaces ahead of its "[".
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
}

const SPACE: number = 0x20;
const TAB: number = 0x09;
const LINE_FEED: number = 0x0a;
const DOUBLE_QUOTE: number = 0x22;
const HASH: number = 0x23;
const SINGLE_QUOTE: number = 0x27;
const OPEN_PARENTHESIS: number = 0x28;
const ASTERISK: number = 0x2a;
const DASH: number = 0x2d;
const COLON: number = 0x3a;
const LESS_THAN: number = 0x3c;
const GREATER_THAN: number = 0x3e;
const OPEN_BRACKET: number = 0x5b;
const BACKSLASH: number = 0x5c;
const CLOSE_BRACKET: number = 0x5d;
const UNDERSCORE: number = 0x5f;
const BACKTICK: number = 0x60;
const TILDE: number = 0x7e;

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

/*
 * After the indent of the line that starts at `lineStart`, as marked reads
 * it: the tabs right after its first spaces are spaces to marked, any tab
 * after that is not.
 */
const skipIndent: (text: string, lineStart: number) => number = (
  text: string,
  lineStart: number,
): number => {
  let at: number = skipSpaces(text, lineStart);

  while (text.charCodeAt(at) === TAB) {
    at++;
  }

  return skipSpaces(text, at);
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

// A definition read, and where the line after it starts.
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
        ? skipIndent(text, afterSpaces + 1)
        : afterSpaces;
    const titleEnd: number = readTitle(text, titleStart, finders);

    if (titleEnd !== -1) {
      return {
        definition: {
          ...definition,
          destinationEnd: destinationEnd,
          end: titleEnd,
        },
        next: nextLineStart(text, lineEndAfterSpaces(text, titleEnd)),
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
    next: nextLineStart(text, lineEnd),
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

// The definition on the line that starts at `lineStart`, if one starts there.
const readDefinition: (
  text: string,
  lineStart: number,
  finders: TitleFinders,
) => DefinitionReading | null = (
  text: string,
  lineStart: number,
  finders: TitleFinders,
): DefinitionReading | null => {
  let at: number = lineStart;

  while (at - lineStart < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

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
    destinationStart = skipIndent(text, destinationStart + 1);
  }

  if (destinationStart >= text.length) {
    return null;
  }

  const definition: Omit<LinkReferenceDefinition, "destinationEnd" | "end"> = {
    start: lineStart,
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
 * Whether the line is blank to marked: nothing but its indent - spaces,
 * tabs, spaces (skipIndent).
 */
const isBlankLine: (
  text: string,
  lineStart: number,
  lineEnd: number,
) => boolean = (text: string, lineStart: number, lineEnd: number): boolean => {
  return skipIndent(text, lineStart) >= lineEnd;
};

/*
 * Whether the line, not blank, is indented code where a block starts: four
 * spaces or more, or a tab after fewer - a tab there is four spaces.
 */
const isIndentedCodeLine: (text: string, lineStart: number) => boolean = (
  text: string,
  lineStart: number,
): boolean => {
  const spacesEnd: number = skipSpaces(text, lineStart);

  return spacesEnd - lineStart >= 4 || text.charCodeAt(spacesEnd) === TAB;
};

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
  let at: number = lineStart;

  while (at - lineStart < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

  const mark: number = text.charCodeAt(at);

  if (mark !== DASH && mark !== UNDERSCORE && mark !== ASTERISK) {
    return false;
  }

  let marks: number = 0;

  for (; at < lineEnd; at++) {
    const code: number = text.charCodeAt(at);

    if (code === mark) {
      marks++;
    } else if (code !== SPACE && code !== TAB) {
      return false;
    }
  }

  return marks >= 3;
};

/*
 * Whether the line is an ATX heading: up to three spaces, one to six "#",
 * then white space or the end of the text - and no line or paragraph
 * separator (U+2028, U+2029) on the line, which marked's heading rule reads
 * with ".": such a line is text (`holdsSeparator`).
 */
const isAtxHeading: (
  text: string,
  lineStart: number,
  lineEnd: number,
  holdsSeparator: (lineStart: number, lineEnd: number) => boolean,
) => boolean = (
  text: string,
  lineStart: number,
  lineEnd: number,
  holdsSeparator: (lineStart: number, lineEnd: number) => boolean,
): boolean => {
  let at: number = lineStart;

  while (at - lineStart < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

  let hashes: number = 0;

  while (text.charCodeAt(at + hashes) === HASH) {
    hashes++;
  }

  return (
    hashes >= 1 &&
    hashes <= 6 &&
    (at + hashes >= text.length ||
      isWhiteSpaceCode(text.charCodeAt(at + hashes))) &&
    !holdsSeparator(lineStart, lineEnd)
  );
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
  let at: number = lineStart;

  while (at - lineStart < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

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
    const backtick: number = text.indexOf("`", runEnd);

    if (backtick !== -1 && backtick < lineEnd) {
      return null;
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
  let at: number = lineStart;

  while (at - lineStart < 3 && text.charCodeAt(at) === SPACE) {
    at++;
  }

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

  const finders: TitleFinders = getTitleFinders(text);
  const nextLineSeparator: NextPositionFunction = remembered(
    (from: number): number => {
      return text.indexOf("\u2028", from);
    },
  );
  const nextParagraphSeparator: NextPositionFunction = remembered(
    (from: number): number => {
      return text.indexOf("\u2029", from);
    },
  );
  const holdsSeparator: (lineStart: number, lineEnd: number) => boolean = (
    lineStart: number,
    lineEnd: number,
  ): boolean => {
    const line: number = nextLineSeparator(lineStart);
    const paragraph: number = nextParagraphSeparator(lineStart);

    return (
      (line !== -1 && line < lineEnd) ||
      (paragraph !== -1 && paragraph < lineEnd)
    );
  };
  // Whether a block may start at the line: where marked tries a definition.
  let blockStart: boolean = true;
  let fence: Fence | null = null;
  let indentedCode: boolean = false;
  let lineStart: number = 0;

  while (lineStart < text.length) {
    const lineBreak: number = text.indexOf("\n", lineStart);
    const lineEnd: number = lineBreak === -1 ? text.length : lineBreak;
    const next: number = nextLineStart(text, lineEnd);

    if (fence !== null) {
      if (closesFence(text, lineStart, lineEnd, fence)) {
        fence = null;
        blockStart = true;
      }

      lineStart = next;
      continue;
    }

    if (isBlankLine(text, lineStart, lineEnd)) {
      blockStart = true;
      lineStart = next;
      continue;
    }

    // Indented code runs over blank lines, to the first line indented less.
    if (indentedCode) {
      if (isIndentedCodeLine(text, lineStart)) {
        lineStart = next;
        continue;
      }

      indentedCode = false;
      blockStart = true;
    }

    // These start a block wherever they are, and end it on their line.
    fence = getOpeningFence(text, lineStart, lineEnd);

    if (fence !== null) {
      lineStart = next;
      continue;
    }

    if (
      isAtxHeading(text, lineStart, lineEnd, holdsSeparator) ||
      isThematicBreak(text, lineStart, lineEnd)
    ) {
      blockStart = true;
      lineStart = next;
      continue;
    }

    if (blockStart) {
      if (isIndentedCodeLine(text, lineStart)) {
        indentedCode = true;
        blockStart = false;
        lineStart = next;
        continue;
      }

      const reading: DefinitionReading | null = readDefinition(
        text,
        lineStart,
        finders,
      );

      if (reading !== null) {
        definitions.push(reading.definition);
        lineStart = reading.next;
        continue;
      }
    }

    // A paragraph, a list, a quote, a table: its next line carries it on.
    blockStart = false;
    lineStart = next;
  }

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
