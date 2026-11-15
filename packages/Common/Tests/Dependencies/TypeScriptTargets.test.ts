import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * WHICH JAVASCRIPT EACH PACKAGE'S TYPESCRIPT COMPILES TO (issue #8223).
 *
 * The servers - the App and its workers, the Probe, the Runner and the
 * other Node packages - run their TypeScript through ts-node with their
 * tsconfig's target, and so do their tests (ts-jest). Below ES2018 an
 * object spread, `{ ...record }`, is compiled to Object.assign, which
 * assigns every key: a key named "__proto__" - an attribute, a label, any
 * key of a decoded JSON body - was dropped, and an object under it became
 * the copy's prototype, its keys then read by name through the copy.
 * From ES2018 a spread is the language's own, which defines each key: the
 * copy keeps "__proto__" as its own key and its prototype is never the
 * sender's. Node 22 and later, which every image and the CLI run, have it.
 *
 * Not ES2022 or later without saying so: from there TypeScript's default
 * for useDefineForClassFields turns on, which changes how every class
 * field is set (the models' decorated columns among them).
 *
 * The browser bundles are built by esbuild with its own target
 * (Common/UI/esbuild-config.js, es2017; EsbuildConfig.test.ts), which
 * does not read a tsconfig's. The front ends' tsconfigs only type-check,
 * and stay at that same target, so TypeScript still refuses what esbuild
 * cannot lower for those browsers - a regular expression's lookbehind or
 * named groups, which Safari before 16.4 does not run.
 */

// packages/Common/Tests/Dependencies -> the repository root.
const ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

// Compiled for Node: ts-node and ts-jest emit with these.
const SERVER_TSCONFIGS: ReadonlyArray<string> = [
  "tsconfig.json",
  "Scripts/tsconfig.json",
  "packages/Common/tsconfig.json",
  "packages/App/tsconfig.json",
  "packages/Probe/tsconfig.json",
  "packages/Runner/tsconfig.json",
  "packages/Nginx/tsconfig.json",
  "packages/TestServer/tsconfig.json",
  "packages/Home/tsconfig.json",
  "packages/E2E/tsconfig.json",
  "packages/CLI/tsconfig.json",
  // Checks the enterprise server with App's flags; App's tsconfig runs it.
  "ee/tsconfig.json",
];

// Type-checked only: esbuild bundles these for the browser.
const BROWSER_TSCONFIGS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/Accounts/tsconfig.json",
  "packages/App/FeatureSet/AdminDashboard/tsconfig.json",
  "packages/App/FeatureSet/Dashboard/tsconfig.json",
  "packages/App/FeatureSet/PublicDashboard/tsconfig.json",
  "packages/App/FeatureSet/StatusPage/tsconfig.json",
  "ee/Dashboard/tsconfig.json",
  "ee/AdminDashboard/tsconfig.json",
  "ee/Tests/UI/tsconfig.json",
];

// Built and targeted on their own, by their own toolchains and tests.
const OWN_TARGETS: ReadonlyArray<string> = [
  "packages/App/FeatureSet/BrowserRecorder/tsconfig.json",
  "packages/App/FeatureSet/MobileRecorder/tsconfig.json",
  "packages/MobileApp/tsconfig.json",
];

// The esbuild target of the browser bundles, Common/UI/esbuild-config.js.
const BROWSER_BUNDLE_TARGET: ts.ScriptTarget = ts.ScriptTarget.ES2017;

interface CompilerOptions {
  target: ts.ScriptTarget | undefined;
  useDefineForClassFields: boolean | undefined;
}

// The file's own compilerOptions, as TypeScript reads them (comments and all).
function compilerOptionsOf(relativePath: string): CompilerOptions {
  const file: string = path.join(ROOT, relativePath);
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(
    file,
    ts.sys.readFile,
  );

  if (read.error) {
    throw new Error(
      `${relativePath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, "\n")}`,
    );
  }

  const raw: { compilerOptions?: Record<string, unknown> } =
    (read.config as { compilerOptions?: Record<string, unknown> }) || {};
  const converted: { options: ts.CompilerOptions } =
    ts.convertCompilerOptionsFromJson(
      raw.compilerOptions || {},
      path.dirname(file),
    );

  return {
    target: converted.options.target,
    useDefineForClassFields: converted.options.useDefineForClassFields,
  };
}

