import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Security Events table's empty state is the first thing a new SIEM
 * customer sees, and it once rendered badly in two silent ways:
 *
 *  - no paddingClassName, so EmptyState's 13rem full-page default left a
 *    huge gap between the "Read the setup guide" button and the table's own
 *    "Refresh?" link underneath it;
 *  - an OUTLINE footer button. OUTLINE's classes (btn-outline-secondary,
 *    background-very-light-Gray500-on-hover) are defined in no stylesheet,
 *    so the button drew with no border at all and, being a block-level flex
 *    box, sat flush left under a centred title.
 *
 * The App suite runs in node without a React renderer, so the JSX is parsed
 * with the TypeScript compiler and the props are read off the syntax tree.
 * That keeps the assertions scoped to this one EmptyState rather than to
 * whatever else the file happens to contain, and immune to Prettier
 * reflowing the props.
 */

const TABLE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "SecurityEvents",
  "SecurityEventsTable.tsx",
);

const EMPTY_STATE_ID: string = "security-events-empty-state";

const tableSource: string = fs.readFileSync(TABLE_PATH, "utf8");

const tableSyntax: ts.SourceFile = ts.createSourceFile(
  "SecurityEventsTable.tsx",
  tableSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

type JsxElementLike = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

type CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
) => Array<JsxElementLike>;

const collectJsxElements: CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
): Array<JsxElementLike> => {
  const found: Array<JsxElementLike> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(tableSyntax) === tagName
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(root);

  return found;
};

type GetAttributeFunction = (
  element: JsxElementLike,
  name: string,
) => ts.JsxAttribute | undefined;

const getAttribute: GetAttributeFunction = (
  element: JsxElementLike,
  name: string,
): ts.JsxAttribute | undefined => {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return (
        ts.isJsxAttribute(property) &&
        property.name.getText(tableSyntax) === name
      );
    },
  );
};

/*
 * The value of a string prop, whether written as name="x" or name={"x"}.
 * Anything computed returns undefined so the caller's assertion fails loudly.
 */
type GetStringAttributeFunction = (
  element: JsxElementLike,
  name: string,
) => string | undefined;

const getStringAttribute: GetStringAttributeFunction = (
  element: JsxElementLike,
  name: string,
): string | undefined => {
  const initializer: ts.JsxAttributeValue | undefined = getAttribute(
    element,
    name,
  )?.initializer;

  if (!initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteralLike(initializer.expression)
  ) {
    return initializer.expression.text;
  }

  return undefined;
};

type GetExpressionAttributeFunction = (
  element: JsxElementLike,
  name: string,
) => ts.Expression | undefined;

const getExpressionAttribute: GetExpressionAttributeFunction = (
  element: JsxElementLike,
  name: string,
): ts.Expression | undefined => {
  const initializer: ts.JsxAttributeValue | undefined = getAttribute(
    element,
    name,
  )?.initializer;

  if (initializer && ts.isJsxExpression(initializer)) {
    return initializer.expression;
  }

  return undefined;
};

type GetEmptyStateFunction = () => JsxElementLike;

const getEmptyState: GetEmptyStateFunction = (): JsxElementLike => {
  const matches: Array<JsxElementLike> = collectJsxElements(
    tableSyntax,
    "EmptyState",
  ).filter((element: JsxElementLike): boolean => {
    return getStringAttribute(element, "id") === EMPTY_STATE_ID;
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected one EmptyState with id="${EMPTY_STATE_ID}", found ${matches.length}`,
    );
  }

  return matches[0]!;
};

type GetFooterButtonsFunction = () => Array<JsxElementLike>;

const getFooterButtons: GetFooterButtonsFunction =
  (): Array<JsxElementLike> => {
    const footer: ts.Expression | undefined = getExpressionAttribute(
      getEmptyState(),
      "footer",
    );

    if (!footer) {
      throw new Error("The security events EmptyState has no footer");
    }

    return collectJsxElements(footer, "Button");
  };

describe("Security events table empty state", () => {
  test("is the table's noItemsMessage", () => {
    const emptyState: JsxElementLike = getEmptyState();
    let parent: ts.Node | undefined = emptyState.parent;
    let owningProp: string | undefined = undefined;

    while (parent) {
      if (ts.isJsxAttribute(parent)) {
        owningProp = parent.name.getText(tableSyntax);
        break;
      }
      parent = parent.parent;
    }

    expect(owningProp).toBe("noItemsMessage");
  });

  test("overrides EmptyState's full-page padding", () => {
    const padding: string | undefined = getStringAttribute(
      getEmptyState(),
      "paddingClassName",
    );

    expect(padding).toBe("py-12");
  });

  test("keeps its title and description", () => {
    const emptyState: JsxElementLike = getEmptyState();

    expect(getStringAttribute(emptyState, "title")).toBe(
      "No security events yet",
    );
    expect(getStringAttribute(emptyState, "description")).toContain(
      "Events are normalized to OCSF",
    );
  });

  test("has exactly one footer button, pointing at the setup guide", () => {
    const buttons: Array<JsxElementLike> = getFooterButtons();

    expect(buttons).toHaveLength(1);

    const button: JsxElementLike = buttons[0]!;
    const onClick: ts.Expression | undefined = getExpressionAttribute(
      button,
      "onClick",
    );

    expect(getStringAttribute(button, "title")).toBe("Read the setup guide");
    expect(getExpressionAttribute(button, "icon")?.getText(tableSyntax)).toBe(
      "IconProp.Book",
    );
    expect(onClick?.getText(tableSyntax)).toContain(
      "PageMap.SECURITY_EVENTS_DOCUMENTATION",
    );
  });

  test("the footer button uses the bordered NORMAL style", () => {
    const button: JsxElementLike = getFooterButtons()[0]!;
    const buttonStyle: string | undefined = getExpressionAttribute(
      button,
      "buttonStyle",
    )?.getText(tableSyntax);

    expect(buttonStyle).toBe("ButtonStyleType.NORMAL");
  });

  test("no OUTLINE style anywhere in the footer", () => {
    const footer: ts.Expression | undefined = getExpressionAttribute(
      getEmptyState(),
      "footer",
    );

    expect(footer).toBeDefined();
    expect(footer!.getText(tableSyntax)).not.toMatch(
      /ButtonStyleType\.(OUTLINE|HOVER_\w+_OUTLINE)\b/,
    );
  });
});
