import {
  ParsedInvestigationReport,
  parseInvestigationReport,
} from "../../../Utils/AI/InvestigationReport";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { namedPattern } from "../../Helpers/SourcePatterns";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * AN AI REPORT IS READ IN TIME IN LINE WITH ITS LENGTH, AND READ AS IT WAS
 * READ BEFORE.
 *
 * The report is what a model wrote, and the model writes what it read -
 * logs, events, tool output - so a line of it can be of any length and any
 * shape. The report's lines are split at "\n" only: a line can still hold
 * another line separator ("\r" alone after the split, U+2028, U+2029),
 * which "." does not match. On such a line the patterns for a fence, a
 * heading and a bold label tried every way to split it - every shorter
 * fence run, every shorter run of white space, every place the label could
 * end - each try reading the rest of the line again. Each now reads a line
 * once, and matches exactly what it matched.
 * ---------------------------------------------------------------------------
 */

const REPORT_FILE: string = "packages/Common/Utils/AI/InvestigationReport.ts";
const FEED_ITEM_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Utils/AIRootCauseFeedItem.ts";

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const WORST_CASES: Array<[string, string]> = [
  ["a backtick fence line", "```" + repeat("`", LENGTH) + LINE_SEPARATOR],
  ["a tilde fence line", "  ~~~" + repeat("~", LENGTH) + PARAGRAPH_SEPARATOR],
  ["a heading line", "# " + repeat(" ", LENGTH) + LINE_SEPARATOR],
  [
    "a heading line of tabs",
    "##" + repeat("\t", LENGTH) + LINE_SEPARATOR + "x",
  ],
  ["a bold label line", "**" + repeat("*", LENGTH) + LINE_SEPARATOR + "x"],
  [
    "an underscore label line",
    "__" + repeat("_", LENGTH) + LINE_SEPARATOR + "x",
  ],
  ["a bold line of pairs", repeat("**", LENGTH) + LINE_SEPARATOR + "x"],
];

describe("a report is read in time in line with its length", () => {
  test.each(WORST_CASES)("%s", (_label: string, line: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        parseInvestigationReport(line);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });

  test.each(WORST_CASES)(
    "%s, inside a report with sections",
    (_label: string, line: string) => {
      const report: string = `## Summary\nThe pool was cut [C1].\n\n${line}\n\n## Root cause\nA release [C2].`;
      const timed: FastestRun<ParsedInvestigationReport> = fastestRun({
        run: (): ParsedInvestigationReport => {
          return parseInvestigationReport(report);
        },
        limitInMs: 2000,
      });
      const parsed: ParsedInvestigationReport = timed.result;

      expect(timed.inMs).toBeLessThan(2000);
      expect(parsed.isStructured).toBe(true);
    },
  );
});

describe("a report's lines are read as they were", () => {
  test("a fence still hides what is inside it from the sections", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "## Summary\nThe pool was cut.\n\n```text\n## Root cause\n```\n\n## Root cause\nA release.",
    );

    expect(parsed.summary).toContain("The pool was cut.");
    expect(parsed.rootCause).toBe("A release.");
  });

  test("a bold label still starts a section", () => {
    const parsed: ParsedInvestigationReport = parseInvestigationReport(
      "**Summary:** The pool was cut.\n\n**Root cause** — A release.",
    );

    expect(parsed.summary).toBe("The pool was cut.");
    expect(parsed.rootCause).toBe("A release.");
  });
});

/*
 * The patterns as they were: the reference the ones the product runs (read
 * from its source) must agree with, match for match and group for group.
 */
const FENCE_OPEN_BEFORE: RegExp = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const ATX_HEADING_BEFORE: RegExp = /^ {0,3}#{1,6}(?:[ \t]+(.*))?$/;
const STRONG_LEAD_BEFORE: RegExp = /^(\*\*|__)(\*|_)?(.+?)\2?\1(.*)$/;

// What a line may hold that "." does not read, and some text around it.
const LINE_ENDS: ReadonlyArray<string> = [
  " ",
  "\t",
  "a",
  "\r",
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
];

const FENCE_ALPHABET: ReadonlyArray<string> = [
  "`",
  "``",
  "```",
  "~",
  "~~~",
  "    ",
  ...LINE_ENDS,
];

const HEADING_ALPHABET: ReadonlyArray<string> = [
  "#",
  "##",
  "###",
  "#######",
  "   ",
  "Summary",
  ...LINE_ENDS,
];

const LABEL_ALPHABET: ReadonlyArray<string> = [
  "*",
  "**",
  "**",
  "_",
  "__",
  "__",
  "Summary",
  ":",
  "—",
  ...LINE_ENDS,
];

const execText: (pattern: RegExp, line: string) => string = (
  pattern: RegExp,
  line: string,
): string => {
  return JSON.stringify(pattern.exec(line));
};

interface Mismatch {
  line: string;
  now: string;
  before: string;
}

describe.each([
  [
    "the report's fence opening",
    REPORT_FILE,
    "FENCE_OPEN_REGEX",
    FENCE_OPEN_BEFORE,
    FENCE_ALPHABET,
  ],
  [
    "the report's heading",
    REPORT_FILE,
    "ATX_HEADING_REGEX",
    ATX_HEADING_BEFORE,
    HEADING_ALPHABET,
  ],
  [
    "the report's bold label",
    REPORT_FILE,
    "STRONG_LEAD_REGEX",
    STRONG_LEAD_BEFORE,
    LABEL_ALPHABET,
  ],
  [
    "the feed item's fence opening",
    FEED_ITEM_FILE,
    "FENCE_OPEN_REGEX",
    FENCE_OPEN_BEFORE,
    FENCE_ALPHABET,
  ],
])(
  "%s matches exactly what it matched before",
  (
    _label: string,
    file: string,
    name: string,
    before: RegExp,
    alphabet: ReadonlyArray<string>,
  ) => {
    test("on forty thousand drawn lines", () => {
      const now: RegExp = namedPattern(file, name);
      const mismatches: Array<Mismatch> = [];
      let matched: number = 0;

      for (const line of generatedTexts(40000, 1717, alphabet, 12)) {
        const expected: string = execText(before, line);
        const actual: string = execText(now, line);

        if (expected !== "null") {
          matched++;
        }

        if (actual !== expected) {
          mismatches.push({ line, now: actual, before: expected });
        }
      }

      expect(mismatches.slice(0, 5)).toEqual([]);
      expect(matched).toBeGreaterThan(1000);
    });

    test("on the lines that were slow", () => {
      const now: RegExp = namedPattern(file, name);

      for (const [, line] of WORST_CASES) {
        const short: string = line.slice(0, 2000) + line.slice(-2);
        const timed: FastestRun<string> = fastestRun({
          run: (): string => {
            return execText(now, line);
          },
          limitInMs: 2000,
        });
        const actual: string = timed.result;

        expect(timed.inMs).toBeLessThan(2000);
        expect(execText(now, short)).toBe(execText(before, short));
        expect(actual).toBe("null");
      }
    });
  },
);