function nameOf(target: ts.ScriptTarget | undefined): string {
  return target === undefined ? "(none)" : ts.ScriptTarget[target];
}

// Every tsconfig.json a package or the enterprise edition has at its top.
function packageTsconfigs(): Array<string> {
  const found: Array<string> = [];
  const lookIn: Array<string> = [
    "packages",
    "packages/App/FeatureSet",
    "ee",
    "ee/Tests",
  ];

  for (const directory of lookIn) {
    for (const entry of fs.readdirSync(path.join(ROOT, directory), {
      withFileTypes: true,
    })) {
      const candidate: string = `${directory}/${entry.name}/tsconfig.json`;

      if (entry.isDirectory() && fs.existsSync(path.join(ROOT, candidate))) {
        found.push(candidate);
      }
    }
  }

  if (fs.existsSync(path.join(ROOT, "ee/tsconfig.json"))) {
    found.push("ee/tsconfig.json");
  }

  return found.sort();
}

describe("the TypeScript target of every package", () => {
  test.each(SERVER_TSCONFIGS)(
    "%s compiles for Node at ES2018 or later, below ES2022",
    (relativePath: string) => {
      const options: CompilerOptions = compilerOptionsOf(relativePath);

      expect({
        relativePath,
        target: nameOf(options.target),
        keepsProtoInASpread:
          options.target !== undefined &&
          options.target >= ts.ScriptTarget.ES2018,
        keepsClassFieldsAsTheyAre:
          options.target !== undefined &&
          (options.target < ts.ScriptTarget.ES2022 ||
            options.useDefineForClassFields === false),
      }).toEqual({
        relativePath,
        target: nameOf(options.target),
        keepsProtoInASpread: true,
        keepsClassFieldsAsTheyAre: true,
      });
    },
  );

  test.each(BROWSER_TSCONFIGS)(
    "%s type-checks at the browser bundles' target",
    (relativePath: string) => {
      expect({
        relativePath,
        target: nameOf(compilerOptionsOf(relativePath).target),
      }).toEqual({ relativePath, target: nameOf(BROWSER_BUNDLE_TARGET) });
    },
  );

  test("the browser bundles' target is still the one these front ends type-check at", () => {
    const config: string = fs.readFileSync(
      path.join(ROOT, "packages/Common/UI/esbuild-config.js"),
      "utf8",
    );

    expect(config).toContain(
      `target: "${nameOf(BROWSER_BUNDLE_TARGET).toLowerCase()}"`,
    );
  });

  test("every package's tsconfig is one of these, so a new one says which it is", () => {
    const known: Set<string> = new Set([
      ...SERVER_TSCONFIGS,
      ...BROWSER_TSCONFIGS,
      ...OWN_TARGETS,
    ]);

    expect(
      packageTsconfigs().filter((relativePath: string): boolean => {
        return !known.has(relativePath);
      }),
    ).toEqual([]);

    for (const relativePath of known) {
      expect({
        relativePath,
        exists: fs.existsSync(path.join(ROOT, relativePath)),
      }).toEqual({ relativePath, exists: true });
    }
  });
});

describe("a spread, as this package compiles it", () => {
  test("keeps a key named __proto__ as the copy's own, in order", () => {
    const record: Record<string, unknown> = JSON.parse(
      '{"team":"payments","__proto__":"x","region":"eu"}',
    ) as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...record };

    expect(Object.keys(copy)).toEqual(["team", "__proto__", "region"]);
    expect(Object.getOwnPropertyDescriptor(copy, "__proto__")?.value).toBe("x");
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  });

  test("never takes an object under __proto__ as the copy's prototype", () => {
    const record: Record<string, unknown> = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"team":"payments"}',
    ) as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...record, extra: 1 };

    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy["polluted"]).toBeUndefined();
    expect(Object.keys(copy)).toEqual(["__proto__", "team", "extra"]);
  });

  test("and an object rest keeps it too", () => {
    const record: Record<string, unknown> = JSON.parse(
      '{"team":"payments","__proto__":"x"}',
    ) as Record<string, unknown>;
    const { team, ...rest }: Record<string, unknown> = record;

    expect(team).toBe("payments");
    expect(Object.keys(rest)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(rest)).toBe(Object.prototype);
  });
});
