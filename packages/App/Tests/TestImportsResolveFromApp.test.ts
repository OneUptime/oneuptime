import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import module from "module";
import path from "path";
import ts from "typescript";

/*
 * An App test may only import a package App can actually resolve.
 *
 * This is the guard for a failure that jest structurally cannot catch. App's
 * suite runs transpile-only (jest.config.json, isolatedModules), so a
 * type-only import is ERASED before anything asks the resolver for it:
 *
 *     import { FindOperator } from "typeorm";   // used only as a type
 *
 * App Test goes green. Nothing is wrong at runtime, and nothing ever will be.
 * But tsc does resolve it, and typeorm is Common's dependency, not App's - so
 * the same line fails `npm run compile` in packages/App, which three
 * workflows run: Compile (compile-services), Build (docker-build-app, on pull
 * requests) and Push Test Images (app-docker-image-build, on master). The last
 * two are Docker builds, so the report is a failed image layer twenty-odd
 * minutes after the push, and the commit that caused it already merged on a
 * green App Test.
 *
 * That is exactly how master broke, and the shape of it is not obvious from
 * the failure: a passing test suite and three failing builds, all from one
 * import that does nothing at runtime.
 *
 * The sibling guard, FeatureSetImportsStayReactFree.test.ts, covers the other
 * half of the same boundary - a FeatureSet module an App test reaches, which
 * jest cannot load. It reads every import form for that, including require()
 * and jest.mock(); this one deliberately reads fewer (see below).
 */

const TESTS_DIR: string = __dirname;
const APP_DIR: string = path.join(__dirname, "..");
const APP_NODE_MODULES: string = path.join(APP_DIR, "node_modules");

/*
 * Only the forms TYPE-CHECKING resolves as a module, which is the whole point:
 * the check has to match what tsc does, not what the runtime does.
 *
 * `require("x")` and `jest.mock("x", ...)` are deliberately NOT read. They are
 * ordinary calls taking a string, and tsc never resolves their argument, so a
 * package named there needs no declaration. Both appear in App's tests for
 * good reasons and neither is a problem:
 *
 *   - Tests/Telemetry/ProcessTelemetry*.test.ts mock "isolated-vm", which App
 *     does not install, to keep the module out of the test entirely.
 *   - Tests/Fixtures/EnterpriseModules/BrokenRequire requires a package that
 *     is MEANT not to exist, so the enterprise loader can be tested against a
 *     module that fails to load.
 *
 * Reading those as imports would report both as offenders, which is why this
 * reader is narrower than the sibling guard's.
 */
function readTypeResolvedImports(
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
      node.expression.kind === ts.SyntaxKind.ImportKeyword
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
 * Every .ts/.tsx under Tests, not only *.test.ts: App's tsconfig compiles the
 * whole directory, so a shared fixture importing something unresolvable breaks
 * the same three jobs as a test file does.
 */
function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      found.push(...listSourceFiles(full));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
}

/*
 * The specifiers jest rewrites before resolving them: "Common/*" to the Common
 * package (tsconfig paths does the same for tsc), plus the asset stubs and the
 * community stand-ins for the enterprise dashboards. None of them is a package
 * App installs, and none of them needs to be.
 */
const MAPPED_SPECIFIERS: Array<RegExp> = Object.keys(
  (
    JSON.parse(
      fs.readFileSync(path.join(APP_DIR, "jest.config.json"), "utf8"),
    ) as { moduleNameMapper?: Record<string, string> }
  ).moduleNameMapper ?? {},
).map((pattern: string): RegExp => {
  return new RegExp(pattern);
});

/** `@scope/name/deep/path` and `name/deep/path` both resolve via their package. */
function packageNameOf(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function isCheckable(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) {
    return false;
  }

  if (
    MAPPED_SPECIFIERS.some((pattern: RegExp): boolean => {
      return pattern.test(specifier);
    })
  ) {
    return false;
  }

  return !module.isBuiltin(packageNameOf(specifier));
}

