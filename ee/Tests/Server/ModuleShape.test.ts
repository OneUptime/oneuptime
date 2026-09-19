import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../Server/Index";
import EnterpriseArea from "../../Server/Types/EnterpriseArea";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import {
  ENTERPRISE_SERVER_MODULE_NAME,
  EnterpriseServerModuleShape,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import { EnterpriseLicenseSnapshot } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import logger from "Common/Server/Utils/Logger";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import EnterpriseLoader, {
  EnterpriseLoadResult,
} from "App/Utils/EnterpriseLoader";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The contract ee/Server/Index.ts must keep with core, checked against the
 * real assembled module - so it keeps holding as each area fills in.
 *
 * Billing is pinned (CI's config.env sets BILLING_ENABLED=true, and the
 * license-server area contributes only with billing on). RunCron is captured,
 * so area cron modules never reach Redis from this test.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const EE_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_ROOT: string = path.resolve(EE_DIR, "..");

const readJson: (filePath: string) => Record<string, unknown> = (
  filePath: string,
): Record<string, unknown> => {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
    string,
    unknown
  >;
};

// The major version a version or range starts with: "^28.0.8" -> 28.
const LEADING_MAJOR: RegExp = /^[\s^~>=v]*(\d+)/;

const majorOf: (versionOrRange: string) => number | null = (
  versionOrRange: string,
): number | null => {
  const match: RegExpExecArray | null = LEADING_MAJOR.exec(versionOrRange);

  return match && match[1] ? Number(match[1]) : null;
};

const allRouters: () => Array<{
  source: string;
  router: ExpressRouter;
}> = (): Array<{ source: string; router: ExpressRouter }> => {
  const routers: Array<{ source: string; router: ExpressRouter }> = [];

  EnterpriseModule.getIdentityRouters().forEach(
    (router: ExpressRouter, index: number) => {
      routers.push({ source: `identity router ${index}`, router });
    },
  );
  EnterpriseModule.getApiRouters().forEach(
    (router: ExpressRouter, index: number) => {
      routers.push({ source: `api router ${index}`, router });
    },
  );

  const adminHealthRouter: ExpressRouter | null =
    EnterpriseModule.getAdminHealthRouter();

  if (adminHealthRouter) {
    routers.push({ source: "admin health router", router: adminHealthRouter });
  }

  return routers;
};

afterEach(() => {
  EnterpriseEdition.resetForTests();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("ee/Server/Index.ts default export", () => {
  test("matches the EnterpriseServerModule contract", () => {
    expect(EnterpriseServerModuleShape.findProblems(EnterpriseModule)).toEqual(
      [],
    );
  });

  test("is named oneuptime-enterprise", () => {
    expect(EnterpriseModule.name).toBe(ENTERPRISE_SERVER_MODULE_NAME);
    expect(EnterpriseModule.name).toBe("oneuptime-enterprise");
  });

  test("carries the release version from ee/package.json, which matches VERSION", () => {
    const version: string = fs
      .readFileSync(path.join(REPOSITORY_ROOT, "VERSION"), "utf8")
      .trim();

    expect(EnterpriseModule.version).toBe(
      readJson(path.join(EE_DIR, "package.json"))["version"],
    );
    expect(EnterpriseModule.version).toBe(version);
  });

  test.each([false, true])(
    "with billing=%s, no router holds a layer that is not a route",
    (billing: boolean) => {
      setTestBillingEnabled(billing);

      for (const { source, router } of allRouters()) {
        expect({
          source,
          problems: EnterpriseServerModuleShape.findLayersWithoutRoute(router),
        }).toEqual({ source, problems: [] });
      }
    },
  );

  test.each([false, true])(
    "with billing=%s, init and registerWorkerJobs can be called",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);

      await expect(EnterpriseModule.init()).resolves.toBeUndefined();
      await expect(
        EnterpriseModule.registerWorkerJobs(),
      ).resolves.toBeUndefined();
    },
  );

  test("the licensing provider answers every call", async () => {
    const statuses: Array<string> = [
      "missing",
      "valid",
      "grace",
      "expired",
      "invalid",
    ];
    const snapshot: EnterpriseLicenseSnapshot =
      await EnterpriseModule.licensing.getSnapshot();
    const cached: EnterpriseLicenseSnapshot | null =
      EnterpriseModule.licensing.getCachedSnapshot();

    expect(statuses).toContain(snapshot.status);

    if (cached) {
      expect(statuses).toContain(cached.status);
    }

    await expect(EnterpriseModule.licensing.refresh()).resolves.toBeUndefined();
    expect(EnterpriseModule.licensing.invalidate()).toBeUndefined();
    await expect(
      EnterpriseModule.licensing.getSeatUsage(),
    ).resolves.not.toBeUndefined();
    await expect(
      EnterpriseModule.licensing.assertSeatAvailableForNewUser(),
    ).resolves.toBeUndefined();
  });

  test("the audit log recorder, when there is one, implements all four methods", () => {
    const recorder: ReturnType<typeof EnterpriseModule.getAuditLogRecorder> =
      EnterpriseModule.getAuditLogRecorder();

    if (!recorder) {
      return;
    }

    for (const method of [
      "recordCreate",
      "recordUpdate",
      "recordDelete",
      "invalidateProjectSettings",
    ]) {
      expect(
        typeof (recorder as unknown as Record<string, unknown>)[method],
      ).toBe("function");
    }
  });
});

describe("ee/Server/Index.ts assembly", () => {
  test("is assembled from the seven areas, license first", () => {
    expect(
      ENTERPRISE_AREAS.map((area: EnterpriseArea) => {
        return area.name;
      }),
    ).toEqual([
      "License",
      "Identity",
      "TeamCompliance",
      "AuditLog",
      "LicenseServer",
      "AdminHealth",
      "Workers",
    ]);
  });

  test("every area has its own directory with an Index.ts", () => {
    for (const area of ENTERPRISE_AREAS) {
      expect(
        fs.existsSync(path.join(EE_DIR, "Server", area.name, "Index.ts")),
      ).toBe(true);
    }
  });

  test("one area failing init does not stop the others, and the failure is reported", async () => {
    const identityArea: EnterpriseArea = ENTERPRISE_AREAS[1] as EnterpriseArea;
    const workersArea: EnterpriseArea = ENTERPRISE_AREAS[6] as EnterpriseArea;
    const originalIdentityInit: EnterpriseArea["init"] = identityArea.init;
    const originalWorkersInit: EnterpriseArea["init"] = workersArea.init;
    let workersInitialised: boolean = false;

    try {
      identityArea.init = async (): Promise<void> => {
        throw new Error("identity exploded");
      };
      workersArea.init = async (): Promise<void> => {
        workersInitialised = true;
      };

      await expect(EnterpriseModule.init()).rejects.toThrow(
        "Identity: identity exploded",
      );
      expect(workersInitialised).toBe(true);
    } finally {
      identityArea.init = originalIdentityInit;
      workersArea.init = originalWorkersInit;
    }
  });
});

describe("ee/package.json", () => {
  const packageJson: Record<string, unknown> = readJson(
    path.join(EE_DIR, "package.json"),
  );

  test('has no "type" field (the repo root is type:module, which would make ee ESM)', () => {
    expect(packageJson).not.toHaveProperty("type");
  });

  test("is private and points at its own license", () => {
    expect(packageJson["private"]).toBe(true);
    expect(packageJson["license"]).toBe("SEE LICENSE IN LICENSE");
    expect(fs.existsSync(path.join(EE_DIR, "LICENSE"))).toBe(true);
  });

  test("links Common and App from packages/", () => {
    const dependencies: Record<string, string> = packageJson[
      "dependencies"
    ] as Record<string, string>;

    expect(dependencies["Common"]).toBe("file:../packages/Common");
    expect(dependencies["App"]).toBe("file:../packages/App");
  });

  /*
   * ee's ui jest project runs on packages/Common's test environment, setup
   * file and transforms (jest.config.js derives them from Common's jest
   * config), so ee's jest and ts-jest must stay on the major installed in
   * packages/Common. Scripts/Dev/update-node-modules.sh bumps Common, App and
   * ee together (ncu -u), so this follows Common rather than pinning a
   * literal version that the next bump would break.
   */
  test.each(["jest", "ts-jest"])(
    "declares and installs the %s major packages/Common has installed",
    (name: string) => {
      const devDependencies: Record<string, string> = packageJson[
        "devDependencies"
      ] as Record<string, string>;
      const commonManifest: string = path.join(
        REPOSITORY_ROOT,
        "packages",
        "Common",
        "node_modules",
        name,
        "package.json",
      );
      const eeManifest: string = path.join(
        EE_DIR,
        "node_modules",
        name,
        "package.json",
      );

      // test.ee.yaml installs Common before ee; without it there is no answer.
      expect({
        commonManifest,
        installed: fs.existsSync(commonManifest),
      }).toEqual({ commonManifest, installed: true });
      expect({ eeManifest, installed: fs.existsSync(eeManifest) }).toEqual({
        eeManifest,
        installed: true,
      });

      const commonMajor: number | null = majorOf(
        String(readJson(commonManifest)["version"]),
      );

      expect(commonMajor).not.toBeNull();
      expect({ name, declared: majorOf(devDependencies[name] || "") }).toEqual({
        name,
        declared: commonMajor,
      });
      expect({
        name,
        installed: majorOf(String(readJson(eeManifest)["version"])),
      }).toEqual({ name, installed: commonMajor });
    },
  );

  test.each([
    ["28.1.3", 28],
    ["^28.0.8", 28],
    ["~29.1.0", 29],
    [">=30.0.0 <31", 30],
    ["v28.1.3", 28],
    ["latest", null],
    ["", null],
  ])("reads the major of %s as %s", (range: string, major: number | null) => {
    expect(majorOf(range)).toBe(major);
  });
});

describe("the App loader loads this ee/ directory", () => {
  test("registers this very module on the EnterpriseEdition instance ee sees", async () => {
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    const result: EnterpriseLoadResult = await EnterpriseLoader.load({
      edition: "enterprise",
      enterpriseDirectory: EE_DIR,
      isBillingEnabled: false,
      allowBillingWithoutEnterprise: false,
      isEnterpriseEditionRequested: false,
      initTimeoutInMs: 10000,
      licenseLoadTimeoutInMs: 10000,
    });

    expect(result.outcome).toBe("loaded");
    expect(result.entryFile).toBe(path.join(EE_DIR, "Server", "Index.ts"));
    expect(result.initCompleted).toBe(true);
    expect(EnterpriseEdition.isLoaded()).toBe(true);
    expect(EnterpriseEdition.getModule()).toBe(EnterpriseModule);
  });
});
