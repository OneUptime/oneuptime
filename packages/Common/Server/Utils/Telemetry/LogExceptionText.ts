import {
  isAsciiLetterCode,
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
  isWordCode,
} from "../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * WHAT AN ERROR LOG'S BODY SAYS ABOUT THE EXCEPTION IN IT, READ ONCE.
 *
 * LogExceptionExtractor reads the body of every ERROR log an application
 * sends: first whether it looks like a stack trace at all, then the type
 * and message on its first line. Each reader here stands for the pattern it
 * replaced (named above it) and answers exactly as that pattern did.
 *
 * Those patterns let one run be read again from each of its characters - a
 * run of line breaks before "at", a dotted name with no "Error" in it, the
 * white space before a message that holds a line separator - so a body
 * built for it took time that grew with the square or the cube of its
 * length (a 4,000-character first line took seconds). Each reader reads
 * the text a fixed number of times.
 * ---------------------------------------------------------------------------
 */

const NEWLINE: number = 0x0a;
const COLON: number = 0x3a;
const DOUBLE_QUOTE: number = 0x22;
const DOT: number = 0x2e;
const DOLLAR: number = 0x24;
const UNDERSCORE: number = 0x5f;

type FromFunction = (text: string, from: number) => number;

// The first index at or after `from` that is not white space.
const whiteSpaceEnd: FromFunction = (text: string, from: number): number => {
  let index: number = from;

  while (index < text.length && isWhiteSpaceCode(text.charCodeAt(index))) {
    index++;
  }

  return index;
};

type HasNoLineTerminatorFromFunction = (text: string, from: number) => boolean;

// Whether the text holds no line terminator at or after `from`.
const hasNoLineTerminatorFrom: HasNoLineTerminatorFromFunction = (
  text: string,
  from: number,
): boolean => {
  for (let index: number = text.length - 1; index >= from; index--) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
};

/*
 * The first index at or after a point where something is, for points that
 * only ever move forward: what was found is kept, and the search goes on
 * from where it stopped, so the text is read once however often it is
 * asked. -1 when there is none.
 */
class ForwardFinder {
  private readonly text: string;
  private readonly isAt: (text: string, index: number) => boolean;
  private searchedUpTo: number = 0;
  private found: number = -1;

  public constructor(
    text: string,
    isAt: (text: string, index: number) => boolean,
  ) {
    this.text = text;
    this.isAt = isAt;
  }

  public atOrAfter(from: number): number {
    if (this.found >= from) {
      return this.found;
    }

    for (
      let index: number = Math.max(from, this.searchedUpTo);
      index < this.text.length;
      index++
    ) {
      this.searchedUpTo = index + 1;

      if (this.isAt(this.text, index)) {
        this.found = index;
        return index;
      }
    }

    this.searchedUpTo = this.text.length;
    this.found = -1;

    return -1;
  }
}

type IsAtFunction = (text: string, index: number) => boolean;

const isLineTerminatorAt: IsAtFunction = (
  text: string,
  index: number,
): boolean => {
  return isLineTerminatorCode(text.charCodeAt(index));
};

const isColonThenDigitAt: IsAtFunction = (
  text: string,
  index: number,
): boolean => {
  return (
    text.charCodeAt(index) === COLON && isDigitCode(text.charCodeAt(index + 1))
  );
};

const isDoubleQuoteAt: IsAtFunction = (
  text: string,
  index: number,
): boolean => {
  return text.charCodeAt(index) === DOUBLE_QUOTE;
};

/*
 * \n\s+at\s+.+:\d+ - a line break, white space, "at", white space, then on
 * the same line (a ":" and a digit after at least one character).
 *
 * The white space after the line break must hold one more character, and
 * every line break of one run of white space reaches the same "at", so
 * each run is asked about once: whether it holds a line break before its
 * last character. After "at" and its white space, the ":" may come later
 * on the line, or - when the white space before it holds a character other
 * than a line terminator after its first - right where the white space
 * ends.
 */
type TextTestFunction = (text: string) => boolean;

const hasIndentedAtFrame: TextTestFunction = (text: string): boolean => {
  const terminators: ForwardFinder = new ForwardFinder(
    text,
    isLineTerminatorAt,
  );
  const locations: ForwardFinder = new ForwardFinder(text, isColonThenDigitAt);

  let index: number = 0;

  while (index < text.length) {
    if (!isWhiteSpaceCode(text.charCodeAt(index))) {
      index++;
      continue;
    }

    // A run of white space [index, runEnd): does it hold "\n" before its last character?
    const runEnd: number = whiteSpaceEnd(text, index);
    let hasNewline: boolean = false;

    for (let at: number = index; at < runEnd - 1; at++) {
      if (text.charCodeAt(at) === NEWLINE) {
        hasNewline = true;
        break;
      }
    }

    index = runEnd;

    if (!hasNewline || !text.startsWith("at", runEnd)) {
      continue;
    }

    const afterAt: number = runEnd + 2;
    const frameStart: number = whiteSpaceEnd(text, afterAt);

    if (frameStart === afterAt) {
      continue;
    }

    // ":<digit>" right where the white space ends, after one more character of it.
    if (
      isColonThenDigitAt(text, frameStart) &&
      frameStart - 1 > afterAt &&
      !isLineTerminatorCode(text.charCodeAt(frameStart - 1))
    ) {
      return true;
    }

    // ":<digit>" later on the same line.
    const location: number = locations.atOrAfter(frameStart + 1);

    if (location !== -1) {
      const terminator: number = terminators.atOrAfter(frameStart);

      if (terminator === -1 || location < terminator) {
        return true;
      }
    }
  }

  return false;
};

