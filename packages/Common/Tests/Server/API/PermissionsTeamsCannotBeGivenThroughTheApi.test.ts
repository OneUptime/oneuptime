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

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here hashes passwords.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import BaseAPI from "../../../Server/API/BaseAPI";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import ApiKeyPermissionService, {
  Service as ApiKeyPermissionServiceType,
} from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomRolePermissionService, {
  Service as CustomRolePermissionServiceType,
} from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService, {
  Service as TeamPermissionServiceType,
} from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  getTenantPermissionProblem,
  PermissionHolder,
} from "../../../Types/Team/CustomRole";
import UserType from "../../../Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A TEAM, AN API KEY AND A CUSTOM ROLE ARE GIVEN ONLY WHAT THE PERMISSION
 * PICKERS OFFER - through the API, as Terraform, the CLI and a script call
 * it (#8281).
 *
 * The dashboard never offered them, but the API took them: a project owner
 * - and anyone may create a project and own it - could POST
 * /team-permission with Customer Support, Logged in User, User, Public, a
 * retired permission or a value that is no permission at all, and the row
 * was written. Customer Support opens a person's isDisabled and isBlocked to
 * them; the rest are OneUptime's own to give. Now every caller is refused,
 * the project owner whom the grant ceiling lets give anything included, on
 * a create and on an update, allow and block, with the words the dashboard
 * would use - and a row stored before still goes when it is deleted.
 *
 * The routes run here behind the real request middleware (a signed session,
 * or a project API key, and the tenantid header), BaseAPI, DatabaseService
 * with its whole permission layer and the three services' own hooks. Who
 * may do what is worked out by OneUptime's own AccessTokenService from the
 * project's teams below, and an API key's rows by ApiKeyPermissionService.
 * Stubbed: the session and project lookups the middleware makes, the plan,
 * the audit log, realtime, Redis, a custom role's sync of its copies (whose
 * plan has tests of its own, CustomRoleCopyPlan), and the tables, held in
 * memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8a000000-0000-4000-8000-0000000000a1",
);

// People: an owner, an admin and a member of the project.
const OWNER: ObjectID = new ObjectID("8a000000-0000-4000-8000-0000000000b1");
const ADMIN: ObjectID = new ObjectID("8a000000-0000-4000-8000-0000000000b2");
const MEMBER: ObjectID = new ObjectID("8a000000-0000-4000-8000-0000000000b3");

// Teams: the three the project starts with, and one whose permissions change.
const OWNERS_TEAM: string = "8a000000-0000-4000-8000-0000000000e1";
const ADMINS_TEAM: string = "8a000000-0000-4000-8000-0000000000e2";
const MEMBERS_TEAM: string = "8a000000-0000-4000-8000-0000000000e3";
const PLATFORM_TEAM: string = "8a000000-0000-4000-8000-0000000000e4";

// The Platform team's rows: one it may hold, and one stored before #8281.
const PLATFORM_READ_INCIDENT: string = "8a000000-0000-4000-8000-0000000000d4";
const PLATFORM_CUSTOMER_SUPPORT: string =
  "8a000000-0000-4000-8000-0000000000d5";

// API keys: the owner's (Project Owner, as Terraform runs with) and a CI key.
const OWNER_KEY_ID: string = "8a000000-0000-4000-8000-0000000000c1";
const OWNER_KEY_SECRET: string = "8a000000-0000-4000-8000-0000000000f1";
const ADMIN_KEY_ID: string = "8a000000-0000-4000-8000-0000000000c2";
const ADMIN_KEY_SECRET: string = "8a000000-0000-4000-8000-0000000000f2";
const CI_KEY_ID: string = "8a000000-0000-4000-8000-0000000000c3";

// The CI key's rows: one it may hold, and one stored before #8281.
const CI_READ_INCIDENT: string = "8a000000-0000-4000-8000-000000000092";
const CI_CUSTOMER_SUPPORT: string = "8a000000-0000-4000-8000-000000000093";

// A custom role, with one row it may hold and one stored before it couldn't.
const ROLE_ID: string = "8a000000-0000-4000-8000-000000000071";
const ROLE_READ_INCIDENT: string = "8a000000-0000-4000-8000-000000000072";
const ROLE_CUSTOMER_SUPPORT: string = "8a000000-0000-4000-8000-000000000073";

// Every permission no picker offers: what #8281 found the API still gave.
const NOT_FOR_TEAMS: Array<Permission> = [
  Permission.CustomerSupport,
  Permission.CurrentUser,
  Permission.User,
  Permission.Public,
  Permission.AuthenticatedRequest,
  Permission.UnAuthorizedSsoUser,
  Permission.CreateServiceTelemetryService,
  Permission.DeleteServiceTelemetryService,
  Permission.EditServiceTelemetryService,
  Permission.ReadServiceTelemetryService,
];

// No permission at all, nearly one, and a title rather than a value.
const NOT_PERMISSIONS: Array<string> = [
  "NotAPermission",
  "projectowner",
  "Project Owner",
];

