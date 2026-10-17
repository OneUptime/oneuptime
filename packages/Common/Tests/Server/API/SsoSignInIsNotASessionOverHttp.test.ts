jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn().mockReturnValue(null),
      isConnected: jest.fn().mockReturnValue(false),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import UserAPI from "../../../Server/API/UserAPI";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import LabelService from "../../../Server/Services/LabelService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Label from "../../../Models/DatabaseModels/Label";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import CookieParser from "cookie-parser";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

/*
 * A real Express app: an error that walks the routes registered after the
 * one that threw is deferred with setImmediate, which Common's jsdom
 * environment does not expose. Lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * AN SSO SIGN-IN IS NOT A SESSION, OVER HTTP.
 *
 * Signing in through a project's SAML or OIDC provider, or through a Global
 * SSO provider, leaves two things: a session (the fifteen-minute access
 * token of a UserSession, renewed by its refresh token and ended by signing
 * out, a password change or a block) and an SSO sign-in (a thirty-day token
 * that says the person signed in through that provider, so that a project
 * requiring SSO lets their session in). The SSO sign-in is read only next to
 * a session of the same person, in its own cookie or header. On its own it
 * is nobody: sent where the session goes - the dashboard's access-token
 * cookie, or an Authorization: Bearer header - it is answered like any
 * other token that is not a session, a 401. Otherwise it would be a
 * thirty-day sign-in to every project the person belongs to and to their
 * own account, that no sign-out or session revocation could end.
 *
 * Each case below is a real HTTP request to a real Express app - cookie
 * parsing, the JSON body parser, the real UserAPI router (the person's own
 * account), a real CRUD router of a project-scoped model (Label), the real
 * user middleware and the production error handler - carrying tokens signed
 * for real (CookieUtil, JSONWebToken). Only the data layer is stubbed, and
 * it records what reached it.
 */

const MEMBER_ID: ObjectID = new ObjectID(
  "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e",
);

// A project that requires SSO to sign in, with its own SAML and OIDC providers.
const PROJECT_REQUIRING_SSO: ObjectID = new ObjectID(
  "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
);
const PROJECT_SAML_ID: ObjectID = new ObjectID(
  "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
);
const PROJECT_OIDC_ID: ObjectID = new ObjectID(
  "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
);

// Another project of the same member, that does not require SSO.
const OTHER_PROJECT: ObjectID = new ObjectID(
  "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4",
);

// The server's Global SSO providers.
const GLOBAL_SAML_ID: ObjectID = new ObjectID(
  "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5",
);
const GLOBAL_OIDC_ID: ObjectID = new ObjectID(
  "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6",
);

// A status page, and a private user of it.
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);
const PRIVATE_USER_ID: ObjectID = new ObjectID(
  "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
);

const THIRTY_DAYS_IN_SECONDS: number = OneUptimeDate.getSecondsInDays(
  new PositiveNumber(30),
);

function member(): User {
  const user: User = new User();
  user.id = MEMBER_ID;
  user.email = new Email("member@example.com");
  user.name = new Name("Member");
  return user;
}

// The member's session: the access token every sign-in gives.
function sessionToken(): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: MEMBER_ID,
      email: new Email("member@example.com"),
      name: new Name("Member"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: false,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

// Where an SSO sign-in is read: next to a project, or for the whole server.
type SsoSlot = "project" | "global";

interface SsoSignIn {
  name: string;
  slot: SsoSlot;
  token: () => string;
}

/*
 * Every SSO sign-in a member can hold. The first four are what this
 * release's SAML and OIDC routes leave (CookieUtil). The last two are what
 * the releases before it left, claim for claim: still sitting in browsers
 * and in the mobile app for up to thirty days after an upgrade.
 */
const SSO_SIGN_INS: Array<SsoSignIn> = [
  {
    name: "a project SAML sign-in",
    slot: "project",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: member(),
        projectId: PROJECT_REQUIRING_SSO,
        ssoProviderId: PROJECT_SAML_ID,
        ssoProviderType: SsoProviderType.ProjectSSO,
      });
    },
  },
  {
    name: "a project OIDC sign-in",
    slot: "project",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: member(),
        projectId: PROJECT_REQUIRING_SSO,
        ssoProviderId: PROJECT_OIDC_ID,
        ssoProviderType: SsoProviderType.ProjectOIDC,
      });
    },
  },
  {
    name: "a Global SAML sign-in",
    slot: "global",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: member(),
        ssoProviderId: GLOBAL_SAML_ID,
        ssoProviderType: SsoProviderType.GlobalSSO,
      });
    },
  },
  {
    name: "a Global OIDC sign-in",
    slot: "global",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: member(),
        ssoProviderId: GLOBAL_OIDC_ID,
        ssoProviderType: SsoProviderType.GlobalOIDC,
      });
    },
  },
  {
    name: "a project SAML sign-in an earlier release gave",
    slot: "project",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: MEMBER_ID.toString(),
          projectId: PROJECT_REQUIRING_SSO.toString(),
          name: "Member",
          email: "member@example.com",
          isMasterAdmin: false,
          isGeneralLogin: false,
          ssoProviderId: PROJECT_SAML_ID.toString(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        },
        THIRTY_DAYS_IN_SECONDS,
      );
    },
  },
  {
    name: "a Global SAML sign-in an earlier release gave",
    slot: "global",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: MEMBER_ID.toString(),
          name: "Member",
          email: "member@example.com",
          projectId: "",
          isMasterAdmin: false,
          isGeneralLogin: false,
          ssoProviderId: GLOBAL_SAML_ID.toString(),
          ssoProviderType: SsoProviderType.GlobalSSO,
        },
        THIRTY_DAYS_IN_SECONDS,
      );
    },
  },
];

