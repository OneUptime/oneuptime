import fs from "fs";
import ts from "typescript";

/*
 * THE ROUTES A FILE MOUNTS, READ AS CODE.
 *
 * The wiring suites pin the routes the apps mount: which page, or which
 * product's route group, each path draws. Pinned as the file's text - even
 * with its whitespace squashed - such a pin also pins where Prettier breaks
 * the lines, and Prettier breaks them by how deep the routes sit. A path
 * that stops fitting on its line is wrapped over three, and a long PageMap
 * key inside its brackets:
 *
 *   <PageRoute
 *     path={
 *       RouteMap[
 *         PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT
 *       ]?.toString() || ""
 *     }
 *     element={
 *       <ScheduledMaintenanceEventsRoutes {...commonPageProps} />
 *     }
 *   />
 *
 * So when 5c707fe48a7 moved the Dashboard's routes two columns deeper, a
 * text pin read Data Observability as not mounted at all (#7684).
 *
 * Here the file is parsed with the TypeScript compiler, and a route is its
 * attributes: each one's name, and its code as it reads on one line,
 * written out from the code's tokens - one space wherever the source has
 * any, but none just inside brackets, parentheses and braces, before a dot
 * or before the > that closes a JSX tag, and no trailing comma. The route
 * above is
 *
 *   {
 *     path: 'RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT]?.toString() || ""',
 *     element: "<ScheduledMaintenanceEventsRoutes {...commonPageProps} />",
 *   }
 *
 * however its lines are broken. A string keeps its quotes (path="*" is
 * '"*"'), an attribute with no value is "true" (index is "true"), a spread
 * is kept whole, as a key with no value, and the routes inside a layout
 * route are its children, as React hands them to it. So a pin that takes
 * the routes at one path and holds them to a list of one, with toEqual,
 * holds the tag, the path and the element, that nothing else is set on the
 * route, that it has no routes inside it, and that no other route mounts
 * that path.
 *
 * A plain module, not a .test.ts file: importing it runs no tests.
 */

export type RouteAttributes = Record<string, string>;

const OPENING_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.OpenBraceToken,
]);

const CLOSING_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
]);

function isJsx(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

// The identifiers, literals, keywords and punctuation of some code, in order.
function collectTokens(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  tokens: Array<ts.Node>,
): void {
  // Prettier puts JSX that breaks over lines in parentheses: (<Page />) is <Page />.
  if (ts.isParenthesizedExpression(node) && isJsx(node.expression)) {
    collectTokens(node.expression, sourceFile, tokens);
    return;
  }

  // {/* a comment */} in JSX draws nothing.
  if (ts.isJsxExpression(node) && !node.expression) {
    return;
  }

  const children: ReadonlyArray<ts.Node> = node.getChildren(sourceFile);

  if (children.length === 0) {
    tokens.push(node);
    return;
  }

  for (const child of children) {
    collectTokens(child, sourceFile, tokens);
  }
}

function closesJsxTag(token: ts.Node): boolean {
  return (
    token.kind === ts.SyntaxKind.GreaterThanToken &&
    (ts.isJsxOpeningElement(token.parent) ||
      ts.isJsxClosingElement(token.parent) ||
      ts.isJsxOpeningFragment(token.parent) ||
      ts.isJsxClosingFragment(token.parent))
  );
}

function spaceBetween(
  previous: ts.Node,
  token: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  return (
    token.getStart(sourceFile) > previous.getEnd() &&
    !OPENING_TOKENS.has(previous.kind) &&
    !CLOSING_TOKENS.has(token.kind) &&
    token.kind !== ts.SyntaxKind.DotToken &&
    token.kind !== ts.SyntaxKind.QuestionDotToken &&
    !closesJsxTag(token)
  );
}

// A node's code as it reads on one line, however its lines are broken.
function codeOf(node: ts.Node, sourceFile: ts.SourceFile): string {
  const tokens: Array<ts.Node> = [];
  collectTokens(node, sourceFile, tokens);

  let code: string = "";
  let previous: ts.Node | undefined = undefined;

  tokens.forEach((token: ts.Node, index: number): void => {
    const next: ts.Node | undefined = tokens[index + 1];

    // The comma Prettier adds after the last item when it breaks a list.
    if (
      token.kind === ts.SyntaxKind.CommaToken &&
      next &&
      CLOSING_TOKENS.has(next.kind)
    ) {
      return;
    }

    if (token.kind === ts.SyntaxKind.JsxText) {
      /*
       * Its own whitespace squashed, and none around it: between tags,
       * nothing. (JSX text runs up to the next tag, so what follows it
       * never has a space before it either.)
       */
      code += token.getText(sourceFile).replace(/\s+/g, " ").trim();
    } else {
      if (previous && spaceBetween(previous, token, sourceFile)) {
        code += " ";
      }

      code += token.getText(sourceFile);
    }

    previous = token;
  });

  return code;
}

function attributesOf(
  element: ts.JsxSelfClosingElement | ts.JsxOpeningElement,
  sourceFile: ts.SourceFile,
): RouteAttributes {
  const attributes: RouteAttributes = {};

  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) {
      // A spread, kept whole: a route that spreads props is not the route a pin names.
      attributes[codeOf(attribute, sourceFile)] = "";
      continue;
    }

    const value: ts.JsxAttributeValue | undefined = attribute.initializer;
    let code: string = "true";

    if (value && ts.isJsxExpression(value)) {
      code = value.expression ? codeOf(value.expression, sourceFile) : "";
    } else if (value) {
      code = codeOf(value, sourceFile);
    }

    attributes[attribute.name.getText(sourceFile)] = code;
  }

  if (ts.isJsxOpeningElement(element)) {
    const children: Array<string> = element.parent.children
      .map((child: ts.JsxChild): string => {
        return codeOf(child, sourceFile);
      })
      .filter((code: string): boolean => {
        return code !== "";
      });

    if (children.length > 0) {
      attributes["children"] = children.join(" ");
    }
  }

  return attributes;
}

/*
 * Every route in some TSX, in the order it declares them, a layout route's
 * own routes after it: each <PageRoute>, or each element of the tag given -
 * the Accounts app mounts react-router's <Route> by its own name.
 */
export function routesInCode(
  code: string,
  tagName: string = "PageRoute",
): Array<RouteAttributes> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "Routes.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const routes: Array<RouteAttributes> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(sourceFile) === tagName
    ) {
      routes.push(attributesOf(node, sourceFile));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return routes;
}

// Every route in a file: an app's App.tsx, or a product's route group.
export function pageRoutesIn(
  filePath: string,
  tagName: string = "PageRoute",
): Array<RouteAttributes> {
  return routesInCode(fs.readFileSync(filePath, "utf8"), tagName);
}

// The routes of a list that mount the path given, written as code.
export function routesAt(
  routes: Array<RouteAttributes>,
  routePath: string,
): Array<RouteAttributes> {
  return routes.filter((route: RouteAttributes): boolean => {
    return route["path"] === routePath;
  });
}

// The path every app gives a page in its RouteMap: path={RouteMap[PageMap.KEY]?.toString() || ""}.
export function routeMapPath(pageKey: string): string {
  return `RouteMap[PageMap.${pageKey}]?.toString() || ""`;
}