let server: http.Server | null = null;
let port: number = 0;

function sessionOf(userId: ObjectID): string {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: userId,
      email: new Email(`${userId.toString()}@example.com`),
      name: new Name("Someone"),
      timezone: null,
      isMasterAdmin: false,
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
}

// Who calls: a person, by their session, or an API key, by its secret.
interface Caller {
  label: string;
  session?: ObjectID | undefined;
  apiKey?: string | undefined;
}

const AS_OWNER: Caller = { label: "a Project Owner", session: OWNER };
const AS_ADMIN: Caller = { label: "a Project Admin", session: ADMIN };
const AS_MEMBER: Caller = { label: "a project member", session: MEMBER };
const AS_OWNER_KEY: Caller = {
  label: "the owner's API key, as Terraform calls",
  apiKey: OWNER_KEY_SECRET,
};
const AS_ADMIN_KEY: Caller = {
  label: "a Project Admin API key",
  apiKey: ADMIN_KEY_SECRET,
};

// Those who may change permissions at all, and so reach the services' hooks.
const EDITORS: Array<Caller> = [AS_OWNER, AS_ADMIN, AS_OWNER_KEY, AS_ADMIN_KEY];
const EDITOR_CASES: Array<[string, Caller]> = EDITORS.map(
  (caller: Caller): [string, Caller] => {
    return [caller.label, caller];
  },
);

interface HttpResult {
  status: number;
  body: JSONObject;
}