/*
 * \n\s*File\s+"[^"]+",\s+line\s+\d+ - a line break, white space (perhaps
 * none), then a Python frame's 'File "<path>", line <digits>'. Every line
 * break of one run of white space reaches the same "File", so each run that
 * holds one is asked about once, and the closing quote is looked for once.
 */
const hasPythonFileFrame: TextTestFunction = (text: string): boolean => {
  const quotes: ForwardFinder = new ForwardFinder(text, isDoubleQuoteAt);

  let index: number = 0;

  while (index < text.length) {
    if (!isWhiteSpaceCode(text.charCodeAt(index))) {
      index++;
      continue;
    }

    const runEnd: number = whiteSpaceEnd(text, index);
    let hasNewline: boolean = false;

    for (let at: number = index; at < runEnd; at++) {
      if (text.charCodeAt(at) === NEWLINE) {
        hasNewline = true;
        break;
      }
    }

    index = runEnd;

    if (!hasNewline || !text.startsWith("File", runEnd)) {
      continue;
    }

    const quote: number = whiteSpaceEnd(text, runEnd + 4);

    if (quote === runEnd + 4 || text.charCodeAt(quote) !== DOUBLE_QUOTE) {
      continue;
    }

    const closingQuote: number = quotes.atOrAfter(quote + 1);

    if (
      closingQuote === -1 ||
      closingQuote === quote + 1 ||
      text.charCodeAt(closingQuote + 1) !== 0x2c
    ) {
      continue;
    }

    const line: number = whiteSpaceEnd(text, closingQuote + 2);

    if (line === closingQuote + 2 || !text.startsWith("line", line)) {
      continue;
    }

    const digits: number = whiteSpaceEnd(text, line + 4);

    if (digits > line + 4 && isDigitCode(text.charCodeAt(digits))) {
      return true;
    }
  }

  return false;
};

/*
 * \b[A-Za-z_][\w.$]*(?:Exception|Error)\b - a name ending in "Exception" or
 * "Error" (with a word boundary after it), whose first character starts a
 * word: a letter or "_" at the start of a run of [\w.$] characters, or
 * right after a "." or "$" in one. Read left to right once, remembering
 * whether the run so far holds such a first character.
 */
const hasTypedErrorName: TextTestFunction = (text: string): boolean => {
  const isNameCode: (code: number) => boolean = (code: number): boolean => {
    return isWordCode(code) || code === DOT || code === DOLLAR;
  };

  const endsWord: (end: number) => boolean = (end: number): boolean => {
    return end >= text.length || !isWordCode(text.charCodeAt(end));
  };

  // Whether the run of name characters before the current index holds a start.
  let runHasStart: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (!isNameCode(code)) {
      runHasStart = false;
      continue;
    }

    if (
      runHasStart &&
      ((text.startsWith("Exception", index) && endsWord(index + 9)) ||
        (text.startsWith("Error", index) && endsWord(index + 5)))
    ) {
      return true;
    }

    const previous: number = index > 0 ? text.charCodeAt(index - 1) : -1;

    if (
      (isAsciiLetterCode(code) || code === UNDERSCORE) &&
      (previous === -1 || !isWordCode(previous))
    ) {
      runHasStart = true;
    }
  }

  return false;
};

