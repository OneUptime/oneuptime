// UX rule: Docs/ux/README.md#lists
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * NO PAGE WRITES A DASH AS ITS WORDS FOR AN EMPTY VALUE (#7264).
 *
 * An empty table cell is the quiet dash (TableEmptyValue), and an empty
 * detail field the same dash (Detail/EmptyValue): light grey, read out as
 * "Not set". Some sixty table columns set `noValueMessage: "-"`, and a
 * score of detail fields `placeholder: "-"`. Those drew a hyphen of their
 * own - darker than the dash, with nothing for a screen reader - so one row
 * could show both marks for the same "nothing here" (the Workspace Logs'
 * Channel and User, #7116).
 *
 * TableRow (getTableNoValue) and EmptyValue now read a dash written there
 * as no words at all, and the lines that wrote one are gone: a dash is what
 * an empty value is already. A page that wants words writes words
 * ("Never", "No labels attached.").
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

const COMMON_UI: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "UI",
);

/*
 * An object property that is only a dash: `noValueMessage: "-",` or
 * `placeholder: "\u2014",` - as written or as an escape.
 */
const DASH_WORDS_PROPERTY: RegExp =
  /^\s*(noValueMessage|placeholder)\s*:\s*(["'`])\s*(-|\u2013|\u2014|\\u2013|\\u2014|\\u\{2013\}|\\u\{2014\})\s*\2\s*,?\s*$/;

// A line of a comment: a comment may name the rule.
const COMMENT_LINE: RegExp = /^\s*(\*|\/\*|\/\/)/;

interface DashWords {
  file: string;
  line: number;
  text: string;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

export function findDashWords(source: string, file: string): Array<DashWords> {
  const found: Array<DashWords> = [];
  const lines: Array<string> = source.split("\n");

  lines.forEach((line: string, index: number): void => {
    if (COMMENT_LINE.test(line)) {
      return;
    }

    if (DASH_WORDS_PROPERTY.test(line)) {
      found.push({ file: file, line: index + 1, text: line.trim() });
    }
  });

  return found;
}

function scanTree(): { files: number; found: Array<DashWords> } {
  const found: Array<DashWords> = [];
  let files: number = 0;

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const file of listSourceFiles(root)) {
      files++;
      found.push(
        ...findDashWords(fs.readFileSync(file, "utf8"), relative(file)),
      );
    }
  }

  return { files: files, found: found };
}

function readCommon(file: string): string {
  return fs.readFileSync(path.join(COMMON_UI, file), "utf8");
}

describe("a dash written as a page's words for an empty value", () => {
  test("is found by the scan, in every way one is written", () => {
    const lines: Array<string> = [
      '      noValueMessage: "-",',
      "      noValueMessage: '-',",
      '            noValueMessage: "\u2014",',
      '  noValueMessage: "\u2013"',
      '              placeholder: "-",',
      '    placeholder: "\\u2014",',
      '    noValueMessage: " - ",',
    ];

    expect(
      findDashWords(lines.join("\n"), "Example.tsx").map(
        (words: DashWords): number => {
          return words.line;
        },
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("words, a negative number, a comment and a JSX input's placeholder are not", () => {
    const lines: Array<string> = [
      '      noValueMessage: "Never",',
      '      noValueMessage: "-1",',
      '      noValueMessage: "--",',
      '      placeholder: "No description provided.",',
      '       * Deliberately NOT `noValueMessage: "-"`. A dash is exactly',
      '      // noValueMessage: "-",',
      '      <Input placeholder="-" />',
      '      title: "-",',
    ];

    expect(findDashWords(lines.join("\n"), "Example.tsx")).toEqual([]);
  });

  test("the scan reads the front ends, Common's UI among them", () => {
    const roots: Array<string> = listScanRoots(REPOSITORY_ROOT).map(relative);

    expect(roots).toContain("packages/App/FeatureSet/Dashboard/src");
    expect(roots).toContain("packages/App/FeatureSet/AdminDashboard/src");
    expect(roots).toContain("packages/Common/UI");
    // Thousands of modules: a scan that reads none is broken.
    expect(scanTree().files).toBeGreaterThan(1000);
  });

  test("is written nowhere: an empty value is the dash already", () => {
    expect(
      scanTree().found.map((words: DashWords): string => {
        return `${words.file}:${words.line}: ${words.text} - leave it out: an empty value is the quiet dash already (TableEmptyValue, Detail/EmptyValue).`;
      }),
    ).toEqual([]);
  });
});

describe("the components draw a dash written as words as the quiet dash", () => {
  test("a table's empty cell goes through getTableNoValue, which knows a dash", () => {
    const tableRow: string = readCommon("Components/Table/TableRow.tsx");
    const emptyValue: string = readCommon(
      "Components/Table/TableEmptyValue.tsx",
    );

    expect(tableRow).toContain(
      "return getTableNoValue(column.noValueMessage);",
    );
    // The words are drawn in one place, not again in the row.
    expect(tableRow).not.toContain('<span className="text-gray-500">');
    expect(emptyValue).toContain(
      "if (!noValueMessage?.trim() || isDashText(noValueMessage)) {",
    );
  });

  test("a detail card's empty field knows a dash placeholder", () => {
    expect(readCommon("Components/Detail/EmptyValue.tsx")).toContain(
      "if (props.placeholder?.trim() && !isDashText(props.placeholder)) {",
    );
  });

  test("attribute and custom field columns draw the table's empty value, not a '-' of their own", () => {
    for (const file of [
      "Components/ModelTable/AttributeColumns.tsx",
      "Components/ModelTable/CustomFieldColumns.tsx",
    ]) {
      const source: string = readCommon(file);

      expect([
        file,
        source.includes("getTableNoValue(data.noValueMessage)"),
      ]).toEqual([file, true]);
      expect([file, source.includes('?? "-"')]).toEqual([file, false]);
    }
  });
});
