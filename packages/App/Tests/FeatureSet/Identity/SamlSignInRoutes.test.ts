import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import SSORouter from "../../../FeatureSet/Identity/API/SSO";
import GlobalSSORouter from "../../../FeatureSet/Identity/API/GlobalSSO";
import StatusPageSSORouter from "../../../FeatureSet/Identity/API/StatusPageSSO";
import {
  SAML_AUDIENCE_MISMATCH_MESSAGE,
  SAML_RECIPIENT_MISMATCH_MESSAGE,
  SAML_RESPONSE_EXPIRED_MESSAGE,
} from "../../../FeatureSet/Identity/Utils/SSO";
import {
  SAML_RESPONSE_ALREADY_USED_MESSAGE,
  SAML_SIGN_IN_UNAVAILABLE_MESSAGE,
} from "../../../FeatureSet/Identity/Utils/SamlAssertionOneTimeUse";
import {
  SamlKeyPair,
  buildSamlResponse,
  generateRsaKeyPair,
  minutesAfter,
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
import Email from "Common/Types/Email";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * A SAML RESPONSE SIGNS SOMEONE IN ONCE, THROUGH THE PROVIDER IT WAS MADE FOR,
 * WHILE IT IS FRESH.
 *
 * A signed SAML response is a bearer credential: whoever posts it to a Reply
 * URL is signed in as the person it names. The signature says only that the
 * identity provider made it. What it was made FOR, and WHEN, is in the
 * response too - its Audience, Recipient and Destination, and its
 * IssueInstant, NotBefore and NotOnOrAfter - and a response is only good for
 * that provider, once, in that window.
 *
 * Every SAML Reply URL is run here through its real route handler with a
 * response signed at run time by a generated identity provider key, and the
 * real SSOUtil verifying it: project SSO (/idp-login), Global SSO
 * (/global-idp-login) and status page SSO (/status-page-idp-login). Only the
 * database, the cache and the response writers are stand-ins. For each:
 *
 *   - a fresh response for this provider signs in (the control);
 *   - the same response, posted a second time, signs nobody in;
 *   - a response whose time has run out signs nobody in;
 *   - a response the same identity provider made for another application
 *     signs nobody in;
 *   - a response made for another OneUptime provider trusting the same
 *     identity provider signs nobody in;
 *   - when the cache that remembers used responses cannot be reached, nobody
 *     is signed in.
 *
 * "Signs nobody in" means: no account is created, nobody joins a team, no
 * session or cookie is handed out.
 * ---------------------------------------------------------------------------
 */

const HOST: string = "oneuptime.example.com";
const SERVER: string = `https://${HOST}`;

const ISSUER: string = "https://idp.example.com/realms/acme";
const USER_EMAIL: string = "dana.scully@example.com";
const USER_ID: string = "10000000-0000-4000-8000-000000000001";
const TEAM_ID: string = "10000000-0000-4000-8000-000000000002";

const PROJECT_ID: string = "20000000-0000-4000-8000-000000000001";
const PROJECT_SSO_ID: string = "20000000-0000-4000-8000-000000000002";

const STATUS_PAGE_ID: string = "30000000-0000-4000-8000-000000000001";
const STATUS_PAGE_SSO_ID: string = "30000000-0000-4000-8000-000000000002";

const GLOBAL_SSO_ID: string = "40000000-0000-4000-8000-000000000001";

// Another application the same identity provider signs people in to.
const OTHER_APPLICATION: { entityId: string; replyUrl: string } = {
  entityId: "https://acme.chat.example.net",
  replyUrl: "https://acme.chat.example.net/sso/saml",
};

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

/*
 * The cache that remembers which responses were used: Redis's SET NX EX, in
 * memory. `cacheIsDown` stands in for Redis being unreachable.
 */
const cacheEntries: Map<string, { value: string; expiresAt: number }> =
  new Map();
let cacheIsDown: boolean = false;

const setStringIfNotExists: jest.Mock = jest.fn(
  (
    namespace: string,
    key: string,
    value: string,
    options: { expiresInSeconds: number },
  ): Promise<boolean> => {
    if (cacheIsDown) {
      return Promise.reject(new Error("Cache is not connected"));
    }

    const fullKey: string = `${namespace}-${key}`;
    const existing: { value: string; expiresAt: number } | undefined =
      cacheEntries.get(fullKey);

    if (existing && existing.expiresAt > Date.now()) {
      return Promise.resolve(false);
    }

    cacheEntries.set(fullKey, {
      value,
      expiresAt: Date.now() + options.expiresInSeconds * 1000,
    });

    return Promise.resolve(true);
  },
);

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: (...args: Array<unknown>): unknown => {
        return setStringIfNotExists(...args);
      },
    },
  };
});

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

const globalSsoProjectFindBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/GlobalSsoProjectService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return globalSsoProjectFindBy(...args);
      },
    },
  };
});

const statusPageSsoFindOneBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPageSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return statusPageSsoFindOneBy(...args);
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
      getStatusPageFirstURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
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

const setUserCookie: jest.Mock = jest.fn();
const setSSOCookie: jest.Mock = jest.fn();
const setGlobalSSOCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      getCookieFromExpressRequest: (): undefined => {
        return undefined;
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

const signUserLoginToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
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

// What an identity provider was told about one OneUptime provider.
interface ServiceProviderValues {
  entityId: string;
  replyUrl: string;
}

const PROJECT_PROVIDER: ServiceProviderValues = {
  entityId: `${SERVER}/${PROJECT_ID}/${PROJECT_SSO_ID}`,
  replyUrl: `${SERVER}/identity/idp-login/${PROJECT_ID}/${PROJECT_SSO_ID}`,
};

const STATUS_PAGE_PROVIDER: ServiceProviderValues = {
  entityId: `${SERVER}/${STATUS_PAGE_ID}/${STATUS_PAGE_SSO_ID}`,
  replyUrl: `${SERVER}/identity/status-page-idp-login/${STATUS_PAGE_ID}/${STATUS_PAGE_SSO_ID}`,
};

const GLOBAL_PROVIDER: ServiceProviderValues = {
  entityId: `${SERVER}/global-sso/${GLOBAL_SSO_ID}`,
  replyUrl: `${SERVER}/identity/global-idp-login/${GLOBAL_SSO_ID}`,
};

interface Flow {
  name: string;
  router: ExpressRouter;
  // The Reply URL's route, and the route that starts a sign-in.
  path: string;
  startPath: string;
  params: Record<string, string>;
  provider: ServiceProviderValues;
  // Another OneUptime provider that trusts the same identity provider.
  neighbour: ServiceProviderValues;
  signedIn: () => boolean;
}

const FLOWS: Array<Flow> = [
  {
    name: "project SAML (/idp-login)",
    router: SSORouter,
    path: "/idp-login/:projectId/:projectSsoId",
    startPath: "/sso/:projectId/:projectSsoId",
    params: { projectId: PROJECT_ID, projectSsoId: PROJECT_SSO_ID },
    provider: PROJECT_PROVIDER,
    neighbour: STATUS_PAGE_PROVIDER,
    signedIn: (): boolean => {
      return createSession.mock.calls.length > 0;
    },
  },
  {
    name: "Global SAML (/global-idp-login)",
    router: GlobalSSORouter,
    path: "/global-idp-login/:globalSsoId",
    startPath: "/global-sso/:globalSsoId",
    params: { globalSsoId: GLOBAL_SSO_ID },
    provider: GLOBAL_PROVIDER,
    neighbour: PROJECT_PROVIDER,
    signedIn: (): boolean => {
      return createSession.mock.calls.length > 0;
    },
  },
  {
    name: "status page SAML (/status-page-idp-login)",
    router: StatusPageSSORouter,
    path: "/status-page-idp-login/:statusPageId/:statusPageSsoId",
    startPath: "/status-page-sso/:statusPageId/:statusPageSsoId",
    params: {
      statusPageId: STATUS_PAGE_ID,
      statusPageSsoId: STATUS_PAGE_SSO_ID,
    },
    provider: STATUS_PAGE_PROVIDER,
    neighbour: GLOBAL_PROVIDER,
    signedIn: (): boolean => {
      return createLoginCodeSession.mock.calls.length > 0;
    },
  },
];

let idpKeys: SamlKeyPair;

beforeAll(() => {
  idpKeys = generateRsaKeyPair();
});

let responseCounter: number = 0;

/*
 * A response the identity provider signed, for `audience` and sent to
 * `replyUrl`, issued `issuedMinutesAgo` minutes ago with the five-minute
 * windows identity providers use.
 */
function signedResponse(data: {
  audience: string;
  replyUrl: string;
  issuedMinutesAgo?: number | undefined;
  inResponseTo?: string | null | undefined;
  issuer?: string | undefined;
}): string {
  responseCounter++;

  const issuedAt: Date = minutesAfter(
    new Date(),
    -(data.issuedMinutesAgo ?? 0),
  );

  return toBase64(
    signElement(
      buildSamlResponse({
        issuer: data.issuer ?? ISSUER,
        email: USER_EMAIL,
        issuedAt,
        responseId: `_response_${responseCounter}`,
        assertionId: `_assertion_${responseCounter}`,
        audienceRestrictions: [[data.audience]],
        recipient: data.replyUrl,
        destination: data.replyUrl,
        inResponseTo:
          data.inResponseTo === undefined ? "_request_1" : data.inResponseTo,
      }),
      "Assertion",
      idpKeys.privateKey,
    ),
  );
}

interface PostResult {
  nextError: unknown;
  status: number | null;
}

// res.redirect: where the mobile flows send the app its deep link.
const resRedirect: jest.Mock = jest.fn();

async function post(
  flow: Flow,
  samlResponse: string,
  options: { relayState?: string | undefined } = {},
): Promise<PostResult> {
  const req: ExpressRequest = {
    params: flow.params,
    body: {
      SAMLResponse: samlResponse,
      ...(options.relayState ? { RelayState: options.relayState } : {}),
    },
    query: {},
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  let status: number | null = null;

  const res: ExpressResponse = {
    redirect: resRedirect,
    status: jest.fn((code: number) => {
      status = code;
      return res;
    }),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(flow.router, "POST", flow.path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  return { nextError, status };
}

// The message of the error the route answered with, if it answered with one.
function refusalMessage(): string | null {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0];

  if (!call) {
    return null;
  }

  return (call[2] as Exception).message;
}

function refusalStatus(): number | null {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0];

  if (!call) {
    return null;
  }

  return (call[2] as Exception).code;
}

function expectNobodySignedIn(flow: Flow): void {
  expect(flow.signedIn()).toBe(false);
  expect(createSession).not.toHaveBeenCalled();
  expect(createLoginCodeSession).not.toHaveBeenCalled();
  expect(userCreateByEmail).not.toHaveBeenCalled();
  expect(privateUserCreate).not.toHaveBeenCalled();
  expect(teamMemberCreate).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(signUserLoginToken).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(setSSOCookie).not.toHaveBeenCalled();
  expect(setGlobalSSOCookie).not.toHaveBeenCalled();
  expect(responseRedirect).not.toHaveBeenCalled();
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
  cacheIsDown = false;
  setTestBillingEnabled(false);

  // A newcomer: whoever a response vouches for would be created...
  userFindOneBy.mockResolvedValue(null);
  userCreateByEmail.mockImplementation((): Promise<User> => {
    return Promise.resolve(existingUser());
  });

  /*
   * ...and added to the provider's teams: a member of nothing until a team
   * takes them.
   */
  teamMemberCountBy.mockImplementation((): Promise<PositiveNumber> => {
    return Promise.resolve(
      new PositiveNumber(teamMemberCreate.mock.calls.length > 0 ? 1 : 0),
    );
  });
  teamMemberCreate.mockResolvedValue({});

  const provider: JSONObject = {
    id: new ObjectID(PROJECT_SSO_ID),
    signOnURL: "https://idp.example.com/sso",
    issuerURL: ISSUER,
    publicCertificate: "",
    teams: [{ id: new ObjectID(TEAM_ID) }],
  };

  projectSsoFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ...provider,
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

  // One attached project with a default team, so a newcomer would join it.
  globalSsoProjectFindBy.mockResolvedValue([
    {
      projectId: new ObjectID(PROJECT_ID),
      teams: [{ id: new ObjectID(TEAM_ID) }],
    },
  ]);

  statusPageSsoFindOneBy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      ...provider,
      id: new ObjectID(STATUS_PAGE_SSO_ID),
      statusPageId: new ObjectID(STATUS_PAGE_ID),
      projectId: new ObjectID(PROJECT_ID),
      publicCertificate: idpKeys.publicKey,
    });
  });

  privateUserFindOneBy.mockResolvedValue(null);
  privateUserCreate.mockImplementation(
    (data: { data: Record<string, unknown> }): Promise<unknown> => {
      return Promise.resolve({
        ...data.data,
        id: new ObjectID(USER_ID),
      });
    },
  );

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  });

  createLoginCodeSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "login-code",
    refreshTokenExpiresAt: new Date(),
  });

  signUserLoginToken.mockReturnValue("signed-user-token");
});

