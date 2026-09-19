import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";

/*
 * The Enterprise Edition boundary, enforced on every source file in packages/.
 *
 * Enterprise code lives in the top-level ee/ directory under its own license,
 * and the Community image is built with ee/ removed. So core must never depend
 * on it: an import of ee/ from core is at best a Community build that fails to
 * bundle, and at worst Enterprise code shipped inside the Apache-licensed
 * image. The one door is each frontend's src/Enterprise/Plugins.ts, which
 * imports a bare plugin specifier ("@oneuptime/ee-dashboard" /
 * "@oneuptime/ee-admin-dashboard") that the build resolves to either the
 * Community stub or the ee plugin.
 *
 * eslint's no-restricted-imports (eslint.config.js) states the same rule, but
 * it sees only static import/export declarations in TypeScript files. This
 * test also catches require() (and require.resolve, module.require and the
 * require createRequire() returns), dynamic import(), import.meta.resolve,
 * import types, jest.requireActual/requireMock/createMockFromModule and .js
 * files, and it runs in the App Test job rather than only in lint. It also
 * reads every tsconfig, jest.config.json and package.json under packages/,
 * because configuration can point a build into ee/ without any import.
 *
 * The App Test job runs with ee/ deleted, so the checks that need ee/ (what
 * ee/ imports, and the ee UI plugins' module-load reads) are gated on its
 * presence and run in the Enterprise Edition Test workflow (test.ee.yaml),
 * which runs this file with ee/ in the checkout.
 *
 * It also pins the rule that keeps the Enterprise bundle loadable: the
 * plugins are read inside render/function bodies only, never while a module
 * is still evaluating (see src/Enterprise/Plugins.ts for the import cycle
 * that makes a top-level read crash the whole Enterprise bundle).
 *
 * Import specifiers are read from the TypeScript AST, never by searching for
 * "import" or "from": tests routinely hold import-shaped strings (this one
 * does) and those are not dependencies.
 */

const APP_DIR: string = path.resolve(__dirname, "..");
const PACKAGES_DIR: string = path.resolve(APP_DIR, "..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPOSITORY_ROOT, "ee");

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

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  ".git",
  "coverage",
]);

// A path segment that is exactly "ee": "../../ee/Dashboard", "/usr/src/ee".
const EE_PATH_SEGMENT: RegExp = /(^|\/)ee(\/|$)/;
// "@oneuptime/ee" (the ee package) and "@oneuptime/ee-*" (the UI plugins).
const EE_PACKAGE: RegExp = /^@oneuptime\/ee($|[-/])/;
// ee/ must reach core through mapped specifiers, never "../packages/...".
const RELATIVE_INTO_PACKAGES: RegExp = /^(\.\/)?(\.\.\/)+packages(\/|$)/;
/*
 * Cheap prefilter: a file whose text cannot hold an ee specifier is not
 * parsed. Every specifier EE_PATH_SEGMENT or EE_PACKAGE matches contains one
 * of these shapes, so the prefilter never hides a violation.
 */
const MAY_REFERENCE_EE: RegExp = /(^|["'`/\\])ee(["'`/\\]|$)|@oneuptime\/ee/m;
const MAY_REFERENCE_PACKAGES: RegExp = /packages/;

interface PluginEntryAllowance {
  file: string;
  specifier: string;
}

// The two doors, each for exactly its own specifier.
const PLUGIN_ENTRY_ALLOWANCES: ReadonlyArray<PluginEntryAllowance> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Enterprise/Plugins.ts",
    specifier: "@oneuptime/ee-dashboard",
  },
  {
    file: "packages/App/FeatureSet/AdminDashboard/src/Enterprise/Plugins.ts",
    specifier: "@oneuptime/ee-admin-dashboard",
  },
];

const FRONTEND_SOURCE_DIRECTORIES: ReadonlyArray<string> = [
  path.join(APP_DIR, "FeatureSet", "Dashboard", "src"),
  path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src"),
];

// The ee UI plugins, which read the same accessors as the frontends.
const ENTERPRISE_UI_DIRECTORIES: ReadonlyArray<string> = [
  path.join(EE_DIR, "Dashboard"),
  path.join(EE_DIR, "AdminDashboard"),
];

// The configuration files that can point a build or a test run into ee/.
const CONFIG_FILE_NAME: RegExp =
  /^(?:tsconfig.*\.json|jest\.config\.json|package\.json)$/;
const TSCONFIG_FILE_NAME: RegExp = /^tsconfig.*\.json$/;
/*
 * "@oneuptime/ee" and "@oneuptime/ee-*" anywhere in a config string, so the
 * anchored jest key "^@oneuptime/ee-dashboard$" counts too.
 */
const CONFIG_EE_PACKAGE: RegExp = /@oneuptime\/ee(?![A-Za-z0-9_.])/;
/*
 * Splits a config string into path-like tokens: "cd ../../ee && npm test",
 * "file:../../ee" and "<rootDir>/../../ee/X" each yield their ee path.
 */
const CONFIG_TOKEN_SEPARATORS: RegExp = /[\s"'`=,;:()[\]{}|&<>]+/;

interface CommunityPluginStub {
  specifier: string;
  stub: string;
}

/*
 * The only ee references configuration may hold: each plugin specifier
 * mapped to its own frontend's Community stub (the mappings
 * EnterprisePluginResolution.test.ts pins in the tsconfig paths and the jest
 * moduleNameMapper).
 */
const COMMUNITY_PLUGIN_STUBS: ReadonlyArray<CommunityPluginStub> = [
  {
    specifier: "@oneuptime/ee-dashboard",
    stub: path.join(
      APP_DIR,
      "FeatureSet",
      "Dashboard",
      "src",
      "Enterprise",
      "CommunityPlugins.ts",
    ),
  },
  {
    specifier: "@oneuptime/ee-admin-dashboard",
    stub: path.join(
      APP_DIR,
      "FeatureSet",
      "AdminDashboard",
      "src",
      "Enterprise",
      "CommunityPlugins.ts",
    ),
  },
];

const PLUGIN_ACCESSORS: ReadonlyArray<string> = [
  "getDashboardPlugins",
  "getAdminDashboardPlugins",
];

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

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      found.push(...listSourceFiles(fullPath));
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

  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".mjs") ||
    fileName.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(fileName),
  );
}

