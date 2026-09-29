import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Where the Enterprise UI plugin specifiers point, in every place that has to
 * agree.
 *
 * "@oneuptime/ee-dashboard" and "@oneuptime/ee-admin-dashboard" are not
 * packages. Each is imported by one file (the frontend's
 * src/Enterprise/Plugins.ts) and resolved by configuration:
 *
 *   - the type checker: the Dashboard, AdminDashboard, Common and App
 *     tsconfigs (Common and App tests reach Plugins.ts through the frontend
 *     sources they import), always to the Community stub;
 *   - jest: the Common and App moduleNameMapper, to the same stub - the
 *     tsconfig entry alone leaves jest with "Cannot find module", and the jest
 *     entry alone leaves ts-jest with TS2307;
 *   - esbuild: Common/UI/esbuild-enterprise.js, to the stub or to ee/ (tested
 *     in Common/Tests/UI/EsbuildEnterpriseAlias.test.ts);
 *   - the ee UI tsconfigs, to the real ee plugin.
 *
 * A path that drifts in one of them fails in one CI job only, which is why
 * they are pinned together here.
 */

const APP_DIR: string = path.resolve(__dirname, "..");
const PACKAGES_DIR: string = path.resolve(APP_DIR, "..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_DIR, "..");
const COMMON_DIR: string = path.join(PACKAGES_DIR, "Common");
const EE_DIR: string = path.join(REPOSITORY_ROOT, "ee");

interface Frontend {
  name: string;
  directory: string;
  pluginSpecifier: string;
  internalSpecifier: string;
  eeSubdirectory: string;
}

const FRONTENDS: ReadonlyArray<Frontend> = [
  {
    name: "Dashboard",
    directory: path.join(APP_DIR, "FeatureSet", "Dashboard"),
    pluginSpecifier: "@oneuptime/ee-dashboard",
    internalSpecifier: "@oneuptime/dashboard",
    eeSubdirectory: "Dashboard",
  },
  {
    name: "AdminDashboard",
    directory: path.join(APP_DIR, "FeatureSet", "AdminDashboard"),
    pluginSpecifier: "@oneuptime/ee-admin-dashboard",
    internalSpecifier: "@oneuptime/admin-dashboard",
    eeSubdirectory: "AdminDashboard",
  },
];

type Paths = Record<string, Array<string>>;

interface CompilerOptionsWithPaths {
  paths?: Paths;
  baseUrl?: string;
}

// tsconfig files are JSONC; let TypeScript itself parse them.
function readTsconfigCompilerOptions(
  tsconfigPath: string,
): CompilerOptionsWithPaths {
  const parsed: { config?: unknown; error?: ts.Diagnostic } =
    ts.parseConfigFileTextToJson(
      tsconfigPath,
      fs.readFileSync(tsconfigPath, "utf8"),
    );

  expect(parsed.error).toBeUndefined();

  const config: { compilerOptions?: CompilerOptionsWithPaths } =
    parsed.config as { compilerOptions?: CompilerOptionsWithPaths };

  return config.compilerOptions || {};
}

function readJestModuleNameMapper(jestConfigPath: string): Paths {
  const config: { moduleNameMapper?: Record<string, string> } = JSON.parse(
    fs.readFileSync(jestConfigPath, "utf8"),
  ) as { moduleNameMapper?: Record<string, string> };

  const mapper: Paths = {};

  for (const [pattern, target] of Object.entries(
    config.moduleNameMapper || {},
  )) {
    mapper[pattern] = [target];
  }

  return mapper;
}

/*
 * The file a path/mapper target names, trying the extensions TypeScript and
 * jest would. Returns null when nothing exists.
 */
function resolveTarget(absoluteTarget: string): string | null {
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

function communityStubOf(frontend: Frontend): string {
  return path.join(
    frontend.directory,
    "src",
    "Enterprise",
    "CommunityPlugins.ts",
  );
}

function toFrontendCase(frontend: Frontend): [string, Frontend] {
  return [frontend.name, frontend];
}

/*
 * The mapper key each specifier needs. None of "@", "/" or "-" is special in
 * a regular expression outside a character class, so the specifier is used
 * as written, anchored at both ends.
 */
function anchoredPatternOf(frontend: Frontend): string {
  return `^${frontend.pluginSpecifier}$`;
}

const WHITESPACE_RUNS: RegExp = /\s+/g;

describe("the Community plugin stubs", () => {
  test.each(FRONTENDS.map(toFrontendCase))(
    "%s has one, next to the plugin door",
    (_name: string, frontend: Frontend) => {
      expect(fs.existsSync(communityStubOf(frontend))).toBe(true);
      expect(
        fs.existsSync(
          path.join(frontend.directory, "src", "Enterprise", "Plugins.ts"),
        ),
      ).toBe(true);
    },
  );
});

describe("tsconfig paths send each plugin specifier to its Community stub", () => {
  interface TsconfigCase {
    tsconfig: string;
    frontends: ReadonlyArray<Frontend>;
  }

  const cases: Array<TsconfigCase> = [
    {
      tsconfig: path.join(FRONTENDS[0]!.directory, "tsconfig.json"),
      frontends: [FRONTENDS[0]!],
    },
    {
      tsconfig: path.join(FRONTENDS[1]!.directory, "tsconfig.json"),
      frontends: [FRONTENDS[1]!],
    },
    // Common tests render Dashboard and AdminDashboard sources.
    { tsconfig: path.join(COMMON_DIR, "tsconfig.json"), frontends: FRONTENDS },
    // App tests import them, and compile-app type-checks those tests.
    { tsconfig: path.join(APP_DIR, "tsconfig.json"), frontends: FRONTENDS },
  ];

  test.each(
    cases.map((testCase: TsconfigCase): [string, TsconfigCase] => {
      return [path.relative(REPOSITORY_ROOT, testCase.tsconfig), testCase];
    }),
  )("%s", (_name: string, testCase: TsconfigCase) => {
    const options: CompilerOptionsWithPaths = readTsconfigCompilerOptions(
      testCase.tsconfig,
    );

    /*
     * No baseUrl: paths then resolve relative to the tsconfig itself, and
     * every other bare specifier keeps resolving exactly as before.
     */
    expect(options.baseUrl).toBeUndefined();

    for (const frontend of testCase.frontends) {
      const targets: Array<string> | undefined =
        options.paths?.[frontend.pluginSpecifier];

      expect({ specifier: frontend.pluginSpecifier, targets }).toEqual({
        specifier: frontend.pluginSpecifier,
        targets: [expect.any(String)],
      });

      const resolved: string | null = resolveTarget(
        path.resolve(path.dirname(testCase.tsconfig), targets![0]!),
      );

      expect(resolved).toBe(communityStubOf(frontend));
    }
  });
});

describe("jest moduleNameMapper twins map to the same stubs", () => {
  interface JestCase {
    jestConfig: string;
    rootDir: string;
  }

  const cases: Array<JestCase> = [
    {
      jestConfig: path.join(COMMON_DIR, "jest.config.json"),
      rootDir: COMMON_DIR,
    },
    { jestConfig: path.join(APP_DIR, "jest.config.json"), rootDir: APP_DIR },
  ];

  test.each(
    cases.map((testCase: JestCase): [string, JestCase] => {
      return [path.relative(REPOSITORY_ROOT, testCase.jestConfig), testCase];
    }),
  )("%s", (_name: string, testCase: JestCase) => {
    const mapper: Paths = readJestModuleNameMapper(testCase.jestConfig);

    for (const frontend of FRONTENDS) {
      /*
       * Anchored at both ends, so it can never also capture
       * "@oneuptime/ee-dashboard-something" or a deeper subpath.
       */
      const pattern: string = anchoredPatternOf(frontend);
      const targets: Array<string> | undefined = mapper[pattern];

      expect({ specifier: frontend.pluginSpecifier, targets }).toEqual({
        specifier: frontend.pluginSpecifier,
        targets: [expect.any(String)],
      });

      const target: string = targets![0]!.replace(
        "<rootDir>",
        testCase.rootDir,
      );

      expect(resolveTarget(path.resolve(target))).toBe(
        communityStubOf(frontend),
      );

      // The pattern really is anchored: only the exact specifier matches.
      const regex: RegExp = new RegExp(pattern);

      expect(regex.test(frontend.pluginSpecifier)).toBe(true);
      expect(regex.test(`${frontend.pluginSpecifier}-extra`)).toBe(false);
      expect(regex.test(`${frontend.pluginSpecifier}/Deep`)).toBe(false);
      expect(regex.test(`x${frontend.pluginSpecifier}`)).toBe(false);
    }
  });

  test("no earlier mapper entry swallows the plugin specifiers", () => {
    /*
     * jest applies the FIRST moduleNameMapper pattern that matches. Common's
     * "Common/(.*)" is unanchored, so pin that nothing ahead of the twins
     * matches the specifiers.
     */
    for (const testCase of cases) {
      const mapper: Paths = readJestModuleNameMapper(testCase.jestConfig);

      for (const frontend of FRONTENDS) {
        const firstMatch: string | undefined = Object.keys(mapper).find(
          (pattern: string): boolean => {
            return new RegExp(pattern).test(frontend.pluginSpecifier);
          },
        );

        expect({
          config: path.relative(REPOSITORY_ROOT, testCase.jestConfig),
          firstMatch,
        }).toEqual({
          config: path.relative(REPOSITORY_ROOT, testCase.jestConfig),
          firstMatch: anchoredPatternOf(frontend),
        });
      }
    }
  });
});

describe("the frontends' esbuild configs route the specifier through the enterprise helper", () => {
  test.each(FRONTENDS.map(toFrontendCase))(
    "%s",
    (_name: string, frontend: Frontend) => {
      const source: string = fs
        .readFileSync(
          path.join(frontend.directory, "esbuild.config.js"),
          "utf8",
        )
        .replace(WHITESPACE_RUNS, " ");

      expect(source).toContain('require("Common/UI/esbuild-enterprise")');
      expect(source).toContain(
        `pluginSpecifier: "${frontend.pluginSpecifier}"`,
      );
      expect(source).toContain(`eeSubdir: "${frontend.eeSubdirectory}"`);
      expect(source).toContain(
        `internalSpecifier: "${frontend.internalSpecifier}"`,
      );
      expect(source).toContain("frontendDir: __dirname");
      expect(source).toContain("additionalAlias: enterprise.alias");

      /*
       * createConfig({ additionalAlias }) only: EsbuildConfig.test pins the
       * config's keys, and nodePaths would let the repository root's
       * node_modules shadow the frontend's.
       */
      expect(source).not.toContain("nodePaths");
    },
  );
});

describe("eslint's Enterprise boundary names the real plugin doors", () => {
  test("both Plugins.ts exemptions point at files that exist", () => {
    const eslintConfig: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "eslint.config.js"),
      "utf8",
    );

    for (const frontend of FRONTENDS) {
      const door: string = path
        .relative(
          REPOSITORY_ROOT,
          path.join(frontend.directory, "src", "Enterprise", "Plugins.ts"),
        )
        .split(path.sep)
        .join("/");

      expect(eslintConfig).toContain(`"${door}"`);
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, door))).toBe(true);
    }

    expect(eslintConfig).toContain('"no-restricted-imports"');
  });
});

