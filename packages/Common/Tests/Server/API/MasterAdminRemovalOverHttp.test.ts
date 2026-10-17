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

import BaseAPI from "../../../Server/API/BaseAPI";
import UserAPI from "../../../Server/API/UserAPI";
import ProjectMiddleware from "../../../Server/Middleware/ProjectAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import LabelService from "../../../Server/Services/LabelService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { ensureMasterAdminPageAccess } from "../../../Server/Utils/MasterAdminPageAccess";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Label from "../../../Models/DatabaseModels/Label";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { clientTimeout } from "../TestingUtils/StatementFailures";
import {
  afterAll,
  afterEach,
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
 * REMOVING SOMEONE'S MASTER ADMIN ACCESS TAKES IT AWAY FROM THEIR NEXT
 * REQUEST ON - INCLUDING WHILE THEY ARE SIGNED IN.
 *
 * A master admin runs the whole server: every project, every account, the
 * Admin Dashboard. Another master admin can take that away (Admin Dashboard
 * > Users > a user > Settings > Master Admin Access), and the Admin
 * Dashboard says what it means: "They will lose access to this Admin
 * Dashboard. The projects they are a member of stay as they are." - and
 * that only another master admin can give it back.
 *
 * A session's access token says whether its person was a master admin when
 * it was signed, and lives for up to 15 minutes. Read as the answer, it kept
 * a person whose access was removed a master admin until it ran out: every
 * master-admin route (setting anyone's password, two factor auth, removing
 * people from projects), every project on the server, no Require SSO of the
 * server's - and the switch to give the access back to themselves.
 *
 * Now the token's claim is only the most a session can be: a session is a
 * master admin's while its person still is one, read from their account the
 * way whether they are blocked is read (UserService, a minute per server,
 * forgotten on every server when it changes). The person is not signed out:
 * the same session goes on as the member they are, in the projects they are
 * a member of.
 *
 * Each case is a real HTTP request to a real Express app - cookie parsing,
 * the JSON body parser, the real UserAPI router (the User CRUD API and the
 * master-admin routes on it), the real CRUD router of a project-scoped model
 * (Label), the Admin Dashboard's page gate and the production error handler
 * - carrying sessions signed for real (JSONWebToken). Accounts are rows of a
 * User table held in memory (InMemoryRepository) behind the real
 * UserService, so the access is removed the way the Admin Dashboard removes
 * it: a PUT to /api/user/:id by another master admin, through the update
 * hooks. The rest of the data layer is stubbed, and records what reached
 * it.
 */

// A project the person whose access is removed is a member of.
const THEIR_PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-0000000000a1",
);

// A project they are not a member of.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-0000000000a2",
);

// The instance-wide master API key (Admin Dashboard > Settings > API Key).
const MASTER_API_KEY: string = "6c000000-0000-4000-8000-0000000000b1";

const NOT_A_MASTER_ADMIN_MESSAGE: string =
  "Unauthorized: Only master admins can perform this action.";

const SHELL_NOT_A_MASTER_ADMIN_MESSAGE: string =
  "Unauthorized: Only master admins can access the admin dashboard.";

/*
 * Each test has accounts of its own, so nothing a server keeps about an
 * account from one test is ever read by another.
 */
interface People {
  // The master admin who removes the access.
  admin: ObjectID;
  // The master admin whose access is removed.
  former: ObjectID;
  // Someone who was never a master admin.
  member: ObjectID;
}

let people: People;
let users: InMemoryTable;

// Whether the server's own Require SSO for Login is on.
let serverRequiresSso: boolean = false;

interface Reached {
  what: string;
  userId: string | undefined;
  tenantId: string | undefined;
  isMasterAdmin: boolean;
  userType: string | undefined;
}

// What the requests that got through reached, and as whom.
const reached: Array<Reached> = [];

let server: http.Server | null = null;
let port: number = 0;

function record(what: string, props: JSONObject | undefined): void {
  reached.push({
    what: what,
    userId: props?.["userId"] ? String(props["userId"]) : undefined,
    tenantId: props?.["tenantId"] ? String(props["tenantId"]) : undefined,
    isMasterAdmin: props?.["isMasterAdmin"] === true,
    userType: props?.["userType"] ? String(props["userType"]) : undefined,
  });
}

function reachedNames(): Array<string> {
  return reached.map((entry: Reached): string => {
    return entry.what;
  });
}

