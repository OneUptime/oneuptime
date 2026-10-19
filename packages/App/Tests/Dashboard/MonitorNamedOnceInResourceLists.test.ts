import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A list names a row's monitor once.
 *
 * The maintainer, on the alerts list: "why do we have a monitors column when
 * we have monitors in the affected resources anyway? You can remove them in
 * the UI". Every row of an alert raised by a monitor named that monitor
 * twice, side by side: in a Monitor column, and first in Affected Resources.
 * The Monitor column went.
 *
 * This guard reads every table the Dashboard declares - a list of column
 * objects given as `columns={[...]}`, `columns: [...]` or a `...Columns`
 * constant - and holds two rules wherever a table has an Affected Resources
 * column ("Affected Resources" on alerts, "Resources Affected" on incidents
 * and scheduled maintenance):
 *
 *   1. that column lists the monitors: it declares `monitor` or `monitors`
 *      among its fields, so a row names its monitor there;
 *   2. no other column of the table is a Monitor column: one titled after
 *      the monitor ("Monitor", "Monitors", "Monitor Affected", ...) or one
 *      whose own field is `monitor` or `monitors`.
 *
 * A list with no Affected Resources column may give the monitor a column of
 * its own - nothing repeats there.
 *
 * What the alerts list draws is tested in Common/Tests/App/Dashboard/
 * AlertsTableAffectedResources; how a browser draws it in the Tables offline
 * suite (packages/E2E/ModelTables).
 */

const APP_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(APP_DIR, "..", "..");
const DASHBOARD_SRC_DIR: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * The App Test job deletes ee/ before it runs, so there only the core
 * Dashboard is read; with ee/ present its Dashboard is read too.
 */
