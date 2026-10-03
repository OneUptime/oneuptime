import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "Raw IDs move out of the main detail grids into a small copy line."
 *
 * Some thirty-five details cards led with the record's own ID - a full-width
 * UUID pill, usually the first field, above the record's name. The shared
 * Detail now takes a FieldType.ObjectID field on `_id` out of the grid and
 * draws it as one small "ID" line under the other fields, with a copy button
 * (Common/UI/Components/Detail/DetailIdLine.tsx). Pages declare the field
 * exactly as before, so a page written later gets the line by itself.
 *
 * This keeps it that way across every frontend that shares Detail - the
 * Dashboard, the Admin Dashboard and the enterprise dashboards - and fails
 * on:
 *
 *   1. a details field on the record's own `_id` drawn as anything but
 *      FieldType.ObjectID: with no type it is a raw UUID in the grid, which
 *      is how the incoming call policy page showed it;
 *   2. a page drawing the record's raw ID itself (a getElement field on
 *      `_id` titled "... ID");
 *   3. showIdAsField - the way a card keeps the ID as a field - anywhere but
 *      the cards below, each kept for a reason;
 *   4. the shared Detail no longer moving the ID (the rendering itself is
 *      tested in Common/Tests/UI/Components/Detail).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

/*
 * The App Test job deletes ee/ before it runs (core is the Community Edition
 * by construction), so there only the core cards are read. The Enterprise
 * Edition Test workflow (test.ee.yaml) runs this guard with ee/ present,
 * which is where the enterprise dashboards' cards are held to it.
 */
const ENTERPRISE_PRESENT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
);

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

/*
 * The cards whose point is the ID. Each keeps it as a field, and says why in
 * a comment beside showIdAsField. A new one belongs here only for a reason as
 * good as these.
 */
const ID_AS_FIELD: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Pages/Settings/ProjectSettings.tsx":
    "People come to Project Settings to copy the project ID.",
  "packages/App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorProbeView.tsx":
    "A custom probe is installed with its ID beside its key (PROBE_ID, PROBE_KEY).",
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView.tsx":
    "A Runner is installed with its ID beside its key (ONEUPTIME_RUNNER_ID, ONEUPTIME_RUNNER_KEY).",
};

// A title that names an ID: "Monitor ID", "ID".
const TITLED_AS_AN_ID: RegExp = /\bID$/;

interface IdField {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  title: string;
  // The fieldType initializer as written, "" when there is none.
  fieldType: string;
  hasGetElement: boolean;
  showIdAsField: boolean;
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
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    property.name &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  return null;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) && propertyName(property) === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

function hasMember(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return propertyName(property) === name;
    },
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

/*
 * `field: { _id: true }` (ModelDetail) or `key: "_id"` (Detail): a field that
 * reads the record's own ID and nothing else.
 */
function selectsOnlyTheRecordId(object: ts.ObjectLiteralExpression): boolean {
  const field: ts.PropertyAssignment | undefined = findProperty(
    object,
    "field",
  );

  if (field) {
    const select: ts.Expression = unwrap(field.initializer);

    return (
      ts.isObjectLiteralExpression(select) &&
      select.properties.length === 1 &&
      propertyName(select.properties[0]!) === "_id" &&
      ts.isPropertyAssignment(select.properties[0]!) &&
      (select.properties[0] as ts.PropertyAssignment).initializer.kind ===
        ts.SyntaxKind.TrueKeyword
    );
  }

  const key: ts.PropertyAssignment | undefined = findProperty(object, "key");

  return Boolean(
    key &&
      ts.isStringLiteral(unwrap(key.initializer)) &&
      (unwrap(key.initializer) as ts.StringLiteral).text === "_id",
  );
}

