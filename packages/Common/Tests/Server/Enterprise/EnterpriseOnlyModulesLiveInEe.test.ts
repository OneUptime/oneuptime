import { SeatUsage } from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import * as CoreRedisHealth from "../../../Server/Utils/InstanceHealth/RedisHealth";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Enterprise-only implementation that used to sit in core and now lives in
 * ee/, next to its only callers:
 *
 *   PostgresHealth (the PostgreSQL probes)   -> ee/Server/Workers/InstanceHealth/
 *   RedisHealth's counter-delta half         -> ee/Server/Workers/InstanceHealth/
 *   EnterpriseLicenseSeats (seat arithmetic) -> ee/Server/License/
 *   EnterpriseLicenseSync (response mapper)  -> ee/Server/License/
 *
 * The Community image is built with ee/ removed, and it must not carry
 * Enterprise code under the Apache license. So this suite pins that the moved
 * modules are gone from core, that no core file loads them again, and that
 * core kept exactly what core itself uses: RedisHealth's INFO half (the admin
 * health API) and the SeatUsage type (EnterpriseEdition.getSeatUsage()).
 *
 * It runs in the Common test job, where ee/ is deleted, so it reads only
 * packages/.
 */

const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const PACKAGES_DIR: string = path.resolve(COMMON_DIR, "..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const APP_DIR: string = path.join(PACKAGES_DIR, "App");

interface MovedModule {
  // Repository-relative, without extension: where the module used to be.
  corePath: string;
  // Repository-relative: where it lives now.
  eePath: string;
}

const MOVED_MODULES: ReadonlyArray<MovedModule> = [
  {
    corePath: "packages/Common/Server/Utils/InstanceHealth/PostgresHealth",
    eePath: "ee/Server/Workers/InstanceHealth/PostgresHealth.ts",
  },
  {
    corePath: "packages/Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats",
    eePath: "ee/Server/License/EnterpriseLicenseSeats.ts",
  },
  {
    corePath: "packages/Common/Utils/EnterpriseLicense/EnterpriseLicenseSync",
    eePath: "ee/Server/License/EnterpriseLicenseSync.ts",
  },
];

// The tests moved with the modules (to ee/Tests/Server/...).
const MOVED_TESTS: ReadonlyArray<string> = [
  "packages/Common/Tests/Server/Utils/InstanceHealth/PostgresHealth.test.ts",
  "packages/Common/Tests/Utils/EnterpriseLicenseSeats.test.ts",
  "packages/Common/Tests/Utils/EnterpriseLicenseSync.test.ts",
];

const CORE_REDIS_HEALTH: string =
  "packages/Common/Server/Utils/InstanceHealth/RedisHealth";

// What core's RedisHealth keeps: the INFO read the admin health API shows.
const CORE_REDIS_EXPORTS: ReadonlyArray<string> = [
  "parseRedisInfo",
  "buildRedisInfoSnapshot",
  "readInfoSnapshot",
  "getRedisInfoSnapshot",
];

// What moved to ee/Server/Workers/InstanceHealth/RedisHealth.ts.
const EE_ONLY_REDIS_EXPORTS: ReadonlyArray<string> = [
  "getRedisHealthSnapshot",
  "shouldRollCounterSamples",
  "getCounterDelta",
  "COUNTER_WINDOW_IN_SECONDS",
  "RedisHealthSnapshot",
  "RedisCounterSample",
  "RedisCounterSamples",
];

/*
 * The Redis key the Enterprise worker keeps its counter baseline under. Built
 * from pieces so this file does not itself contain the literal it looks for.
 */
const COUNTER_SAMPLE_KEY: string = [
  "oneuptime",
  "instance",
  "health",
  "redis",
  "sample",
].join("-");

const SOURCE_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

// A JavaScript file (.js, .cjs, .mjs), parsed as JS rather than TS.
const JS_FILE: RegExp = /\.(c|m)?js$/;

// Any source extension, as stripped from a resolved module path.
const SOURCE_EXTENSION: RegExp = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  ".git",
  "coverage",
]);

/*
 * Cheap prefilter: a file that names none of the moved modules (or core's
 * RedisHealth, for the named-import check) cannot load them, so it is not
 * parsed.
 */