function call(data: {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  as: Caller;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.body ? JSON.stringify(data.body) : "";

      const headers: http.OutgoingHttpHeaders = {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        "x-forwarded-for": "203.0.113.7",
        tenantid: PROJECT_ID.toString(),
      };

      if (data.as.session) {
        headers["authorization"] = "Bearer " + sessionOf(data.as.session);
      }

      if (data.as.apiKey) {
        headers["apikey"] = data.as.apiKey;
      }

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api" + data.path,
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
            let body: JSONObject = {};

            try {
              body = text ? (JSON.parse(text) as JSONObject) : {};
            } catch {
              body = { raw: text };
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

function errorOf(result: HttpResult): unknown {
  return result.body["error"] ?? result.body["message"];
}

const teamMessage: (permission: string) => string = (
  permission: string,
): string => {
  return getTenantPermissionProblem({
    permission,
    holder: PermissionHolder.Team,
  })!;
};

const apiKeyMessage: (permission: string) => string = (
  permission: string,
): string => {
  return getTenantPermissionProblem({
    permission,
    holder: PermissionHolder.ApiKey,
  })!;
};

const customRoleMessage: (permission: string) => string = (
  permission: string,
): string => {
  const title: string =
    permission === Permission.CustomerSupport
      ? "Customer Support"
      : permission === Permission.CurrentUser
        ? "Logged in User"
        : permission;

  return `${title} can't be given to a team, so it can't be part of a custom role.`;
};

let teams: InMemoryTable;
let teamPermissions: InMemoryTable;
let apiKeys: InMemoryTable;
let apiKeyPermissions: InMemoryTable;
let roles: InMemoryTable;
let rolePermissions: InMemoryTable;

// Every hook of the three services, to see a refusal came before or after them.
let hooks: Array<{ name: string; spy: ReturnType<typeof jest.spyOn> }> = [];

function membershipRows(): Array<StoredRow> {
  return [
    {
      _id: "8a000000-0000-4000-8000-000000000011",
      userId: OWNER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: OWNERS_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "8a000000-0000-4000-8000-000000000012",
      userId: ADMIN.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: ADMINS_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "8a000000-0000-4000-8000-000000000013",
      userId: MEMBER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: MEMBERS_TEAM,
      hasAcceptedInvitation: true,
    },
  ];
}

function teamRows(): Array<StoredRow> {
  return [
    {
      _id: OWNERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Owners",
      isPermissionsEditable: false,
    },
    {
      _id: ADMINS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Admin",
      isPermissionsEditable: false,
    },
    {
      _id: MEMBERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Members",
      isPermissionsEditable: true,
    },
    {
      _id: PLATFORM_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Platform",
      isPermissionsEditable: true,
    },
  ];
}

function teamPermissionRow(data: {
  id: string;
  teamId: string;
  permission: string;
  editable: boolean;
}): StoredRow {
  return {
    _id: data.id,
    teamId: data.teamId,
    projectId: PROJECT_ID.toString(),
    permission: data.permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    labels: [],
    team: { _id: data.teamId, isPermissionsEditable: data.editable },
  };
}

function teamPermissionRows(): Array<StoredRow> {
  return [
    teamPermissionRow({
      id: "8a000000-0000-4000-8000-0000000000d1",
      teamId: OWNERS_TEAM,
      permission: Permission.ProjectOwner,
      editable: false,
    }),
    teamPermissionRow({
      id: "8a000000-0000-4000-8000-0000000000d2",
      teamId: ADMINS_TEAM,
      permission: Permission.ProjectAdmin,
      editable: false,
    }),
    teamPermissionRow({
      id: "8a000000-0000-4000-8000-0000000000d3",
      teamId: MEMBERS_TEAM,
      permission: Permission.ProjectMember,
      editable: true,
    }),
    teamPermissionRow({
      id: PLATFORM_READ_INCIDENT,
      teamId: PLATFORM_TEAM,
      permission: Permission.ReadProjectIncident,
      editable: true,
    }),
    teamPermissionRow({
      id: PLATFORM_CUSTOMER_SUPPORT,
      teamId: PLATFORM_TEAM,
      permission: Permission.CustomerSupport,
      editable: true,
    }),
  ];
}

function apiKeyRows(): Array<StoredRow> {
  return [OWNER_KEY_ID, ADMIN_KEY_ID, CI_KEY_ID].map(
    (id: string): StoredRow => {
      return {
        _id: id,
        projectId: PROJECT_ID.toString(),
        name: `Key ${id.slice(-2)}`,
      };
    },
  );
}

function apiKeyPermissionRow(data: {
  id: string;
  apiKeyId: string;
  permission: string;
}): StoredRow {
  return {
    _id: data.id,
    apiKeyId: data.apiKeyId,
    projectId: PROJECT_ID.toString(),
    permission: data.permission,
    isBlockPermission: false,
    labels: [],
  };
}

function apiKeyPermissionRows(): Array<StoredRow> {
  return [
    apiKeyPermissionRow({
      id: "8a000000-0000-4000-8000-000000000091",
      apiKeyId: OWNER_KEY_ID,
      permission: Permission.ProjectOwner,
    }),
    apiKeyPermissionRow({
      id: "8a000000-0000-4000-8000-000000000094",
      apiKeyId: ADMIN_KEY_ID,
      permission: Permission.ProjectAdmin,
    }),
    apiKeyPermissionRow({
      id: CI_READ_INCIDENT,
      apiKeyId: CI_KEY_ID,
      permission: Permission.ReadProjectIncident,
    }),
    apiKeyPermissionRow({
      id: CI_CUSTOMER_SUPPORT,
      apiKeyId: CI_KEY_ID,
      permission: Permission.CustomerSupport,
    }),
  ];
}

function roleRows(): Array<StoredRow> {
  return [
    {
      _id: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Responders",
      permissionCount: 2,
    },
  ];
}

function rolePermissionRow(id: string, permission: string): StoredRow {
  return {
    _id: id,
    customRoleId: ROLE_ID,
    projectId: PROJECT_ID.toString(),
    permission: permission,
    scope: PermissionScope.All,
    labels: [],
  };
}

function rolePermissionRows(): Array<StoredRow> {
  return [
    rolePermissionRow(ROLE_READ_INCIDENT, Permission.ReadProjectIncident),
    rolePermissionRow(ROLE_CUSTOMER_SUPPORT, Permission.CustomerSupport),
  ];
}

beforeAll(async () => {
  // Custom roles are an Enterprise Edition feature.
  installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.CustomRoles]);

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());
  app.use(
    "/api",
    new BaseAPI<TeamPermission, TeamPermissionServiceType>(
      TeamPermission,
      TeamPermissionService,
    ).getRouter(),
  );
  app.use(
    "/api",
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
      ApiKeyPermission,
      ApiKeyPermissionService,
    ).getRouter(),
  );
  app.use(
    "/api",
    new BaseAPI<CustomRolePermission, CustomRolePermissionServiceType>(
      CustomRolePermission,
      CustomRolePermissionService,
    ).getRouter(),
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
  uninstallEnterpriseModule();

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
  stubProjectDirectory({});
  ApiKeyPermissionService.clearCache();

  // The session, the key and the project, as the middleware reads them.
  jest
    .spyOn(UserService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectService, "updateLastActive")
    .mockResolvedValue(undefined as never);
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
  treatEverySessionAsLive();
  jest
    .spyOn(UserService, "isUserMasterAdmin")
    .mockResolvedValue(false as never);
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
    .mockResolvedValue(false as never);
  // No master API key on this server.
  jest.spyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  } as never);
  jest
    .spyOn(PlanCutoffCredentialAccess, "getRefusal")
    .mockResolvedValue(null as never);
  jest.spyOn(ApiKeyService, "findApiKey").mockImplementation((async (
    secret: ObjectID,
  ): Promise<unknown> => {
    const keys: Record<string, string> = {
      [OWNER_KEY_SECRET]: OWNER_KEY_ID,
      [ADMIN_KEY_SECRET]: ADMIN_KEY_ID,
    };
    const id: string | undefined = keys[secret.toString().toLowerCase()];

    return id
      ? {
          id: new ObjectID(id),
          projectId: PROJECT_ID,
          name: `Key ${id.slice(-2)}`,
        }
      : null;
  }) as never);

  // Every permission set is rebuilt from the memberships below.
  jest
    .spyOn(UserPermissionUtil, "getUserTenantAccessPermissionFromCache")
    .mockResolvedValue(null as never);
  jest
    .spyOn(UserPermissionUtil, "getUserGlobalAccessPermissionFromCache")
    .mockResolvedValue(null as never);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined as never);
  jest.spyOn(RealtimeAccessChanges, "announce").mockReturnValue(undefined);
  jest
    .spyOn(TeamMemberService, "getTeamIdsForUser")
    .mockResolvedValue([] as never);

  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AuditLogService, "recordDelete")
    .mockResolvedValue(undefined as never);

  // A role's copies: planned and tested by CustomRoleCopyPlan.
  jest.spyOn(CustomRoleSync, "syncRoles").mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomRoleSync, "removeCopiesOfRolePermissions")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomRoleSync, "getTeamIdsGivenRoles")
    .mockResolvedValue([] as never);
  jest
    .spyOn(CustomRoleSync, "refreshMembersOfTeams")
    .mockResolvedValue(undefined as never);

  useInMemoryTable(ProjectService, [
    { _id: PROJECT_ID.toString(), name: "A project" },
  ]);
  useInMemoryTable(TeamMemberService, membershipRows());
  teams = useInMemoryTable(TeamService, teamRows());
  teamPermissions = useInMemoryTable(
    TeamPermissionService,
    teamPermissionRows(),
  );
  apiKeys = useInMemoryTable(ApiKeyService, apiKeyRows());
  apiKeyPermissions = useInMemoryTable(
    ApiKeyPermissionService,
    apiKeyPermissionRows(),
  );
  roles = useInMemoryTable(CustomRoleService, roleRows());
  rolePermissions = useInMemoryTable(
    CustomRolePermissionService,
    rolePermissionRows(),
  );

  hooks = [];

  for (const [name, service] of [
    ["team permission", TeamPermissionService],
    ["API key permission", ApiKeyPermissionService],
    ["custom role permission", CustomRolePermissionService],
  ] as Array<[string, DatabaseService<BaseModel>]>) {
    for (const hook of ["onBeforeCreate", "onBeforeUpdate", "onBeforeDelete"]) {
      hooks.push({
        name: `${name} ${hook}`,
        spy: jest.spyOn(
          service as unknown as Record<string, () => unknown>,
          hook as never,
        ),
      });
    }
  }
});

