import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { readConfigs } from "jest-config";
import path from "path";

/*
 * ee/jest.config.js: the server project must resolve Common/ and App/ to the
 * core packages with anchored mappers, and the ui project's mapper list must
 * be DERIVED from packages/Common/jest.config.json (never a drifting copy).
 * Every option sits where Jest reads it, the test timeout above all (#6382).
 * Running this file at all proves the server project works.
 */

interface JestProject {
  displayName: string;
  rootDir: string;
  testEnvironment: string;
  testMatch: Array<string>;
  moduleNameMapper: Record<string, string>;
  setupFilesAfterEnv?: Array<string>;
}

// An anchored ("^...") or file-extension ("\\.(css|...)$") mapper key.
const ANCHORED_OR_EXTENSION_KEY: RegExp = /^[\^\\]/;

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const COMMON_DIR: string = path.resolve(EE_DIR, "..", "packages", "Common");
const APP_DIR: string = path.resolve(EE_DIR, "..", "packages", "App");

/*
 * Keys ee/jest.config.js maps itself, ahead of Common's list: the core
 * packages, the frontend internals, and the Enterprise plugin specifiers -
 * which Common maps to the Community stubs but ee must map to its own
 * plugins.
 */
const EE_OVERRIDDEN_KEYS: ReadonlySet<string> = new Set<string>([
  "^Common/(.*)$",
  "^App/(.*)$",
  "^@oneuptime/dashboard/(.*)$",
  "^@oneuptime/admin-dashboard/(.*)$",
  "^@oneuptime/ee-dashboard$",
  "^@oneuptime/ee-admin-dashboard$",
]);

const jestConfig: {
  testTimeout?: number;
  projects: Array<JestProject>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
} = require("../../jest.config.js");

const project: (name: string) => JestProject = (name: string): JestProject => {
  const found: JestProject | undefined = jestConfig.projects.find(
    (candidate: JestProject): boolean => {
      return candidate.displayName === name;
    },
  );

  if (!found) {
    throw new Error(`No jest project named ${name}`);
  }

  return found;
};

const commonJestConfig: {
  moduleNameMapper: Record<string, string>;
  testEnvironment: string;
  setupFilesAfterEnv: Array<string>;
  testTimeout: number;
} = JSON.parse(
  fs.readFileSync(path.join(COMMON_DIR, "jest.config.json"), "utf8"),
);

