import { describe, expect, it } from "@jest/globals";
import { marked } from "marked";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { renderAsDashboard } from "../../Utils/Markdown/DashboardMarkdownRenderer";

/*
 * TABLE CELLS IN THE EDITOR'S MARKDOWN (MarkdownConverters).
 *
 * The editor writes a table it is given - pasted from a page, a document or
 * a spreadsheet, or edited in its visual mode - as GitHub Markdown, and
 * reads that Markdown back every time the document is opened. Its visual
 * mode shows a cell's backslashes as they are (it reads no other escape),
 * so its cells are written for its own reader and for GFM's alike:
 *
 *   - Writing (tableCellMarkdown), a "|" gets a backslash, and so does each
 *     backslash right before it: "C:\|D:" is written "C:\\\|D:", and the
 *     dashboard shows it as typed. Escaping only the "|" turned "C:\|" into
 *     "C:\\|", which every table reader splits after the backslashes. A
 *     backslash that ends a cell is written as it is: a space follows every
 *     cell, so it cannot escape the "|" after it.
 *   - Reading (splitTableRow), a row is split as GitHub's readers split it:
 *     at a "|" after an even number of backslashes. Before any other "|" the
 *     escaping backslash is taken out and each escaped backslash read as
 *     one, as the dashboard shows them. The editor split at every "|",
 *     escaped or not, so a table with a "|" in a cell came back with a
 *     column too many - and the cells past the header's width were dropped
 *     on the next save.
 *
 * Together a cell's text comes back as typed however many times the
 * document is saved and opened, every row keeps its columns, and the
 * dashboard and marked show each "|" and the backslashes before it as typed.
 */

const CELL_CONTENT: RegExp = /<t[hd]>([\s\S]*?)<\/t[hd]>/g;
const ROW: RegExp = /<tr>([\s\S]*?)<\/tr>/g;

// The cells of each row of an HTML table.
function htmlRows(html: string): Array<Array<string>> {
  return Array.from(html.matchAll(ROW)).map(
    (row: RegExpMatchArray): Array<string> => {
      return Array.from(row[1]!.matchAll(CELL_CONTENT)).map(
        (cell: RegExpMatchArray): string => {
          return cell[1]!.trim();
        },
      );
    },
  );
}

// What marked (the emails, the docs) makes of a text.
function markedHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string;
}

/*
 * How many cells each line of a pipe table splits into, as GitHub's table
 * readers split it: at a "|" after an even number of backslashes, the
 * line's first and last such "|" framing it.
 */
function delimitedCellCounts(markdown: string): Array<number> {
  return markdown.split("\n").map((line: string): number => {
    let delimiters: number = 0;
    let backslashes: number = 0;

    for (const character of line.trim()) {
      if (character === "\\") {
        backslashes++;
        continue;
      }

      if (character === "|" && backslashes % 2 === 0) {
        delimiters++;
      }

      backslashes = 0;
    }

    return delimiters - 1;
  });
}

function tableHtml(rows: Array<Array<string>>): string {
  const escape: (text: string) => string = (text: string): string => {
    return text.split("&").join("&amp;").split("<").join("&lt;");
  };

  return `<table>${rows
    .map((cells: Array<string>, index: number): string => {
      const tag: string = index === 0 ? "th" : "td";

      return `<tr>${cells
        .map((cell: string): string => {
          return `<${tag}>${escape(cell)}</${tag}>`;
        })
        .join("")}</tr>`;
    })
    .join("")}</table>`;
}

// The editor's cells after a save and a reopen.
function reopened(rows: Array<Array<string>>): Array<Array<string>> {
  return htmlRows(markdownToHtml(htmlToMarkdown(tableHtml(rows))));
}