afterEach(() => {
  jest.restoreAllMocks();
  (Redis.getClient as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    null,
  );
  (Redis.isConnected as unknown as ReturnType<typeof jest.fn>).mockReturnValue(
    false,
  );
});

function anyHookRan(): boolean {
  return hooks.some((hook: { spy: ReturnType<typeof jest.spyOn> }): boolean => {
    return hook.spy.mock.calls.length > 0;
  });
}

// What a stored row holds now, its permission and scope.
function permissionOf(table: InMemoryTable, id: string): unknown {
  return table.get(id)?.["permission"];
}

function nothingWritten(): void {
  for (const table of [
    teamPermissions,
    apiKeyPermissions,
    rolePermissions,
    roles,
  ]) {
    expect(table.inserts).toEqual([]);
    expect(table.updates).toEqual([]);
    expect(table.deletes).toEqual([]);
  }
}

function teamPermissionBody(
  permission: unknown,
  options?: { isBlockPermission?: boolean | undefined } | undefined,
): JSONObject {
  return {
    data: {
      teamId: PLATFORM_TEAM,
      projectId: PROJECT_ID.toString(),
      permission: permission as string,
      isBlockPermission: Boolean(options?.isBlockPermission),
      scope: PermissionScope.All,
    },
  };
}

function apiKeyPermissionBody(
  permission: unknown,
  options?: { isBlockPermission?: boolean | undefined } | undefined,
): JSONObject {
  return {
    data: {
      apiKeyId: CI_KEY_ID,
      projectId: PROJECT_ID.toString(),
      permission: permission as string,
      isBlockPermission: Boolean(options?.isBlockPermission),
    },
  };
}

function rolePermissionBody(permission: unknown): JSONObject {
  return {
    data: {
      customRoleId: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      permission: permission as string,
      scope: PermissionScope.All,
    },
  };
}

const each: <T>(items: Array<T>) => Array<[T]> = <T>(
  items: Array<T>,
): Array<[T]> => {
  return items.map((item: T): [T] => {
    return [item];
  });
};

