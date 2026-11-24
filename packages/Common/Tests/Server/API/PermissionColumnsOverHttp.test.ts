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
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  getCustomRolePermissionProblem,
  getTenantPermissionProblem,
  PermissionHolder,
} from "../../../Types/Team/CustomRole";
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
import { treatEverySessionAsLive } from "../TestingUtils/LiveSessions";
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

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A PERMISSION, THROUGH THE API TERRAFORM AND THE CLI CALL (#10300).
 *
 * A team's, an API key's and a custom role's permission is a permission's
 * key. The API spec documented it as an object, so the Terraform provider
 * asked for jsonencode("IncidentMember") and the CLI for '"IncidentMember"'.
 * Here, through the routes they call, as a project owner's API key: the key
 * goes in as a string and comes back as one - from a create, a read, an
 * update and a list - while the JSON text of the key, quotes and all, and the
 * object the spec used to show are refused, in the words the Dashboard uses,
 * and nothing is written. That is why the provider and the CLI send the key
 * whichever way it is written.
 *
 * The routes run behind the real request middleware (the project API key and
 * the tenantid header), BaseAPI, DatabaseService with its permission layer,
 * and each table's own service. Stubbed: the key and project lookups the
 * middleware makes, the plan, the audit log, realtime, Redis, a custom role's
 * sync of its copies, and the tables, held in memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10300000-0000-4000-8000-0000000000a1",
);

const OWNERS_TEAM: string = "10300000-0000-4000-8000-0000000000e1";
const RESPONDERS_TEAM: string = "10300000-0000-4000-8000-0000000000e2";

// The owner's API key, as Terraform and the CLI call with it.
const OWNER_KEY_ID: string = "10300000-0000-4000-8000-0000000000c1";
const OWNER_KEY_SECRET: string = "10300000-0000-4000-8000-0000000000f1";
// The key whose permissions the requests give.
const CI_KEY_ID: string = "10300000-0000-4000-8000-0000000000c2";

const ROLE_ID: string = "10300000-0000-4000-8000-000000000071";

// The key the spec's example and the Developer pages give, and another.
const KEY: Permission = Permission.IncidentMember;
const ANOTHER_KEY: Permission = Permission.ReadProjectIncident;

let server: http.Server | null = null;
let port: number = 0;

interface HttpResult {
  status: number;
  body: JSONObject;
}

function call(data: {
  method: "POST" | "PUT";
  path: string;
  body?: JSONObject | undefined;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = data.body ? JSON.stringify(data.body) : "";

      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api" + data.path,
          method: data.method,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            "x-forwarded-for": "203.0.113.8",
            tenantid: PROJECT_ID.toString(),
            apikey: OWNER_KEY_SECRET,
          },
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

let teamPermissions: InMemoryTable;
let apiKeyPermissions: InMemoryTable;
let rolePermissions: InMemoryTable;

// A table that holds one permission a row, and what its create and refusal take.
interface PermissionRoute {
  label: string;
  path: string;
  table: () => InMemoryTable;
  // What the row belongs to, and what else a create sends.
  data: JSONObject;
  // How OneUptime refuses a value that is no permission it gives.
  refusal: (permission: unknown) => string | null;
  /*
   * The relations a read of the row loads from the database, which a table
   * in memory does not join: a team's permission is changed only on a team
   * whose permissions may be.
   */
  relationsOf?: (() => StoredRow) | undefined;
}

const ROUTES: Array<PermissionRoute> = [
  {
    label: "a team's permission",
    path: "/team-permission",
    table: (): InMemoryTable => {
      return teamPermissions;
    },
    data: {
      teamId: RESPONDERS_TEAM,
      isBlockPermission: false,
      scope: PermissionScope.All,
    },
    refusal: (permission: unknown): string | null => {
      return getTenantPermissionProblem({
        permission,
        holder: PermissionHolder.Team,
      });
    },
    relationsOf: (): StoredRow => {
      return { team: { _id: RESPONDERS_TEAM, isPermissionsEditable: true } };
    },
  },
  {
    label: "an API key's permission",
    path: "/api-key-permission",
    table: (): InMemoryTable => {
      return apiKeyPermissions;
    },
    data: { apiKeyId: CI_KEY_ID, isBlockPermission: false },
    refusal: (permission: unknown): string | null => {
      return getTenantPermissionProblem({
        permission,
        holder: PermissionHolder.ApiKey,
      });
    },
  },
  {
    label: "a custom role's permission",
    path: "/custom-role-permission",
    table: (): InMemoryTable => {
      return rolePermissions;
    },
    data: { customRoleId: ROLE_ID, scope: PermissionScope.All },
    // A custom role holds only what a team may be given, and says so.
    refusal: (permission: unknown): string | null => {
      return getCustomRolePermissionProblem({
        permission: permission as string,
        scope: PermissionScope.All,
      });
    },
  },
];

const routeCases: Array<[string, PermissionRoute]> = ROUTES.map(
  (route: PermissionRoute): [string, PermissionRoute] => {
    return [route.label, route];
  },
);

beforeAll(async () => {
  // Custom roles are an Enterprise Edition feature.
  installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.CustomRoles]);

  const app: express.Express = express();
  app.use(CookieParser());
  app.use(express.json());

  const services: Array<[{ new (): BaseModel }, DatabaseService<BaseModel>]> = [
    [
      TeamPermission,
      TeamPermissionService as unknown as DatabaseService<BaseModel>,
    ],
    [
      ApiKeyPermission,
      ApiKeyPermissionService as unknown as DatabaseService<BaseModel>,
    ],
    [
      CustomRolePermission,
      CustomRolePermissionService as unknown as DatabaseService<BaseModel>,
    ],
  ];

  for (const [modelType, service] of services) {
    app.use(
      "/api",
      new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
        modelType,
        service,
      ).getRouter(),
    );
  }

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

  // The key and the project, as the middleware reads them.
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
    return secret.toString().toLowerCase() === OWNER_KEY_SECRET
      ? {
          id: new ObjectID(OWNER_KEY_ID),
          projectId: PROJECT_ID,
          name: "Terraform",
        }
      : null;
  }) as never);

  // Every permission set is built again from the rows below, on every request.
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
  useInMemoryTable(TeamMemberService, []);
  useInMemoryTable(TeamService, [
    {
      _id: OWNERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Owners",
      isPermissionsEditable: false,
    },
    {
      _id: RESPONDERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Responders",
      isPermissionsEditable: true,
    },
  ]);
  teamPermissions = useInMemoryTable(TeamPermissionService, []);
  useInMemoryTable(ApiKeyService, [
    { _id: OWNER_KEY_ID, projectId: PROJECT_ID.toString(), name: "Terraform" },
    { _id: CI_KEY_ID, projectId: PROJECT_ID.toString(), name: "CI" },
  ]);
  apiKeyPermissions = useInMemoryTable(ApiKeyPermissionService, [
    // What the owner's key holds, which lets it give any permission.
    {
      _id: "10300000-0000-4000-8000-0000000000c9",
      apiKeyId: OWNER_KEY_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.ProjectOwner,
      isBlockPermission: false,
      labels: [],
    },
  ]);
  useInMemoryTable(CustomRoleService, [
    {
      _id: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Incident Responder",
      permissionCount: 0,
    },
  ]);
  rolePermissions = useInMemoryTable(CustomRolePermissionService, []);
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