describe("ee/jest.config.js", () => {
  test("has exactly the server and ui projects, both rooted at ee/", () => {
    expect(
      jestConfig.projects.map((candidate: JestProject) => {
        return candidate.displayName;
      }),
    ).toEqual(["server", "ui"]);

    for (const candidate of jestConfig.projects) {
      expect(candidate.rootDir).toBe(EE_DIR);
    }
  });

  test("the server project runs in node, and this test is in it", () => {
    expect(project("server").testEnvironment).toBe("node");
    expect(
      typeof (globalThis as unknown as Record<string, unknown>)["document"],
    ).toBe("undefined");
  });

  test("the server project maps Common/ and App/ with anchored patterns only", () => {
    expect(project("server").moduleNameMapper).toEqual({
      "^Common/(.*)$": path.join(COMMON_DIR, "$1"),
      "^App/(.*)$": path.join(APP_DIR, "$1"),
    });
  });

  test("Common/ and App/ imports land on the core packages", () => {
    expect(require.resolve("Common/Server/Enterprise/EnterpriseEdition")).toBe(
      path.join(COMMON_DIR, "Server", "Enterprise", "EnterpriseEdition.ts"),
    );
    expect(require.resolve("App/Utils/EnterpriseLoader")).toBe(
      path.join(APP_DIR, "Utils", "EnterpriseLoader.ts"),
    );
  });

  test("the ui project uses Common's jsdom environment and setup file", () => {
    const ui: JestProject = project("ui");

    expect(ui.testEnvironment).toBe(
      commonJestConfig.testEnvironment.replace("<rootDir>", COMMON_DIR),
    );
    expect(fs.existsSync(ui.testEnvironment)).toBe(true);
    expect(ui.setupFilesAfterEnv).toEqual(
      commonJestConfig.setupFilesAfterEnv.map((file: string) => {
        return file.replace("<rootDir>", COMMON_DIR);
      }),
    );
  });

  test("the ui project carries every one of Common's mappers, rooted at packages/Common", () => {
    const uiMapper: Record<string, string> = project("ui").moduleNameMapper;

    for (const [key, value] of Object.entries(
      commonJestConfig.moduleNameMapper,
    )) {
      const expectedValue: string = value.split("<rootDir>").join(COMMON_DIR);
      const mappedKey: string | undefined = [key, `^${key}$`, `^${key}`].find(
        (candidate: string): boolean => {
          return candidate in uiMapper;
        },
      );

      expect({ key, mapped: mappedKey !== undefined }).toEqual({
        key,
        mapped: true,
      });

      if (EE_OVERRIDDEN_KEYS.has(mappedKey as string)) {
        // ee maps these itself (Common's copy points at the CE stubs).
        continue;
      }

      expect(uiMapper[mappedKey as string]).toBe(expectedValue);
    }
  });

  test("no ui mapper still points at <rootDir> or is an unanchored bare module pattern", () => {
    for (const [key, value] of Object.entries(project("ui").moduleNameMapper)) {
      expect(value).not.toContain("<rootDir>");
      expect({
        key,
        anchoredOrExtension: ANCHORED_OR_EXTENSION_KEY.test(key),
      }).toEqual({
        key,
        anchoredOrExtension: true,
      });
    }
  });

  /*
   * jest uses the first matching mapper. Asset mappers (keys that are not a
   * bare module name) must win over ^Common/(.*)$, or an import such as
   * "Common/UI/Images/logo.svg" resolves to the file and is parsed as JS; the
   * frontend specifiers must win over every bare Common pattern, or
   * "@oneuptime/dashboard/Components/Common/..." is caught by a Common/ key.
   */
  test("asset mappers come first, then the frontend specifiers, then Common's bare patterns", () => {
    const keys: Array<string> = Object.keys(project("ui").moduleNameMapper);
    const mapper: Record<string, string> = project("ui").moduleNameMapper;
    const isAssetKey: (key: string) => boolean = (key: string): boolean => {
      return key.startsWith("\\.");
    };

    const assetKeys: Array<string> = keys.filter(isAssetKey);
    expect(assetKeys.length).toBeGreaterThan(0);
    expect(keys.slice(0, assetKeys.length)).toEqual(assetKeys);
    expect(
      assetKeys.some((key: string) => {
        return key.includes("svg");
      }),
    ).toBe(true);

    expect(keys.slice(assetKeys.length, assetKeys.length + 4)).toEqual([
      "^@oneuptime/dashboard/(.*)$",
      "^@oneuptime/admin-dashboard/(.*)$",
      "^@oneuptime/ee-dashboard$",
      "^@oneuptime/ee-admin-dashboard$",
    ]);
    expect(keys.indexOf("^Common/(.*)$")).toBeGreaterThan(assetKeys.length + 3);
    expect(mapper["^@oneuptime/dashboard/(.*)$"]).toBe(
      path.join(APP_DIR, "FeatureSet", "Dashboard", "src", "$1"),
    );
    expect(mapper["^@oneuptime/admin-dashboard/(.*)$"]).toBe(
      path.join(APP_DIR, "FeatureSet", "AdminDashboard", "src", "$1"),
    );
    expect(mapper["^Common/(.*)$"]).toBe(path.join(COMMON_DIR, "$1"));
  });

  test("in ee's own UI tests the plugin specifiers resolve to the real ee plugins, not the Community stubs", () => {
    const mapper: Record<string, string> = project("ui").moduleNameMapper;

    expect(mapper["^@oneuptime/ee-dashboard$"]).toBe(
      path.join(EE_DIR, "Dashboard", "Index.tsx"),
    );
    expect(mapper["^@oneuptime/ee-admin-dashboard$"]).toBe(
      path.join(EE_DIR, "AdminDashboard", "Index.tsx"),
    );
  });
});

/*
 * EVERY OPTION WHERE JEST READS IT (#6382). In a config with `projects`, Jest
 * reads its global options - testTimeout, verbose, bail, coverage, reporters
 * and the rest - at the top level only, and a project's options in that
 * project's entry only. Whatever sits in the other place is dropped without a
 * word. ee/jest.config.js set testTimeout inside each project (30 s for
 * server, 60 s for ui): neither applied, and every ee test ran with Jest's
 * default of 5 seconds, which a busy machine overran.
 *
 * Which options go where comes from Jest's own config reader (readConfigs,
 * the one `jest --showConfig` prints from), so it holds for the Jest ee runs.
 * testTimeout is named as well: Jest 30 keeps a project's testTimeout in the
 * config it prints, yet times every test by the top-level one, so reading the
 * config would not catch it there. Tests/Server/JestTimeout.test.ts and
 * Tests/UI/JestTimeout.test.ts run a 6-second test in each project.
 */

