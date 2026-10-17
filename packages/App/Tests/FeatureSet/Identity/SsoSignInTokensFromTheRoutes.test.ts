import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
  signElement,
  toBase64,
} from "./SamlTestKit";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import CookieUtil from "Common/Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import JSONWebToken, { PURPOSE_CLAIM } from "Common/Server/Utils/JsonWebToken";
import User from "Common/Models/DatabaseModels/User";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import JsonWebTokenPurpose from "Common/Types/JsonWebTokenPurpose";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * ---------------------------------------------------------------------------
 * WHAT A SAML SIGN-IN HANDS OUT: A SESSION, AND AN SSO SIGN-IN THAT IS NONE.
 *
 * A sign-in through a project's SAML provider, or through the server's
 * Global SAML provider, hands out two tokens - to a browser as cookies, to
 * the mobile app on its deep link:
 *
 *   - a session: the access token of the UserSession the sign-in made,
 *     which the API takes as the person for fifteen minutes and the
 *     session's refresh token renews;
 *   - an SSO sign-in: thirty days of proof that the person signed in
 *     through that provider, which a project that requires SSO reads next
 *     to the person's session - and which is no session at all.
 *
 * Each sign-in here runs through its real route handler, with a response
 * signed at run time by a generated identity provider key, the real
 * SSOUtil checking it, and the real CookieUtil and JSONWebToken minting the
 * tokens. Only the database, the cache and the response writers are
 * stand-ins. What the route handed out is then read the way the API reads a
 * request (UserMiddleware).
 * ---------------------------------------------------------------------------
 */

const HOST: string = "oneuptime.example.com";
const SERVER: string = `https://${HOST}`;

const ISSUER: string = "https://idp.example.com/realms/acme";
const USER_EMAIL: string = "fox.mulder@example.com";
const USER_ID: string = "1abc0000-0000-4000-8000-0000000000f1";
const TEAM_ID: string = "1abc0000-0000-4000-8000-0000000000f2";
const SESSION_ID: string = "1abc0000-0000-4000-8000-0000000000f3";

const PROJECT_ID: string = "2bcd0000-0000-4000-8000-0000000000a1";
const PROJECT_SSO_ID: string = "2bcd0000-0000-4000-8000-0000000000b2";
const GLOBAL_SSO_ID: string = "4fab0000-0000-4000-8000-0000000000e1";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const environment: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  environment["Host"] = "oneuptime.example.com";
  environment["HttpProtocol"] = "https://";

  return environment;
});

// The cache that remembers which responses were used: SET NX, in memory.
const cacheEntries: Set<string> = new Set();

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: (namespace: string, key: string): unknown => {
        const fullKey: string = `${namespace}-${key}`;

        if (cacheEntries.has(fullKey)) {
          return Promise.resolve(false);
        }

        cacheEntries.add(fullKey);
        return Promise.resolve(true);
      },
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      createByEmail: jest.fn(),
      // Nobody here is blocked.
      isUserBlocked: (): Promise<boolean> => {
        return Promise.resolve(false);
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

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      // Already a member of the project: nobody joins a team here.
      countBy: (): Promise<PositiveNumber> => {
        return Promise.resolve(new PositiveNumber(1));
      },
      create: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: jest.fn(),
    },
  };
});

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

const projectSsoFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return projectSsoFindOneBy(...args);
      },
    },
  };
});

const globalSsoFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/GlobalSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return globalSsoFindOneBy(...args);
      },
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalSsoProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Promise<unknown> => {
        return Promise.resolve([
          {
            projectId: new (
              jest.requireActual("Common/Types/ObjectID") as {
                default: typeof ObjectID;
              }
            ).default("2bcd0000-0000-4000-8000-0000000000a1"),
            teams: [],
          },
        ]);
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "oneuptime.example.com";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "https://";
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
      setNoCacheHeaders: jest.fn(),
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

function handlerFor(router: ExpressRouter, path: string): RequestHandler {
  const layers: Array<RouteLayer> = (
    router as unknown as { stack: Array<RouteLayer> }
  ).stack;

  const layer: RouteLayer | undefined = layers.find((candidate: RouteLayer) => {
    return (
      candidate.route?.path === path && Boolean(candidate.route.methods["post"])
    );
  });

  if (!layer?.route) {
    throw new Error(`POST ${path} is not registered`);
  }

  return layer.route.stack[layer.route.stack.length - 1]!.handle;
}

interface Flow {
  name: string;
  router: ExpressRouter;
  path: string;
  params: Record<string, string>;
  entityId: string;
  replyUrl: string;
  providerId: string;
  providerType: SsoProviderType;
  // The cookie the SSO sign-in is set in, and the deep link parameter it rides in.
  ssoCookieName: string;
  deepLinkParameter: string;
}

const FLOWS: Array<Flow> = [
  {
    name: "a project SAML sign-in",
    router: SSORouter,
    path: "/idp-login/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROJECT_SSO_ID },
    entityId: `${SERVER}/${PROJECT_ID}/${PROJECT_SSO_ID}`,
    replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROJECT_SSO_ID}`,
    providerId: PROJECT_SSO_ID,
    providerType: SsoProviderType.ProjectSSO,
    ssoCookieName: CookieUtil.getUserSSOKey(new ObjectID(PROJECT_ID)),
    deepLinkParameter: "ssoToken",
  },
  {
    name: "a Global SAML sign-in",
    router: GlobalSSORouter,
    path: "/global-idp-login/:globalSsoId",
    params: { globalSsoId: GLOBAL_SSO_ID },
    entityId: `${SERVER}/global-sso/${GLOBAL_SSO_ID}`,
    replyUrl: `${SERVER}/identity/global-idp-login/${GLOBAL_SSO_ID}`,
    providerId: GLOBAL_SSO_ID,
    providerType: SsoProviderType.GlobalSSO,
    ssoCookieName: CookieUtil.getGlobalSSOKey(),
    deepLinkParameter: "globalSsoToken",
  },
];

let idpKeys: SamlKeyPair;
let responseCounter: number = 0;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

function signedResponse(flow: Flow): string {
  responseCounter++;

  return toBase64(
    signElement(
      buildSamlResponse({
        issuer: ISSUER,
        email: USER_EMAIL,
        issuedAt: minutesAfter(new Date(), 0),
        responseId: `_response_${responseCounter}`,
        assertionId: `_assertion_${responseCounter}`,
        audienceRestrictions: [[flow.entityId]],
        recipient: flow.replyUrl,
        destination: flow.replyUrl,
        inResponseTo: "_request_1",
      }),
      "Assertion",
      idpKeys.privateKey,
    ),
  );
}

interface SignIn {
  cookies: Dictionary<string>;
  deepLink: URLSearchParams | null;
}

// Signs in through the flow's Reply URL, from a browser or from the mobile app.
async function signIn(
  flow: Flow,
  from: "browser" | "mobile app",
): Promise<SignIn> {
  const cookies: Dictionary<string> = {};
  const resRedirect: jest.Mock = jest.fn();

  const req: ExpressRequest = {
    params: flow.params,
    body: {
      SAMLResponse: signedResponse(flow),
      ...(from === "mobile app" ? { RelayState: "mobile" } : {}),
    },
    query: {},
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: resRedirect,
    status: jest.fn(() => {
      return res;
    }),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string) => {
      cookies[name] = value;
      return res;
    }),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(flow.router, flow.path)(req, res, (err?: unknown): void => {
    nextError = err;
  }) as unknown as Promise<void>);

  expect(nextError).toBeUndefined();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(createSession).toHaveBeenCalledTimes(1);

  let deepLink: URLSearchParams | null = null;

  if (from === "mobile app") {
    expect(resRedirect).toHaveBeenCalledTimes(1);

    const link: string = resRedirect.mock.calls[0]![0] as string;

    expect(link.startsWith("oneuptime://sso-callback?")).toBe(true);
    deepLink = new URLSearchParams(link.split("?")[1] || "");
  }

  return { cookies, deepLink };
}

// A request that carries `token` the way the API reads a session.
function requestCarrying(
  token: string,
  carrier: "cookie" | "bearer",
  extra: { cookies?: Dictionary<string>; headers?: Dictionary<string> } = {},
): ExpressRequest {
  return {
    params: {},
    query: {},
    body: {},
    cookies: {
      ...(carrier === "cookie"
        ? { [CookieUtil.getUserTokenKey()]: token }
        : {}),
      ...(extra.cookies || {}),
    },
    headers: {
      ...(carrier === "bearer" ? { authorization: `Bearer ${token}` } : {}),
      ...(extra.headers || {}),
    },
  } as unknown as ExpressRequest;
}

async function readAsSession(token: string): Promise<Array<string>> {
  const kinds: Array<string> = [];

  for (const carrier of ["cookie", "bearer"] as const) {
    const read: RequestSession = await UserMiddleware.readRequestSession(
      requestCarrying(token, carrier),
    );

    kinds.push(read.kind);
  }

  return kinds;
}

function existingUser(): User {
  const user: User = new User();
  user.id = new ObjectID(USER_ID);
  user.email = new Email(USER_EMAIL);
  user.isMasterAdmin = false;
  user.isEmailVerified = true;
  user.isBlocked = false;
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
  cacheEntries.clear();
  setTestBillingEnabled(false);

  userFindOneBy.mockResolvedValue(existingUser());

  const provider: JSONObject = {
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    teams: [{ id: new ObjectID(TEAM_ID) }],
  };

  projectSsoFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ...provider,
      id: new ObjectID(PROJECT_SSO_ID),
      projectId: new ObjectID(PROJECT_ID),
      publicCertificate: idpKeys.publicKey,
    });
  });

  globalSsoFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ...provider,
      id: new ObjectID(GLOBAL_SSO_ID),
      publicCertificate: idpKeys.publicKey,
      disableSignUpWithSso: false,
      restrictToAttachedProjects: false,
    });
  });

  createSession.mockResolvedValue({
    session: { id: new ObjectID(SESSION_ID) },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
});

describe.each(FLOWS)("$name", (flow: Flow) => {
  test("from a browser, sets a session the API takes as the person", async () => {
    const { cookies } = await signIn(flow, "browser");
    const session: string | undefined = cookies[CookieUtil.getUserTokenKey()];

    expect(session).toBeDefined();
    expect(JSONWebToken.decodeJsonPayload(session!)).toEqual(
      expect.objectContaining({
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
        userId: USER_ID,
        sessionId: SESSION_ID,
      }),
    );
    expect(await readAsSession(session!)).toEqual(["user", "user"]);
  });

  test("from a browser, sets an SSO sign-in that is no session, sent as the access-token cookie or a bearer token", async () => {
    const { cookies } = await signIn(flow, "browser");
    const ssoSignIn: string | undefined = cookies[flow.ssoCookieName];

    expect(ssoSignIn).toBeDefined();
    expect(JSONWebToken.decodeJsonPayload(ssoSignIn!)).toEqual(
      expect.objectContaining({
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.SsoSignIn,
        userId: USER_ID,
        ssoProviderId: flow.providerId,
        ssoProviderType: flow.providerType,
      }),
    );
    expect(await readAsSession(ssoSignIn!)).toEqual(["invalid", "invalid"]);
  });

  test("from a browser, the SSO sign-in is read as one next to the person's session, in its own cookie", async () => {
    const { cookies } = await signIn(flow, "browser");

    const req: ExpressRequest = requestCarrying(
      cookies[CookieUtil.getUserTokenKey()]!,
      "cookie",
      { cookies: { [flow.ssoCookieName]: cookies[flow.ssoCookieName]! } },
    );

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        req,
        new ObjectID(PROJECT_ID),
        new ObjectID(USER_ID),
        new ObjectID(flow.providerId),
      ),
    ).toBe(true);
  });

  test("from the mobile app, hands it a session on its deep link that the API takes as the person", async () => {
    const { deepLink } = await signIn(flow, "mobile app");
    const accessToken: string | null = deepLink!.get("accessToken");

    expect(accessToken).not.toBeNull();
    expect(JSONWebToken.decodeJsonPayload(accessToken!)[PURPOSE_CLAIM]).toBe(
      JsonWebTokenPurpose.UserSession,
    );
    expect(await readAsSession(accessToken!)).toEqual(["user", "user"]);
  });

  test("from the mobile app, hands it an SSO sign-in that is no session, and that its header carries as one", async () => {
    const { deepLink } = await signIn(flow, "mobile app");
    const ssoSignIn: string | null = deepLink!.get(flow.deepLinkParameter);
    const accessToken: string = deepLink!.get("accessToken")!;

    expect(ssoSignIn).not.toBeNull();
    expect(JSONWebToken.decodeJsonPayload(ssoSignIn!)[PURPOSE_CLAIM]).toBe(
      JsonWebTokenPurpose.SsoSignIn,
    );
    expect(await readAsSession(ssoSignIn!)).toEqual(["invalid", "invalid"]);

    // The headers the mobile app sends it in (api/client.ts).
    const header: Dictionary<string> =
      flow.providerType === SsoProviderType.GlobalSSO
        ? { "x-global-sso-token": ssoSignIn! }
        : { "x-sso-tokens": JSON.stringify({ [PROJECT_ID]: ssoSignIn! }) };

    expect(
      UserMiddleware.doesSsoTokenForProjectExist(
        requestCarrying(accessToken, "bearer", { headers: header }),
        new ObjectID(PROJECT_ID),
        new ObjectID(USER_ID),
        new ObjectID(flow.providerId),
      ),
    ).toBe(true);
  });
});