// A status page private user's session, as the status page sign-in sets it.
function statusPageSessionToken(): string {
  const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
  privateUser.id = PRIVATE_USER_ID;
  privateUser.email = new Email("reader@example.com");

  return CookieUtil.setStatusPagePrivateUserCookie({
    expressResponse: {
      cookie: (): void => {
        // The cookie is not needed: the token is.
      },
    } as unknown as ExpressResponse,
    user: privateUser,
    statusPageId: STATUS_PAGE_ID,
    sessionId: ObjectID.generate(),
    refreshToken: ObjectID.generate().toString(),
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });
}

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

interface Reached {
  what: string;
  userId: string | undefined;
  tenantId: string | undefined;
}

let server: http.Server | null = null;
let port: number = 0;
const reached: Array<Reached> = [];

function memberPermissionIn(projectId: ObjectID): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      // A member reads the project's labels.
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  } as UserTenantAccessPermission;
}

function record(what: string, props: JSONObject): void {
  reached.push({
    what: what,
    userId: props["userId"] ? String(props["userId"]) : undefined,
    tenantId: props["tenantId"] ? String(props["tenantId"]) : undefined,
  });
}

beforeAll(async () => {
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "getRequireSsoForLogin")
    .mockImplementation((async (projectId: ObjectID): Promise<boolean> => {
      return projectId.toString() === PROJECT_REQUIRING_SSO.toString();
    }) as never);
  jest
    .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);

  // Every provider is on, never turned off, and belongs where it says.
  jest
    .spyOn(ProjectSsoService, "getSignInStanding")
    .mockResolvedValue({ isOn: true, signInsEndedAtMs: null } as never);
  jest
    .spyOn(ProjectOidcService, "getSignInStanding")
    .mockResolvedValue({ isOn: true, signInsEndedAtMs: null } as never);
  jest.spyOn(GlobalSsoService, "getProviderTrust").mockResolvedValue({
    isUsable: true,
    restrictToAttachedProjects: false,
    signInsEndedAtMs: null,
  } as never);
  jest.spyOn(GlobalOidcService, "getProviderTrust").mockResolvedValue({
    isUsable: true,
    restrictToAttachedProjects: false,
    signInsEndedAtMs: null,
  } as never);

  // The member belongs to both projects.
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
    ): Promise<UserGlobalAccessPermission | null> => {
      if (userId.toString() !== MEMBER_ID.toString()) {
        return null;
      }

      return {
        _type: "UserGlobalAccessPermission",
        projectIds: [PROJECT_REQUIRING_SSO, OTHER_PROJECT],
        globalPermissions: [Permission.Public, Permission.User],
        isMasterAdmin: false,
      } as UserGlobalAccessPermission;
    }) as never);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      if (userId.toString() !== MEMBER_ID.toString()) {
        return null;
      }

      return memberPermissionIn(projectId);
    }) as never);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  // What a request that gets through reads, and as whom.
  jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    record("the member's own account", data.props);
    return [];
  }) as never);
  jest.spyOn(UserService, "countBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<PositiveNumber> => {
    record("the member's own account (count)", data.props);
    return new PositiveNumber(0);
  }) as never);
  jest.spyOn(LabelService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    record("a project's labels", data.props);
    return [];
  }) as never);
  jest.spyOn(LabelService, "countBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<PositiveNumber> => {
    record("a project's labels (count)", data.props);
    return new PositiveNumber(0);
  }) as never);

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserAPI().getRouter());
  app.use("/api", new BaseAPI(Label, LabelService).getRouter());
  app.use(expressErrorHandler);

  const startedServer: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    startedServer.listen(0, "127.0.0.1", resolve);
  });

  server = startedServer;
  port = (startedServer.address() as AddressInfo).port;
});

