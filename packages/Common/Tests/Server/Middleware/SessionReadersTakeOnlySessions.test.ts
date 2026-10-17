import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  ProjectScopedSsoSignIn,
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken, {
  PURPOSE_CLAIM,
} from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import {
  NOT_A_MASTER_ADMIN_MESSAGE,
  ensureMasterAdminPageAccess,
} from "../../../Server/Utils/MasterAdminPageAccess";
import RealtimeJoinAccess, {
  RealtimeJoinDecision,
  RealtimeJoinRefusal,
} from "../../../Server/Utils/Realtime/RealtimeJoinAccess";
import Response from "../../../Server/Utils/Response";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EVERY PLACE THAT READS A SESSION TAKES ONLY A SESSION.
 *
 * A session is the fifteen-minute access token of one UserSession, which
 * says it is one (JsonWebTokenPurpose.UserSession). Every other token
 * OneUptime signs with the same key is refused wherever a session is read,
 * exactly as a token that does not verify: an SSO sign-in (thirty days, and
 * no session behind it), a status page private user's session, and an
 * access token from before tokens said what they were for, which the client
 * renews on the 401.
 *
 * The places that read a session, each run here on the real middleware with
 * tokens signed for real (only the datastore lookups behind them stubbed):
 *
 *   - readRequestSession and getSessionUser, which every API request and
 *     the image routes read;
 *   - getUserMiddleware and its public-route variant;
 *   - both master-admin gates, and the Admin Dashboard shell;
 *   - the realtime join, which asks readRequestSession.
 *
 * And the other way round: the SSO readers take only SSO sign-ins, so a
 * session put where an SSO sign-in goes satisfies no Require SSO.
 */

const USER_ID: ObjectID = new ObjectID("5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a");
const PROJECT_ID: ObjectID = new ObjectID(
  "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b",
);
const PROVIDER_ID: ObjectID = new ObjectID(
  "7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c",
);

const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;

function member(): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("member@example.com");
  user.name = new Name("Member");
  user.isMasterAdmin = true;
  return user;
}

function sessionToken(isMasterAdmin: boolean = false): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("member@example.com"),
      name: new Name("Member"),
      timezone: null,
      isMasterAdmin: isMasterAdmin,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

interface NotASession {
  name: string;
  token: () => string;
}

/*
 * Everything OneUptime signs that names this person and is no session. The
 * person is a master admin, so a gate that took any of these for a session
 * would have every reason to let it through.
 */
const NOT_SESSIONS: Array<NotASession> = [
  ...Object.values(SsoProviderType).map(
    (providerType: SsoProviderType): NotASession => {
      return {
        name: `a project sign-in through a ${providerType} provider`,
        token: (): string => {
          return CookieUtil.getSSOToken({
            user: member(),
            projectId: PROJECT_ID,
            ssoProviderId: PROVIDER_ID,
            ssoProviderType: providerType,
          });
        },
      };
    },
  ),
  ...[SsoProviderType.GlobalSSO, SsoProviderType.GlobalOIDC].map(
    (providerType: SsoProviderType): NotASession => {
      return {
        name: `a sign-in through a ${providerType} provider for the whole server`,
        token: (): string => {
          return CookieUtil.getGlobalSSOToken({
            user: member(),
            ssoProviderId: PROVIDER_ID,
            ssoProviderType: providerType,
          });
        },
      };
    },
  ),
  {
    name: "an SSO sign-in an earlier release gave",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: USER_ID.toString(),
          projectId: PROJECT_ID.toString(),
          name: "Member",
          email: "member@example.com",
          isMasterAdmin: false,
          isGeneralLogin: false,
          ssoProviderId: PROVIDER_ID.toString(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        },
        THIRTY_DAYS_IN_SECONDS,
      );
    },
  },
  {
    name: "a status page private user's session",
    token: (): string => {
      const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
      privateUser.id = USER_ID;
      privateUser.email = new Email("member@example.com");

      return CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: {
          cookie: (): void => {
            // Only the token is read here.
          },
        } as unknown as ExpressResponse,
        user: privateUser,
        statusPageId: ObjectID.generate(),
        sessionId: ObjectID.generate(),
        refreshToken: ObjectID.generate().toString(),
        refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
      });
    },
  },
  {
    name: "a master admin's access token an earlier release signed",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: USER_ID.toString(),
          email: "member@example.com",
          name: "Member",
          timezone: null,
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: ObjectID.generate().toString(),
          projectId: "",
        },
        15 * 60,
      );
    },
  },
  {
    name: "a master admin's claims re-signed from a decoded session, without saying it is one",
    token: (): string => {
      return JSONWebToken.sign({
        data: JSONWebToken.decode(
          sessionToken(true),
          JsonWebTokenPurpose.UserSession,
        ),
        expiresInSeconds: 15 * 60,
      });
    },
  },
];

