import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import GlobalOIDCRouter from "../../../FeatureSet/Identity/API/GlobalOIDC";
import OIDCRouter from "../../../FeatureSet/Identity/API/OIDC";
import OIDCUtil from "../../../FeatureSet/Identity/Utils/OIDC";
import {
  PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
} from "../../../FeatureSet/Identity/Utils/OidcEmailVerification";
import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import { TestIdp, startTestIdp } from "./OidcTestIdp";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  RequestHandler,
} from "Common/Server/Utils/Express";
import CookieUtil from "Common/Server/Utils/Cookie";
import User from "Common/Models/DatabaseModels/User";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { Client, Issuer, custom } from "openid-client";
import dns from "dns";

/*
 * ---------------------------------------------------------------------------
 * AN OPENID CONNECT SIGN-IN NEVER USES AN ADDRESS ITS PROVIDER SAYS IT HAS
 * NOT VERIFIED (GHSA-8gwc-w386-fh6w), RUN END TO END against a real OpenID
 * Provider on a loopback socket (./OidcTestIdp): the start route's
 * authorization request and signed state cookie, the provider's token
 * endpoint, JWKS and userinfo, the callback's checks in openid-client and
 * Utils/OIDC - and then what the callback does with the address and what
 * the provider said of it. Only the database, the session store and the
 * response writers are stand-ins.
 *
 * The report's proof: on a Keycloak realm where people may edit their own
 * address and Verify Email is off, someone changes theirs to an address a
 * OneUptime account has - a master admin's - and signs in through the
 * server's own provider. Keycloak sends email_verified: false. Each case
 * below is a provider's real way of saying it, run through both callbacks
 * that find an account by the address: the server's own (Global OIDC) and
 * a project's. The providers that verified the address, and those that say
 * nothing of it (Microsoft Entra ID), still sign in.
 * ---------------------------------------------------------------------------
 */

/*
 * Importing OIDCUtil installs an SSRF egress guard that refuses loopback;
 * this suite's provider is on 127.0.0.1, so it opts out, as OIDC.test.ts
 * does. The clients the routes make get the hook again, so they are
 * unhooked as they are made (below).
 */
custom.setHttpOptionsDefaults({ lookup: dns.lookup });

function removeEgressGuardHook(target: unknown): void {
  delete (target as Record<symbol, unknown>)[custom.http_options];
}

removeEgressGuardHook(Issuer);

const CLIENT_ID: string = "0oa1b2c3d4E5F6G7h8i9";
const CLIENT_SECRET: string = "sUpErSeCrEtClientValue-0123456789";
const ADDRESS: string = "admin@acme.example.com";
const USER_ID: string = "3abc0000-0000-4000-8000-0000000000a1";
const PROJECT_ID: string = "3abc0000-0000-4000-8000-0000000000b2";
const PROVIDER_ID: string = "3abc0000-0000-4000-8000-0000000000c3";
const TEAM_ID: string = "3abc0000-0000-4000-8000-0000000000d4";
const PROVIDER_NAME: string = "Acme Keycloak";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  const environment: Record<string, unknown> = {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
  };

  environment["Host"] = "oneuptime.example.com";
  environment["HttpProtocol"] = "https://";

  return billingFlag.withLiveBillingFlag(environment);
});

const providerFindOneBy: jest.Mock = jest.fn();

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

const attachmentsFindBy: jest.Mock = jest.fn();

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

// The account at the address, or none.
let storedRow: Record<string, unknown> | null = null;

const userFindOneBy: jest.Mock = jest.fn();
const userCreateByEmail: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();

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
      updateOneById: (...args: Array<unknown>): unknown => {
        return userUpdateOneById(...args);
      },
    },
  };
});

const teamMemberCountBy: jest.Mock = jest.fn();
const teamMemberUpdateBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return teamMemberCountBy(...args);
      },
      findBy: jest.fn(),
      updateBy: (...args: Array<unknown>): unknown => {
        return teamMemberUpdateBy(...args);
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

const recordFailedSignIn: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/AuditLog/FailedSignInAuditLog", () => {
  return {
    __esModule: true,
    default: {
      record: (...args: Array<unknown>): unknown => {
        return recordFailedSignIn(...args);
      },
    },
  };
});

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
    },
  };
});

