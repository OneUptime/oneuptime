import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Reads, from the source, the requests OneUptime's own components send
 * through the shared request client (Common/Utils/API) and whether each
 * keeps its redirects on the server it was sent to - the option
 * sameServerRedirectsOnly (Common/Utils/SameServerRedirect).
 *
 * A request's options keep its redirects on its server when they are:
 *
 *   - an object literal whose last word on sameServerRedirectsOnly is
 *     `true` - written as a property, or brought in by spreading one of the
 *     helpers below - with no spread of anything else after it that could
 *     take it back;
 *   - a call of one of the helpers below;
 *   - a constant of the same file holding either.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

/*
 * The helpers that build the options of a request carrying a probe's or a
 * Runner's key; each returns sameServerRedirectsOnly: true after anything a
 * caller hands it (their packages' tests hold them to that).
 */
export const SAME_SERVER_OPTION_HELPERS: Array<string> = [
  "ProbeAPIRequest.getDefaultRequestOptions",
  "RunnerAPIRequest.getDefaultRequestOptions",
];

const SAME_SERVER_OPTION: string = "sameServerRedirectsOnly";

const WHITESPACE: RegExp = /\s+/g;

// The shared request client's methods, as code calls them: API.post(...).
const SHARED_CLIENT_METHODS: Array<string> = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "fetch",
];

export interface SharedClientCall {
  file: string;
  line: number;
  // The call's text, cut short, for a failure to show.
  text: string;
  // The object literal the call is handed, when it is one.
  argument: ts.ObjectLiteralExpression | null;
  sourceFile: ts.SourceFile;
}

export function parseFile(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// The code of a file, its comments removed by TypeScript's own printer.
export function codeOf(relativePath: string): string {
  return ts
    .createPrinter({ removeComments: true })
    .printFile(parseFile(relativePath));
}

function isHelperCall(node: ts.Expression, sourceFile: ts.SourceFile): boolean {
  return (
    ts.isCallExpression(node) &&
    SAME_SERVER_OPTION_HELPERS.includes(node.expression.getText(sourceFile))
  );
}

/*
 * The initializer of a `const` of this name declared at any level of the
 * file, when there is exactly one.
 */
function constantInitializer(
  name: string,
  sourceFile: ts.SourceFile,
): ts.Expression | null {
  const found: Array<ts.Expression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      found.push(node.initializer);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found.length === 1 ? found[0]! : null;
}

// Whether these options keep a request's redirects on its server (see above).
export function keepsRedirectsOnServer(
  options: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  depth: number = 0,
): boolean {
  if (!options || depth > 2) {
    return false;
  }

  if (ts.isParenthesizedExpression(options) || ts.isAsExpression(options)) {
    return keepsRedirectsOnServer(options.expression, sourceFile, depth);
  }

  if (isHelperCall(options, sourceFile)) {
    return true;
  }

  if (ts.isIdentifier(options)) {
    const initializer: ts.Expression | null = constantInitializer(
      options.text,
      sourceFile,
    );

    return initializer
      ? keepsRedirectsOnServer(initializer, sourceFile, depth + 1)
      : false;
  }

  if (!ts.isObjectLiteralExpression(options)) {
    return false;
  }

  let keeps: boolean = false;

  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      // Anything spread but a helper could say otherwise.
      keeps = isHelperCall(property.expression, sourceFile);
      continue;
    }

    if (
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      property.name.getText(sourceFile) === SAME_SERVER_OPTION
    ) {
      keeps =
        ts.isPropertyAssignment(property) &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword;
    }
  }

  return keeps;
}

// A property of an object literal, by name, or undefined.
export function propertyOf(
  literal: ts.ObjectLiteralExpression,
  name: string,
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  for (const property of literal.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText(sourceFile) === name
    ) {
      return property.initializer;
    }

    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === name
    ) {
      return property.name;
    }
  }

  return undefined;
}

// Every call of the shared request client in a file: API.post({...}), API.fetch<T>({...}).
export function sharedClientCallsIn(
  relativePath: string,
): Array<SharedClientCall> {
  const sourceFile: ts.SourceFile = parseFile(relativePath);
  const calls: Array<SharedClientCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "API" &&
      SHARED_CLIENT_METHODS.includes(node.expression.name.text)
    ) {
      const first: ts.Expression | undefined = node.arguments[0];

      calls.push({
        file: relativePath,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        text: node.getText(sourceFile).replace(WHITESPACE, " ").slice(0, 160),
        argument: first && ts.isObjectLiteralExpression(first) ? first : null,
        sourceFile: sourceFile,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return calls;
}

// Whether a call keeps its redirects on its server.
export function callKeepsRedirectsOnServer(call: SharedClientCall): boolean {
  if (!call.argument) {
    return false;
  }

  return keepsRedirectsOnServer(
    propertyOf(call.argument, "options", call.sourceFile),
    call.sourceFile,
  );
}

// Where a call is, for a failure to name.
export function placeOfCall(call: SharedClientCall): string {
  return `${call.file}:${call.line}: ${call.text}`;
}
