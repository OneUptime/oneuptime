"use strict";

/*
 * Reads which React Router routers a JavaScript (JSX) or TypeScript (TSX)
 * file mounts, and what it imports, with TypeScript's own parser: the
 * offline fixtures under packages/E2E are .js files written in JSX, the
 * frontends' entry points .tsx, and Tests/Ops runs plain JavaScript.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

/*
 * React Router's routers. A file mounts one as a JSX element, or makes a
 * data router with a create*Router call; either way this reads it, so a
 * router this suite has no rule for cannot be mounted unseen.
 */
const ROUTER_ELEMENTS = new Set([
  "BrowserRouter",
  "HashRouter",
  "MemoryRouter",
  "Router",
  "StaticRouter",
  "HistoryRouter",
  "unstable_HistoryRouter",
  "RouterProvider",
]);
const ROUTER_FACTORIES = new Set([
  "createBrowserRouter",
  "createHashRouter",
  "createMemoryRouter",
  "createStaticRouter",
]);

function scriptKindOf(file) {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (file.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  return ts.ScriptKind.JSX;
}

function tagNameOf(node) {
  const name = node.tagName;

  if (ts.isIdentifier(name)) {
    return name.text;
  }

  if (ts.isPropertyAccessExpression(name)) {
    return name.name.text;
  }

  return name.getText();
}

/*
 * What a useTransitions attribute says: false only for the literal
 * `useTransitions={false}`. Absent, bare (`useTransitions`, which JSX reads
 * as true) or any other value leaves React Router's transitions on.
 */
function transitionsOf(attributes) {
  for (const attribute of attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      return "spread";
    }

    if (attribute.name.getText() !== "useTransitions") {
      continue;
    }

    const value = attribute.initializer;

    if (
      value &&
      ts.isJsxExpression(value) &&
      value.expression &&
      value.expression.kind === ts.SyntaxKind.FalseKeyword
    ) {
      return "off";
    }

    return "on";
  }

  return "on";
}

/*
 * Every router a source mounts or makes: { kind, name, line, transitions }.
 * kind is "element" for a JSX element (transitions: "off" when it takes
 * useTransitions={false}, "on" otherwise, "spread" when its props are spread
 * and so cannot be read), "call" for React.createElement(<router>, ...)
 * or a create*Router(...) data router.
 */
function routersOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
  const found = [];

  function lineOf(node) {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1
    );
  }

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = tagNameOf(node);

      if (ROUTER_ELEMENTS.has(name)) {
        found.push({
          kind: "element",
          name: name,
          line: lineOf(node),
          transitions: transitionsOf(node.attributes),
        });
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";

      if (ROUTER_FACTORIES.has(calleeName)) {
        found.push({ kind: "call", name: calleeName, line: lineOf(node) });
      }

      const first = node.arguments[0];

      if (
        calleeName === "createElement" &&
        first &&
        ((ts.isIdentifier(first) && ROUTER_ELEMENTS.has(first.text)) ||
          (ts.isPropertyAccessExpression(first) &&
            ROUTER_ELEMENTS.has(first.name.text)))
      ) {
        found.push({
          kind: "call",
          name: `createElement(${first.getText()})`,
          line: lineOf(node),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return found;
}

/*
 * The modules a source imports, as written: static imports and exports
 * `from` a module, `import("...")` and `require("...")` of a literal name.
 */
function importsOf(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
  const found = [];

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const first = node.arguments[0];
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";

      if (
        (isImport || isRequire) &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
      ) {
        found.push(first.text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return found;
}

const SOURCE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];

// The file a relative import names, or null when it is not one on disk.
function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => {
      return base + extension;
    }),
    ...SOURCE_EXTENSIONS.map((extension) => {
      return path.join(base, `index${extension}`);
    }),
  ];

  for (const candidate of candidates) {
    if (
      SOURCE_EXTENSIONS.includes(path.extname(candidate)) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return candidate;
    }
  }

  return null;
}

/*
 * Every module a file reaches through relative imports that stay inside
 * `root` (a fixture's own modules), the file itself included.
 */
function ownModulesOf(file, root) {
  const seen = new Set();
  const queue = [path.resolve(file)];

  while (queue.length > 0) {
    const current = queue.shift();

    if (seen.has(current)) {
      continue;
    }

    seen.add(current);

    for (const specifier of importsOf(
      current,
      fs.readFileSync(current, "utf8"),
    )) {
      const resolved = resolveRelative(current, specifier);

      if (
        resolved &&
        !resolved.split(path.sep).includes("node_modules") &&
        resolved.startsWith(path.resolve(root) + path.sep)
      ) {
        queue.push(resolved);
      }
    }
  }

  return [...seen].sort();
}

module.exports = {
  ROUTER_ELEMENTS,
  ROUTER_FACTORIES,
  routersOf,
  importsOf,
  ownModulesOf,
};
