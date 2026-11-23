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
      getLogLevel: jest.fn().mockReturnValue("ERROR"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import ProjectAPI from "../../../Server/API/ProjectAPI";
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
import SignInSettingsClearedEmail, {
  SignInSettingsClearedEmailEvent,
} from "../../../Server/Utils/SignInSettingsClearedEmail";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import { SignInSettingsClearedAuditEvent } from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
  CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE,
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  LocalSignInSettings,
  NO_LOCAL_SIGN_IN_SETTINGS,
  PersonSavedSignInSettings,
  readSavedSignInSettingsOfPeopleAnswer,
  toSavedSignInSettingsOfPeopleRequestJSON,
} from "../../../Types/SSO/LocalSignInClearing";
import { SignInSettingsClearedBy } from "../../../Types/SSO/SignInSettingsClearedEmail";
import { getJestSpyOn } from "../../Spy";
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
 * ONE MEMBER'S SAVED SIGN-IN SETTINGS, OVER HTTP (#9993).
 *
 *   POST /project/:id/saved-sign-in-settings/people
 *   POST /project/:id/saved-sign-in-settings/people/:userId/clear
 *
 * The list names people across the owner's projects, which the count never
 * did, so who may ask and whom it names are pinned here end to end: a real
 * HTTP request to a real Express app, through the real ProjectAPI router,
 * the real request middleware (the session's person, the project the
 * tenantid header names, their permission rows in it), the route's own
 * owner check, and the rule itself (ProjectSignInClearing) with its check
 * of which projects the owner owns (CallerPermission over their rows in
 * each). Only the storage is stood in: the session the middleware reads
 * (readRequestSession, pinned on its own in MasterAdminRemovalOverHttp), the
 * permission rows each person has in each project, as AccessTokenService
 * reads them, the projects and memberships, the query of who has settings
 * saved (which leaves master admins out only while its SQL says so), what
 * each person has, and the clear's writes, audit entries and emails.
 *
 *   - an owner is answered, and clears;
 *   - an owner of only some of a person's projects is refused that person;
 *   - an admin who is not an owner is refused;
 *   - a master admin's row is never listed, nor cleared;
 *   - the owner's own row is never listed, nor cleared;
 *   - nobody the owner does not see on this project's Users list is named:
 *     only people asked about, members of this project.
 */

// The people of the world, and who they are.
const OWNER_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000a1");
const ADMIN_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000a2");
const STRANGER_ID: ObjectID = new ObjectID(
  "99930000-0000-4000-8000-0000000000a3",
);
// Only in the owner's projects: theirs to clear.
const ALICE_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000b1");
// Also in another organization's project.
const BOB_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000b2");
// A master admin, only in the owner's projects.
const ADA_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000b3");
// In another of the owner's projects, not this one.
const CAROL_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000b4");
// Only invited to this project.
const DAN_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000b5");

// The projects: the owner's two, and another organization's.
const ACME_ID: ObjectID = new ObjectID("99930000-0000-4000-8000-0000000000c1");
const STAGING_ID: ObjectID = new ObjectID(
  "99930000-0000-4000-8000-0000000000c2",
);
const OTHER_ORG_ID: ObjectID = new ObjectID(
  "99930000-0000-4000-8000-0000000000c3",
);

const SETTINGS: LocalSignInSettings = {
  ...NO_LOCAL_SIGN_IN_SETTINGS,
  hasPassword: true,
  backupCodeCount: 10,
};

// What a refused caller is answered with: NotAuthorizedException's status.
const REFUSED: number = ExceptionCode.NotAuthorizedException;