/*
 * ee/ is removed before the core CI jobs run, so this block only has
 * something to check in a full checkout. It reports as skipped rather than
 * passing vacuously, and the Enterprise Edition Test workflow (test.ee.yaml)
 * runs it with ee/ present.
 */
const describeWhenEnterprisePresent: typeof describe.skip = fs.existsSync(
  EE_DIR,
)
  ? describe
  : describe.skip;

describeWhenEnterprisePresent(
  "the ee UI tsconfigs point at the real plugin",
  () => {
    test.each(FRONTENDS.map(toFrontendCase))(
      "%s",
      (_name: string, frontend: Frontend) => {
        const eeFrontendDir: string = path.join(
          EE_DIR,
          frontend.eeSubdirectory,
        );
        const tsconfigPath: string = path.join(eeFrontendDir, "tsconfig.json");

        expect(fs.existsSync(path.join(eeFrontendDir, "Index.tsx"))).toBe(true);
        expect(fs.existsSync(tsconfigPath)).toBe(true);

        const options: CompilerOptionsWithPaths =
          readTsconfigCompilerOptions(tsconfigPath);

        const pluginTarget: string | undefined =
          options.paths?.[frontend.pluginSpecifier]?.[0];
        expect(pluginTarget).toBeDefined();
        expect(resolveTarget(path.resolve(eeFrontendDir, pluginTarget!))).toBe(
          path.join(eeFrontendDir, "Index.tsx"),
        );

        const internalTarget: string | undefined =
          options.paths?.[`${frontend.internalSpecifier}/*`]?.[0];
        expect(internalTarget).toBeDefined();
        expect(path.resolve(eeFrontendDir, internalTarget!)).toBe(
          path.join(frontend.directory, "src", "*"),
        );

        const commonTarget: string | undefined =
          options.paths?.["Common/*"]?.[0];
        expect(commonTarget).toBeDefined();
        expect(path.resolve(eeFrontendDir, commonTarget!)).toBe(
          path.join(COMMON_DIR, "*"),
        );
      },
    );
  },
);
