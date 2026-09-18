import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import type EnterpriseLoaderType from "../../Utils/EnterpriseLoader";
import type {
  EnterpriseLoaderOptions,
  EnterpriseLoadResult,
} from "../../Utils/EnterpriseLoader";
import type EnterpriseEditionType from "Common/Server/Enterprise/EnterpriseEdition";
import type JobDictionaryType from "../../FeatureSet/Workers/Utils/JobDictionary";
import {
  getFixtureCalls,
  resetFixtureCalls,
} from "../Fixtures/EnterpriseModules/FixtureModuleFactory";

/*
 * The boot loader for the Enterprise Edition module.
 *
 * Every case gets a fresh module registry (jest.resetModules) so the loader,
 * EnterpriseEdition and JobDictionary all start empty, exactly like a new
 * process; the fixture the loader require()s is resolved through that same
 * registry, so it shares those singletons. Billing, the raw
 * IS_ENTERPRISE_EDITION flag and the edition are always passed explicitly:
 * CI's config.env sets BILLING_ENABLED=true, and nothing here may depend on it.
 */

const APP_ROOT: string = path.resolve(__dirname, "../..");
const REPOSITORY_ROOT: string = path.resolve(APP_ROOT, "../..");
const FIXTURES_DIR: string = path.join(
  __dirname,
  "..",
  "Fixtures",
  "EnterpriseModules",
);

const ENTERPRISE_JOB_NAMES: Array<string> = [
  "EnterpriseLicense:ReportUserCount",
  "EnterpriseLicense:SendLicenseNotificationEmails",
  "EnterpriseLicense:ReconcileInstanceUsage",
  "InstanceHealth:EvaluatePostgresHealth",
  "InstanceHealth:EvaluateRedisHealth",
];

const fixture: (name: string) => string = (name: string): string => {
  return path.join(FIXTURES_DIR, name);
};

type SpyFunction = ReturnType<typeof jest.fn>;

interface LoggerSpies {
  info: SpyFunction;
  warn: SpyFunction;
  error: SpyFunction;
  debug: SpyFunction;
}

interface FreshModules {
  EnterpriseLoader: typeof EnterpriseLoaderType;
  loaderModule: typeof import("../../Utils/EnterpriseLoader");
  EnterpriseEdition: typeof EnterpriseEditionType;
  JobDictionary: typeof JobDictionaryType;
  logs: LoggerSpies;
}

const loadFresh: () => Promise<FreshModules> =
  async (): Promise<FreshModules> => {
    jest.resetModules();

    const loggerModule: typeof import("Common/Server/Utils/Logger") =
      await import("Common/Server/Utils/Logger");
    const logs: LoggerSpies = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    jest.spyOn(loggerModule.default, "info").mockImplementation(logs.info);
    jest.spyOn(loggerModule.default, "warn").mockImplementation(logs.warn);
    jest.spyOn(loggerModule.default, "error").mockImplementation(logs.error);
    jest.spyOn(loggerModule.default, "debug").mockImplementation(logs.debug);

    const loaderModule: typeof import("../../Utils/EnterpriseLoader") =
      await import("../../Utils/EnterpriseLoader");
    const editionModule: typeof import("Common/Server/Enterprise/EnterpriseEdition") =
      await import("Common/Server/Enterprise/EnterpriseEdition");
    const jobDictionaryModule: typeof import("../../FeatureSet/Workers/Utils/JobDictionary") =
      await import("../../FeatureSet/Workers/Utils/JobDictionary");

    return {
      EnterpriseLoader: loaderModule.default,
      loaderModule,
      EnterpriseEdition: editionModule.default,
      JobDictionary: jobDictionaryModule.default,
      logs,
    };
  };

/*
 * Self-hosted, no raw flag, auto edition, short timeouts, and an empty
 * enterpriseDirectory (= no override, and never read ONEUPTIME_EE_DIR from the
 * environment): override per case.
 */