function userRow(
  id: ObjectID,
  data: { name: string; isMasterAdmin: boolean; isBlocked?: boolean },
): StoredRow {
  return {
    _id: id.toString(),
    name: data.name,
    email: `${id.toString()}@example.com`,
    isMasterAdmin: data.isMasterAdmin,
    isBlocked: data.isBlocked === true,
    isEmailVerified: true,
  };
}

/*
 * A session: the access token every sign-in and every renewal gives, saying
 * whether its person was a master admin when it was signed.
 */
function sessionOf(userId: ObjectID, isMasterAdmin: boolean): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(`${userId.toString()}@example.com`),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: isMasterAdmin,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

function isMember(userId: ObjectID, projectId: ObjectID): boolean {
  return (
    userId.toString() === people.former.toString() &&
    projectId.toString() === THEIR_PROJECT_ID.toString()
  );
}

function memberPermissionIn(projectId: ObjectID): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  } as UserTenantAccessPermission;
}

beforeAll(async () => {
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoForLogin")
    .mockResolvedValue(false as never);
  jest
    .spyOn(ProjectService, "getRequireSsoWithSsoProviderId")
    .mockResolvedValue(null as never);
  jest
    .spyOn(GlobalConfigService, "getRequireSsoForLogin")
    .mockImplementation((async (): Promise<boolean> => {
      return serverRequiresSso;
    }) as never);

  /*
   * With billing on (as CI runs), a request in a project carries its plan:
   * the highest one, paid, so that no plan decides what is asked here.
   */
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  // Only the master API key is a master API key.
  jest.spyOn(ProjectMiddleware, "isMasterApiKey").mockImplementation((async (
    apiKey: ObjectID,
  ): Promise<boolean> => {
    return apiKey.toString() === MASTER_API_KEY;
  }) as never);

  // The person whose access is removed is a member of one project; nobody else is a member of any.
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
    ): Promise<UserGlobalAccessPermission | null> => {
      return {
        _type: "UserGlobalAccessPermission",
        projectIds:
          userId.toString() === people.former.toString()
            ? [THEIR_PROJECT_ID]
            : [],
        globalPermissions: [Permission.Public, Permission.User],
      } as UserGlobalAccessPermission;
    }) as never);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
      projectId: ObjectID,
    ): Promise<UserTenantAccessPermission | null> => {
      return isMember(userId, projectId) ? memberPermissionIn(projectId) : null;
    }) as never);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  // The master-admin routes, as far as they reach.
  jest.spyOn(UserService, "getAuthenticationStatus").mockImplementation((async (
    userId: ObjectID,
  ): Promise<JSONObject> => {
    record(`authentication-status ${userId.toString()}`, undefined);
    return { hasPassword: true };
  }) as never);
  jest.spyOn(UserService, "setPassword").mockImplementation((async (data: {
    userId: ObjectID;
  }): Promise<void> => {
    record(`set-password ${data.userId.toString()}`, undefined);
  }) as never);
  jest
    .spyOn(UserService, "sendPasswordResetLink")
    .mockImplementation((async (data: { userId: ObjectID }): Promise<Email> => {
      record(`send-password-reset-link ${data.userId.toString()}`, undefined);
      return new Email("someone@example.com");
    }) as never);
  jest
    .spyOn(UserService, "setTwoFactorAuthRequired")
    .mockImplementation((async (data: { userId: ObjectID }): Promise<void> => {
      record(
        `set-two-factor-auth-required ${data.userId.toString()}`,
        undefined,
      );
    }) as never);
  jest
    .spyOn(UserService, "resetTwoFactorAuth")
    .mockImplementation((async (data: { userId: ObjectID }): Promise<void> => {
      record(`reset-two-factor-auth ${data.userId.toString()}`, undefined);
    }) as never);
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    record("memberships of a user", data.props);
    return [];
  }) as never);
  jest.spyOn(TeamMemberService, "deleteBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("remove from project", data.props);
    return 1;
  }) as never);

  // Updates of an account end its sessions only when they change its password or block it.
  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockResolvedValue(undefined as never);

  /*
   * A project's records: read by the real LabelService - its permission
   * checks included - from a table in memory, and recorded as they are
   * asked for.
   */
  const findLabels: typeof LabelService.findBy =
    LabelService.findBy.bind(LabelService);
  const countLabels: typeof LabelService.countBy =
    LabelService.countBy.bind(LabelService);

  jest.spyOn(LabelService, "findBy").mockImplementation((async (
    data: Parameters<typeof LabelService.findBy>[0],
  ): Promise<Array<Label>> => {
    record("labels (list)", data.props as unknown as JSONObject);
    return await findLabels(data);
  }) as never);
  jest.spyOn(LabelService, "countBy").mockImplementation((async (
    data: Parameters<typeof LabelService.countBy>[0],
  ): Promise<PositiveNumber> => {
    record("labels (count)", data.props as unknown as JSONObject);
    return await countLabels(data);
  }) as never);

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new UserAPI().getRouter());
  app.use("/api", new BaseAPI(Label, LabelService).getRouter());

  // The Admin Dashboard's page, gated as its server gates it (AdminDashboard/Serve.ts).
  app.get(
    "/admin",
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
      try {
        await ensureMasterAdminPageAccess({ req, res, service: "admin" });

        if (res.headersSent) {
          return;
        }

        res.status(200).send("<html>Admin Dashboard</html>");
      } catch (err) {
        next(err);
      }
    },
  );

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
  serverRequiresSso = false;

  people = {
    admin: ObjectID.generate(),
    former: ObjectID.generate(),
    member: ObjectID.generate(),
  };

  useInMemoryTable(LabelService, []);

  users = useInMemoryTable(UserService, [
    userRow(people.admin, { name: "Ada Admin", isMasterAdmin: true }),
    userRow(people.former, { name: "Fran Former", isMasterAdmin: true }),
    userRow(people.member, { name: "Mo Member", isMasterAdmin: false }),
  ]);
});

