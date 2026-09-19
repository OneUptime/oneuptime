import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import { builtinModules } from "module";
import path from "path";
import ts from "typescript";

/*
 * Every bare import in ee/ resolves in the Enterprise image.
 *
 * In the image ee/ sits at /usr/src/ee with its own node_modules, installed
 * from ee/package.json and pruned to its "dependencies" (npm prune
 * --omit=dev). Common and App are linked in (file:), but their node_modules
 * are not on ee's resolution path. So:
 *
 *   - ee/Server and ee/Scripts may import node builtins, Common/..., App/...
 *     and the packages ee/package.json lists under "dependencies". A
 *     devDependency is gone after the prune, and anything else only resolves
 *     in a checkout, where jest's modulePaths reach Common's and App's
 *     node_modules.
 *   - ee/Dashboard and ee/AdminDashboard are bundled by the frontend's
 *     esbuild, which resolves only what it aliases (Common/UI/esbuild-config.js
 *     and esbuild-enterprise.js): react, react-dom, react-router,
 *     react-router-dom, react-i18next, i18next, Common/... and the frontend's
 *     own @oneuptime/dashboard/... or @oneuptime/admin-dashboard/....
 *
 * Specifiers are read from the TypeScript AST, so strings and comments never
 * count, and type-only imports do (the image's tsc type-checks ee/ before the
 * prune, from the same node_modules).
 */

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");
const COMMON_UI_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "Common",
  "UI",
);

const SOURCE_EXTENSION: RegExp = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const JAVASCRIPT_EXTENSION: RegExp = /\.[mc]?js$/;
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
]);

// The packages the frontend bundles alias (Common/UI/esbuild-config.js).
const UI_ALIASED_PACKAGES: ReadonlyArray<string> = [
  "react",
  "react-dom",
  "react-router",
  "react-router-dom",
  "react-i18next",
  "i18next",
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const packageJson: PackageJson = JSON.parse(
  fs.readFileSync(path.join(EE_DIR, "package.json"), "utf8"),
) as PackageJson;

const RUNTIME_DEPENDENCIES: ReadonlyArray<string> = Object.keys(
  packageJson.dependencies || {},
);

const NODE_BUILTINS: ReadonlySet<string> = new Set<string>(builtinModules);

type SpecifierCheck = (specifier: string) => boolean;

interface Scope {
  name: string;
  directories: Array<string>;
  isAllowed: SpecifierCheck;
}

const toRepositoryPath: (filePath: string) => string = (
  filePath: string,
): string => {
  return path.relative(REPOSITORY_ROOT, filePath).split(path.sep).join("/");
};

const isRelative: (specifier: string) => boolean = (
  specifier: string,
): boolean => {
  return specifier.startsWith(".") || specifier.startsWith("/");
};

// "@scope/name/deep" -> "@scope/name"; "name/deep" -> "name".
const packageNameOf: (specifier: string) => string = (
  specifier: string,
): string => {
  const segments: Array<string> = specifier.split("/");

  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0] || specifier;
};

const isNodeBuiltin: SpecifierCheck = (specifier: string): boolean => {
  const name: string = specifier.startsWith("node:")
    ? specifier.slice("node:".length)
    : specifier;

  return NODE_BUILTINS.has(name) || NODE_BUILTINS.has(packageNameOf(name));
};

const isServerSpecifierAllowed: SpecifierCheck = (
  specifier: string,
): boolean => {
  return (
    isNodeBuiltin(specifier) ||
    specifier.startsWith("Common/") ||
    specifier.startsWith("App/") ||
    RUNTIME_DEPENDENCIES.includes(packageNameOf(specifier))
  );
};

const uiSpecifierCheck: (internalSpecifier: string) => SpecifierCheck = (
  internalSpecifier: string,
): SpecifierCheck => {
  return (specifier: string): boolean => {
    return (
      specifier.startsWith("Common/") ||
      specifier.startsWith(`${internalSpecifier}/`) ||
      UI_ALIASED_PACKAGES.includes(packageNameOf(specifier))
    );
  };
};