const baseOptions: (
  overrides?: EnterpriseLoaderOptions,
) => EnterpriseLoaderOptions = (
  overrides?: EnterpriseLoaderOptions,
): EnterpriseLoaderOptions => {
  return {
    edition: "auto",
    enterpriseDirectory: "",
    isBillingEnabled: false,
    allowBillingWithoutEnterprise: false,
    isEnterpriseEditionRequested: false,
    initTimeoutInMs: 100,
    licenseLoadTimeoutInMs: 100,
    ...(overrides || {}),
  };
};

const loggedText: (spy: SpyFunction) => string = (spy: SpyFunction): string => {
  return spy.mock.calls
    .map((call: Array<unknown>): string => {
      return call.map(String).join(" ");
    })
    .join("\n");
};

const temporaryDirectories: Array<string> = [];

const makeTemporaryDirectory: () => string = (): string => {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-enterprise-loader-"),
  );
  temporaryDirectories.push(directory);
  return directory;
};

const writeFile: (filePath: string, content: string) => void = (
  filePath: string,
  content: string,
): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
};

beforeEach(() => {
  resetFixtureCalls();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("EnterpriseLoader candidate directories", () => {
  test("the default App root is the App package", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.getDefaultAppRoot()).toBe(APP_ROOT);
  });

  test("the repo layout resolves to <repo>/ee first, never packages/ee first", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.getCandidateDirectories(APP_ROOT)).toEqual([
      path.join(REPOSITORY_ROOT, "ee"),
      path.join(REPOSITORY_ROOT, "packages", "ee"),
    ]);
  });

  test("the container layout resolves /usr/src/app to /usr/src/ee", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.getCandidateDirectories("/usr/src/app")).toContain(
      "/usr/src/ee",
    );
  });

  test("ONEUPTIME_EE_DIR replaces both candidates", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(
      EnterpriseLoader.getCandidateDirectories(APP_ROOT, "/opt/custom/ee"),
    ).toEqual(["/opt/custom/ee"]);
  });

  test("a relative ONEUPTIME_EE_DIR resolves against the working directory", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(
      EnterpriseLoader.getCandidateDirectories(APP_ROOT, "fixtures/ee"),
    ).toEqual([path.resolve(process.cwd(), "fixtures/ee")]);
  });

  test("a blank ONEUPTIME_EE_DIR is ignored", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.getCandidateDirectories(APP_ROOT, "   ")).toEqual(
      EnterpriseLoader.getCandidateDirectories(APP_ROOT),
    );
  });
});

describe("EnterpriseLoader entry file detection", () => {
  test("finds Server/Index.ts", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.findEntryFile(fixture("DefaultExport"))).toBe(
      path.join(fixture("DefaultExport"), "Server", "Index.ts"),
    );
  });

  test("finds Server/Index.js when there is no Index.ts", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(EnterpriseLoader.findEntryFile(fixture("CommonJs"))).toBe(
      path.join(fixture("CommonJs"), "Server", "Index.js"),
    );
  });

  test("prefers Index.ts when both exist", async () => {
    const { EnterpriseLoader } = await loadFresh();
    const directory: string = makeTemporaryDirectory();
    writeFile(path.join(directory, "Server", "Index.ts"), "");
    writeFile(path.join(directory, "Server", "Index.js"), "");

    expect(EnterpriseLoader.findEntryFile(directory)).toBe(
      path.join(directory, "Server", "Index.ts"),
    );
  });

  test("a directory with only node_modules (a leftover checkout) is not Enterprise", async () => {
    const { EnterpriseLoader } = await loadFresh();
    const directory: string = makeTemporaryDirectory();
    fs.mkdirSync(path.join(directory, "node_modules", "openid-client"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(directory, "Server"), { recursive: true });

    expect(EnterpriseLoader.findEntryFile(directory)).toBeNull();
  });

  test("a directory named Index.ts is not an entry file", async () => {
    const { EnterpriseLoader } = await loadFresh();
    const directory: string = makeTemporaryDirectory();
    fs.mkdirSync(path.join(directory, "Server", "Index.ts"), {
      recursive: true,
    });

    expect(EnterpriseLoader.findEntryFile(directory)).toBeNull();
  });

  test("a directory that does not exist is not Enterprise", async () => {
    const { EnterpriseLoader } = await loadFresh();

    expect(
      EnterpriseLoader.findEntryFile(path.join(FIXTURES_DIR, "DoesNotExist")),
    ).toBeNull();
  });
});