type JestReading = Awaited<ReturnType<typeof readConfigs>>;
type JestProjectConfig = JestReading["configs"][number];

interface OptionPlaces {
  topLevelOnly: Array<string>;
  projectOnly: Array<string>;
}

const JEST_DEFAULT_TEST_TIMEOUT_IN_MS: number = 5000;

// Which options Jest reads only at the top level, and which only in a project.
const optionPlaces: (reading: JestReading) => OptionPlaces = (
  reading: JestReading,
): OptionPlaces => {
  const globalOptions: Set<string> = new Set<string>(
    Object.keys(reading.globalConfig),
  );
  const projectOptions: Set<string> = new Set<string>(
    reading.configs.flatMap((config: JestProjectConfig): Array<string> => {
      return Object.keys(config);
    }),
  );

  return {
    topLevelOnly: [
      ...new Set<string>([
        ...[...globalOptions].filter((option: string): boolean => {
          return !projectOptions.has(option);
        }),
        // Jest 30 keeps it in a project's config, but never applies it.
        "testTimeout",
      ]),
    ],
    projectOnly: [...projectOptions].filter((option: string): boolean => {
      return !globalOptions.has(option);
    }),
  };
};

describe("ee/jest.config.js puts every option where Jest reads it", () => {
  let reading: JestReading;

  beforeAll(async () => {
    reading = await readConfigs({ $0: "jest", _: [] }, [
      path.join(EE_DIR, "jest.config.js"),
    ]);
  });

  test("every ee test gets Common's test timeout, set at the top level and in no project", () => {
    expect({ topLevelTestTimeout: jestConfig.testTimeout }).toEqual({
      topLevelTestTimeout: commonJestConfig.testTimeout,
    });
    expect(jestConfig.testTimeout).toBeGreaterThan(
      JEST_DEFAULT_TEST_TIMEOUT_IN_MS,
    );

    for (const candidate of jestConfig.projects) {
      expect({
        project: candidate.displayName,
        setsTestTimeout: "testTimeout" in candidate,
      }).toEqual({ project: candidate.displayName, setsTestTimeout: false });
    }
  });

  test("Jest's own config reader times both projects' tests by it", () => {
    expect(
      reading.configs.map((config: JestProjectConfig) => {
        return config.displayName?.name;
      }),
    ).toEqual(["server", "ui"]);
    expect({
      testTimeoutJestApplies: reading.globalConfig.testTimeout,
    }).toEqual({ testTimeoutJestApplies: commonJestConfig.testTimeout });
  });

  test("no project sets an option Jest reads only at the top level", () => {
    const { topLevelOnly }: OptionPlaces = optionPlaces(reading);

    // From Jest's reader: it must hold these, or the check passes on nothing.
    expect(topLevelOnly).toEqual(
      expect.arrayContaining([
        "testTimeout",
        "verbose",
        "bail",
        "coverageThreshold",
        "reporters",
        "maxWorkers",
      ]),
    );

    for (const candidate of jestConfig.projects) {
      expect({
        project: candidate.displayName,
        topLevelOptions: Object.keys(candidate).filter(
          (option: string): boolean => {
            return topLevelOnly.includes(option);
          },
        ),
      }).toEqual({ project: candidate.displayName, topLevelOptions: [] });
    }
  });

  test("the top level sets no option Jest reads only in a project", () => {
    const { projectOnly }: OptionPlaces = optionPlaces(reading);

    // From Jest's reader: it must hold these, or the check passes on nothing.
    expect(projectOnly).toEqual(
      expect.arrayContaining([
        "testEnvironment",
        "setupFilesAfterEnv",
        "moduleNameMapper",
        "clearMocks",
      ]),
    );
    expect({
      projectOptionsAtTheTopLevel: Object.keys(jestConfig).filter(
        (option: string): boolean => {
          return projectOnly.includes(option);
        },
      ),
    }).toEqual({ projectOptionsAtTheTopLevel: [] });
  });
});
