import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import CookieUtil, {
  SESSION_SIGN_OUT_COOKIE_NAME,
} from "Common/Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import SelfSignedCertificate, {
  SelfSignedKeyPair,
} from "Common/Server/Utils/SelfSignedCertificate";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import {
  IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD,
  IdentityProviderSignOutRecord,
  SamlIdentityProviderSignOutRecord,
} from "Common/Types/SSO/IdentityProviderSignOut";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import { SessionEndCause } from "Common/Types/UserSession/SessionEndCause";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import crypto from "crypto";
import zlib from "zlib";

/*
 * ---------------------------------------------------------------------------
 * A SIGN-OUT ENDS THE ONEUPTIME SESSION FIRST, THEN SENDS THE BROWSER ON TO
 * THE IDENTITY PROVIDER - ONLY FOR A PROVIDER THAT ASKS FOR IT (#9535).
 *
 * On a shared computer, signing out of OneUptime used to leave the person
 * signed in at their identity provider: the next person who clicked "Sign in
 * with <provider>" got in as them. With the provider's "Sign out of the
 * identity provider too" switch on, its sign-in keeps the provider's
 * end_session_endpoint and the ID token with the session, server-side.
 * POST /identity/logout ends the session as it always has, then answers
 * where the browser goes next: the provider's logout, with the id_token_hint,
 * OneUptime's client_id, and OneUptime's own sign-in page to come back to.
 *
 * The real /logout handler runs, sent what a browser sends it. The session
 * table and the providers are stand-ins.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

jest.mock("Common/Server/Utils/SsoRequiredSignIn", () => {
  return (
    jest.requireActual(
      "./SsoNotRequiredStandIn",
    ) as typeof import("./SsoNotRequiredStandIn")
  ).ssoNotRequired();
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

// The server's own address, as its configuration says - never a request's Host header.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    Host: "oneuptime.example.com",
    HttpProtocol: "https://",
  };
});

const USER_ID: string = "5d5d0000-0000-4000-8000-0000000000a1";
const SESSION_ID: string = "5d5d0000-0000-4000-8000-0000000000b1";
const GLOBAL_PROVIDER_ID: string = "5d5d0000-0000-4000-8000-0000000000c1";
const PROJECT_PROVIDER_ID: string = "5d5d0000-0000-4000-8000-0000000000c2";

const ID_TOKEN: string =
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJwZXJzb24tMSJ9.c2lnbmF0dXJl";

const END_SESSION_ENDPOINT: string =
  "https://idp.example.com/realms/acme/protocol/openid-connect/logout";

// The SAML providers' (#9603), and a project's provider's project.
const GLOBAL_SAML_PROVIDER_ID: string = "5d5d0000-0000-4000-8000-0000000000d1";
const PROJECT_SAML_PROVIDER_ID: string =
  "5d5d0000-0000-4000-8000-0000000000d2";
const PROJECT_ID: string = "5d5d0000-0000-4000-8000-0000000000e1";

const SAML_SIGN_OUT_URL: string =
  "https://acme.okta.com/app/acme_oneuptime_1/exk1fcia6d6EMsf331d8/slo/saml";

const SAML_SESSION_INDEX: string = "_be9967abd904ddcae3c0eb4189adbe3f71e327cf93";

// What happened, in the order it happened.
const events: Array<string> = [];

// The session table: one session, its refresh token, what it kept, and whether it ended.
interface SessionRow {
  id: string;
  userId: string;
  refreshToken: string;
  isRevoked: boolean;
  cause: unknown;
  identityProviderSignOut: IdentityProviderSignOutRecord | null;
}

const table: Array<SessionRow> = [];

const failures: {
  readingWhatTheSessionKept: boolean;
  readingTheProvider: boolean;
  readingTheSigningKey: boolean;
} = {
  readingWhatTheSessionKept: false,
  readingTheProvider: false,
  readingTheSigningKey: false,
};

// The providers, by id: their client ID, whether they are on, and the switch.
interface ProviderRow {
  clientId: string;
  isEnabled: boolean;
  signOutOfIdentityProvider: boolean;
}

const providers: Map<string, ProviderRow> = new Map();

function live(row: SessionRow | undefined): SessionRow | undefined {
  return row && !row.isRevoked ? row : undefined;
}

jest.mock("Common/Server/Services/UserSessionService", () => {
  const { default: ObjectIDType } = jest.requireActual(
    "Common/Types/ObjectID",
  ) as { default: typeof ObjectID };

  const keptBy: (
    row: SessionRow | undefined,
  ) => { sessionId: ObjectID; record: IdentityProviderSignOutRecord } | null = (
    row: SessionRow | undefined,
  ): { sessionId: ObjectID; record: IdentityProviderSignOutRecord } | null => {
    return row && row.identityProviderSignOut
      ? {
          sessionId: new ObjectIDType(row.id),
          record: row.identityProviderSignOut,
        }
      : null;
  };

  return {
    __esModule: true,
    default: {
      findIdentityProviderSignOut: async (
        data:
          | { refreshToken: string }
          | { sessionId: ObjectID; userId: ObjectID },
      ): Promise<unknown> => {
        events.push("read what the session kept");

        if (failures.readingWhatTheSessionKept) {
          throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
        }

        return keptBy(
          live(
            table.find((row: SessionRow): boolean => {
              return "refreshToken" in data
                ? row.refreshToken === data.refreshToken
                : row.id === data.sessionId.toString() &&
                    row.userId === data.userId.toString();
            }),
          ),
        );
      },
      revokeSessionByRefreshToken: async (
        refreshToken: string,
        options: { cause: unknown },
      ): Promise<boolean> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return candidate.refreshToken === refreshToken;
          }),
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.cause = options.cause;
        events.push("ended the session");
        return true;
      },
      revokeLiveSessionOfUser: async (
        data: { userId: ObjectID; sessionId: ObjectID },
        options: { cause: unknown },
      ): Promise<boolean> => {
        const row: SessionRow | undefined = live(
          table.find((candidate: SessionRow): boolean => {
            return (
              candidate.id === data.sessionId.toString() &&
              candidate.userId === data.userId.toString()
            );
          }),
        );

        if (!row) {
          return false;
        }

        row.isRevoked = true;
        row.cause = options.cause;
        events.push("ended the session");
        return true;
      },
      forgetIdentityProviderSignOut: async (
        sessionId: ObjectID,
      ): Promise<void> => {
        const row: SessionRow | undefined = table.find(
          (candidate: SessionRow): boolean => {
            return candidate.id === sessionId.toString();
          },
        );

        if (row) {
          row.identityProviderSignOut = null;
        }

        events.push("forgot the ID token");
      },
      findActiveSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
      getSessionLengthEndReason: jest.fn(),
      endSessionByLength: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeAllSessionsByUserId: jest.fn(),
      createSession: jest.fn(),
    },
  };
});

const providerLookup: (query: {
  _id: string;
  isEnabled: boolean;
}) => Promise<unknown> = async (query: {
  _id: string;
  isEnabled: boolean;
}): Promise<unknown> => {
  events.push("read the provider");

  if (failures.readingTheProvider) {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
  }

  const provider: ProviderRow | undefined = providers.get(query._id);

  if (!provider || provider.isEnabled !== query.isEnabled) {
    return null;
  }

  return {
    clientId: provider.clientId,
    signOutOfIdentityProvider: provider.signOutOfIdentityProvider,
  };
};

jest.mock("Common/Server/Services/GlobalOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: {
        query: { _id: string; isEnabled: boolean };
      }): Promise<unknown> => {
        return providerLookup(data.query);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectOidcService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: {
        query: { _id: string; isEnabled: boolean };
      }): Promise<unknown> => {
        return providerLookup(data.query);
      },
    },
  };
});

/*
 * The SAML providers (#9603), by id: whether they are on, the switch, their
 * identity provider's Sign Out URL, and a project's provider's project.
 */