const SCAN_DIRS: Array<string> = [
  DASHBOARD_SRC_DIR,
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

const AFFECTED_RESOURCES_TITLES: Array<string> = [
  "Affected Resources",
  "Resources Affected",
];

// The fields that hold a row's monitor: Alert.monitor, Incident.monitors.
const MONITOR_FIELDS: Array<string> = ["monitor", "monitors"];

// A title that names the monitor: "Monitor", "Monitors Affected", ...
const MONITOR_TITLE: RegExp = /^(affected\s+)?monitors?(\s+affected)?$/i;

// A constant that holds a table's columns: `const columns`, `alertColumns`.
const COLUMNS_NAME: RegExp = /columns$/i;

// Cheap first pass: only a file that names one is parsed.
const AFFECTED_MENTION: RegExp = /Affected Resources|Resources Affected/;

const WHITESPACE_RUN: RegExp = /\s+/g;

interface DeclaredColumn {
  title: string | null;
  fields: Array<string>;
  line: number;
}

interface DeclaredTable {
  file: string;
  line: number;
  columns: Array<DeclaredColumn>;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

// A file of the repository by its path from the root; a written one as named.
function relative(file: string): string {
  if (!path.isAbsolute(file)) {
    return file;
  }

  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function propertyName(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const member of object.properties) {
    if (
      ts.isPropertyAssignment(member) &&
      propertyName(member.name) === name
    ) {
      return member.initializer;
    }
  }

  return null;
}

function textOf(expression: ts.Expression | null): string | null {
  if (
    expression &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
  ) {
    return expression.text;
  }

  return null;
}

// The keys a column's `field` declares, in order.
function fieldsOf(expression: ts.Expression | null): Array<string> {
  if (!expression || !ts.isObjectLiteralExpression(expression)) {
    return [];
  }

  const fields: Array<string> = [];

  for (const member of expression.properties) {
    if (
      (ts.isPropertyAssignment(member) ||
        ts.isShorthandPropertyAssignment(member)) &&
      propertyName(member.name)
    ) {
      fields.push(propertyName(member.name) as string);
    }
  }

  return fields;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/*
 * The column objects of a list, or null when the list holds none - a list
 * of anything else that happens to be called `columns`.
 */
function columnsOf(
  source: ts.SourceFile,
  list: ts.ArrayLiteralExpression,
): Array<DeclaredColumn> | null {
  const columns: Array<DeclaredColumn> = [];

  for (const element of list.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      continue;
    }

    const field: ts.Expression | null = property(element, "field");
    const title: ts.Expression | null = property(element, "title");

    if (!field || !title) {
      continue;
    }

    columns.push({
      title: textOf(title),
      fields: fieldsOf(field),
      line: lineOf(source, element),
    });
  }

  return columns.length > 0 ? columns : null;
}

// Every table a file declares.
function tablesIn(fileName: string, text: string): Array<DeclaredTable> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tables: Array<DeclaredTable> = [];

  const consider: (node: ts.Node, list: ts.Node | undefined) => void = (
    node: ts.Node,
    list: ts.Node | undefined,
  ): void => {
    if (!list || !ts.isArrayLiteralExpression(list)) {
      return;
    }

    const columns: Array<DeclaredColumn> | null = columnsOf(source, list);

    if (columns) {
      tables.push({
        file: relative(fileName),
        line: lineOf(source, node),
        columns: columns,
      });
    }
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "columns" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      consider(node, node.initializer.expression);
    } else if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "columns"
    ) {
      consider(node, node.initializer);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      COLUMNS_NAME.test(node.name.text)
    ) {
      consider(node, node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return tables;
}

function isAffectedResourcesColumn(column: DeclaredColumn): boolean {
  return Boolean(
    column.title && AFFECTED_RESOURCES_TITLES.includes(column.title),
  );
}

function isMonitorColumn(column: DeclaredColumn): boolean {
  return Boolean(
    (column.title && MONITOR_TITLE.test(column.title.trim())) ||
      (column.fields[0] && MONITOR_FIELDS.includes(column.fields[0])),
  );
}

function describeColumn(table: DeclaredTable, column: DeclaredColumn): string {
  return `${table.file}:${column.line} "${(column.title || "").replace(
    WHITESPACE_RUN,
    " ",
  )}" (${column.fields.join(", ")})`;
}

// Rule 1: an Affected Resources column that does not list the monitors.
function affectedResourcesWithoutMonitor(
  tables: Array<DeclaredTable>,
): Array<string> {
  const findings: Array<string> = [];

  for (const table of tables) {
    for (const column of table.columns.filter(isAffectedResourcesColumn)) {
      const listsMonitor: boolean = column.fields.some(
        (field: string): boolean => {
          return MONITOR_FIELDS.includes(field);
        },
      );

      if (!listsMonitor) {
        findings.push(describeColumn(table, column));
      }
    }
  }

  return findings;
}

// Rule 2: a Monitor column beside an Affected Resources column.
function monitorColumnsBesideAffectedResources(
  tables: Array<DeclaredTable>,
): Array<string> {
  const findings: Array<string> = [];

  for (const table of tables) {
    if (!table.columns.some(isAffectedResourcesColumn)) {
      continue;
    }

    for (const column of table.columns) {
      if (!isAffectedResourcesColumn(column) && isMonitorColumn(column)) {
        findings.push(describeColumn(table, column));
      }
    }
  }

  return findings;
}

function dashboardTables(): Array<DeclaredTable> {
  const tables: Array<DeclaredTable> = [];

  for (const directory of SCAN_DIRS) {
    for (const file of listSourceFiles(directory)) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!AFFECTED_MENTION.test(text)) {
        continue;
      }

      tables.push(...tablesIn(file, text));
    }
  }

  return tables;
}

const TABLES: Array<DeclaredTable> = dashboardTables();

const TABLES_WITH_AFFECTED_RESOURCES: Array<DeclaredTable> = TABLES.filter(
  (table: DeclaredTable): boolean => {
    return table.columns.some(isAffectedResourcesColumn);
  },
);

// The old alerts list, cut down to the two columns that repeated each other.
const ALERTS_LIST_BEFORE: string = `
const AlertsTable = () => {
  return (
    <ModelTable<Alert>
      columns={[
        { field: { title: true }, title: "Title", type: FieldType.Text },
        {
          field: { monitor: { name: true, _id: true } },
          title: "Monitor",
          type: FieldType.Entity,
        },
        {
          field: { hosts: { name: true }, monitor: { name: true } },
          title: "Affected Resources",
          type: FieldType.EntityArray,
        },
      ]}
    />
  );
};
`;

