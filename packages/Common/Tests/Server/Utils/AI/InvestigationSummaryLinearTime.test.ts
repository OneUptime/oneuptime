import InvestigationReportSummary from "../../../../Server/Utils/AI/SRE/InvestigationReportSummary";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { namedPattern } from "../../../Helpers/SourcePatterns";
import { fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN AI REPORT'S SUMMARY IS READ IN TIME IN LINE WITH THE REPORT'S LENGTH,
 * AND READ AS IT WAS READ BEFORE.
 *
 * The pages that list AI runs show each run's summary, read from the report
 * the model wrote (InvestigationReportSummary): its Summary section - or its
 * whole body, when it follows no section format - with citation markers
 * dropped, flattened to plain text by the TL;DR rules (InvestigationTldr).
 * What the model writes can be steered by what it read. Three of those rules
 * read a long run again from every place in it: the space before a
 * punctuation mark a dropped citation leaves, a markdown link, and the white
 * space around a leading "TL;DR:" label. Each reads the text once now, and
 * changes exactly what it changed.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const SUMMARY_FILE: string =
  "packages/Common/Server/Utils/AI/SRE/InvestigationReportSummary.ts";
const TLDR_FILE: string =
  "packages/Common/Server/Utils/AI/SRE/InvestigationTldr.ts";

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

const WORST_CASES: Array<[string, string]> = [
  ["a run of opening brackets", "Pool ran dry " + repeat("[", LENGTH)],
  [
    "links with no closing parenthesis",
    "Pool ran dry " + repeat("[](", LENGTH),
  ],
  ["brackets that close, with no link after", repeat("[a]", LENGTH)],
  [
    "a run of spaces and tabs no punctuation follows",
    "Pool ran dry" + repeat(" \t", LENGTH) + "x",
  ],
  ["a label, then tabs", "TL;DR" + repeat("\t", LENGTH) + "x the pool ran dry"],
];

describe("an AI report's summary is read in time in line with its length", () => {
  test.each(WORST_CASES)(
    "a report that follows no section format: %s",
    (_label: string, report: string) => {
      expect(
        timeOf(() => {
          return InvestigationReportSummary.fromReport(report);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "a report's Summary section: %s",
    (_label: string, summary: string) => {
      expect(
        timeOf(() => {
          return InvestigationReportSummary.fromReport(
            `**Summary**\n${summary}\n\n**Most likely root cause**\nThe pool.`,
          );
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "a report's first next step: %s",
    (_label: string, step: string) => {
      expect(
        timeOf(() => {
          return InvestigationReportSummary.nextStepFromReport(
            `**Summary**\nThe pool ran dry.\n\n**Suggested next steps**\n- ${step}`,
          );
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "a model's TL;DR: %s",
    (_label: string, response: string) => {
      expect(
        timeOf(() => {
          return InvestigationTldr.sanitizeTldr(response);
        }),
      ).toBeLessThan(2000);
    },
  );
});

/*
 * The rules as they were: the references the ones the product runs (read
 * from its source) must agree with.
 */
const SPACE_BEFORE_PUNCTUATION_BEFORE: RegExp = /[ \t]+([.,;:!?])/g;
const MARKDOWN_LINK_BEFORE: RegExp = /\[([^\]]*)\]\([^)]*\)/g;
const LEADING_LABEL_LINE_BEFORE: RegExp =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:[>\-+*][ \t]+)?\*{0,2}(?:tl[;,]?[ \t]?dr|summary)\*{0,2}[ \t]*:?[ \t]*(?:\r?\n|$)/i;

interface Mismatch {
  text: string;
  now: string;
  before: string;
}

describe("each rule changes exactly what it changed before", () => {
  test("the space before a punctuation mark, on forty thousand drawn texts", () => {
    const now: RegExp = namedPattern(
      SUMMARY_FILE,
      "SPACE_BEFORE_PUNCTUATION_REGEX",
    );
    const mismatches: Array<Mismatch> = [];
    let changed: number = 0;

    for (const text of generatedTexts(
      40000,
      1212,
      [" ", "  ", "\t", ".", ",", "!", "?", ":", ";", "a", "b", "\n", "[C1]"],
      16,
    )) {
      const expected: string = text.replace(
        new RegExp(SPACE_BEFORE_PUNCTUATION_BEFORE.source, "g"),
        "$1",
      );
      const actual: string = text.replace(now, "$1");

      if (expected !== text) {
        changed++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(changed).toBeGreaterThan(10000);
  });

  test("a markdown link, on forty thousand drawn texts", () => {
    const now: RegExp = namedPattern(TLDR_FILE, "MARKDOWN_LINK_RE");
    const mismatches: Array<Mismatch> = [];
    let changed: number = 0;

    for (const text of generatedTexts(
      40000,
      3434,
      ["[", "]", "(", ")", "](", "a", "b", " ", "\n", "$1", "[]()"],
      16,
    )) {
      const expected: string = text.replace(
        new RegExp(MARKDOWN_LINK_BEFORE.source, "g"),
        "$1",
      );
      const actual: string = text.replace(
        now,
        (link: string, label: string | undefined): string => {
          return label === undefined ? link : label;
        },
      );

      if (expected !== text) {
        changed++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(changed).toBeGreaterThan(10000);
  });

  test("a leading label line, on forty thousand drawn texts", () => {
    const now: RegExp = namedPattern(TLDR_FILE, "LEADING_LABEL_LINE_RE");
    const mismatches: Array<Mismatch> = [];
    let changed: number = 0;

    for (const text of generatedTexts(
      40000,
      5656,
      [
        "TL;DR",
        "tldr",
        "Summary",
        "tl,dr",
        "tl dr",
        ":",
        " ",
        "\t",
        "\n",
        "\r\n",
        "\r",
        "#",
        "## ",
        "> ",
        "- ",
        "**",
        "*",
        "x",
      ],
      10,
    )) {
      const expected: string = text.replace(LEADING_LABEL_LINE_BEFORE, "");
      const actual: string = text.replace(now, "");

      if (expected !== text) {
        changed++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(changed).toBeGreaterThan(1000);
  });

  test("a summary reads as it did", () => {
    expect(
      InvestigationReportSummary.fromReport(
        "**Summary**\nThe [pool](https://example.com/pool) ran dry [C1] . It filled up again [C2] !\n",
      ),
    ).toBe("The pool ran dry. It filled up again!");
    expect(
      InvestigationTldr.sanitizeTldr(
        "TL;DR:   \nThe connection pool ran dry at 09:14.",
      ),
    ).toBe("The connection pool ran dry at 09:14.");
  });
});