afterAll(async () => {
  jest.restoreAllMocks();

  const startedServer: http.Server | null = server;
  server = null;

  if (startedServer) {
    await new Promise<void>((resolve: () => void) => {
      startedServer.close(() => {
        resolve();
      });
    });
  }
});

beforeEach(() => {
  reached.length = 0;
});

function post(data: {
  path: string;
  cookies?: Dictionary<string> | undefined;
  headers?: Dictionary<string> | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify({
        query: {},
        select: { _id: true },
      });

      const headers: http.OutgoingHttpHeaders = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...(data.headers || {}),
      };

      const cookies: Dictionary<string> = data.cookies || {};
      const cookieHeader: string = Object.keys(cookies)
        .map((name: string): string => {
          return `${name}=${cookies[name]}`;
        })
        .join("; ");

      if (cookieHeader) {
        headers["cookie"] = cookieHeader;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: data.path,
          method: "POST",
          headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = { raw };
            }

            resolve({ status: response.statusCode || 0, body });
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

// Where a session is sent: the dashboard's cookie, or a bearer header.
type Carrier = "the access-token cookie" | "an Authorization: Bearer header";

const CARRIERS: Array<Carrier> = [
  "the access-token cookie",
  "an Authorization: Bearer header",
];

function asSession(
  token: string,
  carrier: Carrier,
): {
  cookies: Dictionary<string>;
  headers: Dictionary<string>;
} {
  if (carrier === "the access-token cookie") {
    return {
      cookies: { [CookieUtil.getUserTokenKey()]: token },
      headers: {},
    };
  }

  return { cookies: {}, headers: { authorization: `Bearer ${token}` } };
}

// The SSO sign-in in its own place, as the web (cookie) or mobile app (header) sends it.
type SsoCarrier = "cookie" | "header";

function asSsoSignIn(
  signIn: SsoSignIn,
  token: string,
  carrier: SsoCarrier,
): { cookies: Dictionary<string>; headers: Dictionary<string> } {
  if (signIn.slot === "project") {
    return carrier === "cookie"
      ? {
          cookies: { [CookieUtil.getUserSSOKey(PROJECT_REQUIRING_SSO)]: token },
          headers: {},
        }
      : {
          cookies: {},
          headers: {
            "x-sso-tokens": JSON.stringify({
              [PROJECT_REQUIRING_SSO.toString()]: token,
            }),
          },
        };
  }

  return carrier === "cookie"
    ? { cookies: { [CookieUtil.getGlobalSSOKey()]: token }, headers: {} }
    : { cookies: {}, headers: { "x-global-sso-token": token } };
}

interface Route {
  name: string;
  path: string;
  headers: Dictionary<string>;
}

/*
 * Where a session gets a member: their own account, and a project of
 * theirs that does not require SSO.
 */
const ROUTES: Array<Route> = [
  {
    name: "the member's own account",
    path: "/api/user/get-list",
    headers: {},
  },
  {
    name: "a project of theirs that does not require SSO",
    path: "/api/label/get-list",
    headers: { tenantid: OTHER_PROJECT.toString() },
  },
];

describe("the member's own session", () => {
  test.each(CARRIERS)(
    "gets them their own account and their project, sent as %s",
    async (carrier: Carrier) => {
      for (const route of ROUTES) {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(sessionToken(), carrier);

        const result: HttpResult = await post({
          path: route.path,
          cookies: session.cookies,
          headers: { ...route.headers, ...session.headers },
        });

        expect({ route: route.name, status: result.status }).toEqual({
          route: route.name,
          status: 200,
        });
      }

      expect(reached.length).toBeGreaterThan(0);

      for (const read of reached) {
        expect(read.userId).toBe(MEMBER_ID.toString());
      }
    },
  );
});

describe.each(SSO_SIGN_INS)("$name", (signIn: SsoSignIn) => {
  describe.each(ROUTES)("at $name", (route: Route) => {
    test.each(CARRIERS)(
      "is no session: sent as %s it is a 401, and nothing is read",
      async (carrier: Carrier) => {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(signIn.token(), carrier);

        const result: HttpResult = await post({
          path: route.path,
          cookies: session.cookies,
          headers: { ...route.headers, ...session.headers },
        });

        expect(result.status).toBe(ExceptionCode.NotAuthenticatedException);
        expect(reached).toEqual([]);
      },
    );
  });

  test.each(CARRIERS)(
    "is no session even next to itself in its own place: sent as %s it is a 401",
    async (carrier: Carrier) => {
      const token: string = signIn.token();
      const session: {
        cookies: Dictionary<string>;
        headers: Dictionary<string>;
      } = asSession(token, carrier);
      const ownPlace: {
        cookies: Dictionary<string>;
        headers: Dictionary<string>;
      } = asSsoSignIn(signIn, token, "cookie");

      const result: HttpResult = await post({
        path: "/api/label/get-list",
        cookies: { ...session.cookies, ...ownPlace.cookies },
        headers: {
          tenantid: PROJECT_REQUIRING_SSO.toString(),
          ...session.headers,
          ...ownPlace.headers,
        },
      });

      expect(result.status).toBe(401);
      expect(reached).toEqual([]);
    },
  );

  test.each(["cookie", "header"] as Array<SsoCarrier>)(
    "still does what it is for: next to the member's session, sent as a %s, it opens the project that requires SSO",
    async (ssoCarrier: SsoCarrier) => {
      const ownPlace: {
        cookies: Dictionary<string>;
        headers: Dictionary<string>;
      } = asSsoSignIn(signIn, signIn.token(), ssoCarrier);

      const result: HttpResult = await post({
        path: "/api/label/get-list",
        cookies: {
          [CookieUtil.getUserTokenKey()]: sessionToken(),
          ...ownPlace.cookies,
        },
        headers: {
          tenantid: PROJECT_REQUIRING_SSO.toString(),
          ...ownPlace.headers,
        },
      });

      expect(result.status).toBe(200);
      expect(reached.length).toBeGreaterThan(0);

      for (const read of reached) {
        expect(read).toEqual({
          what: expect.stringContaining("a project's labels"),
          userId: MEMBER_ID.toString(),
          tenantId: PROJECT_REQUIRING_SSO.toString(),
        });
      }
    },
  );
});

describe("the project that requires SSO", () => {
  test("refuses the member's session without an SSO sign-in", async () => {
    const result: HttpResult = await post({
      path: "/api/label/get-list",
      cookies: { [CookieUtil.getUserTokenKey()]: sessionToken() },
      headers: { tenantid: PROJECT_REQUIRING_SSO.toString() },
    });

    expect(result.status).toBe(ExceptionCode.SsoAuthorizationException);
    expect(reached).toEqual([]);
  });

  test("does not take a session token put where an SSO sign-in goes", async () => {
    for (const carrier of ["cookie", "header"] as Array<SsoCarrier>) {
      for (const slot of ["project", "global"] as Array<SsoSlot>) {
        const ownPlace: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSsoSignIn(
          { name: "a session", slot: slot, token: sessionToken },
          sessionToken(),
          carrier,
        );

        const result: HttpResult = await post({
          path: "/api/label/get-list",
          cookies: {
            [CookieUtil.getUserTokenKey()]: sessionToken(),
            ...ownPlace.cookies,
          },
          headers: {
            tenantid: PROJECT_REQUIRING_SSO.toString(),
            ...ownPlace.headers,
          },
        });

        expect({ carrier, slot, status: result.status }).toEqual({
          carrier,
          slot,
          status: ExceptionCode.SsoAuthorizationException,
        });
      }
    }

    expect(reached).toEqual([]);
  });
});

describe("a status page private user's session", () => {
  test.each(CARRIERS)(
    "is no dashboard session: sent as %s it is a 401 everywhere, and nothing is read",
    async (carrier: Carrier) => {
      for (const route of ROUTES) {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(statusPageSessionToken(), carrier);

        const result: HttpResult = await post({
          path: route.path,
          cookies: session.cookies,
          headers: { ...route.headers, ...session.headers },
        });

        expect({ route: route.name, status: result.status }).toEqual({
          route: route.name,
          status: 401,
        });
      }

      expect(reached).toEqual([]);
    },
  );
});