describe("POST /team-permission", () => {
  describe.each(EDITOR_CASES)("as %s", (_label: string, caller: Caller) => {
    test.each(each(NOT_FOR_TEAMS))(
      "%s is refused, and no row is written",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "POST",
          path: "/team-permission",
          as: caller,
          body: teamPermissionBody(permission),
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(teamMessage(permission));
        nothingWritten();
      },
    );

    test("Customer Support as a block is refused too", async () => {
      const result: HttpResult = await call({
        method: "POST",
        path: "/team-permission",
        as: caller,
        body: teamPermissionBody(Permission.CustomerSupport, {
          isBlockPermission: true,
        }),
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(teamMessage(Permission.CustomerSupport));
      nothingWritten();
    });

    test.each(each(NOT_PERMISSIONS))(
      "%s, which is no permission, is refused",
      async (value: string) => {
        const result: HttpResult = await call({
          method: "POST",
          path: "/team-permission",
          as: caller,
          body: teamPermissionBody(value),
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(teamMessage(value));
        nothingWritten();
      },
    );

    test("refused before the team is read: whatever the team, it may not hold it", async () => {
      await call({
        method: "POST",
        path: "/team-permission",
        as: caller,
        body: teamPermissionBody(Permission.CustomerSupport),
      });

      expect(teams.repository.find).not.toHaveBeenCalled();
    });
  });

  test("a Project Owner still gives a team what the picker offers", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/team-permission",
      as: AS_OWNER,
      body: teamPermissionBody(Permission.ReadProjectMonitor),
    });

    expect(result.status).toBe(200);
    expect(teamPermissions.inserts).toHaveLength(1);
    expect(teamPermissions.inserts[0]!["permission"]).toBe(
      Permission.ReadProjectMonitor,
    );
  });

  test("so does the owner's API key", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/team-permission",
      as: AS_OWNER_KEY,
      body: teamPermissionBody(Permission.ProjectMember),
    });

    expect(result.status).toBe(200);
    expect(teamPermissions.inserts).toHaveLength(1);
    expect(teamPermissions.inserts[0]!["permission"]).toBe(
      Permission.ProjectMember,
    );
  });

  test("and a Project Admin gives what their own access holds", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/team-permission",
      as: AS_ADMIN,
      body: teamPermissionBody(Permission.ProjectAdmin),
    });

    expect(result.status).toBe(200);
    expect(teamPermissions.inserts).toHaveLength(1);
  });

  test("a Project Admin's grant ceiling still holds for what a team may be given", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/team-permission",
      as: AS_ADMIN,
      body: teamPermissionBody(Permission.ProjectOwner),
    });

    expect(result.status).toBe(422);
    expect(errorOf(result)).toBe(
      "You cannot grant Project Owner because your own access does not include that permission at an equal or broader scope.",
    );
    nothingWritten();
  });

  test.each(
    each([...NOT_FOR_TEAMS.slice(0, 2), Permission.ReadProjectMonitor]),
  )(
    "a project member may not change a team's permissions at all: %s is refused before any hook",
    async (permission: Permission) => {
      const result: HttpResult = await call({
        method: "POST",
        path: "/team-permission",
        as: AS_MEMBER,
        body: teamPermissionBody(permission),
      });

      expect(result.status).toBe(422);
      nothingWritten();
      expect(anyHookRan()).toBe(false);
    },
  );
});

describe("POST /api-key-permission", () => {
  describe.each(EDITOR_CASES)("as %s", (_label: string, caller: Caller) => {
    test.each(each(NOT_FOR_TEAMS))(
      "%s is refused, and no row is written",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "POST",
          path: "/api-key-permission",
          as: caller,
          body: apiKeyPermissionBody(permission),
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(apiKeyMessage(permission));
        nothingWritten();
      },
    );

    test("Customer Support as a block is refused too", async () => {
      const result: HttpResult = await call({
        method: "POST",
        path: "/api-key-permission",
        as: caller,
        body: apiKeyPermissionBody(Permission.CustomerSupport, {
          isBlockPermission: true,
        }),
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(apiKeyMessage(Permission.CustomerSupport));
      nothingWritten();
    });

    test.each(each(NOT_PERMISSIONS))(
      "%s, which is no permission, is refused",
      async (value: string) => {
        const result: HttpResult = await call({
          method: "POST",
          path: "/api-key-permission",
          as: caller,
          body: apiKeyPermissionBody(value),
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(apiKeyMessage(value));
        nothingWritten();
      },
    );

    test("refused before the key is read: whatever the key, it may not hold it", async () => {
      await call({
        method: "POST",
        path: "/api-key-permission",
        as: caller,
        body: apiKeyPermissionBody(Permission.CustomerSupport),
      });

      expect(apiKeys.repository.find).not.toHaveBeenCalled();
    });
  });

  test("a Project Owner still gives a key what the picker offers", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/api-key-permission",
      as: AS_OWNER,
      body: apiKeyPermissionBody(Permission.ReadProjectMonitor),
    });

    expect(result.status).toBe(200);
    expect(apiKeyPermissions.inserts).toHaveLength(1);
    expect(apiKeyPermissions.inserts[0]!["permission"]).toBe(
      Permission.ReadProjectMonitor,
    );
  });

  test("so does the owner's API key", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/api-key-permission",
      as: AS_OWNER_KEY,
      body: apiKeyPermissionBody(Permission.ProjectMember),
    });

    expect(result.status).toBe(200);
    expect(apiKeyPermissions.inserts).toHaveLength(1);
  });

  test("a Project Admin's grant ceiling still holds for what a key may be given", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/api-key-permission",
      as: AS_ADMIN,
      body: apiKeyPermissionBody(Permission.ProjectOwner),
    });

    expect(result.status).toBe(422);
    expect(errorOf(result)).toBe(
      "You cannot grant an API key permission beyond your own authority",
    );
    nothingWritten();
  });

  test.each(
    each([...NOT_FOR_TEAMS.slice(0, 2), Permission.ReadProjectMonitor]),
  )(
    "a project member may not change a key's permissions at all: %s is refused before any hook",
    async (permission: Permission) => {
      const result: HttpResult = await call({
        method: "POST",
        path: "/api-key-permission",
        as: AS_MEMBER,
        body: apiKeyPermissionBody(permission),
      });

      expect(result.status).toBe(422);
      nothingWritten();
      expect(anyHookRan()).toBe(false);
    },
  );
});

