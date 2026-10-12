import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import * as MarkdownTableCellModule from "Common/Utils/Markdown/MarkdownTableCell";
import {
  generateCompareMarkdown,
  generateLlmsFullTxt,
  generatePricingMarkdown,
} from "../Utils/AIDiscovery";
import { getProductCompareSlugs } from "../Utils/ProductCompare";

/*
 * THE TABLES OF THE SITE'S MARKDOWN FOR AI TOOLS (AIDiscovery).
 *
 * llms-full.txt, /pricing.md and each /compare/<product>.md hold Markdown
 * tables - plans, features, competitors' columns, use cases - whose cells
 * come from the site's own pricing and comparison data. Each cell is placed
 * with markdownTableCell, which keeps every "|" in its cell whatever
 * backslashes come before it, and makes every line ending a space; the
 * cells escaped each "|" and each line feed before, and nothing else.
 *
 * Every cell these pages place is placed byte for byte as before - no value
 * holds a backslash before a "|", ends in one, or holds a carriage return -
 * and every row of every table has as many cells as its header.
 */

const HOME_URL: string = "https://oneuptime.com";
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

// Every page of Markdown the site writes with tables.
function pages(): Array<[string, string]> {
  const written: Array<[string, string]> = [
    ["llms-full.txt", generateLlmsFullTxt(HOME_URL, [])],
    ["pricing.md", generatePricingMarkdown(HOME_URL)],
  ];

  for (const slug of getProductCompareSlugs()) {
    written.push([
      `compare/${slug}.md`,
      generateCompareMarkdown(slug, HOME_URL) || "",
    ]);
  }

  return written;
}

describe("a comparison whose cells hold pipes, backslashes and line endings", () => {
  it("keeps every row of its tables as wide as the header", () => {
    jest.isolateModules(() => {
      jest.doMock("../Utils/ProductCompare", () => {
        const actual: Record<string, unknown> = jest.requireActual(
          "../Utils/ProductCompare",
        ) as Record<string, unknown>;
        const product: Record<string, unknown> = {
          ...(actual["default"] as (slug: string) => Record<string, unknown>)(
            "pagerduty",
          ),
          productName: "Tool \\| Pro",
          items: [
            {
              name: "Monitoring",
              data: [
                {
                  title: "Paths like C:\\|D:",
                  description: "a | b\r\nc",
                  productColumn: "ends in \\",
                  oneuptimeColumn: "tick",
                },
              ],
            },
          ],
        };

        return {
          ...actual,
          __esModule: true,
          default: (slug: string): Record<string, unknown> | undefined => {
            return slug === "pagerduty" ? product : undefined;
          },
        };
      });

      const discovery: {
        generateCompareMarkdown: typeof generateCompareMarkdown;
      } = jest.requireActual("../Utils/AIDiscovery") as {
        generateCompareMarkdown: typeof generateCompareMarkdown;
      };
      const markdown: string =
        discovery.generateCompareMarkdown("pagerduty", HOME_URL) || "";
      const tables: Array<Array<number>> = writtenTables(markdown);

      expect(tables.length).toBeGreaterThan(0);

      for (const counts of tables) {
        for (const count of counts) {
          expect(count).toBe(counts[0]);
        }
      }

      expect(markdown).toContain("| Feature | Tool \\| Pro | OneUptime |");
      // A carriage return is a line ending to every Markdown reader.
      expect(markdown.includes("\r")).toBe(false);
    });
  });
});

describe("the AI discovery pages' tables", () => {
  let placedCells: Array<string> = [];
  let spy: SpyInstance<(markdown: string) => string> | undefined = undefined;

  beforeEach(() => {
    placedCells = [];

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
    spy = undefined;
  });

  it("places every cell byte for byte as escaping each pipe and line feed placed it", () => {
    pages();
    spy?.mockRestore();
    spy = undefined;

    expect(placedCells.length).toBeGreaterThan(500);

    for (const cell of placedCells) {
      expect([cell, MarkdownTableCellModule.markdownTableCell(cell)]).toEqual([
        cell,
        cell.split(PIPE).join(`${BACKSLASH}${PIPE}`).split("\n").join(" "),
      ]);
    }
  });

  it("gives every row of every table as many cells as its header", () => {
    for (const [page, markdown] of pages()) {
      const tables: Array<Array<number>> = writtenTables(markdown);

      expect([page, tables.length > 0]).toEqual([page, true]);

      for (const counts of tables) {
        for (const count of counts) {
          expect([page, count]).toEqual([page, counts[0]]);
        }
      }
    }
  });
});
