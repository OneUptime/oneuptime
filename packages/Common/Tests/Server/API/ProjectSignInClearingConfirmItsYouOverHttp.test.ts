jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
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
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import ProjectAPI from "../../../Server/API/ProjectAPI";
import UserAPI from "../../../Server/API/UserAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneByID from "../../../Server/Types/Database/FindOneByID";
import { ExpressRouter } from "../../../Server/Utils/Express";
import LocalSignInClearing from "../../../Server/Utils/LocalSignInClearing";
import SignInSettingsClearedEmail from "../../../Server/Utils/SignInSettingsClearedEmail";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import {
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  REAUTHENTICATION_ROUTE,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationPurpose,
  ReauthenticationStatus,
  readReauthenticationStatus,
  SignInAgainProvider,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  getProjectSavedSignInSettingsRoute,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
  toSavedSignInSettingsOfPeopleRequestJSON,
} from "../../../Types/SSO/LocalSignInClearing";
import { getJestSpyOn } from "../../Spy";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  confirmedKeyOf,
  MINUTE_IN_MS,
  PASSWORD_ACCOUNT,
  REAUTH_OTHER_SESSION_ID,
  REAUTH_PROJECT_ID,
  REAUTH_SESSION_ID,
  REAUTH_SSO_PROVIDER_ID,
  REAUTH_USER_ID,
  RIGHT_CODE,
  RIGHT_PASSWORD,
  SSO_ONLY_ACCOUNT,
  StandInAccount,
  StandInValkey,
  standInAccount,
  TWO_FACTOR_ACCOUNT,
} from "../TestingUtils/ReauthenticationStandIns";
import { readQueryValues } from "../TestingUtils/SsoManagedProjects";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

// jsdom has no setImmediate, and Express needs it.
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A PROJECT OWNER CONFIRMS IT'S THEM BEFORE CLEARING THEIR PEOPLE'S SAVED
 * SIGN-IN SETTINGS (#10775), OVER HTTP.
 *
 *   POST /project/:id/saved-sign-in-settings/clear
 *   POST /project/:id/saved-sign-in-settings/people/:userId/clear
 *
 * A master admin's clear has asked the session to confirm it's its
 * person's since #10216; an owner's did not, so a stolen or unattended
 * owner session could strip every person of the organization of their
 * passwords, passkeys and second steps. Pinned end to end here: a real HTTP
 * request to a real Express app, through the real ProjectAPI and UserAPI
 * routers, the real request middleware, the route's owner check, the real
 * Confirm It's You check (Server/Utils/Reauthentication) against Valkey in
 * memory, and its real confirmation, POST /api/user/reauthentication. Only
 * the storage is stood in: the session the middleware reads, the owner's
 * account and session row (ReauthenticationStandIns), the permission rows,
 * the project and its memberships, who has settings saved, and the clear's
 * writes, audit entries and emails.
 *
 *   - both clears refuse a session that has not confirmed, with the code the
 *     Dashboard's prompt acts on and the words of a change to how someone
 *     else signs in (AdminChange), before anything is read or cleared;
 *   - confirmed through the real route, the very same request goes through;
 *   - a confirmation past the window, another session's, a token that names
 *     no session and Valkey out of reach confirm nothing;
 *   - the count and the list, which only read, never ask;
 *   - an owner who signs in only through SSO, with no password or passkey,
 *     clears once their provider confirmed a Sign In Again - and is told to
 *     sign in again otherwise. An account SSO made carries a password
 *     nobody was told, and is asked for it, as Confirm It's You asks today:
 *     #10528 decides what such an account should be asked.
 */

// The owner is the stand-in account: the session the check reads is theirs.
const OWNER_ID: ObjectID = REAUTH_USER_ID;
const ALICE_ID: ObjectID = new ObjectID("10775000-0000-4000-8000-0000000000b1");
const ACME_ID: ObjectID = new ObjectID("10775000-0000-4000-8000-0000000000c1");

const SETTINGS: LocalSignInSettings = {
  ...NO_LOCAL_SIGN_IN_SETTINGS,
  hasPassword: true,
  isTwoFactorAuthEnabled: true,
  authenticatorAppCount: 1,
  backupCodeCount: 10,
};

interface WorldMembership {
  userId: ObjectID;
  projectId: ObjectID;
  hasAcceptedInvitation: boolean;
}

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
}

