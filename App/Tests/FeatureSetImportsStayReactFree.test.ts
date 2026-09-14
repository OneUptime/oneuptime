import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * App has no react, by design.
 *
 * FeatureSet/Dashboard (and Accounts, AdminDashboard, StatusPage,
 * PublicDashboard, BrowserRecorder) each own their own react and their own
 * compile job; App/tsconfig.json excludes them, App's package.json does not
 * depend on react, and CI installs node_modules for Common and App only.
 *
 * A test that imports a component therefore fails twice over: jest cannot
 * resolve react, and tsc pulls the whole component graph into App's program
 * through the test file - `exclude` stops the initial glob, not a file an
 * included file imports. That is exactly how "Cannot find module 'react'"
 * took out both App Test and Compile on master, from three test files that
 * wanted pure exports which happened to live beside a view.
 *
 * The fix each time is the same: move the pure half into a React-free
 * sibling and have the component re-export it. This guard is what makes that
 * the obvious move rather than a lesson re-learned - it fails HERE, in
 * seconds, naming the test and the import, instead of in CI twenty minutes
 * later with a resolver stack trace.
 */

const TESTS_DIR: string = __dirname;
const APP_DIR: string = path.join(__dirname, "..");

/* An opening tag: the cheapest reliable sign a file really is JSX. */
const JSX_PATTERN: RegExp = /<[A-Za-z/>]/;

/* A module that imports React is a module App cannot load. */
const REACT_MODULES: ReadonlySet<string> = new Set<string>([
  "react",
  "react-dom",
  "react-router-dom",
  "react-i18next",
  "reactflow",
  "recharts",
  "react-beautiful-dnd",
]);

function listFiles(directory: string, suffix: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__mocks__") {
        continue;
      }
      found.push(...listFiles(full, suffix));
      continue;
    }

    if (entry.name.endsWith(suffix)) {
      found.push(full);
    }
  }

  return found;
}