describe("EnterpriseLoader.load: the Enterprise Edition", () => {
  test("loads, unwraps the default export, registers, initialises and reads the license", async () => {
    const { EnterpriseLoader, EnterpriseEdition, logs } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("DefaultExport") }),
    );

    expect(result.outcome).toBe("loaded");
    expect(result.edition).toBe("auto");
    expect(result.directory).toBe(fixture("DefaultExport"));
    expect(result.entryFile).toBe(
      path.join(fixture("DefaultExport"), "Server", "Index.ts"),
    );
    expect(result.initCompleted).toBe(true);
    expect(result.initError).toBeNull();
    expect(result.licenseSnapshot?.status).toBe("missing");

    expect(EnterpriseEdition.isLoaded()).toBe(true);
    expect(EnterpriseEdition.getModule()?.version).toBe("0.0.0-DefaultExport");
    expect(getFixtureCalls()).toEqual([
      "DefaultExport:required",
      "DefaultExport:init",
      "DefaultExport:getSnapshot",
    ]);
    expect(loggedText(logs.info)).toContain(
      "OneUptime Enterprise Edition 0.0.0-DefaultExport loaded",
    );
    expect(logs.error).not.toHaveBeenCalled();
  });

  test("loads a CommonJS .js entry with no default export", async () => {
    const { EnterpriseLoader, EnterpriseEdition } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("CommonJs") }),
    );

    expect(result.outcome).toBe("loaded");
    expect(EnterpriseEdition.getModule()?.version).toBe("0.0.0-CommonJs");
  });

  test("ONEUPTIME_EDITION=enterprise loads it too", async () => {
    const { EnterpriseLoader, EnterpriseEdition } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        edition: "enterprise",
        enterpriseDirectory: fixture("DefaultExport"),
      }),
    );

    expect(result.outcome).toBe("loaded");
    expect(EnterpriseEdition.isLoaded()).toBe(true);
  });

  test("discovers ee/ next to the App root (repo layout) with no override", async () => {
    const { EnterpriseLoader, EnterpriseEdition } = await loadFresh();
    const root: string = makeTemporaryDirectory();
    const appRoot: string = path.join(root, "packages", "App");
    fs.mkdirSync(appRoot, { recursive: true });
    writeFile(
      path.join(root, "ee", "Server", "Index.js"),
      `module.exports = require(${JSON.stringify(
        path.join(fixture("CommonJs"), "Server", "Index.js"),
      )});\n`,
    );

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ appRoot, enterpriseDirectory: "" }),
    );

    expect(result.outcome).toBe("loaded");
    expect(result.directory).toBe(path.join(root, "ee"));
    expect(result.searchedDirectories[0]).toBe(path.join(root, "ee"));
    expect(EnterpriseEdition.isLoaded()).toBe(true);
  });

  test("discovers /usr/src/ee-style layouts (the second candidate)", async () => {
    const { EnterpriseLoader } = await loadFresh();
    const root: string = makeTemporaryDirectory();
    const appRoot: string = path.join(root, "usr", "src", "app");
    fs.mkdirSync(appRoot, { recursive: true });
    writeFile(
      path.join(root, "usr", "src", "ee", "Server", "Index.js"),
      `module.exports = require(${JSON.stringify(
        path.join(fixture("CommonJs"), "Server", "Index.js"),
      )});\n`,
    );

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ appRoot, enterpriseDirectory: "" }),
    );

    expect(result.outcome).toBe("loaded");
    expect(result.directory).toBe(path.join(root, "usr", "src", "ee"));
  });

  test("a second load in the same process does not load or initialise again", async () => {
    const { EnterpriseLoader } = await loadFresh();

    await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("DefaultExport") }),
    );
    const second: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("DefaultExport") }),
    );

    expect(second.outcome).toBe("already-loaded");
    expect(
      getFixtureCalls().filter((call: string) => {
        return call === "DefaultExport:init";
      }),
    ).toHaveLength(1);
  });
});

