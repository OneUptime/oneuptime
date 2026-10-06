import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import IdentityArea, {
  IDENTITY_ROUTERS,
  IdentityRouterEntry,
} from "../../../Server/Identity/Index";
import {
  getScimBelowPlanResponse,
  SCIM_BELOW_PLAN_STATUS,
} from "../../../Server/Identity/Middleware/SCIMAuthorization";
import {
  IdentityServer,
  startIdentityServer,
  stubRenderedViews,
  stubSsoDatabaseReads,
} from "App/Tests/FeatureSet/Identity/SsoRouteProbes";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import ProjectService, {
  CurrentPlan,
} from "Common/Server/Services/ProjectService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * SCIM works only while the project is on the plan that sells it: Scale,
 * for a project's SCIM connections and its status pages' alike. Below it -
 * after a downgrade - every SCIM request is refused once its bearer token
 * checks out, with 402 and a body in the SCIM error format (RFC 7644,
 * section 3.12), so the identity provider shows its administrators why.
 * Nothing is deleted: the same connection, with the same token, provisions
 * again as soon as the project is back on Scale. Self-hosted installs
 * (billing off) are not affected.
 *
 * The real SCIM routers, mounted by the real Identity feature set and asked
 * over HTTP - every one of the 26 routes an identity provider calls.
 */
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

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

jest.mock("App/FeatureSet/Identity/API/Authentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("App/FeatureSet/Identity/API/Reseller", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

jest.mock("App/FeatureSet/Identity/API/StatusPageAuthentication", () => {
  const express: typeof import("Common/Server/Utils/Express") =
    jest.requireActual(
      "Common/Server/Utils/Express",
    ) as typeof import("Common/Server/Utils/Express");

  return { __esModule: true, default: express.default.getRouter() };
});

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000001",
);
const PROJECT_SCIM_ID: string = "7f000000-0000-4000-8000-000000000002";
const STATUS_PAGE_SCIM_ID: string = "7f000000-0000-4000-8000-000000000003";
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000004",
);
const RECORD_ID: string = "7f000000-0000-4000-8000-000000000005";
const TOKEN: string = "the-identity-provider-secret";

let server: IdentityServer;
let currentPlan: PlanType | null = PlanType.Free;
let getCurrentPlan: jest.SpyInstance;
let pastAuthentication: Array<jest.SpyInstance> = [];

const savedPlanEnvironment: Record<string, string | undefined> = {};

// Every SCIM route, read from the live routers: [method, path, kind].
type ScimRoute = [method: string, path: string, kind: "project" | "status"];

const getRoutes: (router: ExpressRouter) => Array<[string, string]> = (
  router: ExpressRouter,
): Array<[string, string]> => {
  const routes: Array<[string, string]> = [];

  for (const layer of (
    router as unknown as {
      stack: Array<{
        route?: { path: string; methods: Record<string, boolean> };
      }>;
    }
  ).stack) {
    if (!layer.route) {
      continue;
    }

    for (const method of Object.keys(layer.route.methods)) {
      routes.push([method.toUpperCase(), layer.route.path]);
    }
  }

  return routes;
};

const ROUTES: Array<ScimRoute> = IDENTITY_ROUTERS.flatMap(
  (entry: IdentityRouterEntry): Array<ScimRoute> => {
    return getRoutes(entry.router).map(
      ([method, path]: [string, string]): ScimRoute => {
        const isStatusPage: boolean = path.startsWith("/status-page-scim/");

        return [
          method,
          path
            .replace(":projectScimId", PROJECT_SCIM_ID)
            .replace(":statusPageScimId", STATUS_PAGE_SCIM_ID)
            .replace(":userId", RECORD_ID)
            .replace(":groupId", RECORD_ID),
          isStatusPage ? "status" : "project",
        ];
      },
    );
  },
);

const PROJECT_DISCOVERY: string = `/scim/v2/${PROJECT_SCIM_ID}/ServiceProviderConfig`;
const STATUS_PAGE_DISCOVERY: string = `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}/ServiceProviderConfig`;

interface HttpAnswer {
  status: number;
  body: string;
}

