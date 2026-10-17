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
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import IncidentService from "../../../Server/Services/IncidentService";
import LabelService from "../../../Server/Services/LabelService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import CookieUtil from "../../../Server/Utils/Cookie";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import User from "../../../Models/DatabaseModels/User";
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
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PositiveNumber from "../../../Types/PositiveNumber";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  clientTimeout,
  connectionLost,
  databaseAnswer,
  notSent,
} from "../TestingUtils/StatementFailures";
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
 * A SIGN-IN RULE THAT CANNOT BE READ IS NOT A RULE THAT IS OFF, OVER HTTP.
 *
 * Require SSO for Login is a rule of the whole server (Admin Dashboard >
 * Settings > Authentication) and of each project (Project Settings > SSO).
 * Every request in a project asks it (UserMiddleware) whether the person's
 * session must also carry an SSO sign-in. The rules are kept for a minute on
 * each server, so a request reads them from the database whenever that
 * minute has run out - and that read can fail: the database restarts, the
 * pool of connections is full, a statement times out under load.
 *
 * A rule that could not be read answers nothing about the person. The
 * request is refused with the error, as when any other part of its access
 * cannot be looked up, and the next request asks again from the start:
 * nothing about the failure is remembered. Read as "not required", it let a
 * session that never signed in with SSO into every project of a server that
 * requires SSO, for as long as the reads failed.
 *
 * The one exemption stays as it was: a server admin is never held to the
 * server's rule (so a broken server SSO cannot lock out the people who fix
 * it), so a failure to read it does not stand between them and a project.
 *
 * Each case is a real HTTP request to a real Express app - cookie parsing,
 * the JSON body parser, real CRUD routers of project-scoped models (Label,
 * and Incident for the read across projects), the real user middleware and
 * the production error handler - carrying sessions and SSO sign-ins signed
 * for real (JSONWebToken, CookieUtil). The rules are read by the real
 * GlobalConfigService and ProjectService, with their caches, from tables held
 * in memory (InMemoryRepository) whose reads fail the way Postgres reads fail
 * (StatementFailures). The rest of the data layer is stubbed, and records
 * what reached it.
 */

const MEMBER_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const SERVER_ADMIN_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);

// A project of the member that does not require SSO itself.
const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-0000000000a1",
);

// Another project of the member that does not require SSO itself either.
const SECOND_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-0000000000a2",
);

// A project of the member that requires SSO itself.
const PROJECT_REQUIRING_SSO: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-0000000000a3",
);

// A project the member was in, deleted since: no row is left of it.
const DELETED_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-0000000000a4",
);

// The server's Global SSO provider.
const GLOBAL_SAML_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-0000000000b1",
);

// A label of a project, for the requests that name one.
const LABEL_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-0000000000c1");

const SERVER_CONFIG_ID: string = ObjectID.getZeroObjectID().toString();

// How a read of each table goes out to Postgres.
const SERVER_RULE_STATEMENT: string =
  'SELECT "GlobalConfig"."_id" AS "GlobalConfig__id", "GlobalConfig"."requireSsoForLogin" AS "GlobalConfig_requireSsoForLogin" FROM "GlobalConfig" "GlobalConfig" LIMIT 1';
const PROJECT_RULE_STATEMENT: string =
  'SELECT "Project"."_id" AS "Project__id", "Project"."requireSsoForLogin" AS "Project_requireSsoForLogin", "Project"."requireSsoWithSsoProviderId" AS "Project_requireSsoWithSsoProviderId" FROM "Project" "Project" WHERE "Project"."_id" = $1 LIMIT 1';

/*
 * The ways a read fails, as TypeORM hands them over: the client gave up
 * waiting, the connection went while the statement ran, the statement never
 * left (the pool was full, or closing), the database cancelled it at its own
 * time limit, the database was starting up.
 */
interface ReadFailure {
  name: string;
  failure: (statement: string) => Error;
}