describe("POST /custom-role-permission", () => {
  describe.each(EDITOR_CASES)("as %s", (_label: string, caller: Caller) => {
    test.each(each(NOT_FOR_TEAMS))(
      "%s is refused, and no row is written",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "POST",
          path: "/custom-role-permission",
          as: caller,
          body: rolePermissionBody(permission),
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toMatch(
          /can't be given to a team, so it can't be part of a custom role\.$/,
        );
        nothingWritten();
      },
    );
  });

  test.each(each([Permission.CustomerSupport, Permission.CurrentUser]))(
    "%s is named by its title",
    async (permission: Permission) => {
      const result: HttpResult = await call({
        method: "POST",
        path: "/custom-role-permission",
        as: AS_OWNER,
        body: rolePermissionBody(permission),
      });

      expect(errorOf(result)).toBe(customRoleMessage(permission));
    },
  );

  test("a role made of several permissions keeps the ones a team may hold, and refuses the other", async () => {
    // As the Create Role form sends them: one request per permission.
    const results: Array<number> = [];

    for (const permission of [
      Permission.ReadProjectMonitor,
      Permission.CustomerSupport,
      Permission.ReadAlert,
    ]) {
      const result: HttpResult = await call({
        method: "POST",
        path: "/custom-role-permission",
        as: AS_OWNER_KEY,
        body: rolePermissionBody(permission),
      });

      results.push(result.status);
    }

    expect(results).toEqual([200, 400, 200]);
    expect(
      rolePermissions.inserts.map((row: StoredRow): unknown => {
        return row["permission"];
      }),
    ).toEqual([Permission.ReadProjectMonitor, Permission.ReadAlert]);
  });
});

