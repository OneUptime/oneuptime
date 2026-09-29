import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import IdentityArea from "../../../Server/Identity/Index";
import {
  MESSAGE_VIEW,
  MOBILE_SSO_UNAVAILABLE_ERROR,
  SCIM_UNAVAILABLE_MESSAGE,
  SSO_UNAVAILABLE_MESSAGE,
} from "../../../Server/Identity/Middleware/LicensedFeatureGate";
import IdentityFeatureSet from "App/FeatureSet/Identity/Index";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import GlobalSSOService from "Common/Server/Services/GlobalSsoService";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import UserService from "Common/Server/Services/UserService";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * The real enterprise identity routers, mounted ONCE by the real core Identity
 * feature set, answering over HTTP while the license lapses and is renewed:
 *
 *   - lapsed: SCIM answers 403 with a SCIM error body, SSO discovery 402, the
 *     browser SSO flows the message page (402), a mobile login the app's
 *     failure deep link - and nothing reaches a handler or the database;
 *   - renewed (or unknown): the same mounted routes reach their handlers
 *     again, with no restart and no re-mount.
 *
 * The enterprise module is the fake from Common's test kit carrying the real
 * identity routers, so the license can be changed per test. The three core
 * identity routers are replaced by empty ones, and every request is one the
 * handlers turn away before touching the database, which is spied on.
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

const ID: string = "11111111-1111-4111-8111-111111111111";

let server: Server;
let baseUrl: string;
let fake: FakeEnterpriseModule;
let databaseReads: Array<jest.SpyInstance> = [];

interface HttpAnswer {
  status: number;
  location: string | null;
  body: string;
}

const request: (method: string, path: string) => Promise<HttpAnswer> = async (
  method: string,
  path: string,
): Promise<HttpAnswer> => {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
  });

  return {
    status: response.status,
    location: response.headers.get("location"),
    body: await response.text(),
  };
};

const expectNoDatabaseRead: () => void = (): void => {
  for (const spy of databaseReads) {
    expect(spy).not.toHaveBeenCalled();
  }
};

beforeAll(async () => {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  // The Identity message page is an EJS view in the App image; answer with its arguments instead.
  jest
    .spyOn(Response, "render")
    .mockImplementation(
      (
        _req: ExpressRequest,
        res: ExpressResponse,
        view: string,
        vars: JSONObject,
      ): void => {
        res.send(JSON.stringify({ view, ...vars }));
      },
    );

  setTestBillingEnabled(false);

  fake = installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
    identityRouters: IdentityArea.getIdentityRouters!() as Array<ExpressRouter>,
  });

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

