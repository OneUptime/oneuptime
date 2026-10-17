import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Network product's descriptions stay short.
 *
 * "The description is too long as well, so can you please optimise that?
 * Please also do that for other places in the project where the description
 * is long." (the maintainer, on the discovery scan's five-line SNMP switch)
 *
 * The Network product's forms - devices, sites, discovery, auto import,
 * vendor templates, rules - had grown descriptions of three to six lines:
 * every edge case, every exception, the API's own wording. Each now says
 * what the field is for in a line or two, and this guard keeps it that way.
 * It reads the Dashboard's Network files' syntax and measures:
 *
 *   - every form field's description and section description, following a
 *     shared constant to its text, and every dialog's description: at most
 *     FIELD_LIMIT characters, two short lines under a label;
 *   - every list or card description: at most CARD_LIMIT characters, two
 *     lines across the page;
 *   - every form field that has NO description of its own: BasicModelForm
 *     then shows the model column's description, written for the API
 *     reference, so that is held to FIELD_LIMIT too.
 *
 * A longer sentence is not the fix for a field that needs explaining: the
 * page's help (helpContent) and the docs carry the detail.
 */

const FIELD_LIMIT: number = 150;
const CARD_LIMIT: number = 210;

// A TypeScript source file.
const SOURCE_FILE: RegExp = /\.tsx?$/;
// A call that marks an English key: translationKey(...), however imported.
const TRANSLATION_KEY_CALL: RegExp = /translationKey$/;
// A form field's fieldType, as opposed to a table column's FieldType.
const FORM_FIELD_TYPE: RegExp = /FormFieldSchemaType\./;
// Common's models, as the Dashboard imports them.
const COMMON_PREFIX: RegExp = /^Common\//;
// The switch the scan method's two cards replaced, and the help under it.
const OLD_SNMP_SWITCH: RegExp =
  /Check SNMP on hosts|turn (SNMP|it) off for a ping/i;

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_DIR: string = path.join(__dirname, "..", "..", "..", "Common");

// The Network product's Dashboard surfaces.
const NETWORK_ROOTS: Array<string> = [
  "Pages/NetworkDevice",
  "Pages/NetworkSite",
  "Components/NetworkDevice",
  "Components/NetworkSite",
  "Components/NetworkAutomation",
  "Components/Topology/AddNeighborToMonitoringModal.tsx",
];

type Kind = "field" | "section" | "dialog" | "card" | "column";

interface FoundText {
  kind: Kind;
  where: string;
  text: string;
}

function listFiles(root: string): Array<string> {
  const full: string = path.join(DASHBOARD_SRC, root);

  if (!fs.existsSync(full)) {
    return [];
  }

  if (fs.statSync(full).isFile()) {
    return [full];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      found.push(...listFiles(child));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(path.join(DASHBOARD_SRC, child));
    }
  }

  return found;
}

const parsed: Map<string, ts.SourceFile> = new Map<string, ts.SourceFile>();

function parse(file: string): ts.SourceFile {
  let sourceFile: ts.SourceFile | undefined = parsed.get(file);

  if (!sourceFile) {
    sourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    parsed.set(file, sourceFile);
  }

  return sourceFile;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
    return name.text;
  }

  return null;
}

// The module specifier a name is imported from, and the name it has there.
function findImport(
  file: string,
  name: string,
): { specifier: string; imported: string; isDefault: boolean } | null {
  for (const statement of parse(file).statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;
    const clause: ts.ImportClause = statement.importClause;

    if (clause.name && clause.name.text === name) {
      return { specifier, imported: "default", isDefault: true };
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.name.text === name) {
          return {
            specifier,
            imported: (element.propertyName || element.name).text,
            isDefault: false,
          };
        }
      }
    }
  }

  return null;
}