const MAY_REFERENCE_MOVED_MODULE: RegExp =
  /PostgresHealth|EnterpriseLicenseSeats|EnterpriseLicenseSync|RedisHealth/;

function toRepositoryPath(filePath: string): string {
  return path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join("/");
}

function isSourceFile(fileName: string): boolean {
  if (fileName.endsWith(".d.ts")) {
    return false;
  }

  return SOURCE_EXTENSIONS.some((extension: string): boolean => {
    return fileName.endsWith(extension);
  });
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listSourceFiles(fullPath));
      }
      continue;
    }

    if (entry.isFile() && isSourceFile(entry.name)) {
      found.push(fullPath);
    }
  }

  return found;
}

function getScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (JS_FILE.test(fileName)) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function stripSourceExtension(modulePath: string): string {
  return modulePath.replace(SOURCE_EXTENSION, "");
}

/*
 * The repository-relative module path a specifier loads, without extension,
 * or null for a package outside the repository. "Common/..." and "App/..."
 * are the package specifiers core and ee use for packages/Common and
 * packages/App.
 */
function resolveSpecifier(
  importingFile: string,
  specifier: string,
): string | null {
  const normalized: string = specifier.split("\\").join("/");
  let absolute: string | null = null;

  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    absolute = path.resolve(path.dirname(importingFile), normalized);
  } else if (normalized.startsWith("Common/")) {
    absolute = path.join(COMMON_DIR, normalized.slice("Common/".length));
  } else if (normalized.startsWith("App/")) {
    absolute = path.join(APP_DIR, normalized.slice("App/".length));
  }

  if (!absolute) {
    return null;
  }

  return stripSourceExtension(toRepositoryPath(absolute));
}

function isRequireLikeCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }

  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "require";
  }

  /*
   * jest.mock / doMock / requireActual / requireMock of a module that no
   * longer exists in core is a stale reference too.
   */
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "jest" &&
    ["mock", "doMock", "requireActual", "requireMock"].includes(
      node.expression.name.text,
    )
  );
}

interface ModuleReference {
  specifier: string;
  // Names imported with `import { a, b as c } from ...` (a and b).
  importedNames: Array<string>;
}

/*
 * Every module a file references, read from the TypeScript AST so that
 * import-shaped text in strings and comments (this file has plenty) is never
 * mistaken for a dependency.
 */
