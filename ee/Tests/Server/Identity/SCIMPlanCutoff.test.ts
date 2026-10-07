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
  getScimRequestBelowPlan,
  ScimRequestBelowPlan,
} from "../../../Server/Identity/Utils/SCIMBelowPlan";
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
import TeamService from "Common/Server/Services/TeamService";
import UserService from "Common/Server/Services/UserService";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import { getScimStoppedMessage } from "Common/Types/Billing/PlanCutoffCredentials";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * SCIM works fully only while the project is on the plan that sells it:
 * Scale, for a project's SCIM connections and its status pages' alike.
 * Below it - after a downgrade - a connection still answers lookups and
 * takes access away, so a person removed in the identity provider loses
 * their access to OneUptime too, but it gives and changes no access
 * (Utils/SCIMBelowPlan). This suite is the door: the requests that can only
 * give access - creating a user or a group, a Bulk request that is not all
 * DELETEs - are refused with 402 and a body in the SCIM error format (RFC
 * 7644, section 3.12) before any handler runs, once the bearer token has
 * checked out; every other request reaches its handler, which checks what
 * it would change (SCIMBelowPlanRequests.test.ts). Nothing is deleted: the
 * same connection, with the same token, works fully again as soon as the
 * project is back on Scale. Self-hosted installs (billing off) are not
 * affected.
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

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
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

const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";

let server: IdentityServer;
let currentPlan: PlanType | null = PlanType.Free;
let getCurrentPlan: jest.SpyInstance;
let handlerReads: Array<jest.SpyInstance> = [];

const savedPlanEnvironment: Record<string, string | undefined> = {};

// Every SCIM route, read from the live routers.
interface ScimRoute {
  method: string;
  // The pattern as registered, e.g. /scim/v2/:projectScimId/Users/:userId.
  pattern: string;
  // The same with ids filled in.
  path: string;
  kind: "project" | "status";
}

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
      ([method, pattern]: [string, string]): ScimRoute => {
        return {
          method,
          pattern,
          path: pattern
            .replace(":projectScimId", PROJECT_SCIM_ID)
            .replace(":statusPageScimId", STATUS_PAGE_SCIM_ID)
            .replace(":userId", RECORD_ID)
            .replace(":groupId", RECORD_ID),
          kind: pattern.startsWith("/status-page-scim/") ? "status" : "project",
        };
      },
    );
  },
);

/*
 * What each route does below the plan, said once, by hand: the door refuses
 * only what can only give access. A route added to the routers and not to
 * this table fails the first test, and the middleware refuses it below the
 * plan until Utils/SCIMBelowPlan lists it.
 */
