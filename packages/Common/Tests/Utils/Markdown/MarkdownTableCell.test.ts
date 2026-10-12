import markdownTableCellDefault, {
  markdownTableCell,
} from "../../../Utils/Markdown/MarkdownTableCell";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { renderAsDashboard } from "./DashboardMarkdownRenderer";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { marked } from "marked";
import fs from "fs";
import path from "path";

/*
 * MARKDOWN PLACED IN ONE CELL OF A TABLE (MarkdownTableCell).
 *
 * Every table OneUptime writes in Markdown - feed and chat rows, the docs'
 * permission reference, the security events guides, the AI discovery pages,
 * the editor's paste and save, AI chat exports - places its cells with
 * markdownTableCell. These tests hold it to what it promises, read by the two
 * table readers OneUptime renders with: marked (the emails, the docs) and
 * micromark with its GitHub extensions (the dashboard).
 *
 *   - every "|" stays in its cell, whatever backslashes come before it, and
 *     no line ending can end the row: a row keeps its columns;
 *   - the cell reads exactly as the same Markdown reads outside a table;
 *   - a cell with no "|", no line ending and no backslash at its end comes
 *     back as it was given, byte for byte;
 *   - placing a placed cell again changes nothing;
 *   - one pass, linear in the length.
 *
 * Escaping only the "|" ("a\|b" as "a\\|b") broke the first promise: an
 * even run of backslashes before a "|" ends the cell for both readers. The
 * tests show that reading, written with split and join, failing on texts the
 * helper places right.
 */

const BACKSLASH: string = "\\";
const PIPE: string = "|";

const TD_CONTENT: RegExp = /<td>([\s\S]*?)<\/td>/g;
const PARAGRAPH: RegExp = /^<p>([\s\S]*)<\/p>$/;
const IMPORT_LINE: RegExp = /^import /m;

