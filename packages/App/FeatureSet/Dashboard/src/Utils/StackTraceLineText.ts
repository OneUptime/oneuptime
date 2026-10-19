import {
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "Common/Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * A RAW STACK TRACE, READ FOR THE FRAME VIEWER IN TIME IN LINE WITH ITS
 * LENGTH.
 *
 * The frame viewer shows a stack trace as the application sent it, and an
 * application can send one of any length and any shape. Each reader here
 * stands for the pattern named above it and answers exactly as that pattern
 * did (the match it gave, group by group, or whether it matched).
 *
 * Those patterns read one run again from each of its characters - a run of
 * blank lines before a Python traceback's header, the white space before a
 * frame's "(", the path before a frame's ":<line>", the text after each
 * "/pkg/mod/" - so a trace built for it took seconds, then minutes, in the
 * viewer's tab. Each reader here reads its text a fixed number of times.
 *
 * In the patterns, "." is any character but a line terminator (\n, \r,
 * U+2028, U+2029) and \s is white space, line terminators included.
 * ---------------------------------------------------------------------------
 */

// What a reader gives back: what the pattern's exec gave back.
export type StackTraceLineMatch = Array<string>;

const OPEN_PAREN: number = 0x28;
const CLOSE_PAREN: number = 0x29;
const COLON: number = 0x3a;
const SLASH: number = 0x2f;
const BACKSLASH: number = 0x5c;
const DOT: number = 0x2e;

type IsCodeFunction = (code: number) => boolean;

type RunEndFunction = (
  text: string,
  from: number,
  isCode: IsCodeFunction,
) => number;

// The end of the run of characters of a kind that starts at `from`.
const runEnd: RunEndFunction = (
  text: string,
  from: number,
  isCode: IsCodeFunction,
): number => {
  let index: number = from;

  while (index < text.length && isCode(text.charCodeAt(index))) {
    index++;
  }

  return index;
};

// The start of the run of characters of a kind that ends just before `end`.
const runStartBefore: RunEndFunction = (
  text: string,
  end: number,
  isCode: IsCodeFunction,
): number => {
  let index: number = end;

  while (index > 0 && isCode(text.charCodeAt(index - 1))) {
    index--;
  }

  return index;
};

type HoldsLineTerminatorFunction = (
  text: string,
  from: number,
  to: number,
) => boolean;

// Whether the text holds a line terminator in [from, to).
const holdsLineTerminator: HoldsLineTerminatorFunction = (
  text: string,
  from: number,
  to: number,
): boolean => {
  for (let index: number = from; index < to; index++) {
    if (isLineTerminatorCode(text.charCodeAt(index))) {
      return true;
    }
  }

  return false;
};

const PYTHON_TRACEBACK_HEADER: string = "Traceback (most recent call last):";

/*
 * /^\s*Traceback \(most recent call last\):\s*$/m - whether a line of the
 * text is a Python traceback's header, with only white space around it.
 *
 * The white space before the header may begin the text, or hold a line
 * break (a line starts after it); the white space after it may end the
 * text, or hold a line break (a line ends there). Each header written in
 * the text is asked about once.
 */
export const hasPythonTracebackHeaderLine: (text: string) => boolean = (
  text: string,
): boolean => {
  let at: number = text.indexOf(PYTHON_TRACEBACK_HEADER);

  while (at !== -1) {
    const before: number = runStartBefore(text, at, isWhiteSpaceCode);
    const after: number = at + PYTHON_TRACEBACK_HEADER.length;
    const afterEnd: number = runEnd(text, after, isWhiteSpaceCode);

    if (
      (before === 0 || holdsLineTerminator(text, before, at)) &&
      (afterEnd === text.length || holdsLineTerminator(text, after, afterEnd))
    ) {
      return true;
    }

    at = text.indexOf(PYTHON_TRACEBACK_HEADER, at + 1);
  }

  return false;
};

/*
 * /^(\s*at\s+)(.*)$/ - a frame line's "at" with the white space around it,
 * and the rest of the line, which may hold no line terminator.
 */
export const readAtFrameLine: (line: string) => StackTraceLineMatch | null = (
  line: string,
): StackTraceLineMatch | null => {
  const at: number = runEnd(line, 0, isWhiteSpaceCode);

  if (!line.startsWith("at", at)) {
    return null;
  }

  const restStart: number = runEnd(line, at + 2, isWhiteSpaceCode);

  if (
    restStart === at + 2 ||
    holdsLineTerminator(line, restStart, line.length)
  ) {
    return null;
  }

  return [line, line.slice(0, restStart), line.slice(restStart)];
};

/*
 * /^(.*?)(\s*\()([^()]*)(\))$/ - a call and its location in parentheses at
 * the end of a frame: "fn (file:1:2)". The location runs from the last
 * paren before the closing one, which must open it; the white space before
 * that "(" goes with it, and the call before them may hold no line
 * terminator.
 */
export const readCallWithLocation: (
  call: string,
) => StackTraceLineMatch | null = (
  call: string,
): StackTraceLineMatch | null => {
  const close: number = call.length - 1;

  if (close < 0 || call.charCodeAt(close) !== CLOSE_PAREN) {
    return null;
  }

  let open: number = close - 1;

  while (
    open >= 0 &&
    call.charCodeAt(open) !== OPEN_PAREN &&
    call.charCodeAt(open) !== CLOSE_PAREN
  ) {
    open--;
  }

  if (open < 0 || call.charCodeAt(open) !== OPEN_PAREN) {
    return null;
  }

  const separatorStart: number = runStartBefore(call, open, isWhiteSpaceCode);

  if (holdsLineTerminator(call, 0, separatorStart)) {
    return null;
  }

  return [
    call,
    call.slice(0, separatorStart),
    call.slice(separatorStart, open + 1),
    call.slice(open + 1, close),
    ")",
  ];
};

/*
 * /(?:^|[/\\])[^\s]*:\d+(?::\d+)?$/ - whether a frame ends with a file's
 * location, "path/file.js:12" or "path/file.js:12:7": a ":" and digits end
 * it, and no white space comes between that ":" and the start of the text
 * or a "/" or "\" before it.
 */
export const endsWithFileLocation: (call: string) => boolean = (
  call: string,
): boolean => {
  const digitsStart: number = runStartBefore(call, call.length, isDigitCode);
  const colon: number = digitsStart - 1;

  if (
    digitsStart === call.length ||
    colon < 0 ||
    call.charCodeAt(colon) !== COLON
  ) {
    return false;
  }

  for (let index: number = colon - 1; index >= 0; index--) {
    const code: number = call.charCodeAt(index);

    if (isWhiteSpaceCode(code)) {
      return false;
    }

    if (code === SLASH || code === BACKSLASH) {
      return true;
    }
  }

  return true;
};

type IsAtFunction = (text: string, at: number) => boolean;

const isPathSeparatorCode: IsCodeFunction = (code: number): boolean => {
  return code === SLASH || code === BACKSLASH;
};

const isDigitOrDotCode: IsCodeFunction = (code: number): boolean => {
  return isDigitCode(code) || code === DOT;
};

// [/\\]pkg[/\\]mod[/\\]: where Go keeps the modules a binary was built with.
const GO_MODULE_MARKER_LENGTH: number = 9;

const isGoModuleMarkerAt: IsAtFunction = (
  text: string,
  at: number,
): boolean => {
  return (
    isPathSeparatorCode(text.charCodeAt(at)) &&
    text.startsWith("pkg", at + 1) &&
    isPathSeparatorCode(text.charCodeAt(at + 4)) &&
    text.startsWith("mod", at + 5) &&
    isPathSeparatorCode(text.charCodeAt(at + 8))
  );
};

// @v[\d.]: a module's version after its path.
const isVersionAt: IsAtFunction = (text: string, at: number): boolean => {
  return text.startsWith("@v", at) && isDigitOrDotCode(text.charCodeAt(at + 2));
};

const isLineTerminatorAt: IsAtFunction = (
  text: string,
  at: number,
): boolean => {
  return isLineTerminatorCode(text.charCodeAt(at));
};

/*
 * The first index at or after a point where something is, for points that
 * only ever move forward: what was found is kept, and the search goes on
 * from where it stopped, so the text is read once however often it is
 * asked. -1 when there is none.
 */
class ForwardFinder {
  private readonly text: string;
  private readonly isAt: IsAtFunction;
  private searchedUpTo: number = 0;
  private found: number = -1;

  public constructor(text: string, isAt: IsAtFunction) {
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

/*
 * /[/\\]pkg[/\\]mod[/\\](.+?)@v[\d.]+/ - a Go module's path in a frame's
 * file: after the first "/pkg/mod/" that is followed, on the same line, by
 * at least one character and then "@v" and a version, up to that "@v".
 * Each "/pkg/mod/" asks for the first version after it, found once for all
 * of them.
 */
export const readGoModulePath: (path: string) => StackTraceLineMatch | null = (
  path: string,
): StackTraceLineMatch | null => {
  const versions: ForwardFinder = new ForwardFinder(path, isVersionAt);
  const terminators: ForwardFinder = new ForwardFinder(
    path,
    isLineTerminatorAt,
  );

  for (
    let start: number = 0;
    start + GO_MODULE_MARKER_LENGTH <= path.length;
    start++
  ) {
    if (!isGoModuleMarkerAt(path, start)) {
      continue;
    }

    const moduleStart: number = start + GO_MODULE_MARKER_LENGTH;
    const version: number = versions.atOrAfter(moduleStart + 1);

    if (version === -1) {
      return null;
    }

    const terminator: number = terminators.atOrAfter(moduleStart);

    if (terminator !== -1 && terminator < version) {
      continue;
    }

    const versionEnd: number = runEnd(path, version + 2, isDigitOrDotCode);

    return [path.slice(start, versionEnd), path.slice(moduleStart, version)];
  }

  return null;
};