describe("EnterpriseLoader.load: the Community Edition", () => {
  test("no ee/ on disk runs the Community Edition quietly", async () => {
    const { EnterpriseLoader, EnterpriseEdition, logs } = await loadFresh();
    const root: string = makeTemporaryDirectory();
    const appRoot: string = path.join(root, "packages", "App");
    fs.mkdirSync(appRoot, { recursive: true });

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ appRoot, enterpriseDirectory: "" }),
    );

    expect(result.outcome).toBe("not-found");
    expect(result.searchedDirectories).toEqual([
      path.join(root, "ee"),
      path.join(root, "packages", "ee"),
    ]);
    expect(EnterpriseEdition.isLoaded()).toBe(false);
    expect(loggedText(logs.info)).toContain("Community Edition");
    expect(logs.warn).not.toHaveBeenCalled();
    expect(logs.error).not.toHaveBeenCalled();
  });

  test("ONEUPTIME_EDITION=community never loads ee/, even when it is there", async () => {
    const { EnterpriseLoader, EnterpriseEdition } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        edition: "community",
        enterpriseDirectory: fixture("DefaultExport"),
      }),
    );

    expect(result.outcome).toBe("disabled");
    expect(result.searchedDirectories).toEqual([]);
    expect(EnterpriseEdition.isLoaded()).toBe(false);
    expect(getFixtureCalls()).toEqual([]);
  });

  test("ONEUPTIME_EDITION=community skips even a broken ee/", async () => {
    const { EnterpriseLoader, EnterpriseEdition } = await loadFresh();

    await expect(
      EnterpriseLoader.load(
        baseOptions({
          edition: "community",
          enterpriseDirectory: fixture("BrokenRequire"),
        }),
      ),
    ).resolves.toMatchObject({ outcome: "disabled" });
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });

  test("a set ONEUPTIME_EE_DIR that holds no module warns and runs the Community Edition", async () => {
    const { EnterpriseLoader, EnterpriseEdition, logs } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        enterpriseDirectory: path.join(FIXTURES_DIR, "DoesNotExist"),
      }),
    );

    expect(result.outcome).toBe("not-found");
    expect(EnterpriseEdition.isLoaded()).toBe(false);
    expect(loggedText(logs.warn)).toContain("ONEUPTIME_EE_DIR is set");
  });
});

describe("EnterpriseLoader.load: fail fast on a broken build", () => {
  test("ONEUPTIME_EDITION=enterprise with no ee/ refuses to start", async () => {
    const { EnterpriseLoader, EnterpriseEdition, loaderModule } =
      await loadFresh();

    const error: unknown = await EnterpriseLoader.load(
      baseOptions({
        edition: "enterprise",
        enterpriseDirectory: path.join(FIXTURES_DIR, "DoesNotExist"),
      }),
    ).catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(loaderModule.EnterpriseLoaderError);
    expect((error as Error).message).toContain("ONEUPTIME_EDITION=enterprise");
    expect((error as Error).message).toContain(
      path.join(FIXTURES_DIR, "DoesNotExist", "Server", "Index.ts"),
    );
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });

  test("an unrecognised ONEUPTIME_EDITION refuses to start", async () => {
    const { EnterpriseLoader, loaderModule } = await loadFresh();

    await expect(
      EnterpriseLoader.load(baseOptions({ edition: null })),
    ).rejects.toBeInstanceOf(loaderModule.EnterpriseLoaderError);
    await expect(
      EnterpriseLoader.load(baseOptions({ edition: null })),
    ).rejects.toThrow(
      "ONEUPTIME_EDITION must be one of auto, community, enterprise",
    );
  });

  test("an ee/ whose require() fails refuses to start and says how to fix it", async () => {
    const { EnterpriseLoader, EnterpriseEdition, loaderModule } =
      await loadFresh();

    const error: unknown = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("BrokenRequire") }),
    ).catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(loaderModule.EnterpriseLoaderError);
    expect((error as Error).message).toContain(
      "missing-enterprise-fixture-dependency",
    );
    expect((error as Error).message).toContain("npm ci --ignore-scripts");
    expect((error as Error).message).toContain(fixture("BrokenRequire"));
    expect((error as Error).message).toContain("ONEUPTIME_EDITION=community");
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });

  test("an ee/ that does not match the contract refuses to start and lists why", async () => {
    const { EnterpriseLoader, EnterpriseEdition, loaderModule } =
      await loadFresh();

    const error: unknown = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("BadShape") }),
    ).catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(loaderModule.EnterpriseLoaderError);
    expect((error as Error).message).toContain(
      '"name" must be "oneuptime-enterprise"',
    );
    expect((error as Error).message).toContain('"licensing" must be an object');
    expect((error as Error).message).toContain("different versions");
    expect(EnterpriseEdition.isLoaded()).toBe(false);
  });

  test("a require() failure is fatal even under ONEUPTIME_EDITION=auto", async () => {
    const { EnterpriseLoader } = await loadFresh();

    await expect(
      EnterpriseLoader.load(
        baseOptions({
          edition: "auto",
          enterpriseDirectory: fixture("BrokenRequire"),
        }),
      ),
    ).rejects.toThrow("could not be loaded");
  });
});

