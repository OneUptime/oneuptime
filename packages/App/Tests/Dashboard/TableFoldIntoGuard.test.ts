import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * Where a list does not fit its card, the shared table folds the columns a
 * page marks foldable (Column.hideBelowLargeScreen), each value drawn under
 * the column its page names (Column.foldInto): an incident's severity under
 * its state, its labels and owners under its title (TableFit,
 * TableFoldedValues).
 *
 * A name that names no column folds nothing wrong to the eye - the value
 * goes under the row's first column instead, so it is never lost - which
 * is exactly why it would go unseen: the severity under the incident's
 * number. So every foldInto must name a column of the same list, by its id,
 * its key or its field; and only a column the table may fold says where it
 * folds to.
 *
 * An infrastructure list (ResourceTable) folds the same way: a
 * ResourceColumn that names where it folds to is folded by the table itself
 * (ResourceTable marks it hideBelowLargeScreen), and may name one of the
 * table's own columns - the resource's name, its status, its CPU - by its
 * key, as well as another column of its list.
 *
 * The App suite runs in plain Node with no renderer, so this reads the
 * sources, comments stripped.
 */

const FEATURE_SETS: string = path.join(__dirname, "..", "..", "FeatureSet");

const FOLD_INTO: RegExp = /foldInto:\s*"([^"]+)"/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;
// A column the table may fold, just before where it says it folds to.
const FOLDABLE_JUST_BEFORE: RegExp = /hideBelowLargeScreen:\s*true,\s*$/;

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function sourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "build") {
        continue;
      }

      found.push(...sourceFiles(full));
    } else if (SOURCE_FILE_NAME.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

const RESOURCE_TABLE: string = path.join(
  FEATURE_SETS,
  "Dashboard",
  "src",
  "Components",
  "Infrastructure",
  "ResourceTable.tsx",
);
const KEY: RegExp = /\bkey:\s*"([^"]+)"/g;
const RESOURCE_TABLE_IMPORT: RegExp =
  /\bResourceColumn\b[\s\S]*?from "[^"]*Infrastructure\/ResourceTable";/;

// ResourceTable's own columns, by key: what a ResourceColumn may fold into.
function resourceTableKeys(): Array<string> {
  const code: string = stripComments(fs.readFileSync(RESOURCE_TABLE, "utf8"));

  return Array.from(code.matchAll(KEY)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// Whether a source builds the ResourceColumns of a ResourceTable list.
function isResourceTableList(code: string): boolean {
  return RESOURCE_TABLE_IMPORT.test(code);
}

interface FoldUse {
  file: string;
  target: string;
  // The code just before it, back to the end of the line before.
  before: string;
  code: string;
}

function foldUses(): Array<FoldUse> {
  const uses: Array<FoldUse> = [];

  for (const file of sourceFiles(FEATURE_SETS)) {
    const raw: string = fs.readFileSync(file, "utf8");

    if (!raw.includes("foldInto")) {
      continue;
    }

    const code: string = stripComments(raw);

    for (const match of Array.from(code.matchAll(FOLD_INTO))) {
      const at: number = match.index || 0;

      uses.push({
        file: path.relative(FEATURE_SETS, file),
        target: match[1]!,
        before: code.slice(Math.max(0, at - 200), at),
        code: code,
      });
    }
  }

  return uses;
}

// Whether the list in this source has a column the name names.
function namesAColumn(code: string, target: string): boolean {
  const name: string = escapeRegExp(target);

  return [
    new RegExp(`\\bid:\\s*"${name}"`),
    new RegExp(`\\bkey:\\s*"${name}"`),
    new RegExp(`\\bfield:\\s*\\{\\s*${name}\\s*:`),
  ].some((pattern: RegExp): boolean => {
    return pattern.test(code);
  });
}

describe("every folded column says where its value goes, and it is a column of its list", () => {
  const uses: Array<FoldUse> = foldUses();

  test("every list that folds is found", () => {
    const files: Array<string> = Array.from(
      new Set(
        uses.map((use: FoldUse): string => {
          return use.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(
      expect.arrayContaining(
        [
          "Dashboard/src/Components/AISettings/AiRulesTable.tsx",
          "Dashboard/src/Components/Alert/AlertsTable.tsx",
          "Dashboard/src/Components/Host/HostFilesystemsTable.tsx",
          "Dashboard/src/Components/Incident/IncidentsTable.tsx",
          "Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
          "Dashboard/src/Components/VMware/VMwareResourceTables.tsx",
          "Dashboard/src/Pages/Runbook/Runners/Runners.tsx",
          "Dashboard/src/Pages/SecurityEvents/ThreatIntel.tsx",
        ].map((file: string): string => {
          return file.split("/").join(path.sep);
        }),
      ),
    );
  });

  test("each foldInto names a column of the same list: by its id, its key or its field", () => {
    const tableKeys: Array<string> = resourceTableKeys();
    const unnamed: Array<string> = uses
      .filter((use: FoldUse): boolean => {
        if (isResourceTableList(use.code) && tableKeys.includes(use.target)) {
          return false;
        }
        return !namesAColumn(use.code, use.target);
      })
      .map((use: FoldUse): string => {
        return `${use.file}: foldInto "${use.target}"`;
      });

    expect(unnamed).toEqual([]);
  });

  test("only a column the table may fold says where it folds to", () => {
    const notFoldable: Array<string> = uses
      .filter((use: FoldUse): boolean => {
        // A ResourceColumn is folded by its table (checked below).
        if (isResourceTableList(use.code)) {
          return false;
        }
        return !FOLDABLE_JUST_BEFORE.test(use.before);
      })
      .map((use: FoldUse): string => {
        return `${use.file}: foldInto "${use.target}"`;
      });

    expect(notFoldable).toEqual([]);
  });

  test("ResourceTable folds a ResourceColumn that says where it goes, and has the columns one may name", () => {
    const table: string = stripComments(
      fs.readFileSync(RESOURCE_TABLE, "utf8"),
    ).replace(/\s+/g, " ");

    expect(table).toContain(
      "...(col.foldInto ? { hideBelowLargeScreen: true, foldInto: col.foldInto,",
    );
    expect(resourceTableKeys()).toEqual(
      expect.arrayContaining(["name", "status", "cpuUtilization"]),
    );
    // The infrastructure lists that fold are found as lists of ResourceColumns.
    const resourceLists: Array<string> = uses
      .filter((use: FoldUse): boolean => {
        return isResourceTableList(use.code);
      })
      .map((use: FoldUse): string => {
        return use.file;
      });
    expect(resourceLists).toContain(
      [
        "Dashboard",
        "src",
        "Components",
        "VMware",
        "VMwareResourceTables.tsx",
      ].join(path.sep),
    );
  });

  test("the check itself: a name that names no column is caught, one that does is not", () => {
    const list: string = [
      "{ field: { currentIncidentState: { name: true } }, title: 'State' },",
      '{ id: "mount", key: "mountpoint", title: "Mount" },',
      '{ key: "owner", title: "Owner" },',
    ].join("\n");

    expect(namesAColumn(list, "currentIncidentState")).toBe(true);
    expect(namesAColumn(list, "mount")).toBe(true);
    expect(namesAColumn(list, "owner")).toBe(true);
    expect(namesAColumn(list, "currentIncidentStat")).toBe(false);
    expect(namesAColumn(list, "severity")).toBe(false);
  });
});