const BELOW_PLAN_BY_ROUTE: Record<string, ScimRequestBelowPlan> = {
  "GET /scim/v2/:projectScimId/ServiceProviderConfig":
    ScimRequestBelowPlan.Answered,
  "GET /scim/v2/:projectScimId/Schemas": ScimRequestBelowPlan.Answered,
  "GET /scim/v2/:projectScimId/ResourceTypes": ScimRequestBelowPlan.Answered,
  // With an empty body: a Bulk request passes only when it is all DELETEs.
  "POST /scim/v2/:projectScimId/Bulk": ScimRequestBelowPlan.Refused,
  "GET /scim/v2/:projectScimId/Users": ScimRequestBelowPlan.Answered,
  "GET /scim/v2/:projectScimId/Users/:userId": ScimRequestBelowPlan.Answered,
  "PUT /scim/v2/:projectScimId/Users/:userId": ScimRequestBelowPlan.Answered,
  "PATCH /scim/v2/:projectScimId/Users/:userId": ScimRequestBelowPlan.Answered,
  "GET /scim/v2/:projectScimId/Groups": ScimRequestBelowPlan.Answered,
  "GET /scim/v2/:projectScimId/Groups/:groupId": ScimRequestBelowPlan.Answered,
  "POST /scim/v2/:projectScimId/Groups": ScimRequestBelowPlan.Refused,
  "PUT /scim/v2/:projectScimId/Groups/:groupId": ScimRequestBelowPlan.Answered,
  "DELETE /scim/v2/:projectScimId/Groups/:groupId":
    ScimRequestBelowPlan.Answered,
  "PATCH /scim/v2/:projectScimId/Groups/:groupId":
    ScimRequestBelowPlan.Answered,
  "POST /scim/v2/:projectScimId/Users": ScimRequestBelowPlan.Refused,
  "DELETE /scim/v2/:projectScimId/Users/:userId": ScimRequestBelowPlan.Answered,
  "GET /status-page-scim/v2/:statusPageScimId/ServiceProviderConfig":
    ScimRequestBelowPlan.Answered,
  "GET /status-page-scim/v2/:statusPageScimId/Schemas":
    ScimRequestBelowPlan.Answered,
  "GET /status-page-scim/v2/:statusPageScimId/ResourceTypes":
    ScimRequestBelowPlan.Answered,
  "POST /status-page-scim/v2/:statusPageScimId/Bulk":
    ScimRequestBelowPlan.Refused,
  "GET /status-page-scim/v2/:statusPageScimId/Users":
    ScimRequestBelowPlan.Answered,
  "GET /status-page-scim/v2/:statusPageScimId/Users/:userId":
    ScimRequestBelowPlan.Answered,
  "POST /status-page-scim/v2/:statusPageScimId/Users":
    ScimRequestBelowPlan.Refused,
  "PUT /status-page-scim/v2/:statusPageScimId/Users/:userId":
    ScimRequestBelowPlan.Answered,
  "PATCH /status-page-scim/v2/:statusPageScimId/Users/:userId":
    ScimRequestBelowPlan.Answered,
  "DELETE /status-page-scim/v2/:statusPageScimId/Users/:userId":
    ScimRequestBelowPlan.Answered,
};

const routeKey: (route: ScimRoute) => string = (route: ScimRoute): string => {
  return `${route.method} ${route.pattern}`;
};

const REFUSED_ROUTES: Array<ScimRoute> = ROUTES.filter(
  (route: ScimRoute): boolean => {
    return (
      BELOW_PLAN_BY_ROUTE[routeKey(route)] === ScimRequestBelowPlan.Refused
    );
  },
);

const ANSWERED_ROUTES: Array<ScimRoute> = ROUTES.filter(
  (route: ScimRoute): boolean => {
    return (
      BELOW_PLAN_BY_ROUTE[routeKey(route)] === ScimRequestBelowPlan.Answered
    );
  },
);

const PROJECT_USERS: string = `/scim/v2/${PROJECT_SCIM_ID}/Users`;
const PROJECT_BULK: string = `/scim/v2/${PROJECT_SCIM_ID}/Bulk`;
const STATUS_PAGE_USERS: string = `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}/Users`;
const STATUS_PAGE_BULK: string = `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}/Bulk`;
const PROJECT_DISCOVERY: string = `/scim/v2/${PROJECT_SCIM_ID}/ServiceProviderConfig`;
const STATUS_PAGE_DISCOVERY: string = `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}/ServiceProviderConfig`;

interface HttpAnswer {
  status: number;
  body: string;
}

const request: (
  method: string,
  path: string,
  options?: { token?: string; body?: JSONObject },
) => Promise<HttpAnswer> = async (
  method: string,
  path: string,
  options?: { token?: string; body?: JSONObject },
): Promise<HttpAnswer> => {
  const hasBody: boolean = ["POST", "PUT", "PATCH"].includes(method);

  const response: globalThis.Response = await fetch(
    `${server.baseUrl}${path}`,
    {
      method,
      redirect: "manual",
      headers: {
        authorization: `Bearer ${options?.token ?? TOKEN}`,
        /*
         * The test server parses application/json; core's own server reads
         * application/scim+json as JSON too (StartServer).
         */
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options?.body ?? {}) } : {}),
    },
  );

  return { status: response.status, body: await response.text() };
};