interface SamlProviderRow {
  isEnabled: boolean;
  signOutOfIdentityProvider: boolean;
  singleLogoutURL: string | null;
  projectId?: string | undefined;
}

const samlProviders: Map<string, SamlProviderRow> = new Map();

const samlProviderLookup: (query: {
  _id: string;
  isEnabled: boolean;
}) => Promise<unknown> = async (query: {
  _id: string;
  isEnabled: boolean;
}): Promise<unknown> => {
  events.push("read the provider");

  if (failures.readingTheProvider) {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
  }

  const provider: SamlProviderRow | undefined = samlProviders.get(query._id);

  if (!provider || provider.isEnabled !== query.isEnabled) {
    return null;
  }

  const { default: ObjectIDType } = jest.requireActual(
    "Common/Types/ObjectID",
  ) as { default: typeof ObjectID };

  return {
    issuerURL: "http://www.okta.com/exk1fcia6d6EMsf331d8",
    publicCertificate: "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----",
    singleLogoutURL: provider.singleLogoutURL
      ? {
          toString: (): string => {
            return provider.singleLogoutURL!;
          },
        }
      : undefined,
    signOutOfIdentityProvider: provider.signOutOfIdentityProvider,
    projectId: provider.projectId
      ? new ObjectIDType(provider.projectId)
      : undefined,
  };
};

