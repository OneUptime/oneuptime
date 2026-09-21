import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import EnterpriseModule from "../../../Server/Index";
import IdentityFeatureSet from "App/FeatureSet/Identity/Index";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import UserService from "Common/Server/Services/UserService";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Exception from "Common/Types/Exception/Exception";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * The real enterprise identity routers, mounted by the real core Identity
 * feature set (packages/App/FeatureSet/Identity/Index.ts) the way the App
 * boots with the Enterprise Edition loaded, answer on both prefixes core
 * mounts them at: "/api/identity/..." and "/..." (nginx forwards /identity/
 * to the latter).
 *
 * Every request here is one the handlers turn away before touching the
 * database - a SCIM call without a bearer token, an SSO discovery call
 * without an email - so the test needs no Postgres. The service lookups are
 * spied on to prove it. The three core identity routers are replaced by
 * empty ones: they are not what this test is about.
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

let server: Server;
let baseUrl: string;

const request: (
  method: string,
  path: string,
) => Promise<{ status: number; body: string }> = async (
  method: string,
  path: string,
): Promise<{ status: number; body: string }> => {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
  });

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
  jest.spyOn(UserService, "findOneBy").mockImplementation(() => {
    throw new Error("the database must not be reached");
  });

  EnterpriseEdition.resetForTests();
  EnterpriseEdition.register(EnterpriseModule);

  Express.setupExpress();
  await IdentityFeatureSet.init();

  const app: ExpressApplication = Express.getExpressApp();

  // What core's server adds after every router: errors become JSON answers.
  app.use(
    (
      err: Exception,
      req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      Response.sendErrorResponse(req, res, err);
    },
  );

  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  EnterpriseEdition.resetForTests();
  jest.restoreAllMocks();
});

describe("enterprise identity routes, mounted by core", () => {
  test.each(["", "/api/identity"])(
    "project SCIM answers at %s/scim/v2/... and demands a bearer token",
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
    "status page SCIM answers at %s/status-page-scim/v2/... and demands a bearer token",
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

  test.each([
    ["", "/service-provider-login"],
    ["/api/identity", "/service-provider-login"],
    ["", "/service-provider-login-oidc"],
    ["/api/identity", "/service-provider-login-oidc"],
  ])("SSO discovery answers at %s%s", async (prefix: string, path: string) => {
    const response: { status: number; body: string } = await request(
      "GET",
      `${prefix}${path}`,
    );

    expect(response.status).toBe(400);
    expect(response.body).toContain("Email is required");
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

  test("none of the requests above reached the database", () => {
    expect(ProjectSCIMService.findOneBy).not.toHaveBeenCalled();
    expect(StatusPageSCIMService.findOneBy).not.toHaveBeenCalled();
    expect(UserService.findOneBy).not.toHaveBeenCalled();
  });
});
