import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The CloudMarketplace area of the enterprise module: OneUptime Cloud sold
 * on AWS Marketplace, Microsoft Marketplace, Google Cloud Marketplace and
 * Vercel Marketplace. It contributes only with billing on (the hosted
 * oneuptime.com): the marketplaces' routes, sign-in from Vercel, three cron
 * jobs and the project billing hooks. With billing off it contributes
 * nothing at all, so a self-hosted installation serves none of these paths.
 *
 * The route paths are configured in each marketplace's seller portal and in
 * Vercel's Integration Console, so they are pinned here exactly as core
 * served them before they moved to ee/.
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

import CloudMarketplaceArea, {
  CLOUD_MARKETPLACE_JOB_NAMES,
  getCloudMarketplaceApiRouters,
  getCloudMarketplaceIdentityRouters,
  getProjectBillingHooks,
  registerCloudMarketplaceWorkerJobs,
} from "../../../Server/CloudMarketplace/Index";
import CloudMarketplaceProjectBillingHooks from "../../../Server/CloudMarketplace/ProjectBillingHooks";
import VercelSignInAPI from "../../../Server/CloudMarketplace/API/VercelSignIn";
import EnterpriseModule, { ENTERPRISE_AREAS } from "../../../Server/Index";
import JobDictionary from "App/FeatureSet/Workers/Utils/JobDictionary";
import { ENTERPRISE_OWNED_JOB_NAMES } from "App/Utils/EnterpriseLoader";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import {
  EVERY_DAY,
  EVERY_FIVE_MINUTE,
  EVERY_HOUR,
} from "Common/Utils/CronTime";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

type Route = [method: string, path: string];

// Every (method, path) a router serves, in registration order.
const routesOf: (router: ExpressRouter) => Array<Route> = (
  router: ExpressRouter,
): Array<Route> => {
  const stack: Array<{
    route?: { path: string; methods: Record<string, boolean> };
  }> = (
    router as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    }
  ).stack;

  return stack.flatMap(
    (layer: {
      route?: { path: string; methods: Record<string, boolean> };
    }): Array<Route> => {
      if (!layer.route) {
        return [];
      }

      return Object.keys(layer.route.methods).map((method: string): Route => {
        return [method.toUpperCase(), layer.route!.path];
      });
    },
  );
};

// The cloud marketplaces' routes, under /api (MarketplaceAPI).
const MARKETPLACE_ROUTES: Array<Route> = [
  ["POST", "/marketplace/aws/register"],
  ["GET", "/marketplace/aws/register"],
  ["POST", "/marketplace/aws/events"],
  ["GET", "/marketplace/azure/landing"],
  ["POST", "/marketplace/azure/webhook"],
  ["POST", "/marketplace/google-cloud/signup"],
  ["GET", "/marketplace/google-cloud/signup"],
  ["POST", "/marketplace/google-cloud/events"],
  ["POST", "/marketplace/purchase/details"],
  ["POST", "/marketplace/purchase/complete"],
  ["POST", "/marketplace/purchase/dismiss"],
  ["GET", "/marketplace/usage"],
];

// Vercel Marketplace's provider API and webhook, under /api (VercelMarketplaceProviderAPI).
const INSTALLATION: string =
  "/marketplace/vercel/v1/installations/:installationId";
const RESOURCE: string = `${INSTALLATION}/resources/:resourceId`;

const VERCEL_PROVIDER_ROUTES: Array<Route> = [
  ["PUT", INSTALLATION],
  ["GET", INSTALLATION],
  ["PATCH", INSTALLATION],
  ["DELETE", INSTALLATION],
  ["GET", `${INSTALLATION}/plans`],
  ["GET", "/marketplace/vercel/v1/products/:productSlug/plans"],
  ["POST", `${INSTALLATION}/resources`],
  ["GET", RESOURCE],
  ["PATCH", RESOURCE],
  ["DELETE", RESOURCE],
  ["GET", `${RESOURCE}/plans`],
  ["POST", `${RESOURCE}/secrets/rotate`],
  ["POST", "/marketplace/vercel/webhook"],
];

// Sign-in from Vercel, under /api/identity and / (nginx: /identity/vercel/sso).
const VERCEL_SIGN_IN_ROUTES: Array<Route> = [["GET", "/vercel/sso"]];

let addJobSpy: { mock: { calls: Array<Array<unknown>> } };

beforeAll(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  addJobSpy = jest
    .spyOn(Queue, "addJob")
    .mockResolvedValue(undefined as never) as unknown as {
    mock: { calls: Array<Array<unknown>> };
  };
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  setTestBillingEnabled(false);
});

afterEach(() => {
  setTestBillingEnabled(false);
});

describe("the CloudMarketplace area", () => {
  test("is the enterprise module's last area, and has its own directory", () => {
    expect(ENTERPRISE_AREAS[ENTERPRISE_AREAS.length - 1]).toBe(
      CloudMarketplaceArea,
    );
    expect(CloudMarketplaceArea.name).toBe("CloudMarketplace");
    expect(CloudMarketplaceArea.getApiRouters).toBe(
      getCloudMarketplaceApiRouters,
    );
    expect(CloudMarketplaceArea.getIdentityRouters).toBe(
      getCloudMarketplaceIdentityRouters,
    );
    expect(CloudMarketplaceArea.registerWorkerJobs).toBe(
      registerCloudMarketplaceWorkerJobs,
    );
  });

  test("names its jobs, which core keeps placeholders for", () => {
    expect(CLOUD_MARKETPLACE_JOB_NAMES).toEqual([
      "Marketplace:ReportUsage",
      "Marketplace:SyncPurchases",
      "Marketplace:VercelBilling",
    ]);

    for (const jobName of CLOUD_MARKETPLACE_JOB_NAMES) {
      expect(ENTERPRISE_OWNED_JOB_NAMES).toContain(jobName);
    }
  });
});