type Carrier = "cookie" | "bearer";

const CARRIERS: Array<Carrier> = ["cookie", "bearer"];

function requestWith(
  token: string,
  carrier: Carrier,
  extra: { cookies?: Dictionary<string>; headers?: Dictionary<string> } = {},
): OneUptimeRequest {
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
  } as unknown as OneUptimeRequest;
}

type Middleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

interface MiddlewareRun {
  nextCalls: Array<Array<unknown>>;
  sentErrors: Array<Exception>;
}

let sentErrors: Array<Exception> = [];
let isUserBlocked: jest.SpyInstance;

async function run(
  middleware: Middleware,
  req: OneUptimeRequest,
): Promise<MiddlewareRun> {
  sentErrors = [];
  const next: jest.Mock = jest.fn();

  await middleware(
    req as ExpressRequest,
    { set: jest.fn() } as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    nextCalls: next.mock.calls as Array<Array<unknown>>,
    sentErrors: [...sentErrors],
  };
}

function expectAskedToSignIn(result: MiddlewareRun): void {
  expect(result.nextCalls).toEqual([]);
  expect(result.sentErrors).toHaveLength(1);
  expect(result.sentErrors[0]).toBeInstanceOf(NotAuthenticatedException);
  expect(result.sentErrors[0]?.code).toBe(401);
}

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [PROJECT_ID],
  globalPermissions: [Permission.Public, Permission.User],
};

const TENANT_PERMISSION: UserTenantAccessPermission = {
  _type: "UserTenantAccessPermission",
  projectId: PROJECT_ID,
  permissions: [
    {
      _type: "UserPermission",
      permission: Permission.ProjectMember,
      labelIds: [],
      isBlockPermission: false,
    },
  ],
} as UserTenantAccessPermission;

beforeEach(() => {
  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(((
    _req: unknown,
    _res: unknown,
    error: Exception,
  ): void => {
    sentErrors.push(error);
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  getJestSpyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });

  isUserBlocked = getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
    false,
  );
  getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
    false,
  );
  getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  getJestSpyOn(GlobalConfigService, "getRequireSsoForLogin").mockResolvedValue(
    false,
  );
  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(GLOBAL_PERMISSION);
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockResolvedValue(TENANT_PERMISSION);
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readRequestSession and getSessionUser", () => {
  test.each(CARRIERS)(
    "read the member's session, sent as a %s",
    async (carrier: Carrier) => {
      const read: RequestSession = await UserMiddleware.readRequestSession(
        requestWith(sessionToken(), carrier),
      );

      expect(read.kind).toBe("user");
      expect(
        (
          await UserMiddleware.getSessionUser(
            requestWith(sessionToken(), carrier),
          )
        )?.userId.toString(),
      ).toBe(USER_ID.toString());
    },
  );

  describe.each(NOT_SESSIONS)("$name", ({ token }: NotASession) => {
    test.each(CARRIERS)(
      "is no session, sent as a %s, and nobody is looked up for it",
      async (carrier: Carrier) => {
        const read: RequestSession = await UserMiddleware.readRequestSession(
          requestWith(token(), carrier),
        );

        expect(read.kind).toBe("invalid");
        expect(
          await UserMiddleware.getSessionUser(requestWith(token(), carrier)),
        ).toBeNull();
        expect(isUserBlocked).not.toHaveBeenCalled();
      },
    );
  });
});

