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
 * test also catches require(), dynamic import(), import types,
 * jest.requireActual and .js files, and it runs in the App Test job rather
 * than only in lint.
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

function isRequireLikeCall(node: ts.CallExpression): boolean {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }

  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "require";
  }

  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "jest" &&
    (node.expression.name.text === "requireActual" ||
      node.expression.name.text === "requireMock")
  );
}

/*
 * Every module a file really loads: import / export-from declarations,
 * import-equals, import types, dynamic import(), require() and
 * jest.requireActual/requireMock. jest.mock is deliberately NOT a load - it
 * replaces a specifier, it does not pull the real module in.
 */
function readImportSpecifiers(fileName: string, source: string): Array<string> {
  const specifiers: Array<string> = [];

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
    } else if (ts.isCallExpression(node) && isRequireLikeCall(node)) {
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
        specifiers.push(firstArgument.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parseSource(fileName, source));

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
    const offenders: Array<string> = [];

    const directories: Array<string> = [
      ...FRONTEND_SOURCE_DIRECTORIES,
      path.join(EE_DIR, "Dashboard"),
      path.join(EE_DIR, "AdminDashboard"),
    ];

    for (const directory of directories) {
      for (const filePath of listSourceFiles(directory)) {
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
    }

    expect(offenders).toEqual([]);
  });
});

/*
 * ee/ is removed before the core CI jobs run (core is Community by
 * construction), so this block only has something to check in a full
 * checkout. It reports as skipped rather than passing vacuously.
 */
const describeWhenEnterprisePresent: typeof describe.skip = fs.existsSync(
  EE_DIR,
)
  ? describe
  : describe.skip;

describeWhenEnterprisePresent(
  "ee/ reaches core only through mapped specifiers",
  () => {
    test("no ee/ file imports a relative path into packages/", () => {
      const offenders: Array<string> = [];

      for (const filePath of listSourceFiles(EE_DIR)) {
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
  },
);
