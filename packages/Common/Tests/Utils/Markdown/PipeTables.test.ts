import { describe, expect, test } from "@jest/globals";
import { replacePipeTables } from "../../../Utils/Markdown/PipeTables";

/*
 * PIPE TABLES AS THE CHAT CONVERTERS READ THEM (Utils/Markdown/PipeTables).
 *
 * Slack and a Microsoft Teams incoming webhook found tables with one regular
 * expression, whose time grew with the square of a run of table-like lines
 * with no delimiter row. replacePipeTables reads them in one pass; here it
 * is held to what that expression did, on hand-written and generated texts.
 */

// What Slack and Teams did before, kept here to compare with.
const OLD_TABLE_PATTERN: RegExp =
  /(?:^|\n)((?:\|[^\n]+\|\n)+(?:\|[-:\s|]+\|\n)(?:\|[^\n]+\|\n?)+)/g;

function oldReplacePipeTables(
  markdown: string,
  format: (lines: Array<string>) => string,
): string {
  return markdown.replace(
    OLD_TABLE_PATTERN,
    (_match: string, table: string): string => {
      const lines: Array<string> = table.trim().split("\n");

      if (lines.length < 2) {
        return table;
      }

      return "\n" + format(lines) + "\n";
    },
  );
}

/*
 * Whether the old expression read a "table" that is not whole lines of
 * rows: "\s" in its delimiter row took line breaks too, so it joined rows
 * across a blank line or a line like "||", and its last row could end in
 * the middle of a line ("|x|y" read as the row "|x|", leaving "y" on a line
 * of its own). No Markdown reader does either, and replacePipeTables does
 * not; texts where the old expression did are left out of the comparison.
 */
function oldReadsPartsOfLines(markdown: string): boolean {
  const pattern: RegExp = new RegExp(OLD_TABLE_PATTERN.source, "g");

  for (
    let match: RegExpExecArray | null = pattern.exec(markdown);
    match !== null;
    match = pattern.exec(markdown)
  ) {
    const lines: Array<string> = match[1]!.replace(/\n$/, "").split("\n");
    const end: number = match.index + match[0].length;

    if (
      lines.some((line: string): boolean => {
        return line.length < 3 || !line.startsWith("|") || !line.endsWith("|");
      }) ||
      !(
        end === markdown.length ||
        markdown.charAt(end) === "\n" ||
        markdown.charAt(end - 1) === "\n"
      )
    ) {
      return true;
    }
  }

  return false;
}

const format: (lines: Array<string>) => string = (
  lines: Array<string>,
): string => {
  return `[table: ${lines.join(" / ")}]`;
};

describe("replacePipeTables", () => {
  test("a table is a run of rows with a delimiter row inside it", () => {
    const markdown: string =
      "Before\n| Host | State |\n| --- | :-: |\n| web-01 | down |\n| web-02 | up |\nAfter";

    expect(replacePipeTables(markdown, format)).toBe(
      "Before\n[table: | Host | State | / | --- | :-: | / | web-01 | down | / | web-02 | up |]\nAfter",
    );
  });

  test("a table at the start gets the line break before it, one at the end the line break after it", () => {
    expect(replacePipeTables("| a |\n| - |\n| b |", format)).toBe(
      "\n[table: | a | / | - | / | b |]\n",
    );
    expect(replacePipeTables("| a |\n| - |\n| b |\n", format)).toBe(
      "\n[table: | a | / | - | / | b |]\n",
    );
  });

  test("rows with no delimiter row, or only first or last, are no table", () => {
    for (const markdown of [
      "| a |\n| b |\n| c |",
      "| - |\n| a |",
      "| a |\n| - |",
      "|x|\n|-|",
    ]) {
      expect(replacePipeTables(markdown, format)).toBe(markdown);
    }
  });

  test("a line must be at least three characters, start and end with a pipe", () => {
    for (const markdown of [
      "||\n|-|\n||",
      "| a\n| - |\n| b |",
      "| a |\r\n| - |\r\n| b |",
    ]) {
      expect(replacePipeTables(markdown, format)).toBe(markdown);
    }
  });

  test("text with no pipe, and what is not a string, comes back as it is", () => {
    expect(replacePipeTables("no table here", format)).toBe("no table here");
    expect(replacePipeTables(undefined as unknown as string, format)).toBe(
      undefined,
    );
  });

  test("reads a hundred thousand rows with no delimiter row in good time", () => {
    const rows: string = "| 2026-10-08 | INFO | served |\n".repeat(100000);
    const started: number = Date.now();

    expect(replacePipeTables(rows, format) === rows).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("replaces exactly what the old expression replaced, for 3000 texts", () => {
    const LINES: ReadonlyArray<string> = [
      "| a |",
      "| a | b |",
      "|a|b|c|",
      "| --- |",
      "|---|---|",
      "| :-- | --: |",
      "|- -|",
      "|\u00A0-|",
      "text",
      "",
      " ",
      "| a",
      "a |",
      "||",
      "|x|y",
      "| a |  ",
    ];

    let state: number = 4577;
    const next: () => number = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };

    let compared: number = 0;
    let tables: number = 0;

    for (let index: number = 0; index < 3000; index++) {
      const count: number = 1 + Math.floor(next() * 12);
      const lines: Array<string> = [];

      for (let line: number = 0; line < count; line++) {
        lines.push(LINES[Math.floor(next() * LINES.length)]!);
      }

      const markdown: string = lines.join("\n") + (next() < 0.5 ? "\n" : "");

      if (oldReadsPartsOfLines(markdown)) {
        continue;
      }

      const expected: string = oldReplacePipeTables(markdown, format);

      compared++;

      if (expected !== markdown) {
        tables++;
      }

      expect([markdown, replacePipeTables(markdown, format)]).toEqual([
        markdown,
        expected,
      ]);
    }

    expect(compared).toBeGreaterThan(2000);
    expect(tables).toBeGreaterThan(200);
  });
});