const PYTHON_TRACEBACK: string = "Traceback (most recent call last)";
const GO_PANIC_WORD: RegExp = /\bpanic:\s/;
const GO_GOROUTINE_HEADER: RegExp = /goroutine\s+\d+\s+\[/;

/*
 * A Firefox/Safari `fn@url:line:col` frame at the start of a line. It
 * mirrors the shape StackTraceParser's browser parser accepts and must stay
 * in step with it. The name class admits spaces (Safari's `global code@…`,
 * Firefox's `promise callback*fn@…`) but never a colon, which keeps ordinary
 * `key: value` log prose out, and it absorbs a line's leading indentation -
 * so do NOT prepend a `[ \t]*`: space and tab are already in the class, and
 * two overlapping quantifiers side by side backtrack. Every repeat is
 * bounded and none reaches past the line it starts on.
 */
const BROWSER_FRAME_LINE: RegExp =
  /(?:^|\n)[^@:\n]{0,256}@[A-Za-z][A-Za-z0-9+.-]{0,31}:[^\s]{1,2048}:\d{1,9}/;

/*
 * Whether a body plausibly holds a stack trace: a Python traceback header,
 * an indented JS/Java `at file:line` frame, a Go panic or goroutine header,
 * a Python `File "...", line N` frame, a Firefox/Safari `fn@url:line:col`
 * frame, or a typed `SomethingException` / `SomethingError`. Answers
 * exactly as the one pattern it replaced,
 *   (?:Traceback \(most recent call last\)|\n\s+at\s+.+:\d+|\bpanic:\s|
 *   goroutine\s+\d+\s+\[|\n\s*File\s+"[^"]+",\s+line\s+\d+|
 *   (?:^|\n)[^@:\n]{0,256}@[A-Za-z][A-Za-z0-9+.-]{0,31}:[^\s]{1,2048}:\d{1,9}|
 *   \b[A-Za-z_][\w.$]*(?:Exception|Error)\b)
 * did, one alternative at a time.
 */
export const looksLikeStackTrace: TextTestFunction = (
  text: string,
): boolean => {
  return (
    text.includes(PYTHON_TRACEBACK) ||
    GO_PANIC_WORD.test(text) ||
    GO_GOROUTINE_HEADER.test(text) ||
    BROWSER_FRAME_LINE.test(text) ||
    hasIndentedAtFrame(text) ||
    hasPythonFileFrame(text) ||
    hasTypedErrorName(text)
  );
};

/*
 * ---------------------------------------------------------------------------
 * The first line's type and message.
 * ---------------------------------------------------------------------------
 */

type ReadLineFunction = (line: string) => string | null;

/*
 * ^Exception in thread\s+"[^"]*"\s+(.*)$ - what follows Java's
 * 'Exception in thread "name"' and the white space after it, or null. The
 * rest of the line may hold no line terminator; the white space before it
 * may.
 */
export const readAfterJavaThreadPrefix: ReadLineFunction = (
  line: string,
): string | null => {
  const prefix: string = "Exception in thread";

  if (!line.startsWith(prefix)) {
    return null;
  }

  const quote: number = whiteSpaceEnd(line, prefix.length);

  if (quote === prefix.length || line.charCodeAt(quote) !== DOUBLE_QUOTE) {
    return null;
  }

  const closingQuote: number = line.indexOf('"', quote + 1);

  if (closingQuote === -1) {
    return null;
  }

  const restStart: number = whiteSpaceEnd(line, closingQuote + 1);

  if (
    restStart === closingQuote + 1 ||
    !hasNoLineTerminatorFrom(line, restStart)
  ) {
    return null;
  }

  return line.slice(restStart);
};

/*
 * ^panic:\s*(.*)$ - what follows Go's "panic:" and the white space after
 * it, or null. The rest may hold no line terminator.
 */
export const readAfterGoPanic: ReadLineFunction = (
  line: string,
): string | null => {
  if (!line.startsWith("panic:")) {
    return null;
  }

  const restStart: number = whiteSpaceEnd(line, 6);

  return hasNoLineTerminatorFrom(line, restStart)
    ? line.slice(restStart)
    : null;
};

type ReadQualifiedTypeFunction = (
  line: string,
) => { type: string; message: string } | null;

/*
 * ^([A-Za-z_][\w.$]*\.[A-Za-z_][\w.$]*):\s*(.*)$ - a dotted type name
 * ("pkg.Sub.Type") right before the line's first ":", and the message
 * after the white space that follows it, or null. The name is the whole
 * run of [\w.$] characters the line starts with, which must hold a "." with
 * a letter or "_" after it; the message may hold no line terminator.
 */
export const readQualifiedTypeLine: ReadQualifiedTypeFunction = (
  line: string,
): { type: string; message: string } | null => {
  const isIdentifierStart: (code: number) => boolean = (
    code: number,
  ): boolean => {
    return isAsciiLetterCode(code) || code === UNDERSCORE;
  };

  if (line.length === 0 || !isIdentifierStart(line.charCodeAt(0))) {
    return null;
  }

  let typeEnd: number = 1;
  let hasDottedPart: boolean = false;

  while (typeEnd < line.length) {
    const code: number = line.charCodeAt(typeEnd);

    if (!isWordCode(code) && code !== DOT && code !== DOLLAR) {
      break;
    }

    if (code === DOT && isIdentifierStart(line.charCodeAt(typeEnd + 1))) {
      hasDottedPart = true;
    }

    typeEnd++;
  }

  if (!hasDottedPart || line.charCodeAt(typeEnd) !== COLON) {
    return null;
  }

  const messageStart: number = whiteSpaceEnd(line, typeEnd + 1);

  if (!hasNoLineTerminatorFrom(line, messageStart)) {
    return null;
  }

  return {
    type: line.slice(0, typeEnd),
    message: line.slice(messageStart),
  };
};
