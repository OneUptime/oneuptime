import ts from "typescript";

/*
 * The detector behind the switch guard
 * (Tests/UI/Components/ToggleUsageGuard.test.ts).
 *
 * The maintainer's asks: "improve the UI for this component so it gets
 * reflected across the project", and then "make it just like how the rest
 * of oneuptime looks like". The look - the classic filled switch, a grey
 * track and white knob off, the brand indigo on - lives in one component,
 * Common/UI/Components/Toggle, and it only reaches a page that uses it the
 * way it is meant to be used. Three things undo that without any test
 * noticing, and this reads every module for them:
 *
 *   1. A <Toggle> with no name. Its title is its label; a switch with no
 *      title, ariaLabel, ariaLabelledby or an id that a <label htmlFor>
 *      points at is announced as "switch, off" and nothing else.
 *   2. A <Toggle> drawn under its own FieldLabel - the layout in the
 *      maintainer's screenshot: a label and a paragraph, and the switch
 *      floating under them, unconnected. The Toggle draws its title and
 *      description beside it instead.
 *   3. A switch built by hand (role="switch" on a plain element), which
 *      keeps whatever look it was given. The guard keeps a list of the ones
 *      that are deliberately not the Toggle, each with its reason.
 *
 * Only real syntax is read, through the TypeScript AST: a "<Toggle" in a
 * comment or a string is not a use.
 */

export interface ToggleUse {
  file: string;
  line: number;
  // The attribute names written on the element.
  attributes: Array<string>;
  isNamed: boolean;
}

export interface ToggleUnderFieldLabel {
  file: string;
  line: number;
}

export interface HandRolledSwitch {
  file: string;
  line: number;
  tagName: string;
}

export interface ToggleScanResult {
  toggles: Array<ToggleUse>;
  togglesUnderFieldLabel: Array<ToggleUnderFieldLabel>;
  handRolledSwitches: Array<HandRolledSwitch>;
}

// A plain element (button, span), not a component (Toggle, Button).
const INTRINSIC_TAG: RegExp = /^[a-z]/;

const NAMING_ATTRIBUTES: ReadonlyArray<string> = [
  "title",
  "ariaLabel",
  "ariaLabelledby",
];

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/*
 * The local names a module gives the default export of a path ending in
 * `suffix` ("Toggle/Toggle", "Fields/FieldLabel").
 */
function importedDefaultNames(
  sourceFile: ts.SourceFile,
  suffix: string,
): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const specifier: string = statement.moduleSpecifier.text;

    if (specifier !== suffix && !specifier.endsWith(`/${suffix}`)) {
      continue;
    }

    const defaultName: ts.Identifier | undefined = statement.importClause?.name;

    if (defaultName) {
      names.add(defaultName.text);
    }
  }

  return names;
}

function tagNameOf(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): string {
  return element.tagName.getText(sourceFile);
}

interface AttributeFacts {
  names: Array<string>;
  hasSpread: boolean;
  // Attribute name -> the source text of its value.
  values: Map<string, string>;
}

function attributesOf(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): AttributeFacts {
  const facts: AttributeFacts = {
    names: [],
    hasSpread: false,
    values: new Map<string, string>(),
  };

  for (const property of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      facts.hasSpread = true;
      continue;
    }

    const name: string = property.name.getText(sourceFile);

    facts.names.push(name);

    if (!property.initializer) {
      facts.values.set(name, "true");
      continue;
    }

    if (ts.isStringLiteral(property.initializer)) {
      facts.values.set(name, JSON.stringify(property.initializer.text));
      continue;
    }

    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const expression: ts.Expression = property.initializer.expression;

      facts.values.set(
        name,
        ts.isStringLiteral(expression) ||
          ts.isNoSubstitutionTemplateLiteral(expression)
          ? JSON.stringify(expression.text)
          : expression.getText(sourceFile),
      );
    }
  }

  return facts;
}

// A value that names nothing: an empty string, undefined or null.
function isEmptyValue(value: string | undefined): boolean {
  return (
    value === undefined ||
    value === '""' ||
    value === "undefined" ||
    value === "null"
  );
}

function openingElementOf(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxSelfClosingElement(node)) {
    return node;
  }

  if (ts.isJsxElement(node)) {
    return node.openingElement;
  }

  return null;
}

export function scanToggleUsage(
  fileName: string,
  sourceText: string,
): ToggleScanResult {
  const result: ToggleScanResult = {
    toggles: [],
    togglesUnderFieldLabel: [],
    handRolledSwitches: [],
  };

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const toggleNames: Set<string> = importedDefaultNames(
    sourceFile,
    "Toggle/Toggle",
  );
  const fieldLabelNames: Set<string> = importedDefaultNames(
    sourceFile,
    "Fields/FieldLabel",
  );

  // Every htmlFor value in the module: an id a <label> points at.
  const htmlForValues: Set<string> = new Set<string>();
  const toggleElements: Array<ts.JsxOpeningLikeElement> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName: string = tagNameOf(node, sourceFile);
      const attributes: AttributeFacts = attributesOf(node, sourceFile);
      const htmlFor: string | undefined = attributes.values.get("htmlFor");

      if (htmlFor !== undefined) {
        htmlForValues.add(htmlFor);
      }

      if (toggleNames.has(tagName)) {
        toggleElements.push(node);
      }

      const isIntrinsic: boolean = INTRINSIC_TAG.test(tagName);

      if (isIntrinsic && attributes.values.get("role") === '"switch"') {
        result.handRolledSwitches.push({
          file: fileName,
          line: lineOf(sourceFile, node),
          tagName: tagName,
        });
      }
    }

    // A FieldLabel element followed, among the same children, by a Toggle.
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children: Array<ts.JsxChild> = node.children.filter(
        (child: ts.JsxChild): boolean => {
          return !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces);
        },
      );

      for (let i: number = 0; i + 1 < children.length; i++) {
        const current: ts.JsxOpeningLikeElement | null = openingElementOf(
          children[i]!,
        );
        const next: ts.JsxOpeningLikeElement | null = openingElementOf(
          children[i + 1]!,
        );

        if (
          current &&
          next &&
          fieldLabelNames.has(tagNameOf(current, sourceFile)) &&
          toggleNames.has(tagNameOf(next, sourceFile))
        ) {
          result.togglesUnderFieldLabel.push({
            file: fileName,
            line: lineOf(sourceFile, next),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  for (const element of toggleElements) {
    const attributes: AttributeFacts = attributesOf(element, sourceFile);
    const id: string | undefined = attributes.values.get("id");

    const isNamed: boolean =
      NAMING_ATTRIBUTES.some((name: string): boolean => {
        return (
          attributes.names.includes(name) &&
          !isEmptyValue(attributes.values.get(name))
        );
      }) ||
      (id !== undefined && htmlForValues.has(id));

    result.toggles.push({
      file: fileName,
      line: lineOf(sourceFile, element),
      attributes: attributes.hasSpread
        ? [...attributes.names, "{...spread}"]
        : attributes.names,
      isNamed: isNamed,
    });
  }

  return result;
}