function resolveRelative(file: string, specifier: string): string | null {
  const base: string = path.resolve(path.dirname(file), specifier);

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findConstant(file: string, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (found) {
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(parse(file));

  return found;
}

/*
 * Every text an expression can show: a literal, a template, both branches of
 * a ternary or an ||, the argument of translationKey(...), and a constant -
 * this file's own or one imported from a relative module.
 */
function textsOf(
  file: string,
  node: ts.Node | undefined,
  depth: number,
): Array<string> {
  if (!node || depth > 8) {
    return [];
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }

  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return textsOf(file, node.expression, depth + 1);
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...textsOf(file, node.whenTrue, depth + 1),
      ...textsOf(file, node.whenFalse, depth + 1),
    ];
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...textsOf(file, node.left, depth + 1),
      ...textsOf(file, node.right, depth + 1),
    ];
  }

  if (ts.isCallExpression(node)) {
    if (TRANSLATION_KEY_CALL.test(node.expression.getText())) {
      return textsOf(file, node.arguments[0], depth + 1);
    }

    return [];
  }

  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    // options?.communityStringDescription and the like: a caller's text.
    return [];
  }

  if (ts.isIdentifier(node)) {
    const local: ts.Expression | null = findConstant(file, node.text);

    if (local) {
      return textsOf(file, local, depth + 1);
    }

    const imported: { specifier: string; imported: string } | null = findImport(
      file,
      node.text,
    );

    if (imported && imported.specifier.startsWith(".")) {
      const target: string | null = resolveRelative(file, imported.specifier);

      if (target) {
        const constant: ts.Expression | null = findConstant(
          target,
          imported.imported,
        );

        if (constant) {
          return textsOf(target, constant, depth + 1);
        }
      }
    }
  }

  return [];
}

function where(file: string, node: ts.Node): string {
  const { line } = parse(file).getLineAndCharacterOfPosition(node.getStart());

  return `${path.relative(DASHBOARD_SRC, file)}:${line + 1}`;
}

/*
 * The model a form field belongs to: the modelType of the nearest JSX
 * element around it (a ModelTable's, a ModelFormModal's, or a
 * CardModelDetail's modelDetailProps), as the identifier it is imported by.
 */
function modelOf(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      for (const attribute of current.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer) {
          continue;
        }

        const name: string = attribute.name.getText();

        if (
          !ts.isJsxExpression(attribute.initializer) ||
          !attribute.initializer.expression
        ) {
          continue;
        }

        const expression: ts.Expression = attribute.initializer.expression;

        if (name === "modelType" && ts.isIdentifier(expression)) {
          return expression.text;
        }

        if (
          name === "modelDetailProps" &&
          ts.isObjectLiteralExpression(expression)
        ) {
          for (const property of expression.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              propertyName(property.name) === "modelType" &&
              ts.isIdentifier(property.initializer)
            ) {
              return property.initializer.text;
            }
          }
        }
      }

      return null;
    }

    current = current.parent;
  }

  return null;
}

type ModelClass = new () => {
  getDisplayColumnDescriptionAs: (column: string) => string | null;
};

const models: Map<string, ModelClass | null> = new Map<
  string,
  ModelClass | null
>();

function loadModel(file: string, identifier: string): ModelClass | null {
  const imported: { specifier: string; isDefault: boolean } | null = findImport(
    file,
    identifier,
  );

  if (
    !imported ||
    !imported.isDefault ||
    !imported.specifier.startsWith("Common/Models/DatabaseModels/")
  ) {
    return null;
  }

  if (!models.has(imported.specifier)) {
    const modulePath: string = path.join(
      COMMON_DIR,
      imported.specifier.replace(COMMON_PREFIX, ""),
    );
    const loaded: { default?: ModelClass } = jest.requireActual(modulePath);
    models.set(imported.specifier, loaded.default || null);
  }

  return models.get(imported.specifier) || null;
}

