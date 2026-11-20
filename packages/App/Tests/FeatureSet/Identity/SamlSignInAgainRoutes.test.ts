import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  signElement,
  toBase64,
} from "./SamlTestKit";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import {
  REAUTHENTICATE_QUERY_PARAM,
  SignInAgainRefusal,
} from "Common/Types/Accounts/Reauthentication";
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  SessionSignIn,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * SIGN IN AGAIN THROUGH A SAML PROVIDER, AT ITS ROUTES (#10217).
 *
 * The prompt sends an account that signs in only with single sign-on to its
 * own provider's start - /sso/:projectId/:projectSsoId, or
 * /global-sso/:globalSsoId - with ?reauthenticate=true. Pinned here, through
 * the real routes, with the identity provider's answers signed as it signs
 * them:
 *
 *   - the start sends the browser to the identity provider with
 *     ForceAuthn="true" and an ID of Sign In Again's, and only then: not for
 *     a sign-in, nor for the mobile app;
 *   - the Reply URL signs the person in either way, and keeps with the new
 *     session what the response proved: confirmed from the AuthnInstant
 *     when the provider authenticated them after they were sent; refused as
 *     a reused session when it did not; nothing at all for any other
 *     sign-in;
 *   - a Sign In Again whose provider was since turned off or deleted goes
 *     to the sign-in page; a sign-in through it is refused as it was.
 *
 * What a response proves, case by case, is in SignInAgain.test.ts.
 * ---------------------------------------------------------------------------
 */

const HOST: string = "oneuptime.example.com";
const SERVER: string = `https://${HOST}`;
const ISSUER: string = "https://idp.example.com/realms/acme";
const USER_EMAIL: string = "dana.scully@example.com";
const USER_ID: string = "10000000-0000-4000-8000-000000000001";
const TEAM_ID: string = "10000000-0000-4000-8000-000000000002";
const PROJECT_ID: string = "2abc0000-0000-4000-8000-0000000000a1";
const PROJECT_SSO_ID: string = "2abc0000-0000-4000-8000-0000000000b2";
const GLOBAL_SSO_ID: string = "4fab0000-0000-4000-8000-0000000000e1";

const SECOND_IN_MS: number = 1000;
const HOUR_IN_MS: number = 60 * 60 * SECOND_IN_MS;

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

// The cache that remembers which responses were used, in memory.
const usedResponses: Set<string> = new Set();

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: (namespace: string, key: string): unknown => {
        const fullKey: string = `${namespace}-${key}`;

        if (usedResponses.has(fullKey)) {
          return Promise.resolve(false);
        }

        usedResponses.add(fullKey);
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
      // Already a member of the provider's teams.
      countBy: (): Promise<unknown> => {
        return Promise.resolve(new PositiveNumber(1));
      },
      create: jest.fn(),
      findBy: jest.fn(),
      updateBy: (): Promise<number> => {
        return Promise.resolve(0);
      },
    },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
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
            projectId: new ObjectID("2abc0000-0000-4000-8000-0000000000a1"),
            teams: [
              { id: new ObjectID("10000000-0000-4000-8000-000000000002") },
            ],
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

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (): undefined => {
        return undefined;
      },
      removeCookie: jest.fn(),
      setCookie: jest.fn(),
      setUserCookie: jest.fn(),
      setSSOCookie: jest.fn(),
      setGlobalSSOCookie: jest.fn(),
      getSSOToken: (): string => {
        return "sso-token";
      },
      getGlobalSSOToken: (): string => {
        return "global-sso-token";
      },
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      signUserLoginToken: (): string => {
        return "signed-user-token";
      },
    },
  };
});

