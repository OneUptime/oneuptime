import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The Network Monitoring overview's empty state has two footer buttons
 * ("Add Device" and "Discover Devices") inside a wrapper div of its own.
 *
 * EmptyState now lays its footer out as a centred flex row. A wrapper that
 * is itself a flex item only takes the width of its content, and Button is
 * w-full below md, so the two buttons shrank to fit instead of sitting side
 * by side at their natural width. The wrapper must span the footer row
 * (w-full) and centre the buttons itself (justify-center).
 *
 * The App suite runs in node without a React renderer, so the JSX is parsed
 * with the TypeScript compiler and the props are read off the syntax tree.
 * That keeps the assertions scoped to this one EmptyState and immune to
 * Prettier reflowing the props.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const OVERVIEW_PATH: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "NetworkDevice",
  "Overview.tsx",
);

const EMPTY_STATE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "EmptyState",
  "EmptyState.tsx",
);

const EMPTY_STATE_ID: string = "network-overview-empty-state";

type JsxElementLike = ts.JsxSelfClosingElement | ts.JsxOpeningElement;

type ParseFunction = (filePath: string) => ts.SourceFile;

const parse: ParseFunction = (filePath: string): ts.SourceFile => {
  return ts.createSourceFile(
    path.basename(filePath),
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
};

const overviewSyntax: ts.SourceFile = parse(OVERVIEW_PATH);

type CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
  source: ts.SourceFile,
) => Array<JsxElementLike>;

const collectJsxElements: CollectJsxElementsFunction = (
  root: ts.Node,
  tagName: string,
  source: ts.SourceFile,
): Array<JsxElementLike> => {
  const found: Array<JsxElementLike> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(source) === tagName
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
  source: ts.SourceFile,
) => ts.JsxAttribute | undefined;