interface WorldMembership {
  userId: ObjectID;
  projectId: ObjectID;
  hasAcceptedInvitation: boolean;
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

// Each project, all three managing their people's sign-in with SSO.
const PROJECTS: Array<{ id: ObjectID; name: string }> = [
  { id: ACME_ID, name: "Acme" },
  { id: STAGING_ID, name: "Acme Staging" },
  { id: OTHER_ORG_ID, name: "Another Org" },
];

let memberships: Array<WorldMembership>;
// Each person's permission rows, by project.
let rows: Map<string, Map<string, Array<UserPermission>>>;
let masterAdmins: Set<string>;
let withSettings: Set<string>;
// Who signed in: the session readRequestSession answers.
let session: RequestSession;

let clearPeople: jest.SpyInstance;
let recordCleared: jest.SpyInstance;
let notifyCleared: jest.SpyInstance;
let readSettings: jest.SpyInstance;
let listedSql: Array<string>;

const joins: (
  userId: ObjectID,
  projectId: ObjectID,
  hasAcceptedInvitation?: boolean,
) => void = (
  userId: ObjectID,
  projectId: ObjectID,
  hasAcceptedInvitation?: boolean,
): void => {
  memberships.push({
    userId,
    projectId,
    hasAcceptedInvitation: hasAcceptedInvitation !== false,
  });
};

const holds: (
  userId: ObjectID,
  projectId: ObjectID,
  permissions: Array<Permission>,
) => void = (
  userId: ObjectID,
  projectId: ObjectID,
  permissions: Array<Permission>,
): void => {
  const byProject: Map<string, Array<UserPermission>> = rows.get(
    keyOf(userId),
  ) || new Map<string, Array<UserPermission>>();
  byProject.set(keyOf(projectId), allow(permissions));
  rows.set(keyOf(userId), byProject);
};

const tenantPermission: (
  userId: ObjectID,
  projectId: ObjectID,
) => UserTenantAccessPermission | null = (
  userId: ObjectID,
  projectId: ObjectID,
): UserTenantAccessPermission | null => {
  const permissions: Array<UserPermission> | undefined = rows
    .get(keyOf(userId))
    ?.get(keyOf(projectId));

  return permissions
    ? {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions,
      }
    : null;
};

const signedInAs: (userId: ObjectID, isMasterAdmin?: boolean) => void = (
  userId: ObjectID,
  isMasterAdmin?: boolean,
): void => {
  session = {
    kind: "user",
    session: {
      userId: userId,
      email: new Email("someone@example.com"),
      isMasterAdmin: isMasterAdmin === true,
      isGlobalLogin: true,
    } as JSONWebTokenData,
  } as RequestSession;
};

/*
 * The query of who has settings saved, as LocalSignInClearing builds it: it
 * answers the people asked about who have settings - and leaves master
 * admins out only because, and only while, its SQL says so.
 */
interface FakeQuery {
  where: (sql: string) => FakeQuery;
  andWhere: (sql: string, parameters: Record<string, unknown>) => FakeQuery;
  select: () => FakeQuery;
  getRawMany: () => Promise<Array<{ userId: string }>>;
}

const fakeQuery: () => FakeQuery = (): FakeQuery => {
  let sql: string = "";
  let asked: Array<string> = [];

  const query: FakeQuery = {
    where: (whereSql: string): FakeQuery => {
      sql = whereSql.replace(/\s+/g, " ");
      listedSql.push(sql);
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
      const leavesOutMasterAdmins: boolean = sql.includes(
        '"person"."isMasterAdmin" = false',
      );

      return asked
        .filter((userId: string): boolean => {
          return (
            withSettings.has(userId) &&
            (!leavesOutMasterAdmins || !masterAdmins.has(userId))
          );
        })
        .map((userId: string): { userId: string } => {
          return { userId };
        });
    },
  };

  return query;
};

interface HttpResult {
  status: number;
  raw: string;
  body: JSONObject | null;
}

let server: http.Server;
let port: number;

function post(data: {
  path: string;
  tenantId: ObjectID;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body || {});
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: `/api${data.path}`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            tenantid: data.tenantId.toString(),
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
      outgoing.write(payload);
      outgoing.end();
    },
  );
}

// Asks, as the Users list of a project does, about these people.
const ask: (
  people: Array<ObjectID>,
  projectId?: ObjectID,
) => Promise<HttpResult> = async (
  people: Array<ObjectID>,
  projectId?: ObjectID,
): Promise<HttpResult> => {
  return await post({
    path: getProjectSavedSignInSettingsOfPeopleRoute(
      (projectId || ACME_ID).toString(),
    ),
    tenantId: projectId || ACME_ID,
    body: toSavedSignInSettingsOfPeopleRequestJSON(
      people.map((id: ObjectID): string => {
        return id.toString();
      }),
    ),
  });
};

