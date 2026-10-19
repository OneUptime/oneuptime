import { describe, expect, test } from "@jest/globals";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import {
  getFramePackageName,
  getStackTraceHeadline,
  isOutermostFirstStackTrace,
  orderFramesInnermostFirst,
  parseRawStackTraceLines,
} from "../../FeatureSet/Dashboard/src/Utils/StackTracePresentation";
import {
  endsWithFileLocation,
  hasPythonTracebackHeaderLine,
  readAtFrameLine,
  readCallWithLocation,
  readGoModulePath,
} from "../../FeatureSet/Dashboard/src/Utils/StackTraceLineText";

/*
 * ---------------------------------------------------------------------------
 * THE FRAME VIEWER READS A STACK TRACE IN TIME IN LINE WITH ITS LENGTH,
 * LINE FOR LINE AS BEFORE.
 *
 * The exception page shows a stack trace as the application sent it, read
 * in the browser of whoever opens it. Whether it is a Python traceback was
 * asked of every line start of a run of blank lines, each read on to the
 * end of the run; a frame's "at", its call and its location were each
 * looked for again from every character of a run of white space or of a
 * path; a Go module's path from every "/pkg/mod/". A trace built for it -
 * one long line, or 64 KB of blank lines - held the tab for seconds, then
 * minutes. StackTraceLineText reads each once and answers as the patterns
 * did; these tests hold it to both.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);
const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);

// The patterns as they were: the references the readers must agree with.
const PYTHON_TRACEBACK_HEADER_BEFORE: RegExp =
  /^\s*Traceback \(most recent call last\):\s*$/m;
const AT_FRAME_BEFORE: RegExp = /^(\s*at\s+)(.*)$/;
const CALL_WITH_LOCATION_BEFORE: RegExp = /^(.*?)(\s*\()([^()]*)(\))$/;
const LOCATION_ONLY_BEFORE: RegExp = /(?:^|[/\\])[^\s]*:\d+(?::\d+)?$/;
const GO_MODULE_BEFORE: RegExp = /[/\\]pkg[/\\]mod[/\\](.+?)@v[\d.]+/;

const matchOf: (
  text: string,
  pattern: RegExp,
) => Array<string | undefined> | null = (
  text: string,
  pattern: RegExp,
): Array<string | undefined> | null => {
  const match: RegExpMatchArray | null = text.match(pattern);

  return match ? Array.from(match) : null;
};

const WORST_TRACES: Array<[string, string]> = [
  ["a run of blank lines", repeat("\n", LENGTH) + "x"],
  [
    "a run of blank lines before a header with words after it",
    repeat("\n", LENGTH) + "Traceback (most recent call last): x",
  ],
  ["blank lines of spaces", repeat(" \n", LENGTH) + "x"],
  ["blank lines of line separators", repeat(LINE_SEPARATOR, LENGTH) + "x"],
  [
    "a frame's call with a run of spaces in it",
    "Error: x\n    at fn" + repeat(" ", LENGTH) + "y",
  ],
  [
    "a frame's call with a run of spaces before its location",
    "Error: x\n    at fn" + repeat(" ", LENGTH) + "(a",
  ],
  [
    "a frame's call with a run of tabs before a line separator",
    "Error: x\n    at fn" +
      repeat("\t", LENGTH) +
      LINE_SEPARATOR +
      "(app.js:1:2)",
  ],
  [
    "a frame's at with a run of spaces, then a line separator",
    "Error: x\nat" + repeat(" ", LENGTH) + "x" + LINE_SEPARATOR + "y",
  ],
  [
    "a frame's path of many folders and no line number",
    "Error: x\n    at " + repeat("a/", LENGTH) + "b",
  ],
  [
    "a frame's path of many folders and a space before its line number",
    "Error: x\n    at " + repeat("a/", LENGTH) + " :1",
  ],
  ["many frames", repeat("    at fn (/app/a.js:1:2)\n", LENGTH)],
  [
    "a Python traceback with a run of white space",
    "Traceback (most recent call last):\n" + repeat(" ", LENGTH) + "x",
  ],
  [
    "a Python traceback whose last line holds a run of line separators",
    'Traceback (most recent call last):\n  File "a.py", line 1\nx' +
      repeat(LINE_SEPARATOR, LENGTH) +
      "y",
  ],
  [
    "a first line that is a frame's at with a run of spaces",
    "at" + repeat(" ", LENGTH) + "x" + LINE_SEPARATOR + "y",
  ],
];

const WORST_FILE_NAMES: Array<[string, string]> = [
  ["a run of module folders", repeat("/pkg/mod/", LENGTH)],
  ["module folders each with a name", repeat("/pkg/mod/x", LENGTH)],
  [
    "module folders, a line break, then a version",
    repeat("\\pkg\\mod\\x", LENGTH) + "\n@v1.2.3",
  ],
  ["versions with no number", repeat("/pkg/mod/a@v", LENGTH)],
];

describe("a stack trace built to be slow is shown quickly", () => {
  test.each(WORST_TRACES)("%s", (_label: string, stackTrace: string) => {
    expect(
      timeOf(() => {
        isOutermostFirstStackTrace(stackTrace);
        orderFramesInnermostFirst([1, 2, 3], stackTrace);
        getStackTraceHeadline(stackTrace);
        parseRawStackTraceLines(stackTrace);
      }),
    ).toBeLessThan(2000);
  });

  test.each(WORST_FILE_NAMES)(
    "%s, read for its package",
    (_label: string, fileName: string) => {
      expect(
        timeOf(() => {
          getFramePackageName(fileName);
        }),
      ).toBeLessThan(2000);
    },
  );

  test("what the viewer shows of them is what it showed", () => {
    expect(isOutermostFirstStackTrace(repeat("\n", LENGTH) + "x")).toBe(false);
    expect(
      isOutermostFirstStackTrace(
        repeat("\n", LENGTH) + "Traceback (most recent call last):\n  x",
      ),
    ).toBe(true);
    expect(
      getStackTraceHeadline("Error: x\n    at fn" + repeat(" ", LENGTH) + "y"),
    ).toBe("Error: x");

    const lines: ReturnType<typeof parseRawStackTraceLines> =
      parseRawStackTraceLines(
        "Error: x\n    at fn" + repeat(" ", 1000) + "(/app/a.js:1:2)",
      );

    expect(lines[1]).toEqual({
      lineNumber: 2,
      kind: "frame",
      text: "    at fn" + repeat(" ", 1000) + "(/app/a.js:1:2)",
      prefix: "    at ",
      functionName: "fn",
      separator: repeat(" ", 1000) + "(",
      location: "/app/a.js:1:2",
      suffix: ")",
    });
    const modules: string = "/pkg/mod/x".repeat(100);

    expect(getFramePackageName(modules + "@v1.2.3/a.go")).toBe(
      modules.slice("/pkg/mod/".length),
    );
  });
});

describe("each reader answers as its pattern did", () => {
  const HEADER_PIECES: ReadonlyArray<string> = [
    "Traceback (most recent call last):",
    "Traceback (most recent call last):",
    " ",
    "\t",
    "\n",
    "\r",
    LINE_SEPARATOR,
    PARAGRAPH_SEPARATOR,
    NO_BREAK_SPACE,
    "x",
    '  File "a.py", line 3, in f',
  ];

  const LINE_PIECES: ReadonlyArray<string> = [
    "at",
    "at ",
    "    at ",
    " ",
    "\t",
    "\n",
    "\r",
    LINE_SEPARATOR,
    NO_BREAK_SPACE,
    "x",
    "fn",
    "(",
    ")",
    " (",
    ":",
    "1",
    ":12:3",
    "/",
    "\\",
    "a.js",
    "/app/a.js:1:2",
    "<anonymous>",
  ];

  const PATH_PIECES: ReadonlyArray<string> = [
    "/pkg/mod/",
    "\\pkg\\mod\\",
    "/pkg\\mod/",
    "@v",
    "@v1.2.3",
    "1",
    ".",
    "x",
    "github.com/a/b",
    "/",
    "\\",
    "@",
    "v",
    "\n",
    LINE_SEPARATOR,
    "pkg",
    "mod",
  ];

  test("a Python traceback's header, on 40,000 drawn traces", () => {
    const differences: Array<string> = [];
    let headers: number = 0;

    for (const text of generatedTexts(40000, 2718, HEADER_PIECES, 12)) {
      const expected: boolean = PYTHON_TRACEBACK_HEADER_BEFORE.test(text);

      if (expected) {
        headers++;
      }

      if (hasPythonTracebackHeaderLine(text) !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(headers).toBeGreaterThan(5000);
  });

  test("a frame's at, call and location, on 40,000 drawn lines", () => {
    const differences: Array<string> = [];
    let frames: number = 0;
    let calls: number = 0;
    let locations: number = 0;

    for (const line of generatedTexts(40000, 1414, LINE_PIECES, 16)) {
      const at: Array<string | undefined> | null = matchOf(
        line,
        AT_FRAME_BEFORE,
      );
      const call: Array<string | undefined> | null = matchOf(
        line,
        CALL_WITH_LOCATION_BEFORE,
      );

      if (at) {
        frames++;
      }

      if (call) {
        calls++;
      }

      if (LOCATION_ONLY_BEFORE.test(line)) {
        locations++;
      }

      if (
        JSON.stringify(readAtFrameLine(line)) !== JSON.stringify(at) ||
        JSON.stringify(readCallWithLocation(line)) !== JSON.stringify(call) ||
        endsWithFileLocation(line) !== LOCATION_ONLY_BEFORE.test(line)
      ) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(frames).toBeGreaterThan(2000);
    expect(calls).toBeGreaterThan(300);
    expect(locations).toBeGreaterThan(2000);
  });

  test("a Go module's path, on 40,000 drawn file names", () => {
    const differences: Array<string> = [];
    let modules: number = 0;

    for (const path of generatedTexts(40000, 1732, PATH_PIECES, 12)) {
      const expected: Array<string | undefined> | null = matchOf(
        path,
        GO_MODULE_BEFORE,
      );

      if (expected) {
        modules++;
      }

      if (JSON.stringify(readGoModulePath(path)) !== JSON.stringify(expected)) {
        differences.push(JSON.stringify(path));
      }
    }

    expect(differences).toEqual([]);
    expect(modules).toBeGreaterThan(2000);
  });

  test("where the white space around the header decides", () => {
    const header: string = "Traceback (most recent call last):";

    for (const text of [
      header,
      " " + header + " ",
      "x\n" + header,
      "x " + header,
      "x\r " + header + "\t" + LINE_SEPARATOR + "y",
      header + " x",
      header + " \n x",
      "\n\n" + header + PARAGRAPH_SEPARATOR,
      NO_BREAK_SPACE + header,
      "x" + NO_BREAK_SPACE + header,
    ]) {
      expect({ text, header: hasPythonTracebackHeaderLine(text) }).toEqual({
        text,
        header: PYTHON_TRACEBACK_HEADER_BEFORE.test(text),
      });
    }
  });

  test("where a line terminator decides", () => {
    for (const line of [
      "at x" + LINE_SEPARATOR + "y",
      "at" + LINE_SEPARATOR + "x",
      "at \r x",
      "fn\r (a)",
      "f\rn (a)",
      "fn \r(a\rb)",
      " (a)",
      "(a)",
      "fn ()",
      "fn (a(b)",
      "fn (a)b)",
      "a/b c:1",
      "a/b:1:2",
      "a b/c:1",
      "\\c:1",
      ":1",
      "a:1:",
    ]) {
      expect({ line, at: readAtFrameLine(line) }).toEqual({
        line,
        at: matchOf(line, AT_FRAME_BEFORE),
      });
      expect({ line, call: readCallWithLocation(line) }).toEqual({
        line,
        call: matchOf(line, CALL_WITH_LOCATION_BEFORE),
      });
      expect({ line, location: endsWithFileLocation(line) }).toEqual({
        line,
        location: LOCATION_ONLY_BEFORE.test(line),
      });
    }

    for (const path of [
      "/pkg/mod/x@v1",
      "/pkg/mod/@v1",
      "/pkg/mod/x\n@v1",
      "/pkg/mod/x\n/pkg/mod/y@v1.0",
      "/pkg/mod/pkg/mod/x@v1",
      "/pkg/mod/x@v@v2",
      "/pkg/mod/x@vx",
    ]) {
      expect({ path, module: readGoModulePath(path) }).toEqual({
        path,
        module: matchOf(path, GO_MODULE_BEFORE),
      });
    }
  });
});