describe("EnterpriseLoader.load: runtime problems only log", () => {
  test("init() throwing is logged and the boot continues with ee loaded", async () => {
    const { EnterpriseLoader, EnterpriseEdition, logs } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("InitThrows") }),
    );

    expect(result.outcome).toBe("loaded");
    expect(result.initCompleted).toBe(false);
    expect(result.initError).toContain("database unreachable");
    expect(EnterpriseEdition.isLoaded()).toBe(true);
    expect(loggedText(logs.error)).toContain("failed to initialise");
    // The license is still read after a failed init.
    expect(getFixtureCalls()).toContain("InitThrows:getSnapshot");
  });

  test("init() hanging is bounded by the timeout", async () => {
    const { EnterpriseLoader, EnterpriseEdition, logs } = await loadFresh();
    const startedAt: number = Date.now();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        enterpriseDirectory: fixture("InitHangs"),
        initTimeoutInMs: 50,
      }),
    );

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.outcome).toBe("loaded");
    expect(result.initCompleted).toBe(false);
    expect(result.initError).toContain("did not finish within 50 ms");
    expect(EnterpriseEdition.isLoaded()).toBe(true);
    expect(loggedText(logs.error)).toContain("did not finish within 50 ms");
  });

  test("a failing first license load is logged and does not stop the boot", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("LicenseLoadFails") }),
    );

    expect(result.outcome).toBe("loaded");
    expect(result.initCompleted).toBe(true);
    expect(result.licenseSnapshot).toBeNull();
    expect(loggedText(logs.error)).toContain("license could not be read");
    expect(loggedText(logs.error)).toContain("license load failed");
  });

  test("a hanging first license load is bounded by its own timeout", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();
    const startedAt: number = Date.now();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        enterpriseDirectory: fixture("LicenseLoadHangs"),
        licenseLoadTimeoutInMs: 50,
      }),
    );

    expect(Date.now() - startedAt).toBeLessThan(5000);
    expect(result.outcome).toBe("loaded");
    expect(result.licenseSnapshot).toBeNull();
    expect(loggedText(logs.error)).toContain("longer than 50 ms");
  });
});