beforeEach(() => {
  databaseReads = [
    jest.spyOn(ProjectSCIMService, "findOneBy"),
    jest.spyOn(StatusPageSCIMService, "findOneBy"),
    jest.spyOn(UserService, "findOneBy"),
    jest.spyOn(GlobalSSOService, "findBy"),
    jest.spyOn(GlobalSSOService, "findOneBy"),
  ].map((spy: jest.SpyInstance): jest.SpyInstance => {
    return spy.mockImplementation(() => {
      throw new Error("the database must not be reached");
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  EnterpriseEdition.resetForTests();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a lapsed license: the mounted routes refuse over HTTP", () => {
  beforeEach(() => {
    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
  });

  test.each([
    ["GET", `/scim/v2/${ID}/ServiceProviderConfig`],
    ["GET", `/api/identity/scim/v2/${ID}/Users`],
    ["POST", `/scim/v2/${ID}/Groups`],
    ["DELETE", `/status-page-scim/v2/${ID}/Users/${ID}`],
    ["GET", `/api/identity/status-page-scim/v2/${ID}/Users`],
  ])(
    "SCIM %s %s: 403 with a SCIM error body",
    async (method: string, path: string) => {
      const answer: HttpAnswer = await request(method, path);

      expect(answer.status).toBe(403);
      expect(JSON.parse(answer.body)).toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "403",
        detail: SCIM_UNAVAILABLE_MESSAGE,
      });
      expectNoDatabaseRead();
    },
  );

  test.each([
    "/service-provider-login?email=someone@example.com",
    "/api/identity/service-provider-login-oidc?email=someone@example.com",
    "/global-sso/service-provider-login",
    "/api/identity/global-oidc/service-provider-login",
  ])("SSO discovery %s: 402 with the message", async (path: string) => {
    const answer: HttpAnswer = await request("GET", path);

    expect(answer.status).toBe(402);
    expect(JSON.parse(answer.body)).toEqual({
      message: SSO_UNAVAILABLE_MESSAGE,
    });
    expectNoDatabaseRead();
  });

  test.each([
    ["GET", `/sso/${ID}/${ID}`],
    ["POST", `/idp-login/${ID}/${ID}`],
    ["GET", `/api/identity/global-sso/${ID}`],
    ["GET", `/global-oidc-callback/${ID}`],
    ["GET", `/status-page-sso/${ID}/${ID}`],
    ["POST", `/status-page-idp-login/${ID}/${ID}`],
    ["GET", `/status-page-oidc-callback/${ID}/${ID}`],
  ])(
    "browser flow %s %s: the message page",
    async (method: string, path: string) => {
      const answer: HttpAnswer = await request(method, path);

      expect(answer.status).toBe(402);
      expect(JSON.parse(answer.body)).toEqual(
        expect.objectContaining({
          view: MESSAGE_VIEW,
          message: SSO_UNAVAILABLE_MESSAGE,
        }),
      );
      expectNoDatabaseRead();
    },
  );

  test("a mobile login ends on the app's failure deep link", async () => {
    const answer: HttpAnswer = await request(
      "GET",
      `/global-sso/${ID}?mobile=true`,
    );

    expect(answer.status).toBe(302);
    expect(answer.location).not.toBeNull();
    expect(answer.location!.startsWith("oneuptime://sso-callback?")).toBe(true);

    const params: URLSearchParams = new URLSearchParams(
      answer.location!.slice(answer.location!.indexOf("?") + 1),
    );

    expect(params.get("error")).toBe(MOBILE_SSO_UNAVAILABLE_ERROR);
    expect(params.get("errorDescription")).toBe(SSO_UNAVAILABLE_MESSAGE);
    expectNoDatabaseRead();
  });

  test("an unknown path is still a 404 (the gates add no catch-all)", async () => {
    expect((await request("GET", `/scim/v2/${ID}/NoSuchResource`)).status).toBe(
      404,
    );
    expect((await request("GET", "/identity-not-a-route")).status).toBe(404);
  });
});

describe("renewed, or unknown: the same mounted routes reach their handlers again", () => {
  test.each([
    ["renewed (valid)", "valid"],
    ["renewed into grace", "grace"],
    ["not read yet (unknown)", null],
  ])("%s", async (_label: string, status: string | null) => {
    fake.setSnapshot(null);
    fake.setSnapshot(
      status === null
        ? null
        : createLicenseSnapshotWithStatus(status as "valid" | "grace"),
    );

    const scim: HttpAnswer = await request(
      "GET",
      `/scim/v2/${ID}/ServiceProviderConfig`,
    );

    // Reached the SCIM bearer-token check, past the license gate.
    expect(scim.status).not.toBe(403);
    expect(scim.body).toContain(
      "Bearer token is required for SCIM authentication",
    );

    const discovery: HttpAnswer = await request(
      "GET",
      "/service-provider-login",
    );

    // Reached the discovery handler, which wants an email.
    expect(discovery.status).toBe(400);
    expect(discovery.body).toContain("Email is required");
    expectNoDatabaseRead();
  });

  test("lapse and renewal alternate on the same server without a restart", async () => {
    const path: string = `/status-page-scim/v2/${ID}/Users`;

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    expect((await request("GET", path)).status).not.toBe(403);

    fake.setSnapshot(createLicenseSnapshotWithStatus("invalid"));
    expect((await request("GET", path)).status).toBe(403);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));
    expect((await request("GET", path)).body).toContain(
      "Bearer token is required for SCIM authentication",
    );
  });

  test("billing on (the Cloud) ignores the license: the routes are served", async () => {
    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    setTestBillingEnabled(true);

    try {
      const scim: HttpAnswer = await request(
        "GET",
        `/scim/v2/${ID}/ServiceProviderConfig`,
      );

      expect(scim.body).toContain(
        "Bearer token is required for SCIM authentication",
      );
    } finally {
      setTestBillingEnabled(false);
    }
  });
});