afterEach(() => {
  jest.useRealTimers();
});

interface HttpResult {
  status: number;
  body: JSONObject | JSONArray | null;
  text: string;
}

type HttpMethod = "GET" | "POST" | "PUT";

function send(data: {
  method: HttpMethod;
  path: string;
  token?: string | undefined;
  carrier?: "cookie" | "bearer" | undefined;
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

      if (data.token) {
        if (data.carrier === "bearer") {
          headers["authorization"] = `Bearer ${data.token}`;
        } else {
          headers["cookie"] = `${CookieUtil.getUserTokenKey()}=${data.token}`;
        }
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
            const text: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | JSONArray | null = null;

            try {
              body = text ? (JSON.parse(text) as JSONObject | JSONArray) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body, text });
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

/*
 * The message of an error answer: the middlewares send it as `message`, the
 * error handler as `error`.
 */
function errorMessageOf(result: HttpResult): string | undefined {
  const body: JSONObject | null =
    result.body && !Array.isArray(result.body) ? result.body : null;

  for (const field of ["message", "error"]) {
    if (body && typeof body[field] === "string") {
      return body[field] as string;
    }
  }

  return undefined;
}

// What the Admin Dashboard's Master Admin switch sends: a PUT to the account by another master admin.
async function setMasterAdmin(data: {
  by: string;
  of: ObjectID;
  isMasterAdmin: boolean;
}): Promise<HttpResult> {
  return await send({
    method: "PUT",
    path: `/api/user/${data.of.toString()}`,
    token: data.by,
    body: { data: { isMasterAdmin: data.isMasterAdmin } },
  });
}

async function removeAccessOfFormer(adminSession: string): Promise<void> {
  const result: HttpResult = await setMasterAdmin({
    by: adminSession,
    of: people.former,
    isMasterAdmin: false,
  });

  expect(result.status).toBe(200);
  expect(users.get(people.former)?.["isMasterAdmin"]).toBe(false);
}

interface MasterAdminRoute {
  name: string;
  method: "GET" | "POST";
  // The account the route acts on: another master admin's, the worst case.
  path: (target: ObjectID) => string;
  body?: JSONObject | undefined;
  reaches: (target: ObjectID) => string;
}

/*
 * The routes only a master admin may call, each with what it reaches when
 * it lets the request through. Each acts on the account of the master
 * admin who removed the access - the takeover a former master admin would
 * try first.
 */
const MASTER_ADMIN_ROUTES: Array<MasterAdminRoute> = [
  {
    name: "set someone's password",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/set-password`;
    },
    body: { password: "Taken-0ver-Passw0rd!" },
    reaches: (target: ObjectID): string => {
      return `set-password ${target.toString()}`;
    },
  },
  {
    name: "send someone a password reset link",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/send-password-reset-link`;
    },
    reaches: (target: ObjectID): string => {
      return `send-password-reset-link ${target.toString()}`;
    },
  },
  {
    name: "turn someone's two factor auth requirement off",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/set-two-factor-auth-required`;
    },
    body: { isRequired: false },
    reaches: (target: ObjectID): string => {
      return `set-two-factor-auth-required ${target.toString()}`;
    },
  },
  {
    name: "reset someone's two factor auth",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/reset-two-factor-auth`;
    },
    reaches: (target: ObjectID): string => {
      return `reset-two-factor-auth ${target.toString()}`;
    },
  },
  {
    name: "read how someone signs in",
    method: "GET",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/authentication-status`;
    },
    reaches: (target: ObjectID): string => {
      return `authentication-status ${target.toString()}`;
    },
  },
  {
    name: "remove someone from a project",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/remove-from-project`;
    },
    body: { projectId: OTHER_PROJECT_ID.toString() },
    reaches: (): string => {
      return "remove from project";
    },
  },
  {
    name: "list someone's projects",
    method: "POST",
    path: (target: ObjectID): string => {
      return `/api/user/${target.toString()}/projects`;
    },
    reaches: (): string => {
      return "memberships of a user";
    },
  },
];