const READ_FAILURES: Array<ReadFailure> = [
  {
    name: "the client stopped waiting for the answer",
    failure: (statement: string): Error => {
      return clientTimeout(statement);
    },
  },
  {
    name: "the connection was lost while the read ran",
    failure: (statement: string): Error => {
      return connectionLost(statement);
    },
  },
  {
    name: "the read was never sent",
    failure: (statement: string): Error => {
      return notSent(statement, "Connection pool is full");
    },
  },
  {
    name: "the database cancelled the read at its time limit",
    failure: (statement: string): Error => {
      return databaseAnswer({
        code: "57014",
        message: "canceling statement due to statement timeout",
        statement: statement,
      });
    },
  },
  {
    name: "the database was starting up",
    failure: (statement: string): Error => {
      return databaseAnswer({
        code: "57P03",
        message: "the database system is starting up",
        severity: "FATAL",
        statement: statement,
      });
    },
  },
];

const A_READ_FAILURE: ReadFailure = READ_FAILURES[0]!;

let serverConfig: InMemoryTable;
let projects: InMemoryTable;

// What a read of each table fails with while it fails; absent when it answers.
const failingReads: Map<InMemoryTable, (statement: string) => Error> =
  new Map();

// How many times each table was read.
const reads: Map<InMemoryTable, number> = new Map();

interface Reached {
  what: string;
  userId: string | undefined;
  tenantId: string | undefined;
  // In a request across projects: the projects it was asked with, and the permissions in each.
  permissions: Dictionary<Array<string>> | undefined;
}

const reached: Array<Reached> = [];

let server: http.Server | null = null;
let port: number = 0;

function member(): User {
  const user: User = new User();
  user.id = MEMBER_ID;
  user.email = new Email("member@example.com");
  user.name = new Name("Member");
  return user;
}

// A session: the access token every sign-in gives, password and SSO alike.
function sessionToken(userId: ObjectID, isMasterAdmin: boolean): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(
        isMasterAdmin ? "admin@example.com" : "member@example.com",
      ),
      name: new Name(isMasterAdmin ? "Server Admin" : "Member"),
      timezone: null,
      isMasterAdmin: isMasterAdmin,
      isGlobalLogin: false,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

// The member signed in with a password: a session, and no SSO sign-in.
function passwordSignIn(): Dictionary<string> {
  return { [CookieUtil.getUserTokenKey()]: sessionToken(MEMBER_ID, false) };
}

// The member signed in through the server's Global SSO provider: a session, and the SSO sign-in next to it.
function ssoSignIn(): Dictionary<string> {
  return {
    [CookieUtil.getUserTokenKey()]: sessionToken(MEMBER_ID, false),
    [CookieUtil.getGlobalSSOKey()]: CookieUtil.getGlobalSSOToken({
      user: member(),
      ssoProviderId: GLOBAL_SAML_ID,
      ssoProviderType: SsoProviderType.GlobalSSO,
    }),
  };
}

// A server admin signed in with a password.
function serverAdminSignIn(): Dictionary<string> {
  return {
    [CookieUtil.getUserTokenKey()]: sessionToken(SERVER_ADMIN_ID, true),
  };
}

// The role the member holds in each of their projects; Project Admin unless a test says otherwise.
let memberRole: Permission = Permission.ProjectAdmin;

function memberPermissionIn(projectId: ObjectID): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: memberRole,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  } as UserTenantAccessPermission;
}

function namesOf(permission: UserTenantAccessPermission): Array<string> {
  return permission.permissions
    .map((held: { permission: Permission }): string => {
      return held.permission;
    })
    .sort();
}

function record(what: string, props: JSONObject): void {
  const tenantPermissions: Dictionary<UserTenantAccessPermission> | undefined =
    props["isMultiTenantRequest"]
      ? (props["userTenantAccessPermission"] as
          | Dictionary<UserTenantAccessPermission>
          | undefined)
      : undefined;

  let permissions: Dictionary<Array<string>> | undefined = undefined;

  if (tenantPermissions) {
    permissions = {};

    for (const projectId of Object.keys(tenantPermissions)) {
      permissions[projectId] = namesOf(tenantPermissions[projectId]!);
    }
  }

  reached.push({
    what: what,
    userId: props["userId"] ? String(props["userId"]) : undefined,
    tenantId: props["tenantId"] ? String(props["tenantId"]) : undefined,
    permissions: permissions,
  });
}

