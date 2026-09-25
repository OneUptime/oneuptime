import { beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../Server/Identity/API/SSO";
import OIDCRouter from "../../../Server/Identity/API/OIDC";
import GlobalSSORouter from "../../../Server/Identity/API/GlobalSSO";
import GlobalOIDCRouter from "../../../Server/Identity/API/GlobalOIDC";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";

/*
 * ---------------------------------------------------------------------------
 * A USER BLOCKED BY A MASTER ADMIN CANNOT SIGN IN THROUGH SSO EITHER.
 *
 * The four identity-provider callbacks -- project SAML, project OIDC, Global
 * SAML and Global OIDC -- each look the user up by the email the provider
 * vouched for, provision them into teams, and mint a session. None of them
 * read `User.isBlocked`, so blocking a user did nothing to stop them signing
 * straight back in through their company's IdP.
 *
 * Each callback is run through its real handler (the license gate in front of
 * it is IdentityLicenseGates.test.ts). The provider side is stubbed at the
 * utility boundary -- the SAML signature check and the OIDC code exchange --
 * so the assertion that arrives is a genuine, verified identity. UserService
 * lookups honour `select`, so a callback that stops selecting isBlocked reads
 * it as undefined and these tests fail rather than pass.
 * ---------------------------------------------------------------------------
 */

const USER_EMAIL: string = "blocked.user@example.com";
const USER_ID: string = "88888888-8888-4888-8888-888888888888";
const PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const PROVIDER_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ISSUER: string = "https://idp.example.com/metadata";

let storedRow: Record<string, unknown> = {};

const userFindOneBy: jest.Mock = jest.fn();
const userCreateByEmail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      createByEmail: (...args: Array<unknown>): unknown => {
        return userCreateByEmail(...args);
      },
    },
  };
});

const createSession: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
    },
  };
});

const teamMemberCountBy: jest.Mock = jest.fn();
const teamMemberCreate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return teamMemberCreate(...args);
      },
      findBy: jest.fn(),
    },
  };
});

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

/*
 * On the hosted service a project's SSO needs the account's consent before it
 * may sign it in (ProjectSsoSignInConfirmation.test.ts). Given here, so that
 * the block is the only thing deciding these tests.
 */
jest.mock("Common/Server/Services/UserProjectSsoConsentService", () => {
  return {
    __esModule: true,
    default: {
      hasConsent: (): Promise<boolean> => {
        return Promise.resolve(true);
      },
      recordConsent: jest.fn(),
    },
  };
});

const providerFindOneBy: jest.Mock = jest.fn();
const attachmentsFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return providerFindOneBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalSsoProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return attachmentsFindBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/GlobalOidcProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return attachmentsFindBy(...args);
      },
    },
  };
});

// A signature that verified: the identity below is what the IdP asserted.
jest.mock("../../../Server/Identity/Utils/SSO", () => {
  return {
    __esModule: true,
    default: {
      getSamlResponseFromXML: (): unknown => {
        const identity: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return {
          issuerUrl: "https://idp.example.com/metadata",
          email: new identity.default("blocked.user@example.com"),
          name: null,
        };
      },
      createSAMLRequestUrl: jest.fn(),
    },
  };
});

// A code exchange that succeeded, with an ID token that validated.
jest.mock("../../../Server/Identity/Utils/OIDC", () => {
  return {
    __esModule: true,
    default: {
      createClient: (): Promise<unknown> => {
        return Promise.resolve({});
      },
      exchangeCodeAndValidate: (): Promise<unknown> => {
        const identity: typeof import("Common/Types/Email") =
          jest.requireActual("Common/Types/Email");

        return Promise.resolve({
          email: new identity.default("blocked.user@example.com"),
          name: null,
        });
      },
    },
  };
});

jest.mock("App/FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

const setUserCookie: jest.Mock = jest.fn();
const setSSOCookie: jest.Mock = jest.fn();
const setGlobalSSOCookie: jest.Mock = jest.fn();

/*
 * The OIDC callbacks read their signed state from a cookie; any state cookie
 * is present here. The mobile-intent cookie is absent, so "mobile" is decided
 * by the request itself.
 */
jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (
        _req: unknown,
        name: string,
      ): string | undefined => {
        return name.includes("oidc-state-") ? "signed-state" : undefined;
      },
      removeCookie: jest.fn(),
      setCookie: jest.fn(),
      setUserCookie: (...args: Array<unknown>): unknown => {
        return setUserCookie(...args);
      },
      setSSOCookie: (...args: Array<unknown>): unknown => {
        return setSSOCookie(...args);
      },
      setGlobalSSOCookie: (...args: Array<unknown>): unknown => {
        return setGlobalSSOCookie(...args);
      },
      getSSOToken: (): string => {
        return "sso-token";
      },
      getGlobalSSOToken: (): string => {
        return "global-sso-token";
      },
    },
  };
});

