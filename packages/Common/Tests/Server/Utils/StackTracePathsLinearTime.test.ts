import {
  extractCandidatePathsFromStackTrace,
  findPathsWithLineNumber,
} from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * THE FILES A STACK TRACE NAMES ARE FOUND IN TIME IN LINE WITH ITS LENGTH,
 * AND THEY ARE THE FILES FOUND BEFORE.
 *
 * Which connected repository an exception's code lives in is worked out
 * from the paths its stack trace names - and a stack trace is whatever an
 * application sent. The global pattern that found "path.ext:<line>" was
 * tried again from every character of a run of path characters, each try
 * reading on to the end of the run: 64,000 characters with no ":<line>"
 * took seconds, 400,000 minutes. findPathsWithLineNumber reads each run a
 * fixed number of times and finds exactly what the pattern found.
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

// The pattern as it was: the reference the reader must agree with.
const PATH_WITH_LINE_BEFORE: RegExp =
  /((?:[A-Za-z]:)?[\w.\-/\\@+~]+\.[A-Za-z][A-Za-z0-9]{0,9}):\d+/g;

const pathsBefore: (line: string) => Array<string> = (
  line: string,
): Array<string> => {
  const paths: Array<string> = [];

  for (const match of line.matchAll(
    new RegExp(PATH_WITH_LINE_BEFORE.source, "g"),
  )) {
    if (match[1]) {
      paths.push(match[1]);
    }
  }

  return paths;
};

describe("a stack trace built to be slow is read quickly", () => {
  test.each([
    ["a run of letters", repeat("A", LENGTH) + "\u0000..A:0"],
    ["a run of letters and dots", repeat("a.", LENGTH) + ":"],
    ["a run of letters before a colon", repeat("a", LENGTH) + ":"],
    ["drive letters and colons", repeat("C:a", LENGTH)],
    ["extensions with no line", repeat("x.js:", LENGTH)],
    ["a long extension", "a." + repeat("b", LENGTH) + ":1"],
  ])("%s", (_label: string, line: string) => {
    let paths: Array<string> = [];

    expect(
      timeOf(() => {
        paths = extractCandidatePathsFromStackTrace(line);
      }),
    ).toBeLessThan(2000);
    expect(paths.length).toBeLessThanOrEqual(10);
  });

  test("the frames before and after a built line are still found", () => {
    const trace: string = [
      "Error: boom",
      "    at charge (/app/src/billing/charge.ts:12:5)",
      repeat("a.", LENGTH),
      "    at run (/app/src/index.ts:3:1)",
    ].join("\n");

    expect(extractCandidatePathsFromStackTrace(trace)).toEqual([
      "src/billing/charge.ts",
      "src/index.ts",
    ]);
  });
});

describe("the paths found are the paths the pattern found", () => {
  test("in the frames each language writes", () => {
    const lines: Array<string> = [
      "    at fn (/app/src/x.ts:1:2)",
      "    at /app/src/x.js:1:2",
      "from /app/lib/x.rb:1:in `call'",
      "\t/app/pkg/x.go:12 +0x1b",
      "\tat com.acme.X.method(X.java:12)",
      "   at App.Run() in C:\\src\\Service.cs:line 42",
      "C:/app/src/a.ts:3:4 then D:\\b\\c.py:5",
      "a.js:12b.js:3",
      "x.js:1:2:3 y.tsx:4",
      "@scope/pkg/index.mjs:10:2 ~/a+b.c:9",
    ];

    for (const line of lines) {
      expect({ line, paths: findPathsWithLineNumber(line) }).toEqual({
        line,
        paths: pathsBefore(line),
      });
    }

    expect(findPathsWithLineNumber("a.js:12b.js:3")).toEqual([
      "a.js",
      "b.js",
    ]);
    expect(findPathsWithLineNumber("C:/app/src/a.ts:3:4")).toEqual([
      "C:/app/src/a.ts",
    ]);
  });

  test("on forty thousand lines drawn from path pieces", () => {
    const PIECES: ReadonlyArray<string> = [
      "a",
      "b",
      "Z",
      "_",
      "1",
      "23",
      ".",
      ".",
      ".js",
      ".ts",
      ".abcdefghij",
      ".abcdefghijk",
      ".1",
      ":",
      ":1",
      ":12",
      "C:",
      "c:",
      "/",
      "\\",
      "-",
      "@",
      "+",
      "~",
      " ",
      "(",
      ")",
      "\t",
      "é",
      "x.js:1",
      "C:/a.ts:3",
      "..",
      ".a1",
      ".A",
    ];
    const differences: Array<string> = [];
    let found: number = 0;

    for (const line of generatedTexts(40000, 1618, PIECES, 16)) {
      const expected: Array<string> = pathsBefore(line);

      found += expected.length;

      if (
        JSON.stringify(findPathsWithLineNumber(line)) !==
        JSON.stringify(expected)
      ) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(found).toBeGreaterThan(10000);
  });
});
