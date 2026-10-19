import {
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * ONE LINE OF A STACK TRACE, READ AS ITS LANGUAGE WRITES A FRAME.
 *
 * A stack trace reaches the parser from whatever an application sent at
 * ingest - a span's exception.stacktrace, a log's exception attributes, an
 * ERROR log's body - so a line can be of any length and any shape. Each
 * reader here stands for one pattern the parser matched a line against
 * (named above it), and gives back exactly what that pattern's exec gave
 * back: the text matched, then each group (undefined for a group that took
 * no part), or null where the pattern did not match.
 *
 * Those patterns matched a lazy group ("the fewest characters up to ...")
 * after a run of white space that the group could also take, and tried
 * every way to split a line between them: on a long line built for it the
 * time grew with the square, the cube or the fourth power of its length
 * (one line of 4,000 characters took close to a minute). Each reader here
 * reads its line a fixed number of times:
 *
 *  - what ends a frame is found from the end of the line, where a pattern
 *    anchored there could match in one place only (":12:34)" is the last
 *    run of digits before the ")", and the run before it);
 *  - the lazy group is the shortest one that works, so the places it can
 *    end are tried in order, each once;
 *  - a pattern that gave its run of white space back to the lazy group did
 *    so only when nothing else worked - and then the group is one character
 *    of that run, which is worked out once (see readAtNameParen).
 *
 * In the patterns, "." is any character but a line terminator (\n, \r,
 * U+2028, U+2029) and \s is white space, line terminators included - so a
 * group may not hold a line terminator, while a run of white space may.
 * ---------------------------------------------------------------------------
 */

// What a reader gives back: what the pattern's exec gave back.
export type FrameLineMatch = Array<string | undefined>;

const OPEN_PAREN: number = 0x28;
const CLOSE_PAREN: number = 0x29;
const COLON: number = 0x3a;
const DOUBLE_QUOTE: number = 0x22;
const SINGLE_QUOTE: number = 0x27;
const BACKTICK: number = 0x60;
const COMMA: number = 0x2c;
const HASH: number = 0x23;

type FromFunction = (line: string, from: number) => number;

// The first index at or after `from` that is not white space.
const whiteSpaceEnd: FromFunction = (line: string, from: number): number => {
  let index: number = from;

  while (index < line.length && isWhiteSpaceCode(line.charCodeAt(index))) {
    index++;
  }

  return index;
};

// The first index at or after `from` that is not a digit.
const digitsEnd: FromFunction = (line: string, from: number): number => {
  let index: number = from;

  while (index < line.length && isDigitCode(line.charCodeAt(index))) {
    index++;
  }

  return index;
};

// Where the run of digits that ends just before `end` starts (`end` if none).
const digitsStartBefore: FromFunction = (line: string, end: number): number => {
  let index: number = end;

  while (index > 0 && isDigitCode(line.charCodeAt(index - 1))) {
    index--;
  }

  return index;
};

// Where the run of white space that ends just before `end` starts.
const whiteSpaceStartBefore: FromFunction = (
  line: string,
  end: number,
): number => {
  let index: number = end;

  while (index > 0 && isWhiteSpaceCode(line.charCodeAt(index - 1))) {
    index--;
  }

  return index;
};

// The first line terminator at or after `from`, or the line's length.
const firstLineTerminator: FromFunction = (
  line: string,
  from: number,
): number => {
  for (let index: number = from; index < line.length; index++) {
    if (isLineTerminatorCode(line.charCodeAt(index))) {
      return index;
    }
  }

  return line.length;
};

// The last line terminator before `end`, or -1.
const lastLineTerminatorBefore: FromFunction = (
  line: string,
  end: number,
): number => {
  for (let index: number = end - 1; index >= 0; index--) {
    if (isLineTerminatorCode(line.charCodeAt(index))) {
      return index;
    }
  }

  return -1;
};

type IsCodeAtFunction = (line: string, index: number, code: number) => boolean;

const isCodeAt: IsCodeAtFunction = (
  line: string,
  index: number,
  code: number,
): boolean => {
  return index < line.length && line.charCodeAt(index) === code;
};

/*
 * When a run of white space was given back to a lazy group that follows it
 * (^...\s+(.+?)\s+...), the group took one character of the run: the last
 * one it can start at, at least one character after where the run starts
 * and at least two before where it ends, that is not a line terminator.
 * -1 when there is none.
 */
type GivenBackCharacterFunction = (
  line: string,
  runStart: number,
  runEnd: number,
) => number;

const givenBackCharacter: GivenBackCharacterFunction = (
  line: string,
  runStart: number,
  runEnd: number,
): number => {
  for (let index: number = runEnd - 2; index >= runStart + 1; index--) {
    if (!isLineTerminatorCode(line.charCodeAt(index))) {
      return index;
    }
  }

  return -1;
};

/*
 * ---------------------------------------------------------------------------
 * V8 (Node, Chrome, Edge): "at name (file:line:column)"
 * ---------------------------------------------------------------------------
 */

interface NameAndParen {
  nameStart: number;
  nameEnd: number;
  paren: number;
}

/*
 * The head of ^at\s+(.+?)\s+\((.+?)... - "at", white space, a name, white
 * space, "(" and a file - where what follows the file can match in one
 * place only, so the file runs from just after the "(" to `fileEnd`.
 *
 * The name is the shortest that works: it ends where a run of white space
 * that is followed by "(" starts, and the first such run whose name holds
 * no line terminator and whose file is not empty and holds none wins. When
 * none does, the pattern gave the white space after "at" back to the name,
 * which helps only when that white space is itself followed by "(": the
 * name is then one character of it (givenBackCharacter).
 */
type ReadAtNameParenFunction = (
  line: string,
  nameRunStart: number,
  fileEnd: number,
) => NameAndParen | null;

const readAtNameParen: ReadAtNameParenFunction = (
  line: string,
  nameRunStart: number,
  fileEnd: number,
): NameAndParen | null => {
  const nameStart: number = whiteSpaceEnd(line, nameRunStart);

  if (nameStart === nameRunStart) {
    return null;
  }

  const firstTerminator: number = firstLineTerminator(line, nameStart);
  const lastTerminatorBeforeFileEnd: number = lastLineTerminatorBefore(
    line,
    fileEnd,
  );

  let runStart: number = -1;

  for (let index: number = nameStart + 1; index < fileEnd - 1; index++) {
    const code: number = line.charCodeAt(index);

    if (isWhiteSpaceCode(code)) {
      if (runStart === -1) {
        runStart = index;
      }

      continue;
    }

    if (code === OPEN_PAREN && runStart !== -1) {
      // The name [nameStart, runStart) may hold no line terminator.
      if (runStart > firstTerminator) {
        break;
      }

      // The file (index, fileEnd) may hold none either.
      if (index + 1 > lastTerminatorBeforeFileEnd) {
        return { nameStart: nameStart, nameEnd: runStart, paren: index };
      }
    }

    runStart = -1;
  }

  if (
    isCodeAt(line, nameStart, OPEN_PAREN) &&
    nameStart + 1 < fileEnd &&
    nameStart + 1 > lastTerminatorBeforeFileEnd
  ) {
    const name: number = givenBackCharacter(line, nameRunStart, nameStart);

    if (name !== -1) {
      return { nameStart: name, nameEnd: name + 1, paren: nameStart };
    }
  }

  return null;
};

/*
 * Where a line's ":<digits>)" ends it - the run of digits right before the
 * last ")" and the ":" right before that run - or -1.
 */
type ColonDigitsBeforeFunction = (line: string, end: number) => number;

// The start of the digits of ":<digits>" ending at `end`, or -1.
const colonDigitsStartBefore: ColonDigitsBeforeFunction = (
  line: string,
  end: number,
): number => {
  const digitsStart: number = digitsStartBefore(line, end);

  if (digitsStart === end || digitsStart === 0) {
    return -1;
  }

  return line.charCodeAt(digitsStart - 1) === COLON ? digitsStart : -1;
};

// ^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$
export const readV8FrameWithParens: (line: string) => FrameLineMatch | null =
  (line: string): FrameLineMatch | null => {
    if (!line.startsWith("at") || !isCodeAt(line, line.length - 1, CLOSE_PAREN)) {
      return null;
    }

    const columnStart: number = colonDigitsStartBefore(line, line.length - 1);

    if (columnStart === -1) {
      return null;
    }

    const lineNumberStart: number = colonDigitsStartBefore(
      line,
      columnStart - 1,
    );

    if (lineNumberStart === -1) {
      return null;
    }

    const fileEnd: number = lineNumberStart - 1;
    const head: NameAndParen | null = readAtNameParen(line, 2, fileEnd);

    if (!head) {
      return null;
    }

    return [
      line,
      line.slice(head.nameStart, head.nameEnd),
      line.slice(head.paren + 1, fileEnd),
      line.slice(lineNumberStart, columnStart - 1),
      line.slice(columnStart, line.length - 1),
    ];
  };

// ^at\s+(.+?)\s+\((.+?):(\d+)\)$
export const readV8FrameWithParensNoColumn: (
  line: string,
) => FrameLineMatch | null = (line: string): FrameLineMatch | null => {
  if (!line.startsWith("at") || !isCodeAt(line, line.length - 1, CLOSE_PAREN)) {
    return null;
  }

  const lineNumberStart: number = colonDigitsStartBefore(
    line,
    line.length - 1,
  );

  if (lineNumberStart === -1) {
    return null;
  }

  const fileEnd: number = lineNumberStart - 1;
  const head: NameAndParen | null = readAtNameParen(line, 2, fileEnd);

  if (!head) {
    return null;
  }

  return [
    line,
    line.slice(head.nameStart, head.nameEnd),
    line.slice(head.paren + 1, fileEnd),
    line.slice(lineNumberStart, line.length - 1),
  ];
};

/*
 * ^at\s+(.+?):(\d+):(\d+)$ - the file runs from the end of the white space
 * after "at" to the ":" of ":<line>:<column>" at the end of the line. When
 * the white space reaches that ":" itself, the pattern gave its last
 * character back to the file.
 */
export const readV8FrameWithoutParens: (
  line: string,
) => FrameLineMatch | null = (line: string): FrameLineMatch | null => {
  if (!line.startsWith("at")) {
    return null;
  }

  const columnStart: number = colonDigitsStartBefore(line, line.length);

  if (columnStart === -1) {
    return null;
  }

  const lineNumberStart: number = colonDigitsStartBefore(
    line,
    columnStart - 1,
  );

  if (lineNumberStart === -1) {
    return null;
  }

  const fileEnd: number = lineNumberStart - 1;
  const fileStart: number = whiteSpaceEnd(line, 2);

  if (fileStart === 2) {
    return null;
  }

  let file: string;

  if (fileStart < fileEnd) {
    if (lastLineTerminatorBefore(line, fileEnd) >= fileStart) {
      return null;
    }

    file = line.slice(fileStart, fileEnd);
  } else {
    const given: number = fileStart - 1;

    if (
      fileStart !== fileEnd ||
      given < 3 ||
      isLineTerminatorCode(line.charCodeAt(given))
    ) {
      return null;
    }

    file = line.charAt(given);
  }

  return [
    line,
    file,
    line.slice(lineNumberStart, columnStart - 1),
    line.slice(columnStart),
  ];
};

/*
 * A ":<line>:<column>)" starting at a ":" - the first one after the file
 * of an eval frame - and where it ends (after the ")"), or null.
 */
interface EvalLocation {
  start: number;
  lineNumberEnd: number;
  columnEnd: number;
  end: number;
}

type EvalLocationAtFunction = (
  line: string,
  colon: number,
) => EvalLocation | null;

const evalLocationAt: EvalLocationAtFunction = (
  line: string,
  colon: number,
): EvalLocation | null => {
  if (!isCodeAt(line, colon, COLON)) {
    return null;
  }

  const lineNumberEnd: number = digitsEnd(line, colon + 1);

  if (lineNumberEnd === colon + 1 || !isCodeAt(line, lineNumberEnd, COLON)) {
    return null;
  }

  const columnEnd: number = digitsEnd(line, lineNumberEnd + 1);

  if (
    columnEnd === lineNumberEnd + 1 ||
    !isCodeAt(line, columnEnd, CLOSE_PAREN)
  ) {
    return null;
  }

  return {
    start: colon,
    lineNumberEnd: lineNumberEnd,
    columnEnd: columnEnd,
    end: columnEnd + 1,
  };
};

/*
 * The first ":<line>:<column>)" at or after a point, for points that only
 * ever move forward: what was found is kept, and the search goes on from
 * where it stopped, so the line is read once however often it is asked.
 */
class EvalLocationFinder {
  private readonly line: string;
  private searchedUpTo: number = 0;
  private found: EvalLocation | null = null;

  public constructor(line: string) {
    this.line = line;
  }

  public atOrAfter(from: number): EvalLocation | null {
    if (this.found && this.found.start >= from) {
      return this.found;
    }

    this.found = null;

    for (
      let index: number = Math.max(from, this.searchedUpTo);
      index < this.line.length;
      index++
    ) {
      this.searchedUpTo = index + 1;

      const location: EvalLocation | null = evalLocationAt(this.line, index);

      if (location) {
        this.found = location;
        return location;
      }
    }

    return null;
  }
}

/*
 * The first line terminator at or after a point, for points that only ever
 * move forward.
 */
class LineTerminatorFinder {
  private readonly line: string;
  private found: number = -1;

  public constructor(line: string) {
    this.line = line;
  }

  public atOrAfter(from: number): number {
    if (this.found >= from) {
      return this.found;
    }

    this.found = firstLineTerminator(this.line, Math.max(from, this.found + 1));

    return this.found;
  }
}

const EVAL_FRAME_START: ReadonlyArray<string> = ["at", "eval", "(eval", "at"];

/*
 * ^at\s+eval\s+\(eval\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\) - not anchored at
 * the end, so the file is the shortest that is followed by
 * ":<line>:<column>)"; each candidate "(" asks for the first such location
 * after it.
 */
export const readV8EvalFrame: (line: string) => FrameLineMatch | null = (
  line: string,
): FrameLineMatch | null => {
  // "at", then white space and "eval", "(eval" and "at", each after a run.
  let index: number = 0;

  for (let word: number = 0; word < EVAL_FRAME_START.length; word++) {
    const text: string = EVAL_FRAME_START[word]!;

    if (word > 0) {
      const runEnd: number = whiteSpaceEnd(line, index);

      if (runEnd === index) {
        return null;
      }

      index = runEnd;
    }

    if (!line.startsWith(text, index)) {
      return null;
    }

    index += text.length;
  }

  const nameRunStart: number = index;
  const nameStart: number = whiteSpaceEnd(line, nameRunStart);

  if (nameStart === nameRunStart) {
    return null;
  }

  const firstTerminator: number = firstLineTerminator(line, nameStart);

  type FileFunction = (paren: number) => EvalLocation | null;

  /*
   * The location the file after the "(" at `paren` runs to, or null - for
   * parens asked about in order, left to right (the finders only move
   * forward).
   */
  const fileAfterInOrder: () => FileFunction = (): FileFunction => {
    const locations: EvalLocationFinder = new EvalLocationFinder(line);
    const terminators: LineTerminatorFinder = new LineTerminatorFinder(line);

    return (paren: number): EvalLocation | null => {
      const location: EvalLocation | null = locations.atOrAfter(paren + 2);

      if (!location || terminators.atOrAfter(paren + 1) < location.start) {
        return null;
      }

      return location;
    };
  };

  const fileAfter: FileFunction = fileAfterInOrder();

  type MatchFunction = (
    name: [number, number],
    paren: number,
    location: EvalLocation,
  ) => FrameLineMatch;

  const toMatch: MatchFunction = (
    name: [number, number],
    paren: number,
    location: EvalLocation,
  ): FrameLineMatch => {
    return [
      line.slice(0, location.end),
      line.slice(name[0], name[1]),
      line.slice(paren + 1, location.start),
      line.slice(location.start + 1, location.lineNumberEnd),
      line.slice(location.lineNumberEnd + 1, location.columnEnd),
    ];
  };

  let runStart: number = -1;

  for (let paren: number = nameStart + 1; paren < line.length; paren++) {
    const code: number = line.charCodeAt(paren);

    if (isWhiteSpaceCode(code)) {
      if (runStart === -1) {
        runStart = paren;
      }

      continue;
    }

    if (code === OPEN_PAREN && runStart !== -1) {
      if (runStart > firstTerminator) {
        break;
      }

      const location: EvalLocation | null = fileAfter(paren);

      if (location) {
        return toMatch([nameStart, runStart], paren, location);
      }
    }

    runStart = -1;
  }

  // The white space after "at" given back: the "(" right after it, asked anew.
  if (isCodeAt(line, nameStart, OPEN_PAREN)) {
    const location: EvalLocation | null = fileAfterInOrder()(nameStart);
    const name: number = givenBackCharacter(line, nameRunStart, nameStart);

    if (location && name !== -1) {
      return toMatch([name, name + 1], nameStart, location);
    }
  }

  return null;
};

/*
 * ---------------------------------------------------------------------------
 * C# / .NET: "at Namespace.Class.Method(params) in /path/file.cs:line 42"
 * ---------------------------------------------------------------------------
 */

/*
 * ^at\s+(.+?)\s+in\s+(.+?):line\s+(\d+)$ - the line number is the run of
 * digits ending the line, ":line" and white space come right before it,
 * and the file runs from after the white space that follows "in" to that
 * ":line". The name is the shortest that is followed by white space, "in",
 * white space and a file that holds no line terminator.
 */
export const readCSharpFrameWithFile: (line: string) => FrameLineMatch | null =
  (line: string): FrameLineMatch | null => {
    if (!line.startsWith("at")) {
      return null;
    }

    const lineNumberStart: number = digitsStartBefore(line, line.length);

    if (lineNumberStart === line.length) {
      return null;
    }

    const lineLabelEnd: number = whiteSpaceStartBefore(line, lineNumberStart);

    if (
      lineLabelEnd === lineNumberStart ||
      lineLabelEnd < 5 ||
      !line.startsWith(":line", lineLabelEnd - 5)
    ) {
      return null;
    }

    const fileEnd: number = lineLabelEnd - 5;
    const lastTerminatorBeforeFileEnd: number = lastLineTerminatorBefore(
      line,
      fileEnd,
    );

    type FileFunction = (inStart: number) => [number, number] | null;

    // The file after the "in" at `inStart`, or null.
    const fileAfter: FileFunction = (
      inStart: number,
    ): [number, number] | null => {
      const runStart: number = inStart + 2;
      const fileStart: number = whiteSpaceEnd(line, runStart);

      if (fileStart === runStart || fileStart > fileEnd) {
        return null;
      }

      if (fileStart < fileEnd) {
        return lastTerminatorBeforeFileEnd >= fileStart
          ? null
          : [fileStart, fileEnd];
      }

      // The white space ran up to ":line": its last character is the file.
      const given: number = fileStart - 1;

      return given > runStart && !isLineTerminatorCode(line.charCodeAt(given))
        ? [given, fileEnd]
        : null;
    };

    const nameRunStart: number = 2;
    const nameStart: number = whiteSpaceEnd(line, nameRunStart);

    if (nameStart === nameRunStart) {
      return null;
    }

    const firstTerminator: number = firstLineTerminator(line, nameStart);

    type MatchFunction = (
      name: [number, number],
      file: [number, number],
    ) => FrameLineMatch;

    const toMatch: MatchFunction = (
      name: [number, number],
      file: [number, number],
    ): FrameLineMatch => {
      return [
        line,
        line.slice(name[0], name[1]),
        line.slice(file[0], file[1]),
        line.slice(lineNumberStart),
      ];
    };

    let runStart: number = -1;

    for (let index: number = nameStart + 1; index < line.length; index++) {
      if (isWhiteSpaceCode(line.charCodeAt(index))) {
        if (runStart === -1) {
          runStart = index;
        }

        continue;
      }

      if (runStart !== -1) {
        if (runStart > firstTerminator) {
          break;
        }

        if (line.startsWith("in", index)) {
          const file: [number, number] | null = fileAfter(index);

          if (file) {
            return toMatch([nameStart, runStart], file);
          }
        }
      }

      runStart = -1;
    }

    if (line.startsWith("in", nameStart)) {
      const file: [number, number] | null = fileAfter(nameStart);
      const name: number = givenBackCharacter(line, nameRunStart, nameStart);

      if (file && name !== -1) {
        return toMatch([name, name + 1], file);
      }
    }

    return null;
  };

/*
 * ---------------------------------------------------------------------------
 * PHP: "#0 /path/to/file.php(42): Class->method()"
 * ---------------------------------------------------------------------------
 */

/*
 * ^#\d+\s+(.+?)\((\d+)\):\s+(.+)$ - the file is the shortest followed by
 * "(<digits>):", white space and the rest of the line, which may hold no
 * line terminator. The white space after "#<digits>" is given back to the
 * file only when it is followed by such a "(", and then by one character.
 */
export const readPhpFrame: (line: string) => FrameLineMatch | null = (
  line: string,
): FrameLineMatch | null => {
  if (!isCodeAt(line, 0, HASH)) {
    return null;
  }

  const numberEnd: number = digitsEnd(line, 1);

  if (numberEnd === 1) {
    return null;
  }

  const fileStart: number = whiteSpaceEnd(line, numberEnd);

  if (fileStart === numberEnd) {
    return null;
  }

  const lastTerminator: number = lastLineTerminatorBefore(line, line.length);

  type RestFunction = (paren: number) => [number, number, number] | null;

  // The line number's end and where the rest starts and ends, or null.
  const restAfter: RestFunction = (
    paren: number,
  ): [number, number, number] | null => {
    const lineNumberEnd: number = digitsEnd(line, paren + 1);

    if (
      lineNumberEnd === paren + 1 ||
      !isCodeAt(line, lineNumberEnd, CLOSE_PAREN) ||
      !isCodeAt(line, lineNumberEnd + 1, COLON)
    ) {
      return null;
    }

    const runStart: number = lineNumberEnd + 2;
    const restStart: number = whiteSpaceEnd(line, runStart);

    if (restStart === runStart) {
      return null;
    }

    if (restStart < line.length) {
      return lastTerminator >= restStart
        ? null
        : [lineNumberEnd, restStart, line.length];
    }

    // The white space ran to the end of the line: its last character is the rest.
    const given: number = line.length - 1;

    return given > runStart && !isLineTerminatorCode(line.charCodeAt(given))
      ? [lineNumberEnd, given, line.length]
      : null;
  };

  type MatchFunction = (
    file: [number, number],
    rest: [number, number, number],
  ) => FrameLineMatch;

  const toMatch: MatchFunction = (
    file: [number, number],
    rest: [number, number, number],
  ): FrameLineMatch => {
    return [
      line,
      line.slice(file[0], file[1]),
      line.slice(file[1] + 1, rest[0]),
      line.slice(rest[1], rest[2]),
    ];
  };

  const firstTerminator: number = firstLineTerminator(line, fileStart);

  for (
    let paren: number = fileStart + 1;
    paren < line.length && paren <= firstTerminator;
    paren++
  ) {
    if (line.charCodeAt(paren) === OPEN_PAREN) {
      const rest: [number, number, number] | null = restAfter(paren);

      if (rest) {
        return toMatch([fileStart, paren], rest);
      }
    }
  }

  // The white space after "#<digits>" given back: its last character.
  if (isCodeAt(line, fileStart, OPEN_PAREN)) {
    const given: number = fileStart - 1;
    const rest: [number, number, number] | null = restAfter(fileStart);

    if (
      rest &&
      given > numberEnd &&
      !isLineTerminatorCode(line.charCodeAt(given))
    ) {
      return toMatch([given, fileStart], rest);
    }
  }

  return null;
};

/*
 * ---------------------------------------------------------------------------
 * Python: 'File "path", line N, in function'
 * ---------------------------------------------------------------------------
 */

/*
 * ^File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$ - the file is the
 * shortest followed by '", line <digits>' and either the end of the line
 * or ", in " and the rest of it (which may hold no line terminator).
 */
export const readPythonFrame: (line: string) => FrameLineMatch | null = (
  line: string,
): FrameLineMatch | null => {
  if (!line.startsWith("File")) {
    return null;
  }

  const quote: number = whiteSpaceEnd(line, 4);

  if (quote === 4 || !isCodeAt(line, quote, DOUBLE_QUOTE)) {
    return null;
  }

  const fileStart: number = quote + 1;
  const lastTerminator: number = lastLineTerminatorBefore(line, line.length);

  type AfterRunFunction = (from: number, word: string) => number;

  // White space from `from` (at least one), then `word`: where it ends, or -1.
  const afterRunAndWord: AfterRunFunction = (
    from: number,
    word: string,
  ): number => {
    const runEnd: number = whiteSpaceEnd(line, from);

    return runEnd > from && line.startsWith(word, runEnd)
      ? runEnd + word.length
      : -1;
  };

  type RestFunction = (fileEnd: number) => FrameLineMatch | null;

  const restAfter: RestFunction = (fileEnd: number): FrameLineMatch | null => {
    const lineWordEnd: number = afterRunAndWord(fileEnd + 2, "line");

    if (lineWordEnd === -1) {
      return null;
    }

    const lineNumberStart: number = whiteSpaceEnd(line, lineWordEnd);
    const lineNumberEnd: number = digitsEnd(line, lineNumberStart);

    if (lineNumberStart === lineWordEnd || lineNumberEnd === lineNumberStart) {
      return null;
    }

    const file: string = line.slice(fileStart, fileEnd);
    const lineNumber: string = line.slice(lineNumberStart, lineNumberEnd);

    if (isCodeAt(line, lineNumberEnd, COMMA)) {
      const inWordEnd: number = afterRunAndWord(lineNumberEnd + 1, "in");

      if (inWordEnd !== -1) {
        const functionStart: number = whiteSpaceEnd(line, inWordEnd);

        if (functionStart > inWordEnd) {
          if (functionStart < line.length) {
            if (lastTerminator < functionStart) {
              return [line, file, lineNumber, line.slice(functionStart)];
            }
          } else {
            const given: number = line.length - 1;

            if (
              given > inWordEnd &&
              !isLineTerminatorCode(line.charCodeAt(given))
            ) {
              return [line, file, lineNumber, line.slice(given)];
            }
          }
        }
      }

      return null;
    }

    return lineNumberEnd === line.length
      ? [line, file, lineNumber, undefined]
      : null;
  };

  const firstTerminator: number = firstLineTerminator(line, fileStart);

  for (
    let fileEnd: number = fileStart + 1;
    fileEnd < line.length && fileEnd <= firstTerminator;
    fileEnd++
  ) {
    if (
      line.charCodeAt(fileEnd) === DOUBLE_QUOTE &&
      isCodeAt(line, fileEnd + 1, COMMA)
    ) {
      const match: FrameLineMatch | null = restAfter(fileEnd);

      if (match) {
        return match;
      }
    }
  }

  return null;
};

/*
 * ---------------------------------------------------------------------------
 * Ruby: "path:line:in `method'" (or 'method')
 * ---------------------------------------------------------------------------
 */

/*
 * ^(.+?):(\d+):in\s+[`'](.+?)'$ - the method runs from after its opening
 * quote to the "'" that ends the line; the file is the shortest followed
 * by ":<digits>:in", white space and an opening quote with such a method
 * after it.
 */
export const readRubyFrame: (line: string) => FrameLineMatch | null = (
  line: string,
): FrameLineMatch | null => {
  const methodEnd: number = line.length - 1;

  if (!isCodeAt(line, methodEnd, SINGLE_QUOTE)) {
    return null;
  }

  const lastTerminatorBeforeMethodEnd: number = lastLineTerminatorBefore(
    line,
    methodEnd,
  );
  const firstTerminator: number = firstLineTerminator(line, 0);

  for (
    let fileEnd: number = 1;
    fileEnd < line.length && fileEnd <= firstTerminator;
    fileEnd++
  ) {
    if (line.charCodeAt(fileEnd) !== COLON) {
      continue;
    }

    const lineNumberEnd: number = digitsEnd(line, fileEnd + 1);

    if (lineNumberEnd === fileEnd + 1 || !line.startsWith(":in", lineNumberEnd)) {
      continue;
    }

    const runStart: number = lineNumberEnd + 3;
    const openingQuote: number = whiteSpaceEnd(line, runStart);

    if (openingQuote === runStart) {
      continue;
    }

    const quoteCode: number = line.charCodeAt(openingQuote);
    const methodStart: number = openingQuote + 1;

    if (
      (quoteCode === BACKTICK || quoteCode === SINGLE_QUOTE) &&
      methodStart < methodEnd &&
      lastTerminatorBeforeMethodEnd < methodStart
    ) {
      return [
        line,
        line.slice(0, fileEnd),
        line.slice(fileEnd + 1, lineNumberEnd),
        line.slice(methodStart, methodEnd),
      ];
    }
  }

  return null;
};
