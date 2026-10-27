import Markdown from "../../../Server/Types/Markdown";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { markdownCodeSpan } from "../../../Utils/Markdown/MarkdownEscape";
import { neutralizeUntrustedMarkdown } from "../../../Utils/Markdown/UntrustedMarkdown";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { namedPattern } from "../../Helpers/SourcePatterns";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * MARKDOWN WRITTEN OUTSIDE IS READ IN TIME IN LINE WITH ITS LENGTH, AND READ
 * AS IT WAS READ BEFORE.
 *
 * Feed items place values somebody else wrote - a name, a host, an error an
 * agent reported - inside code spans and fenced blocks; notes and AI
 * reports are neutralized before they are shown; emails turn markdown into
 * plain text. Text is split into lines at "\n" only, so a line can still
 * hold another line separator ("\r", U+2028, U+2029), which "." does not
 * match: on such a line the fence patterns tried every shorter fence run,
 * each reading the rest of the line again. And a value's long run of white
 * space was read again from each of its characters, looking for the line
 * break a code span turns into a space. Each is read once now.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

// The longest line the email's plain text reads whole (OVER_LONG_LINE_LENGTH).
const LONGEST_READ_LINE: number = 65536;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR: string = String.fromCharCode(0x2029);

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

describe("markdown written outside is read in time in line with its length", () => {
  test.each([
    ["a tilde run and a carriage return", repeat("~", LENGTH) + "\r"],
    [
      "a backtick run and a line separator",
      repeat("`", LENGTH) + LINE_SEPARATOR,
    ],
    [
      "a tilde run after spaces",
      "   " + repeat("~", LENGTH) + PARAGRAPH_SEPARATOR,
    ],
  ])("a feed item's fenced value: %s", (_label: string, value: string) => {
    let markdown: string = "";

    expect(
      timeOf(() => {
        markdown = mdText`Output:\n\`\`\`\n${value}\n\`\`\``.toString();
      }),
    ).toBeLessThan(2000);
    expect(markdown).toContain(value.trim().slice(0, 10));
  });

  test.each([
    ["white space, then a line break", repeat("\t", LENGTH) + "x\n"],
    ["spaces and tabs with no line break", repeat(" \t", LENGTH) + "x"],
    ["line breaks between spaces", repeat(" \n ", LENGTH)],
  ])("a code span's value: %s", (_label: string, value: string) => {
    expect(
      timeOf(() => {
        return markdownCodeSpan(value);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    ["a tilde fence line", "~~~" + repeat("~", LENGTH) + LINE_SEPARATOR],
    [
      "a tilde fence line, then text",
      "~~~" + repeat("~", LENGTH) + PARAGRAPH_SEPARATOR + "x",
    ],
  ])("untrusted markdown: %s", (_label: string, markdown: string) => {
    expect(
      timeOf(() => {
        return neutralizeUntrustedMarkdown(markdown);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    [
      "a tilde fence line",
      "~~~" + repeat("~", LONGEST_READ_LINE - 4) + LINE_SEPARATOR,
    ],
    [
      "a list's fence line",
      "- " + repeat("~", LONGEST_READ_LINE - 4) + LINE_SEPARATOR,
    ],
  ])("an email's plain text: %s", (_label: string, line: string) => {
    expect(
      timeOf(() => {
        return Markdown.convertToPlainText(`Before\n${line}\nAfter`);
      }),
    ).toBeLessThan(2000);
  });
});

describe("a code span reads a value as it did", () => {
  const CODE_SPAN_BEFORE: RegExp = /\s*[\r\n]+\s*/g;

  test("a run of white space that holds a line break is one space", () => {
    expect(markdownCodeSpan("a \n\t b")).toBe("`a b`");
    expect(markdownCodeSpan("a\r\nb")).toBe("`a b`");
    expect(markdownCodeSpan("a \t b")).toBe("`a \t b`");
  });

  test("on twenty thousand drawn values, as the pattern wrote them", () => {
    const mismatches: Array<{ value: string; now: string; before: string }> =
      [];

    for (const value of generatedTexts(
      20000,
      9119,
      [" ", "\t", "\n", "\r", "\u00a0", "a", "`", "<b", LINE_SEPARATOR],
      14,
    )) {
      /*
       * What the value became once the pattern had turned its line breaks
       * into spaces holds no line break, so the code span reads it as it
       * is: the same span both ways when the white space reads the same.
       */
      const before: string = markdownCodeSpan(
        value.replace(new RegExp(CODE_SPAN_BEFORE.source, "g"), " "),
      );
      const now: string = markdownCodeSpan(value);

      if (now !== before) {
        mismatches.push({ value, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

/*
 * The fence patterns as they were: the reference the ones the product runs
 * (read from its source) must agree with, match for match.
 */
const FENCE_ALPHABET: ReadonlyArray<string> = [
  "`",
  "``",
  "```",
  "~",
  "~~~",
  " ",
  "   ",
  "\t",
  ">",
  "- ",
  "1. ",
  "a",
  "\r",
  LINE_SEPARATOR,
  PARAGRAPH_SEPARATOR,
];

describe.each([
  [
    "a feed's fence line",
    "packages/Common/Utils/Markdown/FeedMarkdown.ts",
    "FENCE_LINE_PATTERN",
    /^( {0,3})(`{3,}|~{3,})(.*)$/,
  ],
  [
    "untrusted markdown's opening fence",
    "packages/Common/Utils/Markdown/UntrustedMarkdown.ts",
    "OPENING_FENCE_PATTERN",
    /^(?:(`{3,})[^`]*|(~{3,}).*)$/,
  ],
  [
    "an email's opening fence",
    "packages/Common/Server/Types/Markdown.ts",
    "FENCE_OPEN",
    /^(?:[ \t>]|(?:[-*+]|\d{1,9}[.)])[ \t])*(?:(`{3,})[^`]*|(~{3,}).*)$/,
  ],
  [
    "the docs' translation fence",
    "packages/App/FeatureSet/Docs/Utils/Translations.ts",
    "FENCE",
    /^(`{3,}|~{3,})(.*)$/,
  ],
  [
    "the docs anchor script's fence",
    "Scripts/Docs/LocalizeAnchors.ts",
    "FENCE",
    /^ {0,3}(`{3,}|~{3,})(.*)$/,
  ],
])(
  "%s matches exactly what it matched before",
  (_label: string, file: string, name: string, before: RegExp) => {
    test("on forty thousand drawn lines", () => {
      const now: RegExp = namedPattern(file, name);
      const mismatches: Array<{ line: string; now: string; before: string }> =
        [];
      let matched: number = 0;

      for (const line of generatedTexts(40000, 4242, FENCE_ALPHABET, 10)) {
        const expected: string = JSON.stringify(before.exec(line));
        const actual: string = JSON.stringify(now.exec(line));

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

    test("on a line that was slow, quickly", () => {
      const now: RegExp = namedPattern(file, name);

      for (const line of [
        "~~~" + repeat("~", LENGTH) + LINE_SEPARATOR,
        "```" + repeat("`", LENGTH) + "\r",
      ]) {
        expect(
          timeOf(() => {
            return now.exec(line);
          }),
        ).toBeLessThan(2000);
      }
    });
  },
);
