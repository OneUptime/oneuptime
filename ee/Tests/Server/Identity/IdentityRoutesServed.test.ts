import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseModule from "../../../Server/Index";
import { IDENTITY_ROUTERS } from "../../../Server/Identity/Index";
import {
  SSO_ROUTERS,
  SsoRouterEntry,
} from "App/FeatureSet/Identity/SsoRouters";
import {
  expectEverySsoProbeAnswered,
  IdentityServer,
  startIdentityServer,
  stubRenderedViews,
  stubSsoDatabaseReads,
} from "App/Tests/FeatureSet/Identity/SsoRouteProbes";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

/*
 * The real Enterprise Edition module, registered with the real core Identity
 * feature set (packages/App/FeatureSet/Identity/Index.ts) the way the App
 * boots with the Enterprise Edition loaded: the enterprise identity routers
 * (SCIM) and core's own single sign-on routers both answer on the two
 * prefixes core mounts them at: "/api/identity/..." and "/..." (nginx
 * forwards /identity/ to the latter). Loading ee/ neither shadows nor
 * re-gates single sign-on.
 *
 * Every request here is one the handlers turn away before touching the
 * database - a SCIM call without a bearer token, an SSO request for a
 * provider that does not exist (App's SsoRouteProbes) - so the test needs no
 * Postgres. The SCIM lookups are spied on to prove it. The authentication,
 * reseller and status page authentication routers are replaced by empty
 * ones: they are not what this test is about.
 */
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
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

const SCIM_ID: string = "11111111-1111-4111-8111-111111111111";

let server: IdentityServer;

const request: (
  method: string,
  path: string,
) => Promise<{ status: number; body: string }> = async (
  method: string,
  path: string,
): Promise<{ status: number; body: string }> => {
  const response: globalThis.Response = await fetch(
    `${server.baseUrl}${path}`,
    {
      method,
    },
  );

  return { status: response.status, body: await response.text() };
};

beforeAll(async () => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  jest.spyOn(ProjectSCIMService, "findOneBy").mockImplementation(() => {
    throw new Error("the database must not be reached");
  });
  jest.spyOn(StatusPageSCIMService, "findOneBy").mockImplementation(() => {
    throw new Error("the database must not be reached");
  });

  stubSsoDatabaseReads();
  stubRenderedViews();

  EnterpriseEdition.resetForTests();
  EnterpriseEdition.register(EnterpriseModule);

  server = await startIdentityServer();
});

afterAll(async () => {
  await server.close();
  EnterpriseEdition.resetForTests();
  jest.restoreAllMocks();
});

describe("the Enterprise Edition hands core its SCIM routers only", () => {
  test("getIdentityRouters is exactly the Identity area's two SCIM routers", () => {
    expect(EnterpriseModule.getIdentityRouters()).toEqual(
      IDENTITY_ROUTERS.map((entry: { router: ExpressRouter }) => {
        return entry.router;
      }),
    );
    expect(EnterpriseModule.getIdentityRouters()).toHaveLength(2);
  });

  test("none of them is a core single sign-on router", () => {
    const eeRouters: Array<ExpressRouter> =
      EnterpriseModule.getIdentityRouters();

    for (const entry of SSO_ROUTERS) {
      expect(eeRouters).not.toContain(entry.router);
    }

    expect(
      SSO_ROUTERS.map((entry: SsoRouterEntry): string => {
        return entry.name;
      }),
    ).toHaveLength(7);
  });
});

describe("identity routes with the Enterprise Edition loaded, mounted by core", () => {
  test.each(["", "/api/identity"])(
    "project SCIM (ee) answers at %s/scim/v2/... and demands a bearer token",
    async (prefix: string) => {
      const response: { status: number; body: string } = await request(
        "GET",
        `${prefix}/scim/v2/${SCIM_ID}/ServiceProviderConfig`,
      );

      // Reached the SCIM router (not a 404) and was refused by its token check.
      expect(response.status).not.toBe(404);
      expect(response.body).toContain(
        "Bearer token is required for SCIM authentication",
      );
    },
  );

  test.each(["", "/api/identity"])(
    "status page SCIM (ee) answers at %s/status-page-scim/v2/... and demands a bearer token",
    async (prefix: string) => {
      const response: { status: number; body: string } = await request(
        "GET",
        `${prefix}/status-page-scim/v2/${SCIM_ID}/Users`,
      );

      // Reached the SCIM router (not a 404) and was refused by its token check.
      expect(response.status).not.toBe(404);
      expect(response.body).toContain(
        "Bearer token is required for SCIM authentication",
      );
    },
  );

  test("every single sign-on route (core) answers with its own handler, at both prefixes", async () => {
    await expectEverySsoProbeAnswered(server.baseUrl);
  });

  test.each([
    ["GET", `/scim/v2/${SCIM_ID}/NoSuchResource`],
    ["POST", `/scim/v2/${SCIM_ID}/ServiceProviderConfig`],
    ["GET", `/api/identity/scim/v3/${SCIM_ID}/Users`],
    ["GET", "/identity-not-a-route"],
  ])(
    "an unknown identity path is still a 404 (%s %s)",
    async (method: string, path: string) => {
      const response: { status: number; body: string } = await request(
        method,
        path,
      );

      expect(response.status).toBe(404);
    },
  );

  test("none of the requests above reached the SCIM database", () => {
    expect(ProjectSCIMService.findOneBy).not.toHaveBeenCalled();
    expect(StatusPageSCIMService.findOneBy).not.toHaveBeenCalled();
  });
});