function projectRow(
  projectId: ObjectID,
  requireSsoForLogin: boolean,
): StoredRow {
  return {
    _id: projectId.toString(),
    name: `Project ${projectId.toString().slice(-2)}`,
    requireSsoForLogin: requireSsoForLogin,
    requireSsoWithSsoProviderId: null,
  };
}

// The table's reads answer, or fail with what `failingReads` says, and are counted.
function readsCanFail(table: InMemoryTable, statement: string): void {
  const read: (...args: Array<unknown>) => unknown =
    table.repository.find.getMockImplementation()!;

  table.repository.find.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      reads.set(table, (reads.get(table) || 0) + 1);

      const failure: ((statement: string) => Error) | undefined =
        failingReads.get(table);

      if (failure) {
        throw failure(statement);
      }

      return await read(...args);
    },
  );
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
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);

  /*
   * With billing on (as CI runs), a request in a project carries its plan:
   * the highest one, paid, so that no plan decides what is asked here.
   */
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);

  // The server's Global SSO provider is on, and signs people in to every project.
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

  /*
   * The member belongs to every project here, the deleted one included (the
   * list of their projects is a minute behind), and is an admin in each. The
   * server admin belongs to none.
   */
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockImplementation((async (
      userId: ObjectID,
    ): Promise<UserGlobalAccessPermission | null> => {
      if (userId.toString() === SERVER_ADMIN_ID.toString()) {
        return {
          _type: "UserGlobalAccessPermission",
          projectIds: [],
          globalPermissions: [Permission.Public, Permission.User],
          isMasterAdmin: true,
        } as UserGlobalAccessPermission;
      }

      if (userId.toString() !== MEMBER_ID.toString()) {
        return null;
      }

      return {
        _type: "UserGlobalAccessPermission",
        projectIds: [
          PROJECT_ID,
          SECOND_PROJECT_ID,
          PROJECT_REQUIRING_SSO,
          DELETED_PROJECT_ID,
        ],
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

  // What a request that gets through reads or writes, and as whom.
  jest.spyOn(LabelService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    record("labels (list)", data.props);
    return [];
  }) as never);
  jest.spyOn(LabelService, "countBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<PositiveNumber> => {
    record("labels (count)", data.props);
    return new PositiveNumber(0);
  }) as never);
  jest.spyOn(LabelService, "findOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Label> => {
    record("labels (read one)", data.props);
    const label: Label = new Label();
    label.id = LABEL_ID;
    return label;
  }) as never);
  jest.spyOn(LabelService, "create").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Label> => {
    record("labels (create)", data.props);
    const label: Label = new Label();
    label.id = LABEL_ID;
    return label;
  }) as never);
  jest.spyOn(LabelService, "updateOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("labels (update)", data.props);
    return 1;
  }) as never);
  jest.spyOn(LabelService, "deleteOneById").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<number> => {
    record("labels (delete)", data.props);
    return 1;
  }) as never);
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<Array<unknown>> => {
    record("incidents (list)", data.props);
    return [];
  }) as never);
  jest.spyOn(IncidentService, "countBy").mockImplementation((async (data: {
    props: JSONObject;
  }): Promise<PositiveNumber> => {
    record("incidents (count)", data.props);
    return new PositiveNumber(0);
  }) as never);

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use("/api", new BaseAPI(Label, LabelService).getRouter());
  app.use("/api", new BaseAPI(Incident, IncidentService).getRouter());
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
  reads.clear();
  failingReads.clear();
  memberRole = Permission.ProjectAdmin;

  // The server requires SSO. Of the member's projects, one requires it itself.
  serverConfig = useInMemoryTable(GlobalConfigService, [
    { _id: SERVER_CONFIG_ID, requireSsoForLogin: true },
  ]);
  projects = useInMemoryTable(ProjectService, [
    projectRow(PROJECT_ID, false),
    projectRow(SECOND_PROJECT_ID, false),
    projectRow(PROJECT_REQUIRING_SSO, true),
  ]);

  readsCanFail(serverConfig, SERVER_RULE_STATEMENT);
  readsCanFail(projects, PROJECT_RULE_STATEMENT);

  // Each test starts as a server does once its minute has run out: nothing kept.
  GlobalConfigService.forgetSignInRules();
  ProjectService.forgetSignInRules();
});

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function send(data: {
  method: HttpMethod;
  path: string;
  cookies: Dictionary<string>;
  headers: Dictionary<string>;
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
        ...data.headers,
      };

      const cookieHeader: string = Object.keys(data.cookies)
        .map((name: string): string => {
          return `${name}=${data.cookies[name]}`;
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

// Lists a project's labels: what the dashboard asks first on every page of it.
function listLabels(
  projectId: ObjectID,
  cookies: Dictionary<string>,
): Promise<HttpResult> {
  return send({
    method: "POST",
    path: "/api/label/get-list",
    cookies: cookies,
    headers: { tenantid: projectId.toString() },
    body: { query: {}, select: { _id: true } },
  });
}

// Lists the incidents of all of the member's projects at once, as the dashboard's home page does.
function listIncidentsAcrossProjects(
  cookies: Dictionary<string>,
): Promise<HttpResult> {
  return send({
    method: "POST",
    path: "/api/incident/get-list",
    cookies: cookies,
    headers: { "is-multi-tenant-query": "true" },
    body: { query: {}, select: { _id: true } },
  });
}

/*
 * Whether the answer is an error of the server - the read failed - and not
 * an answer about the person: never a success, and never "sign in with
 * SSO", which would send someone to an SSO sign-in they may not need, or
 * that may not exist.
 */
function expectAnError(result: HttpResult): void {
  expect(result.status).toBeGreaterThanOrEqual(500);
  expect(result.status).not.toBe(ExceptionCode.SsoAuthorizationException);
}

/*
 * What a list request that got through reached: the list and its count,
 * each asked as `expected` says - the person, the project, and in a request
 * across projects the permissions it held in each.
 */
function expectListedAs(expected: {
  what: string;
  userId: ObjectID;
  tenantId: ObjectID | undefined;
  permissions: Dictionary<Array<string>> | undefined;
}): void {
  expect(
    reached
      .map((entry: Reached): string => {
        return entry.what;
      })
      .sort(),
  ).toEqual([`${expected.what} (count)`, `${expected.what} (list)`]);

  for (const entry of reached) {
    expect(entry).toEqual({
      what: entry.what,
      userId: expected.userId.toString(),
      tenantId: expected.tenantId?.toString(),
      permissions: expected.permissions,
    });
  }
}

interface ApiRequest {
  name: string;
  method: HttpMethod;
  path: string;
  body?: JSONObject | undefined;
}

const A_LABEL: string = `/api/label/${LABEL_ID.toString()}`;

// Every way the API reads or changes a record of a project.
const API_REQUESTS: Array<ApiRequest> = [
  {
    name: "create a label",
    method: "POST",
    path: "/api/label",
    body: { data: { name: "Escalated" } },
  },
  {
    name: "list labels",
    method: "POST",
    path: "/api/label/get-list",
    body: { query: {}, select: { _id: true } },
  },
  {
    name: "list labels with a GET",
    method: "GET",
    path: "/api/label/get-list",
  },
  {
    name: "count labels",
    method: "POST",
    path: "/api/label/count",
    body: { query: {} },
  },
  {
    name: "read a label",
    method: "POST",
    path: `${A_LABEL}/get-item`,
    body: { select: { _id: true } },
  },
  {
    name: "read a label with a GET",
    method: "GET",
    path: `${A_LABEL}/get-item`,
  },
  {
    name: "rename a label",
    method: "PUT",
    path: A_LABEL,
    body: { data: { name: "Renamed" } },
  },
  {
    name: "rename a label with a POST",
    method: "POST",
    path: `${A_LABEL}/update-item`,
    body: { data: { name: "Renamed" } },
  },
  {
    name: "delete a label",
    method: "DELETE",
    path: A_LABEL,
  },
  {
    name: "delete a label with a POST",
    method: "POST",
    path: `${A_LABEL}/delete-item`,
  },
];

describe("a server that requires SSO, in a project that does not require it itself", () => {
  test("with the rule read, a session without an SSO sign-in is asked to sign in with SSO, and nothing is read", async () => {
    const result: HttpResult = await listLabels(PROJECT_ID, passwordSignIn());

    expect(result.status).toBe(ExceptionCode.SsoAuthorizationException);
    expect(reached).toEqual([]);
    expect(reads.get(serverConfig)).toBe(1);
  });

  test("with the rule read, a session with an SSO sign-in gets the project", async () => {
    const result: HttpResult = await listLabels(PROJECT_ID, ssoSignIn());

    expect(result.status).toBe(200);
    expectListedAs({
      what: "labels",
      userId: MEMBER_ID,
      tenantId: PROJECT_ID,
      permissions: undefined,
    });
  });

  test.each(READ_FAILURES)(
    "the rule cannot be read ($name): every request of a session without an SSO sign-in is refused with the error, and nothing is read or written",
    async (readFailure: ReadFailure) => {
      failingReads.set(serverConfig, readFailure.failure);

      for (const request of API_REQUESTS) {
        const result: HttpResult = await send({
          method: request.method,
          path: request.path,
          cookies: passwordSignIn(),
          headers: { tenantid: PROJECT_ID.toString() },
          body: request.body,
        });

        expect({
          request: request.name,
          isError: result.status >= 500,
        }).toEqual({
          request: request.name,
          isError: true,
        });
        expectAnError(result);
      }

      expect(reached).toEqual([]);
      // Asked by each request: a failure is not kept as an answer.
      expect(reads.get(serverConfig)).toBe(API_REQUESTS.length);
    },
  );

  test("the rule cannot be read: the answer is the error, not that the request must sign in with SSO", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    const result: HttpResult = await listLabels(PROJECT_ID, passwordSignIn());

    expectAnError(result);
    expect(reached).toEqual([]);
  });

  test("the rule cannot be read: a session with an SSO sign-in is refused too - the rule it would be held to is not known", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    const result: HttpResult = await listLabels(PROJECT_ID, ssoSignIn());

    expectAnError(result);
    expect(reached).toEqual([]);
  });

  test("a failed read is not remembered: once the rule reads again, the next request is answered by it", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    expectAnError(await listLabels(PROJECT_ID, passwordSignIn()));
    expectAnError(await listLabels(PROJECT_ID, ssoSignIn()));

    // The database answers again.
    failingReads.delete(serverConfig);

    expect((await listLabels(PROJECT_ID, passwordSignIn())).status).toBe(
      ExceptionCode.SsoAuthorizationException,
    );
    expect((await listLabels(PROJECT_ID, ssoSignIn())).status).toBe(200);

    // One read per request until one answered; that answer is then kept.
    expect(reads.get(serverConfig)).toBe(3);
    expectListedAs({
      what: "labels",
      userId: MEMBER_ID,
      tenantId: PROJECT_ID,
      permissions: undefined,
    });
  });

  test("a rule read once is kept for the minute: a failure of the database meanwhile changes nothing", async () => {
    expect((await listLabels(PROJECT_ID, passwordSignIn())).status).toBe(
      ExceptionCode.SsoAuthorizationException,
    );

    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    expect((await listLabels(PROJECT_ID, passwordSignIn())).status).toBe(
      ExceptionCode.SsoAuthorizationException,
    );
    expect((await listLabels(PROJECT_ID, ssoSignIn())).status).toBe(200);
    expect(reads.get(serverConfig)).toBe(1);
  });

  test("a server admin is not held to the server's rule, so a failure to read it does not keep them out of a project", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    const result: HttpResult = await listLabels(
      PROJECT_ID,
      serverAdminSignIn(),
    );

    expect(result.status).toBe(200);
    expect(reads.get(serverConfig) || 0).toBe(0);
    expectListedAs({
      what: "labels",
      userId: SERVER_ADMIN_ID,
      tenantId: PROJECT_ID,
      permissions: undefined,
    });
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ])(
    "the rule cannot be read: a %s of the project without an SSO sign-in is refused like everyone else, and nothing is read",
    async (role: Permission) => {
      memberRole = role;

      // The member's role, as the request is let in with it once the rule reads.
      expect((await listLabels(PROJECT_ID, ssoSignIn())).status).toBe(200);
      expect(
        reached.every((entry: Reached): boolean => {
          return entry.userId === MEMBER_ID.toString();
        }),
      ).toBe(true);
      reached.length = 0;
      GlobalConfigService.forgetSignInRules();

      failingReads.set(serverConfig, A_READ_FAILURE.failure);

      expectAnError(await listLabels(PROJECT_ID, passwordSignIn()));
      expect(reached).toEqual([]);
    },
  );

  test("the rule cannot be read: someone who is not a member of the project gets nothing either", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    const outsider: Dictionary<string> = {
      [CookieUtil.getUserTokenKey()]: sessionToken(
        new ObjectID("5a000000-0000-4000-8000-000000000003"),
        false,
      ),
    };

    const result: HttpResult = await listLabels(PROJECT_ID, outsider);

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(reached).toEqual([]);
  });

  test("the project's own rule cannot be read: refused with the error, server admin included, and nothing is read", async () => {
    failingReads.set(projects, A_READ_FAILURE.failure);

    for (const cookies of [
      passwordSignIn(),
      ssoSignIn(),
      serverAdminSignIn(),
    ]) {
      expectAnError(await listLabels(PROJECT_ID, cookies));
    }

    expect(reached).toEqual([]);
  });
});