function scan(): {
  idFields: Array<IdField>;
  showIdAsFieldUses: Array<{ file: string; line: number }>;
} {
  const idFields: Array<IdField> = [];
  const showIdAsFieldUses: Array<{ file: string; line: number }> = [];

  const files: Array<string> = SCAN_DIRS.flatMap(
    (directory: string): Array<string> => {
      return listSourceFiles(directory);
    },
  );

  for (const file of files) {
    const text: string = fs.readFileSync(file, "utf8");

    // Cheap first pass: only files that could hold one are parsed.
    if (!text.includes("_id") && !text.includes("showIdAsField")) {
      continue;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const line: number =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

        const optOut: ts.PropertyAssignment | undefined = findProperty(
          node,
          "showIdAsField",
        );

        if (optOut) {
          showIdAsFieldUses.push({ file: relative(file), line });
        }

        const fieldType: ts.PropertyAssignment | undefined = findProperty(
          node,
          "fieldType",
        );
        const fieldTypeText: string = fieldType
          ? unwrap(fieldType.initializer).getText(source)
          : "";

        if (
          selectsOnlyTheRecordId(node) &&
          // A table column or a filter, which name their type `type`.
          !hasMember(node, "type") &&
          // A form field.
          !fieldTypeText.startsWith("FormFieldSchemaType")
        ) {
          const title: ts.PropertyAssignment | undefined = findProperty(
            node,
            "title",
          );
          const titleExpression: ts.Expression | undefined = title
            ? unwrap(title.initializer)
            : undefined;

          idFields.push({
            file: relative(file),
            line,
            title: titleExpression
              ? ts.isStringLiteral(titleExpression)
                ? titleExpression.text
                : titleExpression.getText(source)
              : "",
            fieldType: fieldTypeText,
            hasGetElement: hasMember(node, "getElement"),
            showIdAsField: Boolean(
              optOut &&
                unwrap(optOut.initializer).kind === ts.SyntaxKind.TrueKeyword,
            ),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return { idFields, showIdAsFieldUses };
}

const { idFields, showIdAsFieldUses } = scan();

function describeField(field: IdField): string {
  return `${field.file}:${field.line} "${field.title}" (${
    field.fieldType || "no fieldType"
  })`;
}

describe("the record's own ID on details cards", () => {
  test("the scan finds the cards it is about", () => {
    // Thirty-odd overview and settings cards, across all three dashboards.
    expect(idFields.length).toBeGreaterThanOrEqual(35);

    const titlesByFile: Array<string> = idFields.map(
      (field: IdField): string => {
        return `${field.file} ${field.title}`;
      },
    );

    expect(titlesByFile).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index.tsx Status Page ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx On-Call Policy ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index.tsx Incident ID",
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewDetailsCard.tsx Monitor ID",
        "packages/App/FeatureSet/Dashboard/src/Pages/Users/View/Index.tsx User ID",
        "packages/App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Index.tsx Project ID",
      ]),
    );
    // The Community Edition checkout has no ee/, and must still pass.
    expect(
      titlesByFile.includes(
        "ee/AdminDashboard/EnterpriseLicenses/Pages/View/Index.tsx License ID",
      ),
    ).toBe(ENTERPRISE_PRESENT);
  });

  test("is an ObjectID field, so Detail draws it on the ID line instead of the grid", () => {
    const rawIds: Array<string> = idFields
      .filter((field: IdField): boolean => {
        return !field.hasGetElement && field.fieldType !== "FieldType.ObjectID";
      })
      .map(describeField);

    expect(rawIds).toEqual([]);
  });

  test("is never drawn raw by the page itself", () => {
    const drawnByPage: Array<string> = idFields
      .filter((field: IdField): boolean => {
        return field.hasGetElement && TITLED_AS_AN_ID.test(field.title.trim());
      })
      .map(describeField);

    expect(drawnByPage).toEqual([]);
  });
});

describe("cards that keep the ID as a field", () => {
  test("are only the ones whose point is the ID", () => {
    const files: Array<string> = Array.from(
      new Set(
        showIdAsFieldUses.map((use: { file: string }): string => {
          return use.file;
        }),
      ),
    ).sort();

    expect(files).toEqual(Object.keys(ID_AS_FIELD).sort());
  });

  test("keep one field each, the record's own ID", () => {
    for (const file of Object.keys(ID_AS_FIELD)) {
      const uses: Array<{ file: string; line: number }> =
        showIdAsFieldUses.filter((use: { file: string }): boolean => {
          return use.file === file;
        });
      const kept: Array<IdField> = idFields.filter(
        (field: IdField): boolean => {
          return field.file === file && field.showIdAsField;
        },
      );

      expect({ file, uses: uses.length }).toEqual({ file, uses: 1 });
      expect({ file, kept: kept.length }).toEqual({ file, kept: 1 });
      expect(kept[0]!.fieldType).toBe("FieldType.ObjectID");
    }
  });

  test("say why, beside the flag", () => {
    for (const file of Object.keys(ID_AS_FIELD)) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_DIR, file),
        "utf8",
      );
      const flagAt: number = source.indexOf("showIdAsField: true");
      const commentEnd: number = source.lastIndexOf("*/", flagAt);
      const fieldStart: number = source.lastIndexOf("field:", flagAt);

      // A block comment between the field's start and the flag.
      expect({ file, explained: commentEnd > fieldStart }).toEqual({
        file,
        explained: true,
      });
    }
  });
});

describe("the shared Detail", () => {
  const detail: string = fs.readFileSync(
    path.join(
      PACKAGES_DIR,
      "Common",
      "UI",
      "Components",
      "Detail",
      "Detail.tsx",
    ),
    "utf8",
  );

  test("moves the record's ID to its ID line", () => {
    expect(detail).toContain(
      'import { getRecordIdText, isRecordIdField } from "./DetailRecordId";',
    );
    expect(detail).toContain('import DetailIdLine from "./DetailIdLine";');
    expect(detail).toMatch(/<DetailIdLine\s+recordId=\{recordId\}/);
  });
});