describe("EnterpriseLoader boot guards", () => {
  test("billing on without ee is fatal (the hosted deployment must run the Enterprise image)", async () => {
    const { EnterpriseLoader, loaderModule } = await loadFresh();

    const error: unknown = await EnterpriseLoader.load(
      baseOptions({
        edition: "community",
        isBillingEnabled: true,
      }),
    ).catch((err: unknown) => {
      return err;
    });

    expect(error).toBeInstanceOf(loaderModule.EnterpriseLoaderError);
    expect((error as Error).message).toContain("BILLING_ENABLED=true");
    expect((error as Error).message).toContain(
      "ALLOW_BILLING_WITHOUT_ENTERPRISE=true",
    );
  });

  test("billing on without ee is fatal when ee/ is simply absent too", async () => {
    const { EnterpriseLoader } = await loadFresh();

    await expect(
      EnterpriseLoader.load(
        baseOptions({
          enterpriseDirectory: path.join(FIXTURES_DIR, "DoesNotExist"),
          isBillingEnabled: true,
        }),
      ),
    ).rejects.toThrow("BILLING_ENABLED=true");
  });

  test("ALLOW_BILLING_WITHOUT_ENTERPRISE=true downgrades it to a logged error", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    const result: EnterpriseLoadResult = await EnterpriseLoader.load(
      baseOptions({
        edition: "community",
        isBillingEnabled: true,
        allowBillingWithoutEnterprise: true,
      }),
    );

    expect(result.outcome).toBe("disabled");
    expect(loggedText(logs.error)).toContain("BILLING_ENABLED=true");
    expect(loggedText(logs.error)).toContain(
      "Continuing because ALLOW_BILLING_WITHOUT_ENTERPRISE=true",
    );
  });

  test("billing on with ee loaded boots normally", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    await expect(
      EnterpriseLoader.load(
        baseOptions({
          enterpriseDirectory: fixture("DefaultExport"),
          isBillingEnabled: true,
        }),
      ),
    ).resolves.toMatchObject({ outcome: "loaded" });
    expect(logs.error).not.toHaveBeenCalled();
  });

  test("IS_ENTERPRISE_EDITION=true on the Community Edition warns loudly", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    await EnterpriseLoader.load(
      baseOptions({
        edition: "community",
        isEnterpriseEditionRequested: true,
      }),
    );

    expect(loggedText(logs.warn)).toContain("IS_ENTERPRISE_EDITION=true");
    expect(loggedText(logs.warn)).toContain("Enterprise Edition image");
  });

  test("IS_ENTERPRISE_EDITION=true with ee loaded does not warn", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    await EnterpriseLoader.load(
      baseOptions({
        enterpriseDirectory: fixture("DefaultExport"),
        isEnterpriseEditionRequested: true,
      }),
    );

    expect(logs.warn).not.toHaveBeenCalled();
  });

  test("enforceBootGuards is a pure decision over its four inputs", async () => {
    const { EnterpriseLoader, logs } = await loadFresh();

    for (const isLoaded of [false, true]) {
      for (const isBillingEnabled of [false, true]) {
        for (const allowBillingWithoutEnterprise of [false, true]) {
          for (const isEnterpriseEditionRequested of [false, true]) {
            logs.warn.mockClear();
            logs.error.mockClear();

            const shouldThrow: boolean =
              isBillingEnabled && !isLoaded && !allowBillingWithoutEnterprise;
            const run: () => void = (): void => {
              EnterpriseLoader.enforceBootGuards({
                isLoaded,
                isBillingEnabled,
                allowBillingWithoutEnterprise,
                isEnterpriseEditionRequested,
              });
            };

            if (shouldThrow) {
              expect(run).toThrow("BILLING_ENABLED=true");
              continue;
            }

            expect(run).not.toThrow();
            expect(logs.error.mock.calls.length > 0).toBe(
              isBillingEnabled && !isLoaded,
            );
            expect(logs.warn.mock.calls.length > 0).toBe(
              isEnterpriseEditionRequested && !isLoaded,
            );
          }
        }
      }
    }
  });

  test("a missing ee/ under ONEUPTIME_EDITION=enterprise is reported before the billing guard", async () => {
    const { EnterpriseLoader } = await loadFresh();

    await expect(
      EnterpriseLoader.load(
        baseOptions({
          edition: "enterprise",
          enterpriseDirectory: path.join(FIXTURES_DIR, "DoesNotExist"),
          isBillingEnabled: true,
        }),
      ),
    ).rejects.toThrow("ONEUPTIME_EDITION=enterprise");
  });
});