const getAttribute: GetAttributeFunction = (
  element: JsxElementLike,
  name: string,
  source: ts.SourceFile,
): ts.JsxAttribute | undefined => {
  return element.attributes.properties.find(
    (property: ts.JsxAttributeLike): property is ts.JsxAttribute => {
      return (
        ts.isJsxAttribute(property) && property.name.getText(source) === name
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
  source: ts.SourceFile,
) => string | undefined;

const getStringAttribute: GetStringAttributeFunction = (
  element: JsxElementLike,
  name: string,
  source: ts.SourceFile,
): string | undefined => {
  const initializer: ts.JsxAttributeValue | undefined = getAttribute(
    element,
    name,
    source,
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
  source: ts.SourceFile,
) => ts.Expression | undefined;

const getExpressionAttribute: GetExpressionAttributeFunction = (
  element: JsxElementLike,
  name: string,
  source: ts.SourceFile,
): ts.Expression | undefined => {
  const initializer: ts.JsxAttributeValue | undefined = getAttribute(
    element,
    name,
    source,
  )?.initializer;

  if (initializer && ts.isJsxExpression(initializer)) {
    return initializer.expression;
  }

  return undefined;
};

type ClassTokensFunction = (value: string | undefined) => Array<string>;

const classTokens: ClassTokensFunction = (
  value: string | undefined,
): Array<string> => {
  return (value || "").split(/\s+/).filter((token: string): boolean => {
    return token.length > 0;
  });
};

type GetEmptyStateFunction = () => JsxElementLike;

const getEmptyState: GetEmptyStateFunction = (): JsxElementLike => {
  const matches: Array<JsxElementLike> = collectJsxElements(
    overviewSyntax,
    "EmptyState",
    overviewSyntax,
  ).filter((element: JsxElementLike): boolean => {
    return getStringAttribute(element, "id", overviewSyntax) === EMPTY_STATE_ID;
  });

  if (matches.length !== 1) {
    throw new Error(
      `Expected one EmptyState with id="${EMPTY_STATE_ID}", found ${matches.length}`,
    );
  }

  return matches[0]!;
};

// The JSX element passed as the empty state's footer prop.
type GetFooterWrapperFunction = () => ts.JsxElement;

const getFooterWrapper: GetFooterWrapperFunction = (): ts.JsxElement => {
  let footer: ts.Expression | undefined = getExpressionAttribute(
    getEmptyState(),
    "footer",
    overviewSyntax,
  );

  while (footer && ts.isParenthesizedExpression(footer)) {
    footer = footer.expression;
  }

  if (!footer || !ts.isJsxElement(footer)) {
    throw new Error(
      "The network overview EmptyState's footer is not a single wrapper element",
    );
  }

  return footer;
};

type GetFooterButtonsFunction = () => Array<JsxElementLike>;

const getFooterButtons: GetFooterButtonsFunction =
  (): Array<JsxElementLike> => {
    return collectJsxElements(getFooterWrapper(), "Button", overviewSyntax);
  };

describe("Network device overview empty state footer", () => {
  test("wraps the footer in a single div", () => {
    const wrapper: ts.JsxElement = getFooterWrapper();

    expect(wrapper.openingElement.tagName.getText(overviewSyntax)).toBe("div");
  });

  test("the wrapper spans the footer row and centres its buttons", () => {
    const tokens: Array<string> = classTokens(
      getStringAttribute(
        getFooterWrapper().openingElement,
        "className",
        overviewSyntax,
      ),
    );

    expect(tokens).toEqual(
      expect.arrayContaining(["flex", "w-full", "justify-center", "gap-3"]),
    );
  });

  test("the wrapper's classes are a plain string, not computed", () => {
    // A computed className would hide w-full from this test.
    expect(
      getStringAttribute(
        getFooterWrapper().openingElement,
        "className",
        overviewSyntax,
      ),
    ).toBe("flex w-full justify-center gap-3");
  });

  test("the wrapper does not stack or shrink its buttons", () => {
    const tokens: Array<string> = classTokens(
      getStringAttribute(
        getFooterWrapper().openingElement,
        "className",
        overviewSyntax,
      ),
    );

    expect(tokens).not.toContain("flex-col");
    expect(tokens).not.toContain("inline-flex");
    expect(tokens).not.toContain("w-auto");

    const contentWidth: RegExp = /^(w|max-w)-(fit|min)$/;

    expect(
      tokens.some((token: string): boolean => {
        return contentWidth.test(token);
      }),
    ).toBe(false);
  });

  test("holds the two actions as direct children, Add Device first", () => {
    const wrapper: ts.JsxElement = getFooterWrapper();
    const directButtons: Array<string | undefined> = wrapper.children
      .filter((child: ts.JsxChild): boolean => {
        return ts.isJsxSelfClosingElement(child) || ts.isJsxElement(child);
      })
      .map((child: ts.JsxChild): string | undefined => {
        const element: JsxElementLike = ts.isJsxElement(child)
          ? child.openingElement
          : (child as ts.JsxSelfClosingElement);

        expect(element.tagName.getText(overviewSyntax)).toBe("Button");

        return getStringAttribute(element, "title", overviewSyntax);
      });

    expect(directButtons).toEqual(["Add Device", "Discover Devices"]);
    expect(getFooterButtons()).toHaveLength(2);
  });

  test("keeps the primary and bordered styles and their destinations", () => {
    const [addDevice, discover] = getFooterButtons() as [
      JsxElementLike,
      JsxElementLike,
    ];

    expect(
      getExpressionAttribute(addDevice, "buttonStyle", overviewSyntax)?.getText(
        overviewSyntax,
      ),
    ).toBe("ButtonStyleType.PRIMARY");
    expect(
      getExpressionAttribute(addDevice, "onClick", overviewSyntax)?.getText(
        overviewSyntax,
      ),
    ).toContain("PageMap.NETWORK_DEVICES]");
    expect(
      getExpressionAttribute(discover, "buttonStyle", overviewSyntax)?.getText(
        overviewSyntax,
      ),
    ).toBe("ButtonStyleType.NORMAL");
    expect(
      getExpressionAttribute(discover, "onClick", overviewSyntax)?.getText(
        overviewSyntax,
      ),
    ).toContain("PageMap.NETWORK_DEVICE_DISCOVERY");
  });

  test("uses no OUTLINE button, which has no stylesheet", () => {
    expect(getFooterWrapper().getText(overviewSyntax)).not.toMatch(
      /ButtonStyleType\.(OUTLINE|HOVER_\w+_OUTLINE)\b/,
    );
  });

  test("keeps its title", () => {
    expect(getStringAttribute(getEmptyState(), "title", overviewSyntax)).toBe(
      "Bring your network in",
    );
  });
});

/*
 * Why w-full is needed: EmptyState renders the footer inside a centred
 * flex row. If that ever goes back to a plain block, this test
 * says so, and the wrapper's classes above can be revisited.
 */
describe("EmptyState footer row", () => {
  test("is a centred flex row the wrapper sits in as a flex item", () => {
    const emptyStateSyntax: ts.SourceFile = parse(EMPTY_STATE_PATH);
    const footerRows: Array<JsxElementLike> = collectJsxElements(
      emptyStateSyntax,
      "div",
      emptyStateSyntax,
    ).filter((element: JsxElementLike): boolean => {
      const parent: ts.Node = element.parent;
      return (
        ts.isJsxElement(parent) &&
        parent.children.some((child: ts.JsxChild): boolean => {
          return (
            ts.isJsxExpression(child) &&
            Boolean(child.expression) &&
            child.expression!.getText(emptyStateSyntax) === "props.footer"
          );
        })
      );
    });

    expect(footerRows).toHaveLength(1);

    const tokens: Array<string> = classTokens(
      getStringAttribute(footerRows[0]!, "className", emptyStateSyntax),
    );

    expect(tokens).toEqual(expect.arrayContaining(["flex", "justify-center"]));
  });
});