jest.mock("Common/Server/Services/GlobalSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: {
        query: { _id: string; isEnabled: boolean };
      }): Promise<unknown> => {
        return samlProviderLookup(data.query);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectSsoService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (data: {
        query: { _id: string; isEnabled: boolean };
      }): Promise<unknown> => {
        return samlProviderLookup(data.query);
      },
    },
  };
});

// The installation's SAML signing key, made once for the suite.
const signingKeys: { pair: SelfSignedKeyPair | null } = { pair: null };

jest.mock("Common/Server/Services/InstanceSamlSigningKeyService", () => {
  return {
    __esModule: true,
    default: {
      getKeyPair: async (): Promise<unknown> => {
        events.push("read the signing key");

        if (failures.readingTheSigningKey) {
          throw new Error(
            "The InstanceSamlSigningKey table holds no usable SAML signing key.",
          );
        }

        return signingKeys.pair;
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
const sendEmptySuccessResponse: jest.Mock = jest.fn();
const sendJsonObjectResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        events.push("answered");
        return sendEmptySuccessResponse(...args);
      },
      sendJsonObjectResponse: (...args: Array<unknown>): unknown => {
        events.push("answered");
        return sendJsonObjectResponse(...args);
      },
      sendEntityResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

// The router is mounted at /identity: it registers its own paths.
const SIGN_OUT_PATH: string = "/logout";

function keptFor(
  providerType: SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC,
): IdentityProviderSignOutRecord {
  return {
    providerType: providerType,
    providerId:
      providerType === SsoProviderType.GlobalOIDC
        ? GLOBAL_PROVIDER_ID
        : PROJECT_PROVIDER_ID,
    endSessionEndpoint: END_SESSION_ENDPOINT,
    idToken: ID_TOKEN,
  };
}

function signedIn(
  kept: IdentityProviderSignOutRecord | null,
  refreshToken: string = "current-refresh-token",
): void {
  table.push({
    id: SESSION_ID,
    userId: USER_ID,
    refreshToken: refreshToken,
    isRevoked: false,
    cause: null,
    identityProviderSignOut: kept,
  });
}

function accessToken(): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: new ObjectID(USER_ID),
      email: new Email("night.shift@example.com"),
      name: new Name("Night Shift"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: false,
      sessionId: new ObjectID(SESSION_ID),
    },
    expiresInSeconds: 15 * 60,
  });
}

interface SignOutResult {
  // The answer's body, when it had one.
  body: JSONObject | null;
  answeredEmpty: boolean;
  next: jest.Mock;
}

async function signOut(data: {
  cookies: Dictionary<string>;
  host?: string;
}): Promise<SignOutResult> {
  const req: ExpressRequest = buildRequest({});
  (req as unknown as { cookies: Dictionary<string> }).cookies = data.cookies;
  (req as unknown as { headers: Dictionary<string> }).headers = {
    host: data.host || "oneuptime.example.com",
  };

  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();

  const handler: RouteHandler = mockRouter.match("post", SIGN_OUT_PATH);

  await handler(req, res, next as unknown as NextFunction);

  const jsonCall: Array<unknown> | undefined =
    sendJsonObjectResponse.mock.calls[0];

  return {
    body: jsonCall ? (jsonCall[2] as JSONObject) : null,
    answeredEmpty: sendEmptySuccessResponse.mock.calls.length === 1,
    next: next,
  };
}

function providerSignOutUrl(result: SignOutResult): globalThis.URL {
  return new globalThis.URL(
    result.body![IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD] as string,
  );
}

beforeAll(async () => {
  signingKeys.pair = await SelfSignedCertificate.create({
    commonName: "OneUptime SAML Service Provider",
    validForDays: 365,
  });
});

beforeEach(() => {
  events.length = 0;
  table.length = 0;
  failures.readingWhatTheSessionKept = false;
  failures.readingTheProvider = false;
  failures.readingTheSigningKey = false;
  samlProviders.clear();
  samlProviders.set(GLOBAL_SAML_PROVIDER_ID, {
    isEnabled: true,
    signOutOfIdentityProvider: true,
    singleLogoutURL: SAML_SIGN_OUT_URL,
  });
  samlProviders.set(PROJECT_SAML_PROVIDER_ID, {
    isEnabled: true,
    signOutOfIdentityProvider: true,
    singleLogoutURL: SAML_SIGN_OUT_URL,
    projectId: PROJECT_ID,
  });
  providers.clear();
  providers.set(GLOBAL_PROVIDER_ID, {
    clientId: "oneuptime-global",
    isEnabled: true,
    signOutOfIdentityProvider: true,
  });
  providers.set(PROJECT_PROVIDER_ID, {
    clientId: "oneuptime-project",
    isEnabled: true,
    signOutOfIdentityProvider: true,
  });
  sendErrorResponse.mockReset();
  sendEmptySuccessResponse.mockReset();
  sendJsonObjectResponse.mockReset();
});

afterEach(() => {
  jest.clearAllMocks();
});

const REFRESH_COOKIE: () => Dictionary<string> = (): Dictionary<string> => {
  return { [CookieUtil.getRefreshTokenKey()]: "current-refresh-token" };
};

describe("a sign-out of a session whose provider signs people out too", () => {
  it.each<[SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC, string]>([
    [SsoProviderType.GlobalOIDC, "oneuptime-global"],
    [SsoProviderType.ProjectOIDC, "oneuptime-project"],
  ])(
    "through %s: ends the session, then answers the provider's logout with the hint, the client and the way back",
    async (
      providerType: SsoProviderType.GlobalOIDC | SsoProviderType.ProjectOIDC,
      clientId: string,
    ) => {
      signedIn(keptFor(providerType));

      const result: SignOutResult = await signOut({
        cookies: REFRESH_COOKIE(),
      });

      expect(table[0]!.isRevoked).toBe(true);
      expect(table[0]!.cause).toBe(SessionEndCause.SignedOut);

      const url: globalThis.URL = providerSignOutUrl(result);

      expect(`${url.origin}${url.pathname}`).toBe(END_SESSION_ENDPOINT);
      expect(url.searchParams.get("id_token_hint")).toBe(ID_TOKEN);
      expect(url.searchParams.get("client_id")).toBe(clientId);
      expect(url.searchParams.get("post_logout_redirect_uri")).toBe(
        "https://oneuptime.example.com/accounts",
      );
      expect(result.answeredEmpty).toBe(false);
      expect(result.next).not.toHaveBeenCalled();
    },
  );

  /*
   * The order the issue asked for: the OneUptime session ends before the
   * browser is sent anywhere, so a provider that never sends it back leaves
   * nobody signed in to OneUptime.
   */
  it("ends the OneUptime session first, then asks the provider, then answers", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));

    await signOut({ cookies: REFRESH_COOKIE() });

    expect(events).toEqual([
      "read what the session kept",
      "ended the session",
      "read the provider",
      "forgot the ID token",
      "answered",
    ]);
  });

  it("forgets the ID token once it has used it", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));

    await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.identityProviderSignOut).toBeNull();
  });

  // The way back is always OneUptime's own sign-in page, whatever the request said it was.
  it("sends the provider back to the server's own sign-in page, never to a Host header's", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));

    const result: SignOutResult = await signOut({
      cookies: REFRESH_COOKIE(),
      host: "evil.example.com",
    });

    expect(
      providerSignOutUrl(result).searchParams.get("post_logout_redirect_uri"),
    ).toBe("https://oneuptime.example.com/accounts");
  });

  /*
   * A renewal whose answer was lost left the browser a refresh token that
   * matches no session (#8592): the access token, or the sign-out cookie
   * once that is gone (#8638), names the session - and the provider is
   * signed out of all the same.
   */
  it("by the session's access token, when its refresh token was rotated", async () => {
    signedIn(keptFor(SsoProviderType.ProjectOIDC), "rotated-refresh-token");

    const result: SignOutResult = await signOut({
      cookies: {
        [CookieUtil.getRefreshTokenKey()]: "replaced-refresh-token",
        [CookieUtil.getUserTokenKey()]: accessToken(),
      },
    });

    expect(table[0]!.isRevoked).toBe(true);
    expect(providerSignOutUrl(result).searchParams.get("client_id")).toBe(
      "oneuptime-project",
    );
  });

  it("by the browser's sign-out cookie, when the access token is gone too", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC), "rotated-refresh-token");

    const result: SignOutResult = await signOut({
      cookies: {
        [CookieUtil.getRefreshTokenKey()]: "replaced-refresh-token",
        [SESSION_SIGN_OUT_COOKIE_NAME]: JSONWebToken.signSessionSignOutToken({
          userId: new ObjectID(USER_ID),
          sessionId: new ObjectID(SESSION_ID),
          expiresInSeconds: 60 * 60,
        }),
      },
    });

    expect(table[0]!.isRevoked).toBe(true);
    expect(providerSignOutUrl(result).searchParams.get("id_token_hint")).toBe(
      ID_TOKEN,
    );
  });
});

