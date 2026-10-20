import {
  HeadingLine,
  readHeadingLine,
} from "../../../UI/Components/Markdown.tsx/MarkdownHeadingLine";
import { markdownToHtml } from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A HEADING LINE IS READ IN TIME IN LINE WITH ITS LENGTH, AS THE PATTERN
 * READ IT.
 *
 * The markdown editor read every line it opens with
 * /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/ to see whether it is a heading. Each
 * length of the heading's text was tried in turn, and each try read the
 * white space after it again for every way the two runs of white space
 * around the closing hashes could share it: "# a", two thousand spaces and
 * an "x" took seconds, and with a line separator in the line a heading of
 * 1,200 characters took over a minute - in the browser of everyone who
 * opened the note. readHeadingLine reads the line once from each end, and
 * these tests hold it to the pattern: on hundreds of thousands of drawn
 * lines, on the lines the pattern was slow on, and on the headings people
 * write.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);
const NO_BREAK_SPACE: string = String.fromCharCode(0x00a0);
const IDEOGRAPHIC_SPACE: string = String.fromCharCode(0x3000);
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);

// The pattern as it was: the reference the reader must agree with.
const HEADING_BEFORE: RegExp = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

const headingBefore: (line: string) => HeadingLine | null = (
  line: string,
): HeadingLine | null => {
  const match: RegExpMatchArray | null = line.match(HEADING_BEFORE);

  return match
    ? { level: (match[1] || "").length, text: match[2] || "" }
    : null;
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("readHeadingLine reads the headings people write", () => {
  test.each([
    ["# Title", { level: 1, text: "Title" }],
    ["###### Six", { level: 6, text: "Six" }],
    ["## Closed ##", { level: 2, text: "Closed" }],
    ["## Closed ##   ", { level: 2, text: "Closed" }],
    ["#   Spaced out   ", { level: 1, text: "Spaced out" }],
    ["   ### Three spaces in", { level: 3, text: "Three spaces in" }],
    ["# C# and F#", { level: 1, text: "C# and F" }],
    ["# a# #", { level: 1, text: "a#" }],
    ["# #", { level: 1, text: "" }],
    ["# ", { level: 1, text: "" }],
    ["#\tTabbed", { level: 1, text: "Tabbed" }],
    [
      "# Ends in a line separator" + LINE_SEPARATOR,
      { level: 1, text: "Ends in a line separator" },
    ],
    ["# **Bold** and `code`", { level: 1, text: "**Bold** and `code`" }],
  ])("%j", (line: string, heading: HeadingLine) => {
    expect(readHeadingLine(line)).toEqual(heading);
    expect(headingBefore(line)).toEqual(heading);
  });

  test.each([
    "####### Seven hashes",
    "#NoSpace",
    "    # Four spaces in",
    "Not a heading",
    "",
    "#",
    "# a" + LINE_SEPARATOR + "b",
    "# a" + PARAGRAPH_SEPARATOR + "b",
  ])("%j is not a heading", (line: string) => {
    expect(readHeadingLine(line)).toBeNull();
    expect(headingBefore(line)).toBeNull();
  });
});

describe("readHeadingLine gives exactly what the pattern gave", () => {
  test("on every line of up to seven characters of white space, hashes, words and line terminators", () => {
    const alphabet: Array<string> = [
      " ",
      "\t",
      "#",
      "a",
      LINE_SEPARATOR,
      "\n",
      NO_BREAK_SPACE,
    ];
    const differences: Array<string> = [];
    let headings: number = 0;

    const visit: (line: string, length: number) => void = (
      line: string,
      length: number,
    ): void => {
      const expected: HeadingLine | null = headingBefore(line);

      if (expected) {
        headings++;
      }

      if (JSON.stringify(readHeadingLine(line)) !== JSON.stringify(expected)) {
        differences.push(JSON.stringify(line));
      }

      if (length < 7) {
        for (const character of alphabet) {
          visit(line + character, length + 1);
        }
      }
    };

    visit("", 0);

    expect(differences).toEqual([]);
    // 960,800 lines; a good share of them headings, closed or not.
    expect(headings).toBeGreaterThan(50000);
  });

  test("on two hundred thousand drawn lines of up to forty pieces", () => {
    const differences: Array<string> = [];
    let headings: number = 0;

    for (const line of generatedTexts(
      200000,
      6151,
      [
        "#",
        "##",
        "###",
        "####",
        " ",
        "  ",
        "\t",
        "a",
        "b c",
        " #",
        "# ",
        "\\#",
        LINE_SEPARATOR,
        PARAGRAPH_SEPARATOR,
        "\r",
        "\n",
        NO_BREAK_SPACE,
        IDEOGRAPHIC_SPACE,
        BYTE_ORDER_MARK,
        "*",
        "`",
      ],
      40,
    )) {
      const expected: HeadingLine | null = headingBefore(line);

      if (expected) {
        headings++;
      }

      if (JSON.stringify(readHeadingLine(line)) !== JSON.stringify(expected)) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    expect(headings).toBeGreaterThan(10000);
  });
});

describe("a heading line built to be slow is read quickly", () => {
  test.each([
    ["a run of spaces inside the heading", "# a" + repeat(" ", LENGTH) + "x"],
    [
      "a run of tabs, then a line separator",
      "#\t" +
        repeat("\t", LENGTH) +
        "x" +
        repeat("\t", 64) +
        LINE_SEPARATOR +
        "\tx",
    ],
    [
      "runs of tabs either side of a line separator",
      "#\t" +
        repeat("\t", LENGTH / 3) +
        "x" +
        repeat("\t", LENGTH / 3) +
        LINE_SEPARATOR +
        repeat("\t", LENGTH / 3) +
        "\tx",
    ],
    [
      "closing hashes between runs of spaces",
      "# a" + repeat(" # ", LENGTH) + "x",
    ],
    ["a run of hashes and spaces", "# " + repeat("# ", LENGTH)],
    ["a run of no-break spaces", "## a" + repeat(NO_BREAK_SPACE, LENGTH) + "b"],
  ])("%s", (_label: string, line: string) => {
    expect(
      timeOf(() => {
        readHeadingLine(line);
      }),
    ).toBeLessThan(2000);

    // The editor reads the line when it opens the note.
    expect(
      timeOf(() => {
        markdownToHtml(line);
      }),
    ).toBeLessThan(2000);
  });

  test("the heading the editor shows for one of them is the one the pattern read", () => {
    // Short enough for the pattern to read too.
    const line: string = "## a" + repeat(" ", 200) + "b ##" + repeat(" ", 200);

    expect(readHeadingLine(line)).toEqual(headingBefore(line));
    expect(markdownToHtml(line)).toBe(`<h2>a${repeat(" ", 200)}b</h2>`);
  });
});