const request: (
  method: string,
  path: string,
  token?: string,
) => Promise<HttpAnswer> = async (
  method: string,
  path: string,
  token?: string,
): Promise<HttpAnswer> => {
  const hasBody: boolean = ["POST", "PUT", "PATCH"].includes(method);

  const response: globalThis.Response = await fetch(
    `${server.baseUrl}${path}`,
    {
      method,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${token ?? TOKEN}`,
        ...(hasBody ? { "content-type": "application/scim+json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify({}) } : {}),
    },
  );

  return { status: response.status, body: await response.text() };
};

const projectConfig: () => ProjectSCIM = (): ProjectSCIM => {
  const config: ProjectSCIM = new ProjectSCIM();
  config._id = PROJECT_SCIM_ID;
  config.projectId = PROJECT_ID;
  config.autoProvisionUsers = true;
  config.autoDeprovisionUsers = true;
  return config;
};

const statusPageConfig: () => StatusPageSCIM = (): StatusPageSCIM => {
  const config: StatusPageSCIM = new StatusPageSCIM();
  config._id = STATUS_PAGE_SCIM_ID;
  config.projectId = PROJECT_ID;
  config.statusPageId = STATUS_PAGE_ID;
  config.autoProvisionUsers = true;
  config.autoDeprovisionUsers = true;
  return config;
};

// The connection whose id and token the request names, as the lookup finds it.
const lookupMatches: (
  findBy: unknown,
  id: string,
) => boolean = (findBy: unknown, id: string): boolean => {
  const query: Record<string, unknown> = (
    findBy as { query: Record<string, unknown> }
  ).query;

  return String(query["_id"]) === id && query["bearerToken"] === TOKEN;
};

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUBSCRIPTION_PLAN_")) {
      savedPlanEnvironment[key] = process.env[key];
      delete process.env[key];
    }
  }

  Object.assign(process.env, PLAN_ENVIRONMENT);

  for (const level of ["error", "warn", "info", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }

  stubSsoDatabaseReads();
  stubRenderedViews();

  setTestBillingEnabled(true);

  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
    identityRouters: IdentityArea.getIdentityRouters!() as Array<ExpressRouter>,
  });

  server = await startIdentityServer();
});

beforeEach(() => {
  setTestBillingEnabled(true);
  currentPlan = PlanType.Free;

  jest
    .spyOn(ProjectSCIMService, "findOneBy")
    .mockImplementation(async (findBy: unknown) => {
      return (
        lookupMatches(findBy, PROJECT_SCIM_ID) ? projectConfig() : null
      ) as never;
    });

  jest
    .spyOn(StatusPageSCIMService, "findOneBy")
    .mockImplementation(async (findBy: unknown) => {
      return (
        lookupMatches(findBy, STATUS_PAGE_SCIM_ID) ? statusPageConfig() : null
      ) as never;
    });

  getCurrentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockImplementation(async (): Promise<CurrentPlan> => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    });

  // What a SCIM handler reads once it runs: refused requests never get here.
  pastAuthentication = [
    jest.spyOn(UserService, "findOneBy"),
    jest.spyOn(UserService, "findBy"),
    jest.spyOn(TeamMemberService, "findOneBy"),
    jest.spyOn(TeamMemberService, "findBy"),
    jest.spyOn(StatusPagePrivateUserService, "findOneBy"),
    jest.spyOn(StatusPagePrivateUserService, "findBy"),
  ].map((spy: jest.SpyInstance): jest.SpyInstance => {
    return spy.mockImplementation(() => {
      throw new Error("a SCIM handler must not run below the plan");
    });
  });
});

afterEach(() => {
  for (const spy of pastAuthentication) {
    spy.mockRestore();
  }

  getCurrentPlan.mockRestore();
  (ProjectSCIMService.findOneBy as unknown as jest.SpyInstance).mockRestore();
  (
    StatusPageSCIMService.findOneBy as unknown as jest.SpyInstance
  ).mockRestore();
});

afterAll(async () => {
  await server.close();
  EnterpriseEdition.resetForTests();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();

  for (const key of Object.keys(PLAN_ENVIRONMENT)) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(savedPlanEnvironment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

const expectNoHandlerRan: () => void = (): void => {
  for (const spy of pastAuthentication) {
    expect(spy).not.toHaveBeenCalled();
  }
};

describe("the SCIM routes an identity provider calls", () => {
  test("are all 26, project and status page", () => {
    expect(ROUTES).toHaveLength(26);
    expect(
      ROUTES.filter((route: ScimRoute) => {
        return route[2] === "status";
      }).length,
    ).toBe(10);
  });
});

describe.each([PlanType.Free, PlanType.Growth])(
  "a project on %s (below Scale), billing on",
  (plan: PlanType) => {
    beforeEach(() => {
      currentPlan = plan;
    });

    test.each(ROUTES)(
      "%s %s is refused with 402 in the SCIM error format",
      async (method: string, path: string) => {
        const answer: HttpAnswer = await request(method, path);

        expect(answer.status).toBe(402);
        expect(JSON.parse(answer.body)).toEqual({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "402",
          detail: getScimStoppedMessage(PlanType.Scale),
        });
        expectNoHandlerRan();
      },
    );

    test("the refusal names Scale and says the connection is kept", async () => {
      const answer: HttpAnswer = await request("GET", PROJECT_DISCOVERY);
      const detail: string = JSON.parse(answer.body)["detail"];

      expect(detail).toContain("SCIM provisioning needs the Scale plan.");
      expect(detail).toContain("The connections are kept");
      expect(detail).toContain("Project Settings > Billing");
    });

    test("the plan read is the connection's own project's", async () => {
      await request("GET", STATUS_PAGE_DISCOVERY);

      expect(getCurrentPlan).toHaveBeenCalledTimes(1);
      expect(String(getCurrentPlan.mock.calls[0]![0])).toBe(
        PROJECT_ID.toString(),
      );
    });
  },
);

describe("the response it builds", () => {
  test("is the SCIM error body with the 402 status", () => {
    expect(SCIM_BELOW_PLAN_STATUS).toBe(402);
    expect(getScimBelowPlanResponse("Scale")).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "402",
      detail: getScimStoppedMessage("Scale"),
    });
  });
});

describe.each([PlanType.Scale, PlanType.Enterprise])(
  "a project on %s, billing on",
  (plan: PlanType) => {
    beforeEach(() => {
      currentPlan = plan;
    });

    test.each([[PROJECT_DISCOVERY], [STATUS_PAGE_DISCOVERY]])(
      "%s answers as before",
      async (path: string) => {
        const answer: HttpAnswer = await request("GET", path);

        expect(answer.status).toBe(200);
        expect(JSON.parse(answer.body)["schemas"]).toEqual([
          "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
        ]);
      },
    );
  },
);

describe("an upgrade", () => {
  test("turns the same connection back on, with the same token", async () => {
    currentPlan = PlanType.Growth;
    expect((await request("GET", PROJECT_DISCOVERY)).status).toBe(402);
    expect((await request("GET", STATUS_PAGE_DISCOVERY)).status).toBe(402);

    currentPlan = PlanType.Scale;
    expect((await request("GET", PROJECT_DISCOVERY)).status).toBe(200);
    expect((await request("GET", STATUS_PAGE_DISCOVERY)).status).toBe(200);
  });
});

describe("billing off (self-hosted)", () => {
  test.each([[PROJECT_DISCOVERY], [STATUS_PAGE_DISCOVERY]])(
    "%s answers whatever plan is stored, and no plan is read",
    async (path: string) => {
      setTestBillingEnabled(false);
      currentPlan = PlanType.Free;

      const answer: HttpAnswer = await request("GET", path);

      expect(answer.status).toBe(200);
      expect(getCurrentPlan).not.toHaveBeenCalled();
    },
  );
});

describe("a caller without the token", () => {
  /*
   * Learns nothing about the project's plan: the plan is read only once the
   * bearer token has checked out, and a wrong one is the same refusal as
   * before, whatever the plan.
   */
  test("is refused as before, and no plan is read", async () => {
    currentPlan = PlanType.Free;

    const answer: HttpAnswer = await request(
      "GET",
      PROJECT_DISCOVERY,
      "a-wrong-token",
    );

    expect(answer.status).not.toBe(402);
    expect(answer.body).toContain(
      "Invalid bearer token or SCIM configuration not found",
    );
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });
});