describe("changing a stored permission", () => {
  describe.each(EDITOR_CASES)("as %s", (_label: string, caller: Caller) => {
    test.each(each(NOT_FOR_TEAMS))(
      "a team's row is not made %s",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "PUT",
          path: `/team-permission/${PLATFORM_READ_INCIDENT}`,
          as: caller,
          body: { data: { permission } },
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(teamMessage(permission));
        expect(permissionOf(teamPermissions, PLATFORM_READ_INCIDENT)).toBe(
          Permission.ReadProjectIncident,
        );
        nothingWritten();
      },
    );

    test.each(each(NOT_FOR_TEAMS))(
      "an API key's row is not made %s",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "PUT",
          path: `/api-key-permission/${CI_READ_INCIDENT}`,
          as: caller,
          body: { data: { permission } },
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toBe(apiKeyMessage(permission));
        expect(permissionOf(apiKeyPermissions, CI_READ_INCIDENT)).toBe(
          Permission.ReadProjectIncident,
        );
        nothingWritten();
      },
    );

    test.each(each(NOT_FOR_TEAMS))(
      "a custom role's row is not made %s",
      async (permission: Permission) => {
        const result: HttpResult = await call({
          method: "PUT",
          path: `/custom-role-permission/${ROLE_READ_INCIDENT}`,
          as: caller,
          body: { data: { permission } },
        });

        expect(result.status).toBe(400);
        expect(errorOf(result)).toMatch(/can't be part of a custom role\.$/);
        expect(permissionOf(rolePermissions, ROLE_READ_INCIDENT)).toBe(
          Permission.ReadProjectIncident,
        );
        nothingWritten();
      },
    );
  });

  test("POST /:id/update-item is refused as PUT is", async () => {
    for (const [path, message] of [
      [
        `/team-permission/${PLATFORM_READ_INCIDENT}/update-item`,
        teamMessage(Permission.CustomerSupport),
      ],
      [
        `/api-key-permission/${CI_READ_INCIDENT}/update-item`,
        apiKeyMessage(Permission.CustomerSupport),
      ],
    ] as Array<[string, string]>) {
      const result: HttpResult = await call({
        method: "POST",
        path,
        as: AS_OWNER_KEY,
        body: { data: { permission: Permission.CustomerSupport } },
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(message);
    }

    nothingWritten();
  });

  test.each([
    ["a value that is no permission", "NotAPermission"],
    ["a number", 7],
    ["an empty value", ""],
  ])(
    "a team's and a key's row are not made %s",
    async (_label: string, value: unknown) => {
      const team: HttpResult = await call({
        method: "PUT",
        path: `/team-permission/${PLATFORM_READ_INCIDENT}`,
        as: AS_OWNER,
        body: { data: { permission: value as string } },
      });
      const key: HttpResult = await call({
        method: "PUT",
        path: `/api-key-permission/${CI_READ_INCIDENT}`,
        as: AS_OWNER,
        body: { data: { permission: value as string } },
      });

      expect(team.status).toBe(400);
      expect(key.status).toBe(400);
      expect(permissionOf(teamPermissions, PLATFORM_READ_INCIDENT)).toBe(
        Permission.ReadProjectIncident,
      );
      expect(permissionOf(apiKeyPermissions, CI_READ_INCIDENT)).toBe(
        Permission.ReadProjectIncident,
      );
      nothingWritten();
    },
  );

  test("a row stored with Customer Support before #8281 is not changed and kept: only deleted", async () => {
    const team: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${PLATFORM_CUSTOMER_SUPPORT}`,
      as: AS_OWNER,
      body: { data: { scope: PermissionScope.All } },
    });
    const key: HttpResult = await call({
      method: "PUT",
      path: `/api-key-permission/${CI_CUSTOMER_SUPPORT}`,
      as: AS_OWNER,
      body: { data: { isBlockPermission: true } },
    });
    const role: HttpResult = await call({
      method: "PUT",
      path: `/custom-role-permission/${ROLE_CUSTOMER_SUPPORT}`,
      as: AS_OWNER,
      body: { data: { scope: PermissionScope.All } },
    });

    expect(team.status).toBe(400);
    expect(errorOf(team)).toBe(teamMessage(Permission.CustomerSupport));
    expect(key.status).toBe(400);
    expect(errorOf(key)).toBe(apiKeyMessage(Permission.CustomerSupport));
    expect(role.status).toBe(400);
    expect(errorOf(role)).toBe(customRoleMessage(Permission.CustomerSupport));
    nothingWritten();
  });

  test("a row stored with Customer Support may be made a permission a team may hold", async () => {
    const result: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${PLATFORM_CUSTOMER_SUPPORT}`,
      as: AS_OWNER,
      body: { data: { permission: Permission.ReadProjectMonitor } },
    });

    expect(result.status).toBe(200);
    expect(permissionOf(teamPermissions, PLATFORM_CUSTOMER_SUPPORT)).toBe(
      Permission.ReadProjectMonitor,
    );
  });

  test("a row may still be changed to another permission the picker offers", async () => {
    const team: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${PLATFORM_READ_INCIDENT}`,
      as: AS_OWNER_KEY,
      body: { data: { permission: Permission.ReadAlert } },
    });
    const key: HttpResult = await call({
      method: "PUT",
      path: `/api-key-permission/${CI_READ_INCIDENT}`,
      as: AS_OWNER_KEY,
      body: { data: { permission: Permission.ReadAlert } },
    });

    expect(team.status).toBe(200);
    expect(key.status).toBe(200);
    expect(permissionOf(teamPermissions, PLATFORM_READ_INCIDENT)).toBe(
      Permission.ReadAlert,
    );
    expect(permissionOf(apiKeyPermissions, CI_READ_INCIDENT)).toBe(
      Permission.ReadAlert,
    );
  });

  test("a project member may not change one at all, and no hook runs", async () => {
    const result: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${PLATFORM_READ_INCIDENT}`,
      as: AS_MEMBER,
      body: { data: { permission: Permission.CustomerSupport } },
    });

    expect(result.status).toBe(422);
    expect(permissionOf(teamPermissions, PLATFORM_READ_INCIDENT)).toBe(
      Permission.ReadProjectIncident,
    );
    nothingWritten();
    expect(
      hooks.some(
        (hook: { name: string; spy: ReturnType<typeof jest.spyOn> }) => {
          return (
            hook.name.endsWith("onBeforeUpdate") &&
            hook.spy.mock.calls.length > 0
          );
        },
      ),
    ).toBe(false);
  });
});

describe("a row stored before #8281 is still deleted", () => {
  test.each(EDITOR_CASES)(
    "by %s, from a team, a key and a role",
    async (_label: string, caller: Caller) => {
      const team: HttpResult = await call({
        method: "DELETE",
        path: `/team-permission/${PLATFORM_CUSTOMER_SUPPORT}`,
        as: caller,
      });
      const key: HttpResult = await call({
        method: "DELETE",
        path: `/api-key-permission/${CI_CUSTOMER_SUPPORT}`,
        as: caller,
      });
      const role: HttpResult = await call({
        method: "DELETE",
        path: `/custom-role-permission/${ROLE_CUSTOMER_SUPPORT}`,
        as: caller,
      });

      expect([team.status, key.status, role.status]).toEqual([200, 200, 200]);
      expect(teamPermissions.get(PLATFORM_CUSTOMER_SUPPORT)).toBeUndefined();
      expect(apiKeyPermissions.get(CI_CUSTOMER_SUPPORT)).toBeUndefined();
      expect(rolePermissions.get(ROLE_CUSTOMER_SUPPORT)).toBeUndefined();
      // And nothing else.
      expect(teamPermissions.get(PLATFORM_READ_INCIDENT)).toBeDefined();
      expect(apiKeyPermissions.get(CI_READ_INCIDENT)).toBeDefined();
      expect(rolePermissions.get(ROLE_READ_INCIDENT)).toBeDefined();
    },
  );
});