function collect(): Array<FoundText> {
  const found: Array<FoundText> = [];

  for (const root of NETWORK_ROOTS) {
    for (const file of listFiles(root)) {
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          const properties: Map<string, ts.Expression> = new Map<
            string,
            ts.Expression
          >();

          for (const property of node.properties) {
            if (ts.isPropertyAssignment(property)) {
              const name: string | null = propertyName(property.name);

              if (name) {
                properties.set(name, property.initializer);
              }
            }
          }

          // A form field: it has a fieldType.
          if (properties.has("fieldType")) {
            for (const [key, kind] of [
              ["description", "field"],
              ["sectionDescription", "section"],
            ] as Array<[string, Kind]>) {
              for (const text of textsOf(file, properties.get(key), 0)) {
                found.push({ kind, where: where(file, node), text });
              }
            }

            const isFormField: boolean = FORM_FIELD_TYPE.test(
              properties.get("fieldType")!.getText(),
            );
            const field: ts.Expression | undefined = properties.get("field");

            if (
              isFormField &&
              !properties.has("description") &&
              field &&
              ts.isObjectLiteralExpression(field) &&
              field.properties[0] &&
              ts.isPropertyAssignment(field.properties[0])
            ) {
              const column: string | null = propertyName(
                field.properties[0].name,
              );
              const identifier: string | null = modelOf(node);
              const model: ModelClass | null = identifier
                ? loadModel(file, identifier)
                : null;
              const description: string | null =
                model && column
                  ? new model().getDisplayColumnDescriptionAs(column)
                  : null;

              if (description) {
                found.push({
                  kind: "column",
                  where: `${where(file, node)} (${identifier}.${column})`,
                  text: description,
                });
              }
            }
          }
        }

        if (ts.isJsxAttribute(node) && node.initializer) {
          const name: string = node.name.getText();
          const value: ts.Node | undefined = ts.isJsxExpression(
            node.initializer,
          )
            ? node.initializer.expression
            : node.initializer;

          if (name === "description" && !isEmptyState(node)) {
            for (const text of textsOf(file, value, 0)) {
              found.push({ kind: "dialog", where: where(file, node), text });
            }
          }

          if (
            name === "cardProps" &&
            value &&
            ts.isObjectLiteralExpression(value)
          ) {
            for (const property of value.properties) {
              if (
                ts.isPropertyAssignment(property) &&
                propertyName(property.name) === "description"
              ) {
                for (const text of textsOf(file, property.initializer, 0)) {
                  found.push({
                    kind: "card",
                    where: where(file, property),
                    text,
                  });
                }
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(parse(file));
    }
  }

  return found;
}

/*
 * An empty list's own explanation is not a form: it is read once, on a page
 * with nothing else on it, and the project-wide sweep of long descriptions
 * covers it. Everything else drawn with a description - a dialog, a
 * confirmation, a checkbox - is held to FIELD_LIMIT.
 */
const EMPTY_STATE_TAGS: ReadonlySet<string> = new Set<string>([
  "TableEmptyState",
  "EmptyState",
]);

function isEmptyState(attribute: ts.JsxAttribute): boolean {
  const element: ts.Node = attribute.parent.parent;

  return (
    (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) &&
    EMPTY_STATE_TAGS.has(element.tagName.getText())
  );
}

function limitOf(kind: Kind): number {
  return kind === "card" ? CARD_LIMIT : FIELD_LIMIT;
}

describe("the Network product's descriptions are short", () => {
  const found: Array<FoundText> = collect();

  function ofKind(kind: Kind): Array<FoundText> {
    return found.filter((item: FoundText): boolean => {
      return item.kind === kind;
    });
  }

  // A guard that reads nothing passes everything.
  test("reads the forms, the dialogs and the cards", () => {
    expect(ofKind("field").length).toBeGreaterThan(100);
    expect(ofKind("section").length).toBeGreaterThan(10);
    expect(ofKind("dialog").length).toBeGreaterThan(10);
    expect(ofKind("card").length).toBeGreaterThan(20);
    expect(ofKind("column").length).toBeGreaterThan(10);

    const texts: Array<string> = found.map((item: FoundText): string => {
      return item.text;
    });

    // A literal, a shared constant, and a translationKey constant.
    expect(texts).toContain("Left empty, the scan list shows the scan target.");
    expect(texts).toContain(
      "Probe is the normal choice: a device with no SNMP credentials is simply pinged. Pick Bound monitor only when no probe can reach it.",
    );
    expect(texts).toContain("You can change this at any time.");
  });

  test.each(["field", "section", "dialog", "column"] as Array<Kind>)(
    "every %s description fits two short lines",
    (kind: Kind) => {
      const tooLong: Array<string> = ofKind(kind)
        .filter((item: FoundText): boolean => {
          return item.text.length > limitOf(kind);
        })
        .map((item: FoundText): string => {
          return `${item.where} (${item.text.length}): ${item.text}`;
        });

      expect(tooLong).toEqual([]);
    },
  );

  test("every card description fits two lines across the page", () => {
    const tooLong: Array<string> = ofKind("card")
      .filter((item: FoundText): boolean => {
        return item.text.length > CARD_LIMIT;
      })
      .map((item: FoundText): string => {
        return `${item.where} (${item.text.length}): ${item.text}`;
      });

    expect(tooLong).toEqual([]);
  });

  // The switch the scan method's two cards replaced is named nowhere.
  test("nothing on screen names the old SNMP switch", () => {
    const naming: Array<string> = found
      .filter((item: FoundText): boolean => {
        return item.kind !== "column" && OLD_SNMP_SWITCH.test(item.text);
      })
      .map((item: FoundText): string => {
        return `${item.where}: ${item.text}`;
      });

    expect(naming).toEqual([]);
  });
});