describe("every other sign-out goes to the sign-in page, as before", () => {
  it("a session that kept nothing - a password sign-in, the switch off at sign-in - asks no provider", async () => {
    signedIn(null);

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(result.body).toBeNull();
    expect(events).not.toContain("read the provider");
  });

  it("the switch was turned off since the sign-in", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));
    providers.get(GLOBAL_PROVIDER_ID)!.signOutOfIdentityProvider = false;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    // Nothing more to keep it for.
    expect(table[0]!.identityProviderSignOut).toBeNull();
  });

  it("the provider was turned off since the sign-in", async () => {
    signedIn(keptFor(SsoProviderType.ProjectOIDC));
    providers.get(PROJECT_PROVIDER_ID)!.isEnabled = false;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(result.answeredEmpty).toBe(true);
  });

  it("the provider was deleted since the sign-in", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));
    providers.delete(GLOBAL_PROVIDER_ID);

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(result.answeredEmpty).toBe(true);
  });

  it("a sign-out that ends no session sends nobody to a provider", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));

    const result: SignOutResult = await signOut({
      cookies: { [CookieUtil.getRefreshTokenKey()]: "nobody's-refresh-token" },
    });

    expect(table[0]!.isRevoked).toBe(false);
    expect(result.answeredEmpty).toBe(true);
    expect(events).not.toContain("read the provider");
  });
});