describe("a list names a row's monitor once", () => {
  /*
   * An invariant over an empty set holds for the wrong reason: the lists it
   * exists for have to be among those read.
   */
  test("reads the alerts, incidents and scheduled maintenance lists, each with its Affected Resources column", () => {
    const files: Array<string> = TABLES_WITH_AFFECTED_RESOURCES.map(
      (table: DeclaredTable): string => {
        return table.file;
      },
    );

    expect(files).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
      ]),
    );
  });

  test("every Affected Resources column lists the row's monitors", () => {
    expect(affectedResourcesWithoutMonitor(TABLES)).toEqual([]);
  });

  test("no list draws a Monitor column beside its Affected Resources", () => {
    expect(monitorColumnsBesideAffectedResources(TABLES)).toEqual([]);
  });

  test("the alerts list draws its Affected Resources, and no Monitor column", () => {
    const alerts: Array<DeclaredTable> = TABLES.filter(
      (table: DeclaredTable): boolean => {
        return table.file.endsWith("Components/Alert/AlertsTable.tsx");
      },
    );

    expect(alerts).toHaveLength(1);

    const titles: Array<string | null> = alerts[0]!.columns.map(
      (column: DeclaredColumn): string | null => {
        return column.title;
      },
    );

    expect(titles).toContain("Affected Resources");
    expect(
      alerts[0]!.columns.filter((column: DeclaredColumn): boolean => {
        return isMonitorColumn(column);
      }),
    ).toEqual([]);
  });
});

describe("the guard, on lists written for it", () => {
  test("finds the alerts list's Monitor column as it was, beside Affected Resources", () => {
    const tables: Array<DeclaredTable> = tablesIn(
      "AlertsTableBefore.tsx",
      ALERTS_LIST_BEFORE,
    );

    expect(tables).toHaveLength(1);
    expect(monitorColumnsBesideAffectedResources(tables)).toEqual([
      'AlertsTableBefore.tsx:7 "Monitor" (monitor)',
    ]);
    expect(affectedResourcesWithoutMonitor(tables)).toEqual([]);
  });

  test("finds a Monitor column by its field too, whatever its title", () => {
    const tables: Array<DeclaredTable> = tablesIn(
      "Renamed.tsx",
      `const listColumns = [
        { field: { monitors: { name: true } }, title: "Watched by", type: 1 },
        { field: { monitors: { name: true } }, title: "Resources Affected", type: 1 },
      ];`,
    );

    expect(monitorColumnsBesideAffectedResources(tables)).toEqual([
      'Renamed.tsx:2 "Watched by" (monitors)',
    ]);
  });

  test("finds an Affected Resources column that leaves the monitor out", () => {
    const tables: Array<DeclaredTable> = tablesIn(
      "NoMonitor.tsx",
      `const element = (
        <ModelTable
          columns={[
            { field: { hosts: { name: true }, services: { name: true } }, title: "Affected Resources", type: 1 },
          ]}
        />
      );`,
    );

    expect(affectedResourcesWithoutMonitor(tables)).toEqual([
      'NoMonitor.tsx:4 "Affected Resources" (hosts, services)',
    ]);
  });

  test("leaves a list with no Affected Resources column its Monitor column", () => {
    const tables: Array<DeclaredTable> = tablesIn(
      "AcrossProjects.tsx",
      `const page = {
        columns: [
          { field: { title: true }, title: "Title", type: 1 },
          { field: { monitor: { name: true } }, title: "Monitor Affected", type: 1 },
        ],
      };`,
    );

    expect(tables).toHaveLength(1);
    expect(monitorColumnsBesideAffectedResources(tables)).toEqual([]);
    expect(affectedResourcesWithoutMonitor(tables)).toEqual([]);
  });

  test("names the monitor's own titles, and nothing that merely mentions it", () => {
    const titled: (title: string) => boolean = (title: string): boolean => {
      return isMonitorColumn({ title: title, fields: ["name"], line: 1 });
    };

    expect(titled("Monitor")).toBe(true);
    expect(titled("Monitors")).toBe(true);
    expect(titled("Monitor Affected")).toBe(true);
    expect(titled("Monitors Affected")).toBe(true);
    expect(titled("Affected Monitors")).toBe(true);
    expect(titled("Monitor Status")).toBe(false);
    expect(titled("Monitor Type")).toBe(false);
    expect(titled("Affected Resources")).toBe(false);
  });
});
