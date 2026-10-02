import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Workflows > Global Variables and a workflow's Workflow Variables list show
 * a variable's Name and Description. The Type column went at the maintainer's
 * request ("We need to make UI simple for people to understand"), and a
 * variable's type is on its own page.
 *
 * The variables guide says what the list shows. This reads the list's
 * columns from the table's own source and holds the English guide to them,
 * so a column taken from or added to the list is not left misdescribed.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const TABLE_SOURCE: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariablesTable.tsx",
);

const GUIDE: string = fs.readFileSync(
  path.join(CONTENT_DIR, "en", "workflows", "variables.md"),
  "utf8",
);

const LIST_SENTENCE: RegExp = /The list shows each variable's ([^.]+)\./;

// The title of every column the variables table declares, in order.
function listColumnTitles(): Array<string> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    TABLE_SOURCE,
    fs.readFileSync(TABLE_SOURCE, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  const columnLists: Array<Array<string>> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sourceFile) === "columns" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isArrayLiteralExpression(node.initializer.expression)
    ) {
      const titles: Array<string> = [];

      for (const element of node.initializer.expression.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          continue;
        }

        for (const property of element.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile) === "title" &&
            ts.isStringLiteral(property.initializer)
          ) {
            titles.push(property.initializer.text);
          }
        }
      }

      columnLists.push(titles);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  // One table, with its columns written out where this can read them.
  expect(columnLists).toHaveLength(1);

  return columnLists[0]!;
}

// "Name" and "Description" -> "name and description".
function asProse(titles: Array<string>): string {
  const words: Array<string> = titles.map((title: string): string => {
    return title.toLowerCase();
  });

  if (words.length < 2) {
    return words.join("");
  }

  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function listSentence(): string {
  const match: RegExpMatchArray | null = GUIDE.match(LIST_SENTENCE);

  expect(match).not.toBeNull();

  return match![1]!;
}

describe("the variables guide on the variables list", () => {
  test("reads the list's columns from the table's source", () => {
    expect(listColumnTitles()).toEqual(["Name", "Description"]);
  });

  test("says the list shows exactly the columns the table has", () => {
    expect(listSentence()).toBe(asProse(listColumnTitles()));
  });

  test("says it once, and never that the list shows a variable's type", () => {
    expect(GUIDE.match(new RegExp(LIST_SENTENCE.source, "g"))).toHaveLength(1);
    expect(listSentence()).not.toMatch(/type/i);
    expect(GUIDE).not.toContain("name, type and description");
  });

  // The type did not vanish; it is one click away.
  test("says a variable's own page shows whether it is static or OAuth 2.0", () => {
    const start: number = GUIDE.indexOf("The list shows each variable's");
    const paragraph: string = GUIDE.slice(start, GUIDE.indexOf("\n", start));

    expect(paragraph).toContain("Click **View** on a row");
    expect(paragraph).toContain(
      "It shows whether the variable is static or OAuth 2.0",
    );
  });
});
