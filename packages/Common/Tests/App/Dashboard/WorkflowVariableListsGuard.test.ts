import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";

/*
 * "Please remove the type column from this table. Pelase also remove it from
 * workflow variables table as well. We need to make UI simple for people to
 * understand." - the maintainer, on Workflows > Global Variables.
 *
 * Both lists are one shared table today (WorkflowVariablesTable). This guard
 * holds the rule for every table of workflow variables in every frontend -
 * the Dashboard, the other FeatureSet apps, Common/UI and ee - so a variables
 * list added later does not bring the type back: no column and no filter of
 * a ModelTable over WorkflowVariable reads the variable's type or grant
 * type, or is titled Type. A variable's type is shown on its own page.
 *
 * Its columns and filters must be written out in the table, where this can
 * read them; one built elsewhere fails here and asks for that. The scan is
 * checked to have found the shared table first, so a broken walk cannot
 * pass by finding nothing.
 */

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SHARED_TABLE: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariablesTable.tsx";

// The fields that say what kind of variable a row is.
const TYPE_FIELDS: Array<string> = ["variableType", "oauthGrantType"];

const MODEL_NAME: string = "WorkflowVariable";

// The attributes whose entries the viewer sees as a column or a filter.
const LISTED_ATTRIBUTES: Array<string> = ["columns", "filters"];

const TYPE_TITLE: RegExp = /\btype\b/i;

interface TableFacts {
  // Repository-relative, with "/".
  file: string;
  line: number;
  // "columns" or "filters" -> what each entry reads and is called.
  entries: Array<{
    attribute: string;
    fields: Array<string>;
    title: string | null;
  }>;
  // Attributes this guard could not read, with why.
  unreadable: Array<string>;
}

function toRepositoryPath(fileName: string): string {
  return path.relative(REPOSITORY_ROOT, fileName).split(path.sep).join("/");
}

function tagNameOf(
  node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
): string {
  return node.tagName.getText(sourceFile);
}

// <ModelTable<WorkflowVariable> ...> or <ModelTable modelType={WorkflowVariable}>.
function isWorkflowVariableTable(
  node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
): boolean {
  if (!tagNameOf(node, sourceFile).endsWith("ModelTable")) {
    return false;
  }

  const typeArguments: ReadonlyArray<ts.TypeNode> = node.typeArguments || [];

  if (
    typeArguments.some((typeArgument: ts.TypeNode): boolean => {
      return typeArgument.getText(sourceFile) === MODEL_NAME;
    })
  ) {
    return true;
  }

  return node.attributes.properties.some(
    (property: ts.JsxAttributeLike): boolean => {
      if (
        !ts.isJsxAttribute(property) ||
        property.name.getText(sourceFile) !== "modelType"
      ) {
        return false;
      }

      const initializer: ts.JsxAttributeValue | undefined =
        property.initializer;

      return Boolean(
        initializer &&
          ts.isJsxExpression(initializer) &&
          initializer.expression?.getText(sourceFile) === MODEL_NAME,
      );
    },
  );
}

function propertyNamed(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === name
      );
    },
  ) as ts.PropertyAssignment | undefined;
}

function readTable(
  node: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
): TableFacts {
  const facts: TableFacts = {
    file: toRepositoryPath(sourceFile.fileName),
    line:
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    entries: [],
    unreadable: [],
  };

  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property)) {
      continue;
    }

    const attribute: string = property.name.getText(sourceFile);

    if (!LISTED_ATTRIBUTES.includes(attribute)) {
      continue;
    }

    const expression: ts.Expression | undefined =
      property.initializer && ts.isJsxExpression(property.initializer)
        ? property.initializer.expression
        : undefined;

    if (!expression || !ts.isArrayLiteralExpression(expression)) {
      facts.unreadable.push(
        `${attribute} is not written out as a list in the table`,
      );
      continue;
    }

    for (const element of expression.elements) {
      if (!ts.isObjectLiteralExpression(element)) {
        facts.unreadable.push(
          `an entry of ${attribute} is not written out in the table: ${element.getText(sourceFile)}`,
        );
        continue;
      }

      const field: ts.PropertyAssignment | undefined = propertyNamed(
        element,
        "field",
        sourceFile,
      );
      const title: ts.PropertyAssignment | undefined = propertyNamed(
        element,
        "title",
        sourceFile,
      );

      const fields: Array<string> =
        field && ts.isObjectLiteralExpression(field.initializer)
          ? field.initializer.properties.map(
              (fieldProperty: ts.ObjectLiteralElementLike): string => {
                return ts.isSpreadAssignment(fieldProperty)
                  ? fieldProperty.getText(sourceFile)
                  : fieldProperty.name.getText(sourceFile);
              },
            )
          : [];

      if (field && !ts.isObjectLiteralExpression(field.initializer)) {
        facts.unreadable.push(
          `the field of an entry of ${attribute} is not written out: ${field.initializer.getText(sourceFile)}`,
        );
      }

      facts.entries.push({
        attribute,
        fields,
        title:
          title && ts.isStringLiteralLike(title.initializer)
            ? title.initializer.text
            : null,
      });
    }
  }

  return facts;
}

function scanWorkflowVariableTables(): Array<TableFacts> {
  const tables: Array<TableFacts> = [];

  for (const root of listScanRoots(REPOSITORY_ROOT)) {
    for (const fileName of listSourceFiles(root)) {
      if (!fileName.endsWith(".tsx")) {
        continue;
      }

      const text: string = fs.readFileSync(fileName, "utf8");

      if (!text.includes(MODEL_NAME) || !text.includes("ModelTable")) {
        continue;
      }

      const sourceFile: ts.SourceFile = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
          isWorkflowVariableTable(node, sourceFile)
        ) {
          tables.push(readTable(node, sourceFile));
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }
  }

  return tables;
}

const TABLES: Array<TableFacts> = scanWorkflowVariableTables();

describe("tables of workflow variables", () => {
  test("the scan finds the shared variables table, with its columns and filters", () => {
    const shared: Array<TableFacts> = TABLES.filter((table: TableFacts) => {
      return table.file === SHARED_TABLE;
    });

    expect(shared).toHaveLength(1);

    const columns: Array<string | null> = shared[0]!.entries
      .filter((entry: TableFacts["entries"][number]) => {
        return entry.attribute === "columns";
      })
      .map((entry: TableFacts["entries"][number]) => {
        return entry.title;
      });

    expect(columns).toEqual(["Name", "Description"]);
    expect(
      shared[0]!.entries.some((entry: TableFacts["entries"][number]) => {
        return entry.attribute === "filters";
      }),
    ).toBe(true);
  });

  test("write their columns and filters out where this guard can read them", () => {
    const unreadable: Array<string> = TABLES.flatMap((table: TableFacts) => {
      return table.unreadable.map((reason: string): string => {
        return `${table.file}:${table.line}: ${reason}`;
      });
    });

    expect(unreadable).toEqual([]);
  });

  test("have no Type column and no Type filter", () => {
    const offenders: Array<string> = TABLES.flatMap((table: TableFacts) => {
      return table.entries
        .filter((entry: TableFacts["entries"][number]): boolean => {
          return (
            entry.fields.some((field: string): boolean => {
              return TYPE_FIELDS.includes(field);
            }) || TYPE_TITLE.test(entry.title || "")
          );
        })
        .map((entry: TableFacts["entries"][number]): string => {
          return `${table.file}:${table.line}: ${entry.attribute} entry "${entry.title}" reads ${entry.fields.join(", ")}`;
        });
    });

    expect(offenders).toEqual([]);
  });
});