// The server's address, as the real one reads it: a Hostname and a Protocol.
jest.mock("Common/Server/DatabaseConfig", () => {
  const hostname: typeof import("Common/Types/API/Hostname").default = (
    jest.requireActual("Common/Types/API/Hostname") as {
      default: typeof import("Common/Types/API/Hostname").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve(new hostname("oneuptime.example.com"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve("https://");
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

const sendErrorResponse: jest.Mock = jest.fn();
const responseRedirect: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      render: jest.fn(),
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

interface Flow {
  name: string;
  router: ExpressRouter;
  startPath: string;
  replyPath: string;
  params: Record<string, string>;
  entityId: string;
  replyUrl: string;
  findProvider: jest.Mock;
  notFound: string;
  method: SignInMethod;
}

const FLOWS: Array<Flow> = [
  {
    name: "project SAML",
    router: SSORouter,
    startPath: "/sso/:projectId/:projectSsoId",
    replyPath: "/idp-login/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROJECT_SSO_ID },
    entityId: `${SERVER}/${PROJECT_ID}/${PROJECT_SSO_ID}`,
    replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROJECT_SSO_ID}`,
    findProvider: projectSsoFindOneBy,
    notFound: "SSO Config not found",
    method: SignInMethod.Saml,
  },
  {
    name: "the server's own SAML",
    router: GlobalSSORouter,
    startPath: "/global-sso/:globalSsoId",
    replyPath: "/global-idp-login/:globalSsoId",
    params: { globalSsoId: GLOBAL_SSO_ID },
    entityId: `${SERVER}/global-sso/${GLOBAL_SSO_ID}`,
    replyUrl: `${SERVER}/identity/global-idp-login/${GLOBAL_SSO_ID}`,
    findProvider: globalSsoFindOneBy,
    notFound: "Global SSO Config not found",
    method: SignInMethod.Saml,
  },
];

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

function fakeResponse(): ExpressResponse {
  const res: ExpressResponse = {
    redirect: jest.fn(),
    status: jest.fn(() => {
      return res;
    }),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  return res;
}

function request(data: {
  params: Record<string, string>;
  query?: Record<string, string>;
  body?: JSONObject;
}): ExpressRequest {
  return {
    params: data.params,
    query: data.query || {},
    body: data.body || {},
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;
}

// Opens the sign-in's start; the AuthnRequest it sends the browser with.
async function start(
  flow: Flow,
  query: Record<string, string>,
): Promise<{ xml: string | null; next: unknown }> {
  let nextError: unknown = undefined;

  await (handlerFor(flow.router, "GET", flow.startPath)(
    request({ params: flow.params, query: query }),
    fakeResponse(),
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  const redirect: Array<unknown> | undefined = responseRedirect.mock.calls[0];

  if (!redirect) {
    return { xml: null, next: nextError };
  }

  const samlRequest: string | null = new globalThis.URL(
    String(redirect[2]),
  ).searchParams.get("SAMLRequest");

  return {
    xml: samlRequest
      ? zlib.inflateRawSync(Buffer.from(samlRequest, "base64")).toString("utf8")
      : null,
    next: nextError,
  };
}

function requestAttribute(xml: string, name: string): string | null {
  const match: RegExpExecArray | null = new RegExp(
    `<samlp:AuthnRequest[^>]*\\s${name}="([^"]*)"`,
  ).exec(xml);

  return match ? match[1]! : null;
}

let responseCounter: number = 0;

// The identity provider's signed answer, sent just now, to `inResponseTo`.
function signedResponse(
  flow: Flow,
  options: { inResponseTo: string | null; authnInstant: Date },
): string {
  responseCounter++;

  return toBase64(
    signElement(
      buildSamlResponse({
        issuer: ISSUER,
        email: USER_EMAIL,
        issuedAt: new Date(),
        responseId: `_sign_in_again_response_${responseCounter}`,
        assertionId: `_sign_in_again_assertion_${responseCounter}`,
        audienceRestrictions: [[flow.entityId]],
        recipient: flow.replyUrl,
        destination: flow.replyUrl,
        inResponseTo: options.inResponseTo,
        authnInstant: options.authnInstant,
      }),
      "Assertion",
      idpKeys.privateKey,
    ),
  );
}

// Posts the response to the Reply URL; what the new session keeps.
async function post(flow: Flow, samlResponse: string): Promise<SessionSignIn> {
  await (handlerFor(flow.router, "POST", flow.replyPath)(
    request({ params: flow.params, body: { SAMLResponse: samlResponse } }),
    fakeResponse(),
    (): void => {},
  ) as unknown as Promise<void>);

  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(createSession).toHaveBeenCalledTimes(1);

  return (createSession.mock.calls[0]![0] as { signIn: SessionSignIn }).signIn;
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
  usedResponses.clear();
  setTestBillingEnabled(false);

  userFindOneBy.mockResolvedValue(existingUser());

  const provider: JSONObject = {
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    name: "Acme Keycloak",
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
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });
});

describe.each(FLOWS)("$name", (flow: Flow) => {
  const SIGN_IN_AGAIN: Record<string, string> = {
    [REAUTHENTICATE_QUERY_PARAM]: "true",
  };

  test('Sign In Again sends the browser to the identity provider with ForceAuthn="true", under an ID of its own', async () => {
    const { xml } = await start(flow, SIGN_IN_AGAIN);

    expect(xml).not.toBeNull();
    expect(requestAttribute(xml!, "ForceAuthn")).toBe("true");
    expect(requestAttribute(xml!, "IsPassive")).toBe("false");
    expect(requestAttribute(xml!, "ID")).toMatch(/^ONEUPTIME_SIGN_IN_AGAIN_/);
  });

  test("a sign-in, and the mobile app's, ask as they always did", async () => {
    for (const query of [
      {},
      { [REAUTHENTICATE_QUERY_PARAM]: "false" },
      { ...SIGN_IN_AGAIN, mobile: "true" },
    ]) {
      responseRedirect.mockClear();

      const { xml } = await start(flow, query);

      expect(requestAttribute(xml!, "ForceAuthn")).toBe("false");
      expect(requestAttribute(xml!, "ID")).not.toMatch(
        /^ONEUPTIME_SIGN_IN_AGAIN_/,
      );
    }
  });

  test("the provider asked again: the person is signed in, and the session keeps that it confirmed it's them, from when", async () => {
    const { xml } = await start(flow, SIGN_IN_AGAIN);
    const authenticatedAt: Date = new Date(Date.now() - 2 * SECOND_IN_MS);

    const signIn: SessionSignIn = await post(
      flow,
      signedResponse(flow, {
        inResponseTo: requestAttribute(xml!, "ID"),
        authnInstant: authenticatedAt,
      }),
    );

    expect(signIn.method).toBe(flow.method);
    expect(signIn.ssoProviderId?.toString()).toBe(
      flow.name === "project SAML" ? PROJECT_SSO_ID : GLOBAL_SSO_ID,
    );
    expect(signIn.signInAgain).toEqual({ reauthenticatedAt: authenticatedAt });
  });

  test("the provider used a session it had: still signed in, and the session keeps why it confirmed nothing", async () => {
    const { xml } = await start(flow, SIGN_IN_AGAIN);

    const signIn: SessionSignIn = await post(
      flow,
      signedResponse(flow, {
        inResponseTo: requestAttribute(xml!, "ID"),
        authnInstant: new Date(Date.now() - 2 * HOUR_IN_MS),
      }),
    );

    expect(signIn.signInAgain).toEqual({
      refusal: SignInAgainRefusal.ReusedSession,
    });
  });

  test("a sign-in Sign In Again did not start keeps nothing of it, however fresh", async () => {
    const { xml } = await start(flow, {});

    const signIn: SessionSignIn = await post(
      flow,
      signedResponse(flow, {
        inResponseTo: requestAttribute(xml!, "ID"),
        authnInstant: new Date(),
      }),
    );

    expect(signIn.signInAgain).toBeUndefined();
  });

  test("a response the identity provider started keeps nothing of it either", async () => {
    const signIn: SessionSignIn = await post(
      flow,
      signedResponse(flow, { inResponseTo: null, authnInstant: new Date() }),
    );

    expect(signIn.signInAgain).toBeUndefined();
  });

  test("a Sign In Again whose provider is gone goes to the sign-in page", async () => {
    flow.findProvider.mockResolvedValue(null);

    await start(flow, SIGN_IN_AGAIN);

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(String(responseRedirect.mock.calls[0]![2])).toBe(
      `${SERVER}/accounts/login`,
    );
  });

  test("a sign-in through a provider that is gone is refused, as it was", async () => {
    flow.findProvider.mockResolvedValue(null);

    await start(flow, {});

    expect(responseRedirect).not.toHaveBeenCalled();
    expect((sendErrorResponse.mock.calls[0]![2] as Exception).message).toBe(
      flow.notFound,
    );
  });
});