describe.each(FLOWS)("$name", (flow: Flow) => {
  test("signs in with a fresh response made for this provider", async () => {
    const result: PostResult = await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    expect(result.nextError).toBeUndefined();
    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
    expect(responseRedirect).toHaveBeenCalledTimes(1);
  });

  test("signs in with a response the identity provider started (no InResponseTo)", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
        inResponseTo: null,
      }),
    );

    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
  });

  test("the same response, posted a second time, signs nobody in", async () => {
    const response: string = signedResponse({
      audience: flow.provider.entityId,
      replyUrl: flow.provider.replyUrl,
    });

    await post(flow, response);

    expect(flow.signedIn()).toBe(true);

    jest.clearAllMocks();

    await post(flow, response);

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_RESPONSE_ALREADY_USED_MESSAGE);
    expect(refusalStatus()).toBe(400);
  });

  test("a response used at another provider is still good here once (each provider remembers its own)", async () => {
    // Two different responses: each provider takes the one made for it.
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    expect(refusalMessage()).toBeNull();
    expect(
      flow.name.startsWith("status page")
        ? createLoginCodeSession
        : createSession,
    ).toHaveBeenCalledTimes(2);
  });

  test("a response whose time ran out signs nobody in", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
        issuedMinutesAgo: 120,
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_RESPONSE_EXPIRED_MESSAGE);
  });

  test("a response the identity provider made for another application signs nobody in", async () => {
    await post(
      flow,
      signedResponse({
        audience: OTHER_APPLICATION.entityId,
        replyUrl: OTHER_APPLICATION.replyUrl,
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_AUDIENCE_MISMATCH_MESSAGE);
  });

  test("a response made for another OneUptime provider of the same identity provider signs nobody in", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.neighbour.entityId,
        replyUrl: flow.neighbour.replyUrl,
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_AUDIENCE_MISMATCH_MESSAGE);
  });

  test("a response for this provider's Entity ID but sent to another provider's Reply URL signs nobody in", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.neighbour.replyUrl,
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_RECIPIENT_MISMATCH_MESSAGE);
  });

  test("when used responses cannot be remembered, nobody is signed in", async () => {
    cacheIsDown = true;

    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalStatus()).toBe(503);
    expect(refusalMessage()).toBe(SAML_SIGN_IN_UNAVAILABLE_MESSAGE);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The request a sign-in starts with names the same Entity ID and Reply URL
 * a response is then held to, and a response naming them is taken.
 * ---------------------------------------------------------------------------
 */

// The AuthnRequest a start route redirected the browser to the IdP with.
async function startSignIn(flow: Flow): Promise<string> {
  const req: ExpressRequest = {
    params: flow.params,
    body: {},
    query: {},
    headers: {},
    cookies: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await (handlerFor(flow.router, "GET", flow.startPath)(req, res, (): void => {
    throw new Error("The start route failed");
  }) as unknown as Promise<void>);

  expect(responseRedirect).toHaveBeenCalledTimes(1);

  const redirectedTo: globalThis.URL = new globalThis.URL(
    String(responseRedirect.mock.calls[0]![2]),
  );

  return zlib
    .inflateRawSync(
      Buffer.from(redirectedTo.searchParams.get("SAMLRequest") || "", "base64"),
    )
    .toString("utf8");
}

describe.each(FLOWS)("$name - the sign-in it starts", (flow: Flow) => {
  test("asks the identity provider for a response to this provider's Reply URL, naming its Entity ID", async () => {
    const authnRequest: string = await startSignIn(flow);

    expect(authnRequest).toContain(
      `AssertionConsumerServiceURL="${flow.provider.replyUrl}"`,
    );
    expect(authnRequest).toContain(
      `<Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${flow.provider.entityId}</Issuer>`,
    );
  });

  test("the response to it, which names those two, signs in", async () => {
    await startSignIn(flow);
    jest.clearAllMocks();

    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Identity providers set up from older instructions keep signing people in.
 * ---------------------------------------------------------------------------
 */

describe.each(FLOWS)("$name - Audiences older setups send", (flow: Flow) => {
  test("signs in with the server's address as the Audience, the Entity ID shown before May 2024", async () => {
    await post(
      flow,
      signedResponse({ audience: SERVER, replyUrl: flow.provider.replyUrl }),
    );

    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
  });

  test("signs in with the Reply URL as the Audience", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.replyUrl,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
  });

  /*
   * The server's address names no provider in particular. A response
   * carrying it is held to its provider by its Recipient, so one made for
   * another provider of the same server is still refused.
   */
  test("the server's address as the Audience does not make another provider's response good here", async () => {
    await post(
      flow,
      signedResponse({ audience: SERVER, replyUrl: flow.neighbour.replyUrl }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe(SAML_RECIPIENT_MISMATCH_MESSAGE);
  });

  test("an address typed with http where the server knows itself as https still signs in", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId.replace("https://", "http://"),
        replyUrl: flow.provider.replyUrl.replace("https://", "http://"),
      }),
    );

    expect(refusalMessage()).toBeNull();
    expect(flow.signedIn()).toBe(true);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The order of the steps: nothing is remembered for a response that is
 * refused anyway, and nothing is looked up for a response used before.
 * ---------------------------------------------------------------------------
 */

describe.each(FLOWS)("$name - the order of the steps", (flow: Flow) => {
  test("a response refused for its time is not recorded as used", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
        issuedMinutesAgo: 120,
      }),
    );

    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("a response for another application is not recorded as used", async () => {
    await post(
      flow,
      signedResponse({
        audience: OTHER_APPLICATION.entityId,
        replyUrl: OTHER_APPLICATION.replyUrl,
      }),
    );

    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("a response from another issuer is refused before it is recorded as used", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
        issuer: "https://idp.example.com/realms/someone-else",
      }),
    );

    expectNobodySignedIn(flow);
    expect(refusalMessage()).toBe("Issuer URL does not match");
    expect(setStringIfNotExists).not.toHaveBeenCalled();
  });

  test("the use is recorded before anyone is looked up", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    const lookups: Array<number> = [
      ...userFindOneBy.mock.invocationCallOrder,
      ...privateUserFindOneBy.mock.invocationCallOrder,
    ];

    expect(setStringIfNotExists).toHaveBeenCalledTimes(1);
    expect(lookups.length).toBeGreaterThan(0);
    expect(setStringIfNotExists.mock.invocationCallOrder[0]!).toBeLessThan(
      Math.min(...lookups),
    );
  });

  test("a response posted again looks nobody up", async () => {
    const response: string = signedResponse({
      audience: flow.provider.entityId,
      replyUrl: flow.provider.replyUrl,
    });

    await post(flow, response);
    jest.clearAllMocks();
    await post(flow, response);

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(privateUserFindOneBy).not.toHaveBeenCalled();
  });

  test("records the use under this provider, until the response could no longer be accepted", async () => {
    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
    );

    const [namespace, key, , options] = setStringIfNotExists.mock.calls[0] as [
      string,
      string,
      string,
      { expiresInSeconds: number },
    ];

    expect(namespace).toBe("saml-assertion-used");

    const providerId: string =
      flow.params["projectSsoId"] ||
      flow.params["globalSsoId"] ||
      flow.params["statusPageSsoId"] ||
      "";

    const kind: string = flow.name.startsWith("project")
      ? "project-sso"
      : flow.name.startsWith("Global")
        ? "global-sso"
        : "status-page-sso";

    expect(key.split(":")[0]).toBe(kind);
    expect(key.split(":")[1]).toBe(providerId);

    /*
     * Issued just now with five-minute windows: five minutes and the three
     * of clock slack, plus three more for app servers' clocks.
     */
    expect(options.expiresInSeconds).toBeGreaterThan(10 * 60);
    expect(options.expiresInSeconds).toBeLessThanOrEqual(11 * 60);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A sign-in the mobile app started ends on the app's deep link, refused or
 * not, so the app can say why.
 * ---------------------------------------------------------------------------
 */

describe("Global SAML from the mobile app", () => {
  const flow: Flow = FLOWS.find((candidate: Flow): boolean => {
    return candidate.name.startsWith("Global");
  })!;

  function deepLinkParams(): URLSearchParams {
    expect(resRedirect).toHaveBeenCalledTimes(1);

    const deepLink: string = resRedirect.mock.calls[0]![0] as string;

    expect(deepLink.startsWith("oneuptime://sso-callback?")).toBe(true);

    return new URLSearchParams(deepLink.split("?")[1] || "");
  }

  test("a response posted again sends the app back with the reason, and no tokens", async () => {
    const response: string = signedResponse({
      audience: flow.provider.entityId,
      replyUrl: flow.provider.replyUrl,
    });

    await post(flow, response, { relayState: "mobile" });
    jest.clearAllMocks();
    await post(flow, response, { relayState: "mobile" });

    const params: URLSearchParams = deepLinkParams();

    expect(params.get("error")).toBe("invalid_assertion");
    expect(params.get("errorDescription")).toBe(
      SAML_RESPONSE_ALREADY_USED_MESSAGE,
    );
    expect(params.get("accessToken")).toBeNull();
    expect(params.get("refreshToken")).toBeNull();
    expectNobodySignedIn(flow);
  });

  test("a response for another application sends the app back as one that could not be verified", async () => {
    await post(
      flow,
      signedResponse({
        audience: OTHER_APPLICATION.entityId,
        replyUrl: OTHER_APPLICATION.replyUrl,
      }),
      { relayState: "mobile" },
    );

    const params: URLSearchParams = deepLinkParams();

    expect(params.get("error")).toBe("invalid_assertion");
    expect(params.get("accessToken")).toBeNull();
    expectNobodySignedIn(flow);
  });

  test("when used responses cannot be remembered, the app is told to try again", async () => {
    cacheIsDown = true;

    await post(
      flow,
      signedResponse({
        audience: flow.provider.entityId,
        replyUrl: flow.provider.replyUrl,
      }),
      { relayState: "mobile" },
    );

    const params: URLSearchParams = deepLinkParams();

    expect(params.get("error")).toBe("invalid_assertion");
    expect(params.get("errorDescription")).toBe(
      SAML_SIGN_IN_UNAVAILABLE_MESSAGE,
    );
    expectNobodySignedIn(flow);
  });
});

describe("project SAML from the mobile app", () => {
  const flow: Flow = FLOWS.find((candidate: Flow): boolean => {
    return candidate.name.startsWith("project");
  })!;

  test("a response posted again is refused and hands the app no tokens", async () => {
    const response: string = signedResponse({
      audience: flow.provider.entityId,
      replyUrl: flow.provider.replyUrl,
    });

    await post(flow, response, { relayState: "mobile" });

    // The first post handed the app its tokens on the deep link.
    expect(String(resRedirect.mock.calls[0]![0])).toContain("accessToken=");

    jest.clearAllMocks();
    await post(flow, response, { relayState: "mobile" });

    expect(resRedirect).not.toHaveBeenCalled();
    expect(refusalMessage()).toBe(SAML_RESPONSE_ALREADY_USED_MESSAGE);
    expectNobodySignedIn(flow);
  });
});
