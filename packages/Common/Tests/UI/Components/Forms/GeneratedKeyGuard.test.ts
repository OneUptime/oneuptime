import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * "In all of these forms, we have this thing called a key, but it should
 * be automatically generated based on the name. If a human wants to edit
 * it, they can edit it as well, but please don't require an input from a
 * human ... Please do this everywhere else in the project where this is an
 * issue." - the maintainer, on the Create New Incident Measurement form.
 *
 * The columns below are made from the record's name by the server whenever
 * a create leaves them out. A form shows them with
 * getGeneratedKeyFormField (Common/UI/Components/Forms/Fields/
 * GeneratedKeyField): one line under the Name that follows it, with Edit.
 * This guard holds every form in every frontend to that:
 *
 *   - no hand-written form field asks for one of these columns on a Create
 *     form (an Edit-only field, doNotShowWhenCreating, is fine: a recording
 *     rule's output metric can be renamed later);
 *   - every getGeneratedKeyFormField is handed the shared function that
 *     makes the key (an identifier, like getMeasurementKeyFromName), so the
 *     key the form shows is the key the server makes - never a lambda of
 *     its own.
 *
 * A column a person must type on create, under one of these names, needs
 * an entry in TYPED_ON_CREATE_ALLOWED with the reason.
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

// Columns the server makes from the name when a create leaves them out.
export const SERVER_MADE_COLUMNS: ReadonlyArray<string> = [
  // IncidentMeasurement, AlertMeasurement, ScheduledMaintenanceMeasurement.
  "key",
  // MetricRecordingRule, TraceRecordingRule.
  "outputMetricName",
];

interface AllowedField {
  // Repository-relative path.
  file: string;
  column: string;
  reason: string;
}

export const TYPED_ON_CREATE_ALLOWED: Array<AllowedField> = [];

const FACTORY_NAME: string = "getGeneratedKeyFormField";

interface FoundField {
  file: string;
  line: number;
  column: string;
  editOnly: boolean;
}

interface FoundCall {
  file: string;
  line: number;
  column: string | null;
  nameField: string | null;
  makeKey: string | null;
  makeKeyIsIdentifier: boolean;
  /*
   * The column of the field written just before it in the form's list, or
   * null: the key's line reads as part of the field above it, so that has
   * to be the name it is made from.
   */
  previousFieldColumn: string | null;
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

// The one column a `field: { column: true }` selects, or null.
function selectedColumn(literal: ts.ObjectLiteralExpression): string | null {
  const field: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    "field",
  );

  if (!field || !ts.isObjectLiteralExpression(field.initializer)) {
    return null;
  }

  const properties: ts.NodeArray<ts.ObjectLiteralElementLike> =
    field.initializer.properties;

  if (properties.length !== 1) {
    return null;
  }

  const only: ts.ObjectLiteralElementLike = properties[0]!;

  if (
    !ts.isPropertyAssignment(only) ||
    only.initializer.kind !== ts.SyntaxKind.TrueKeyword ||
    !(ts.isIdentifier(only.name) || ts.isStringLiteral(only.name))
  ) {
    return null;
  }

  return only.name.text;
}

function isTrue(literal: ts.ObjectLiteralExpression, name: string): boolean {
  const property: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    name,
  );

  return Boolean(
    property && property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

interface ScanResult {
  fields: Array<FoundField>;
  calls: Array<FoundCall>;
  filesRead: number;
}

function scan(): ScanResult {
  const result: ScanResult = { fields: [], calls: [], filesRead: 0 };

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  for (const file of files) {
    const text: string = fs.readFileSync(file, "utf8");
    result.filesRead++;

    const mentionsColumn: boolean = SERVER_MADE_COLUMNS.some(
      (column: string): boolean => {
        return text.includes(column);
      },
    );

    if (!mentionsColumn && !text.includes(FACTORY_NAME)) {
      continue;
    }

    const sourceFile: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const relative: string = path.relative(REPOSITORY_ROOT, file);

    const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
      return (
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1
      );
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === FACTORY_NAME &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        const options: ts.ObjectLiteralExpression = node.arguments[0];
        const nameField: ts.PropertyAssignment | undefined = propertyNamed(
          options,
          "nameField",
        );
        const makeKey: ts.PropertyAssignment | undefined = propertyNamed(
          options,
          "makeKey",
        );

        let previousFieldColumn: string | null = null;

        if (ts.isArrayLiteralExpression(node.parent)) {
          const index: number = node.parent.elements.indexOf(node);
          const previous: ts.Expression | undefined =
            index > 0 ? node.parent.elements[index - 1] : undefined;

          if (previous && ts.isObjectLiteralExpression(previous)) {
            previousFieldColumn = selectedColumn(previous);
          }
        }

        result.calls.push({
          file: relative,
          line: lineOf(node),
          column: selectedColumn(options),
          nameField:
            nameField && ts.isStringLiteralLike(nameField.initializer)
              ? nameField.initializer.text
              : null,
          makeKey: makeKey ? makeKey.initializer.getText(sourceFile) : null,
          makeKeyIsIdentifier: Boolean(
            makeKey && ts.isIdentifier(makeKey.initializer),
          ),
          previousFieldColumn,
        });
      }

      /*
       * A hand-written form field: a field selector and a form fieldType of
       * its own. (A factory's options carry no fieldType; table columns and
       * filters have a type, and a detail card's fields a FieldType - the
       * probe and runner pages show their secret keys that way.)
       */
      const fieldType: ts.PropertyAssignment | undefined =
        ts.isObjectLiteralExpression(node)
          ? propertyNamed(node, "fieldType")
          : undefined;

      if (
        ts.isObjectLiteralExpression(node) &&
        fieldType &&
        fieldType.initializer
          .getText(sourceFile)
          .startsWith("FormFieldSchemaType.")
      ) {
        const column: string | null = selectedColumn(node);

        if (column && SERVER_MADE_COLUMNS.includes(column)) {
          result.fields.push({
            file: relative,
            line: lineOf(node),
            column,
            editOnly: isTrue(node, "doNotShowWhenCreating"),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return result;
}

describe("keys made from the name", () => {
  const found: ScanResult = scan();

  test("the scan reads every frontend and finds the forms, so the checks below are not vacuous", () => {
    expect(found.filesRead).toBeGreaterThan(1000);

    expect(
      found.calls
        .map((call: FoundCall): string => {
          return `${call.file} :: ${call.column}`;
        })
        .sort(),
    ).toEqual(
      [
        "packages/App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertMeasurements.tsx :: key",
        "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentMeasurements.tsx :: key",
        "packages/App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/RecordingRules.tsx :: outputMetricName",
        "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMeasurements.tsx :: key",
        "packages/App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules.tsx :: outputMetricName",
      ].sort(),
    );
  });

  test("no Create form asks a person to type one", () => {
    const allowed: Set<string> = new Set<string>(
      TYPED_ON_CREATE_ALLOWED.map((entry: AllowedField): string => {
        return `${entry.file} :: ${entry.column}`;
      }),
    );

    expect(
      found.fields
        .filter((field: FoundField): boolean => {
          return (
            !field.editOnly && !allowed.has(`${field.file} :: ${field.column}`)
          );
        })
        .map((field: FoundField): string => {
          return `${field.file}:${field.line} asks for "${field.column}" on create - use ${FACTORY_NAME}`;
        }),
    ).toEqual([]);
  });

  test("a hand-written field for one is only ever on an Edit form", () => {
    // The recording rules' output metric, which can be renamed later.
    expect(
      found.fields
        .map((field: FoundField): string => {
          return `${field.file} :: ${field.column} :: ${
            field.editOnly ? "edit only" : "create"
          }`;
        })
        .sort(),
    ).toEqual(
      [
        "packages/App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/RecordingRules.tsx :: outputMetricName :: edit only",
        "packages/App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules.tsx :: outputMetricName :: edit only",
      ].sort(),
    );
  });

  test("every form makes the key with the server's own function, from the name", () => {
    for (const call of found.calls) {
      expect({
        at: `${call.file}:${call.line}`,
        makeKeyIsIdentifier: call.makeKeyIsIdentifier,
        nameField: call.nameField,
      }).toEqual({
        at: `${call.file}:${call.line}`,
        makeKeyIsIdentifier: true,
        nameField: "name",
      });
    }

    expect(
      Array.from(
        new Set(
          found.calls.map((call: FoundCall): string | null => {
            return call.makeKey;
          }),
        ),
      ).sort(),
    ).toEqual(["getMeasurementKeyFromName", "getOutputMetricNameFromRuleName"]);
  });

  /*
   * The key is one line drawn up under the field before it, so that field
   * has to be the name it follows - under a Description it reads as part of
   * the description (the recording rule forms had it there at first).
   */
  test("every key comes right after the name it is made from", () => {
    for (const call of found.calls) {
      expect({
        at: `${call.file}:${call.line}`,
        fieldBefore: call.previousFieldColumn,
      }).toEqual({
        at: `${call.file}:${call.line}`,
        fieldBefore: call.nameField,
      });
    }
  });

  test("every allowed exception still exists and says why", () => {
    for (const entry of TYPED_ON_CREATE_ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(
        found.fields.some((field: FoundField): boolean => {
          return field.file === entry.file && field.column === entry.column;
        }),
      ).toBe(true);
    }
  });
});