describe("EnterpriseLoader worker jobs", () => {
  test("the five ee-owned cron names are exactly the ones ee used to register from core", async () => {
    const { loaderModule } = await loadFresh();

    expect([...loaderModule.ENTERPRISE_OWNED_JOB_NAMES]).toEqual(
      ENTERPRISE_JOB_NAMES,
    );
  });

  test("the Community Edition gets a no-op handler for every ee-owned cron", async () => {
    const { EnterpriseLoader, JobDictionary } = await loadFresh();

    for (const jobName of ENTERPRISE_JOB_NAMES) {
      expect(JobDictionary.has(jobName)).toBe(false);
    }

    const registered: Array<string> =
      await EnterpriseLoader.registerWorkerJobs();

    expect(registered).toEqual(ENTERPRISE_JOB_NAMES);

    for (const jobName of ENTERPRISE_JOB_NAMES) {
      expect(JobDictionary.has(jobName)).toBe(true);
      await expect(
        JobDictionary.getJobFunction(jobName)(),
      ).resolves.toBeUndefined();
    }
  });

  test("the placeholders log at debug level only", async () => {
    const { EnterpriseLoader, JobDictionary, logs } = await loadFresh();

    await EnterpriseLoader.registerWorkerJobs();
    await JobDictionary.getJobFunction("InstanceHealth:EvaluateRedisHealth")();

    expect(loggedText(logs.debug)).toContain(
      "InstanceHealth:EvaluateRedisHealth: skipped",
    );
    expect(logs.error).not.toHaveBeenCalled();
    expect(logs.warn).not.toHaveBeenCalled();
  });

  test("ee registers its jobs first; placeholders fill only the names it left out", async () => {
    const { EnterpriseLoader, JobDictionary } = await loadFresh();

    await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("DefaultExport") }),
    );

    const registered: Array<string> =
      await EnterpriseLoader.registerWorkerJobs();

    expect(registered).toEqual([
      "EnterpriseLicense:SendLicenseNotificationEmails",
      "EnterpriseLicense:ReconcileInstanceUsage",
      "InstanceHealth:EvaluateRedisHealth",
    ]);
    expect(getFixtureCalls()).toContain("DefaultExport:registerWorkerJobs");

    // ee's own handlers were not replaced by placeholders.
    await JobDictionary.getJobFunction("EnterpriseLicense:ReportUserCount")();
    await JobDictionary.getJobFunction(
      "InstanceHealth:EvaluatePostgresHealth",
    )();

    expect(getFixtureCalls()).toContain(
      "DefaultExport:ran:EnterpriseLicense:ReportUserCount",
    );
    expect(getFixtureCalls()).toContain(
      "DefaultExport:ran:InstanceHealth:EvaluatePostgresHealth",
    );
  });

  test("ee failing to register its jobs is logged, and every name still gets a placeholder", async () => {
    const { EnterpriseLoader, JobDictionary, logs } = await loadFresh();

    await EnterpriseLoader.load(
      baseOptions({ enterpriseDirectory: fixture("WorkerJobsThrow") }),
    );

    const registered: Array<string> =
      await EnterpriseLoader.registerWorkerJobs();

    expect(registered).toEqual(ENTERPRISE_JOB_NAMES);
    expect(loggedText(logs.error)).toContain(
      "failed to register its worker jobs",
    );

    for (const jobName of ENTERPRISE_JOB_NAMES) {
      expect(JobDictionary.has(jobName)).toBe(true);
    }
  });

  test("placeholders never overwrite a handler registered later by core or ee", async () => {
    const { EnterpriseLoader, JobDictionary } = await loadFresh();
    const handler: () => Promise<void> = async (): Promise<void> => {
      return undefined;
    };

    JobDictionary.setJobFunction("EnterpriseLicense:ReportUserCount", handler);

    const registered: Array<string> =
      EnterpriseLoader.registerMissingJobPlaceholders();

    expect(registered).not.toContain("EnterpriseLicense:ReportUserCount");
    expect(
      JobDictionary.getJobFunction("EnterpriseLicense:ReportUserCount"),
    ).toBe(handler);
    expect(EnterpriseLoader.registerMissingJobPlaceholders()).toEqual([]);
  });
});
