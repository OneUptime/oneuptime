import {
  clipText,
  getInvestigationReportSummaryText,
  markdownToPlainText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationReport/InvestigationReportData";
import { getCitationMarkerRegex } from "../../../Utils/AI/InvestigationReport";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A REPORT'S SUMMARY IS FLATTENED TO PLAIN TEXT IN TIME IN LINE WITH ITS
 * LENGTH, WORD FOR WORD AS BEFORE.
 *
 * The incident and alert header shows an investigation report's Summary as
 * one line of plain text when a run has no TL;DR - what a model wrote, read
 * in the viewer's browser. An image or a link was looked for from every "["
 * of a run that opened none, and a "**" or "~~" pair from every delimiter
 * that closed none, each try reading on to the end of the summary: time
 * that grew with the square of its length. Each is now found once, and the
 * summary's trailing marks after a clip come off from its end.
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

// The functions as they were: the references the page must agree with.
const markdownToPlainTextBefore: (markdown: string) => string = (
  markdown: string,
): string => {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:```|~~~).*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(getCitationMarkerRegex(), "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .trim();
};

const clipTextBefore: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const hardLimit: number = Math.max(1, maxLength - 1);
  const slice: string = text.slice(0, hardLimit);
  const lastSpace: number = slice.lastIndexOf(" ");
  const clipped: string =
    lastSpace >= Math.floor(hardLimit * 0.6)
      ? slice.slice(0, lastSpace)
      : slice;

  return `${clipped.replace(/[\s.,;:!?—–-]+$/, "")}…`;
};

describe("a summary built to be slow is flattened quickly", () => {
  test.each([
    ["images that close none", repeat("![](", LENGTH)],
    ["links that close none", repeat("[(", LENGTH) + "][[]()"],
    ["a run of opening brackets", repeat("[", LENGTH)],
    ["bold that closes none", repeat("**a ", LENGTH)],
    ["underlines that close none", repeat("__a ", LENGTH)],
    ["strikethrough that closes none", repeat("~\t~~\u0000", LENGTH) + "\t"],
    ["struck words with a space before each closing", repeat("~~a ", LENGTH)],
  ])("%s", (_label: string, summary: string) => {
    expect(
      timeOf(() => {
        markdownToPlainText(summary);
        getInvestigationReportSummaryText({
          analysisTldr: null,
          report: { summary: summary } as Parameters<
            typeof getInvestigationReportSummaryText
          >[0]["report"],
        });
      }),
    ).toBeLessThan(2000);
  });

  test("a clip of a run of trailing marks", () => {
    // The long run of tabs is inside the clip, not at its end.
    const text: string =
      "x " + repeat("\t", LENGTH) + "\u0000\t" + repeat("y", 16);

    expect(
      timeOf(() => {
        clipText(text, LENGTH + 8);
      }),
    ).toBeLessThan(2000);
    expect(clipText(text, LENGTH + 8)).toBe(
      text.slice(0, LENGTH + 7) + "\u2026",
    );
  });
});

describe("the plain text is word for word what it was", () => {
  test("on forty thousand drawn summaries", () => {
    const differences: Array<string> = [];
    let changed: number = 0;

    for (const summary of generatedTexts(
      40000,
      8675,
      [
        "[",
        "]",
        "(",
        ")",
        "![",
        "](",
        "a",
        "b",
        " ",
        "\n",
        "\t",
        "*",
        "**",
        "_",
        "__",
        "~",
        "~~",
        "`",
        "``",
        "x",
        "#",
        "> ",
        "- ",
        "1. ",
        "[C1]",
        ".",
        ",",
        "!",
        "?",
        "—",
        "–",
        "-",
        "\r",
        "\u2028",
        "\u00a0",
      ],
      20,
    )) {
      const expected: string = markdownToPlainTextBefore(summary);

      if (expected !== summary) {
        changed++;
      }

      if (markdownToPlainText(summary) !== expected) {
        differences.push(JSON.stringify(summary));
      }
    }

    expect(differences).toEqual([]);
    expect(changed).toBeGreaterThan(20000);
  });

  test("a clip, on forty thousand drawn texts and lengths", () => {
    const differences: Array<string> = [];
    let index: number = 0;

    for (const text of generatedTexts(
      40000,
      5309,
      [
        " ",
        "\t",
        "a",
        "bc",
        ".",
        ",",
        ";",
        ":",
        "!",
        "?",
        "—",
        "–",
        "-",
        "\u2028",
      ],
      20,
    )) {
      const maxLength: number = 1 + (index % 12);

      index++;

      if (clipText(text, maxLength) !== clipTextBefore(text, maxLength)) {
        differences.push(JSON.stringify([text, maxLength]));
      }
    }

    expect(differences).toEqual([]);
  });

  test("the summaries it is written for", () => {
    expect(
      markdownToPlainText(
        "**The pool** ran [dry](https://example.com) ![chart](x.png) ~~now~~ [C1] .",
      ),
    ).toBe("The pool ran dry chart now.");
    expect(markdownToPlainText("[a](b")).toBe("[a](b");
    expect(markdownToPlainText("**open bold")).toBe("**open bold");
  });
});