describe("the user middleware every authenticated route mounts", () => {
  test("takes the member's session", async () => {
    const req: OneUptimeRequest = requestWith(sessionToken(), "bearer", {
      headers: { tenantid: PROJECT_ID.toString() },
    });

    const result: MiddlewareRun = await run(
      UserMiddleware.getUserMiddleware,
      req,
    );

    expect(result.sentErrors).toEqual([]);
    expect(result.nextCalls).toEqual([[]]);
    expect(req.userType).toBe(UserType.User);
    expect(req.userAuthorization?.userId.toString()).toBe(USER_ID.toString());
  });

  describe.each(NOT_SESSIONS)("$name", ({ token }: NotASession) => {
    test.each(CARRIERS)(
      "sent as a %s, is asked to sign in (401), and the request is nobody's",
      async (carrier: Carrier) => {
        const req: OneUptimeRequest = requestWith(token(), carrier, {
          headers: { tenantid: PROJECT_ID.toString() },
        });

        expectAskedToSignIn(await run(UserMiddleware.getUserMiddleware, req));
        expect(req.userAuthorization).toBeUndefined();
        expect(req.userType).not.toBe(UserType.User);
        expect(req.userType).not.toBe(UserType.MasterAdmin);
        expect(req.userTenantAccessPermission).toBeUndefined();
      },
    );

    test.each(CARRIERS)(
      "sent as a %s to a public route, is served as nobody at all",
      async (carrier: Carrier) => {
        const req: OneUptimeRequest = requestWith(token(), carrier);

        const result: MiddlewareRun = await run(
          UserMiddleware.getPublicRouteUserMiddleware,
          req,
        );

        expect(result.sentErrors).toEqual([]);
        expect(result.nextCalls).toEqual([[]]);
        expect(req.userType).toBe(UserType.Public);
        expect(req.userAuthorization).toBeUndefined();
      },
    );
  });
});

describe("the master-admin gates", () => {
  const GATES: Array<{ name: string; middleware: Middleware }> = [
    {
      name: "the session gate",
      middleware: MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    },
    {
      name: "the session-or-master-API-key gate",
      middleware:
        MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    },
  ];

  test.each(GATES)(
    "$name lets a master admin's session through",
    async ({ middleware }: { middleware: Middleware }) => {
      const result: MiddlewareRun = await run(
        middleware,
        requestWith(sessionToken(true), "bearer"),
      );

      expect(result.sentErrors).toEqual([]);
      expect(result.nextCalls).toEqual([[]]);
    },
  );

  describe.each(NOT_SESSIONS)("$name", ({ token }: NotASession) => {
    test.each(GATES)(
      "is asked to sign in at $name, as a cookie or a bearer token",
      async ({ middleware }: { middleware: Middleware }) => {
        for (const carrier of CARRIERS) {
          expectAskedToSignIn(
            await run(middleware, requestWith(token(), carrier)),
          );
        }
      },
    );
  });
});