const SCOPES: ReadonlyArray<Scope> = [
  {
    name: "ee server and scripts",
    directories: [path.join(EE_DIR, "Server"), path.join(EE_DIR, "Scripts")],
    isAllowed: isServerSpecifierAllowed,
  },
  {
    name: "ee Dashboard plugin",
    directories: [path.join(EE_DIR, "Dashboard")],
    isAllowed: uiSpecifierCheck("@oneuptime/dashboard"),
  },
  {
    name: "ee Admin Dashboard plugin",
    directories: [path.join(EE_DIR, "AdminDashboard")],
    isAllowed: uiSpecifierCheck("@oneuptime/admin-dashboard"),
  },
];

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listSourceFiles(fullPath));
      }
    } else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) {
      found.push(fullPath);
    }
  }

  return found;
};

const scriptKindOf: (fileName: string) => ts.ScriptKind = (
  fileName: string,
): ts.ScriptKind => {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  if (JAVASCRIPT_EXTENSION.test(fileName)) {
    return ts.ScriptKind.JS;
  }

  return ts.ScriptKind.TS;
};

const isLoadingCall: (node: ts.CallExpression) => boolean = (
  node: ts.CallExpression,
): boolean => {
  const callee: ts.Expression = node.expression;

  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    return true;
  }

  if (ts.isIdentifier(callee)) {
    return callee.text === "require";
  }

  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "require" &&
    callee.name.text === "resolve"
  );
};

/*
 * Every module specifier a file names: import / export-from declarations
 * (type-only included), import-equals, import types, import(), require()
 * and require.resolve().
 */
const readSpecifiers: (fileName: string, source: string) => Array<string> = (
  fileName: string,
  source: string,
): Array<string> => {
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
    } else if (ts.isCallExpression(node) && isLoadingCall(node)) {
      const firstArgument: ts.Expression | undefined = node.arguments[0];

      if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
        specifiers.push(firstArgument.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(
    ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindOf(fileName),
    ),
  );

  return specifiers;
};

// Every bare specifier in the source that the scope does not allow.
const findUndeclaredImports: (
  fileName: string,
  source: string,
  isAllowed: SpecifierCheck,
) => Array<string> = (
  fileName: string,
  source: string,
  isAllowed: SpecifierCheck,
): Array<string> => {
  return readSpecifiers(fileName, source).filter(
    (specifier: string): boolean => {
      return !isRelative(specifier) && !isAllowed(specifier);
    },
  );
};

