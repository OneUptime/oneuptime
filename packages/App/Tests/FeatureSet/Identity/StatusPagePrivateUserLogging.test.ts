import {
  buildRequest,
  buildResponse,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import statusPageOidcRouter from "../../../FeatureSet/Identity/API/StatusPageOIDC";
import statusPageSsoRouter from "../../../FeatureSet/Identity/API/StatusPageSSO";

/*
 * Status page SAML and OIDC sign-in log the private user's ID, never the
 * address the identity provider asserted, a display name or the assertion
 * itself. The SCIM half of these checks (status page SCIM provisioning) is
 * Enterprise Edition code and lives in
 * ee/Tests/Server/Identity/StatusPagePrivateUserLogging.test.ts.
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
const privateUserCreate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return privateUserCreate(...args);
      },
    },
  };
});

const providerFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPageOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPageSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

const createLoginCodeSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createLoginCodeSession: (...args: Array<unknown>): unknown => {
        return createLoginCodeSession(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      getStatusPageFirstURL: async (): Promise<string> => {
        return "https://status.example.com";
      },
    },
  };
});

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (): string => {
        return "signed-state-cookie";
      },
      removeCookie: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      decodeJsonPayload: (): JSONObject => {
        return { state: "state", nonce: "nonce", codeVerifier: "verifier" };
      },
    },
  };
});

const oidcExchange: jest.Mock = jest.fn();
const samlVerify: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/OIDC", () => {
  return {
    __esModule: true,
    default: {
      createClient: jest.fn(),
      exchangeCodeAndValidate: (...args: Array<unknown>): unknown => {
        return oidcExchange(...args);
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/SSO", () => {
  return {
    __esModule: true,
    default: {
      getSamlResponseFromXML: (...args: Array<unknown>): unknown => {
        return samlVerify(...args);
      },
    },
  };
});

const redirect: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
      redirect: (...args: Array<unknown>): unknown => {
        return redirect(...args);
      },
    },
  };
});

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PAGE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROVIDER_ID: string = "44444444-4444-4444-8444-444444444444";
const EMAIL: string = "private-user-sentinel@example.com";
const DISPLAY_NAME: string = "Personal Display Name Sentinel";

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";
const LOG_METHODS: Array<LogMethod> = [
  "info",
  "error",
  "warn",
  "debug",
  "trace",
];
let consoleSpies: Array<jest.SpyInstance> = [];

const makeUser: () => unknown = () => {
  return {
    id: USER_ID,
    email: new Email(EMAIL),
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
) => Promise<jest.Mock> = async (
  method: string,
  route: string,
  body: JSONObject = {},
): Promise<jest.Mock> => {
  const req: ExpressRequest = buildRequest(body);
  req.params = {
    statusPageId: PAGE_ID.toString(),
    statusPageOidcId: PROVIDER_ID,
    statusPageSsoId: PROVIDER_ID,
  };
  req.query = {} as ExpressRequest["query"];
  req.method = method.toUpperCase();
  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();
  // Express exposes route.methods at runtime but omits it from IRoute's type.
  const registeredRoutes: Array<RegisteredRoute> = [
    ...statusPageOidcRouter.stack,
    ...statusPageSsoRouter.stack,
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
  for (const value of [EMAIL, DISPLAY_NAME]) {
    expect(logText).not.toContain(value);
  }
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
    privateUserCreate.mockResolvedValue(makeUser());
    providerFindOneBy.mockResolvedValue({
      projectId: PROJECT_ID,
      discoveryURL: "https://idp.example.com/.well-known/openid-configuration",
      issuerURL: "https://idp.example.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      signOnURL: "https://idp.example.com/login",
      publicCertificate: "certificate",
    });
    oidcExchange.mockResolvedValue({
      email: new Email(EMAIL),
      name: DISPLAY_NAME,
      rawClaims: { email: EMAIL, name: DISPLAY_NAME },
    });
    samlVerify.mockReturnValue({
      issuerUrl: "https://idp.example.com",
      email: new Email(EMAIL),
    });
    createLoginCodeSession.mockResolvedValue({ refreshToken: "login-code" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([false, true])(
    "logs the saved private-user ID on OIDC sign-in at INFO (new user: %s)",
    async (isNewUser: boolean) => {
      jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.INFO);
      privateUserFindOneBy.mockResolvedValue(isNewUser ? null : makeUser());
      const next: jest.Mock = await invoke(
        "get",
        "/status-page-oidc-callback/:statusPageId/:statusPageOidcId",
      );
      expect(next).not.toHaveBeenCalled();
      expect(privateUserCreate).toHaveBeenCalledTimes(isNewUser ? 1 : 0);
      expect(createLoginCodeSession).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(collectLogText()).toContain(
        `Status page user logged in with OIDC: ${USER_ID}`,
      );
      expectNoPersonalData();
    },
  );

  it.each([false, true])(
    "does not log private-user identity or assertions on SAML sign-in (new user: %s)",
    async (isNewUser: boolean) => {
      privateUserFindOneBy.mockResolvedValue(isNewUser ? null : makeUser());
      const next: jest.Mock = await invoke(
        "post",
        "/status-page-idp-login/:statusPageId/:statusPageSsoId",
        {
          SAMLResponse: Buffer.from(`${EMAIL} ${DISPLAY_NAME}`).toString(
            "base64",
          ),
        },
      );
      expect(next).not.toHaveBeenCalled();
      expect(samlVerify).toHaveBeenCalledTimes(1);
      expect(privateUserCreate).toHaveBeenCalledTimes(isNewUser ? 1 : 0);
      expect(createLoginCodeSession).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledTimes(1);
      expectNoPersonalData();
    },
  );
});