/*
 * The mobile app signs its requests the other way: the session as a bearer
 * token, and its SSO sign-in in a header (x-global-sso-token, or
 * x-sso-tokens for a project's own). The same rules, read the same way.
 */
describe("the mobile app's requests: a bearer session, with its SSO sign-in in a header", () => {
  function listLabelsFromTheApp(withSsoSignIn: boolean): Promise<HttpResult> {
    const signIn: Dictionary<string> = withSsoSignIn
      ? ssoSignIn()
      : passwordSignIn();

    return send({
      method: "POST",
      path: "/api/label/get-list",
      cookies: {},
      headers: {
        tenantid: PROJECT_ID.toString(),
        authorization: `Bearer ${signIn[CookieUtil.getUserTokenKey()]!}`,
        ...(withSsoSignIn
          ? {
              "x-global-sso-token": signIn[CookieUtil.getGlobalSSOKey()]!,
            }
          : {}),
      },
      body: { query: {}, select: { _id: true } },
    });
  }

  test("with the rule read, the app is asked to sign in with SSO without one, and gets the project with one", async () => {
    expect((await listLabelsFromTheApp(false)).status).toBe(
      ExceptionCode.SsoAuthorizationException,
    );
    expect(reached).toEqual([]);

    expect((await listLabelsFromTheApp(true)).status).toBe(200);
    expectListedAs({
      what: "labels",
      userId: MEMBER_ID,
      tenantId: PROJECT_ID,
      permissions: undefined,
    });
  });

  test.each(READ_FAILURES)(
    "the rule cannot be read ($name): the app's request is refused with the error, with an SSO sign-in or without, and nothing is read",
    async (readFailure: ReadFailure) => {
      failingReads.set(serverConfig, readFailure.failure);

      for (const withSsoSignIn of [false, true]) {
        expectAnError(await listLabelsFromTheApp(withSsoSignIn));
      }

      expect(reached).toEqual([]);
    },
  );
});

