/*
 * The alerting module pulls the native isolated-vm addon through its
 * template renderer; stub it out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Lexer, Token, Tokens } from "marked";
import * as MarkdownTableCellModule from "../../../Utils/Markdown/MarkdownTableCell";

/*
 * THE SECURITY EVENTS GUIDES' TABLES (SecurityEventsGuide.markdownTable).
 *
 * The detection rules and threat intel guides - the "how it works" card and
 * the table header's help modal - write their reference tables (Sigma
 * modifiers such as `CommandLine|contains`, field names, severity levels,
 * indicator patterns) with markdownTable, which places each cell with
 * markdownTableCell. It used to escape each "|" and nothing else.
 *
 * Every cell the guides place is placed byte for byte as before - none ends
 * in a backslash, holds one before a "|", or holds a line ending - and
 * every row of every table of both guides has as many cells as its header,
 * read as GitHub's table readers read them. A cell that does hold such text
 * keeps its column too.
 */

const PIPE: string = "|";
const BACKSLASH: string = "\\";
const GUIDES_DIRECTORY: string =
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks";

type GuideModule =
  typeof import("../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide");
type DetectionModule =
  typeof import("../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide");
type ThreatIntelModule =
  typeof import("../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide");

interface Guides {
  guide: GuideModule;
  detection: DetectionModule;
  threatIntel: ThreatIntelModule;
}

interface LoadedGuides extends Guides {
  // Every cell the guides placed while they were built.
  placedCells: Array<string>;
}

/*
 * The guides, built afresh while markdownTableCell is watched: they write
 * their tables when their modules load. In a registry of their own, so the
 * helper they load is the one watched.
 */
function loadGuides(): LoadedGuides {
  const placedCells: Array<string> = [];
  const loaded: Array<Guides> = [];

  jest.isolateModules(() => {
    const helper: typeof MarkdownTableCellModule = jest.requireActual(
      "../../../Utils/Markdown/MarkdownTableCell",
    ) as typeof MarkdownTableCellModule;
    const original: (markdown: string) => string = helper.markdownTableCell;
    const spy: SpyInstance<(markdown: string) => string> = jest
      .spyOn(helper, "markdownTableCell")
      .mockImplementation((markdown: string): string => {
        placedCells.push(markdown);
        return original(markdown);
      });

    try {
      loaded.push({
        guide: jest.requireActual(
          `${GUIDES_DIRECTORY}/SecurityEventsGuide`,
        ) as GuideModule,
        detection: jest.requireActual(
          `${GUIDES_DIRECTORY}/DetectionRulesGuide`,
        ) as DetectionModule,
        threatIntel: jest.requireActual(
          `${GUIDES_DIRECTORY}/ThreatIntelGuide`,
        ) as ThreatIntelModule,
      });
    } finally {
      spy.mockRestore();
    }
  });

  return { ...loaded[0]!, placedCells: placedCells };
}

// Every table marked reads in a text, as rows of cell texts.
function tablesIn(markdown: string): Array<Array<Array<string>>> {
  return new Lexer()
    .lex(markdown)
    .filter((token: Token): boolean => {
      return token.type === "table";
    })
    .map((token: Token): Array<Array<string>> => {
      const table: Tokens.Table = token as Tokens.Table;

      return [table.header, ...table.rows].map(
        (cells: Array<Tokens.TableCell>): Array<string> => {
          return cells.map((cell: Tokens.TableCell): string => {
            return cell.text;
          });
        },
      );
    });
}

/*
 * The cell count of every line of every pipe table, as GitHub's table
 * readers split a line: at a "|" after an even number of backslashes.
 * Lines one after another belong to one table.
 */
function writtenTables(markdown: string): Array<Array<number>> {
  const tables: Array<Array<number>> = [];
  let current: Array<number> = [];

  for (const line of markdown.split("\n")) {
    if (!(line.startsWith("| ") && line.endsWith(" |"))) {
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

describe("the security events guides' tables", () => {
  const loaded: LoadedGuides = loadGuides();
  const guides: Array<[string, Parameters<GuideModule["guideToMarkdown"]>[0]]> =
    [
      ["detection rules", loaded.detection.default],
      ["threat intel", loaded.threatIntel.default],
    ];

  test("the guides place their cells through markdownTableCell", () => {
    expect(loaded.placedCells.length).toBeGreaterThan(100);
  });

  test("every cell is placed byte for byte as escaping each pipe placed it", () => {
    for (const cell of loaded.placedCells) {
      expect([cell, MarkdownTableCellModule.markdownTableCell(cell)]).toEqual([
        cell,
        cell.split(PIPE).join(`${BACKSLASH}${PIPE}`),
      ]);
    }
  });

  test.each([0, 1])(
    "every row of every table of a guide has as many cells as its header (%p)",
    (index: number) => {
      const [name, guide] = guides[index]!;
      const tables: Array<Array<number>> = writtenTables(
        loaded.guide.guideToMarkdown(guide),
      );

      expect([name, tables.length > 0]).toEqual([name, true]);

      for (const counts of tables) {
        for (const count of counts) {
          expect([name, count]).toEqual([name, counts[0]]);
        }
      }
    },
  );

  test("each Sigma modifier's example, pipe and all, stays in its own cell", () => {
    const modifierTable: Array<Array<string>> | undefined = tablesIn(
      loaded.guide.guideToMarkdown(loaded.detection.default),
    ).find((table: Array<Array<string>>): boolean => {
      return table[0]!.join(" ") === "Modifier What it does Example";
    });

    expect(modifierTable).toBeDefined();
    expect(
      modifierTable!.slice(1).map((row: Array<string>): string => {
        return row[2]!;
      }),
    ).toEqual(
      loaded.detection.SIGMA_MODIFIER_DOCS.map(
        (doc: { example: string }): string => {
          return `\`${doc.example}\``;
        },
      ),
    );
  });
});

describe("markdownTable", () => {
  const { markdownTable } = loadGuides().guide;

  test("writes a table as it always has", () => {
    expect(
      markdownTable(
        ["Modifier", "Example"],
        [["`contains`", "`CommandLine|contains: 'x'`"]],
      ),
    ).toBe(
      "| Modifier | Example |\n| --- | --- |\n| `contains` | `CommandLine\\|contains: 'x'` |",
    );
  });

  test("keeps a cell's pipe in its column whatever backslashes come before it, and a line ending in its row", () => {
    const markdown: string = markdownTable(
      ["Pattern", "Next"],
      [
        ["C:\\|D:", "a"],
        ["C:\\\\|D:", "b"],
        ["ends in \\", "c"],
        ["two\nlines", "d"],
        ["\\|already escaped", "e"],
      ],
    );

    expect(writtenTables(markdown)).toEqual([[2, 2, 2, 2, 2, 2, 2]]);
    expect(
      tablesIn(markdown)[0]!
        .slice(1)
        .map((row: Array<string>): string => {
          return row[1]!;
        }),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });
});