describe("writing a table cell", () => {
  it("escapes a pipe and each backslash right before it", () => {
    const markdown: string = htmlToMarkdown(
      tableHtml([
        ["path", "note"],
        ["C:\\|D:", "a|b"],
        ["E:\\\\|F:", "c"],
      ]),
    );

    expect(markdown).toContain("| C:\\\\\\|D:   | a\\|b |");
    expect(markdown).toContain("| E:\\\\\\\\\\|F: | c    |");
    // The header, the delimiter row and both rows: two cells each.
    expect(delimitedCellCounts(markdown)).toEqual([2, 2, 2, 2]);
  });

  it("the dashboard and marked show those cells as typed", () => {
    const markdown: string = htmlToMarkdown(
      tableHtml([
        ["path", "note"],
        ["C:\\|D:", "a|b"],
        ["E:\\\\|F:", "\\|"],
      ]),
    );
    const expected: Array<Array<string>> = [
      ["path", "note"],
      ["C:\\|D:", "a|b"],
      ["E:\\\\|F:", "\\|"],
    ];

    expect(htmlRows(renderAsDashboard([markdown])[0]!)).toEqual(expected);
    expect(htmlRows(markedHtml(markdown))).toEqual(expected);
  });

  it("writes a backslash that ends a cell as it is, and keeps the cell after it", () => {
    const markdown: string = htmlToMarkdown(
      tableHtml([
        ["path", "size"],
        ["C:\\Temp\\", "12"],
      ]),
    );

    expect(markdown).toContain("| C:\\Temp\\ | 12   |");
    expect(htmlRows(renderAsDashboard([markdown])[0]!)[1]).toEqual([
      "C:\\Temp\\",
      "12",
    ]);
    expect(htmlRows(markedHtml(markdown))[1]).toEqual(["C:\\Temp\\", "12"]);
  });

  it("writes an ordinary table exactly as before", () => {
    expect(
      htmlToMarkdown(
        tableHtml([
          ["a", "b"],
          ["1", "2"],
        ]),
      ),
    ).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |");
    expect(htmlToMarkdown(tableHtml([["a|b"]]))).toContain("| a\\|b |");
    expect(htmlToMarkdown(tableHtml([["C:\\Program Files"]]))).toContain(
      "| C:\\Program Files |",
    );
  });

  it("writes a line ending in a cell as a space", () => {
    expect(
      htmlToMarkdown("<table><tr><th>a&#13;b</th></tr></table>"),
    ).toContain("| a b |");
  });
});