describe("a project that requires SSO itself", () => {
  test("is held to its own rule, so the server's rule is not read and a failure to read it changes nothing", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    expect(
      (await listLabels(PROJECT_REQUIRING_SSO, passwordSignIn())).status,
    ).toBe(ExceptionCode.SsoAuthorizationException);
    expect((await listLabels(PROJECT_REQUIRING_SSO, ssoSignIn())).status).toBe(
      200,
    );
    expect(reads.get(serverConfig) || 0).toBe(0);
  });
});

describe("a request across the member's projects", () => {
  test("with the rules read, each project is asked with no more than a person who has not signed in with SSO may have, and a deleted project is left out", async () => {
    const result: HttpResult =
      await listIncidentsAcrossProjects(passwordSignIn());

    expect(result.status).toBe(200);

    const signedOut: Array<string> = namesOf(
      UserPermissionUtil.getDefaultUserTenantAccessPermission(PROJECT_ID),
    );

    expectListedAs({
      what: "incidents",
      userId: MEMBER_ID,
      tenantId: undefined,
      permissions: {
        [PROJECT_ID.toString()]: signedOut,
        [SECOND_PROJECT_ID.toString()]: signedOut,
        [PROJECT_REQUIRING_SSO.toString()]: signedOut,
      },
    });
    expect(signedOut).not.toContain(Permission.ProjectAdmin);
  });

  test("with the rules read, an SSO sign-in gets the member's own permissions in each project, and a deleted project is left out", async () => {
    const result: HttpResult = await listIncidentsAcrossProjects(ssoSignIn());

    expect(result.status).toBe(200);

    const admin: Array<string> = [Permission.ProjectAdmin];

    expectListedAs({
      what: "incidents",
      userId: MEMBER_ID,
      tenantId: undefined,
      permissions: {
        [PROJECT_ID.toString()]: admin,
        [SECOND_PROJECT_ID.toString()]: admin,
        [PROJECT_REQUIRING_SSO.toString()]: admin,
      },
    });
  });

  test.each(READ_FAILURES)(
    "the server's rule cannot be read ($name): refused with the error, and nothing is read",
    async (readFailure: ReadFailure) => {
      failingReads.set(serverConfig, readFailure.failure);

      for (const cookies of [passwordSignIn(), ssoSignIn()]) {
        expectAnError(await listIncidentsAcrossProjects(cookies));
      }

      expect(reached).toEqual([]);
    },
  );

  test.each(READ_FAILURES)(
    "a project's own rule cannot be read ($name): refused with the error, and nothing is read",
    async (readFailure: ReadFailure) => {
      // The server's rule is read already; then the database fails.
      expect((await listLabels(PROJECT_ID, ssoSignIn())).status).toBe(200);
      reached.length = 0;
      ProjectService.forgetSignInRules();

      failingReads.set(projects, readFailure.failure);

      for (const cookies of [passwordSignIn(), ssoSignIn()]) {
        expectAnError(await listIncidentsAcrossProjects(cookies));
      }

      expect(reached).toEqual([]);
    },
  );

  test("on a server that does not require SSO, with the rules read, a session without an SSO sign-in gets its own permissions where SSO is not required, and no more than a signed-out person's where it is", async () => {
    serverConfig.get(SERVER_CONFIG_ID)!["requireSsoForLogin"] = false;

    const result: HttpResult =
      await listIncidentsAcrossProjects(passwordSignIn());

    expect(result.status).toBe(200);
    expectListedAs({
      what: "incidents",
      userId: MEMBER_ID,
      tenantId: undefined,
      permissions: {
        [PROJECT_ID.toString()]: [Permission.ProjectAdmin],
        [SECOND_PROJECT_ID.toString()]: [Permission.ProjectAdmin],
        [PROJECT_REQUIRING_SSO.toString()]: namesOf(
          UserPermissionUtil.getDefaultUserTenantAccessPermission(
            PROJECT_REQUIRING_SSO,
          ),
        ),
      },
    });
  });

  test.each(READ_FAILURES)(
    "on a server that does not require SSO, the projects' own rules cannot be read ($name): refused with the error - the project that requires SSO is never read as not requiring it - and nothing is read",
    async (readFailure: ReadFailure) => {
      serverConfig.get(SERVER_CONFIG_ID)!["requireSsoForLogin"] = false;

      // The server's rule is read already; then the database fails.
      expect((await listLabels(PROJECT_ID, passwordSignIn())).status).toBe(200);
      reached.length = 0;
      ProjectService.forgetSignInRules();

      failingReads.set(projects, readFailure.failure);

      for (const cookies of [passwordSignIn(), ssoSignIn()]) {
        expectAnError(await listIncidentsAcrossProjects(cookies));
      }

      expect(reached).toEqual([]);
    },
  );

  test("a server admin's request across projects does not read the server's rule, so a failure to read it does not refuse it", async () => {
    failingReads.set(serverConfig, A_READ_FAILURE.failure);

    const result: HttpResult =
      await listIncidentsAcrossProjects(serverAdminSignIn());

    expect(result.status).toBe(200);
    expect(reads.get(serverConfig) || 0).toBe(0);
  });
});