describe("the Admin Dashboard shell", () => {
  async function shellFor(token: string): Promise<Array<Exception>> {
    sentErrors = [];

    await ensureMasterAdminPageAccess({
      req: requestWith(token, "cookie") as ExpressRequest,
      res: {} as ExpressResponse,
      service: "admin-dashboard",
    });

    return [...sentErrors];
  }

  test("is refused to the session of someone who is not a master admin", async () => {
    const refused: Array<Exception> = await shellFor(sessionToken(false));

    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(NotAuthorizedException);
    expect(refused[0]?.message).toBe(NOT_A_MASTER_ADMIN_MESSAGE);
  });

  test("is served to a master admin's session", async () => {
    expect(await shellFor(sessionToken(true))).toEqual([]);
  });

  test.each(NOT_SESSIONS)(
    "is served to $name as to someone signed out, who the app then sends to sign in",
    async ({ token }: NotASession) => {
      expect(await shellFor(token())).toEqual([]);
    },
  );
});

describe("the realtime join", () => {
  function socketWith(
    token: string,
    carrier: Carrier,
  ): { handshake: { headers: Dictionary<string> } } {
    return {
      handshake: {
        headers:
          carrier === "cookie"
            ? { cookie: `${CookieUtil.getUserTokenKey()}=${token}` }
            : { authorization: `Bearer ${token}` },
      },
    };
  }

  test.each(CARRIERS)(
    "lets the member's session join their project, sent as a %s",
    async (carrier: Carrier) => {
      const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
        socketWith(sessionToken(), carrier),
        PROJECT_ID.toString(),
      );

      expect(decision.allowed).toBe(true);
    },
  );

  describe.each(NOT_SESSIONS)("$name", ({ token }: NotASession) => {
    test.each(CARRIERS)(
      "joins nothing, sent as a %s: the socket is asked to sign in",
      async (carrier: Carrier) => {
        const decision: RealtimeJoinDecision = await RealtimeJoinAccess.decide(
          socketWith(token(), carrier),
          PROJECT_ID.toString(),
        );

        expect(decision).toEqual({
          allowed: false,
          refusal: RealtimeJoinRefusal.AuthenticationRequired,
        });
      },
    );
  });
});