// The keys of every `alias: { ... }` object literal in a JavaScript file.
const readAliasKeys: (filePath: string) => Array<string> = (
  filePath: string,
): Array<string> => {
  const keys: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "alias" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        ) {
          keys.push(property.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(
    ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
  );

  return keys;
};

describe("the declared-dependency check's own machinery", () => {
  test.each([
    ["fs", true],
    ["node:crypto", true],
    ["fs/promises", true],
    ["Common/Server/Utils/Logger", true],
    ["App/Utils/EnterpriseLoader", true],
    ["openid-client", true],
    ["openid-client/lib/errors", true],
    ["@xmldom/xmldom", true],
    ["xml-crypto", true],
    ["@xmldom/other", false],
    ["lodash", false],
    ["typescript", false],
    ["jest", false],
    ["ts-jest", false],
    ["Commonality", false],
    ["express", false],
    ["react", false],
  ])(
    "the server allows %s: %s",
    (specifier: string, expected: boolean): void => {
      expect(isServerSpecifierAllowed(specifier)).toBe(expected);
    },
  );

  test.each([
    ["react", true],
    ["react/jsx-runtime", true],
    ["react-dom/client", true],
    ["react-router-dom", true],
    ["react-router/dom", true],
    ["react-i18next", true],
    ["i18next", true],
    ["Common/UI/Components/Button/Button", true],
    ["@oneuptime/dashboard/Utils/Navigation", true],
    ["@oneuptime/admin-dashboard/Utils/Navigation", false],
    ["@oneuptime/dashboard", false],
    ["@oneuptime/ee-dashboard", false],
    ["App/Utils/Thing", false],
    ["fs", false],
    ["openid-client", false],
    ["axios", false],
    ["react-query", false],
  ])(
    "the Dashboard plugin allows %s: %s",
    (specifier: string, expected: boolean): void => {
      expect(uiSpecifierCheck("@oneuptime/dashboard")(specifier)).toBe(
        expected,
      );
    },
  );

  test("the Admin Dashboard plugin reaches only its own frontend", () => {
    const isAllowed: SpecifierCheck = uiSpecifierCheck(
      "@oneuptime/admin-dashboard",
    );

    expect(isAllowed("@oneuptime/admin-dashboard/Utils/Navigation")).toBe(true);
    expect(isAllowed("@oneuptime/dashboard/Utils/Navigation")).toBe(false);
  });

  test("reports every undeclared import in a source it is handed (negative control)", () => {
    const source: string = [
      'import leftPad from "left-pad";',
      'import type { Thing } from "type-only-undeclared";',
      'export * from "reexported-undeclared";',
      'import Legacy = require("import-equals-undeclared");',
      'type Lazy = import("import-type-undeclared").Lazy;',
      'const dynamic = import("dynamic-undeclared");',
      'const required = require("required-undeclared");',
      'const resolved = require.resolve("resolved-undeclared");',
      'const devOnly = require("typescript");',
      // None of these is reported.
      'import fs from "fs";',
      'import Logger from "Common/Server/Utils/Logger";',
      'import { Issuer } from "openid-client";',
      'import Local from "./Local";',
      'const text = "import x from \\"string-not-an-import\\"";',
      '// import y from "comment-not-an-import";',
    ].join("\n");

    expect(
      findUndeclaredImports("Fixture.ts", source, isServerSpecifierAllowed),
    ).toEqual([
      "left-pad",
      "type-only-undeclared",
      "reexported-undeclared",
      "import-equals-undeclared",
      "import-type-undeclared",
      "dynamic-undeclared",
      "required-undeclared",
      "resolved-undeclared",
      "typescript",
    ]);
  });
});

describe("ee/ imports only what its image can resolve", () => {
  test("ee/package.json keeps the packages the server needs in dependencies", () => {
    for (const dependency of ["Common", "App", "openid-client"]) {
      expect(RUNTIME_DEPENDENCIES).toContain(dependency);
    }
  });

  test.each(
    SCOPES.map((scope: Scope): [string, Scope] => {
      return [scope.name, scope];
    }),
  )("the %s scan covers its sources", (_name: string, scope: Scope): void => {
    for (const directory of scope.directories) {
      expect({
        directory: toRepositoryPath(directory),
        hasFiles: listSourceFiles(directory).length > 0,
      }).toEqual({ directory: toRepositoryPath(directory), hasFiles: true });
    }
  });

  test.each(
    SCOPES.map((scope: Scope): [string, Scope] => {
      return [scope.name, scope];
    }),
  )(
    "%s: every bare import is declared",
    (_name: string, scope: Scope): void => {
      const offenders: Array<string> = [];

      for (const directory of scope.directories) {
        for (const filePath of listSourceFiles(directory)) {
          for (const specifier of findUndeclaredImports(
            filePath,
            fs.readFileSync(filePath, "utf8"),
            scope.isAllowed,
          )) {
            offenders.push(`${toRepositoryPath(filePath)} -> ${specifier}`);
          }
        }
      }

      expect(offenders).toEqual([]);
    },
  );

  test("every package the UI allowlist names is aliased by the frontend bundles", () => {
    /*
     * A package allowed here but not aliased by esbuild would not resolve
     * from ee/ when the Enterprise image bundles the plugin.
     */
    const coreAliases: Array<string> = readAliasKeys(
      path.join(COMMON_UI_DIR, "esbuild-config.js"),
    );
    const enterpriseAliases: Array<string> = readAliasKeys(
      path.join(COMMON_UI_DIR, "esbuild-enterprise.js"),
    );

    for (const aliasedPackage of UI_ALIASED_PACKAGES) {
      expect(coreAliases).toContain(aliasedPackage);
    }

    expect(enterpriseAliases).toContain("Common");
  });
});
