import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  RECORD_NAME_ELEMENTS,
  scanTableNameColumns,
  TableNameColumn,
} from "../../../Helpers/TableNameColumnScan";

/*
 * EVERY TABLE COLUMN ON A RECORD'S NAME OR TITLE THAT DRAWS AN ELEMENT
 * SAYS WHICH WAY ITS LINE READS (#6657).
 *
 * A cell reads its line the way its words do when that is not the page's:
 * an English name on an Arabic or Persian page reads left to right, and a
 * long one is cut at its own end ("Checkout API lat..."), not at its start
 * ("...API latency"). A column that draws an element - a name drawn as a
 * link or a badge - gave the table no words, so 128 of the 129 name and
 * title columns kept the page's way: incidents, alerts and their episodes,
 * dashboards, status pages, services, the cloud and AI connections, the
 * settings lists.
 *
 * A column on a record's `name` or `title` now reads that field when it
 * names no words of its own (ColumnLineText's getElementLineText). That is
 * right for an element that draws the name and nothing else, and wrong for
 * one that lays out more - a logo beside the name, a badge's dot, a line of
 * the page's words under it - which one way for the whole cell turns
 * round. So every such column, in every front end and the enterprise
 * dashboards, either:
 *
 *   - sets getLineText: the words its one line shows (a computed name, a
 *     translated title), or drawsItsOwnLines, for an element that gives
 *     its name its own way itself (IsolatedLine, IsolatedText, a Pill);
 *   - or draws a NAME-ONLY element, which the default covers - the rule
 *     is read from the element's source (Tests/Helpers/TableNameColumnScan):
 *     holders of text and the record's own links, no flex box, no words
 *     but the row's field.
 *
 * The Common Test job deletes ee/ before it runs; the Enterprise Edition
 * Test workflow runs this guard again with ee/ present.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function scanTree(): Array<TableNameColumn> {
  const found: Array<TableNameColumn> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) {
        continue;
      }

      const source: string = fs.readFileSync(file, "utf8");

      // Cheap first: a module with no element column on a name has nothing.
      if (!source.includes("getElement")) {
        continue;
      }

      found.push(...scanTableNameColumns(source, relative(file)));
    }
  }

  return found;
}

const COLUMNS: Array<TableNameColumn> = scanTree();

function describeColumn(column: TableNameColumn): string {
  return `${column.file}:${column.line} (${column.field}): ${column.reason}`;
}

describe("every table column on a record's name or title that draws an element", () => {
  test("is found across the front ends (the scan reads them)", () => {
    // 127 on 2026-11-11 without ee/ (129 with it): a scan that finds none is broken.
    expect(COLUMNS.length).toBeGreaterThan(100);

    const files: Set<string> = new Set(
      COLUMNS.map((column: TableNameColumn): string => {
        return column.file;
      }),
    );

    expect(
      [...files].some((file: string): boolean => {
        return file.endsWith("Components/Incident/IncidentsTable.tsx");
      }),
    ).toBe(true);
    expect(
      [...files].some((file: string): boolean => {
        return file.includes("FeatureSet/AdminDashboard/");
      }),
    ).toBe(true);
  });

  test("says what its line reads, or draws its name and nothing else", () => {
    const unsaid: Array<string> = COLUMNS.filter(
      (column: TableNameColumn): boolean => {
        return !column.hasLineText && !column.isNameOnly;
      },
    ).map(describeColumn);

    expect(unsaid).toEqual([]);
  });

  test("each record link it may hand its row to is used by a column (no stale entry)", () => {
    const used: Set<string> = new Set<string>();

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        const source: string = fs.readFileSync(file, "utf8");

        for (const element of RECORD_NAME_ELEMENTS) {
          if (source.includes(`<${element} `)) {
            used.add(element);
          }
        }
      }
    }

    expect(
      RECORD_NAME_ELEMENTS.filter((element: string): boolean => {
        return !used.has(element);
      }),
    ).toEqual([]);
  });
});
