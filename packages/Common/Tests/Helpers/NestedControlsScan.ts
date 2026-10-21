import ts from "typescript";
import { CONTROL_ROLES, SINGLE_CONTROL_ROLES } from "./NestedControls";

/*
 * The detector behind the nested-controls guard
 * (Tests/UI/Components/NestedControlsGuard.test.ts).
 *
 * The maintainer's ask, from a dropdown whose Clear button sat inside its
 * value button: "find similar issues across the project and fix them as
 * well". A control drawn inside another control - a button inside a button, a
 * clear "x" span acting as a button inside a filter chip's button, a Delete
 * button inside a header that is itself role="button" - is lost to a screen
 * reader, which reads the outer control's content as its name and offers
 * nothing inside it (see NestedControls.ts), and a button inside a button is
 * invalid HTML that React warns about.
 *
 * Read per module, through the TypeScript AST (a "<button" in a comment or a
 * string is not one), so it sees what one file draws:
 *
 *   - One control, whose content is its name (the outer one): <button>, <a>,
 *     an element given one of SINGLE_CONTROL_ROLES (role="button",
 *     role="option", role="tab" ...), and the shared Button and Link
 *     components.
 *   - Any control (the inner one): <button>, <a>, <input> (unless
 *     type="hidden"), <select>, <textarea>, an element given one of
 *     CONTROL_ROLES or a tabIndex of 0 or more (or one that is worked out at
 *     run time), an element spread with a drag library's dragHandleProps
 *     (role="button", tabIndex 0), and the shared components that draw a
 *     control (CONTROL_COMPONENT_PATHS).
 *
 * Only what is written between an element's tags counts as inside it: JSX
 * passed in an attribute, or handed to createPortal (drawn elsewhere in the
 * page), does not. A component that draws its own children inside a button
 * cannot be seen from here; the components' own tests check their rendered
 * DOM with findNestedControls.
 */

export interface NestedControlInSource {
  file: string;
  // The inner control's line.
  line: number;
  // How the two elements are written: `button`, `div[role=button]`, `Button`.
  outer: string;
  inner: string;
}

/*
 * Shared components that draw a control, by the module path they are imported
 * from (its end). Their default export is the component.
 */
export const CONTROL_COMPONENT_PATHS: ReadonlyArray<string> = [
  "Button/Button",
  "Checkbox/Checkbox",
  "CopyTextButton/CopyTextButton",
  "Dropdown/Dropdown",
  "EntityDropdown/EntityDropdown",
  "Input/Input",
  "Link/Link",
  "MoreMenu/MoreMenu",
  "TextArea/TextArea",
  "Toggle/Toggle",
];

// Of those, the ones that are one control around what they are given.
export const SINGLE_CONTROL_COMPONENT_PATHS: ReadonlyArray<string> = [
  "Button/Button",
  "Link/Link",
];

// A router's links: named imports from react-router.
const ROUTER_LINK_NAMES: ReadonlyArray<string> = ["Link", "NavLink"];

const CONTROL_TAGS: ReadonlyArray<string> = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
];

const SINGLE_CONTROL_TAGS: ReadonlyArray<string> = ["a", "button"];

// A plain element (button, div), not a component (Button, Link).
const INTRINSIC_TAG: RegExp = /^[a-z]/;

// What a drag library hands a drag handle: role="button" and tabIndex 0.
const DRAG_HANDLE_SPREAD: RegExp = /dragHandleProps$/;

// createPortal(...) or ReactDOM.createPortal(...).
const CREATE_PORTAL_CALLEE: RegExp = /(^|\.)createPortal$/;

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/*
 * The local names of the default exports of modules whose path ends in one
 * of `suffixes`.
 */
function importedDefaultNames(
  sourceFile: ts.SourceFile,
  suffixes: ReadonlyArray<string>,
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
    const matches: boolean = suffixes.some((suffix: string): boolean => {
      return specifier === suffix || specifier.endsWith(`/${suffix}`);
    });

    if (!matches) {
      continue;
    }

    const defaultName: ts.Identifier | undefined = statement.importClause?.name;

    if (defaultName) {
      names.add(defaultName.text);
    }
  }

  return names;
}

// The local names given to react-router's Link and NavLink.
function importedRouterLinkNames(sourceFile: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith("react-router")
    ) {
      continue;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    if (!bindings || !ts.isNamedImports(bindings)) {
      continue;
    }

    for (const element of bindings.elements) {
      const importedName: string = (element.propertyName || element.name).text;

      if (ROUTER_LINK_NAMES.includes(importedName)) {
        names.add(element.name.text);
      }
    }
  }

  return names;
}

interface ElementFacts {
  tagName: string;
  /*
   * The attribute's literal text, `true` for a bare attribute, or null when
   * it is worked out at run time.
   */
  attributes: Map<string, string | null>;
  spreads: Array<string>;
}