// Where a sign-in that went through lands: this server's dashboard.
jest.mock("Common/Server/DatabaseConfig", () => {
  const hostname: typeof import("Common/Types/API/Hostname") =
    jest.requireActual("Common/Types/API/Hostname");

  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve(
          hostname.default.fromString("oneuptime.example.com"),
        );
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

// A provider's two routes: where a sign-in starts, and where it comes back.
interface Callback {
  name: string;
  router: ExpressRouter;
  startPath: string;
  callbackPath: string;
  params: Record<string, string>;
  stateCookieName: string;
  isGlobal: boolean;
}

const CALLBACKS: Array<Callback> = [
  {
    name: "Global OIDC",
    router: GlobalOIDCRouter,
    startPath: "/global-oidc/:globalOidcId",
    callbackPath: "/global-oidc-callback/:globalOidcId",
    params: { globalOidcId: PROVIDER_ID },
    stateCookieName: `global-oidc-state-${PROVIDER_ID}`,
    isGlobal: true,
  },
  {
    name: "project OIDC",
    router: OIDCRouter,
    startPath: "/oidc/:projectId/:projectOidcId",
    callbackPath: "/oidc-callback/:projectId/:projectOidcId",
    params: { projectId: PROJECT_ID, projectOidcId: PROVIDER_ID },
    stateCookieName: `oidc-state-${PROVIDER_ID}`,
    isGlobal: false,
  },
];

interface RouteResult {
  nextError: unknown;
  cookies: Record<string, string>;
}

async function run(
  callback: Callback,
  path: string,
  request: {
    query?: Record<string, string> | undefined;
    cookies?: Record<string, string> | undefined;
  },
): Promise<RouteResult> {
  const cookies: Record<string, string> = {};

  const req: ExpressRequest = {
    params: callback.params,
    body: {},
    query: request.query || {},
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
    cookies: request.cookies || {},
    socket: { remoteAddress: "203.0.113.7" },
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    req,
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    cookie: jest.fn((name: string, value: string) => {
      cookies[name] = value;
      return res;
    }),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  let nextError: unknown = undefined;

  await (handlerFor(callback.router, "GET", path)(
    req,
    res,
    (err?: unknown): void => {
      nextError = err;
    },
  ) as unknown as Promise<void>);

  return { nextError, cookies };
}

let idp: TestIdp | null = null;

// What the provider's token endpoint and userinfo answer, read when they answer.
let idTokenClaims: JSONObject = {};
let userInfo: JSONObject = {};

function liveView(read: () => JSONObject): JSONObject {
  return new Proxy<Record<string, unknown>>(
    {},
    {
      ownKeys: (): Array<string> => {
        return Reflect.ownKeys(read()) as Array<string>;
      },
      getOwnPropertyDescriptor: (
        _target: Record<string, unknown>,
        key: string | symbol,
      ): PropertyDescriptor | undefined => {
        return Reflect.getOwnPropertyDescriptor(read(), key);
      },
      get: (
        _target: Record<string, unknown>,
        key: string | symbol,
      ): unknown => {
        return Reflect.get(read(), key);
      },
    },
  ) as JSONObject;
}

async function startProvider(options: {
  emailClaimName?: string | undefined;
}): Promise<TestIdp> {
  const started: TestIdp = await startTestIdp({
    clientId: CLIENT_ID,
    idTokenClaims: liveView((): JSONObject => {
      return idTokenClaims;
    }),
    userInfo: liveView((): JSONObject => {
      return userInfo;
    }),
  });

  idp = started;

  providerFindOneBy.mockResolvedValue({
    id: new ObjectID(PROVIDER_ID),
    name: PROVIDER_NAME,
    discoveryURL: started.issuerUrl,
    issuerURL: started.issuerUrl,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    scopes: "openid email profile",
    emailClaimName: options.emailClaimName ?? "email",
    nameClaimName: "name",
    teams: [{ id: new ObjectID(TEAM_ID) }],
    disableSignUpWithSso: false,
    restrictToAttachedProjects: false,
    signOutOfIdentityProvider: false,
  });

  return started;
}

/*
 * A whole sign-in: started at OneUptime, the provider's answer carrying
 * `claims` (and `fromUserInfo` at its userinfo endpoint), back at the
 * callback with the state cookie the start set.
 */
async function signIn(
  callback: Callback,
  data: {
    claims: JSONObject;
    fromUserInfo?: JSONObject | undefined;
  },
): Promise<RouteResult> {
  const started: RouteResult = await run(callback, callback.startPath, {});

  expect(started.nextError).toBeUndefined();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(responseRedirect).toHaveBeenCalledTimes(1);

  const authorization: globalThis.URL = new globalThis.URL(
    String(responseRedirect.mock.calls[0]![2]),
  );

  responseRedirect.mockClear();

  idTokenClaims = {
    ...data.claims,
    nonce: authorization.searchParams.get("nonce")!,
  };
  userInfo = data.fromUserInfo ?? { sub: "00u1a2b3c4D5E6F7g8h9" };

  const stateCookie: string | undefined =
    started.cookies[callback.stateCookieName];

  expect(stateCookie).toBeTruthy();

  return await run(callback, callback.callbackPath, {
    query: {
      code: "authorization-code-from-idp",
      state: authorization.searchParams.get("state")!,
    },
    cookies: { [callback.stateCookieName]: stateCookie! },
  });
}

function storeAccount(data: { isMasterAdmin: boolean } | null): void {
  storedRow = data
    ? {
        _id: USER_ID,
        email: new Email(ADDRESS),
        name: "Acme Admin",
        isMasterAdmin: data.isMasterAdmin,
        isEmailVerified: true,
        isBlocked: false,
        timezone: null,
      }
    : null;
}

function projectOntoSelect(
  row: Record<string, unknown>,
  select: Record<string, unknown>,
): User {
  const user: Record<string, unknown> = new User() as unknown as Record<
    string,
    unknown
  >;

  for (const column of Object.keys(select)) {
    if (select[column] && row[column] !== undefined) {
      user[column] = row[column];
    }
  }

  return user as unknown as User;
}

function expectRefused(result: RouteResult): void {
  expect(result.nextError).toBeUndefined();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(render).toHaveBeenCalledTimes(1);
  expect(render.mock.calls[0]![3]).toEqual({
    title: PROVIDER_EMAIL_NOT_VERIFIED_TITLE,
    message: PROVIDER_EMAIL_NOT_VERIFIED_MESSAGE,
  });

  // Nobody signed in, nothing made, joined, verified or mailed.
  expect(createSession).not.toHaveBeenCalled();
  expect(setUserCookie).not.toHaveBeenCalled();
  expect(result.cookies["user-token"]).toBeUndefined();
  expect(userCreateByEmail).not.toHaveBeenCalled();
  expect(userUpdateOneById).not.toHaveBeenCalled();
  expect(addToTeams).not.toHaveBeenCalled();
  expect(teamMemberUpdateBy).not.toHaveBeenCalled();
  expect(refreshUserAllPermissions).not.toHaveBeenCalled();
  expect(sendVerificationEmail).not.toHaveBeenCalled();
  expect(responseRedirect).not.toHaveBeenCalled();
}

function expectSignedIn(result: RouteResult): User {
  expect(result.nextError).toBeUndefined();
  expect(sendErrorResponse).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(recordFailedSignIn).not.toHaveBeenCalled();
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(setUserCookie).toHaveBeenCalledTimes(1);
  expect(result.cookies["user-token"]).toBeTruthy();
  expect(responseRedirect).toHaveBeenCalledTimes(1);
  expect(String(responseRedirect.mock.calls[0]![2])).toContain(
    "oneuptime.example.com/dashboard",
  );

  return (setUserCookie.mock.calls[0]![0] as { user: User }).user;
}

let addToTeams: jest.SpiedFunction<typeof SsoTeamMembership.addToTeams>;
let setUserCookie: jest.SpiedFunction<typeof CookieUtil.setUserCookie>;

beforeEach(() => {
  jest.clearAllMocks();

  // A self-hosted server: a project's provider signs in the account it names.
  setTestBillingEnabled(false);

  // The clients the routes make are on loopback too: unhook them.
  const createClient: typeof OIDCUtil.createClient = jest.requireActual<{
    default: typeof OIDCUtil;
  }>("../../../FeatureSet/Identity/Utils/OIDC").default.createClient;

  jest
    .spyOn(OIDCUtil, "createClient")
    .mockImplementation(
      async (
        config: Parameters<typeof OIDCUtil.createClient>[0],
      ): Promise<Client> => {
        const client: Client = await createClient.call(OIDCUtil, config);
        removeEgressGuardHook(client);
        removeEgressGuardHook(client.issuer);
        return client;
      },
    );

  addToTeams = jest
    .spyOn(SsoTeamMembership, "addToTeams")
    .mockResolvedValue(SsoTeamMembershipOutcome.Added);

  // The real cookie, watched for whom it is made.
  setUserCookie = jest.spyOn(CookieUtil, "setUserCookie");

  storeAccount({ isMasterAdmin: false });

  userFindOneBy.mockImplementation((data: { select: JSONObject }) => {
    return Promise.resolve(
      storedRow ? projectOntoSelect(storedRow, data.select) : null,
    );
  });
  userCreateByEmail.mockImplementation((data: { email: Email }) => {
    const created: User = new User();
    created._id = USER_ID;
    created.email = data.email;
    created.isEmailVerified = true;
    created.isMasterAdmin = false;
    created.isBlocked = false;
    return Promise.resolve(created);
  });

  attachmentsFindBy.mockResolvedValue([
    {
      projectId: new ObjectID(PROJECT_ID),
      teams: [{ id: new ObjectID(TEAM_ID) }],
    },
  ]);

  // A member of the project already: every callback has a project to sign in to.
  teamMemberCountBy.mockResolvedValue(new PositiveNumber(1));
  teamMemberUpdateBy.mockResolvedValue(0);

  createSession.mockImplementation(() => {
    return Promise.resolve({
      session: { id: ObjectID.generate() },
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      accessTokenExpiresInSeconds: 900,
      ssoSignInExpiresInSeconds: 3600,
      signedInAt: new Date(),
      lastActiveAt: new Date(),
    });
  });
});

afterEach(async () => {
  jest.restoreAllMocks();

  if (idp) {
    await idp.close();
    idp = null;
  }
});

// What Keycloak's ID token says of someone (OidcTestIdp adds iss, sub, aud, exp, iat).
const KEYCLOAK: JSONObject = {
  typ: "ID",
  azp: CLIENT_ID,
  preferred_username: "mallory",
  name: "Mallory",
  email: ADDRESS,
};

describe.each(CALLBACKS)(
  "$name, against a real provider",
  (callback: Callback) => {
    /*
     * The report's proof: an address someone put on their own account, which
     * the provider says it has not verified.
     */
    test("refuses an ID token whose provider says it has not verified the address (email_verified: false)", async () => {
      storeAccount({ isMasterAdmin: callback.isGlobal });
      await startProvider({});

      const result: RouteResult = await signIn(callback, {
        claims: { ...KEYCLOAK, email_verified: false },
      });

      expectRefused(result);

      // The account at the address has the attempt in its audit logs.
      expect(recordFailedSignIn).toHaveBeenCalledTimes(1);

      const attempt: { userId: ObjectID; reason: SignInFailureReason } =
        recordFailedSignIn.mock.calls[0]![0] as never;

      expect(attempt.userId.toString()).toBe(USER_ID);
      expect(attempt.reason).toBe(SignInFailureReason.EmailNotVerified);
    });

    // Cognito's userinfo sends it as a string.
    test('refuses email_verified: "false"', async () => {
      await startProvider({});

      expectRefused(
        await signIn(callback, {
          claims: { ...KEYCLOAK, email_verified: "false" },
        }),
      );
    });

    test("refuses an email_verified that is neither true nor false", async () => {
      await startProvider({});

      expectRefused(
        await signIn(callback, {
          claims: { ...KEYCLOAK, email_verified: "yes" },
        }),
      );
    });

    /*
     * authentik (since 2025.10, with its own mappings) and Okta's org server
     * can leave the address out of the ID token: it is then read from
     * userinfo, and so is what the provider says of it.
     */
    test("refuses an address from the userinfo endpoint that it says is not verified", async () => {
      await startProvider({});

      expectRefused(
        await signIn(callback, {
          claims: { typ: "ID", name: "Mallory", email_verified: true },
          fromUserInfo: {
            sub: "00u1a2b3c4D5E6F7g8h9",
            email: ADDRESS,
            email_verified: false,
          },
        }),
      );
    });

    test("makes no account with an address it says is not verified", async () => {
      storeAccount(null);
      await startProvider({});

      expectRefused(
        await signIn(callback, {
          claims: { ...KEYCLOAK, email_verified: false },
        }),
      );

      // No account had the address: no audit log to put the attempt in.
      expect(recordFailedSignIn).not.toHaveBeenCalled();
    });

    // Regressions: the people who could always sign in still do.
    test("signs in the account at an address the provider verified (email_verified: true)", async () => {
      await startProvider({});

      const user: User = expectSignedIn(
        await signIn(callback, {
          claims: { ...KEYCLOAK, email_verified: true },
        }),
      );

      expect(user.id?.toString()).toBe(USER_ID);
    });

    // Google sends the string on some flows.
    test('signs in with email_verified: "true"', async () => {
      await startProvider({});

      expectSignedIn(
        await signIn(callback, {
          claims: { ...KEYCLOAK, email_verified: "true" },
        }),
      );
    });

    /*
     * Microsoft Entra ID sends no email_verified, and leaves an address its
     * tenant has not verified out of `email` instead: requiring a true would
     * lock every Entra ID customer out.
     */
    test("signs in from a Microsoft Entra ID token, which says nothing of email_verified", async () => {
      await startProvider({});

      expectSignedIn(
        await signIn(callback, {
          claims: {
            ver: "2.0",
            tid: "9188040d-6c67-4c5b-b112-36a304b66dad",
            oid: "00000000-0000-0000-66f3-3332eca7ea81",
            preferred_username: ADDRESS,
            name: "Acme Admin",
            email: ADDRESS,
          },
        }),
      );
    });

    /*
     * An address read from another claim is taken as it always was:
     * email_verified speaks of `email`, not of a username.
     */
    test("signs in with the address from preferred_username, whatever email_verified says of `email`", async () => {
      await startProvider({ emailClaimName: "preferred_username" });

      expectSignedIn(
        await signIn(callback, {
          claims: {
            ver: "2.0",
            preferred_username: ADDRESS,
            name: "Acme Admin",
            email: "someone.else@example.com",
            email_verified: false,
          },
        }),
      );
    });
  },
);

/*
 * The server's own provider stays trusted with administrators
 * (GHSA-358p-w79v-cc3r): a master admin whose provider verified the
 * address, or says nothing of it, is signed in as one.
 */
describe("Global OIDC and a master admin", () => {
  const GLOBAL: Callback = CALLBACKS[0]!;

  test.each([
    ["verified", { email_verified: true }],
    ["says nothing of it", {}],
  ] as Array<[string, JSONObject]>)(
    "signs a master admin in, as one, when the provider %s",
    async (_label: string, verification: JSONObject) => {
      storeAccount({ isMasterAdmin: true });
      await startProvider({});

      const user: User = expectSignedIn(
        await signIn(GLOBAL, { claims: { ...KEYCLOAK, ...verification } }),
      );

      expect(user.isMasterAdmin).toBe(true);
    },
  );
});