function callRoute(
  route: MasterAdminRoute,
  session: string,
  carrier: "cookie" | "bearer" = "cookie",
): Promise<HttpResult> {
  return send({
    method: route.method,
    path: route.path(people.admin),
    token: session,
    carrier: carrier,
    body: route.method === "POST" ? route.body || {} : undefined,
  });
}

function listLabels(projectId: ObjectID, session: string): Promise<HttpResult> {
  return send({
    method: "POST",
    path: "/api/label/get-list",
    token: session,
    headers: { tenantid: projectId.toString() },
    body: { query: {}, select: { _id: true } },
  });
}

function listUsers(session: string): Promise<HttpResult> {
  return send({
    method: "POST",
    path: "/api/user/get-list",
    token: session,
    body: { query: {}, select: { _id: true, name: true } },
  });
}

function idsListed(result: HttpResult): Array<string> {
  const body: JSONObject = result.body as JSONObject;
  const rows: JSONArray = (body["data"] as JSONArray) || [];

  return rows
    .map((row: unknown): string => {
      const id: unknown = (row as JSONObject)["_id"];
      return String(id).toLowerCase();
    })
    .sort();
}

function openAdminDashboard(session: string): Promise<HttpResult> {
  return send({ method: "GET", path: "/admin", token: session });
}

describe("a master admin, before their access is removed", () => {
  /*
   * The baseline the rest of the file takes away: this session is a master
   * admin's, and reaches everything a master admin reaches.
   */
  test.each(MASTER_ADMIN_ROUTES)(
    "may $name",
    async (route: MasterAdminRoute) => {
      const session: string = sessionOf(people.former, true);

      const result: HttpResult = await callRoute(route, session);

      expect(result.status).toBe(200);
      expect(reachedNames()).toEqual([route.reaches(people.admin)]);
    },
  );

  test("reads every account, a project they are not a member of, and opens the Admin Dashboard", async () => {
    const session: string = sessionOf(people.former, true);

    const accounts: HttpResult = await listUsers(session);
    expect(accounts.status).toBe(200);
    expect(idsListed(accounts)).toEqual(
      [people.admin, people.former, people.member]
        .map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        })
        .sort(),
    );

    const labels: HttpResult = await listLabels(OTHER_PROJECT_ID, session);
    expect(labels.status).toBe(200);
    expect(reached[0]).toMatchObject({
      what: "labels (list)",
      tenantId: OTHER_PROJECT_ID.toString(),
      isMasterAdmin: true,
      userType: UserType.MasterAdmin,
    });

    const dashboard: HttpResult = await openAdminDashboard(session);
    expect(dashboard.status).toBe(200);
    expect(dashboard.text).toBe("<html>Admin Dashboard</html>");
  });

  test("is not held to the server's Require SSO", async () => {
    serverRequiresSso = true;

    const result: HttpResult = await listLabels(
      THEIR_PROJECT_ID,
      sessionOf(people.former, true),
    );

    expect(result.status).toBe(200);
  });
});