const keyOf: (id: ObjectID | string) => string = (
  id: ObjectID | string,
): string => {
  return id.toString().toLowerCase();
};

const allow: (permissions: Array<Permission>) => Array<UserPermission> = (
  permissions: Array<Permission>,
): Array<UserPermission> => {
  return permissions.map((permission: Permission): UserPermission => {
    return { _type: "UserPermission", permission, labelIds: [] };
  });
};

let valkey: StandInValkey;
let account: StandInAccount;
let memberships: Array<WorldMembership>;
let ownerRows: Map<string, Array<UserPermission>>;
let session: RequestSession;
let listedSql: Array<string>;

let readSettings: jest.SpyInstance;
let clearPeople: jest.SpyInstance;
let recordCleared: jest.SpyInstance;
let notifyCleared: jest.SpyInstance;

let server: http.Server;
let port: number;

// The owner's session, as its access token names it - or names no session at all.
const signedIn: (withSession?: boolean) => void = (
  withSession: boolean = true,
): void => {
  session = {
    kind: "user",
    session: {
      userId: OWNER_ID,
      email: new Email("river@example.com"),
      isMasterAdmin: false,
      isGlobalLogin: true,
      ...(withSession ? { sessionId: REAUTH_SESSION_ID } : {}),
    } as unknown as JSONWebTokenData,
  } as RequestSession;
};

function send(data: {
  method: "GET" | "POST";
  path: string;
  tenantId?: ObjectID | undefined;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const isPost: boolean = data.method === "POST";
      const payload: string = JSON.stringify(data.body || {});
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: `/api${data.path}`,
          method: data.method,
          headers: {
            // A GET carries no body, so says it has none.
            ...(isPost
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(payload),
                }
              : { "content-length": 0 }),
            "user-agent": "jest",
            ...(data.tenantId ? { tenantid: data.tenantId.toString() } : {}),
          },
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
              body = null;
            }

            resolve({ status: response.statusCode || 0, raw, body });
          });
        },
      );

      outgoing.on("error", reject);

      if (isPost) {
        outgoing.write(payload);
      }

      outgoing.end();
    },
  );
}

// The two clears, by what they clear.
type ClearRoute = [string, () => Promise<HttpResult>];

const clearEveryone: () => Promise<HttpResult> =
  async (): Promise<HttpResult> => {
    return await send({
      method: "POST",
      path: getProjectClearSavedSignInSettingsRoute(ACME_ID.toString()),
      tenantId: ACME_ID,
    });
  };

const clearAlice: () => Promise<HttpResult> = async (): Promise<HttpResult> => {
  return await send({
    method: "POST",
    path: getProjectClearPersonSavedSignInSettingsRoute(
      ACME_ID.toString(),
      ALICE_ID.toString(),
    ),
    tenantId: ACME_ID,
  });
};

const CLEARS: Array<ClearRoute> = [
  ["the clear of everyone the owner may clear (Require SSO)", clearEveryone],
  ["the clear of one member (Users)", clearAlice],
];

// POST /api/user/reauthentication: the owner confirms it's them.
const confirm: (proof: JSONObject) => Promise<HttpResult> = async (
  proof: JSONObject,
): Promise<HttpResult> => {
  return await send({
    method: "POST",
    path: REAUTHENTICATION_ROUTE,
    body: proof,
  });
};

// GET /api/user/reauthentication: what the prompt would ask for.
const readStatus: () => Promise<ReauthenticationStatus> =
  async (): Promise<ReauthenticationStatus> => {
    const result: HttpResult = await send({
      method: "GET",
      path: REAUTHENTICATION_ROUTE,
    });

    expect(result.status).toBe(200);

    return readReauthenticationStatus(result.body)!;
  };

// A confirmation of this session kept in Valkey, made `minutesAgo` minutes ago.
const keptConfirmation: (sessionId: ObjectID, minutesAgo: number) => void = (
  sessionId: ObjectID,
  minutesAgo: number,
): void => {
  valkey.values.set(confirmedKeyOf(sessionId), {
    value: JSON.stringify({
      userId: keyOf(OWNER_ID),
      confirmedAt: Date.now() - minutesAgo * MINUTE_IN_MS,
    }),
    expiresAt: Date.now() + REAUTHENTICATION_WINDOW_IN_MINUTES * MINUTE_IN_MS,
  });
};