describe("reading a table row", () => {
  it("keeps an escaped pipe in its cell, without its backslash", () => {
    expect(
      htmlRows(markdownToHtml("| a \\| b | c |\n| --- | --- |\n| 1 | 2 |")),
    ).toEqual([
      ["a | b", "c"],
      ["1", "2"],
    ]);
  });

  it("reads the escaped backslashes before an escaped pipe as one each", () => {
    expect(
      htmlRows(markdownToHtml("| a \\\\\\| b |\n| --- |\n| 1 |"))[0],
    ).toEqual(["a \\| b"]);
    expect(
      htmlRows(markdownToHtml("| a \\\\\\\\\\| b |\n| --- |\n| 1 |"))[0],
    ).toEqual(["a \\\\| b"]);
  });

  it("ends a cell at a pipe after an even run of backslashes, as GitHub's readers do", () => {
    expect(
      htmlRows(markdownToHtml("| a \\\\| b |\n| --- | --- |\n| 1 | 2 |"))[0],
    ).toEqual(["a \\\\", "b"]);
  });

  it("reads a row's framing pipes as frames, and an escaped last pipe as text", () => {
    expect(htmlRows(markdownToHtml("a | b\n--- | ---\n1 | 2"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(htmlRows(markdownToHtml("| a \\|\n| --- |\n| 1 |"))[0]).toEqual([
      "a |",
    ]);
  });

  it("reads each cell's escaped pipes, and the backslashes before them, as the dashboard and marked show them", () => {
    /*
     * Every run of backslashes here escapes the pipe right after it. (The
     * editor shows any other backslash as it is, which GFM does not: that
     * is the editor's reading everywhere, not only in tables.)
     */
    const rows: Array<string> = generatedTexts(
      1500,
      1984,
      ["a", "b", " ", "|", "\\|", "\\\\\\|", "\\\\\\\\\\|"],
      10,
    );
    const tables: Array<string> = rows.map((row: string): string => {
      return `| h |\n| --- |\n| ${row} |`;
    });
    const dashboard: Array<string> = renderAsDashboard(tables);

    tables.forEach((table: string, index: number): void => {
      const editor: Array<Array<string>> = htmlRows(markdownToHtml(table));

      /*
       * Every reader keeps a body row to the header's one cell, so the
       * cell is compared as each reader shows it.
       */
      expect([table, editor[1]]).toEqual([
        table,
        htmlRows(dashboard[index]!)[1],
      ]);
      expect([table, editor[1]]).toEqual([
        table,
        htmlRows(markedHtml(table))[1],
      ]);
    });
  });
});

describe("a table across save and reopen", () => {
  it("a stored table with an escaped pipe opens with its columns, and saves as it was", () => {
    const stored: string =
      "| Check  | Result |\n| ------ | ------ |\n| a \\| b | ok     |";

    expect(htmlRows(markdownToHtml(stored))).toEqual([
      ["Check", "Result"],
      ["a | b", "ok"],
    ]);
    expect(htmlToMarkdown(markdownToHtml(stored))).toBe(stored);
  });

  it("a cell's text comes back as typed: a backslash before a pipe, a backslash at the end", () => {
    const rows: Array<Array<string>> = [
      ["text", "more"],
      ["a\\|b", "C:\\"],
      ["E:\\\\|F:", "\\"],
      ["\\\\\\|", "x\\\\"],
      ["|", "a|b|c"],
    ];

    expect(reopened(rows)).toEqual(rows);
    expect(reopened(reopened(rows))).toEqual(rows);
  });

  it("every generated table comes back as typed, saves to a fixed point, and keeps its columns", () => {
    const cells: Array<string> = generatedTexts(
      2000,
      4321,
      ["x", "y", " ", "|", "\\", "\\|", "\\\\", "-"],
      8,
    );

    for (let index: number = 0; index + 3 < cells.length; index += 4) {
      const typed: Array<Array<string>> = [
        [`h${cells[index]}`, `h${cells[index + 1]}`],
        [`c${cells[index + 2]}`, `c${cells[index + 3]}`],
      ];
      const html: string = tableHtml(typed);
      const first: string = htmlToMarkdown(html);
      const second: string = htmlToMarkdown(markdownToHtml(first));

      // The editor trims a cell, as it always has.
      expect([html, htmlRows(markdownToHtml(first))]).toEqual([
        html,
        typed.map((row: Array<string>): Array<string> => {
          return row.map((cell: string): string => {
            return cell.trim();
          });
        }),
      ]);
      expect([html, second]).toEqual([html, first]);
      // Every row as written splits into the header's two cells.
      expect([html, delimitedCellCounts(first)]).toEqual([html, [2, 2, 2]]);
    }
  });

  it("a long cell of pipes and backslashes is saved and opened at once, as typed", () => {
    /*
     * The cell pads its column's other cells with as many spaces, and the
     * trailing-whitespace pattern the save ran over the document tried every
     * start in that run: 32 KB took three seconds to save, 64 KB twelve. The
     * save is linear now; 64 KB takes milliseconds.
     */
    const typed: string = "a\\|b|\\\\|".repeat(8000);
    const startedAt: number = performance.now();
    const back: Array<Array<string>> = reopened([["h"], [typed]]);
    const tookMs: number = performance.now() - startedAt;

    expect(back[1]![0]!.length).toBe(typed.length);
    expect(back[1]![0] === typed).toBe(true);
    expect(tookMs).toBeLessThan(2000);
  });

  it("a megabyte-long row of escaped pipes and backslashes is read in one pass", () => {
    // About a megabyte: 130,000 times "a\|b\\\|" and its delimiter.
    const row: string = "a\\|b\\\\\\|".repeat(130000);
    const markdown: string = `| h | i |\n| --- | --- |\n| ${row} | z |`;
    const startedAt: number = performance.now();
    const html: string = markdownToHtml(markdown);
    const tookMs: number = performance.now() - startedAt;

    expect(htmlRows(html)[1]).toEqual(["a|b\\|".repeat(130000), "z"]);
    expect(tookMs).toBeLessThan(5000);
  });
});
