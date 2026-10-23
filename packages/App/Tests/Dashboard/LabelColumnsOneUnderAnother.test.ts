import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY TABLE LISTS A ROW'S LABELS ONE UNDER ANOTHER.
 *
 * "Can you please show labels in a vertical view instead of a horizontal
 * view, just like we do for affected resources on an incident table? Please
 * do this for all tables across the project which has label column." - the
 * maintainer, on OneUptime issue #5187: the Monitors list drew a monitor's
 * labels side by side on the row's one line, and "2.SubCategory=Website",
 * "3.Item=Connectivity" and "4.Business System=Customer Mobile App" ran past
 * the column's edge, cut off mid-word.
 *
 * The shared LabelsElement (Common/UI/Components/Label/Labels) draws a
 * table cell's labels one under another, as Affected Resources lists its
 * resources (TableColumnListComponent), in natural order. So every table
 * gets the look by drawing its labels through it. This guard reads every
 * table the Dashboard declares - a list of column objects given as
 * `columns={[...]}`, `columns: [...]` or a `...Columns` constant - and holds
 * each column that lists labels (one whose field is `labels` or ends in
 * `Labels`, or titled "Labels") to it: the column's element is a
 * LabelsElement, or one of the few cells that put a sentence before one
 * (a permission's scope, a monitor secret's access) and draw their labels
 * with LabelsElement themselves - never a row of pills of its own.
 *
 * How LabelsElement lays a cell out is tested in Common/Tests/UI/Components/
 * Table/TableLabels; how a browser draws it, in the Tables offline suite
 * (packages/E2E/ModelTables).
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
  path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// The element that draws a record's labels, one under another in a table.
const LABELS_ELEMENT: string = "LabelsElement";

/*
 * Cells that say something first and then draw the row's labels with
 * LabelsElement themselves, and where each lives - read below, so a cell
 * that stops drawing them so fails here too.
 */
const CELLS_THAT_DRAW_LABELS_ELEMENT: Record<string, string> = {
  PermissionScopeCell: "Components/Permission/PermissionScopeCell.tsx",
  MonitorSecretAccessElement:
    "Components/MonitorSecret/MonitorSecretAccessElement.tsx",
};

// A constant that holds a table's columns: `const columns`, `alertColumns`.
const COLUMNS_NAME: RegExp = /columns$/i;

// A field that holds a record's labels: `labels`, `alertLabels`, ...
const LABELS_FIELD: RegExp = /^(labels|[a-z][A-Za-z]*Labels)$/;

// The components a column's element draws: `<LabelsElement`, `<Pill`.
const JSX_COMPONENT: RegExp = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;

// Cheap first pass: only a file that names labels is parsed.
const LABELS_MENTION: RegExp = /[lL]abels/;

interface LabelColumn {
  file: string;
  line: number;
  title: string | null;
  fields: Array<string>;
  // The components its element draws, in order.
  draws: Array<string>;
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
): ts.Node | null {
  for (const member of object.properties) {
    if (ts.isPropertyAssignment(member) && propertyName(member.name) === name) {
      return member.initializer;
    }

    if (ts.isMethodDeclaration(member) && propertyName(member.name) === name) {
      return member;
    }
  }

  return null;
}

function textOf(node: ts.Node | null): string | null {
  if (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  ) {
    return node.text;
  }

  return null;
}