describe("the provider's sign-out never fails OneUptime's", () => {
  it("a session that cannot be read for it still signs out, to the sign-in page", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));
    failures.readingWhatTheSessionKept = true;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(result.next).not.toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  it("a provider that cannot be read still signs out, to the sign-in page", async () => {
    signedIn(keptFor(SsoProviderType.GlobalOIDC));
    failures.readingTheProvider = true;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(result.next).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * A SAML SESSION (#9603): THE SAME ORDER, AND A SIGNED LOGOUTREQUEST.
 *
 * A session a SAML sign-in gave, through a provider with the switch on,
 * kept the assertion's Name ID and SessionIndex. Once POST /identity/logout
 * has ended it, the answer is the identity provider's Sign Out URL with a
 * LogoutRequest naming that person and that session, from OneUptime's
 * Entity ID for the provider, signed with the installation's key - and only
 * while the provider is on, still asks for it, and has a Sign Out URL.
 * ---------------------------------------------------------------------------
 */

function samlKeptFor(
  providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO,
): SamlIdentityProviderSignOutRecord {
  return {
    providerType: providerType,
    providerId:
      providerType === SsoProviderType.GlobalSSO
        ? GLOBAL_SAML_PROVIDER_ID
        : PROJECT_SAML_PROVIDER_ID,
    nameId: "night.shift@example.com",
    nameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    sessionIndex: SAML_SESSION_INDEX,
  };
}

// The LogoutRequest a sign-out sends the browser with, and whether OneUptime signed it.
function logoutRequestIn(url: globalThis.URL): {
  xml: string;
  isSigned: boolean;
} {
  const raw: string = url.search.substring(1);
  const signedOctets: string = raw.substring(0, raw.indexOf("&Signature="));

  return {
    xml: zlib
      .inflateRawSync(
        Buffer.from(url.searchParams.get("SAMLRequest")!, "base64"),
      )
      .toString("utf8"),
    isSigned: crypto.verify(
      "sha256",
      Buffer.from(signedOctets, "utf8"),
      crypto.createPublicKey(signingKeys.pair!.certificate),
      Buffer.from(url.searchParams.get("Signature")!, "base64"),
    ),
  };
}

describe("a sign-out of a SAML session whose provider signs people out too", () => {
  it.each<[SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO, string]>([
    [
      SsoProviderType.GlobalSSO,
      `https://oneuptime.example.com/global-sso/${GLOBAL_SAML_PROVIDER_ID}`,
    ],
    [
      SsoProviderType.ProjectSSO,
      `https://oneuptime.example.com/${PROJECT_ID}/${PROJECT_SAML_PROVIDER_ID}`,
    ],
  ])(
    "through %s: ends the session, then answers the identity provider's Sign Out URL with a signed LogoutRequest naming the person and their session",
    async (
      providerType: SsoProviderType.GlobalSSO | SsoProviderType.ProjectSSO,
      entityId: string,
    ) => {
      signedIn(samlKeptFor(providerType));

      const result: SignOutResult = await signOut({
        cookies: REFRESH_COOKIE(),
      });

      expect(table[0]!.isRevoked).toBe(true);
      expect(table[0]!.cause).toBe(SessionEndCause.SignedOut);

      const url: globalThis.URL = providerSignOutUrl(result);

      expect(`${url.origin}${url.pathname}`).toBe(SAML_SIGN_OUT_URL);

      const { xml, isSigned } = logoutRequestIn(url);

      expect(isSigned).toBe(true);
      expect(xml).toContain("<samlp:LogoutRequest ");
      expect(xml).toContain(`<saml:Issuer>${entityId}</saml:Issuer>`);
      expect(xml).toContain(
        '<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">night.shift@example.com</saml:NameID>',
      );
      expect(xml).toContain(
        `<samlp:SessionIndex>${SAML_SESSION_INDEX}</samlp:SessionIndex>`,
      );
      expect(xml).toContain(`Destination="${SAML_SIGN_OUT_URL}"`);
      expect(result.answeredEmpty).toBe(false);
      expect(result.next).not.toHaveBeenCalled();
    },
  );

  it("ends the OneUptime session first, then asks the provider, signs, forgets and answers", async () => {
    signedIn(samlKeptFor(SsoProviderType.GlobalSSO));

    await signOut({ cookies: REFRESH_COOKIE() });

    expect(events).toEqual([
      "read what the session kept",
      "ended the session",
      "read the provider",
      "read the signing key",
      "forgot the ID token",
      "answered",
    ]);
  });

  it("forgets the Name ID and the session index once it has used them", async () => {
    signedIn(samlKeptFor(SsoProviderType.ProjectSSO));

    await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.identityProviderSignOut).toBeNull();
  });

  it("names OneUptime's own address, never a Host header's", async () => {
    signedIn(samlKeptFor(SsoProviderType.GlobalSSO));

    const result: SignOutResult = await signOut({
      cookies: REFRESH_COOKIE(),
      host: "evil.example.com",
    });

    const { xml } = logoutRequestIn(providerSignOutUrl(result));

    expect(xml).not.toContain("evil.example.com");
    expect(xml).toContain(
      `<saml:Issuer>https://oneuptime.example.com/global-sso/${GLOBAL_SAML_PROVIDER_ID}</saml:Issuer>`,
    );
  });

  it("by the session's access token, when its refresh token was rotated", async () => {
    signedIn(samlKeptFor(SsoProviderType.ProjectSSO), "rotated-refresh-token");

    const result: SignOutResult = await signOut({
      cookies: {
        [CookieUtil.getRefreshTokenKey()]: "replaced-refresh-token",
        [CookieUtil.getUserTokenKey()]: accessToken(),
      },
    });

    expect(table[0]!.isRevoked).toBe(true);
    expect(logoutRequestIn(providerSignOutUrl(result)).isSigned).toBe(true);
  });
});

describe("a SAML session's sign-out goes to the sign-in page", () => {
  it.each<[string, (row: SamlProviderRow) => void]>([
    [
      "once the switch was turned off",
      (row: SamlProviderRow): void => {
        row.signOutOfIdentityProvider = false;
      },
    ],
    [
      "once the provider was turned off",
      (row: SamlProviderRow): void => {
        row.isEnabled = false;
      },
    ],
    [
      "once the Sign Out URL is gone",
      (row: SamlProviderRow): void => {
        row.singleLogoutURL = null;
      },
    ],
    [
      "when the Sign Out URL is no address a browser may be sent to",
      (row: SamlProviderRow): void => {
        row.singleLogoutURL = "javascript:alert(document.cookie)";
      },
    ],
  ])("%s", async (_: string, change: (row: SamlProviderRow) => void) => {
    signedIn(samlKeptFor(SsoProviderType.GlobalSSO));
    change(samlProviders.get(GLOBAL_SAML_PROVIDER_ID)!);

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(events).not.toContain("read the signing key");
    // Nothing more to keep it for.
    expect(table[0]!.identityProviderSignOut).toBeNull();
  });

  it("once the provider was deleted", async () => {
    signedIn(samlKeptFor(SsoProviderType.ProjectSSO));
    samlProviders.delete(PROJECT_SAML_PROVIDER_ID);

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(result.answeredEmpty).toBe(true);
  });

  it("when the signing key cannot be read: signed out of OneUptime alone, with no error", async () => {
    signedIn(samlKeptFor(SsoProviderType.GlobalSSO));
    failures.readingTheSigningKey = true;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(result.next).not.toHaveBeenCalled();
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  it("when the provider cannot be read: signed out of OneUptime alone, with no error", async () => {
    signedIn(samlKeptFor(SsoProviderType.ProjectSSO));
    failures.readingTheProvider = true;

    const result: SignOutResult = await signOut({ cookies: REFRESH_COOKIE() });

    expect(table[0]!.isRevoked).toBe(true);
    expect(result.answeredEmpty).toBe(true);
    expect(result.next).not.toHaveBeenCalled();
  });
});