let oidcStateIsMobile: boolean = false;
const signUserLoginToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      decodeJsonPayload: (): JSONObject => {
        return {
          state: "state",
          nonce: "nonce",
          codeVerifier: "code-verifier",
          isMobile: oidcStateIsMobile,
        };
      },
      signJsonPayload: (): string => {
        return "signed-state";
      },
      signUserLoginToken: (...args: Array<unknown>): unknown => {
        return signUserLoginToken(...args);
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const render: jest.Mock = jest.fn();
const sendErrorResponse: jest.Mock = jest.fn();
const responseRedirect: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      render: (...args: Array<unknown>): unknown => {
        return render(...args);
      },
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      redirect: (...args: Array<unknown>): unknown => {
        return responseRedirect(...args);
      },
    },
  };
});

// Express 4 keeps these on each stack layer; its typings leave them out.
interface RouteLayer {
  route?:
    | {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ handle: RequestHandler }>;
      }
    | undefined;
}

// The route's own handler: the last one, after the license gate.
function handlerFor(
  router: ExpressRouter,
  method: string,
  path: string,
): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path &&
      Boolean(candidate.route.methods[method.toLowerCase()])
    );
  });

  if (!layer?.route) {
    throw new Error(`${method} ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

type Flow = {
  name: string;
  router: ExpressRouter;
  method: string;
  path: string;
  params: Record<string, string>;
  isGlobal: boolean;
  request: (data: { isMobile: boolean }) => {
    body: JSONObject;
    query: JSONObject;
  };
};

const SAML_BODY: (isMobile: boolean) => JSONObject = (
  isMobile: boolean,
): JSONObject => {
  return {
    SAMLResponse: Buffer.from("<Response/>").toString("base64"),
    ...(isMobile ? { RelayState: "mobile" } : {}),
  };
};

const FLOWS: Array<Flow> = [
  {
    name: "project SAML (/idp-login)",
    router: SSORouter,
    method: "POST",
    path: "/idp-login/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROVIDER_ID },
    isGlobal: false,
    request: (data: { isMobile: boolean }) => {
      return { body: SAML_BODY(data.isMobile), query: {} };
    },
  },
  {
    name: "project OIDC (/oidc-callback)",
    router: OIDCRouter,
    method: "GET",
    path: "/oidc-callback/:projectId/:projectOidcId",
    params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
    isGlobal: false,
    request: () => {
      return { body: {}, query: { code: "code", state: "state" } };
    },
  },
  {
    name: "Global SAML (/global-idp-login)",
    router: GlobalSSORouter,
    method: "POST",
    path: "/global-idp-login/:globalSsoId",
    params: { globalSsoId: PROVIDER_ID },
    isGlobal: true,
    request: (data: { isMobile: boolean }) => {
      return { body: SAML_BODY(data.isMobile), query: {} };
    },
  },
  {
    name: "Global OIDC (/global-oidc-callback)",
    router: GlobalOIDCRouter,
    method: "GET",
    path: "/global-oidc-callback/:globalOidcId",
    params: { globalOidcId: PROVIDER_ID },
    isGlobal: true,
    request: () => {
      return { body: {}, query: { code: "code", state: "state" } };
    },
  },
];

type RunResult = { nextError: unknown };

// res.redirect: where the mobile flows send the app its deep link.
const resRedirect: jest.Mock = jest.fn();

async function runFlow(
  flow: Flow,
  data: { isMobile: boolean },
): Promise<RunResult> {
  const { body, query } = flow.request(data);

  // The OIDC flows carry "mobile" in their signed state cookie.
  oidcStateIsMobile = data.isMobile;

  const req: ExpressRequest = {
    params: flow.params,
    body,
    query,
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: resRedirect,
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  const handler: RequestHandler = handlerFor(
    flow.router,
    flow.method,
    flow.path,
  );

  await (handler(req, res, (err?: unknown): void => {
    nextError = err;
  }) as unknown as Promise<void>);

  return { nextError };
}

function storeUser(data: { isBlocked: boolean }): void {
  storedRow = {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Blocked User",
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: data.isBlocked,
    timezone: null,
  };
}

function projectOntoSelect(select: Record<string, unknown>): User {
  const user: Record<string, unknown> = new User() as unknown as Record<
    string,
    unknown
  >;

  for (const column of Object.keys(select)) {
    if (select[column] && storedRow[column] !== undefined) {
      user[column] = storedRow[column];
    }
  }

  return user as unknown as User;
}

// Nothing a sign-in hands out, and nothing provisioned on the way to it.
function expectNoSessionAndNothingProvisioned(): void {
  expect(createSession).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(setGlobalSSOCookie).not.toHaveBeenCalled();
  expect(teamMemberCreate).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
}

beforeEach(() => {
  jest.clearAllMocks();
  oidcStateIsMobile = false;

  storeUser({ isBlocked: false });

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(projectOntoSelect(data.select));
  });

  providerFindOneBy.mockResolvedValue({
    id: new ObjectID(PROVIDER_ID),
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    publicCertificate: "certificate",
    discoveryURL: "https://idp.example.com/.well-known/openid-configuration",
    clientId: "client-id",
    clientSecret: "client-secret",
    teams: [{ id: new ObjectID(TEAM_ID) }],
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
  });

  // An attached project with a default team, so provisioning would run.
  attachmentsFindBy.mockResolvedValue([
    {
      projectId: new ObjectID(PROJECT_ID),
      teams: [{ id: new ObjectID(TEAM_ID) }],
    },
  ]);

  // Not yet a member of the project, for the same reason.
  teamMemberCountBy.mockResolvedValue(new PositiveNumber(0));
  teamMemberCreate.mockResolvedValue({});

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
  signUserLoginToken.mockReturnValue("signed-user-token");
});

describe.each(FLOWS)("$name — a blocked user", (flow: Flow) => {
  test("is shown the blocked-account page and given no session", async () => {
    storeUser({ isBlocked: true });

    const result: RunResult = await runFlow(flow, { isMobile: false });

    expect(result.nextError).toBeUndefined();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![3]).toEqual({
      title: "Account blocked.",
      message: ExceptionMessages.UserBlocked,
    });

    expectNoSessionAndNothingProvisioned();
    expect(resRedirect).not.toHaveBeenCalled();
    expect(responseRedirect).not.toHaveBeenCalled();
  });

  test("selects isBlocked when it looks the user up", async () => {
    storeUser({ isBlocked: true });

    await runFlow(flow, { isMobile: false });

    const select: JSONObject = (
      userFindOneBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select["isBlocked"]).toBe(true);
  });
});

describe.each(
  FLOWS.filter((flow: Flow) => {
    return flow.isGlobal;
  }),
)("$name — a blocked user signing in from the mobile app", (flow: Flow) => {
  /*
   * The Global flows end every mobile login on the app's deep link, so the
   * app can tell the user why instead of reporting a cancelled sign-in.
   */
  test("is sent back to the app with account_blocked and no tokens", async () => {
    storeUser({ isBlocked: true });

    await runFlow(flow, { isMobile: true });

    expect(resRedirect).toHaveBeenCalledTimes(1);

    const deepLink: string = resRedirect.mock.calls[0]![0] as string;
    const params: URLSearchParams = new URLSearchParams(
      deepLink.split("?")[1] || "",
    );

    expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);
    expect(params.get("error")).toBe("account_blocked");
    expect(params.get("errorDescription")).toBe(ExceptionMessages.UserBlocked);
    expect(params.get("accessToken")).toBeNull();
    expect(params.get("refreshToken")).toBeNull();

    expect(render).not.toHaveBeenCalled();
    expectNoSessionAndNothingProvisioned();
  });
});

describe.each(FLOWS)("$name — a user who is not blocked", (flow: Flow) => {
  // The control: the same request, one column different, does sign in.
  test("still signs in", async () => {
    storeUser({ isBlocked: false });

    // Already a member, so the Global flows have a project to sign in to.
    teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));

    const result: RunResult = await runFlow(flow, { isMobile: false });

    expect(result.nextError).toBeUndefined();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setUserCookie).toHaveBeenCalledTimes(1);
    expect(responseRedirect).toHaveBeenCalledTimes(1);
  });
});