describe("with billing off (a self-hosted installation)", () => {
  test("contributes no route", () => {
    expect(getCloudMarketplaceApiRouters()).toEqual([]);
    expect(getCloudMarketplaceIdentityRouters()).toEqual([]);
  });

  test("hands core no project billing hooks", () => {
    expect(getProjectBillingHooks()).toBeNull();
    expect(EnterpriseModule.getProjectBillingHooks?.()).toBeNull();
  });

  test("the assembled module serves none of the marketplaces' paths", () => {
    const served: Array<string> = [
      ...EnterpriseModule.getApiRouters(),
      ...EnterpriseModule.getIdentityRouters(),
    ]
      .flatMap(routesOf)
      .map((route: Route): string => {
        return route[1];
      });

    for (const path of served) {
      expect(path.startsWith("/marketplace/")).toBe(false);
      expect(path).not.toBe("/vercel/sso");
    }
  });

  test("registers no job", async () => {
    await registerCloudMarketplaceWorkerJobs();

    for (const jobName of CLOUD_MARKETPLACE_JOB_NAMES) {
      expect({ jobName, registered: JobDictionary.has(jobName) }).toEqual({
        jobName,
        registered: false,
      });
    }
  });
});

describe("with billing on (OneUptime Cloud)", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
  });

  test("serves the cloud marketplaces' routes and Vercel's provider API at the paths core served them at", () => {
    const routers: Array<ExpressRouter> = getCloudMarketplaceApiRouters();

    expect(routers).toHaveLength(2);
    expect(routesOf(routers[0]!)).toEqual(MARKETPLACE_ROUTES);
    expect(routesOf(routers[1]!)).toEqual(VERCEL_PROVIDER_ROUTES);
  });

  test("serves sign-in from Vercel with the identity routers", () => {
    const routers: Array<ExpressRouter> = getCloudMarketplaceIdentityRouters();

    expect(routers).toEqual([VercelSignInAPI]);
    expect(routesOf(VercelSignInAPI)).toEqual(VERCEL_SIGN_IN_ROUTES);
  });

  test("the assembled module hands both over, after the other areas' routers", () => {
    const apiRouters: Array<ExpressRouter> = EnterpriseModule.getApiRouters();
    const identityRouters: Array<ExpressRouter> =
      EnterpriseModule.getIdentityRouters();

    expect(
      apiRouters.slice(-2).map((router: ExpressRouter) => {
        return routesOf(router);
      }),
    ).toEqual([MARKETPLACE_ROUTES, VERCEL_PROVIDER_ROUTES]);
    expect(identityRouters[identityRouters.length - 1]).toBe(VercelSignInAPI);
  });

  test("every router holds routes only, no router.use() layer", () => {
    for (const router of [
      ...getCloudMarketplaceApiRouters(),
      ...getCloudMarketplaceIdentityRouters(),
    ]) {
      expect(
        EnterpriseServerModuleShape.findLayersWithoutRoute(router),
      ).toEqual([]);
    }
  });

  test("hands core the project billing hooks", () => {
    expect(getProjectBillingHooks()).toBe(CloudMarketplaceProjectBillingHooks);
    expect(EnterpriseModule.getProjectBillingHooks?.()).toBe(
      CloudMarketplaceProjectBillingHooks,
    );
  });

  test("registers its three jobs with core's JobDictionary, on their schedules", async () => {
    await registerCloudMarketplaceWorkerJobs();

    for (const jobName of CLOUD_MARKETPLACE_JOB_NAMES) {
      expect({ jobName, registered: JobDictionary.has(jobName) }).toEqual({
        jobName,
        registered: true,
      });
    }

    expect(JobDictionary.getTimeoutInMs("Marketplace:ReportUsage")).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(50),
    );
    expect(JobDictionary.getTimeoutInMs("Marketplace:SyncPurchases")).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(120),
    );
    expect(JobDictionary.getTimeoutInMs("Marketplace:VercelBilling")).toBe(
      OneUptimeDate.convertMinutesToMilliseconds(40),
    );

    const scheduleOf: (jobName: string) => unknown = (
      jobName: string,
    ): unknown => {
      const call: Array<unknown> | undefined = addJobSpy.mock.calls.find(
        (candidate: Array<unknown>): boolean => {
          return candidate[1] === jobName;
        },
      );

      expect(call?.[0]).toBe(QueueName.Worker);

      return (call?.[4] as { scheduleAt?: unknown } | undefined)?.scheduleAt;
    };

    // config.example.env is not a development environment.
    expect(scheduleOf("Marketplace:ReportUsage")).toBe(EVERY_HOUR);
    expect(scheduleOf("Marketplace:SyncPurchases")).toBe(EVERY_DAY);
    expect(scheduleOf("Marketplace:VercelBilling")).toBe("15 * * * *");
    expect([EVERY_HOUR, EVERY_DAY, "15 * * * *"]).not.toContain(
      EVERY_FIVE_MINUTE,
    );
  });

  test("asking again schedules nothing twice", async () => {
    const before: number = addJobSpy.mock.calls.length;

    await registerCloudMarketplaceWorkerJobs();

    expect(addJobSpy.mock.calls.length).toBe(before);
  });
});