describe("a master admin whose access was removed, with the session they already had", () => {
  test.each(MASTER_ADMIN_ROUTES)(
    "may no longer $name, from the very next request",
    async (route: MasterAdminRoute) => {
      const adminSession: string = sessionOf(people.admin, true);
      const formerSession: string = sessionOf(people.former, true);

      // The session works as a master admin's...
      expect((await callRoute(route, formerSession)).status).toBe(200);
      reached.length = 0;

      // ...until another master admin removes the access.
      await removeAccessOfFormer(adminSession);

      for (const carrier of ["cookie", "bearer"] as const) {
        const result: HttpResult = await callRoute(
          route,
          formerSession,
          carrier,
        );

        /*
         * A known person who is not a master admin: a 422, not a 401 - a
         * renewed session would be the same person, no master admin either.
         */
        expect({ carrier, status: result.status }).toEqual({
          carrier,
          status: ExceptionCode.NotAuthorizedException,
        });
        expect(errorMessageOf(result)).toBe(NOT_A_MASTER_ADMIN_MESSAGE);
      }

      expect(reached).toEqual([]);
    },
  );

  test("cannot give the access back to themselves, nor to anyone else", async () => {
    const adminSession: string = sessionOf(people.admin, true);
    const formerSession: string = sessionOf(people.former, true);

    await removeAccessOfFormer(adminSession);

    const toThemselves: HttpResult = await setMasterAdmin({
      by: formerSession,
      of: people.former,
      isMasterAdmin: true,
    });

    // The column only another master admin may write.
    expect(toThemselves.status).toBe(ExceptionCode.BadDataException);
    expect(errorMessageOf(toThemselves)).toBe(
      "User is not allowed to update on isMasterAdmin column of User. No permission allows it: the column is changed by the server, not by a request.",
    );
    expect(users.get(people.former)?.["isMasterAdmin"]).toBe(false);

    const toSomeoneElse: HttpResult = await setMasterAdmin({
      by: formerSession,
      of: people.member,
      isMasterAdmin: true,
    });

    // Another person's account is not theirs to change at all.
    expect(toSomeoneElse.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(errorMessageOf(toSomeoneElse)).toBe(
      "You do not have permission to access another user's User.",
    );
    expect(users.get(people.member)?.["isMasterAdmin"]).toBe(false);

    // Nothing was written to either account after the access was removed.
    expect(
      users.updates.filter((update: { id: string; set: StoredRow }) => {
        return update.set["isMasterAdmin"] === true;
      }),
    ).toEqual([]);

    // Their own account is still theirs to read: the session is not ended.
    expect((await listUsers(formerSession)).status).toBe(200);
  });

  test("reads only their own account, as every other person does", async () => {
    const formerSession: string = sessionOf(people.former, true);

    await removeAccessOfFormer(sessionOf(people.admin, true));

    const accounts: HttpResult = await listUsers(formerSession);

    expect(accounts.status).toBe(200);
    expect(idsListed(accounts)).toEqual([
      people.former.toString().toLowerCase(),
    ]);
  });

  test("no longer reads a project they are not a member of", async () => {
    const formerSession: string = sessionOf(people.former, true);

    await removeAccessOfFormer(sessionOf(people.admin, true));

    const result: HttpResult = await listLabels(
      OTHER_PROJECT_ID,
      formerSession,
    );

    // Refused by the project's own permission checks, as anyone outside it is.
    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(errorMessageOf(result)).toContain(
      "You do not have permissions to read Label.",
    );

    // Asked only as the person they are now: never as a master admin.
    expect(reached.length).toBeGreaterThan(0);

    for (const entry of reached) {
      expect(entry).toMatchObject({
        userId: people.former.toString(),
        tenantId: OTHER_PROJECT_ID.toString(),
        isMasterAdmin: false,
        userType: UserType.User,
      });
    }
  });

  /*
   * "The projects they are a member of stay as they are": nobody is signed
   * out, and the same session goes on as the member they are.
   */
  test("keeps the projects they are a member of, as the member they are", async () => {
    const formerSession: string = sessionOf(people.former, true);

    await removeAccessOfFormer(sessionOf(people.admin, true));

    const result: HttpResult = await listLabels(
      THEIR_PROJECT_ID,
      formerSession,
    );

    expect(result.status).toBe(200);
    expect(reached[0]).toMatchObject({
      what: "labels (list)",
      userId: people.former.toString(),
      tenantId: THEIR_PROJECT_ID.toString(),
      isMasterAdmin: false,
      userType: UserType.User,
    });
  });

  test("is held to the server's Require SSO, as every member is", async () => {
    serverRequiresSso = true;

    const formerSession: string = sessionOf(people.former, true);

    expect((await listLabels(THEIR_PROJECT_ID, formerSession)).status).toBe(
      200,
    );
    reached.length = 0;

    await removeAccessOfFormer(sessionOf(people.admin, true));

    const result: HttpResult = await listLabels(
      THEIR_PROJECT_ID,
      formerSession,
    );

    expect(result.status).toBe(ExceptionCode.SsoAuthorizationException);
    expect(reached).toEqual([]);
  });

  test("is refused the Admin Dashboard itself", async () => {
    const formerSession: string = sessionOf(people.former, true);

    expect((await openAdminDashboard(formerSession)).status).toBe(200);

    await removeAccessOfFormer(sessionOf(people.admin, true));

    const result: HttpResult = await openAdminDashboard(formerSession);

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(errorMessageOf(result)).toBe(SHELL_NOT_A_MASTER_ADMIN_MESSAGE);
    expect(result.text).not.toContain("Admin Dashboard</html>");
  });

  test("the master admin who removed it, and the sessions of other people, are unaffected", async () => {
    const adminSession: string = sessionOf(people.admin, true);

    await removeAccessOfFormer(adminSession);

    for (const route of MASTER_ADMIN_ROUTES) {
      reached.length = 0;

      const result: HttpResult = await send({
        method: route.method,
        path: route.path(people.member),
        token: adminSession,
        body: route.method === "POST" ? route.body || {} : undefined,
      });

      expect({ route: route.name, status: result.status }).toEqual({
        route: route.name,
        status: 200,
      });
      expect(reachedNames()).toEqual([route.reaches(people.member)]);
    }

    // Someone who was never a master admin was never one.
    reached.length = 0;
    const memberResult: HttpResult = await callRoute(
      MASTER_ADMIN_ROUTES[0]!,
      sessionOf(people.member, false),
    );
    expect(memberResult.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(reached).toEqual([]);
  });

  /*
   * The instance-wide master API key is a credential of its own, not
   * anyone's session: removing a person's access does not change what it
   * reaches (the read-only master-admin routes).
   */
  test("the master API key still reads what it read", async () => {
    await removeAccessOfFormer(sessionOf(people.admin, true));

    const result: HttpResult = await send({
      method: "POST",
      path: `/api/user/${people.former.toString()}/projects`,
      headers: { apikey: MASTER_API_KEY },
      body: {},
    });

    expect(result.status).toBe(200);
    expect(reachedNames()).toEqual(["memberships of a user"]);
  });
});

describe("blocked as well as no longer a master admin", () => {
  test("is refused as blocked (401), which also ends their sessions", async () => {
    const adminSession: string = sessionOf(people.admin, true);
    const formerSession: string = sessionOf(people.former, true);

    const result: HttpResult = await send({
      method: "PUT",
      path: `/api/user/${people.former.toString()}`,
      token: adminSession,
      body: { data: { isMasterAdmin: false, isBlocked: true } },
    });

    expect(result.status).toBe(200);

    for (const route of MASTER_ADMIN_ROUTES) {
      const refused: HttpResult = await callRoute(route, formerSession);

      expect({ route: route.name, status: refused.status }).toEqual({
        route: route.name,
        status: ExceptionCode.NotAuthenticatedException,
      });
    }

    expect((await listLabels(THEIR_PROJECT_ID, formerSession)).status).toBe(
      ExceptionCode.NotAuthenticatedException,
    );
    expect(reached).toEqual([]);
  });
});

describe("removed on another app server", () => {
  /*
   * Another app server wrote the change: this one is not told by the
   * write. It is told by the access change that server announces on
   * Valkey (RealtimeAccessChanges), and forgets what it held at once.
   */
  test("takes effect here as soon as the change is announced", async () => {
    const formerSession: string = sessionOf(people.former, true);
    const route: MasterAdminRoute = MASTER_ADMIN_ROUTES[0]!;

    // This server has read the account, and holds it.
    expect((await callRoute(route, formerSession)).status).toBe(200);
    reached.length = 0;

    // Another server removes the access: the row changes, nothing here hears of it.
    users.get(people.former)!["isMasterAdmin"] = false;

    RealtimeAccessChanges.receive(
      JSON.stringify({
        origin: ObjectID.generate().toString(),
        change: {
          kind: RealtimeAccessChangeKind.AccountChanged,
          userId: people.former.toString(),
        },
      }),
    );

    const result: HttpResult = await callRoute(route, formerSession);

    expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
    expect(reached).toEqual([]);
  });

  /*
   * When the announcement cannot reach this server (Valkey is down), what
   * it holds about the account runs out within a minute - not at the end
   * of the session's 15-minute access token.
   */
  test("takes effect here within a minute when the change is never announced", async () => {
    const formerSession: string = sessionOf(people.former, true);
    const route: MasterAdminRoute = MASTER_ADMIN_ROUTES[0]!;

    expect((await callRoute(route, formerSession)).status).toBe(200);
    reached.length = 0;

    users.get(people.former)!["isMasterAdmin"] = false;

    const startedAt: number = Date.now();
    const now: ReturnType<typeof jest.spyOn> = jest.spyOn(Date, "now");

    try {
      // Within the minute, this server may still answer as it last read.
      now.mockReturnValue(startedAt + 61 * 1000);

      const result: HttpResult = await callRoute(route, formerSession);

      expect(result.status).toBe(ExceptionCode.NotAuthorizedException);
      expect(reached).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });
});

describe("made a master admin while signed in", () => {
  /*
   * A session is a master admin's only while its token says so as well:
   * a change to an account only ever takes access away from the sessions it
   * already has. Someone made a master admin is one from their next sign-in
   * or the session's next renewal - at most 15 minutes.
   */
  test("is one from the session's next renewal, not with the session they had", async () => {
    const memberSession: string = sessionOf(people.member, false);

    const made: HttpResult = await setMasterAdmin({
      by: sessionOf(people.admin, true),
      of: people.member,
      isMasterAdmin: true,
    });

    expect(made.status).toBe(200);
    expect(users.get(people.member)?.["isMasterAdmin"]).toBe(true);

    const withOldSession: HttpResult = await callRoute(
      MASTER_ADMIN_ROUTES[0]!,
      memberSession,
    );
    expect(withOldSession.status).toBe(ExceptionCode.NotAuthorizedException);

    reached.length = 0;

    const withRenewedSession: HttpResult = await callRoute(
      MASTER_ADMIN_ROUTES[0]!,
      sessionOf(people.member, true),
    );
    expect(withRenewedSession.status).toBe(200);
    expect(reachedNames()).toEqual([
      MASTER_ADMIN_ROUTES[0]!.reaches(people.admin),
    ]);
  });
});

describe("when whether someone is a master admin cannot be read", () => {
  /*
   * A failed read answers nothing about the person: it is an error, never
   * the token's word for it.
   */
  test("a master admin's session is refused with the error, and reaches nothing", async () => {
    const formerSession: string = sessionOf(people.former, true);

    users.repository.find.mockRejectedValue(
      clientTimeout('SELECT "User"."_id" FROM "User" "User"') as never,
    );

    for (const route of MASTER_ADMIN_ROUTES) {
      const result: HttpResult = await callRoute(route, formerSession);

      expect({ route: route.name, status: result.status >= 500 }).toEqual({
        route: route.name,
        status: true,
      });
    }

    const labels: HttpResult = await listLabels(
      OTHER_PROJECT_ID,
      formerSession,
    );
    expect(labels.status).toBeGreaterThanOrEqual(500);

    const dashboard: HttpResult = await openAdminDashboard(formerSession);
    expect(dashboard.status).toBeGreaterThanOrEqual(500);
    expect(dashboard.text).not.toContain("Admin Dashboard</html>");

    expect(reached).toEqual([]);
  });
});

describe("without a session", () => {
  test("every master-admin route asks who is calling (401)", async () => {
    for (const route of MASTER_ADMIN_ROUTES) {
      const result: HttpResult = await send({
        method: route.method,
        path: route.path(people.admin),
        body: route.method === "POST" ? route.body || {} : undefined,
      });

      expect({ route: route.name, status: result.status }).toEqual({
        route: route.name,
        status: ExceptionCode.NotAuthenticatedException,
      });
    }

    expect(reached).toEqual([]);
  });
});