// The prompt's refusal: its code, what it is for, its words, and nothing else changed.
const expectAskedToConfirm: (result: HttpResult) => void = (
  result: HttpResult,
): void => {
  expect(result.status).toBe(400);
  expect(result.body?.[REFUSAL_CODE_FIELD]).toBe(
    REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  );
  expect(result.body?.[REAUTHENTICATION_PURPOSE_FIELD]).toBe(
    ReauthenticationPurpose.AdminChange,
  );
  expect(result.body?.["error"]).toBe(
    REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
  );
};

const expectNothingCleared: () => void = (): void => {
  // Not even read: the rule, who has settings, what they have.
  expect(listedSql).toEqual([]);
  expect(readSettings).not.toHaveBeenCalled();
  expect(clearPeople).not.toHaveBeenCalled();
  expect(recordCleared).not.toHaveBeenCalled();
  expect(notifyCleared).not.toHaveBeenCalled();
};

const expectAliceCleared: (result: HttpResult) => void = (
  result: HttpResult,
): void => {
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ peopleCleared: 1 });
  expect(clearPeople).toHaveBeenCalledTimes(1);
  expect(
    (clearPeople.mock.calls[0]![0] as { userIds: Array<ObjectID> }).userIds.map(
      keyOf,
    ),
  ).toEqual([keyOf(ALICE_ID)]);
  expect(recordCleared).toHaveBeenCalledTimes(1);
};

/*
 * The query of who has settings saved, as LocalSignInClearing builds it:
 * Alice has, among the people asked about.
 */
interface FakeQuery {
  where: (sql: string) => FakeQuery;
  andWhere: (sql: string, parameters: Record<string, unknown>) => FakeQuery;
  select: () => FakeQuery;
  getRawMany: () => Promise<Array<{ userId: string }>>;
}

const fakeQuery: () => FakeQuery = (): FakeQuery => {
  let asked: Array<string> = [];

  const query: FakeQuery = {
    where: (whereSql: string): FakeQuery => {
      listedSql.push(whereSql);
      return query;
    },
    andWhere: (
      _andSql: string,
      parameters: Record<string, unknown>,
    ): FakeQuery => {
      asked = ((parameters["userIds"] as Array<string>) || []).map(keyOf);
      return query;
    },
    select: (): FakeQuery => {
      return query;
    },
    getRawMany: async (): Promise<Array<{ userId: string }>> => {
      return asked
        .filter((userId: string): boolean => {
          return userId === keyOf(ALICE_ID);
        })
        .map((userId: string): { userId: string } => {
          return { userId };
        });
    },
  };

  return query;
};

const tenantPermission: (
  userId: ObjectID,
  projectId: ObjectID,
) => UserTenantAccessPermission | null = (
  userId: ObjectID,
  projectId: ObjectID,
): UserTenantAccessPermission | null => {
  const permissions: Array<UserPermission> | undefined =
    keyOf(userId) === keyOf(OWNER_ID)
      ? ownerRows.get(keyOf(projectId))
      : undefined;

  return permissions
    ? {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions,
      }
    : null;
};

const acmeRow: (id: ObjectID) => Project | null = (
  id: ObjectID,
): Project | null => {
  if (keyOf(id) !== keyOf(ACME_ID)) {
    return null;
  }

  const row: Project = new Project();
  row._id = ACME_ID.toString();
  row.name = "Acme";
  row.requireSsoForLogin = true;
  row.manageSignInWithSso = true;
  return row;
};