function readImportsFromSource(
  filePath: string,
  source: string,
): Array<string> {
  const specifiers: Array<string> = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require") ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === "jest" &&
          (node.expression.name.text === "requireActual" ||
            node.expression.name.text === "requireMock")))
    ) {
      const moduleSpecifier: ts.Expression | undefined = node.arguments[0];

      if (moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier)) {
        specifiers.push(moduleSpecifier.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifiers;
}

/*
 * Parse actual syntax instead of looking for the words "from" or "import".
 * Source-wiring tests frequently assert against import-shaped strings; those
 * are evidence about another file, not dependencies of the test itself.
 */
function readImports(filePath: string): Array<string> {
  return readImportsFromSource(filePath, fs.readFileSync(filePath, "utf8"));
}

function isReactImport(specifier: string): boolean {
  return Array.from(REACT_MODULES).some((moduleName: string): boolean => {
    return specifier === moduleName || specifier.startsWith(`${moduleName}/`);
  });
}

/* Resolve a relative specifier the way ts-jest does: .ts, .tsx, or /index. */
function resolveRelative(fromFile: string, specifier: string): string | null {
  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function isFeatureSetFile(filePath: string): boolean {
  return filePath.startsWith(path.join(APP_DIR, "FeatureSet"));
}

function relativeToApp(filePath: string): string {
  return path.relative(APP_DIR, filePath);
}

/*
 * Every FeatureSet module an App test can reach, with the chain that got
 * there. Only relative imports are followed: "Common/*" is mapped to Common,
 * which DOES have react installed and which App's compile resolves fine.
 */
function reachableFeatureSetModules(): Map<string, Array<string>> {
  const reached: Map<string, Array<string>> = new Map<string, Array<string>>();
  const queue: Array<{ file: string; chain: Array<string> }> = [];

  for (const testFile of listFiles(TESTS_DIR, ".test.ts").concat(
    listFiles(TESTS_DIR, ".test.tsx"),
  )) {
    for (const specifier of readImports(testFile)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const resolved: string | null = resolveRelative(testFile, specifier);

      if (resolved && isFeatureSetFile(resolved)) {
        queue.push({
          file: resolved,
          chain: [relativeToApp(testFile), relativeToApp(resolved)],
        });
      }
    }
  }

  while (queue.length > 0) {
    const next: { file: string; chain: Array<string> } = queue.pop()!;

    if (reached.has(next.file)) {
      continue;
    }

    reached.set(next.file, next.chain);

    for (const specifier of readImports(next.file)) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const resolved: string | null = resolveRelative(next.file, specifier);

      if (resolved && isFeatureSetFile(resolved) && !reached.has(resolved)) {
        queue.push({
          file: resolved,
          chain: [...next.chain, relativeToApp(resolved)],
        });
      }
    }
  }

  return reached;
}

describe("App tests never reach a React module", () => {
  const reachable: Map<string, Array<string>> = reachableFeatureSetModules();

  test("the import reader ignores import-shaped strings and comments", () => {
    const specifiers: Array<string> = readImportsFromSource(
      "ImportReaderFixture.ts",
      [
        'import value from "./actual-import";',
        'export { value } from "./actual-export";',
        'const lazy = import("./actual-dynamic-import");',
        "const lazyTemplate = import(`./actual-template-import`);",
        'type Imported = import("./actual-import-type").Imported;',
        'const required = require("./actual-require");',
        "const requiredTemplate = require(`./actual-template-require`);",
        'const actual = jest.requireActual("./actual-jest-require-actual");',
        "const mocked = jest.requireMock(`./actual-jest-require-mock`);",
        'const assertion = `from "./string-literal"`;',
        '// import "./line-comment";',
        '/* export { value } from "./block-comment"; */',
      ].join("\n"),
    );

    expect(specifiers).toEqual([
      "./actual-import",
      "./actual-export",
      "./actual-dynamic-import",
      "./actual-template-import",
      "./actual-import-type",
      "./actual-require",
      "./actual-template-require",
      "./actual-jest-require-actual",
      "./actual-jest-require-mock",
    ]);
  });

  test("standalone recorder suites stay in their own Jest projects", () => {
    const jestConfig: { testPathIgnorePatterns?: Array<string> } = JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "jest.config.json"), "utf8"),
    ) as { testPathIgnorePatterns?: Array<string> };

    expect(jestConfig.testPathIgnorePatterns).toEqual(
      expect.arrayContaining([
        "FeatureSet/BrowserRecorder",
        "FeatureSet/MobileRecorder",
      ]),
    );
  });

  test("the scan actually found something to check", () => {
    /*
     * Guards the guard: a resolver change that quietly matched nothing would
     * leave this file passing while checking an empty set.
     */
    expect(reachable.size).toBeGreaterThan(50);
  });

  test("no FeatureSet module an App test can reach imports React", () => {
    const offenders: Array<string> = [];

    for (const [file, chain] of reachable) {
      if (readImports(file).some(isReactImport)) {
        offenders.push(chain.join("\n    -> "));
      }
    }

    /*
     * The chains ARE the message: jest prints the received array, so a
     * failure names every test and the exact hop that reaches React. The fix
     * is always the same - move the pure half into a React-free sibling,
     * re-export it from the component, and import the sibling here.
     */
    expect(offenders).toEqual([]);
  });

  test("a .tsx module an App test can reach must actually contain JSX", () => {
    /*
     * A .tsx extension on a file with no JSX is how a module App CAN load
     * ends up looking like one it cannot: the next person moving a pure
     * export out of a component sees a .tsx in the chain and assumes the
     * boundary is already broken. Nothing about it is wrong at runtime, so
     * this is a naming rule rather than a resolution one.
     */
    const offenders: Array<string> = [];

    for (const [file] of reachable) {
      if (!file.endsWith(".tsx")) {
        continue;
      }

      if (!JSX_PATTERN.test(fs.readFileSync(file, "utf8"))) {
        offenders.push(relativeToApp(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
