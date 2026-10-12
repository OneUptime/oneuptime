import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { htmlAsText } from "../../Helpers/HtmlText";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { renderAsDashboard } from "./DashboardMarkdownRenderer";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { marked } from "marked";

/*
 * A VALUE IN A FEED OR CHAT TABLE ROW (FeedMarkdown, MarkdownTableCell).
 *
 * mdText escapes a value for the sentence it sits in - every backslash
 * doubled, brackets, "<", emphasis and code escaped - and, in a table row,
 * places it in its cell with markdownTableCell, the one helper every table
 * here writes its cells with. After the sentence escape every backslash run
 * is even, so each "|" gets exactly the one backslash it always got: the
 * Markdown is byte for byte what it was. These tests pin that on real
 * values, and read generated values back through marked (the emails) and
 * the dashboard's parser: each row keeps its cells, and each cell reads the
 * value as it was typed.
 */

const WORD_JOINER_PATTERN: RegExp = new RegExp(WORD_JOINER, "g");
const TD_CONTENT: RegExp = /<td>([\s\S]*?)<\/td>/g;
const WHITESPACE_RUN: RegExp = /\s+/g;

function row(value: string): string {
  return mdText`| Name | Value |\n| --- | --- |\n| ${value} | ${"z"} |`.toString();
}

// What a reader sees in each cell of a rendered table.
function cellTextsOf(html: string): Array<string> {
  return Array.from(html.matchAll(TD_CONTENT)).map(
    (match: RegExpMatchArray): string => {
      return htmlAsText(match[1]!)
        .replace(WORD_JOINER_PATTERN, "")
        .replace(WHITESPACE_RUN, " ")
        .trim();
    },
  );
}

// A value as one line, as a cell shows it.
function asCell(value: string): string {
  return value.replace(WHITESPACE_RUN, " ").trim();
}

describe("mdText - a value in a table row is written as before", () => {
  test.each([
    ["a | b", "a \\| b"],
    ["C:\\Program Files\\app", "C:\\\\Program Files\\\\app"],
    ["trailing backslash \\", "trailing backslash \\\\"],
    ["a\\|b", "a\\\\\\|b"],
    ["**bold** | _x_", "\\*\\*bold\\*\\* \\| \\_x\\_"],
    ["<img src=x> | [link](y)", "\\<img src=x> \\| \\[link\\](y)"],
    ["checkout_service", "checkout_service"],
    ["99.9% | 100%", "99.9% \\| 100%"],
  ])("%p", (value: string, placed: string) => {
    expect(row(value)).toBe(
      `| Name | Value |\n| --- | --- |\n| ${placed} | z |`,
    );
  });
});

const VALUE_ALPHABET: ReadonlyArray<string> = [
  "a",
  "b",
  " ",
  "|",
  "\\",
  "\\|",
  "*",
  "_",
  "[",
  "]",
  "(",
  ")",
  "<",
  ">",
  "!",
  "`",
  "~",
  "&",
  "#",
  "-",
  "é",
];

const values: Array<string> = generatedTexts(1500, 5150, VALUE_ALPHABET, 12)
  .map((text: string): string => {
    return `v ${text}`.trimEnd();
  });

describe("mdText - a value in a table row keeps its cell and reads as typed", () => {
  test("in the emails (marked)", () => {
    for (const value of values) {
      expect([
        value,
        cellTextsOf(marked.parse(row(value), { async: false }) as string),
      ]).toEqual([value, [asCell(value), "z"]]);
    }
  });

  describe("in the dashboard (micromark with GitHub's extensions)", () => {
    let htmls: Array<string> = [];

    beforeAll(() => {
      htmls = renderAsDashboard(values.map(row));
    });

    test("every row keeps its two cells, and the value reads as typed", () => {
      values.forEach((value: string, index: number) => {
        expect([value, cellTextsOf(htmls[index]!)]).toEqual([
          value,
          [asCell(value), "z"],
        ]);
      });
    });
  });
});
