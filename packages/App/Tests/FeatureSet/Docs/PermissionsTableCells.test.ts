import {
  clearPermissionTableCaches,
  getGranularTablesMarkdown,
  getRoleTablesMarkdown,
  getScopeExemptRolesMarkdown,
  toTableCell,
} from "../../../FeatureSet/Docs/Utils/PermissionsTable";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import * as MarkdownTableCellModule from "Common/Utils/Markdown/MarkdownTableCell";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE PERMISSION REFERENCE'S TABLE CELLS (PermissionsTable.toTableCell).
 *
 * The docs' permission reference renders every permission's title and
 * description into Markdown tables, in all seventeen languages. A cell's
 * whitespace runs become one space, and the cell is placed with
 * markdownTableCell, which keeps every "|" in its cell whatever backslashes
 * come before it. toTableCell used to escape each "|" and nothing else.
 *
 * Every cell the reference places, in every language, is placed byte for
 * byte as before - no title or description ends in a backslash or holds one
 * before a "|" - and every row of every table has as many cells as its
 * header.
 */

const PIPE: string = "|";
const BACKSLASH: string = "\\";

/*
 * The cell count of every line of every pipe table, as GitHub's table
 * readers split a line: at a "|" after an even number of backslashes.
 * Lines one after another belong to one table.
 */
function writtenTables(markdown: string): Array<Array<number>> {
  const tables: Array<Array<number>> = [];
  let current: Array<number> = [];

  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) {
      if (current.length > 0) {
        tables.push(current);
        current = [];
      }

      continue;
    }

    let delimiters: number = 0;
    let backslashes: number = 0;

    for (const character of line) {
      if (character === BACKSLASH) {
        backslashes++;
        continue;
      }

      if (character === PIPE && backslashes % 2 === 0) {
        delimiters++;
      }

      backslashes = 0;
    }

    current.push(delimiters - 1);
  }

  if (current.length > 0) {
    tables.push(current);
  }

  return tables;
}

describe("toTableCell", () => {
  it("keeps a pipe in its cell whatever backslashes come before it", () => {
    expect(toTableCell("read | write")).toBe("read \\| write");
    expect(toTableCell("a\\|b")).toBe("a\\|b");
    expect(toTableCell("a\\\\|b")).toBe("a\\\\\\|b");
  });

  it("doubles a backslash that would escape the cell's closing pipe", () => {
    expect(toTableCell("ends in \\")).toBe("ends in \\\\");
    expect(toTableCell("ends in \\  ")).toBe("ends in \\\\");
  });

  it("joins every line and whitespace run into one space, and trims", () => {
    expect(toTableCell("  first\r\nsecond\rthird\n\n\tfourth  ")).toBe(
      "first second third fourth",
    );
  });

  it("leaves an ordinary description as it is", () => {
    expect(toTableCell("Read-only access to monitors.")).toBe(
      "Read-only access to monitors.",
    );
  });
});

describe("the permission reference's tables, in every language", () => {
  let placedCells: Array<string> = [];
  let spy: SpyInstance<(markdown: string) => string> | undefined = undefined;

  beforeEach(() => {
    placedCells = [];
    clearPermissionTableCaches();

    const original: (markdown: string) => string =
      MarkdownTableCellModule.markdownTableCell;

    spy = jest
      .spyOn(MarkdownTableCellModule, "markdownTableCell")
      .mockImplementation((markdown: string): string => {
        placedCells.push(markdown);
        return original(markdown);
      });
  });

  afterEach(() => {
    spy?.mockRestore();
    clearPermissionTableCaches();
  });

  it("places every cell byte for byte as escaping each pipe placed it", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      getRoleTablesMarkdown(language);
      getGranularTablesMarkdown(language);
      getScopeExemptRolesMarkdown(language);
    }

    expect(placedCells.length).toBeGreaterThan(1000);

    spy?.mockRestore();
    spy = undefined;

    for (const cell of placedCells) {
      expect([cell, MarkdownTableCellModule.markdownTableCell(cell)]).toEqual([
        cell,
        cell.split(PIPE).join(`${BACKSLASH}${PIPE}`),
      ]);
    }
  });

  it("gives every row of every table as many cells as its header", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const markdown of [
        getRoleTablesMarkdown(language),
        getGranularTablesMarkdown(language),
      ]) {
        const tables: Array<Array<number>> = writtenTables(markdown);

        expect([language, tables.length > 0]).toEqual([language, true]);

        for (const counts of tables) {
          for (const count of counts) {
            expect([language, count]).toEqual([language, counts[0]]);
          }
        }
      }
    }
  });
});
