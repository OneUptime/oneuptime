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
import OnCallPageLinkToken from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Label from "../../../Models/DatabaseModels/Label";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
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

// A label of a project, for the requests that name one.
const LABEL_ID: ObjectID = new ObjectID("1a2b3c4d-1a2b-4c3d-8e4f-1a2b3c4d5e6f");

// Another member of the same projects, who signs in with SSO too.
const OTHER_MEMBER_ID: ObjectID = new ObjectID(
  "9f8e7d6c-9f8e-4d7c-8b6a-9f8e7d6c5b4a",
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

  /*
   * With billing on (as CI runs), a request in a project carries its plan:
   * the highest one, paid, so that no plan decides what is asked here.
   */
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

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

  // And what one that gets through reads one of, or writes.
  jest.spyOn(LabelService, "findOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Label> => {
    record("a project's labels (read one)", data.props);
    const label: Label = new Label();
    label.id = LABEL_ID;
    return label;
  }) as never);
  jest.spyOn(LabelService, "create").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Label> => {
    record("a project's labels (create)", data.props);
    const label: Label = new Label();
    label.id = LABEL_ID;
    return label;
  }) as never);
  jest.spyOn(LabelService, "updateOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("a project's labels (update)", data.props);
    return 1;
  }) as never);
  jest.spyOn(LabelService, "deleteOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("a project's labels (delete)", data.props);
    return 1;
  }) as never);
  jest.spyOn(UserService, "updateOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("the member's own account (update)", data.props);
    return 1;
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
  return send({
    method: "POST",
    path: data.path,
    cookies: data.cookies,
    headers: data.headers,
    body: { query: {}, select: { _id: true } },
  });
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function send(data: {
  method: HttpMethod;
  path: string;
  cookies?: Dictionary<string> | undefined;
  headers?: Dictionary<string> | undefined;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.body ? JSON.stringify(data.body) : "";

      const headers: http.OutgoingHttpHeaders = {
        ...(payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : {}),
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
          method: data.method,
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

      if (payload) {
        request.write(payload);
      }

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

/*
 * The member's access token as the release before signed it: every claim
 * it held, and no purpose. A server of that release still signs them while
 * an upgrade rolls out, so they are still sessions - and only for the
 * fifteen minutes such a token lived.
 */
function earlierReleaseAccessToken(expiresInSeconds: number): string {
  return JSONWebToken.signJsonPayload(
    {
      userId: MEMBER_ID.toString(),
      email: "member@example.com",
      name: "Member",
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: false,
      sessionId: ObjectID.generate().toString(),
      projectId: "",
    },
    expiresInSeconds,
  );
}

const SESSIONS: Array<{ name: string; token: () => string }> = [
  { name: "the member's own session", token: sessionToken },
  {
    name: "the member's access token an earlier release signed",
    token: (): string => {
      return earlierReleaseAccessToken(15 * 60);
    },
  },
];

describe.each(SESSIONS)("$name", ({ token }: { token: () => string }) => {
  test.each(CARRIERS)(
    "gets them their own account and their project, sent as %s",
    async (carrier: Carrier) => {
      for (const route of ROUTES) {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(token(), carrier);

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

describe("the same claims, signed for thirty days without saying what they are for", () => {
  test.each(CARRIERS)(
    "are no session: sent as %s they are a 401 everywhere, and nothing is read",
    async (carrier: Carrier) => {
      for (const route of ROUTES) {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(
          earlierReleaseAccessToken(THIRTY_DAYS_IN_SECONDS),
          carrier,
        );

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

/*
 * EVERY WAY THE API READS OR CHANGES A RECORD ASKS THE SAME QUESTION.
 *
 * A project's records are created, listed, counted, read, changed and
 * deleted through several requests each, and a person changes their own
 * account - the address a password reset is sent to - through another.
 * Every one of them asks the one user middleware who is asking, so an SSO
 * sign-in sent as the session is a 401 at each, and nothing is read or
 * written. The member's own session gets through to each of them, so the
 * 401 is the token's and not the route's.
 */
interface ApiRequest {
  name: string;
  method: HttpMethod;
  path: string;
  headers: Dictionary<string>;
  body?: JSONObject | undefined;
}

const IN_A_PROJECT: Dictionary<string> = { tenantid: OTHER_PROJECT.toString() };
const A_LABEL: string = `/api/label/${LABEL_ID.toString()}`;

const API_REQUESTS: Array<ApiRequest> = [
  {
    name: "create a label",
    method: "POST",
    path: "/api/label",
    headers: IN_A_PROJECT,
    body: { data: { name: "Escalated" } },
  },
  {
    name: "list labels",
    method: "POST",
    path: "/api/label/get-list",
    headers: IN_A_PROJECT,
    body: { query: {}, select: { _id: true } },
  },
  {
    name: "list labels with a GET",
    method: "GET",
    path: "/api/label/get-list",
    headers: IN_A_PROJECT,
  },
  {
    name: "count labels",
    method: "POST",
    path: "/api/label/count",
    headers: IN_A_PROJECT,
    body: { query: {} },
  },
  {
    name: "read a label",
    method: "POST",
    path: `${A_LABEL}/get-item`,
    headers: IN_A_PROJECT,
    body: { select: { _id: true } },
  },
  {
    name: "read a label with a GET",
    method: "GET",
    path: `${A_LABEL}/get-item`,
    headers: IN_A_PROJECT,
  },
  {
    name: "rename a label",
    method: "PUT",
    path: A_LABEL,
    headers: IN_A_PROJECT,
    body: { data: { name: "Renamed" } },
  },
  {
    name: "rename a label with a POST",
    method: "POST",
    path: `${A_LABEL}/update-item`,
    headers: IN_A_PROJECT,
    body: { data: { name: "Renamed" } },
  },
  {
    name: "delete a label",
    method: "DELETE",
    path: A_LABEL,
    headers: IN_A_PROJECT,
  },
  {
    name: "delete a label with a POST",
    method: "POST",
    path: `${A_LABEL}/delete-item`,
    headers: IN_A_PROJECT,
  },
  {
    name: "change the email address of their own account",
    method: "PUT",
    path: `/api/user/${MEMBER_ID.toString()}`,
    headers: {},
    body: { data: { email: "someone.else@example.com" } },
  },
];

describe("every way the API reads or changes a record", () => {
  test.each(API_REQUESTS)(
    "$name: the member's own session gets through, as the member",
    async (request: ApiRequest) => {
      const result: HttpResult = await send({
        method: request.method,
        path: request.path,
        cookies: { [CookieUtil.getUserTokenKey()]: sessionToken() },
        headers: request.headers,
        body: request.body,
      });

      expect(result.status).toBe(200);
      expect(reached.length).toBeGreaterThan(0);

      for (const read of reached) {
        expect(read.userId).toBe(MEMBER_ID.toString());
      }
    },
  );

  describe.each(SSO_SIGN_INS)("$name", (signIn: SsoSignIn) => {
    test.each(API_REQUESTS)(
      "is no session to $name: a 401 as the cookie and as a bearer, and nothing is read or written",
      async (request: ApiRequest) => {
        for (const carrier of CARRIERS) {
          const session: {
            cookies: Dictionary<string>;
            headers: Dictionary<string>;
          } = asSession(signIn.token(), carrier);

          const result: HttpResult = await send({
            method: request.method,
            path: request.path,
            cookies: session.cookies,
            headers: { ...request.headers, ...session.headers },
            body: request.body,
          });

          expect({ carrier, status: result.status }).toEqual({
            carrier,
            status: ExceptionCode.NotAuthenticatedException,
          });
        }

        expect(reached).toEqual([]);
      },
    );
  });
});

/*
 * NO OTHER TOKEN THIS SERVER SIGNS IS A SESSION EITHER.
 *
 * Every other token signed with the same key, made where the product makes
 * it (or, for those a route makes inline, claim for claim): none names a
 * session, so sent where the session goes it is a 401 everywhere - and put
 * where an SSO sign-in goes, next to the member's session, it satisfies no
 * project's SSO.
 */
function cookieValueOf(set: (response: ExpressResponse) => void): string {
  let value: string = "";

  set({
    cookie: (_name: string, cookieValue: string): void => {
      value = cookieValue;
    },
  } as unknown as ExpressResponse);

  return value;
}

const OTHER_TOKENS: Array<{ name: string; token: () => string }> = [
  {
    name: "a status page's master-password cookie",
    token: (): string => {
      return cookieValueOf((response: ExpressResponse): void => {
        CookieUtil.setStatusPageMasterPasswordCookie({
          expressResponse: response,
          statusPageId: STATUS_PAGE_ID,
        });
      });
    },
  },
  {
    name: "a public dashboard's master-password cookie",
    token: (): string => {
      return cookieValueOf((response: ExpressResponse): void => {
        CookieUtil.setDashboardMasterPasswordCookie({
          expressResponse: response,
          dashboardId: LABEL_ID,
        });
      });
    },
  },
  {
    name: "an on-call page link",
    token: (): string => {
      return OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: ObjectID.generate(),
      });
    },
  },
  {
    name: "a sign-in in flight through an identity provider",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          state: ObjectID.generate().toString(),
          nonce: ObjectID.generate().toString(),
          codeVerifier: ObjectID.generate().toString(),
          isMobile: false,
        },
        10 * 60,
      );
    },
  },
  {
    name: "a reseller's token",
    token: (): string => {
      return JSONWebToken.sign({
        data: { resellerId: "reseller" },
        expiresInSeconds: OneUptimeDate.getDayInSeconds(365),
      });
    },
  },
  {
    name: "a phone call's keypad answers",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        JSONFunctions.serialize({
          "1": { sayMessage: "Acknowledged." },
          default: { sayMessage: "Goodbye." },
        }),
        OneUptimeDate.getDayInSeconds(),
      );
    },
  },
];

describe.each(OTHER_TOKENS)("$name", ({ token }: { token: () => string }) => {
  test.each(CARRIERS)(
    "is no session: sent as %s it is a 401 everywhere, and nothing is read",
    async (carrier: Carrier) => {
      for (const route of ROUTES) {
        const session: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSession(token(), carrier);

        const result: HttpResult = await post({
          path: route.path,
          cookies: session.cookies,
          headers: { ...route.headers, ...session.headers },
        });

        expect({ route: route.name, status: result.status }).toEqual({
          route: route.name,
          status: ExceptionCode.NotAuthenticatedException,
        });
      }

      expect(reached).toEqual([]);
    },
  );

  test("satisfies no project's SSO, put where an SSO sign-in goes next to the member's session", async () => {
    for (const carrier of ["cookie", "header"] as Array<SsoCarrier>) {
      for (const slot of ["project", "global"] as Array<SsoSlot>) {
        const ownPlace: {
          cookies: Dictionary<string>;
          headers: Dictionary<string>;
        } = asSsoSignIn(
          { name: "another token", slot: slot, token: token },
          token(),
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

/*
 * AN SSO SIGN-IN IS ONE PERSON'S.
 *
 * Another member's SSO sign-in - every kind of it, in its own place, as
 * the web or the mobile app sends it - does not let this member's session
 * into a project that requires SSO: an SSO sign-in counts only next to a
 * session of the person who signed in.
 */
function otherMember(): User {
  const user: User = new User();
  user.id = OTHER_MEMBER_ID;
  user.email = new Email("other.member@example.com");
  user.name = new Name("Other Member");
  return user;
}

const OTHER_MEMBERS_SSO_SIGN_INS: Array<SsoSignIn> = [
  {
    name: "another member's project SAML sign-in",
    slot: "project",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: otherMember(),
        projectId: PROJECT_REQUIRING_SSO,
        ssoProviderId: PROJECT_SAML_ID,
        ssoProviderType: SsoProviderType.ProjectSSO,
      });
    },
  },
  {
    name: "another member's project OIDC sign-in",
    slot: "project",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: otherMember(),
        projectId: PROJECT_REQUIRING_SSO,
        ssoProviderId: PROJECT_OIDC_ID,
        ssoProviderType: SsoProviderType.ProjectOIDC,
      });
    },
  },
  {
    name: "another member's Global SAML sign-in",
    slot: "global",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: otherMember(),
        ssoProviderId: GLOBAL_SAML_ID,
        ssoProviderType: SsoProviderType.GlobalSSO,
      });
    },
  },
  {
    name: "another member's Global OIDC sign-in",
    slot: "global",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: otherMember(),
        ssoProviderId: GLOBAL_OIDC_ID,
        ssoProviderType: SsoProviderType.GlobalOIDC,
      });
    },
  },
];

describe.each(OTHER_MEMBERS_SSO_SIGN_INS)("$name", (signIn: SsoSignIn) => {
  test.each(["cookie", "header"] as Array<SsoCarrier>)(
    "does not let this member's session into the project that requires SSO, sent as a %s",
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

      expect(result.status).toBe(ExceptionCode.SsoAuthorizationException);
      expect(reached).toEqual([]);
    },
  );

  test.each(CARRIERS)(
    "is no session for anyone: sent as %s it is a 401",
    async (carrier: Carrier) => {
      const session: {
        cookies: Dictionary<string>;
        headers: Dictionary<string>;
      } = asSession(signIn.token(), carrier);

      const result: HttpResult = await post({
        path: "/api/user/get-list",
        cookies: session.cookies,
        headers: session.headers,
      });

      expect(result.status).toBe(ExceptionCode.NotAuthenticatedException);
      expect(reached).toEqual([]);
    },
  );
});