beforeAll(async () => {
  const app: express.Express = express();
  app.use(express.json());
  const router: ExpressRouter = express.Router();
  router.use(new ProjectAPI().getRouter());
  router.use(new UserAPI().getRouter());
  app.use("/api", router);
  app.use(expressErrorHandler);

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  valkey = new StandInValkey();
  account = { ...PASSWORD_ACCOUNT };
  memberships = [
    { userId: OWNER_ID, projectId: ACME_ID, hasAcceptedInvitation: true },
    { userId: ALICE_ID, projectId: ACME_ID, hasAcceptedInvitation: true },
  ];
  ownerRows = new Map<string, Array<UserPermission>>([
    [keyOf(ACME_ID), allow([Permission.ProjectOwner])],
  ]);
  listedSql = [];
  signedIn();

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  // The owner's account and the session they signed in to.
  standInAccount(() => {
    return account;
  });

  // The clear's lock on each person, held in memory (#10776).
  new InMemoryLocks().install();

  getJestSpyOn(UserMiddleware, "readRequestSession").mockImplementation(
    async (): Promise<RequestSession> => {
      return session;
    },
  );

  // What the middleware reads around the permissions: none of it decides here.
  getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(true);
  getJestSpyOn(
    ProjectService,
    "getRequireSsoWithSsoProviderId",
  ).mockResolvedValue(null);
  // The session signed in with the project's SSO, as opening it takes.
  getJestSpyOn(UserMiddleware, "isSsoSatisfiedForProject").mockResolvedValue(
    true,
  );
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);

  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockImplementation(
    async (userId: ObjectID): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds:
          keyOf(userId) === keyOf(OWNER_ID)
            ? Array.from(ownerRows.keys()).map((id: string): ObjectID => {
                return new ObjectID(id);
              })
            : [],
        globalPermissions: [
          Permission.Public,
          Permission.User,
          Permission.CurrentUser,
        ],
      };
    },
  );
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermission",
  ).mockImplementation(
    async (
      userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      return tenantPermission(userId, projectId);
    },
  );
  getJestSpyOn(
    AccessTokenService,
    "getUserTenantAccessPermissions",
  ).mockImplementation(
    async (
      userId: ObjectID,
      projectIds: Array<ObjectID>,
    ): Promise<Map<string, UserTenantAccessPermission | null>> => {
      return new Map<string, UserTenantAccessPermission | null>(
        projectIds.map(
          (
            projectId: ObjectID,
          ): [string, UserTenantAccessPermission | null] => {
            return [keyOf(projectId), tenantPermission(userId, projectId)];
          },
        ),
      );
    },
  );

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (data: FindOneByID<Project>): Promise<Project | null> => {
      return acmeRow(data.id as ObjectID);
    },
  );
  getJestSpyOn(ProjectService, "findBy").mockImplementation(
    async (data: FindBy<Project>): Promise<Array<Project>> => {
      return readQueryValues((data.query as Record<string, unknown>)["_id"])
        .map((id: string): Project | null => {
          return acmeRow(new ObjectID(id));
        })
        .filter((row: Project | null): boolean => {
          return Boolean(row);
        }) as Array<Project>;
    },
  );

  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(
    async (data: FindBy<TeamMember>): Promise<Array<TeamMember>> => {
      const query: Record<string, unknown> = data.query as Record<
        string,
        unknown
      >;

      if (Number(data.skip || 0) > 0) {
        return [];
      }

      return memberships
        .filter((membership: WorldMembership): boolean => {
          if (
            query["userId"] !== undefined &&
            !readQueryValues(query["userId"]).includes(keyOf(membership.userId))
          ) {
            return false;
          }

          if (
            query["projectId"] !== undefined &&
            keyOf(membership.projectId) !==
              keyOf(query["projectId"] as ObjectID)
          ) {
            return false;
          }

          return (
            query["hasAcceptedInvitation"] === undefined ||
            membership.hasAcceptedInvitation === query["hasAcceptedInvitation"]
          );
        })
        .map((membership: WorldMembership): TeamMember => {
          const row: TeamMember = new TeamMember();
          row._id = ObjectID.generate().toString();
          row.userId = membership.userId;
          row.projectId = membership.projectId;
          row.hasAcceptedInvitation = membership.hasAcceptedInvitation;
          return row;
        });
    },
  );

  getJestSpyOn(UserService, "getQueryBuilder").mockImplementation(
    (): FakeQuery => {
      return fakeQuery();
    },
  );

  readSettings = getJestSpyOn(
    LocalSignInClearing,
    "readSettings",
  ).mockResolvedValue(SETTINGS);
  clearPeople = getJestSpyOn(
    LocalSignInClearing,
    "clearPeople",
  ).mockImplementation(
    async (data: {
      userIds: Array<ObjectID>;
    }): Promise<{ clearedUserIds: Array<ObjectID>; sessionsEnded: number }> => {
      return { clearedUserIds: data.userIds, sessionsEnded: 1 };
    },
  );
  recordCleared = getJestSpyOn(
    AuditLogService,
    "recordSignInSettingsCleared",
  ).mockResolvedValue(undefined);
  notifyCleared = getJestSpyOn(
    SignInSettingsClearedEmail,
    "notify",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CLEARS)(
  "%s waits until the owner's session confirms it's theirs",
  (_label: string, clear: () => Promise<HttpResult>) => {
    test("unconfirmed, it is refused with the code the prompt acts on, as a change to how someone else signs in, and nothing is read or cleared", async () => {
      expectAskedToConfirm(await clear());
      expectNothingCleared();
    });

    test("confirmed through POST /api/user/reauthentication with the owner's password, the very same request goes through", async () => {
      expectAskedToConfirm(await clear());

      const confirmed: HttpResult = await confirm({
        [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
      });

      expect(confirmed.status).toBe(200);
      expect(typeof confirmed.body?.["confirmedUntil"]).toBe("string");

      expectAliceCleared(await clear());
    });

    test("a wrong password confirms nothing, and the clear is refused again", async () => {
      const wrong: HttpResult = await confirm({
        [REAUTHENTICATION_FIELDS.password]: "not the password",
      });

      expect(wrong.status).toBe(400);
      expect(wrong.body?.["error"]).toBe(
        REAUTHENTICATION_MESSAGES.wrongPassword,
      );

      expectAskedToConfirm(await clear());
      expectNothingCleared();
    });

    test("with two-factor authentication on, the password alone is not enough: its second step too", async () => {
      account = { ...TWO_FACTOR_ACCOUNT };

      const passwordOnly: HttpResult = await confirm({
        [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
      });

      expect(passwordOnly.status).toBe(400);
      expect(passwordOnly.body?.["error"]).toBe(
        REAUTHENTICATION_MESSAGES.secondStepRequired,
      );
      expectAskedToConfirm(await clear());

      const withCode: HttpResult = await confirm({
        [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
        [REAUTHENTICATION_FIELDS.code]: RIGHT_CODE,
      });

      expect(withCode.status).toBe(200);
      expectAliceCleared(await clear());
    });

    test("a confirmation that ran past the window confirms nothing", async () => {
      keptConfirmation(REAUTH_SESSION_ID, REAUTHENTICATION_WINDOW_IN_MINUTES);

      expectAskedToConfirm(await clear());
      expectNothingCleared();
    });

    test("within the window it holds, without asking again", async () => {
      keptConfirmation(
        REAUTH_SESSION_ID,
        REAUTHENTICATION_WINDOW_IN_MINUTES - 1,
      );

      expectAliceCleared(await clear());
    });

    test("another session's confirmation confirms nothing for this one", async () => {
      keptConfirmation(REAUTH_OTHER_SESSION_ID, 1);

      expectAskedToConfirm(await clear());
      expectNothingCleared();
    });

    test("a token that names no session is told the change needs a session that confirmed: never the prompt's refusal", async () => {
      signedIn(false);

      const result: HttpResult = await clear();

      expect(result.status).toBe(400);
      expect(result.body?.[REFUSAL_CODE_FIELD]).toBeUndefined();
      expect(result.body?.["error"]).toBe(
        REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[
          ReauthenticationPurpose.AdminChange
        ],
      );
      expectNothingCleared();
    });

    test("with Valkey out of reach nothing is confirmed: refused with what to do, and nothing is cleared", async () => {
      valkey.isDown = true;

      const result: HttpResult = await clear();

      expect(result.status).toBe(503);
      expect(result.body?.["error"]).toBe(
        REAUTHENTICATION_MESSAGES.unavailable,
      );
      expectNothingCleared();
    });

    test("an admin who is no owner is refused as one, and is never asked to confirm", async () => {
      ownerRows.set(keyOf(ACME_ID), allow([Permission.ProjectAdmin]));

      const result: HttpResult = await clear();

      expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
      expect(result.body?.["error"]).toBe(
        CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
      );
      expect(result.body?.[REFUSAL_CODE_FIELD]).toBeUndefined();
      expectNothingCleared();
    });
  },
);

describe("the count and the list, which only read", () => {
  test("are answered for a session that has not confirmed: nothing to confirm for a read", async () => {
    const count: HttpResult = await send({
      method: "GET",
      path: getProjectSavedSignInSettingsRoute(ACME_ID.toString()),
      tenantId: ACME_ID,
    });

    expect(count.status).toBe(200);
    expect(count.body).toEqual({ peopleCount: 1 });

    const list: HttpResult = await send({
      method: "POST",
      path: getProjectSavedSignInSettingsOfPeopleRoute(ACME_ID.toString()),
      tenantId: ACME_ID,
      body: toSavedSignInSettingsOfPeopleRequestJSON([ALICE_ID.toString()]),
    });

    expect(list.status).toBe(200);
    expect(list.body).toEqual({
      people: [{ userId: keyOf(ALICE_ID), settings: SETTINGS }],
    });

    expect(clearPeople).not.toHaveBeenCalled();
  });
});

/*
 * AN OWNER WHO SIGNS IN THROUGH SSO. Confirm It's You is used as it is
 * (Server/Utils/Reauthentication): an account with neither a password nor
 * a passkey confirms by a Sign In Again its identity provider says it
 * authenticated just now; one with a password is asked for it.
 */
describe("an owner who signs in only through SSO", () => {
  test("with no password or passkey, a Sign In Again their provider confirmed a moment ago is the confirmation: both clears go through", async () => {
    account = { ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 1 };

    expectAliceCleared(await clearAlice());

    clearPeople.mockClear();
    recordCleared.mockClear();

    const everyone: HttpResult = await clearEveryone();
    expect(everyone.status).toBe(200);
    expect(everyone.body).toEqual({ peopleCleared: 1 });
  });

  test("their session's own sign-in confirms it with Valkey out of reach too: the database answers", async () => {
    account = { ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 1 };
    valkey.isDown = true;

    expectAliceCleared(await clearAlice());
  });

  test("a Sign In Again past the window confirms nothing: refused, and asked to sign in again", async () => {
    account = {
      ...SSO_ONLY_ACCOUNT,
      signedInMinutesAgo: REAUTHENTICATION_WINDOW_IN_MINUTES + 1,
    };

    expectAskedToConfirm(await clearAlice());
    expectNothingCleared();
  });

  test("a sign-in their provider gave without Sign In Again confirms nothing, and the prompt offers Sign In Again through that provider", async () => {
    account = {
      ...SSO_ONLY_ACCOUNT,
      signedInWith: "SingleSignOn",
      signedInMinutesAgo: 0,
    };

    expectAskedToConfirm(await clearAlice());
    expectNothingCleared();

    const status: ReauthenticationStatus = await readStatus();

    expect(status.isConfirmed).toBe(false);
    expect(status.methods.signInAgain).toBe(true);
    expect(status.methods.password).toBe(false);
    expect(status.signInAgain?.provider).toBe(SignInAgainProvider.SingleSignOn);
    expect(status.signInAgain?.route).toBe(
      `/sso/${REAUTH_PROJECT_ID.toString()}/${REAUTH_SSO_PROVIDER_ID.toString()}`,
    );
  });

  /*
   * As it behaves today (#10528): an account single sign-on, SCIM, Google,
   * Microsoft or Vercel made carries a password OneUptime generated and
   * told nobody, so Confirm It's You asks for that password, and offers no
   * Sign In Again. While every project of the owner's manages sign-in with
   * SSO, Forgot password? mails them no link to set one either. #10528
   * decides what such an account is asked instead; this pins what it is
   * asked until then.
   */
  test("an account SSO made, with the password it generated and told nobody, is asked for a password and offered no Sign In Again (#10528)", async () => {
    account = {
      ...PASSWORD_ACCOUNT,
      signedInWith: "SingleSignOn",
      signedInMinutesAgo: 0,
    };

    expectAskedToConfirm(await clearAlice());
    expectNothingCleared();

    const status: ReauthenticationStatus = await readStatus();

    expect(status.methods.password).toBe(true);
    expect(status.methods.signInAgain).toBe(false);
    expect(status.signInAgain).toBeNull();
  });
});