/*
 * Resolved the way tsc's node resolution starts: the package directory has to
 * exist under packages/App/node_modules with a package.json. Checked there and
 * not by walking up to the repo root, because the repo root is where this
 * hides - root package.json DOES depend on typeorm, so a walk-up finds it on a
 * developer machine that has run the root install, and CI's Compile App step,
 * whose job installs no root dependencies, still fails.
 */
function resolvesFromApp(specifier: string): boolean {
  return fs.existsSync(
    path.join(APP_NODE_MODULES, packageNameOf(specifier), "package.json"),
  );
}

interface Offender {
  specifier: string;
  file: string;
}

describe("every package an App test imports is one App can resolve", () => {
  const files: Array<string> = listSourceFiles(TESTS_DIR);

  test("the scan found App's tests at all", () => {
    /*
     * Guards the guard: a path or extension slip that matched nothing would
     * leave every assertion below passing over an empty set.
     */
    expect(files.length).toBeGreaterThan(100);
  });

  test("App's node_modules is installed, or this proves nothing", () => {
    /*
     * The check is "is it on disk", so an uninstalled App would report every
     * import as an offender. Jest could not have loaded this file in that
     * state, but the assertion says so rather than leaving it implied.
     */
    expect(fs.existsSync(APP_NODE_MODULES)).toBe(true);
  });

  test("no import needs a package App does not have", () => {
    const offenders: Array<Offender> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const specifier of readTypeResolvedImports(file, source)) {
        if (!isCheckable(specifier) || resolvesFromApp(specifier)) {
          continue;
        }

        offenders.push({
          specifier: specifier,
          file: path.relative(APP_DIR, file),
        });
      }
    }

    /*
     * The offenders ARE the message: jest prints the received array, so a
     * failure names the package and the file. The fix is to stop needing it -
     * a type-only import of a Common-only package becomes a local structural
     * type, which is all such a test ever relies on.
     */
    expect(offenders).toEqual([]);
  });

  test("a package App does not install is caught, not waved through", () => {
    /*
     * Proves the check discriminates, against the real import that broke
     * master. typeorm is Common's, never App's, so this must stay true - and
     * if App ever does depend on typeorm, this fails and says to drop the
     * case rather than quietly passing.
     */
    expect(isCheckable("typeorm")).toBe(true);
    expect(resolvesFromApp("typeorm")).toBe(false);

    const offenders: Array<string> = readTypeResolvedImports(
      path.join(TESTS_DIR, "TypeOnlyImportFixture.ts"),
      'import { FindOperator } from "typeorm";\nexport type T = FindOperator<unknown>;\n',
    ).filter((specifier: string): boolean => {
      return isCheckable(specifier) && !resolvesFromApp(specifier);
    });

    expect(offenders).toEqual(["typeorm"]);
  });

  test("the reader skips what tsc never resolves", () => {
    /*
     * require() and jest.mock() take a string tsc does not resolve, and both
     * are used with packages App does not install. Reading them would make
     * this guard fail on code that is correct.
     */
    const specifiers: Array<string> = readTypeResolvedImports(
      "ReaderFixture.ts",
      [
        'import value from "read-static-import";',
        'import type { T } from "read-type-only-import";',
        'export { value } from "read-export-from";',
        'const lazy = import("read-dynamic-import");',
        'type Deep = import("read-import-type").Deep;',
        'import legacy = require("read-import-equals");',
        'const skipped = require("skip-require");',
        'jest.mock("skip-jest-mock", () => {});',
        'const alsoSkipped = jest.requireActual("skip-require-actual");',
        'const assertion = `from "skip-string-literal"`;',
        '// import "skip-line-comment";',
      ].join("\n"),
    );

    expect(specifiers).toEqual([
      "read-static-import",
      "read-type-only-import",
      "read-export-from",
      "read-dynamic-import",
      "read-import-type",
      "read-import-equals",
    ]);
  });

  test("Common's own modules stay out of it", () => {
    /*
     * "Common/*" is the one bare-looking specifier App's tests use constantly,
     * and it is rewritten rather than resolved from node_modules. Treating it
     * as a package would report almost every test file.
     */
    expect(isCheckable("Common/Server/Utils/Express")).toBe(false);
    expect(isCheckable("Common/Types/JSON")).toBe(false);
  });
});