/*
 * jest helpers that load the real module: requireActual/requireMock return
 * it, and createMockFromModule (genMockFromModule is its old name) loads it
 * to generate the automock.
 */
const JEST_LOADING_HELPERS: ReadonlyArray<string> = [
  "requireActual",
  "requireMock",
  "createMockFromModule",
  "genMockFromModule",
];

// Peels (x), x as T, <T>x, x! and x satisfies T down to x.
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// createRequire(...) and module.createRequire(...): each returns a require.
function isCreateRequireCall(node: ts.Expression): boolean {
  const expression: ts.Expression = unwrapExpression(node);

  if (!ts.isCallExpression(expression)) {
    return false;
  }

  const callee: ts.Expression = unwrapExpression(expression.expression);

  return (
    (ts.isIdentifier(callee) && callee.text === "createRequire") ||
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "createRequire")
  );
}

/*
 * The names a file binds to a createRequire(...) result
 * ("const load = createRequire(import.meta.url)", or a later assignment).
 * Matched by name, not by scope: a guard may over-match a shadowed name, it
 * must never miss a real one.
 */
function findRequireAliases(sourceFile: ts.SourceFile): Set<string> {
  const aliases: Set<string> = new Set<string>();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateRequireCall(node.initializer)
    ) {
      aliases.add(node.name.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isCreateRequireCall(node.right)
    ) {
      aliases.add(node.left.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return aliases;
}

// require, a createRequire alias, or a createRequire(...) call itself.
function isRequireFunction(
  expression: ts.Expression,
  requireAliases: ReadonlySet<string>,
): boolean {
  const unwrapped: ts.Expression = unwrapExpression(expression);

  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text === "require" || requireAliases.has(unwrapped.text);
  }

  return isCreateRequireCall(unwrapped);
}

function isImportMeta(expression: ts.Expression): boolean {
  return (
    ts.isMetaProperty(expression) &&
    expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    expression.name.text === "meta"
  );
}

/*
 * A call whose first argument names a module that gets loaded (or resolved
 * to be loaded): import(), require() and every require createRequire(...)
 * hands out, require.resolve() on any of them, module.require(),
 * import.meta.resolve() and the jest helpers above.
 */
function isRequireLikeCall(
  node: ts.CallExpression,
  requireAliases: ReadonlySet<string>,
): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }

  if (isRequireFunction(node.expression, requireAliases)) {
    return true;
  }

  const callee: ts.Expression = unwrapExpression(node.expression);

  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }

  const target: ts.Expression = unwrapExpression(callee.expression);
  const member: string = callee.name.text;

  if (member === "resolve") {
    return isRequireFunction(target, requireAliases) || isImportMeta(target);
  }

  if (ts.isIdentifier(target) && target.text === "module") {
    return member === "require";
  }

  return (
    ts.isIdentifier(target) &&
    target.text === "jest" &&
    JEST_LOADING_HELPERS.includes(member)
  );
}

/*
 * Every module a file really loads: import / export-from declarations,
 * import-equals, import types, and every call isRequireLikeCall recognises.
 * jest.mock is deliberately NOT a load - it replaces a specifier, it does not
 * pull the real module in.
 */
function readImportSpecifiers(fileName: string, source: string): Array<string> {
  const specifiers: Array<string> = [];
  const sourceFile: ts.SourceFile = parseSource(fileName, source);
  const requireAliases: Set<string> = findRequireAliases(sourceFile);

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
      isRequireLikeCall(node, requireAliases)
    ) {
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
        specifiers.push(firstArgument.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifiers;
}

function normalizeSpecifier(specifier: string): string {
  return specifier.split("\\").join("/");
}

function isEnterpriseSpecifier(specifier: string): boolean {
  const normalized: string = normalizeSpecifier(specifier);

  return EE_PATH_SEGMENT.test(normalized) || EE_PACKAGE.test(normalized);
}

/*
 * Whether a core file (repository-relative path) may load `specifier`. Only
 * the two plugin entry files may, and each only its own bare specifier.
 */
function isAllowedCoreImport(
  repositoryPath: string,
  specifier: string,
): boolean {
  if (!isEnterpriseSpecifier(specifier)) {
    return true;
  }

  return PLUGIN_ENTRY_ALLOWANCES.some(
    (allowance: PluginEntryAllowance): boolean => {
      return (
        allowance.file === repositoryPath && allowance.specifier === specifier
      );
    },
  );
}

function isAllowedEnterpriseImport(specifier: string): boolean {
  return !RELATIVE_INTO_PACKAGES.test(normalizeSpecifier(specifier));
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isStaticMember(node: ts.PropertyDeclaration): boolean {
  return Boolean(
    ts.getModifiers(node)?.some((modifier: ts.ModifierLike): boolean => {
      return modifier.kind === ts.SyntaxKind.StaticKeyword;
    }),
  );
}

/*
 * True when `node` runs while its module is still evaluating: no enclosing
 * function, or only a static class field / static block between it and the
 * top level. An instance field initializer runs at construction, and a
 * default parameter value runs when the function is called, so both count as
 * "inside a function".
 */
function runsAtModuleLoad(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (isFunctionLike(current)) {
      return false;
    }

    if (ts.isClassStaticBlockDeclaration(current)) {
      return true;
    }

    if (ts.isPropertyDeclaration(current)) {
      return isStaticMember(current);
    }

    current = current.parent;
  }

  return true;
}

function getCalleeName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }

  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }

  return null;
}

/*
 * Every call to a plugin accessor that runs at module load, as
 * "<line>:<accessor>" (1-based line).
 */