// The rows a create wrote, other than those the table started with.
function written(route: PermissionRoute): Array<StoredRow> {
  return route.table().inserts;
}

async function create(
  route: PermissionRoute,
  permission: unknown,
): Promise<HttpResult> {
  const result: HttpResult = await call({
    method: "POST",
    path: route.path,
    body: {
      data: {
        ...route.data,
        projectId: PROJECT_ID.toString(),
        permission: permission as JSONObject,
      },
    },
  });

  // What a later read of the row would load with it.
  for (const inserted of written(route)) {
    const row: StoredRow | undefined = route
      .table()
      .get(String(inserted["_id"]));

    if (row) {
      Object.assign(row, route.relationsOf?.() || {});
    }
  }

  return result;
}

describe("a permission's key goes in and comes back as a string", () => {
  test.each(routeCases)(
    "%s: a create, a read, an update and a list",
    async (_label: string, route: PermissionRoute) => {
      const created: HttpResult = await create(route, KEY);

      expect(created.status).toBe(200);
      expect(written(route)).toHaveLength(1);
      // Kept as the key: a string, not JSON of it.
      expect(written(route)[0]!["permission"]).toBe(KEY);

      const id: string = written(route)[0]!["_id"] as string;

      const read: HttpResult = await call({
        method: "POST",
        path: `${route.path}/${id}/get-item`,
        body: { select: { _id: true, permission: true } },
      });

      expect(read.status).toBe(200);
      expect(read.body["permission"]).toBe(KEY);

      const updated: HttpResult = await call({
        method: "PUT",
        path: `${route.path}/${id}`,
        body: { data: { permission: ANOTHER_KEY } },
      });

      expect(updated.status).toBe(200);
      expect(
        route.table().rows.find((row: StoredRow): boolean => {
          return row["_id"] === id;
        })?.["permission"],
      ).toBe(ANOTHER_KEY);

      // The data source's lookup: the rows that hold the key.
      const listed: HttpResult = await call({
        method: "POST",
        path: `${route.path}/get-list`,
        body: {
          query: { permission: ANOTHER_KEY },
          select: { _id: true, permission: true },
        },
      });

      expect(listed.status).toBe(200);
      expect(
        (listed.body["data"] as Array<JSONObject>).map(
          (row: JSONObject): unknown => {
            return [row["_id"], row["permission"]];
          },
        ),
      ).toEqual([[id, ANOTHER_KEY]]);
    },
  );
});

describe("what the key is not, OneUptime refuses, and writes nothing", () => {
  test.each(routeCases)(
    "%s: the JSON text of the key, quotes and all, as jsonencode() writes it",
    async (_label: string, route: PermissionRoute) => {
      const encoded: string = JSON.stringify(KEY);
      const result: HttpResult = await create(route, encoded);

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(route.refusal(encoded));
      // Named as it was sent, quotes and all: no permission is called that.
      expect(errorOf(result)).toContain(`"${KEY}"`);
      expect(written(route)).toEqual([]);
    },
  );

  test.each(routeCases)(
    "%s: the object the spec showed as a permission's example",
    async (_label: string, route: PermissionRoute) => {
      const result: HttpResult = await create(route, {
        read: true,
        write: false,
        delete: false,
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe("Pick a permission.");
      expect(written(route)).toEqual([]);
    },
  );

  test.each(routeCases)(
    "%s: an update to the JSON text of another key",
    async (_label: string, route: PermissionRoute) => {
      const created: HttpResult = await create(route, KEY);

      expect(created.status).toBe(200);

      const id: string = written(route)[0]!["_id"] as string;
      const encoded: string = JSON.stringify(ANOTHER_KEY);
      const result: HttpResult = await call({
        method: "PUT",
        path: `${route.path}/${id}`,
        body: { data: { permission: encoded } },
      });

      expect(result.status).toBe(400);
      expect(errorOf(result)).toBe(route.refusal(encoded));
      expect(
        route.table().rows.find((row: StoredRow): boolean => {
          return row["_id"] === id;
        })?.["permission"],
      ).toBe(KEY);
    },
  );
});
