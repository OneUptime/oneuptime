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

const values: Array<string> = generatedTexts(
  1500,
  5150,
  VALUE_ALPHABET,
  12,
).map((text: string): string => {
  return `v ${text}`.trimEnd();
});

// A row whose first cell holds the value in a code span.
function codeRow(value: string): string {
  return mdText`| Rule | Value |\n| --- | --- |\n| \`${value}\` | ${"z"} |`.toString();
}

// A row whose first cell links to the value, an address.
function linkRow(address: string): string {
  return mdText`| Page | Value |\n| --- | --- |\n| [open](${address}) | ${"z"} |`.toString();
}

const CODE_CONTENT: RegExp = /<code>([\s\S]*?)<\/code>/;
const HREF: RegExp = /href="([^"]*)"/;

// The text of the first code span in a rendered cell.
function codeTextOf(html: string): string {
  const firstCell: string = Array.from(html.matchAll(TD_CONTENT))[0]?.[1] || "";
  const code: RegExpMatchArray | null = firstCell.match(CODE_CONTENT);

  return code ? htmlAsText(code[1]!).replace(WORD_JOINER_PATTERN, "") : "";
}

/*
 * Whether a "|" in the value has an odd run of backslashes right before
 * it. In a table a backslash right before a "|" is that "|"'s escape, even
 * inside a code span, so such a span shows the "|" without that backslash -
 * the one spelling the table readers here leave nothing else for.
 */
function hasEscapedPipe(value: string): boolean {
  let backslashes: number = 0;

  for (const character of value) {
    if (character === "|" && backslashes % 2 === 1) {
      return true;
    }

    backslashes = character === "\\" ? backslashes + 1 : 0;
  }

  return false;
}

describe("mdText - a code span or a link address in a table row stays in its cell", () => {
  test("a pipe in a code span gets the backslash that keeps it in its cell", () => {
    expect(codeRow("a|b")).toBe(
      "| Rule | Value |\n| --- | --- |\n| `a\\|b` | z |",
    );
    expect(codeRow("a\\\\|b")).toBe(
      "| Rule | Value |\n| --- | --- |\n| `a\\\\\\|b` | z |",
    );
    expect(codeRow("checkout-api")).toBe(
      "| Rule | Value |\n| --- | --- |\n| `checkout-api` | z |",
    );
  });

  test("a code span outside a table row is written as before", () => {
    expect(mdText`Rule ${"x"}: \`${"a|b"}\``.toString()).toBe("Rule x: `a|b`");
  });

  test("a pipe in a link address is percent-encoded, in a table row and out of one", () => {
    expect(linkRow("https://oneuptime.example/q?x=a|b")).toBe(
      "| Page | Value |\n| --- | --- |\n| [open](https://oneuptime.example/q?x=a%7Cb) | z |",
    );
    expect(mdText`[Open](${"https://oneuptime.example/a|b"})`.toString()).toBe(
      "[Open](https://oneuptime.example/a%7Cb)",
    );
  });

  const codeValues: Array<string> = generatedTexts(
    1000,
    6262,
    ["a", " ", "|", "\\", "\\|", "\\\\|", "`", "*", "<", "&", "-", "\n"],
    10,
  ).map((text: string): string => {
    return `v${text}`;
  });

  test("every generated code span keeps its row's two cells, in the emails and the dashboard", () => {
    const dashboard: Array<string> = renderAsDashboard(codeValues.map(codeRow));

    codeValues.forEach((value: string, index: number): void => {
      const markedHtml: string = marked.parse(codeRow(value), {
        async: false,
      }) as string;

      for (const html of [markedHtml, dashboard[index]!]) {
        expect([value, cellTextsOf(html).length]).toEqual([value, 2]);
        expect([value, cellTextsOf(html)[1]]).toEqual([value, "z"]);

        if (!hasEscapedPipe(value)) {
          // The code is the value, on one line.
          expect([value, asCell(codeTextOf(html))]).toEqual([
            value,
            asCell(value),
          ]);
        }
      }
    });
  });

  test("every generated link address keeps its row's two cells, and links to the address", () => {
    const addresses: Array<string> = generatedTexts(
      500,
      6363,
      ["a", "|", "-", "/", "=", "&"],
      10,
    ).map((text: string): string => {
      return `https://oneuptime.example/${text}`;
    });
    const dashboard: Array<string> = renderAsDashboard(addresses.map(linkRow));

    addresses.forEach((address: string, index: number): void => {
      const markedHtml: string = marked.parse(linkRow(address), {
        async: false,
      }) as string;

      for (const html of [markedHtml, dashboard[index]!]) {
        expect([address, cellTextsOf(html)]).toEqual([address, ["open", "z"]]);

        const href: string = htmlAsText(
          (Array.from(html.matchAll(TD_CONTENT))[0]?.[1] || "").match(
            HREF,
          )?.[1] || "",
        );

        expect([address, href]).toEqual([
          address,
          address.split("|").join("%7C"),
        ]);
      }
    });
  });
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