// The contents of each cell of an HTML table, in order.
function cellsOf(html: string): Array<string> {
  return Array.from(html.matchAll(TD_CONTENT)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The contents of an HTML paragraph.
function paragraphOf(html: string): string {
  const match: RegExpMatchArray | null = html.trim().match(PARAGRAPH);

  return match ? match[1]! : html.trim();
}

// A table whose one body row holds `cell`, then "z".
function tableWith(cell: string): string {
  return `| head | next |\n| --- | --- |\n| ${cell} | z |`;
}

// What marked (the emails, the docs) makes of a text.
function markedHtmlOf(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

describe("markdownTableCell - what it changes", () => {
  test("a cell with no pipe, no line ending and no trailing backslash is given back as it is", () => {
    for (const cell of [
      "",
      "Read-only access to monitors.",
      "`CommandLine|contains: '-EncodedCommand'`".split(PIPE).join(""),
      "**bold** and _italic_ and `code`",
      "C:\\Program Files\\app",
      "a \\* b",
      "Status Pages & Incidents",
      "<b>raw</b>",
      "emoji 🚀, café, 中文, مرحبا",
      "  padded  ",
      "50%",
    ]) {
      expect(markdownTableCell(cell)).toBe(cell);
    }
  });

  test("a pipe after an even run of backslashes gets one more backslash", () => {
    expect(markdownTableCell("a|b")).toBe("a\\|b");
    expect(markdownTableCell("a\\\\|b")).toBe("a\\\\\\|b");
    expect(markdownTableCell("a\\\\\\\\|b")).toBe("a\\\\\\\\\\|b");
    expect(markdownTableCell("|")).toBe("\\|");
    expect(markdownTableCell("||")).toBe("\\|\\|");
    expect(markdownTableCell("| a | b |")).toBe("\\| a \\| b \\|");
  });

  test("a pipe after an odd run of backslashes is already escaped and stays as it is", () => {
    expect(markdownTableCell("a\\|b")).toBe("a\\|b");
    expect(markdownTableCell("a\\\\\\|b")).toBe("a\\\\\\|b");
    expect(markdownTableCell("\\|")).toBe("\\|");
  });

  test("every pipe, for every run of up to eight backslashes, ends with an odd run before it", () => {
    for (let run: number = 0; run <= 8; run++) {
      const placed: string = markdownTableCell(`x${BACKSLASH.repeat(run)}|y`);
      const expectedRun: number = run % 2 === 0 ? run + 1 : run;

      expect(placed).toBe(`x${BACKSLASH.repeat(expectedRun)}|y`);
    }
  });

  test("a trailing odd run of backslashes gets one more, and an even run stays", () => {
    expect(markdownTableCell("C:\\")).toBe("C:\\\\");
    expect(markdownTableCell("C:\\\\")).toBe("C:\\\\");
    expect(markdownTableCell("a\\\\\\")).toBe("a\\\\\\\\");
    expect(markdownTableCell("\\")).toBe("\\\\");
    // A backslash that ends a line before a line ending is followed by a space.
    expect(markdownTableCell("a\\\nb")).toBe("a\\ b");
  });

  test("every line ending becomes one space", () => {
    expect(markdownTableCell("a\nb")).toBe("a b");
    expect(markdownTableCell("a\r\nb")).toBe("a b");
    expect(markdownTableCell("a\rb")).toBe("a b");
    expect(markdownTableCell("a\n\nb")).toBe("a  b");
    expect(markdownTableCell("a\r\r\nb")).toBe("a  b");
    expect(markdownTableCell("\n")).toBe(" ");
    expect(markdownTableCell("a|\nb")).toBe("a\\| b");
  });

  test("placing a placed cell again changes nothing", () => {
    for (const cell of generatedTexts(5000, 1001, [
      "a",
      " ",
      PIPE,
      BACKSLASH,
      "\n",
      "\r",
      "`",
      "*",
    ])) {
      const placed: string = markdownTableCell(cell);

      expect([cell, markdownTableCell(placed)]).toEqual([cell, placed]);
    }
  });

  test("it is the module's default export too", () => {
    expect(markdownTableCellDefault).toBe(markdownTableCell);
  });

  test("it imports nothing", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Utils/Markdown/MarkdownTableCell.ts"),
      "utf8",
    );

    expect(source).not.toMatch(IMPORT_LINE);
  });
});

/*
 * The cells generated for the readers: Markdown that holds no line ending
 * and no code span (in a table, GitHub's readers take the backslash before
 * a "|" out even inside a code span, which no escape can keep). Each starts
 * with a word, so that outside a table no text of it starts a block.
 */
const READER_ALPHABET: ReadonlyArray<string> = [
  "a",
  "b",
  " ",
  PIPE,
  BACKSLASH,
  `${BACKSLASH}${BACKSLASH}`,
  `${BACKSLASH}${PIPE}`,
  "*",
  "_",
  "[",
  "](x)",
  "<",
  ">",
  "!",
  "&",
  "~",
  "#",
  "-",
  "1.",
  "é",
];

const readerCells: Array<string> = generatedTexts(
  2500,
  4242,
  READER_ALPHABET,
  14,
).map((text: string): string => {
  return `w ${text}`.trimEnd();
});

describe("markdownTableCell - read by marked (the emails and the docs)", () => {
  test("every row keeps its two cells, and its second cell is untouched", () => {
    for (const cell of readerCells) {
      const cells: Array<string> = cellsOf(
        markedHtmlOf(tableWith(markdownTableCell(cell))),
      );

      expect([cell, cells.length, cells[1]]).toEqual([cell, 2, "z"]);
    }
  });

  /*
   * Outside a table marked keeps the backslash of an escaped character in
   * an image's alt text (an image whose alt is "\|" gets the alt "\|"), where
   * the dashboard reads the character; in a table cell both read "|". So
   * texts with an image are held to their shape above, the rest to their
   * reading here.
   */
  test("each cell reads as the same Markdown reads outside a table", () => {
    const withoutImages: Array<string> = readerCells.filter(
      (cell: string): boolean => {
        return !cell.includes("![");
      },
    );

    expect(withoutImages.length).toBeGreaterThan(1000);

    for (const cell of withoutImages) {
      const cells: Array<string> = cellsOf(
        markedHtmlOf(tableWith(markdownTableCell(cell))),
      );

      expect([cell, cells[0]]).toEqual([
        cell,
        paragraphOf(markedHtmlOf(cell)),
      ]);
    }
  });

  test("escaping only the pipe leaves rows that lose their shape", () => {
    const broken: Array<string> = readerCells.filter(
      (cell: string): boolean => {
        const cells: Array<string> = cellsOf(
          markedHtmlOf(tableWith(cell.split(PIPE).join(`${BACKSLASH}${PIPE}`))),
        );

        return cells.length !== 2 || cells[1] !== "z";
      },
    );

    expect(broken.length).toBeGreaterThan(0);

    for (const cell of broken) {
      // Each holds a pipe after a backslash, which the helper places right.
      expect(cell).toContain(`${BACKSLASH}${PIPE}`);
      expect(
        cellsOf(markedHtmlOf(tableWith(markdownTableCell(cell)))),
      ).toHaveLength(2);
    }
  });
});

describe("markdownTableCell - read by the dashboard (micromark with GitHub's extensions)", () => {
  let renderedTables: Array<string> = [];
  let renderedParagraphs: Array<string> = [];
  let renderedPipeOnly: Array<string> = [];

  beforeAll(() => {
    const rendered: Array<string> = renderAsDashboard([
      ...readerCells.map((cell: string): string => {
        return tableWith(markdownTableCell(cell));
      }),
      ...readerCells,
      ...readerCells.map((cell: string): string => {
        return tableWith(cell.split(PIPE).join(`${BACKSLASH}${PIPE}`));
      }),
    ]);

    renderedTables = rendered.slice(0, readerCells.length);
    renderedParagraphs = rendered.slice(
      readerCells.length,
      readerCells.length * 2,
    );
    renderedPipeOnly = rendered.slice(readerCells.length * 2);
  });

  test("every row keeps its two cells, each reading as the same Markdown reads outside a table", () => {
    readerCells.forEach((cell: string, index: number) => {
      expect([cell, cellsOf(renderedTables[index]!)]).toEqual([
        cell,
        [paragraphOf(renderedParagraphs[index]!), "z"],
      ]);
    });
  });

  test("escaping only the pipe leaves rows that lose their shape", () => {
    const broken: number = renderedPipeOnly.filter(
      (html: string): boolean => {
        const cells: Array<string> = cellsOf(html);

        return cells.length !== 2 || cells[1] !== "z";
      },
    ).length;

    expect(broken).toBeGreaterThan(0);
  });

  test("a pipe in a code span stays in its cell", () => {
    const html: string = renderAsDashboard([
      `| head |\n| --- |\n| ${markdownTableCell("`field|modifier`")} |`,
    ])[0]!;

    expect(cellsOf(html)).toEqual(["<code>field|modifier</code>"]);
  });

  test("a line ending in a cell does not end its row", () => {
    const html: string = renderAsDashboard([
      tableWith(markdownTableCell("first line\nsecond line\r\nthird\rfourth")),
    ])[0]!;

    expect(cellsOf(html)).toEqual(["first line second line third fourth", "z"]);
  });
});

describe("markdownTableCell - time", () => {
  /*
   * One pass and no regular expression: four megabytes of each shape -
   * pipes, runs of backslashes, both in turn, line endings - are placed well
   * within the budget, which a pass per pipe or a pattern that backtracks
   * would not keep.
   */
  const SIZE: number = 4 * 1024 * 1024;
  const BUDGET_IN_MS: number = 2000;

  for (const [name, unit] of [
    ["pipes", PIPE],
    ["backslashes", BACKSLASH],
    ["a backslash before each pipe", `${BACKSLASH}${PIPE}`],
    ["two backslashes before each pipe", `${BACKSLASH}${BACKSLASH}${PIPE}`],
    ["line endings", "\r\n"],
    ["words", "lorem ipsum "],
  ] as Array<[string, string]>) {
    test(`four megabytes of ${name}`, () => {
      const text: string = unit.repeat(Math.ceil(SIZE / unit.length));
      const startedAt: number = performance.now();
      const placed: string = markdownTableCell(text);
      const tookMs: number = performance.now() - startedAt;

      expect(tookMs).toBeLessThan(BUDGET_IN_MS);
      expect(markdownTableCell(placed)).toBe(placed);
    });
  }
});