describe("the SSO readers take only SSO sign-ins", () => {
  /*
   * The worst case: a token this server signed as a session that also
   * carries everything an SSO sign-in for this project carries. A session
   * is never an SSO sign-in, whatever else it holds.
   */
  function sessionDressedAsSsoSignIn(providerType: SsoProviderType): string {
    return JSONWebToken.signJsonPayload(
      {
        userId: USER_ID.toString(),
        email: "member@example.com",
        name: "Member",
        isMasterAdmin: false,
        sessionId: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        ssoProviderId: PROVIDER_ID.toString(),
        ssoProviderType: providerType,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
      },
      THIRTY_DAYS_IN_SECONDS,
    );
  }

  function ssoSlots(token: string): Array<{
    name: string;
    cookies: Dictionary<string>;
    headers: Dictionary<string>;
  }> {
    return [
      {
        name: "the project's sso- cookie",
        cookies: { [CookieUtil.getUserSSOKey(PROJECT_ID)]: token },
        headers: {},
      },
      {
        name: "the mobile app's x-sso-tokens header",
        cookies: {},
        headers: {
          "x-sso-tokens": JSON.stringify({ [PROJECT_ID.toString()]: token }),
        },
      },
      {
        name: "the global-sso-token cookie",
        cookies: { [CookieUtil.getGlobalSSOKey()]: token },
        headers: {},
      },
      {
        name: "the mobile app's x-global-sso-token header",
        cookies: {},
        headers: { "x-global-sso-token": token },
      },
    ];
  }

  test("an SSO sign-in in its own place is read as one", () => {
    const projectSignIn: string = CookieUtil.getSSOToken({
      user: member(),
      projectId: PROJECT_ID,
      ssoProviderId: PROVIDER_ID,
      ssoProviderType: SsoProviderType.ProjectSSO,
    });
    const globalSignIn: string = CookieUtil.getGlobalSSOToken({
      user: member(),
      ssoProviderId: PROVIDER_ID,
      ssoProviderType: SsoProviderType.GlobalSSO,
    });

    const projectRead: ProjectScopedSsoSignIn | null =
      UserMiddleware.getStatelessValidProjectScopedSsoSignIn(
        requestWith(sessionToken(), "cookie", {
          cookies: { [CookieUtil.getUserSSOKey(PROJECT_ID)]: projectSignIn },
        }) as ExpressRequest,
        PROJECT_ID,
        USER_ID,
      );

    expect(projectRead?.tokenData.ssoProviderId?.toString()).toBe(
      PROVIDER_ID.toString(),
    );
    expect(
      UserMiddleware.getGlobalSsoTokenData(
        requestWith(sessionToken(), "cookie", {
          cookies: { [CookieUtil.getGlobalSSOKey()]: globalSignIn },
        }) as ExpressRequest,
      )?.ssoProviderType,
    ).toBe(SsoProviderType.GlobalSSO);
  });

  test.each(Object.values(SsoProviderType))(
    "a session that also carries a %s sign-in's claims counts as no SSO sign-in, wherever it is put",
    (providerType: SsoProviderType) => {
      const dressed: string = sessionDressedAsSsoSignIn(providerType);

      for (const slot of ssoSlots(dressed)) {
        const req: ExpressRequest = requestWith(sessionToken(), "cookie", {
          cookies: slot.cookies,
          headers: slot.headers,
        }) as ExpressRequest;

        expect({
          slot: slot.name,
          tokens: UserMiddleware.getSsoTokens(req),
        }).toEqual({ slot: slot.name, tokens: {} });
        expect({
          slot: slot.name,
          global: UserMiddleware.getGlobalSsoTokenData(req),
        }).toEqual({ slot: slot.name, global: null });
        expect({
          slot: slot.name,
          exists: UserMiddleware.doesSsoTokenForProjectExist(
            req,
            PROJECT_ID,
            USER_ID,
          ),
        }).toEqual({ slot: slot.name, exists: false });
      }
    },
  );

  test("the member's own session put where an SSO sign-in goes counts as no SSO sign-in", () => {
    for (const slot of ssoSlots(sessionToken())) {
      const req: ExpressRequest = requestWith(sessionToken(), "cookie", {
        cookies: slot.cookies,
        headers: slot.headers,
      }) as ExpressRequest;

      expect(
        UserMiddleware.doesSsoTokenForProjectExist(req, PROJECT_ID, USER_ID),
      ).toBe(false);
      expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    }
  });

  test("a status page private user's session put where an SSO sign-in goes counts as no SSO sign-in", () => {
    const statusPageSession: string = NOT_SESSIONS.find(
      (kind: NotASession): boolean => {
        return kind.name === "a status page private user's session";
      },
    )!.token();

    for (const slot of ssoSlots(statusPageSession)) {
      const req: ExpressRequest = requestWith(sessionToken(), "cookie", {
        cookies: slot.cookies,
        headers: slot.headers,
      }) as ExpressRequest;

      expect(UserMiddleware.getSsoTokens(req)).toEqual({});
      expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    }
  });

  test("a token that says it is something this server does not know is no SSO sign-in", () => {
    const unknown: string = JSONWebToken.signJsonPayload(
      {
        userId: USER_ID.toString(),
        email: "member@example.com",
        projectId: PROJECT_ID.toString(),
        ssoProviderId: PROVIDER_ID.toString(),
        ssoProviderType: SsoProviderType.GlobalSSO,
        [PURPOSE_CLAIM]: "sso-sign-in-v2",
      },
      THIRTY_DAYS_IN_SECONDS,
    );

    for (const slot of ssoSlots(unknown)) {
      const req: ExpressRequest = requestWith(sessionToken(), "cookie", {
        cookies: slot.cookies,
        headers: slot.headers,
      }) as ExpressRequest;

      expect(UserMiddleware.getSsoTokens(req)).toEqual({});
      expect(UserMiddleware.getGlobalSsoTokenData(req)).toBeNull();
    }
  });
});
