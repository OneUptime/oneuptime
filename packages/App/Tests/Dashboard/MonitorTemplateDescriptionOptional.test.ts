import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A monitor template's description is optional. The name usually says what
 * a template is for ("Production API Health"), and the create form asked
 * for a description every time - required, at least two characters - with
 * "Description of the Monitor Template" under it. Now both forms that write
 * it (Monitors > Settings > Templates, and a template's Edit Template Info)
 * leave it to whoever has something to say: not required, no minimum length
 * (a field that may be left blank has no business refusing one character),
 * and no API wording under it. The column is nullable to match
 * (MakeMonitorTemplateDescriptionOptional1807820000000), and the template's
 * page says "No description" for one without.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const FORMS: Array<string> = [
  "Pages/Monitor/Settings/MonitorTemplates.tsx",
  "Pages/Monitor/Settings/MonitorTemplatesView.tsx",
];

function parse(relative: string): ts.SourceFile {
  const file: string = path.join(DASHBOARD_SRC, relative);

  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

/*
 * The object literals a file describes the template description with: a
 * form field ({ field: { templateDescription: true }, fieldType: ... }) or a
 * detail field ({ field: ..., fieldType: FieldType.LongText }).
 */
function templateDescriptionFields(
  source: ts.SourceFile,
): Array<ts.ObjectLiteralExpression> {
  const found: Array<ts.ObjectLiteralExpression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const field: ts.PropertyAssignment | undefined = propertyNamed(
        node,
        "field",
      );

      if (
        field &&
        ts.isObjectLiteralExpression(field.initializer) &&
        propertyNamed(field.initializer, "templateDescription") &&
        field.initializer.properties.length === 1
      ) {
        found.push(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function isFormField(literal: ts.ObjectLiteralExpression): boolean {
  const fieldType: ts.PropertyAssignment | undefined = propertyNamed(
    literal,
    "fieldType",
  );

  return Boolean(
    fieldType &&
      fieldType.initializer.getText().startsWith("FormFieldSchemaType."),
  );
}

describe("a monitor template's description is optional", () => {
  test("the model column is neither required nor NOT NULL", () => {
    const template: MonitorTemplate = new MonitorTemplate();

    expect(template.getRequiredColumns().columns).not.toContain(
      "templateDescription",
    );
    expect(template.getRequiredColumns().columns).toContain("templateName");
  });

  test.each(FORMS)(
    "%s asks for it without requiring it",
    (relative: string) => {
      const fields: Array<ts.ObjectLiteralExpression> =
        templateDescriptionFields(parse(relative)).filter(isFormField);

      expect(fields).toHaveLength(1);

      const field: ts.ObjectLiteralExpression = fields[0]!;

      expect(propertyNamed(field, "required")?.initializer.getText()).toBe(
        "false",
      );
      // A field that may be left blank sets no minimum length.
      expect(propertyNamed(field, "validation")).toBeUndefined();
      // Its title and placeholder say it; the column's API wording is off.
      expect(
        propertyNamed(field, "hideColumnDescription")?.initializer.getText(),
      ).toBe("true");
      expect(propertyNamed(field, "placeholder")?.initializer.getText()).toBe(
        '"What is this template for?"',
      );
    },
  );

  test("the template's page says when it has none", () => {
    const details: Array<ts.ObjectLiteralExpression> =
      templateDescriptionFields(
        parse("Pages/Monitor/Settings/MonitorTemplatesView.tsx"),
      ).filter((literal: ts.ObjectLiteralExpression): boolean => {
        return !isFormField(literal);
      });

    expect(details).toHaveLength(1);
    expect(
      propertyNamed(details[0]!, "placeholder")?.initializer.getText(),
    ).toBe('"No description"');
  });
});