function factsOf(
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): ElementFacts {
  const facts: ElementFacts = {
    tagName: element.tagName.getText(sourceFile),
    attributes: new Map<string, string | null>(),
    spreads: [],
  };

  for (const property of element.attributes.properties) {
    if (ts.isJsxSpreadAttribute(property)) {
      facts.spreads.push(property.expression.getText(sourceFile));
      continue;
    }

    const name: string = property.name.getText(sourceFile);

    if (!property.initializer) {
      facts.attributes.set(name, "true");
      continue;
    }

    if (ts.isStringLiteral(property.initializer)) {
      facts.attributes.set(name, property.initializer.text);
      continue;
    }

    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const expression: ts.Expression = property.initializer.expression;

      if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      ) {
        facts.attributes.set(name, expression.text);
        continue;
      }

      if (ts.isNumericLiteral(expression)) {
        facts.attributes.set(name, expression.text);
        continue;
      }

      if (
        ts.isPrefixUnaryExpression(expression) &&
        expression.operator === ts.SyntaxKind.MinusToken &&
        ts.isNumericLiteral(expression.operand)
      ) {
        facts.attributes.set(name, `-${expression.operand.text}`);
        continue;
      }
    }

    facts.attributes.set(name, null);
  }

  return facts;
}

// `button`, `div[role=option]`, `Button`: how an element reads in a report.
function describe(facts: ElementFacts): string {
  const role: string | null | undefined = facts.attributes.get("role");

  if (INTRINSIC_TAG.test(facts.tagName) && role) {
    return `${facts.tagName}[role=${role}]`;
  }

  return facts.tagName;
}

interface ComponentNames {
  controls: Set<string>;
  singleControls: Set<string>;
}

function isSingleControl(facts: ElementFacts, names: ComponentNames): boolean {
  if (!INTRINSIC_TAG.test(facts.tagName)) {
    return names.singleControls.has(facts.tagName);
  }

  const role: string | null | undefined = facts.attributes.get("role");

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (role && SINGLE_CONTROL_ROLES.includes(role)) {
    return true;
  }

  return SINGLE_CONTROL_TAGS.includes(facts.tagName) && !role;
}

function isControl(facts: ElementFacts, names: ComponentNames): boolean {
  if (!INTRINSIC_TAG.test(facts.tagName)) {
    return names.controls.has(facts.tagName);
  }

  const role: string | null | undefined = facts.attributes.get("role");

  if (role === "presentation" || role === "none") {
    return false;
  }

  if (role && CONTROL_ROLES.includes(role)) {
    return true;
  }

  if (CONTROL_TAGS.includes(facts.tagName)) {
    return !(
      facts.tagName === "input" && facts.attributes.get("type") === "hidden"
    );
  }

  if (
    facts.spreads.some((spread: string): boolean => {
      return DRAG_HANDLE_SPREAD.test(spread);
    })
  ) {
    return true;
  }

  if (!facts.attributes.has("tabIndex")) {
    return false;
  }

  const tabIndex: string | null | undefined = facts.attributes.get("tabIndex");

  // Worked out at run time: it may well put the element in the Tab order.
  if (tabIndex === null || tabIndex === undefined) {
    return true;
  }

  return Number(tabIndex) >= 0;
}

function isCreatePortalCall(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  return (
    ts.isCallExpression(node) &&
    CREATE_PORTAL_CALLEE.test(node.expression.getText(sourceFile))
  );
}

export function scanNestedControls(
  fileName: string,
  sourceText: string,
): Array<NestedControlInSource> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const routerLinks: Set<string> = importedRouterLinkNames(sourceFile);
  const names: ComponentNames = {
    controls: new Set<string>([
      ...importedDefaultNames(sourceFile, CONTROL_COMPONENT_PATHS),
      ...routerLinks,
    ]),
    singleControls: new Set<string>([
      ...importedDefaultNames(sourceFile, SINGLE_CONTROL_COMPONENT_PATHS),
      ...routerLinks,
    ]),
  };

  const found: Array<NestedControlInSource> = [];

  // The single controls whose tags the walk is between, innermost last.
  const visit: (node: ts.Node, around: Array<ElementFacts>) => void = (
    node: ts.Node,
    around: Array<ElementFacts>,
  ): void => {
    // Drawn into another part of the page: inside nothing written here.
    if (isCreatePortalCall(node, sourceFile)) {
      ts.forEachChild(node, (child: ts.Node): void => {
        visit(child, []);
      });
      return;
    }

    const opening: ts.JsxOpeningLikeElement | null = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (!opening) {
      ts.forEachChild(node, (child: ts.Node): void => {
        visit(child, around);
      });
      return;
    }

    const facts: ElementFacts = factsOf(opening, sourceFile);
    const outer: ElementFacts | undefined = around[around.length - 1];

    if (outer && isControl(facts, names)) {
      found.push({
        file: fileName,
        line: lineOf(sourceFile, opening),
        outer: describe(outer),
        inner: describe(facts),
      });
    }

    // What its attributes hold is not drawn between its tags.
    ts.forEachChild(opening, (child: ts.Node): void => {
      visit(child, around);
    });

    if (!ts.isJsxElement(node)) {
      return;
    }

    const inside: Array<ElementFacts> = isSingleControl(facts, names)
      ? [...around, facts]
      : around;

    for (const child of node.children) {
      visit(child, inside);
    }
  };

  visit(sourceFile, []);

  return found;
}

// `button > span[role=button]`: one nesting as the guard's lists write it.
export function nestingKey(nesting: NestedControlInSource): string {
  return `${nesting.outer} > ${nesting.inner}`;
}
