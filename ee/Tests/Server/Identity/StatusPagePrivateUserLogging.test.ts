import {
  buildRequest,
  buildResponse,
  RouteHandler,
} from "App/Tests/FeatureSet/Identity/IdentityRouterTestUtil";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import StatusCode from "Common/Types/API/StatusCode";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import statusPageScimRouter from "../../../Server/Identity/API/StatusPageSCIM";

/*
 * Status page SCIM provisioning logs private-user IDs, never the emails,
 * names or payloads the identity provider sent. The status page SAML and OIDC
 * sign-in half of these checks is core, next to the code it covers:
 * packages/App/Tests/FeatureSet/Identity/StatusPagePrivateUserLogging.test.ts.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    ...jest.requireActual("Common/Server/Utils/Express"),
    __esModule: true,
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): JSONObject => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const emitted: Array<{ body: unknown; attributes?: unknown }> = [];

jest.mock("Common/Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getLogger: (): unknown => {
        return {
          emit: (record: { body: unknown; attributes?: unknown }): void => {
            emitted.push(record);
          },
        };
      },
    },
  };
});

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserFindOneById: jest.Mock = jest.fn();
const privateUserFindBy: jest.Mock = jest.fn();
const privateUserCreate: jest.Mock = jest.fn();
const privateUserUpdate: jest.Mock = jest.fn();
const privateUserDelete: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return privateUserFindOneById(...args);
      },
      findBy: (...args: Array<unknown>): unknown => {
        return privateUserFindBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return privateUserCreate(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return privateUserUpdate(...args);
      },
      deleteOneById: (...args: Array<unknown>): unknown => {
        return privateUserDelete(...args);
      },
    },
  };
});

jest.mock("../../../Server/Identity/Middleware/SCIMAuthorization", () => {
  return {
    __esModule: true,
    default: { isAuthorizedSCIMRequest: jest.fn() },
  };
});

const scimAuditLog: jest.Mock = jest.fn();

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: (...args: Array<unknown>): unknown => {
      return scimAuditLog(...args);
    },
  };
});

const sendJson: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        return sendJson(...args);
      },
    },
  };
});

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PAGE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SCIM_ID: string = "44444444-4444-4444-8444-444444444444";
const EMAIL: string = "private-user-sentinel@example.com";
const OLD_EMAIL: string = "old-private-user-sentinel@example.com";
const DISPLAY_NAME: string = "Personal Display Name Sentinel";
const INVALID_EMAIL: string = "personal-invalid-email-sentinel";
const USERS_ROUTE: string = "/status-page-scim/v2/:statusPageScimId/Users";

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";
const LOG_METHODS: Array<LogMethod> = [
  "info",
  "error",
  "warn",
  "debug",
  "trace",
];
let consoleSpies: Array<jest.SpyInstance> = [];

const makeUser: (email?: string) => unknown = (email: string = EMAIL) => {
  return {
    id: USER_ID,
    email: new Email(email),
    statusPageId: PAGE_ID,
    projectId: PROJECT_ID,
  };
};

interface RegisteredRoute {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RouteHandler }>;
  };
}

const invoke: (
  method: string,
  route: string,
  body?: JSONObject,
  query?: JSONObject,
) => Promise<jest.Mock> = async (
  method: string,
  route: string,
  body: JSONObject = {},
  query: JSONObject = {},
): Promise<jest.Mock> => {
  const req: ExpressRequest = buildRequest(body);
  req.params = {
    statusPageId: PAGE_ID.toString(),
    statusPageScimId: SCIM_ID,
    userId: USER_ID.toString(),
  };
  req.query = query as ExpressRequest["query"];
  req.method = method.toUpperCase();
  (req as OneUptimeRequest).bearerTokenData = {
    statusPageId: PAGE_ID,
    projectId: PROJECT_ID,
    scimConfig: { autoProvisionUsers: true, autoDeprovisionUsers: true },
  };
  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();
  // Express exposes route.methods at runtime but omits it from IRoute's type.
  const registeredRoutes: Array<RegisteredRoute> = [
    ...statusPageScimRouter.stack,
  ] as unknown as Array<RegisteredRoute>;
  const registeredRoute: RegisteredRoute | undefined = registeredRoutes.find(
    (layer: RegisteredRoute) => {
      return layer.route?.path === route && layer.route.methods[method];
    },
  );
  const handlers: Array<{ handle: RouteHandler }> =
    registeredRoute!.route!.stack;
  await handlers[handlers.length - 1]!.handle(req, res, next);
  return next;
};

// Inspect the real logger's stdout, support-bundle ring buffer and telemetry.
const collectLogText: () => string = (): string => {
  return JSON.stringify({
    console: consoleSpies.flatMap((spy: jest.SpyInstance) => {
      return spy.mock.calls;
    }),
    recent: logger.getRecentLogs(),
    telemetry: emitted,
  });
};

const expectNoPersonalData: () => void = (): void => {
  const logText: string = collectLogText();
  const auditSteps: string = JSON.stringify(
    scimAuditLog.mock.calls.map((call: Array<{ steps?: string[] }>) => {
      return call[0]?.steps;
    }),
  );
  for (const value of [EMAIL, OLD_EMAIL, DISPLAY_NAME, INVALID_EMAIL]) {
    expect(logText).not.toContain(value);
    expect(auditSteps).not.toContain(value);
  }
  expect(logText).not.toContain("personalBodyOnlyField");
};

describe("status page private-user logs", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    emitted.length = 0;
    jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);
    consoleSpies = LOG_METHODS.map((method: LogMethod) => {
      return jest.spyOn(console, method).mockImplementation(() => {});
    });
    privateUserFindOneBy.mockResolvedValue(makeUser());
    privateUserFindOneById.mockResolvedValue(makeUser());
    privateUserFindBy.mockResolvedValue([makeUser()]);
    privateUserCreate.mockResolvedValue(makeUser());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "does not log SCIM create payloads or emails (new user: %s)",
    async (isNewUser: boolean) => {
      privateUserFindOneBy.mockResolvedValue(isNewUser ? null : makeUser());
      const next: jest.Mock = await invoke("post", USERS_ROUTE, {
        userName: EMAIL,
        name: { formatted: DISPLAY_NAME },
        personalBodyOnlyField: "arbitrary IdP user data",
      });
      expect(next).not.toHaveBeenCalled();
      expect(sendJson).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ userName: EMAIL }),
        { statusCode: new StatusCode(201) },
      );
      expect(collectLogText()).toContain("Status Page SCIM Create user");
      expectNoPersonalData();
    },
  );

  it.each(["put", "patch"])(
    "does not log SCIM %s payloads or old/new emails",
    async (method: string) => {
      privateUserFindOneBy.mockResolvedValue(makeUser(OLD_EMAIL));
      const next: jest.Mock = await invoke(method, `${USERS_ROUTE}/:userId`, {
        emails: [{ value: EMAIL }],
        active: true,
        personalBodyOnlyField: DISPLAY_NAME,
      });
      expect(next).not.toHaveBeenCalled();
      expect(privateUserUpdate).toHaveBeenCalledTimes(1);
      expect(sendJson).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ userName: EMAIL }),
      );
      expect(collectLogText()).toContain(`userId: ${USER_ID}`);
      expectNoPersonalData();
    },
  );

  it.each([
    `userName eq "${EMAIL}"`,
    `userName eq "${INVALID_EMAIL}"`,
    `displayName eq "${DISPLAY_NAME}"`,
  ])("does not log raw SCIM list filters: %s", async (filter: string) => {
    const next: jest.Mock = await invoke("get", USERS_ROUTE, {}, { filter });
    expect(next).not.toHaveBeenCalled();
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(collectLogText()).toContain("filter provided: true");
    expectNoPersonalData();
  });

  it("does not log arbitrary personal data supplied as SCIM active", async () => {
    const next: jest.Mock = await invoke("patch", `${USERS_ROUTE}/:userId`, {
      userName: EMAIL,
      active: DISPLAY_NAME,
    });
    expect(next).not.toHaveBeenCalled();
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(collectLogText()).toContain("active: not provided");
    expectNoPersonalData();
  });

  it.each(["get", "delete"])(
    "uses the private-user ID in SCIM %s audit steps",
    async (method: string) => {
      const next: jest.Mock = await invoke(method, `${USERS_ROUTE}/:userId`);
      expect(next).not.toHaveBeenCalled();
      expect(scimAuditLog).toHaveBeenCalledTimes(1);
      expectNoPersonalData();
    },
  );

  it("keeps SCIM bulk create, update and delete execution steps free of emails", async () => {
    privateUserFindOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeUser(OLD_EMAIL))
      .mockResolvedValueOnce(makeUser());
    const next: jest.Mock = await invoke(
      "post",
      "/status-page-scim/v2/:statusPageScimId/Bulk",
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
        Operations: [
          {
            method: "POST",
            path: "/Users",
            bulkId: "new",
            data: { userName: EMAIL },
          },
          {
            method: "PUT",
            path: `/Users/${USER_ID}`,
            data: { userName: EMAIL },
          },
          { method: "DELETE", path: `/Users/${USER_ID}` },
        ],
      },
    );
    expect(next).not.toHaveBeenCalled();
    expect(privateUserCreate).toHaveBeenCalledTimes(1);
    expect(privateUserUpdate).toHaveBeenCalledTimes(1);
    expect(privateUserDelete).toHaveBeenCalledTimes(1);
    expectNoPersonalData();
  });

  it.each(["post", "put", "patch"])(
    "does not echo invalid email input through SCIM %s errors",
    async (method: string) => {
      privateUserFindOneBy.mockResolvedValue(makeUser(OLD_EMAIL));
      const next: jest.Mock = await invoke(
        method,
        method === "post" ? USERS_ROUTE : `${USERS_ROUTE}/:userId`,
        { userName: INVALID_EMAIL },
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Email is not in valid format" }),
      );
      expect(privateUserCreate).not.toHaveBeenCalled();
      expect(privateUserUpdate).not.toHaveBeenCalled();
      expect(collectLogText()).toContain("Email is not in valid format");
      expectNoPersonalData();
    },
  );

  it.each(["POST", "PUT", "PATCH"])(
    "does not echo invalid email input through SCIM bulk %s errors",
    async (method: string) => {
      const next: jest.Mock = await invoke(
        "post",
        "/status-page-scim/v2/:statusPageScimId/Bulk",
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
          Operations: [
            {
              method,
              path: method === "POST" ? "/Users" : `/Users/${USER_ID}`,
              bulkId: "user",
              data: { userName: INVALID_EMAIL },
            },
          ],
        },
      );
      expect(next).not.toHaveBeenCalled();
      expect(sendJson).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          Operations: [expect.objectContaining({ status: "400" })],
        }),
      );
      expect(privateUserCreate).not.toHaveBeenCalled();
      expect(privateUserUpdate).not.toHaveBeenCalled();
      expectNoPersonalData();
    },
  );
});