function readModuleReferences(
  fileName: string,
  source: string,
): Array<ModuleReference> {
  const references: Array<ModuleReference> = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(fileName),
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const importedNames: Array<string> = [];
      const bindings: ts.NamedImportBindings | undefined =
        node.importClause?.namedBindings;

      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          importedNames.push((element.propertyName || element.name).text);
        }
      }

      references.push({
        specifier: node.moduleSpecifier.text,
        importedNames,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const importedNames: Array<string> = [];

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          importedNames.push((element.propertyName || element.name).text);
        }
      }

      references.push({
        specifier: node.moduleSpecifier.text,
        importedNames,
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      references.push({
        specifier: node.moduleReference.expression.text,
        importedNames: [],
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({
        specifier: node.argument.literal.text,
        importedNames:
          node.qualifier && ts.isIdentifier(node.qualifier)
            ? [node.qualifier.text]
            : [],
      });
    } else if (ts.isCallExpression(node) && isRequireLikeCall(node)) {
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
        references.push({ specifier: firstArgument.text, importedNames: [] });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return references;
}

const MOVED_CORE_PATHS: ReadonlySet<string> = new Set<string>(
  MOVED_MODULES.map((moved: MovedModule): string => {
    return moved.corePath;
  }),
);

/*
 * Each way a core file (repository-relative path) could still depend on the
 * moved code: loading a moved module, or importing an ee-only name from
 * core's RedisHealth.
 */
function findMovedModuleReferences(
  repositoryPath: string,
  source: string,
): Array<string> {
  const violations: Array<string> = [];
  const absolutePath: string = path.join(REPOSITORY_ROOT, repositoryPath);

  for (const reference of readModuleReferences(repositoryPath, source)) {
    const resolved: string | null = resolveSpecifier(
      absolutePath,
      reference.specifier,
    );

    if (!resolved) {
      continue;
    }

    if (MOVED_CORE_PATHS.has(resolved)) {
      violations.push(`${repositoryPath} -> ${reference.specifier}`);
      continue;
    }

    if (resolved === CORE_REDIS_HEALTH) {
      for (const name of reference.importedNames) {
        if (EE_ONLY_REDIS_EXPORTS.includes(name)) {
          violations.push(
            `${repositoryPath} -> ${name} from ${reference.specifier}`,
          );
        }
      }
    }
  }

  return violations;
}

interface CoreScanResult {
  scannedFiles: number;
  violations: Array<string>;
  filesWithCounterSampleKey: Array<string>;
}

let cachedCoreScan: CoreScanResult | null = null;

// Reads every source file under packages/ once per run.
function scanCore(): CoreScanResult {
  if (cachedCoreScan) {
    return cachedCoreScan;
  }

  const files: Array<string> = listSourceFiles(PACKAGES_DIR);
  const violations: Array<string> = [];
  const filesWithCounterSampleKey: Array<string> = [];

  for (const filePath of files) {
    const source: string = fs.readFileSync(filePath, "utf8");
    const repositoryPath: string = toRepositoryPath(filePath);

    if (source.includes(COUNTER_SAMPLE_KEY)) {
      filesWithCounterSampleKey.push(repositoryPath);
    }

    if (!MAY_REFERENCE_MOVED_MODULE.test(source)) {
      continue;
    }

    violations.push(...findMovedModuleReferences(repositoryPath, source));
  }

  cachedCoreScan = {
    scannedFiles: files.length,
    violations,
    filesWithCounterSampleKey,
  };

  return cachedCoreScan;
}

describe("the moved-module scanner's own machinery", () => {
  const FIXTURE: string = "packages/Common/Server/Enterprise/Fixture.ts";

  test("flags every way of loading a moved module", () => {
    const violations: Array<string> = findMovedModuleReferences(
      FIXTURE,
      [
        'import { getPostgresHealthSnapshot } from "Common/Server/Utils/InstanceHealth/PostgresHealth";',
        'import type { SeatUsage } from "../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";',
        'export * from "../../Utils/EnterpriseLicense/EnterpriseLicenseSync.ts";',
        'const lazy = import("Common/Utils/EnterpriseLicense/EnterpriseLicenseSync");',
        'const required = require("../../Utils/EnterpriseLicense/EnterpriseLicenseSeats.js");',
        'type T = import("Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats").SeatUsage;',
        'import Postgres = require("../Utils/InstanceHealth/PostgresHealth");',
        'jest.mock("Common/Server/Utils/InstanceHealth/PostgresHealth", () => { return {}; });',
      ].join("\n"),
    );

    expect(violations).toEqual([
      `${FIXTURE} -> Common/Server/Utils/InstanceHealth/PostgresHealth`,
      `${FIXTURE} -> ../../Utils/EnterpriseLicense/EnterpriseLicenseSeats`,
      `${FIXTURE} -> ../../Utils/EnterpriseLicense/EnterpriseLicenseSync.ts`,
      `${FIXTURE} -> Common/Utils/EnterpriseLicense/EnterpriseLicenseSync`,
      `${FIXTURE} -> ../../Utils/EnterpriseLicense/EnterpriseLicenseSeats.js`,
      `${FIXTURE} -> Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats`,
      `${FIXTURE} -> ../Utils/InstanceHealth/PostgresHealth`,
      `${FIXTURE} -> Common/Server/Utils/InstanceHealth/PostgresHealth`,
    ]);
  });

  test("flags an ee-only name imported from core's RedisHealth", () => {
    expect(
      findMovedModuleReferences(
        FIXTURE,
        [
          'import { getRedisHealthSnapshot, getRedisInfoSnapshot } from "Common/Server/Utils/InstanceHealth/RedisHealth";',
          'export { COUNTER_WINDOW_IN_SECONDS as W } from "../Utils/InstanceHealth/RedisHealth";',
        ].join("\n"),
      ),
    ).toEqual([
      `${FIXTURE} -> getRedisHealthSnapshot from Common/Server/Utils/InstanceHealth/RedisHealth`,
      `${FIXTURE} -> COUNTER_WINDOW_IN_SECONDS from ../Utils/InstanceHealth/RedisHealth`,
    ]);
  });

  test("ignores what stays in core, and import-shaped text", () => {
    expect(
      findMovedModuleReferences(
        FIXTURE,
        [
          'import { getRedisInfoSnapshot, parseRedisInfo, readInfoSnapshot } from "Common/Server/Utils/InstanceHealth/RedisHealth";',
          'import EnterpriseLicenseUsageUtil from "../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";',
          'import { SeatUsage } from "./EnterpriseLicenseSnapshot";',
          // Resolves to packages/Common/Server/PostgresHealth, not a moved module.
          'import Other from "../PostgresHealth";',
          'import Package from "PostgresHealth";',
          '// import "Common/Server/Utils/InstanceHealth/PostgresHealth";',
          '/* export * from "Common/Utils/EnterpriseLicense/EnterpriseLicenseSync"; */',
          'const text: string = "Common/Utils/EnterpriseLicense/EnterpriseLicenseSeats";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("Enterprise-only modules live in ee/, not core", () => {
  test.each(
    MOVED_MODULES.map((moved: MovedModule): [string, string] => {
      return [moved.corePath, moved.eePath];
    }),
  )("%s is gone from core (it lives at %s)", (corePath: string) => {
    for (const extension of SOURCE_EXTENSIONS) {
      expect(
        fs.existsSync(path.join(REPOSITORY_ROOT, `${corePath}${extension}`)),
      ).toBe(false);
    }

    // Nor as a directory module (<path>/index.ts).
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, corePath))).toBe(false);
  });

  test.each(
    MOVED_TESTS.map((testPath: string): [string] => {
      return [testPath];
    }),
  )("%s moved to ee/Tests with its module", (testPath: string) => {
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, testPath))).toBe(false);
  });

  test("no core source loads a moved module or an ee-only RedisHealth name", () => {
    const result: CoreScanResult = scanCore();

    // A sanity floor, so an empty or misrooted scan cannot pass vacuously.
    expect(result.scannedFiles).toBeGreaterThan(1000);
    expect(result.violations).toEqual([]);
  });

  /*
   * The counter baseline is the Enterprise worker's state. Core reading or
   * writing that key again would mean the delta logic crept back.
   */
  test("no core source touches the Enterprise worker's Redis counter baseline", () => {
    expect(scanCore().filesWithCounterSampleKey).toEqual([]);
  });

  test("core's RedisHealth keeps the INFO half the admin health API uses", () => {
    const exported: Record<string, unknown> = CoreRedisHealth as Record<
      string,
      unknown
    >;

    for (const name of CORE_REDIS_EXPORTS) {
      expect(typeof exported[name]).toBe("function");
    }

    for (const name of EE_ONLY_REDIS_EXPORTS) {
      expect(exported[name]).toBeUndefined();
    }
  });

  test("core's RedisHealth has no counter-sample code left", () => {
    const source: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, `${CORE_REDIS_HEALTH}.ts`),
      "utf8",
    );

    for (const name of EE_ONLY_REDIS_EXPORTS) {
      expect(source).not.toContain(name);
    }
    expect(source).not.toMatch(/COUNTER_SAMPLE|client\.(get|set|expire)\(/);
  });

  /*
   * EnterpriseEdition.getSeatUsage() and the /global-config/license response
   * hand SeatUsage to core code, so the type stayed in core when the
   * arithmetic moved. This is a compile-time check as much as a runtime one:
   * ts-jest type-checks this file.
   */
  test("SeatUsage is declared in core's EnterpriseLicenseSnapshot", () => {
    const usage: SeatUsage = {
      isEnforced: true,
      userLimit: 10,
      seatsInUse: 4,
      seatsRemaining: 6,
      hasSeatForNewUser: true,
      seatsUsedByOtherInstances: 0,
    };

    expect(usage.seatsRemaining).toBe(6);

    const source: string = fs.readFileSync(
      path.join(
        COMMON_DIR,
        "Server",
        "Enterprise",
        "EnterpriseLicenseSnapshot.ts",
      ),
      "utf8",
    );

    expect(source).toMatch(/export interface SeatUsage \{/);
  });
});
