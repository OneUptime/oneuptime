import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE DASHBOARD MODULES THE APP'S TESTS LOAD NEED NOTHING THE DASHBOARD
 * ALONE INSTALLS.
 *
 * The App's tests run, and `npm run compile` type-checks them
 * (scripts/compile-tests.js), with Common's and the App's packages installed
 * and not the Dashboard's (the Compile workflow's compile-services job, App
 * Test). So a Dashboard module a test imports - or one that module imports in
 * turn - must import no package that only the Dashboard's node_modules holds,
 * React above all: on main, HashedAddressSearch.ts (#10514) and
 * ScrubRuleForm.ts (#10601) imported "react", and the test type-check and
 * HashedAddressSearchQuestion failed with "Cannot find module 'react'". On a
 * machine that has installed the Dashboard, React is found and nothing fails
 * until CI does. This reads the imports themselves, so it fails wherever it
 * runs: keep such a module React-free (a hook in a file of its own, as
 * useHashedAddressSearch is), or test it in Common/Tests/App/Dashboard, which
 * renders.
 */

const APP_DIRECTORY: string = path.resolve(__dirname, "..", "..");
const DASHBOARD_SOURCE: string = path.join(
  APP_DIRECTORY,
  "FeatureSet",
  "Dashboard",
  "src",
);
const TESTS_DIRECTORY: string = path.join(APP_DIRECTORY, "Tests");
const APP_PACKAGES: string = path.join(APP_DIRECTORY, "node_modules");

// Specifiers the App's config maps to files (tsconfig paths, jest's moduleNameMapper).
const MAPPED: RegExp = /^(?:Common\/|@oneuptime\/ee-(?:admin-)?dashboard$)/;

const RESOLVED_EXTENSIONS: ReadonlyArray<string> = [
  "",
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

export interface ModuleReader {
  read: (file: string) => string;
  isFile: (file: string) => boolean;
  // Whether the App's own node_modules holds a package.
  appHasPackage: (name: string) => boolean;
}

// Each file read once: many tests reach the same Dashboard modules.
const READ_CACHE: Map<string, string> = new Map<string, string>();

const DISK: ModuleReader = {
  read: (file: string): string => {
    let source: string | undefined = READ_CACHE.get(file);

    if (source === undefined) {
      source = fs.readFileSync(file, "utf8");
      READ_CACHE.set(file, source);
    }

    return source;
  },
  isFile: (file: string): boolean => {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  },
  appHasPackage: (name: string): boolean => {
    return fs.existsSync(path.join(APP_PACKAGES, name));
  },
};

/*
 * What a module names, read from its syntax tree - so a snippet in a string
 * (a setup guide's `import ... from "@sentry/browser"`) or a comment is no
 * import: import and export froms (type-only ones too, which the type-check
 * resolves), side-effect imports, require(), import() and requireActual().
 */
export function specifiersOf(source: string): Array<string> {
  const file: ts.SourceFile = ts.createSourceFile(
    "module.tsx",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  );
  const specifiers: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee: ts.Expression = node.expression;
      const isLoad: boolean =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require") ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "requireActual");
      const first: ts.Expression = node.arguments[0]!;

      if (isLoad && ts.isStringLiteralLike(first)) {
        specifiers.push(first.text);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(file);

  return specifiers;
}

// A bare specifier's package: "react", "react-dom/client" -> "react-dom", "@scope/name/x" -> "@scope/name".
export function packageOf(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

function resolveRelative(
  fromFile: string,
  specifier: string,
  reader: ModuleReader,
): string | null {
  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const extension of RESOLVED_EXTENSIONS) {
    if (reader.isFile(base + extension)) {
      return base + extension;
    }
  }

  return null;
}

function isInDashboard(file: string, dashboardSource: string): boolean {
  return file.startsWith(dashboardSource + path.sep);
}

function relativeName(file: string): string {
  return path.relative(APP_DIRECTORY, file);
}

/*
 * What a test reaches in the Dashboard that needs the Dashboard's own
 * packages: each Dashboard module it loads, through the Dashboard modules
 * they load, that is a .tsx (JSX needs React's runtime) or imports a package
 * the App has not installed - with the chain that reaches it.
 */
export function packagesOnlyTheDashboardHas(data: {
  testFile: string;
  dashboardSource: string;
  reader: ModuleReader;
}): Array<string> {
  const findings: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  const queue: Array<{ file: string; chain: Array<string> }> = [];

  for (const specifier of specifiersOf(data.reader.read(data.testFile))) {
    if (!specifier.startsWith(".")) {
      continue;
    }

    const file: string | null = resolveRelative(
      data.testFile,
      specifier,
      data.reader,
    );

    if (file && isInDashboard(file, data.dashboardSource)) {
      queue.push({ file, chain: [relativeName(file)] });
    }
  }

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;

    if (seen.has(file)) {
      continue;
    }

    seen.add(file);

    if (file.endsWith(".tsx")) {
      findings.push(`${chain.join(" -> ")}: a .tsx, which needs React`);
    }

    for (const specifier of specifiersOf(data.reader.read(file))) {
      if (specifier.startsWith(".")) {
        const next: string | null = resolveRelative(
          file,
          specifier,
          data.reader,
        );

        if (next && isInDashboard(next, data.dashboardSource)) {
          queue.push({ file: next, chain: [...chain, relativeName(next)] });
        }

        continue;
      }

      if (MAPPED.test(specifier) || specifier.startsWith("node:")) {
        continue;
      }

      const name: string = packageOf(specifier);

      if (!data.reader.appHasPackage(name)) {
        findings.push(`${chain.join(" -> ")}: imports "${specifier}"`);
      }
    }
  }

  return findings;
}

// A test file of the App's: TypeScript, with or without JSX.
const TEST_FILE: RegExp = /\.tsx?$/;

function listTests(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...listTests(full));
      }
    } else if (TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

describe("the Dashboard modules the App's tests load", () => {
  test("need no package only the Dashboard installs, React above all", () => {
    const tests: Array<string> = listTests(TESTS_DIRECTORY);
    const findings: Array<string> = tests.flatMap(
      (testFile: string): Array<string> => {
        return packagesOnlyTheDashboardHas({
          testFile,
          dashboardSource: DASHBOARD_SOURCE,
          reader: DISK,
        }).map((finding: string): string => {
          return `${relativeName(testFile)}: ${finding}`;
        });
      },
    );

    // The check reads a real graph: the App's tests load many Dashboard modules.
    expect(tests.length).toBeGreaterThan(1000);
    expect(findings).toEqual([]);
  });

  test("the explorers' hook keeps React out of what the hashed address test loads", () => {
    const searchModule: string = fs.readFileSync(
      path.join(
        DASHBOARD_SOURCE,
        "Components",
        "Telemetry",
        "HashedAddressSearch.ts",
      ),
      "utf8",
    );
    const hookModule: string = fs.readFileSync(
      path.join(
        DASHBOARD_SOURCE,
        "Components",
        "Telemetry",
        "useHashedAddressSearch.ts",
      ),
      "utf8",
    );

    expect(specifiersOf(searchModule)).not.toContain("react");
    expect(specifiersOf(hookModule)).toContain("react");
    expect(specifiersOf(hookModule)).toContain("./HashedAddressSearch");
  });
});

describe("the check of what a test loads", () => {
  const DASHBOARD: string = path.join(path.sep, "repo", "Dashboard", "src");
  const TEST: string = path.join(path.sep, "repo", "Tests", "Some.test.ts");

  function readerOf(
    files: Record<string, string>,
    installed: ReadonlyArray<string> = ["lodash"],
  ): ModuleReader {
    return {
      read: (file: string): string => {
        return files[file] ?? "";
      },
      isFile: (file: string): boolean => {
        return files[file] !== undefined;
      },
      appHasPackage: (name: string): boolean => {
        return installed.includes(name);
      },
    };
  }

  test("finds React two modules away, and names the chain (negative control)", () => {
    const pieces: string = path.join(DASHBOARD, "Pieces.ts");
    const hook: string = path.join(DASHBOARD, "Hook.ts");

    expect(
      packagesOnlyTheDashboardHas({
        testFile: TEST,
        dashboardSource: DASHBOARD,
        reader: readerOf({
          [TEST]: 'import { piece } from "../Dashboard/src/Pieces";',
          [pieces]: 'import useThing from "./Hook";\nimport x from "lodash";',
          [hook]: 'import type { ReactElement } from "react";',
        }),
      }).map((finding: string): string => {
        return finding.replace(/\\/g, "/");
      }),
    ).toEqual([
      expect.stringMatching(/Pieces\.ts -> .*Hook\.ts: imports "react"$/),
    ]);
  });

  test("finds a .tsx the test loads, and passes Common, mapped paths and the App's own packages", () => {
    const page: string = path.join(DASHBOARD, "Page.tsx");
    const words: string = path.join(DASHBOARD, "Words.ts");
    const reader: ModuleReader = readerOf({
      [TEST]: [
        'import Page from "../Dashboard/src/Page";',
        'import { WORDS } from "../Dashboard/src/Words";',
      ].join("\n"),
      [page]: "export default 1;",
      [words]: [
        'import API from "Common/UI/Utils/API/API";',
        'import Plugins from "@oneuptime/ee-dashboard";',
        'import fs from "node:fs";',
        'import pick from "lodash/pick";',
        '// import React from "react";',
        '/* require("react-dom") */',
      ].join("\n"),
    });

    expect(
      packagesOnlyTheDashboardHas({
        testFile: TEST,
        dashboardSource: DASHBOARD,
        reader,
      }).map((finding: string): string => {
        return finding.replace(/\\/g, "/");
      }),
    ).toEqual([
      expect.stringMatching(/Page\.tsx: a \.tsx, which needs React$/),
    ]);
  });

  test("reads every way a module names another", () => {
    expect(
      specifiersOf(
        [
          'import a from "a";',
          'import "b";',
          'export { c } from "c";',
          'const d = require("d");',
          'const e = jest.requireActual("e");',
          'const f = await import("f");',
          "import type { G } from 'g';",
          // A setup guide's snippet and a comment name no module of this one.
          'const guide: string = `import * as Sentry from "@sentry/browser";`;',
          "const node: string = 'const otel = require(\"@opentelemetry/api\");';",
          '// import React from "react";',
          '/* export { h } from "h"; */',
        ].join("\n"),
      ),
    ).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(packageOf("react-dom/client")).toBe("react-dom");
    expect(packageOf("@scope/name/deep")).toBe("@scope/name");
  });
});