const bulk: (methods: Array<string>) => JSONObject = (
  methods: Array<string>,
): JSONObject => {
  return {
    schemas: [BULK_SCHEMA],
    Operations: methods.map((method: string, index: number): JSONObject => {
      return {
        method,
        bulkId: `operation-${index}`,
        path: method === "POST" ? "/Users" : `/Users/${RECORD_ID}`,
        ...(method === "DELETE" ? {} : { data: { active: false } }),
      };
    }),
  };
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
const lookupMatches: (findBy: unknown, id: string) => boolean = (
  findBy: unknown,
  id: string,
): boolean => {
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

  /*
   * What a SCIM handler reads once it runs: nothing is found, so a handler
   * that runs answers with a list of none, a 404 or a 400 - never a 402.
   * A request refused at the door never gets here.
   */
  handlerReads = [
    jest.spyOn(UserService, "findOneBy").mockResolvedValue(null as never),
    jest.spyOn(UserService, "findBy").mockResolvedValue([] as never),
    jest.spyOn(TeamMemberService, "findOneBy").mockResolvedValue(null as never),
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never),
    jest.spyOn(TeamService, "findOneBy").mockResolvedValue(null as never),
    jest.spyOn(TeamService, "findBy").mockResolvedValue([] as never),
    jest
      .spyOn(StatusPagePrivateUserService, "findOneBy")
      .mockResolvedValue(null as never),
    jest
      .spyOn(StatusPagePrivateUserService, "findBy")
      .mockResolvedValue([] as never),
  ];
});

