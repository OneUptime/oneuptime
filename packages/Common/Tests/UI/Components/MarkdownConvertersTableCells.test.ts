import { describe, expect, it } from "@jest/globals";
import { Lexer, Token, Tokens } from "marked";
import {
  htmlToMarkdown,
  markdownToHtml,
} from "../../../UI/Components/Markdown.tsx/MarkdownConverters";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * TABLE CELLS IN THE EDITOR'S MARKDOWN (MarkdownConverters).
 *
 * The editor writes a table it is given - pasted from a page, a document or
 * a spreadsheet, or edited in its visual mode - as GitHub Markdown, and
 * reads that Markdown back every time the document is opened.
 *
 *   - Writing, each cell is placed with markdownTableCell: a "|" in a cell
 *     gets the backslash that keeps it in its cell whatever backslashes come
 *     before it. Escaping only the "|" turned "C:\|" into "C:\\|", which
 *     every table reader splits after the backslashes.
 *   - Reading, a row is split as GitHub's readers split it: at a "|" after
 *     an even number of backslashes, the backslash before any other "|"
 *     taken out. It split at every "|", escaped or not, so a table with a
 *     "|" in a cell came back with a column too many - and the cells past
 *     the header's width were dropped on the next save.
 *
 * Together a table reaches a fixed point after one save, as the rest of the
 * editor's round trip does, with every cell in its column.
 */

// The cells of each row of the first table marked reads in a text.
function markedRows(markdown: string): Array<Array<string>> {
  const table: Tokens.Table | undefined = new Lexer()
    .lex(markdown)
    .find((token: Token): boolean => {
      return token.type === "table";
    }) as Tokens.Table | undefined;

  if (!table) {
    return [];
  }

  return [table.header, ...table.rows].map(
    (cells: Array<Tokens.TableCell>): Array<string> => {
      return cells.map((cell: Tokens.TableCell): string => {
        return cell.text;
      });
    },
  );
}

const CELL_CONTENT: RegExp = /<t[hd]>([\s\S]*?)<\/t[hd]>/g;
const ROW: RegExp = /<tr>([\s\S]*?)<\/tr>/g;

// The cells of each row of an HTML table, as the editor renders them.
function htmlRows(html: string): Array<Array<string>> {
  return Array.from(html.matchAll(ROW)).map(
    (row: RegExpMatchArray): Array<string> => {
      return Array.from(row[1]!.matchAll(CELL_CONTENT)).map(
        (cell: RegExpMatchArray): string => {
          return cell[1]!;
        },
      );
    },
  );
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

describe("writing a table cell", () => {
  it("keeps a pipe after a backslash in its cell", () => {
    const markdown: string = htmlToMarkdown(
      tableHtml([
        ["path", "note"],
        ["C:\\|D:", "a|b"],
        ["E:\\\\|F:", "c"],
      ]),
    );

    // An odd run already escapes the pipe; an even one gets one more.
    expect(markdown).toContain("C:\\|D:");
    expect(markdown).not.toContain("C:\\\\|D:");
    expect(markdown).toContain("E:\\\\\\|F:");
    // Each row's cells as marked reads them: nothing moved to the next cell.
    expect(markedRows(markdown)).toEqual([
      ["path", "note"],
      ["C:|D:", "a|b"],
      ["E:\\\\|F:", "c"],
    ]);
  });

  it("keeps the cell after a cell that ends in a backslash", () => {
    const markdown: string = htmlToMarkdown(
      tableHtml([
        ["path", "size"],
        ["C:\\Temp\\", "12"],
      ]),
    );

    expect(markedRows(markdown)[1]).toEqual(["C:\\Temp\\\\", "12"]);
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
    expect(htmlToMarkdown(tableHtml([["a|b"]]))).toContain("a\\|b");
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

  it("ends a cell at a pipe after an even run of backslashes, as GitHub's readers do", () => {
    expect(
      htmlRows(markdownToHtml("| a \\\\| b |\n| --- | --- |\n| 1 | 2 |"))[0],
    ).toEqual(["a \\\\", "b"]);
    expect(
      htmlRows(markdownToHtml("| a \\\\\\| b |\n| --- |\n| 1 |"))[0],
    ).toEqual(["a \\\\| b"]);
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

  it("reads each row's cells as marked reads them", () => {
    const rows: Array<string> = generatedTexts(
      3000,
      1984,
      ["a", "b", " ", "|", "\\", "\\|", "\\\\"],
      10,
    );

    for (const row of rows) {
      const markdown: string = `| h |\n| --- |\n| ${row} |`;
      const marked: Array<Array<string>> = markedRows(markdown);
      const editor: Array<Array<string>> = htmlRows(markdownToHtml(markdown));

      if (marked.length === 0) {
        continue;
      }

      /*
       * marked keeps a body row to the header's width; the editor renders
       * the header's width too.
       */
      expect([row, editor[1]]).toEqual([row, marked[1]]);
    }
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

  it("every generated table reaches a fixed point after one save, every row as wide as the header", () => {
    const cells: Array<string> = generatedTexts(
      2000,
      4321,
      ["x", "y", " ", "|", "\\", "\\|", "-"],
      8,
    );

    for (let index: number = 0; index + 3 < cells.length; index += 4) {
      const html: string = tableHtml([
        [`h${cells[index]}`, `h${cells[index + 1]}`],
        [`c${cells[index + 2]}`, `c${cells[index + 3]}`],
      ]);
      const first: string = htmlToMarkdown(html);
      const second: string = htmlToMarkdown(markdownToHtml(first));

      expect([html, second]).toEqual([html, first]);
      // Every row as written splits into the header's two cells.
      expect([html, delimitedCellCounts(first)]).toEqual([html, [2, 2, 2]]);
    }
  });
});