function findTopLevelPluginReads(
  fileName: string,
  source: string,
): Array<string> {
  const offenders: Array<string> = [];
  const sourceFile: ts.SourceFile = parseSource(fileName, source);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeName: string | null = getCalleeName(node);

      if (
        calleeName &&
        PLUGIN_ACCESSORS.includes(calleeName) &&
        runsAtModuleLoad(node)
      ) {
        const line: number =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;

        offenders.push(`${line}:${calleeName}`);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return offenders;
}

interface CoreScanResult {
  scannedFiles: number;
  violations: Array<string>;
}

interface PluginReadScanResult {
  scannedFiles: number;
  offenders: Array<string>;
}

// Every module-load plugin read in a directory, as "<file>:<line>:<accessor>".
function scanPluginReads(directory: string): PluginReadScanResult {
  const files: Array<string> = listSourceFiles(directory);
  const offenders: Array<string> = [];

  for (const filePath of files) {
    const source: string = fs.readFileSync(filePath, "utf8");

    if (
      !PLUGIN_ACCESSORS.some((accessor: string): boolean => {
        return source.includes(accessor);
      })
    ) {
      continue;
    }

    for (const offender of findTopLevelPluginReads(filePath, source)) {
      offenders.push(`${toRepositoryPath(filePath)}:${offender}`);
    }
  }

  return { scannedFiles: files.length, offenders };
}

function scanCoreImports(files: Array<string>): CoreScanResult {
  const violations: Array<string> = [];

  for (const filePath of files) {
    const source: string = fs.readFileSync(filePath, "utf8");

    if (!MAY_REFERENCE_EE.test(source)) {
      continue;
    }

    const repositoryPath: string = toRepositoryPath(filePath);

    for (const specifier of readImportSpecifiers(filePath, source)) {
      if (!isAllowedCoreImport(repositoryPath, specifier)) {
        violations.push(`${repositoryPath} -> ${specifier}`);
      }
    }
  }

  return { scannedFiles: files.length, violations };
}

function listConfigFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listConfigFiles(fullPath));
      }

      continue;
    }

    if (entry.isFile() && CONFIG_FILE_NAME.test(entry.name)) {
      found.push(fullPath);
    }
  }

  return found;
}

// A key or string value in a config file that names ee/ or an ee package.
function isEnterpriseConfigText(text: string): boolean {
  if (CONFIG_EE_PACKAGE.test(text)) {
    return true;
  }

  return normalizeSpecifier(text)
    .split(CONFIG_TOKEN_SEPARATORS)
    .some((token: string): boolean => {
      /*
       * Only a path counts: a bare "ee" in prose is not a reference, and a
       * bare "ee" path in packages/X resolves inside packages/X anyway.
       */
      return token.includes("/") && EE_PATH_SEGMENT.test(token);
    });
}

interface ConfigReference {
  location: Array<string>;
  text: string;
}

/*
 * Every key and string value of a parsed config that names ee/, with the
 * location of the key it sits under.
 */
function findConfigEnterpriseReferences(
  value: unknown,
  location: Array<string> = [],
): Array<ConfigReference> {
  if (typeof value === "string") {
    return isEnterpriseConfigText(value) ? [{ location, text: value }] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index: number) => {
      return findConfigEnterpriseReferences(item, [...location, `${index}`]);
    });
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]: [string, unknown]) => {
        const childLocation: Array<string> = [...location, key];
        const references: Array<ConfigReference> = isEnterpriseConfigText(key)
          ? [{ location: childLocation, text: key }]
          : [];

        return [
          ...references,
          ...findConfigEnterpriseReferences(child, childLocation),
        ];
      },
    );
  }

  return [];
}

// tsconfig files are JSONC; TypeScript's parser reads them (and plain JSON).
function parseConfigSource(filePath: string, source: string): unknown {
  const parsed: { config?: unknown; error?: ts.Diagnostic } =
    ts.parseConfigFileTextToJson(filePath, source);

  if (parsed.error) {
    throw new Error(
      `${toRepositoryPath(filePath)} is not valid JSON: ${ts.flattenDiagnosticMessageText(
        parsed.error.messageText,
        "\n",
      )}`,
    );
  }

  return parsed.config;
}

