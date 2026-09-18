import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { ENTERPRISE_OWNED_JOB_NAMES } from "App/Utils/EnterpriseLoader";
import EnterpriseModule from "../../../Server/Index";
import LicenseServerArea, {
  LICENSE_SERVER_JOB_NAMES,
} from "../../../Server/LicenseServer/Index";
import LicenseServerRateLimit, {
  LicenseServerRateLimitBucket,
} from "../../../Server/LicenseServer/LicenseServerRateLimit";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
} from "../../../Server/LicenseServer/LicenseSigner";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import {
  collectLoggedText,
  generateEd25519KeyPair,
  TestKeyPair,
  toPrivatePem,
  toTrustedKey,
} from "./LicenseServerTestKit";

/*
 * The license server exists only on OneUptime Cloud (billing enabled). This
 * suite pins the area's contract with the assembled ee module:
 *
 *   billing off   no routers, no cron jobs, the signing key is never parsed
 *                 (and is removed from the environment if it leaked there);
 *   billing on    the license API with its CRUD, the EnterpriseLicenseInstance
 *                 CRUD and the offline-token route - routes only, rate limits
 *                 on the anonymous ones - both license crons, and a signing
 *                 mode chosen at init.
 *
 * Billing is read when each hook is CALLED, so one loaded module is flipped
 * between the two within a test. RunCron is captured, so job registration
 * never reaches Redis.
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

const mockRegisteredJobNames: Array<string> = [];

jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn((jobName: string): void => {
      mockRegisteredJobNames.push(jobName);
    }),
  };
});

interface RouteSummary {
  method: string;
  path: string;
  handlers: Array<unknown>;
}

type LayerRecord = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

const routesOf: (router: ExpressRouter) => Array<RouteSummary> = (
  router: ExpressRouter,
): Array<RouteSummary> => {
  const stack: Array<LayerRecord> = (
    router as unknown as { stack: Array<LayerRecord> }
  ).stack;

  return stack
    .filter((layer: LayerRecord): boolean => {
      return Boolean(layer.route);
    })
    .map((layer: LayerRecord): RouteSummary => {
      const route: NonNullable<LayerRecord["route"]> =
        layer.route as NonNullable<LayerRecord["route"]>;

      return {
        method: Object.keys(route.methods)[0]?.toUpperCase() || "",
        path: route.path,
        handlers: route.stack.map((entry: { handle: unknown }): unknown => {
          return entry.handle;
        }),
      };
    });
};

const findRoute: (
  routers: Array<ExpressRouter>,
  method: string,
  path: string,
) => RouteSummary | undefined = (
  routers: Array<ExpressRouter>,
  method: string,
  path: string,
): RouteSummary | undefined => {
  for (const router of routers) {
    const match: RouteSummary | undefined = routesOf(router).find(
      (route: RouteSummary): boolean => {
        return route.method === method && route.path === path;
      },
    );

    if (match) {
      return match;
    }
  }

  return undefined;
};

const getApiRouters: () => Array<ExpressRouter> = (): Array<ExpressRouter> => {
  return LicenseServerArea.getApiRouters?.() || [];
};

const SIGNING_KEY: TestKeyPair = generateEd25519KeyPair();

let infoSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  setTestBillingEnabled(false);
  delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  LicenseSigner.resetForTests();
  infoSpy = jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  setTestBillingEnabled(false);
  delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
  setTrustedLicenseKeysForTests(null);
  LicenseSigner.resetForTests();
  jest.restoreAllMocks();
});

describe("LicenseServer area", () => {
  test("is the area named LicenseServer, with init, api routers and worker jobs", () => {
    expect(LicenseServerArea.name).toBe("LicenseServer");
    expect(typeof LicenseServerArea.init).toBe("function");
    expect(typeof LicenseServerArea.getApiRouters).toBe("function");
    expect(typeof LicenseServerArea.registerWorkerJobs).toBe("function");
    expect(LicenseServerArea.getIdentityRouters).toBeUndefined();
  });

  describe("self-hosted (billing disabled)", () => {
    test("contributes no routers - self-hosted installs no longer serve the license endpoints", () => {
      expect(getApiRouters()).toEqual([]);
    });

    test("the assembled ee module mounts no license-server route", () => {
      expect(
        findRoute(
          EnterpriseModule.getApiRouters(),
          "POST",
          "/enterprise-license/validate",
        ),
      ).toBeUndefined();
      expect(
        findRoute(
          EnterpriseModule.getApiRouters(),
          "POST",
          "/enterprise-license-instance/get-list",
        ),
      ).toBeUndefined();
    });

    test("registers no cron job", async () => {
      await LicenseServerArea.registerWorkerJobs?.();

      expect(mockRegisteredJobNames).toEqual([]);
    });

    test("init never parses a signing key, and drops one that leaked into the environment", async () => {
      process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] =
        toPrivatePem(SIGNING_KEY);

      await LicenseServerArea.init?.();

      expect(process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV]).toBe(
        undefined,
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain("ignored");
      expect(infoSpy).not.toHaveBeenCalled();
      expect(collectLoggedText([warnSpy as never])).not.toContain(
        "PRIVATE KEY",
      );
    });

    test("init with no key present logs nothing", async () => {
      await LicenseServerArea.init?.();

      expect(warnSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });

  describe("OneUptime Cloud (billing enabled)", () => {
    beforeEach(() => {
      setTestBillingEnabled(true);
    });

    test("contributes three routers: the license API, the instance CRUD, the offline-token route", () => {
      const routers: Array<ExpressRouter> = getApiRouters();

      expect(routers).toHaveLength(3);

      const [licenseApi, instanceCrud, offlineToken] = routers as [
        ExpressRouter,
        ExpressRouter,
        ExpressRouter,
      ];

      expect(
        routesOf(licenseApi).map((route: RouteSummary): string => {
          return `${route.method} ${route.path}`;
        }),
      ).toEqual(
        expect.arrayContaining([
          "POST /enterprise-license",
          "POST /enterprise-license/get-list",
          "POST /enterprise-license/:id/update-item",
          "GET /enterprise-license/:enterpriseLicenseId/active-usage",
          "POST /enterprise-license/validate",
          "POST /enterprise-license/report-user-count",
        ]),
      );
      expect(
        routesOf(instanceCrud).map((route: RouteSummary): string => {
          return `${route.method} ${route.path}`;
        }),
      ).toEqual(
        expect.arrayContaining([
          "POST /enterprise-license-instance/get-list",
          "DELETE /enterprise-license-instance/:id",
        ]),
      );
      expect(
        routesOf(offlineToken).map((route: RouteSummary): string => {
          return `${route.method} ${route.path}`;
        }),
      ).toEqual([
        "POST /enterprise-license/:enterpriseLicenseId/offline-token",
      ]);
    });

    test("every router holds routes only - no router.use() layer that could shadow core routes", () => {
      for (const router of getApiRouters()) {
        expect(
          EnterpriseServerModuleShape.findLayersWithoutRoute(router),
        ).toEqual([]);
      }
    });

    test("rate-limits /validate before anything else runs, then resolves the optional user", () => {
      const route: RouteSummary | undefined = findRoute(
        getApiRouters(),
        "POST",
        "/enterprise-license/validate",
      );

      expect(route?.handlers).toHaveLength(3);
      expect(route?.handlers[0]).toBe(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.Validate,
        ),
      );
      expect(route?.handlers[1]).toBe(UserMiddleware.getUserMiddleware);
    });

    test("rate-limits /report-user-count and keeps it anonymous (instances report before anyone signs in)", () => {
      const route: RouteSummary | undefined = findRoute(
        getApiRouters(),
        "POST",
        "/enterprise-license/report-user-count",
      );

      expect(route?.handlers).toHaveLength(2);
      expect(route?.handlers[0]).toBe(
        LicenseServerRateLimit.getMiddleware(
          LicenseServerRateLimitBucket.ReportUserCount,
        ),
      );
    });

    test("keeps active usage and offline tokens behind the master admin check", () => {
      const routers: Array<ExpressRouter> = getApiRouters();

      expect(
        findRoute(
          routers,
          "GET",
          "/enterprise-license/:enterpriseLicenseId/active-usage",
        )?.handlers[0],
      ).toBe(MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware);
      expect(
        findRoute(
          routers,
          "POST",
          "/enterprise-license/:enterpriseLicenseId/offline-token",
        )?.handlers[0],
      ).toBe(MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware);
    });

    test("the assembled ee module mounts the license server routes", () => {
      const routers: Array<ExpressRouter> = EnterpriseModule.getApiRouters();

      expect(
        findRoute(routers, "POST", "/enterprise-license/validate"),
      ).toBeDefined();
      expect(
        findRoute(routers, "POST", "/enterprise-license/report-user-count"),
      ).toBeDefined();
      expect(
        findRoute(routers, "POST", "/enterprise-license-instance/get-list"),
      ).toBeDefined();
      expect(
        findRoute(
          routers,
          "POST",
          "/enterprise-license/:enterpriseLicenseId/offline-token",
        ),
      ).toBeDefined();
    });

    test("registers both license crons, whose names the loader reserves placeholders for", async () => {
      await LicenseServerArea.registerWorkerJobs?.();

      expect([...mockRegisteredJobNames].sort()).toEqual(
        [...LICENSE_SERVER_JOB_NAMES].sort(),
      );
      expect([...LICENSE_SERVER_JOB_NAMES].sort()).toEqual([
        "EnterpriseLicense:ReconcileInstanceUsage",
        "EnterpriseLicense:SendLicenseNotificationEmails",
      ]);

      for (const jobName of LICENSE_SERVER_JOB_NAMES) {
        expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(jobName);
      }
    });

    test("init picks the signing mode: legacy HS256 when no key is set", async () => {
      await LicenseServerArea.init?.();

      expect(LicenseSigner.getState()).toMatchObject({
        mode: "legacy-hs256",
        problem: "not-set",
      });
      expect(infoSpy).toHaveBeenCalledTimes(1);
    });

    test("init picks EdDSA for a key this build trusts, and removes it from the environment", async () => {
      process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] =
        toPrivatePem(SIGNING_KEY);
      setTrustedLicenseKeysForTests([toTrustedKey(SIGNING_KEY)]);

      await LicenseServerArea.init?.();

      expect(LicenseSigner.getState().mode).toBe("eddsa");
      expect(process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV]).toBe(
        undefined,
      );
    });

    test("init keeps legacy HS256 for a key this build does not trust", async () => {
      process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] =
        toPrivatePem(SIGNING_KEY);

      await LicenseServerArea.init?.();

      expect(LicenseSigner.getState()).toMatchObject({
        mode: "legacy-hs256",
        problem: "not-trusted",
      });
    });
  });

  test("reads billing when called: the same module answers differently after a flip", () => {
    setTestBillingEnabled(false);
    expect(getApiRouters()).toHaveLength(0);

    setTestBillingEnabled(true);
    expect(getApiRouters()).toHaveLength(3);

    setTestBillingEnabled(false);
    expect(getApiRouters()).toHaveLength(0);
  });
});
