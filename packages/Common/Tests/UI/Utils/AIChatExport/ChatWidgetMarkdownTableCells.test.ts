import { describe, expect, test } from "@jest/globals";
import { Lexer, Token, Tokens } from "marked";
import {
  AIChatWidget,
  AIChatWidgetType,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import { widgetToMarkdown } from "../../../../UI/Utils/AIChatExport/ChatWidgetMarkdown";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";

/*
 * TABLE CELLS OF AN EXPORTED AI CHAT (ChatWidgetMarkdown).
 *
 * A chat's tables, charts and stat cards are exported as Markdown tables,
 * their cells holding what telemetry and the assistant put there: log
 * attributes, Windows paths, regular expressions, text from several lines.
 * Each cell is placed with markdownTableCell. Escaping only the "|" left
 * "C:\|" as "C:\\|", which a reader splits after the backslashes, and a
 * lone carriage return - a line ending to every Markdown reader - ended the
 * row. Every row now keeps its columns, whatever its cells hold.
 */

function tableWidget(rows: Array<JSONObject>): AIChatWidget {
  return {
    id: "W1",
    type: AIChatWidgetType.Table,
    title: "Rows",
    data: {
      columns: [
        { key: "value", title: "Value" },
        { key: "next", title: "Next" },
      ],
      rows: rows,
    },
  };
}

// The cells of each row of the first table marked reads.
function markedRows(markdown: string): Array<Array<string>> {
  const table: Tokens.Table | undefined = new Lexer()
    .lex(markdown)
    .find((token: Token): boolean => {
      return token.type === "table";
    }) as Tokens.Table | undefined;

  return table
    ? [table.header, ...table.rows].map(
        (cells: Array<Tokens.TableCell>): Array<string> => {
          return cells.map((cell: Tokens.TableCell): string => {
            return cell.text;
          });
        },
      )
    : [];
}

describe("an exported table keeps its columns", () => {
  test.each([
    ["a pipe", "a|b", "a\\|b"],
    ["a pipe after a backslash", "C:\\|D:", "C:\\|D:"],
    ["a pipe after two backslashes", "C:\\\\|D:", "C:\\\\\\|D:"],
    ["a backslash at the end", "C:\\Temp\\", "C:\\Temp\\\\"],
    ["a carriage return", "first\rsecond", "first second"],
    ["a line feed", "first\nsecond", "first second"],
    ["both", "first\r\nsecond", "first second"],
  ])("%s", (_name: string, value: string, cell: string) => {
    const markdown: string = widgetToMarkdown(
      tableWidget([{ value: value, next: "z" }]),
    );

    expect(markdown).toContain(`| ${cell} | z |`);
    expect(
      markedRows(markdown).map((row: Array<string>): number => {
        return row.length;
      }),
    ).toEqual([2, 2]);
    expect(markedRows(markdown)[1]![1]).toBe("z");
  });

  test("every generated value keeps its row's two columns", () => {
    const values: Array<string> = generatedTexts(
      3000,
      2112,
      ["a", " ", "|", "\\", "\\|", "\r", "\n", "`", "*"],
      10,
    ).filter((value: string): boolean => {
      return value.trim().length > 0;
    });

    for (const value of values) {
      const markdown: string = widgetToMarkdown(
        tableWidget([{ value: value, next: "z" }]),
      );
      const rows: Array<Array<string>> = markedRows(markdown);

      expect([value, rows.length, rows[1]?.length, rows[1]?.[1]]).toEqual([
        value,
        2,
        2,
        "z",
      ]);
    }
  });

  test("an ordinary table is exported exactly as before", () => {
    expect(
      widgetToMarkdown(
        tableWidget([
          { value: "checkout", next: "200 ms" },
          { value: "payments (EU)", next: "1.2 s" },
        ]),
      ),
    ).toContain(
      "| Value | Next |\n| --- | --- |\n| checkout | 200 ms |\n| payments (EU) | 1.2 s |",
    );
  });
});