function fieldsOf(node: ts.Node | null): Array<string> {
  if (!node || !ts.isObjectLiteralExpression(node)) {
    return [];
  }

  const fields: Array<string> = [];

  for (const member of node.properties) {
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

function componentsDrawnBy(
  source: ts.SourceFile,
  node: ts.Node | null,
): Array<string> {
  if (!node) {
    return [];
  }

  return Array.from(node.getText(source).matchAll(JSX_COMPONENT)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

function isLabelsColumn(title: string | null, fields: Array<string>): boolean {
  return (
    title === "Labels" ||
    fields.some((field: string): boolean => {
      return LABELS_FIELD.test(field);
    })
  );
}

// Every column that lists labels, in every table a file declares.
function labelColumnsIn(fileName: string, text: string): Array<LabelColumn> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const columns: Array<LabelColumn> = [];

  const consider: (list: ts.Node | undefined) => void = (
    list: ts.Node | undefined,
  ): void => {
    if (!list || !ts.isArrayLiteralExpression(list)) {
      return;
    }

    for (const element of list.elements) {
      if (!ts.isObjectLiteralExpression(element)) {
        continue;
      }

      const field: ts.Node | null = property(element, "field");
      const title: string | null = textOf(property(element, "title"));
      const fields: Array<string> = fieldsOf(field);

      // A column object has a field and a title; a filter has no element.
      if (!field || !property(element, "getElement")) {
        continue;
      }

      if (!isLabelsColumn(title, fields)) {
        continue;
      }

      columns.push({
        file: relative(fileName),
        line:
          source.getLineAndCharacterOfPosition(element.getStart(source)).line +
          1,
        title: title,
        fields: fields,
        draws: componentsDrawnBy(source, property(element, "getElement")),
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
      consider(node.initializer.expression);
    } else if (
      ts.isPropertyAssignment(node) &&
      propertyName(node.name) === "columns"
    ) {
      consider(node.initializer);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      COLUMNS_NAME.test(node.name.text)
    ) {
      consider(node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return columns;
}

function drawsLabelsElement(column: LabelColumn): boolean {
  return column.draws.some((component: string): boolean => {
    return (
      component === LABELS_ELEMENT ||
      Object.keys(CELLS_THAT_DRAW_LABELS_ELEMENT).includes(component)
    );
  });
}

function dashboardLabelColumns(): Array<LabelColumn> {
  const columns: Array<LabelColumn> = [];

  for (const directory of SCAN_DIRS) {
    for (const file of listSourceFiles(directory)) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!LABELS_MENTION.test(text)) {
        continue;
      }

      columns.push(...labelColumnsIn(file, text));
    }
  }

  return columns;
}

const LABEL_COLUMNS: Array<LabelColumn> = dashboardLabelColumns();

function describeColumn(column: LabelColumn): string {
  return `${column.file}:${column.line} "${column.title || ""}" (${column.fields.join(
    ", ",
  )}) draws ${column.draws.join(", ") || "nothing of its own"}`;
}

describe("every table lists a row's labels one under another", () => {
  /*
   * An invariant over an empty set holds for the wrong reason: the lists of
   * the issue have to be among those read.
   */
  test("reads the Monitors list of the issue and every other list with a Labels column", () => {
    const files: Array<string> = LABEL_COLUMNS.map(
      (column: LabelColumn): string => {
        return column.file;
      },
    );

    for (const list of [
      "packages/App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/StatusPages.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runbooks.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Host/Hosts.tsx",
    ]) {
      expect(files).toContain(list);
    }

    // Some sixty lists across the product have one.
    expect(LABEL_COLUMNS.length).toBeGreaterThanOrEqual(60);
  });

  test("each draws its labels with LabelsElement, never a row of pills of its own", () => {
    const sideBySide: Array<string> = LABEL_COLUMNS.filter(
      (column: LabelColumn): boolean => {
        return !drawsLabelsElement(column);
      },
    ).map(describeColumn);

    expect(sideBySide).toEqual([]);
  });

  test("the cells that put a sentence before the labels draw the labels with LabelsElement themselves", () => {
    for (const [component, file] of Object.entries(
      CELLS_THAT_DRAW_LABELS_ELEMENT,
    )) {
      const text: string = fs.readFileSync(
        path.join(DASHBOARD_SRC_DIR, file),
        "utf8",
      );

      expect([component, text.includes(`<${LABELS_ELEMENT}`)]).toEqual([
        component,
        true,
      ]);
      expect([
        component,
        text.includes('from "Common/UI/Components/Label/Labels"'),
      ]).toEqual([component, true]);
    }
  });

  test("the guard catches a list that draws a row's labels side by side", () => {
    const before: string = `
const MonitorTable = () => {
  return (
    <ModelTable<Monitor>
      columns={[
        { field: { name: true }, title: "Name", type: FieldType.Text },
        {
          field: { labels: { name: true, color: true } },
          title: "Labels",
          type: FieldType.EntityArray,
          getElement: (item: Monitor): ReactElement => {
            return (
              <div className="flex flex-nowrap gap-1.5">
                {(item.labels || []).map((label: Label) => {
                  return <Pill key={label.id} text={label.name} color={label.color} />;
                })}
              </div>
            );
          },
        },
      ]}
    />
  );
};
`;

    const columns: Array<LabelColumn> = labelColumnsIn("Before.tsx", before);

    expect(columns).toHaveLength(1);
    expect(columns.filter(drawsLabelsElement)).toEqual([]);
    expect(columns[0]!.draws).toEqual(["Pill"]);

    const after: Array<LabelColumn> = labelColumnsIn(
      "After.tsx",
      before.replace(
        "<Pill key={label.id} text={label.name} color={label.color} />",
        "<LabelsElement labels={item.labels || []} />",
      ),
    );

    expect(after.filter(drawsLabelsElement)).toHaveLength(1);
  });

  test("a filter or a form field named Labels is no column", () => {
    const columns: Array<LabelColumn> = labelColumnsIn(
      "Filters.tsx",
      `
const filters = <ModelTable
  filters={[
    { field: { labels: true }, title: "Labels", type: FieldType.EntityArray },
  ]}
  columns={[{ field: { name: true }, title: "Name", type: FieldType.Text }]}
/>;
`,
    );

    expect(columns).toEqual([]);
  });
});