const listed: (result: HttpResult) => Array<string> = (
  result: HttpResult,
): Array<string> => {
  return (readSavedSignInSettingsOfPeopleAnswer(result.body) || []).map(
    (person: PersonSavedSignInSettings): string => {
      return person.userId;
    },
  );
};

const clearOne: (
  userId: ObjectID,
  projectId?: ObjectID,
) => Promise<HttpResult> = async (
  userId: ObjectID,
  projectId?: ObjectID,
): Promise<HttpResult> => {
  return await post({
    path: getProjectClearPersonSavedSignInSettingsRoute(
      (projectId || ACME_ID).toString(),
      userId.toString(),
    ),
    tenantId: projectId || ACME_ID,
  });
};

beforeAll(async () => {
  const app: express.Express = express();
  app.use(express.json());
  const router: ExpressRouter = express.Router();
  router.use(new ProjectAPI().getRouter());
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
  memberships = [];
  rows = new Map<string, Map<string, Array<UserPermission>>>();
  masterAdmins = new Set<string>([keyOf(ADA_ID)]);
  withSettings = new Set<string>(
    [OWNER_ID, ADMIN_ID, ALICE_ID, BOB_ID, ADA_ID, CAROL_ID, DAN_ID].map(keyOf),
  );
  listedSql = [];

  // The owner owns Acme and Acme Staging; a stranger owns Another Org.
  holds(OWNER_ID, ACME_ID, [Permission.ProjectOwner]);
  holds(OWNER_ID, STAGING_ID, [Permission.ProjectOwner]);
  holds(STRANGER_ID, OTHER_ORG_ID, [Permission.ProjectOwner]);
  // An admin of Acme, who is no owner of it.
  holds(ADMIN_ID, ACME_ID, [Permission.ProjectAdmin]);

  joins(OWNER_ID, ACME_ID);
  joins(OWNER_ID, STAGING_ID);
  joins(ADMIN_ID, ACME_ID);
  joins(ALICE_ID, ACME_ID);
  joins(ALICE_ID, STAGING_ID, false);
  joins(BOB_ID, ACME_ID);
  joins(BOB_ID, OTHER_ORG_ID);
  joins(ADA_ID, ACME_ID);
  joins(CAROL_ID, STAGING_ID);
  joins(DAN_ID, ACME_ID, false);

  signedInAs(OWNER_ID);

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
  // Each session here signed in with the project's SSO, as opening it takes.
  getJestSpyOn(UserMiddleware, "isSsoSatisfiedForProject").mockResolvedValue(
    true,
  );
  getJestSpyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);

  // The permission rows each person has, as every check reads them.
  getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockImplementation(
    async (userId: ObjectID): Promise<UserGlobalAccessPermission> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds: Array.from(
          (
            rows.get(keyOf(userId)) || new Map<string, Array<UserPermission>>()
          ).keys(),
        ).map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
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

  // The projects: each requires SSO and manages its people's sign-in with it.
  const projectRow: (id: ObjectID) => Project | null = (
    id: ObjectID,
  ): Project | null => {
    const found: { id: ObjectID; name: string } | undefined = PROJECTS.find(
      (project: { id: ObjectID; name: string }): boolean => {
        return keyOf(project.id) === keyOf(id);
      },
    );

    if (!found) {
      return null;
    }

    const row: Project = new Project();
    row._id = found.id.toString();
    row.name = found.name;
    row.requireSsoForLogin = true;
    row.manageSignInWithSso = true;
    return row;
  };

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(
    async (data: FindOneByID<Project>): Promise<Project | null> => {
      return projectRow(data.id as ObjectID);
    },
  );
  getJestSpyOn(ProjectService, "findBy").mockImplementation(
    async (data: FindBy<Project>): Promise<Array<Project>> => {
      return readQueryValues((data.query as Record<string, unknown>)["_id"])
        .map((id: string): Project | null => {
          return projectRow(new ObjectID(id));
        })
        .filter((row: Project | null): boolean => {
          return Boolean(row);
        }) as Array<Project>;
    },
  );

  // The memberships, by what each query names.
  getJestSpyOn(TeamMemberService, "findBy").mockImplementation(
    async (data: FindBy<TeamMember>): Promise<Array<TeamMember>> => {
      const query: Record<string, unknown> = data.query as Record<
        string,
        unknown
      >;
      const skip: number = Number(data.skip || 0);

      const found: Array<WorldMembership> = memberships.filter(
        (membership: WorldMembership): boolean => {
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
        },
      );

      return found
        .slice(skip, skip + Number(data.limit || found.length))
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

  // The clear's writes: master admins left out, as the real one leaves them.
  clearPeople = getJestSpyOn(
    LocalSignInClearing,
    "clearPeople",
  ).mockImplementation(
    async (data: {
      userIds: Array<ObjectID>;
      isMasterAdminIncluded: boolean;
    }): Promise<{ clearedUserIds: Array<ObjectID>; sessionsEnded: number }> => {
      const cleared: Array<ObjectID> = data.userIds.filter(
        (userId: ObjectID): boolean => {
          return data.isMasterAdminIncluded || !masterAdmins.has(keyOf(userId));
        },
      );

      return { clearedUserIds: cleared, sessionsEnded: cleared.length };
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

const nothingCleared: () => void = (): void => {
  expect(clearPeople).not.toHaveBeenCalled();
  expect(recordCleared).not.toHaveBeenCalled();
  expect(notifyCleared).not.toHaveBeenCalled();
};

describe("an owner", () => {
  test("is answered with the members of this project they may clear, and what each has", async () => {
    const result: HttpResult = await ask([ALICE_ID]);

    expect(result.status).toBe(200);
    expect(readSavedSignInSettingsOfPeopleAnswer(result.body)).toEqual([
      { userId: keyOf(ALICE_ID), settings: SETTINGS },
    ]);
  });

  test("clears one of them, as themselves: the audit entry and the email of a bulk clear", async () => {
    const result: HttpResult = await clearOne(ALICE_ID);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ peopleCleared: 1 });

    expect(clearPeople).toHaveBeenCalledTimes(1);
    expect(clearPeople.mock.calls[0]![0]).toEqual({
      userIds: [ALICE_ID],
      isMasterAdminIncluded: false,
    });

    const audited: Array<SignInSettingsClearedAuditEvent> = recordCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedAuditEvent>;
    expect(audited).toEqual([
      { userId: ALICE_ID, clearedByUserId: OWNER_ID, cleared: SETTINGS },
    ]);

    const emailed: Array<SignInSettingsClearedEmailEvent> = notifyCleared.mock
      .calls[0]![0] as Array<SignInSettingsClearedEmailEvent>;
    expect(emailed).toEqual([
      {
        userId: ALICE_ID,
        cleared: SETTINGS,
        clearedBy: SignInSettingsClearedBy.ProjectOwner,
        projectId: ACME_ID,
      },
    ]);
  });

  test("names only the people asked about: a member the page did not show is never named", async () => {
    const result: HttpResult = await ask([BOB_ID]);

    expect(result.status).toBe(200);
    expect(listed(result)).toEqual([]);
    // Alice, whom nobody asked about, is not read at all.
    expect(readSettings).not.toHaveBeenCalled();
  });

  test("names only members of this project: somebody from another of their projects is named there, not here", async () => {
    expect(listed(await ask([CAROL_ID]))).toEqual([]);
    expect(listed(await ask([CAROL_ID], STAGING_ID))).toEqual([
      keyOf(CAROL_ID),
    ]);

    const refused: HttpResult = await clearOne(CAROL_ID);
    expect(refused.status).toBe(400);
    expect(refused.raw).toContain(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    nothingCleared();
  });

  test("never names somebody only invited to this project", async () => {
    expect(listed(await ask([DAN_ID]))).toEqual([]);
  });

  test("of a whole page, is answered with exactly those they may clear", async () => {
    const result: HttpResult = await ask([
      OWNER_ID,
      ADMIN_ID,
      ALICE_ID,
      BOB_ID,
      ADA_ID,
      CAROL_ID,
      DAN_ID,
    ]);

    // The admin of Acme is in no other project: theirs to clear too.
    expect(listed(result).sort()).toEqual(
      [keyOf(ADMIN_ID), keyOf(ALICE_ID)].sort(),
    );
  });
});

describe("an owner of only some of a person's projects", () => {
  test("is not told of them", async () => {
    const result: HttpResult = await ask([BOB_ID]);

    expect(result.status).toBe(200);
    expect(listed(result)).toEqual([]);
  });

  test("is refused their clear, with the rule and never which part of it, and nothing is cleared", async () => {
    const result: HttpResult = await clearOne(BOB_ID);

    expect(result.status).toBe(400);
    expect(result.raw).toContain(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    expect(result.raw).not.toContain("Another Org");
    nothingCleared();
  });

  test("is told of them again once the owner owns their other project too", async () => {
    holds(OWNER_ID, OTHER_ORG_ID, [Permission.ProjectOwner]);

    expect(listed(await ask([BOB_ID]))).toEqual([keyOf(BOB_ID)]);
  });
});

describe("an admin who is not an owner", () => {
  test("is refused the list, and nobody is read", async () => {
    signedInAs(ADMIN_ID);

    const result: HttpResult = await ask([ALICE_ID]);

    expect(result.status).toBe(REFUSED);
    expect(result.raw).toContain(CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE);
    expect(readSettings).not.toHaveBeenCalled();
    expect(listedSql).toEqual([]);
  });

  test("is refused the clear, and nothing is cleared", async () => {
    signedInAs(ADMIN_ID);

    const result: HttpResult = await clearOne(ALICE_ID);

    expect(result.status).toBe(REFUSED);
    expect(result.raw).toContain(CLEAR_PROJECT_SIGN_IN_OWNERS_ONLY_MESSAGE);
    nothingCleared();
  });

  test("a master admin who is no owner of the project: their standing is not ownership", async () => {
    signedInAs(STRANGER_ID, true);
    holds(STRANGER_ID, ACME_ID, [Permission.ProjectMember]);

    expect((await ask([ALICE_ID])).status).toBe(REFUSED);
    expect((await clearOne(ALICE_ID)).status).toBe(REFUSED);
    nothingCleared();
  });

  test("somebody not in the project at all is refused before anything is read", async () => {
    signedInAs(STRANGER_ID);

    expect((await ask([ALICE_ID])).status).toBe(REFUSED);
    expect((await clearOne(ALICE_ID)).status).toBe(REFUSED);
    expect(listedSql).toEqual([]);
    nothingCleared();
  });

  test("nobody signed in is told to sign in", async () => {
    session = { kind: "none" } as RequestSession;

    expect((await ask([ALICE_ID])).status).toBe(401);
    expect((await clearOne(ALICE_ID)).status).toBe(401);
    nothingCleared();
  });

  test("another project's id in the path is refused, though the header names one the caller owns", async () => {
    const result: HttpResult = await post({
      path: getProjectSavedSignInSettingsOfPeopleRoute(OTHER_ORG_ID.toString()),
      tenantId: ACME_ID,
      body: toSavedSignInSettingsOfPeopleRequestJSON([BOB_ID.toString()]),
    });

    expect(result.status).toBe(REFUSED);
    expect(listedSql).toEqual([]);
  });
});

describe("a master admin's row", () => {
  test("is never listed, though every one of their projects is the owner's", async () => {
    const result: HttpResult = await ask([ADA_ID]);

    expect(result.status).toBe(200);
    expect(listed(result)).toEqual([]);
    // Left out by the query of who has settings saved, by its own SQL.
    expect(listedSql[0]).toContain('"person"."isMasterAdmin" = false');
  });

  test("is never cleared", async () => {
    const result: HttpResult = await clearOne(ADA_ID);

    expect(result.status).toBe(400);
    expect(result.raw).toContain(
      CLEAR_PROJECT_PERSON_SIGN_IN_NOT_CLEARABLE_MESSAGE,
    );
    nothingCleared();
  });
});

describe("the owner's own row", () => {
  test("is never listed, whatever case their id is written in", async () => {
    expect(listed(await ask([OWNER_ID]))).toEqual([]);

    const upperCase: HttpResult = await post({
      path: getProjectSavedSignInSettingsOfPeopleRoute(ACME_ID.toString()),
      tenantId: ACME_ID,
      body: { userIds: [OWNER_ID.toString().toUpperCase()] },
    });

    expect(upperCase.status).toBe(200);
    expect(listed(upperCase)).toEqual([]);
  });

  test("is never cleared: their own settings are in User Profile", async () => {
    const result: HttpResult = await clearOne(OWNER_ID);

    expect(result.status).toBe(400);
    nothingCleared();
  });
});