function readConfigValue(config: unknown, location: Array<string>): unknown {
  let current: unknown = config;

  for (const key of location) {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

// The file a mapping target names, trying the extensions tsc and jest would.
function resolveConfigTarget(absoluteTarget: string): string | null {
  for (const candidate of [
    absoluteTarget,
    `${absoluteTarget}.ts`,
    `${absoluteTarget}.tsx`,
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

function targetsOnlyStub(
  value: unknown,
  resolveTargetPath: (target: string) => string,
  stub: string,
): boolean {
  const targets: Array<unknown> = Array.isArray(value) ? value : [value];

  return (
    targets.length > 0 &&
    targets.every((target: unknown): boolean => {
      return (
        typeof target === "string" &&
        resolveConfigTarget(resolveTargetPath(target)) === stub
      );
    })
  );
}

/*
 * Whether a config reference is one of the pinned stub mappings: the plugin
 * specifier as a tsconfig compilerOptions.paths key, or anchored as a jest
 * moduleNameMapper key, whose every target is that frontend's own
 * CommunityPlugins.ts. Anything else - the right key pointed at ee/, one
 * frontend's specifier pointed at the other's stub, a package.json entry -
 * is a violation.
 */
function isAllowedConfigReference(
  filePath: string,
  config: unknown,
  reference: ConfigReference,
): boolean {
  const configDirectory: string = path.dirname(filePath);
  const fileName: string = path.basename(filePath);
  const [section, table, key]: Array<string | undefined> = [
    ...reference.location,
  ];
  const value: unknown = readConfigValue(config, reference.location);

  return COMMUNITY_PLUGIN_STUBS.some((mapping: CommunityPluginStub) => {
    if (
      TSCONFIG_FILE_NAME.test(fileName) &&
      reference.location.length === 3 &&
      section === "compilerOptions" &&
      table === "paths" &&
      key === mapping.specifier &&
      reference.text === mapping.specifier
    ) {
      return targetsOnlyStub(
        value,
        (target: string): string => {
          return path.resolve(configDirectory, target);
        },
        mapping.stub,
      );
    }

    const anchoredSpecifier: string = `^${mapping.specifier}$`;

    if (
      fileName === "jest.config.json" &&
      reference.location.length === 2 &&
      section === "moduleNameMapper" &&
      table === anchoredSpecifier &&
      reference.text === anchoredSpecifier
    ) {
      const rootDirectory: string = path.resolve(
        configDirectory,
        String(readConfigValue(config, ["rootDir"]) || "."),
      );

      return targetsOnlyStub(
        value,
        (target: string): string => {
          return path.resolve(target.split("<rootDir>").join(rootDirectory));
        },
        mapping.stub,
      );
    }

    return false;
  });
}

interface ConfigScanResult {
  allowed: Array<string>;
  violations: Array<string>;
}

function describeConfigReference(
  filePath: string,
  reference: ConfigReference,
): string {
  return `${toRepositoryPath(filePath)}: ${reference.location.join(" > ")} -> ${reference.text}`;
}

function scanConfigSource(filePath: string, source: string): ConfigScanResult {
  const config: unknown = parseConfigSource(filePath, source);
  const result: ConfigScanResult = { allowed: [], violations: [] };

  for (const reference of findConfigEnterpriseReferences(config)) {
    const description: string = describeConfigReference(filePath, reference);

    if (isAllowedConfigReference(filePath, config, reference)) {
      result.allowed.push(description);
    } else {
      result.violations.push(description);
    }
  }

  return result;
}

describe("the Enterprise import guard's own machinery", () => {
  test("reads real imports and ignores import-shaped strings and comments", () => {
    const specifiers: Array<string> = readImportSpecifiers(
      "Fixture.ts",
      [
        'import plugins from "@oneuptime/ee-dashboard";',
        'export { thing } from "../../../../ee/Dashboard/Index";',
        'const lazy = import("../ee/Lazy");',
        'const required = require("@oneuptime/ee");',
        "const templated = require(`/usr/src/ee/Server/Index`);",
        'type T = import("../../ee/Types").T;',
        'import Thing = require("../ee/ImportEquals");',
        'const actual = jest.requireActual("@oneuptime/ee-admin-dashboard");',
        'jest.mock("@oneuptime/ee-dashboard", () => { return {}; });',
        'const text = `import x from "../ee/NotAnImport"`;',
        '// import "../ee/LineComment";',
        '/* export * from "../ee/BlockComment"; */',
      ].join("\n"),
    );

    expect(specifiers).toEqual([
      "@oneuptime/ee-dashboard",
      "../../../../ee/Dashboard/Index",
      "../ee/Lazy",
      "@oneuptime/ee",
      "/usr/src/ee/Server/Index",
      "../../ee/Types",
      "../ee/ImportEquals",
      "@oneuptime/ee-admin-dashboard",
    ]);
  });

  test("also reads require.resolve, module.require, createRequire, import.meta.resolve and jest automocks", () => {
    const specifiers: Array<string> = readImportSpecifiers(
      "Fixture.ts",
      [
        'import { createRequire } from "module";',
        'const resolved = require.resolve("../ee/Resolved");',
        'const viaModule = module.require("../ee/ModuleRequire");',
        "const load = createRequire(import.meta.url);",
        'const loaded = load("@oneuptime/ee/Aliased");',
        'const aliasResolved = load.resolve("../ee/AliasResolved");',
        "let later;",
        "later = module.createRequire(__filename);",
        'later("../ee/Assigned");',
        'const direct = createRequire(__filename)("../ee/Direct");',
        'const directResolve = createRequire(__filename).resolve("../ee/DirectResolve");',
        'const typed = (load as NodeRequire)("../ee/Typed");',
        'const metaResolved = import.meta.resolve("../ee/MetaResolved");',
        'const automock = jest.createMockFromModule("../ee/Automock");',
        'const legacy = jest.genMockFromModule("../ee/LegacyAutomock");',
        // None of these loads a module.
        'const notALoad = other("../ee/Other");',
        'const cached = require.cache["../ee/Cache"];',
        'const lookup = require.resolve.paths("../ee/Paths");',
        'const unrelated = something.require("../ee/SomethingRequire");',
        'const unrelatedResolve = promise.resolve("../ee/PromiseResolve");',
      ].join("\n"),
    );

    expect(specifiers).toEqual([
      "module",
      "../ee/Resolved",
      "../ee/ModuleRequire",
      "@oneuptime/ee/Aliased",
      "../ee/AliasResolved",
      "../ee/Assigned",
      "../ee/Direct",
      "../ee/DirectResolve",
      "../ee/Typed",
      "../ee/MetaResolved",
      "../ee/Automock",
      "../ee/LegacyAutomock",
    ]);
  });

  test.each([
    [
      "require.resolve",
      'export const at: string = require.resolve("../../ee/Server/Index");',
    ],
    [
      "module.require",
      'export const ee: unknown = module.require("../../ee/Server/Index");',
    ],
    [
      "a createRequire alias",
      'import { createRequire } from "module";\nconst load: NodeRequire = createRequire(__filename);\nexport const ee: unknown = load("../../ee/Server/Index");',
    ],
    [
      "a createRequire(...) result called directly",
      'import { createRequire } from "module";\nexport const ee: unknown = createRequire(__filename)("../../ee/Server/Index");',
    ],
    [
      "import.meta.resolve",
      'export const at: string = import.meta.resolve("../../ee/Server/Index");',
    ],
    [
      "jest.createMockFromModule",
      'export const ee: unknown = jest.createMockFromModule("../../ee/Server/Index");',
    ],
  ])(
    "the scan reports a load through %s (negative control)",
    (_form: string, source: string) => {
      const root: string = fs.mkdtempSync(
        path.join(os.tmpdir(), "oneuptime-ee-guard-load-"),
      );

      try {
        const offender: string = path.join(root, "Offender.ts");

        fs.writeFileSync(offender, `${source}\n`);

        expect(scanCoreImports([offender]).violations).toEqual([
          `${toRepositoryPath(offender)} -> ../../ee/Server/Index`,
        ]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test("reads imports from JavaScript and JSX files too", () => {
    expect(
      readImportSpecifiers(
        "Fixture.js",
        'const ee = require("../ee/Server/Index");\nmodule.exports = ee;',
      ),
    ).toEqual(["../ee/Server/Index"]);

    expect(
      readImportSpecifiers(
        "Fixture.jsx",
        'import Page from "../../ee/Page";\nexport default () => <Page />;',
      ),
    ).toEqual(["../../ee/Page"]);
  });

  test.each([
    ["../../../../ee/Dashboard/Index", true],
    ["../ee", true],
    ["ee/Server/Index", true],
    ["/usr/src/ee/Server/Index", true],
    ["..\\..\\ee\\Dashboard\\Index", true],
    ["@oneuptime/ee", true],
    ["@oneuptime/ee/Server/Index", true],
    ["@oneuptime/ee-dashboard", true],
    ["@oneuptime/ee-admin-dashboard", true],
    ["@oneuptime/eel", false],
    ["@oneuptime/dashboard/Enterprise/EnterprisePlugins", false],
    ["Common/UI/Components/EE/Thing", false],
    ["./free/Thing", false],
    ["../bee/Thing", false],
    ["../tree", false],
    ["./eel/Index", false],
    ["react", false],
  ])(
    "classifies %s as an Enterprise specifier: %s",
    (specifier: string, expected: boolean) => {
      expect(isEnterpriseSpecifier(specifier)).toBe(expected);
    },
  );

  test("lets only each plugin entry file import its own plugin specifier", () => {
    const dashboardEntry: string =
      "packages/App/FeatureSet/Dashboard/src/Enterprise/Plugins.ts";
    const adminEntry: string =
      "packages/App/FeatureSet/AdminDashboard/src/Enterprise/Plugins.ts";

    expect(isAllowedCoreImport(dashboardEntry, "@oneuptime/ee-dashboard")).toBe(
      true,
    );
    expect(
      isAllowedCoreImport(adminEntry, "@oneuptime/ee-admin-dashboard"),
    ).toBe(true);

    // The wrong door, a path into ee/, or the ee package are all refused.
    expect(
      isAllowedCoreImport(dashboardEntry, "@oneuptime/ee-admin-dashboard"),
    ).toBe(false);
    expect(
      isAllowedCoreImport(
        dashboardEntry,
        "../../../../../../ee/Dashboard/Index",
      ),
    ).toBe(false);
    expect(isAllowedCoreImport(dashboardEntry, "@oneuptime/ee")).toBe(false);

    // Any other core file may not import the specifier at all.
    expect(
      isAllowedCoreImport(
        "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx",
        "@oneuptime/ee-dashboard",
      ),
    ).toBe(false);
    expect(
      isAllowedCoreImport(
        "packages/Common/Server/Enterprise/EnterpriseEdition.ts",
        "../../../../ee/Server/Index",
      ),
    ).toBe(false);

    // Ordinary imports are untouched.
    expect(
      isAllowedCoreImport(
        "packages/App/FeatureSet/Dashboard/src/Pages/Settings/SSO.tsx",
        "../../Enterprise/Plugins",
      ),
    ).toBe(true);
  });

  test("refuses relative paths from ee/ into packages/", () => {
    expect(isAllowedEnterpriseImport("../packages/Common/Types/ObjectID")).toBe(
      false,
    );
    expect(
      isAllowedEnterpriseImport(
        "../../packages/App/FeatureSet/Dashboard/src/X",
      ),
    ).toBe(false);
    expect(isAllowedEnterpriseImport("./../../packages/Common/X")).toBe(false);

    expect(isAllowedEnterpriseImport("Common/Types/ObjectID")).toBe(true);
    expect(isAllowedEnterpriseImport("App/Utils/Thing")).toBe(true);
    expect(
      isAllowedEnterpriseImport("@oneuptime/dashboard/Enterprise/Plugins"),
    ).toBe(true);
    expect(isAllowedEnterpriseImport("./packages/Local")).toBe(true);
    expect(isAllowedEnterpriseImport("../SSO/Plugins")).toBe(true);
  });

  test("flags plugin reads that run at module load, and only those", () => {
    const offenders: Array<string> = findTopLevelPluginReads(
      "Fixture.tsx",
      [
        'import { getDashboardPlugins } from "./Plugins";', // 1
        "const atLoad = getDashboardPlugins().SettingsSSO;", // 2
        "getAdminDashboardPlugins();", // 3
        "export const Page = () => {", // 4
        "  return getDashboardPlugins().SettingsSSO;", // 5
        "};", // 6
        "function render(plugin = getDashboardPlugins().AuditLogsTable) {", // 7
        "  return plugin;", // 8
        "}", // 9
        "class Shell {", // 10
        "  public static cached = getDashboardPlugins();", // 11
        "  public perInstance = getDashboardPlugins();", // 12
        "  static {", // 13
        "    getAdminDashboardPlugins();", // 14
        "  }", // 15
        "  public render() {", // 16
        "    return Plugins.getDashboardPlugins();", // 17
        "  }", // 18
        "}", // 19
        "export const nested = { value: Plugins.getDashboardPlugins() };", // 20
      ].join("\n"),
    );

    expect(offenders).toEqual([
      "2:getDashboardPlugins",
      "3:getAdminDashboardPlugins",
      "11:getDashboardPlugins",
      "14:getAdminDashboardPlugins",
      "20:getDashboardPlugins",
    ]);
  });

  test("skips node_modules, build and dist when walking a tree", () => {
    const root: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-ee-guard-"),
    );

    try {
      const files: Array<string> = [
        "src/Page.tsx",
        "src/Util.js",
        "src/types.d.ts",
        "node_modules/pkg/index.js",
        "build/dist/Page.js",
        "dist/Page.js",
        "src/nested/dist/Hidden.ts",
        "README.md",
      ];

      for (const file of files) {
        const fullPath: string = path.join(root, file);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, "");
      }

      const found: Array<string> = listSourceFiles(root)
        .map((file: string): string => {
          return path.relative(root, file).split(path.sep).join("/");
        })
        .sort();

      expect(found).toEqual(["src/Page.tsx", "src/Util.js"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("the scan reports a violation it is handed (negative control)", () => {
    const root: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-ee-guard-scan-"),
    );

    try {
      const offender: string = path.join(root, "Offender.ts");
      const clean: string = path.join(root, "Clean.ts");

      fs.writeFileSync(
        offender,
        'import Page from "../../ee/Dashboard/SSO/Page";\nexport default Page;\n',
      );
      fs.writeFileSync(
        clean,
        'import Plugins from "./Enterprise/Plugins";\nexport default Plugins;\n',
      );

      const result: CoreScanResult = scanCoreImports([offender, clean]);

      expect(result.scannedFiles).toBe(2);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toContain("../../ee/Dashboard/SSO/Page");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the Enterprise config guard's own machinery", () => {
  const dashboardTsconfig: string = path.join(
    APP_DIR,
    "FeatureSet",
    "Dashboard",
    "tsconfig.json",
  );
  const appJestConfig: string = path.join(APP_DIR, "jest.config.json");
  const appPackageJson: string = path.join(APP_DIR, "package.json");

  const scan: (filePath: string, config: unknown) => ConfigScanResult = (
    filePath: string,
    config: unknown,
  ): ConfigScanResult => {
    return scanConfigSource(filePath, JSON.stringify(config));
  };

  test.each([
    ["../../ee", true],
    ["../../../../ee/Dashboard/Index", true],
    ["file:../../ee", true],
    ["cd ../../ee && npm test", true],
    ["<rootDir>/../../ee/Server/Index.ts", true],
    ["../../ee/**/*.ts", true],
    ["..\\..\\ee\\Server", true],
    ["/usr/src/ee", true],
    ["^@oneuptime/ee-dashboard$", true],
    ["@oneuptime/ee", true],
    ["@oneuptime/ee/Server/Index", true],
    ["@oneuptime/ee-admin-dashboard", true],
    ["@oneuptime/eel", false],
    ["ee", false],
    ["the ee edition", false],
    ["./free/Thing", false],
    ["../bee/Thing", false],
    ["Common/UI/Components/EE/Thing", false],
    ["https://github.com/OneUptime/oneuptime", false],
    [
      "<rootDir>/FeatureSet/Dashboard/src/Enterprise/CommunityPlugins.ts",
      false,
    ],
  ])(
    "classifies config text %s as an ee reference: %s",
    (text: string, expected: boolean) => {
      expect(isEnterpriseConfigText(text)).toBe(expected);
    },
  );

  test("reads keys and string values, never comments", () => {
    const config: unknown = parseConfigSource(
      dashboardTsconfig,
      [
        "{",
        "  // the Enterprise build points esbuild at ee/Dashboard/Index.tsx",
        '  /* "@oneuptime/ee-dashboard" is the plugin */',
        '  "compilerOptions": { "outDir": "../../../../ee/build" },',
        '  "references": [{ "path": "../../../../ee" }],',
        '  "files": ["src/Index.tsx"],',
        '  "@oneuptime/ee": true',
        "}",
      ].join("\n"),
    );

    expect(findConfigEnterpriseReferences(config)).toEqual([
      {
        location: ["compilerOptions", "outDir"],
        text: "../../../../ee/build",
      },
      { location: ["references", "0", "path"], text: "../../../../ee" },
      { location: ["@oneuptime/ee"], text: "@oneuptime/ee" },
    ]);
  });

  test("allows each plugin specifier mapped to its own Community stub", () => {
    expect(
      scan(dashboardTsconfig, {
        compilerOptions: {
          paths: {
            "@oneuptime/ee-dashboard": ["./src/Enterprise/CommunityPlugins"],
          },
        },
      }),
    ).toEqual({
      allowed: [
        "packages/App/FeatureSet/Dashboard/tsconfig.json: compilerOptions > paths > @oneuptime/ee-dashboard -> @oneuptime/ee-dashboard",
      ],
      violations: [],
    });

    expect(
      scan(appJestConfig, {
        moduleNameMapper: {
          "^@oneuptime/ee-dashboard$":
            "<rootDir>/FeatureSet/Dashboard/src/Enterprise/CommunityPlugins.ts",
          "^@oneuptime/ee-admin-dashboard$":
            "<rootDir>/FeatureSet/AdminDashboard/src/Enterprise/CommunityPlugins.ts",
        },
      }).violations,
    ).toEqual([]);
  });

  test.each([
    [
      "a tsconfig mapping the plugin specifier into ee/",
      dashboardTsconfig,
      {
        compilerOptions: {
          paths: {
            "@oneuptime/ee-dashboard": ["../../../../ee/Dashboard/Index"],
          },
        },
      },
      2,
    ],
    [
      "a tsconfig mapping one frontend's specifier to the other frontend's stub",
      dashboardTsconfig,
      {
        compilerOptions: {
          paths: {
            "@oneuptime/ee-admin-dashboard": [
              "./src/Enterprise/CommunityPlugins",
            ],
          },
        },
      },
      1,
    ],
    [
      "a tsconfig mapping the stub and ee/ side by side",
      dashboardTsconfig,
      {
        compilerOptions: {
          paths: {
            "@oneuptime/ee-dashboard": [
              "./src/Enterprise/CommunityPlugins",
              "../../../../ee/Dashboard/Index",
            ],
          },
        },
      },
      2,
    ],
    [
      "a tsconfig project reference into ee/",
      dashboardTsconfig,
      { references: [{ path: "../../../../ee" }] },
      1,
    ],
    [
      "a tsconfig include of ee sources",
      dashboardTsconfig,
      { include: ["src/**/*", "../../../../ee/Dashboard/**/*"] },
      1,
    ],
    [
      "a jest mapper sending the plugin specifier into ee/",
      appJestConfig,
      {
        moduleNameMapper: {
          "^@oneuptime/ee-dashboard$": "<rootDir>/../../ee/Dashboard/Index.tsx",
        },
      },
      2,
    ],
    [
      "an unanchored jest mapper key, even to the stub",
      appJestConfig,
      {
        moduleNameMapper: {
          "@oneuptime/ee-dashboard":
            "<rootDir>/FeatureSet/Dashboard/src/Enterprise/CommunityPlugins.ts",
        },
      },
      1,
    ],
    [
      "jest roots reaching into ee/",
      appJestConfig,
      { roots: ["<rootDir>", "<rootDir>/../../ee"] },
      1,
    ],
    [
      "a package.json dependency on the ee package",
      appPackageJson,
      { dependencies: { "@oneuptime/ee": "file:../../ee" } },
      2,
    ],
    [
      "a package.json script that runs inside ee/",
      appPackageJson,
      { scripts: { "test:ee": "cd ../../ee && npm test" } },
      1,
    ],
    [
      "a package.json jest block with the stub mapping (only jest.config.json may map)",
      appPackageJson,
      {
        jest: {
          moduleNameMapper: {
            "^@oneuptime/ee-dashboard$":
              "<rootDir>/FeatureSet/Dashboard/src/Enterprise/CommunityPlugins.ts",
          },
        },
      },
      1,
    ],
  ])(
    "refuses %s (negative control)",
    (_label: string, filePath: string, config: unknown, expected: number) => {
      const result: ConfigScanResult = scan(filePath, config);

      expect(result.allowed).toEqual([]);
      expect(result.violations).toHaveLength(expected);
    },
  );

  test("finds config files and skips node_modules and build", () => {
    const root: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-ee-config-guard-"),
    );

    try {
      const files: Array<string> = [
        "package.json",
        "tsconfig.json",
        "tsconfig.build.json",
        "jest.config.json",
        "Nested/package.json",
        "Nested/tsconfig.test.json",
        "Nested/jest.config.js",
        "Nested/config.json",
        "node_modules/pkg/package.json",
        "build/tsconfig.json",
      ];

      for (const file of files) {
        const fullPath: string = path.join(root, file);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, "{}");
      }

      expect(
        listConfigFiles(root)
          .map((file: string): string => {
            return path.relative(root, file).split(path.sep).join("/");
          })
          .sort(),
      ).toEqual([
        "Nested/package.json",
        "Nested/tsconfig.test.json",
        "jest.config.json",
        "package.json",
        "tsconfig.build.json",
        "tsconfig.json",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("core never imports the Enterprise Edition", () => {
  const coreFiles: Array<string> = listSourceFiles(PACKAGES_DIR);

  test("the scan actually covers the packages", () => {
    /*
     * Guards the guard: a walker that silently matched nothing would leave
     * every assertion below passing.
     */
    expect(coreFiles.length).toBeGreaterThan(5000);

    const repositoryPaths: Set<string> = new Set<string>(
      coreFiles.map(toRepositoryPath),
    );

    for (const allowance of PLUGIN_ENTRY_ALLOWANCES) {
      expect(repositoryPaths.has(allowance.file)).toBe(true);
    }
  });

  test("no file in packages/ loads ee/ or an ee package, except the plugin doors", () => {
    /*
     * Each entry names the file and the specifier. The fix is never to widen
     * the allowance: read the plugin through getDashboardPlugins() /
     * getAdminDashboardPlugins() instead, or move the code into ee/.
     */
    expect(scanCoreImports(coreFiles).violations).toEqual([]);
  });

  test("each plugin door imports its plugin specifier and nothing else from ee", () => {
    for (const allowance of PLUGIN_ENTRY_ALLOWANCES) {
      const filePath: string = path.join(REPOSITORY_ROOT, allowance.file);
      const specifiers: Array<string> = readImportSpecifiers(
        filePath,
        fs.readFileSync(filePath, "utf8"),
      );

      expect({
        file: allowance.file,
        enterpriseImports: specifiers.filter(isEnterpriseSpecifier),
      }).toEqual({
        file: allowance.file,
        enterpriseImports: [allowance.specifier],
      });
    }
  });

  test("no frontend module bypasses the door by importing the Community stub", () => {
    /*
     * Importing CommunityPlugins directly would pin that screen to the
     * Community Edition in every build, Enterprise included.
     */
    const offenders: Array<string> = [];

    for (const sourceDirectory of FRONTEND_SOURCE_DIRECTORIES) {
      const enterpriseDirectory: string = path.join(
        sourceDirectory,
        "Enterprise",
      );

      for (const filePath of listSourceFiles(sourceDirectory)) {
        if (path.dirname(filePath) === enterpriseDirectory) {
          continue;
        }

        const source: string = fs.readFileSync(filePath, "utf8");

        if (!source.includes("CommunityPlugins")) {
          continue;
        }

        for (const specifier of readImportSpecifiers(filePath, source)) {
          if (normalizeSpecifier(specifier).endsWith("/CommunityPlugins")) {
            offenders.push(`${toRepositoryPath(filePath)} -> ${specifier}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no frontend module reads the plugins while it is loading", () => {
    /*
     * The ee UI plugins are held to the same rule in the ee/ block below,
     * which only runs where ee/ is present.
     */
    for (const directory of FRONTEND_SOURCE_DIRECTORIES) {
      const result: PluginReadScanResult = scanPluginReads(directory);

      expect(result.scannedFiles).toBeGreaterThan(0);
      expect(result.offenders).toEqual([]);
    }
  });

  describe("configuration", () => {
    const configFiles: Array<string> = listConfigFiles(PACKAGES_DIR);

    const scanAll: () => ConfigScanResult = (): ConfigScanResult => {
      const result: ConfigScanResult = { allowed: [], violations: [] };

      for (const filePath of configFiles) {
        const fileResult: ConfigScanResult = scanConfigSource(
          filePath,
          fs.readFileSync(filePath, "utf8"),
        );

        result.allowed.push(...fileResult.allowed);
        result.violations.push(...fileResult.violations);
      }

      return result;
    };

    test("the scan covers every tsconfig, jest.config.json and package.json in packages/", () => {
      const repositoryPaths: Array<string> = configFiles.map(toRepositoryPath);

      expect(configFiles.length).toBeGreaterThan(20);

      for (const expected of [
        "packages/Common/package.json",
        "packages/Common/tsconfig.json",
        "packages/Common/jest.config.json",
        "packages/App/package.json",
        "packages/App/tsconfig.json",
        "packages/App/jest.config.json",
        "packages/App/FeatureSet/Dashboard/tsconfig.json",
        "packages/App/FeatureSet/AdminDashboard/tsconfig.json",
      ]) {
        expect(repositoryPaths).toContain(expected);
      }

      expect(
        repositoryPaths.filter((repositoryPath: string): boolean => {
          return repositoryPath.includes("/node_modules/");
        }),
      ).toEqual([]);
    });

    test("no config file in packages/ points into ee/ or at an ee package, except the Community stub mappings", () => {
      /*
       * Each entry names the file, the key path and the text. The fix is
       * never to widen the allowance: core configuration must build and test
       * the Community Edition with ee/ absent.
       */
      expect(scanAll().violations).toEqual([]);
    });

    test("the Community stub mappings it allows are exactly the pinned ones", () => {
      /*
       * The allowance may only ever accept the ten entries
       * EnterprisePluginResolution.test.ts pins. A new one here means a new
       * config learned the plugin specifiers, which must be pinned there too.
       */
      expect(scanAll().allowed.sort()).toEqual(
        [
          "packages/App/FeatureSet/AdminDashboard/tsconfig.json: compilerOptions > paths > @oneuptime/ee-admin-dashboard -> @oneuptime/ee-admin-dashboard",
          "packages/App/FeatureSet/Dashboard/tsconfig.json: compilerOptions > paths > @oneuptime/ee-dashboard -> @oneuptime/ee-dashboard",
          "packages/App/jest.config.json: moduleNameMapper > ^@oneuptime/ee-admin-dashboard$ -> ^@oneuptime/ee-admin-dashboard$",
          "packages/App/jest.config.json: moduleNameMapper > ^@oneuptime/ee-dashboard$ -> ^@oneuptime/ee-dashboard$",
          "packages/App/tsconfig.json: compilerOptions > paths > @oneuptime/ee-admin-dashboard -> @oneuptime/ee-admin-dashboard",
          "packages/App/tsconfig.json: compilerOptions > paths > @oneuptime/ee-dashboard -> @oneuptime/ee-dashboard",
          "packages/Common/jest.config.json: moduleNameMapper > ^@oneuptime/ee-admin-dashboard$ -> ^@oneuptime/ee-admin-dashboard$",
          "packages/Common/jest.config.json: moduleNameMapper > ^@oneuptime/ee-dashboard$ -> ^@oneuptime/ee-dashboard$",
          "packages/Common/tsconfig.json: compilerOptions > paths > @oneuptime/ee-admin-dashboard -> @oneuptime/ee-admin-dashboard",
          "packages/Common/tsconfig.json: compilerOptions > paths > @oneuptime/ee-dashboard -> @oneuptime/ee-dashboard",
        ].sort(),
      );
    });
  });
});

/*
 * ee/ is removed before the core CI jobs run (core is Community by
 * construction), so this block only has something to check in a full
 * checkout. It reports as skipped rather than passing vacuously, and the
 * Enterprise Edition Test workflow (test.ee.yaml) runs it with ee/ present.
 */
const describeWhenEnterprisePresent: typeof describe.skip = fs.existsSync(
  EE_DIR,
)
  ? describe
  : describe.skip;

describeWhenEnterprisePresent("ee/ keeps its side of the boundary", () => {
  const enterpriseFiles: Array<string> = listSourceFiles(EE_DIR);

  test("the scan actually covers ee/", () => {
    /*
     * Guards the guard: an ee/ walk that matched nothing would leave the
     * checks below passing on an empty list.
     */
    const repositoryPaths: Array<string> =
      enterpriseFiles.map(toRepositoryPath);

    expect(enterpriseFiles.length).toBeGreaterThan(50);
    expect(repositoryPaths).toContain("ee/Server/Index.ts");
    expect(repositoryPaths).toContain("ee/Dashboard/Index.tsx");
    expect(repositoryPaths).toContain("ee/AdminDashboard/Index.tsx");
  });

  test("no ee UI module reads the plugins while it is loading", () => {
    for (const directory of ENTERPRISE_UI_DIRECTORIES) {
      const result: PluginReadScanResult = scanPluginReads(directory);

      expect({
        directory: toRepositoryPath(directory),
        hasFiles: result.scannedFiles > 0,
        offenders: result.offenders,
      }).toEqual({
        directory: toRepositoryPath(directory),
        hasFiles: true,
        offenders: [],
      });
    }
  });

  test("no ee/ file imports a relative path into packages/", () => {
    const offenders: Array<string> = [];

    expect(enterpriseFiles.length).toBeGreaterThan(0);

    for (const filePath of enterpriseFiles) {
      const source: string = fs.readFileSync(filePath, "utf8");

      if (!MAY_REFERENCE_PACKAGES.test(source)) {
        continue;
      }

      for (const specifier of readImportSpecifiers(filePath, source)) {
        if (!isAllowedEnterpriseImport(specifier)) {
          offenders.push(`${toRepositoryPath(filePath)} -> ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