/*
 * Changes of many rows at once: the service's updateBy, as OneUptime's own
 * code and a workflow call it, with a project owner's permissions. One row
 * that would hold what no team may hold refuses the whole change, before
 * any row is written.
 */
describe("a change of many rows at once", () => {
  const ownerProps: () => DatabaseCommonInteractionProps =
    (): DatabaseCommonInteractionProps => {
      return {
        userId: OWNER,
        tenantId: PROJECT_ID,
        userType: UserType.User,
        ...ON_HIGHEST_PLAN,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [PROJECT_ID],
          globalPermissions: [
            Permission.Public,
            Permission.User,
            Permission.CurrentUser,
          ],
        },
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.ProjectOwner,
                labelIds: [],
                isBlockPermission: false,
              },
            ],
          },
        },
      };
    };

  async function refusal(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
    } catch (err) {
      return (err as Exception).message;
    }

    throw new Error("The change was not refused.");
  }

  test("every row of a team made Customer Support: refused, none changed", async () => {
    const message: string = await refusal(() => {
      return TeamPermissionService.updateBy({
        query: { teamId: new ObjectID(PLATFORM_TEAM) },
        data: { permission: Permission.CustomerSupport },
        limit: 10,
        skip: 0,
        props: ownerProps(),
      });
    });

    expect(message).toBe(teamMessage(Permission.CustomerSupport));
    expect(permissionOf(teamPermissions, PLATFORM_READ_INCIDENT)).toBe(
      Permission.ReadProjectIncident,
    );
    nothingWritten();
  });

  test("a change of every row of a team that leaves one holding Customer Support: refused, none changed", async () => {
    const message: string = await refusal(() => {
      return TeamPermissionService.updateBy({
        query: { teamId: new ObjectID(PLATFORM_TEAM) },
        data: { scope: PermissionScope.All },
        limit: 10,
        skip: 0,
        props: ownerProps(),
      });
    });

    expect(message).toBe(teamMessage(Permission.CustomerSupport));
    nothingWritten();
  });

  test("every row of a key made Logged in User: refused, none changed", async () => {
    const message: string = await refusal(() => {
      return ApiKeyPermissionService.updateBy({
        query: { apiKeyId: new ObjectID(CI_KEY_ID) },
        data: { permission: Permission.CurrentUser },
        limit: 10,
        skip: 0,
        props: ownerProps(),
      });
    });

    expect(message).toBe(apiKeyMessage(Permission.CurrentUser));
    expect(permissionOf(apiKeyPermissions, CI_READ_INCIDENT)).toBe(
      Permission.ReadProjectIncident,
    );
    nothingWritten();
  });

  test("every row of a role made Public: refused, none changed", async () => {
    const message: string = await refusal(() => {
      return CustomRolePermissionService.updateBy({
        query: { customRoleId: new ObjectID(ROLE_ID) },
        data: { permission: Permission.Public },
        limit: 10,
        skip: 0,
        props: ownerProps(),
      });
    });

    expect(message).toBe(customRoleMessage(Permission.Public));
    nothingWritten();
  });
});

/*
 * Who is trusted with what they write: OneUptime's own writes alone (root),
 * such as the project's first teams and the data migrations. A master admin
 * is a person, who passes every grant ceiling, and is refused like a
 * project owner.
 */
describe("who may write one", () => {
  test("a master admin may not give a team or a key Customer Support", async () => {
    const masterAdmin: DatabaseCommonInteractionProps = {
      userId: OWNER,
      tenantId: PROJECT_ID,
      isMasterAdmin: true,
      userType: UserType.MasterAdmin,
      ...ON_HIGHEST_PLAN,
    };

    const team: TeamPermission = new TeamPermission();
    team.teamId = new ObjectID(PLATFORM_TEAM);
    team.projectId = PROJECT_ID;
    team.permission = Permission.CustomerSupport;

    const key: ApiKeyPermission = new ApiKeyPermission();
    key.apiKeyId = new ObjectID(CI_KEY_ID);
    key.projectId = PROJECT_ID;
    key.permission = Permission.CustomerSupport;

    await expect(
      TeamPermissionService.create({ data: team, props: masterAdmin }),
    ).rejects.toThrow(teamMessage(Permission.CustomerSupport));
    await expect(
      ApiKeyPermissionService.create({ data: key, props: masterAdmin }),
    ).rejects.toThrow(apiKeyMessage(Permission.CustomerSupport));
    nothingWritten();
  });

  test("OneUptime's own writes still go through, as a data migration's row does", async () => {
    const team: TeamPermission = new TeamPermission();
    team.teamId = new ObjectID(PLATFORM_TEAM);
    team.projectId = PROJECT_ID;
    team.permission = Permission.ProjectMember;

    await TeamPermissionService.create({
      data: team,
      props: { isRoot: true },
    });

    expect(teamPermissions.inserts).toHaveLength(1);
  });
});