afterEach(() => {
  for (const spy of handlerReads) {
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
  for (const spy of handlerReads) {
    expect(spy).not.toHaveBeenCalled();
  }
};

const expectRefusedBelowPlan: (answer: HttpAnswer) => void = (
  answer: HttpAnswer,
): void => {
  expect(answer.status).toBe(402);
  expect(JSON.parse(answer.body)).toEqual({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "402",
    detail: getScimStoppedMessage(PlanType.Scale),
  });
};

describe("the SCIM routes an identity provider calls", () => {
  test("are all 26, project and status page, and each says what it does below the plan", () => {
    expect(ROUTES).toHaveLength(26);
    expect(
      ROUTES.filter((route: ScimRoute) => {
        return route.kind === "status";
      }).length,
    ).toBe(10);
    expect(ROUTES.map(routeKey).sort()).toEqual(
      Object.keys(BELOW_PLAN_BY_ROUTE).sort(),
    );
  });

  test("the middleware's own reading of each route is this table", () => {
    for (const route of ROUTES) {
      expect([
        routeKey(route),
        getScimRequestBelowPlan({
          method: route.method,
          routePath: route.pattern,
          body: {},
        }),
      ]).toEqual([routeKey(route), BELOW_PLAN_BY_ROUTE[routeKey(route)]]);
    }
  });

  test("only creating and Bulk can be refused at the door", () => {
    expect(REFUSED_ROUTES.map(routeKey).sort()).toEqual([
      "POST /scim/v2/:projectScimId/Bulk",
      "POST /scim/v2/:projectScimId/Groups",
      "POST /scim/v2/:projectScimId/Users",
      "POST /status-page-scim/v2/:statusPageScimId/Bulk",
      "POST /status-page-scim/v2/:statusPageScimId/Users",
    ]);
  });
});

describe.each([PlanType.Free, PlanType.Growth])(
  "a project on %s (below Scale), billing on",
  (plan: PlanType) => {
    beforeEach(() => {
      currentPlan = plan;
    });

    test.each(
      REFUSED_ROUTES.map((route: ScimRoute): [string, string] => {
        return [route.method, route.path];
      }),
    )(
      "%s %s, which can only give access, is refused with 402 in the SCIM error format",
      async (method: string, path: string) => {
        const answer: HttpAnswer = await request(method, path, {
          body:
            method === "POST" && path.endsWith("/Users")
              ? { userName: "new.person@example.com" }
              : {},
        });

        expectRefusedBelowPlan(answer);
        expectNoHandlerRan();
      },
    );

    test.each(
      ANSWERED_ROUTES.map((route: ScimRoute): [string, string] => {
        return [route.method, route.path];
      }),
    )(
      "%s %s reaches its handler, which decides what it may change",
      async (method: string, path: string) => {
        const answer: HttpAnswer = await request(method, path);

        // Nothing is found, so the handler answers with none, 404 or 400.
        expect(answer.status).not.toBe(SCIM_BELOW_PLAN_STATUS);
        expect([200, 204, 400, 404]).toContain(answer.status);
      },
    );

    test.each([
      ["the project's", PROJECT_BULK],
      ["a status page's", STATUS_PAGE_BULK],
    ])(
      "%s Bulk request of DELETEs only reaches its handler",
      async (_label: string, path: string) => {
        const answer: HttpAnswer = await request("POST", path, {
          body: bulk(["DELETE", "DELETE"]),
        });

        expect(answer.status).toBe(200);
        expect(JSON.parse(answer.body)["schemas"]).toEqual([
          "urn:ietf:params:scim:api:messages:2.0:BulkResponse",
        ]);
      },
    );

    test.each([
      ["a create among the deletes", ["DELETE", "POST"]],
      ["an update among the deletes", ["DELETE", "PATCH"]],
      ["a replace", ["PUT"]],
      ["no operations at all", []],
    ])(
      "a Bulk request with %s is refused whole, before any operation runs",
      async (_label: string, methods: Array<string>) => {
        for (const path of [PROJECT_BULK, STATUS_PAGE_BULK]) {
          const answer: HttpAnswer = await request("POST", path, {
            body: bulk(methods),
          });

          expectRefusedBelowPlan(answer);
        }

        expectNoHandlerRan();
      },
    );

    test("the refusal names Scale, says removing people still works, and that the connection is kept", async () => {
      const answer: HttpAnswer = await request("POST", PROJECT_USERS, {
        body: { userName: "new.person@example.com" },
      });
      const detail: string = JSON.parse(answer.body)["detail"];

      expect(detail).toContain("SCIM provisioning needs the Scale plan.");
      expect(detail).toContain("can only remove people");
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

    test.each([[PROJECT_DISCOVERY], [STATUS_PAGE_DISCOVERY]])(
      "the discovery document %s is still answered: it says nothing about the project",
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

    test.each([[PROJECT_USERS], [STATUS_PAGE_USERS]])(
      "creating a user at %s reaches its handler as before",
      async (path: string) => {
        // No userName: the handler answers 400, which only a handler does.
        const answer: HttpAnswer = await request("POST", path, { body: {} });

        expect(answer.status).toBe(400);
        expect(answer.body).toContain("required");
      },
    );

    test.each([[PROJECT_BULK], [STATUS_PAGE_BULK]])(
      "a Bulk request of any operations at %s reaches its handler",
      async (path: string) => {
        const answer: HttpAnswer = await request("POST", path, {
          body: bulk(["DELETE", "PATCH"]),
        });

        expect(answer.status).toBe(200);
      },
    );
  },
);

describe("an upgrade", () => {
  test("turns the same connection fully back on, with the same token", async () => {
    currentPlan = PlanType.Growth;
    expectRefusedBelowPlan(
      await request("POST", PROJECT_USERS, {
        body: { userName: "new.person@example.com" },
      }),
    );
    expectRefusedBelowPlan(
      await request("POST", STATUS_PAGE_USERS, {
        body: { userName: "new.person@example.com" },
      }),
    );

    currentPlan = PlanType.Scale;
    expect((await request("POST", PROJECT_USERS, { body: {} })).status).toBe(
      400,
    );
    expect(
      (await request("POST", STATUS_PAGE_USERS, { body: {} })).status,
    ).toBe(400);
  });
});

describe("billing off (self-hosted)", () => {
  test.each([[PROJECT_USERS], [STATUS_PAGE_USERS]])(
    "creating a user at %s reaches its handler whatever plan is stored, and no plan is read",
    async (path: string) => {
      setTestBillingEnabled(false);
      currentPlan = PlanType.Free;

      const answer: HttpAnswer = await request("POST", path, { body: {} });

      expect(answer.status).toBe(400);
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

    const answer: HttpAnswer = await request("POST", PROJECT_USERS, {
      token: "a-wrong-token",
      body: { userName: "new.person@example.com" },
    });

    expect(answer.status).not.toBe(402);
    expect(answer.body).toContain(
      "Invalid bearer token or SCIM configuration not found",
    );
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });
});
