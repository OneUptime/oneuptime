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
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import BillingInvoiceService from "../../../Server/Services/BillingInvoiceService";
import CephClusterFeedService from "../../../Server/Services/CephClusterFeedService";
import CloudResourceFeedService from "../../../Server/Services/CloudResourceFeedService";
import CustomRolePermissionService from "../../../Server/Services/CustomRolePermissionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseServerFeedService from "../../../Server/Services/DatabaseServerFeedService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerSwarmClusterFeedService from "../../../Server/Services/DockerSwarmClusterFeedService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OpenStackCloudFeedService from "../../../Server/Services/OpenStackCloudFeedService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProxmoxClusterFeedService from "../../../Server/Services/ProxmoxClusterFeedService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ServiceFeedService from "../../../Server/Services/ServiceFeedService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import StorageArrayFeedService from "../../../Server/Services/StorageArrayFeedService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import VMwareVCenterFeedService from "../../../Server/Services/VMwareVCenterFeedService";
import CustomRoleSync from "../../../Server/Utils/CustomRole/CustomRoleSync";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import PlanCutoffCredentialAccess from "../../../Server/Utils/Billing/PlanCutoffCredentialAccess";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import UserPermissionUtil from "../../../Server/Utils/UserPermission/UserPermission";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import BillingInvoice from "../../../Models/DatabaseModels/BillingInvoice";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { PermissionHelper } from "../../../Types/Permission";
import {
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
 * THE 28 PERMISSIONS THAT GRANTED NOTHING, THROUGH THE API (#8275, #8276,
 * #8277).
 *
 * Custom roles, teams and API keys were offered 28 permissions nothing
 * checks. Each is retired rather than wired in, so the access people have
 * must not change: here, through the routes Terraform, the CLI and the
 * dashboard call, a member holding one gets the same answer as a member
 * who does not, and the permission that does what each was offered for
 * still does it -
 *
 *   - Edit ... Feed: no feed entry is changed, by its holder or by a
 *     project owner; Read ... Feed still reads it;
 *   - On-Call Schedule Layer User: its holder adds, reads, moves and takes
 *     out no one in a layer; the layer's own permissions still do all four;
 *   - Create and Delete Invoices: no invoice is created or deleted, by
 *     their holder or a project owner; Read Invoices still reads them;
 *   - Add Label to Resources: its holder labels no monitor; Edit Monitor
 *     still does.
 *
 * And none of the 28 can be given again: a team, an API key and a custom
 * role are refused each, with the words the dashboard would use, by a
 * project owner and by the owner's key - while a row stored before the
 * migration took them is still deleted when asked.
 *
 * The routes run behind the real request middleware (a signed session or a
 * project API key, and the tenantid header), BaseAPI and DatabaseService
 * with its whole permission layer. Who may do what is worked out by
 * OneUptime's own AccessTokenService from the project's teams below, on
 * every request. Stubbed: the session and project lookups the middleware
 * makes, the plan, the audit log, realtime, Redis, a custom role's sync of
 * its copies, and the tables, held in memory. Where a write gets past the
 * permission layer, the service's own hook answers in its place (PAST), so
 * what is checked is the access control and nothing after it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "8b000000-0000-4000-8000-0000000000a1",
);

// People: the project's owner, and a member whose team's rows each test sets.
const OWNER: ObjectID = new ObjectID("8b000000-0000-4000-8000-0000000000b1");
const MEMBER: ObjectID = new ObjectID("8b000000-0000-4000-8000-0000000000b2");

const OWNERS_TEAM: string = "8b000000-0000-4000-8000-0000000000e1";
const MEMBERS_TEAM: string = "8b000000-0000-4000-8000-0000000000e2";

// The owner's API key, as Terraform calls with it.
const OWNER_KEY_ID: string = "8b000000-0000-4000-8000-0000000000c1";
const OWNER_KEY_SECRET: string = "8b000000-0000-4000-8000-0000000000f1";
// A key whose rows the grant tests try to change.
const CI_KEY_ID: string = "8b000000-0000-4000-8000-0000000000c2";
const CI_READ_INCIDENT: string = "8b000000-0000-4000-8000-0000000000c3";
const CI_EDIT_INCIDENT_FEED: string = "8b000000-0000-4000-8000-0000000000c4";

// A custom role, with a row it may hold and one stored before the migration.
const ROLE_ID: string = "8b000000-0000-4000-8000-000000000071";
const ROLE_READ_INCIDENT: string = "8b000000-0000-4000-8000-000000000072";
const ROLE_ADD_LABELS: string = "8b000000-0000-4000-8000-000000000073";

// A team row stored with one of the 28 before the migration took them.
const MEMBERS_LAYER_USER_ROW: string = "8b000000-0000-4000-8000-0000000000d9";

// The on-call schedule, its layer, and a person in it.
const SCHEDULE_ID: string = "8b000000-0000-4000-8000-000000000081";
const LAYER_ID: string = "8b000000-0000-4000-8000-000000000082";
const LAYER_USER_ID: string = "8b000000-0000-4000-8000-000000000083";
const PERSON: string = "8b000000-0000-4000-8000-000000000084";

const INVOICE_ID: string = "8b000000-0000-4000-8000-000000000091";
const MONITOR_ID: string = "8b000000-0000-4000-8000-000000000092";
const LABEL_ID: string = "8b000000-0000-4000-8000-000000000093";

// What a hook answers once a write got past every permission check.
const PAST: string = "Past the permission checks.";

const THE_28: Array<Permission> = [
  Permission.EditAlertEpisodeFeed,
  Permission.EditAlertFeed,
  Permission.EditCephClusterFeed,
  Permission.EditCloudResourceFeed,
  Permission.EditDatabaseServerFeed,
  Permission.EditDockerHostFeed,
  Permission.EditDockerSwarmClusterFeed,
  Permission.EditHostFeed,
  Permission.EditIncidentEpisodeFeed,
  Permission.EditIncidentFeed,
  Permission.EditKubernetesClusterFeed,
  Permission.EditMonitorFeed,
  Permission.EditOnCallDutyPolicyFeed,
  Permission.EditOpenStackCloudFeed,
  Permission.EditPodmanHostFeed,
  Permission.EditProxmoxClusterFeed,
  Permission.EditScheduledMaintenanceFeed,
  Permission.EditServiceFeed,
  Permission.EditServiceLevelObjectiveFeed,
  Permission.EditStorageArrayFeed,
  Permission.EditVMwareVCenterFeed,
  Permission.CreateOnCallDutyPolicyScheduleLayerUser,
  Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
  Permission.EditOnCallDutyPolicyScheduleLayerUser,
  Permission.ReadOnCallDutyPolicyScheduleLayerUser,
  Permission.CreateInvoices,
  Permission.DeleteInvoices,
  Permission.AddLabelsToProjectResources,
];

interface Feed {
  // The Edit ... Feed permission retired for it.
  edit: Permission;
  // The feed's own Read, which still reads it.
  read: Permission;
  service: DatabaseService<BaseModel>;
}

// Every feed the 21 were named for, with the service its route is served by.
const FEEDS: Array<Feed> = [
  [Permission.EditAlertEpisodeFeed, AlertEpisodeFeedService],
  [Permission.EditAlertFeed, AlertFeedService],
  [Permission.EditCephClusterFeed, CephClusterFeedService],
  [Permission.EditCloudResourceFeed, CloudResourceFeedService],
  [Permission.EditDatabaseServerFeed, DatabaseServerFeedService],
  [Permission.EditDockerHostFeed, DockerHostFeedService],
  [Permission.EditDockerSwarmClusterFeed, DockerSwarmClusterFeedService],
  [Permission.EditHostFeed, HostFeedService],
  [Permission.EditIncidentEpisodeFeed, IncidentEpisodeFeedService],
  [Permission.EditIncidentFeed, IncidentFeedService],
  [Permission.EditKubernetesClusterFeed, KubernetesClusterFeedService],
  [Permission.EditMonitorFeed, MonitorFeedService],
  [Permission.EditOnCallDutyPolicyFeed, OnCallDutyPolicyFeedService],
  [Permission.EditOpenStackCloudFeed, OpenStackCloudFeedService],
  [Permission.EditPodmanHostFeed, PodmanHostFeedService],
  [Permission.EditProxmoxClusterFeed, ProxmoxClusterFeedService],
  [Permission.EditScheduledMaintenanceFeed, ScheduledMaintenanceFeedService],
  [Permission.EditServiceFeed, ServiceFeedService],
  [Permission.EditServiceLevelObjectiveFeed, ServiceLevelObjectiveFeedService],
  [Permission.EditStorageArrayFeed, StorageArrayFeedService],
  [Permission.EditVMwareVCenterFeed, VMwareVCenterFeedService],
].map((entry: Array<unknown>): Feed => {
  const edit: Permission = entry[0] as Permission;

  return {
    edit,
    read: edit.replace(/^Edit/, "Read") as Permission,
    service: entry[1] as unknown as DatabaseService<BaseModel>,
  };
});

// A feed's entry, by the feed: one per feed table.
function feedEntryId(index: number): string {
  return `8b000000-0000-4000-8000-0000000002${index.toString().padStart(2, "0")}`;
}

function routeOf(service: DatabaseService<BaseModel>): string {
  return new service.modelType().getCrudApiPath()!.toString();
}

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
const AS_MEMBER: Caller = { label: "the member", session: MEMBER };
const AS_OWNER_KEY: Caller = {
  label: "the owner's API key, as Terraform calls",
  apiKey: OWNER_KEY_SECRET,
};

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
        "x-forwarded-for": "203.0.113.8",
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

// The words a table's access control refuses an operation with.
function refusalOf(
  modelType: { new (): BaseModel },
  operation: "create" | "read" | "update" | "delete",
): string {
  const model: BaseModel = new modelType();
  const lists: Record<string, Array<Permission>> = {
    create: model.createRecordPermissions,
    read: model.readRecordPermissions,
    update: model.updateRecordPermissions,
    delete: model.deleteRecordPermissions,
  };
  const titles: Array<string> = PermissionHelper.getPermissionTitles(
    lists[operation]!,
  );
  // As DatabaseRequestType names it, which the refusal opens with.
  const type: string = operation;

  return titles.length === 0
    ? `${type} on ${model.singularName} is not allowed.`
    : `You do not have permissions to ${type} ${model.singularName}. You need one of these permissions: ${titles.join(", ")}`;
}

let teams: InMemoryTable;
let teamPermissions: InMemoryTable;
let apiKeyPermissions: InMemoryTable;
let rolePermissions: InMemoryTable;
let layerUsers: InMemoryTable;
let invoices: InMemoryTable;
let monitors: InMemoryTable;
let feedTables: Array<InMemoryTable> = [];

// The hooks a write that got past the permission checks reaches.
let pastHooks: Array<ReturnType<typeof jest.spyOn>> = [];

function teamPermissionRow(data: {
  id: string;
  teamId: string;
  permission: string;
}): StoredRow {
  return {
    _id: data.id,
    teamId: data.teamId,
    projectId: PROJECT_ID.toString(),
    permission: data.permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    labels: [],
    team: { _id: data.teamId, isPermissionsEditable: true },
  };
}

let nextRow: number = 0;

/*
 * What the member's team holds, for the requests that follow: every row of
 * the Members team is replaced, so each test says exactly what it grants.
 */
function memberHolds(permissions: Array<Permission>): void {
  teamPermissions.rows.splice(
    0,
    teamPermissions.rows.length,
    ...teamPermissions.rows.filter((row: StoredRow): boolean => {
      return row["teamId"] !== MEMBERS_TEAM;
    }),
    ...permissions.map((permission: Permission): StoredRow => {
      nextRow++;

      return teamPermissionRow({
        id: `8b000000-0000-4000-8000-${(0x500000 + nextRow).toString(16).padStart(12, "0")}`,
        teamId: MEMBERS_TEAM,
        permission,
      });
    }),
  );
}

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
    [
      OnCallDutyPolicyScheduleLayerUser,
      OnCallDutyPolicyScheduleLayerUserService as unknown as DatabaseService<BaseModel>,
    ],
    [
      BillingInvoice,
      BillingInvoiceService as unknown as DatabaseService<BaseModel>,
    ],
    [Monitor, MonitorService as unknown as DatabaseService<BaseModel>],
    ...FEEDS.map(
      (feed: Feed): [{ new (): BaseModel }, DatabaseService<BaseModel>] => {
        return [feed.service.modelType, feed.service];
      },
    ),
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
    return secret.toString().toLowerCase() === OWNER_KEY_SECRET
      ? {
          id: new ObjectID(OWNER_KEY_ID),
          projectId: PROJECT_ID,
          name: "Terraform",
        }
      : null;
  }) as never);

  // Every permission set is built again from the teams below, on every request.
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

  // Invoices are read from the payment provider before they are listed.
  jest
    .spyOn(
      BillingInvoiceService as unknown as Record<string, () => unknown>,
      "onBeforeFind",
    )
    .mockImplementation((async (findBy: unknown): Promise<unknown> => {
      return { findBy, carryForward: null };
    }) as never);

  useInMemoryTable(ProjectService, [
    { _id: PROJECT_ID.toString(), name: "A project" },
  ]);
  useInMemoryTable(TeamMemberService, [
    {
      _id: "8b000000-0000-4000-8000-000000000011",
      userId: OWNER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: OWNERS_TEAM,
      hasAcceptedInvitation: true,
    },
    {
      _id: "8b000000-0000-4000-8000-000000000012",
      userId: MEMBER.toString(),
      projectId: PROJECT_ID.toString(),
      teamId: MEMBERS_TEAM,
      hasAcceptedInvitation: true,
    },
  ]);
  teams = useInMemoryTable(TeamService, [
    {
      _id: OWNERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Owners",
      isPermissionsEditable: false,
    },
    {
      _id: MEMBERS_TEAM,
      projectId: PROJECT_ID.toString(),
      name: "Members",
      isPermissionsEditable: true,
    },
  ]);
  teamPermissions = useInMemoryTable(TeamPermissionService, [
    teamPermissionRow({
      id: "8b000000-0000-4000-8000-0000000000d1",
      teamId: OWNERS_TEAM,
      permission: Permission.ProjectOwner,
    }),
  ]);
  useInMemoryTable(ApiKeyService, [
    { _id: OWNER_KEY_ID, projectId: PROJECT_ID.toString(), name: "Terraform" },
    { _id: CI_KEY_ID, projectId: PROJECT_ID.toString(), name: "CI" },
  ]);
  apiKeyPermissions = useInMemoryTable(ApiKeyPermissionService, [
    {
      _id: "8b000000-0000-4000-8000-0000000000c9",
      apiKeyId: OWNER_KEY_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.ProjectOwner,
      isBlockPermission: false,
      labels: [],
    },
    {
      _id: CI_READ_INCIDENT,
      apiKeyId: CI_KEY_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.ReadProjectIncident,
      isBlockPermission: false,
      labels: [],
    },
    // Stored before the migration took the 28.
    {
      _id: CI_EDIT_INCIDENT_FEED,
      apiKeyId: CI_KEY_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.EditIncidentFeed,
      isBlockPermission: false,
      labels: [],
    },
  ]);
  useInMemoryTable(CustomRoleService, [
    {
      _id: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Responders",
      permissionCount: 2,
    },
  ]);
  rolePermissions = useInMemoryTable(CustomRolePermissionService, [
    {
      _id: ROLE_READ_INCIDENT,
      customRoleId: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.ReadProjectIncident,
      scope: PermissionScope.All,
      labels: [],
    },
    {
      _id: ROLE_ADD_LABELS,
      customRoleId: ROLE_ID,
      projectId: PROJECT_ID.toString(),
      permission: Permission.AddLabelsToProjectResources,
      scope: PermissionScope.All,
      labels: [],
    },
  ]);

  useInMemoryTable(OnCallDutyPolicyScheduleService, [
    { _id: SCHEDULE_ID, projectId: PROJECT_ID.toString(), name: "Primary" },
  ]);
  useInMemoryTable(OnCallDutyPolicyScheduleLayerService, [
    {
      _id: LAYER_ID,
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      name: "Weekdays",
      order: 1,
    },
  ]);
  layerUsers = useInMemoryTable(OnCallDutyPolicyScheduleLayerUserService, [
    {
      _id: LAYER_USER_ID,
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      onCallDutyPolicyScheduleLayerId: LAYER_ID,
      userId: PERSON,
      order: 1,
    },
  ]);
  invoices = useInMemoryTable(BillingInvoiceService, [
    {
      _id: INVOICE_ID,
      projectId: PROJECT_ID.toString(),
      invoiceNumber: "INV-1",
      amount: 1200,
      currencyCode: "usd",
    },
  ]);
  monitors = useInMemoryTable(MonitorService, [
    {
      _id: MONITOR_ID,
      projectId: PROJECT_ID.toString(),
      name: "Checkout",
      labels: [],
    },
  ]);
  useInMemoryTable(LabelService, [
    { _id: LABEL_ID, projectId: PROJECT_ID.toString(), name: "Payments" },
  ]);

  feedTables = FEEDS.map((feed: Feed, index: number): InMemoryTable => {
    return useInMemoryTable(feed.service, [
      {
        _id: feedEntryId(index),
        projectId: PROJECT_ID.toString(),
        feedInfoInMarkdown: "Created.",
      },
    ]);
  });

  // A write that got past every permission check: its service's hook answers.
  pastHooks = [];

  for (const service of [
    OnCallDutyPolicyScheduleLayerUserService,
    BillingInvoiceService,
    MonitorService,
    ...FEEDS.map((feed: Feed) => {
      return feed.service;
    }),
  ] as Array<DatabaseService<BaseModel>>) {
    for (const hook of ["onBeforeCreate", "onBeforeUpdate", "onBeforeDelete"]) {
      pastHooks.push(
        jest
          .spyOn(service as unknown as Record<string, () => unknown>, hook)
          .mockRejectedValue(new BadDataException(PAST) as never),
      );
    }
  }

  memberHolds([]);
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

function nothingWritten(tables: Array<InMemoryTable>): void {
  for (const table of tables) {
    expect(table.inserts).toEqual([]);
    expect(table.updates).toEqual([]);
    expect(table.deletes).toEqual([]);
  }
}

function noHookReached(): void {
  expect(
    pastHooks.some((hook: ReturnType<typeof jest.spyOn>): boolean => {
      return hook.mock.calls.length > 0;
    }),
  ).toBe(false);
}

const each: <T>(items: Array<T>) => Array<[T]> = <T>(
  items: Array<T>,
): Array<[T]> => {
  return items.map((item: T): [T] => {
    return [item];
  });
};

describe("an Edit ... Feed permission edits no feed entry", () => {
  test.each(
    FEEDS.map((feed: Feed, index: number): [string, Feed, number] => {
      return [feed.edit, feed, index];
    }),
  )(
    "%s: its holder is refused a change to an entry, as the member without it is",
    async (_name: string, feed: Feed, index: number) => {
      const change: JSONObject = { data: { feedInfoInMarkdown: "Rewritten." } };
      const path: string = `${routeOf(feed.service)}/${feedEntryId(index)}`;

      // With the feed's Read and the retired Edit.
      memberHolds([feed.read, feed.edit]);
      const holder: HttpResult = await call({
        method: "PUT",
        path,
        as: AS_MEMBER,
        body: change,
      });

      // With the feed's Read only.
      memberHolds([feed.read]);
      const without: HttpResult = await call({
        method: "PUT",
        path,
        as: AS_MEMBER,
        body: change,
      });

      expect(holder.status).toBe(without.status);
      expect(errorOf(holder)).toBe(errorOf(without));
      expect(errorOf(holder)).toBe(refusalOf(feed.service.modelType, "update"));
      expect(errorOf(holder)).toMatch(/^update on .+ is not allowed\.$/);
      nothingWritten([feedTables[index]!]);
      noHookReached();
    },
  );

  test.each(
    FEEDS.map((feed: Feed, index: number): [string, Feed, number] => {
      return [feed.edit, feed, index];
    }),
  )(
    "%s: a Project Owner is refused the change too - a feed's entries are edited by nobody",
    async (_name: string, feed: Feed, index: number) => {
      const result: HttpResult = await call({
        method: "PUT",
        path: `${routeOf(feed.service)}/${feedEntryId(index)}`,
        as: AS_OWNER,
        body: { data: { feedInfoInMarkdown: "Rewritten." } },
      });

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(refusalOf(feed.service.modelType, "update"));
      expect(
        feedTables[index]!.get(feedEntryId(index))!["feedInfoInMarkdown"],
      ).toBe("Created.");
      noHookReached();
    },
  );
});

describe("the On-Call Schedule Layer User permissions reach no one in a layer; the layer's own still do", () => {
  const LAYER_USER_BODY: JSONObject = {
    data: {
      projectId: PROJECT_ID.toString(),
      onCallDutyPolicyScheduleId: SCHEDULE_ID,
      onCallDutyPolicyScheduleLayerId: LAYER_ID,
      userId: PERSON,
    },
  };

  test("adding someone: Create On-Call Schedule Layer User is refused, Create On-Call Schedule Layer gets past every check", async () => {
    memberHolds([
      Permission.CreateOnCallDutyPolicyScheduleLayerUser,
      Permission.ReadOnCallDutyPolicyScheduleLayerUser,
    ]);
    const holder: HttpResult = await call({
      method: "POST",
      path: "/on-call-duty-schedule-layer-user",
      as: AS_MEMBER,
      body: LAYER_USER_BODY,
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(
      refusalOf(OnCallDutyPolicyScheduleLayerUser, "create"),
    );
    expect(errorOf(holder)).toContain("Create On-Call Schedule Layer");
    expect(errorOf(holder)).not.toContain("Create On-Call Schedule Layer User");
    nothingWritten([layerUsers]);
    noHookReached();

    memberHolds([
      Permission.CreateOnCallDutyPolicyScheduleLayer,
      Permission.ReadOnCallDutyPolicyScheduleLayer,
    ]);
    const layerHolder: HttpResult = await call({
      method: "POST",
      path: "/on-call-duty-schedule-layer-user",
      as: AS_MEMBER,
      body: LAYER_USER_BODY,
    });

    expect(errorOf(layerHolder)).toBe(PAST);
  });

  test("reading who is in a layer: Read On-Call Schedule Layer User is refused, Read On-Call Schedule Layer reads them", async () => {
    memberHolds([Permission.ReadOnCallDutyPolicyScheduleLayerUser]);
    const holder: HttpResult = await call({
      method: "POST",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}/get-item`,
      as: AS_MEMBER,
      body: { select: { _id: true, userId: true } },
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(
      refusalOf(OnCallDutyPolicyScheduleLayerUser, "read"),
    );

    memberHolds([Permission.ReadOnCallDutyPolicyScheduleLayer]);
    const layerHolder: HttpResult = await call({
      method: "POST",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}/get-item`,
      as: AS_MEMBER,
      body: { select: { _id: true, userId: true } },
    });

    expect(layerHolder.status).toBe(200);
    expect(String(layerHolder.body["_id"]).toLowerCase()).toBe(LAYER_USER_ID);
  });

  test("moving someone: Edit On-Call Schedule Layer User is refused, Edit On-Call Schedule Layer gets past every check", async () => {
    memberHolds([
      Permission.EditOnCallDutyPolicyScheduleLayerUser,
      Permission.ReadOnCallDutyPolicyScheduleLayerUser,
    ]);
    const holder: HttpResult = await call({
      method: "PUT",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
      as: AS_MEMBER,
      body: { data: { order: 2 } },
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(
      refusalOf(OnCallDutyPolicyScheduleLayerUser, "update"),
    );
    expect(layerUsers.get(LAYER_USER_ID)!["order"]).toBe(1);
    nothingWritten([layerUsers]);
    noHookReached();

    memberHolds([
      Permission.EditOnCallDutyPolicyScheduleLayer,
      Permission.ReadOnCallDutyPolicyScheduleLayer,
    ]);
    const layerHolder: HttpResult = await call({
      method: "PUT",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
      as: AS_MEMBER,
      body: { data: { order: 2 } },
    });

    expect(errorOf(layerHolder)).toBe(PAST);
  });

  test("taking someone out: Delete On-Call Schedule Layer User is refused, Delete On-Call Schedule Layer gets past every check", async () => {
    memberHolds([
      Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
      Permission.ReadOnCallDutyPolicyScheduleLayerUser,
    ]);
    const holder: HttpResult = await call({
      method: "DELETE",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
      as: AS_MEMBER,
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(
      refusalOf(OnCallDutyPolicyScheduleLayerUser, "delete"),
    );
    expect(layerUsers.get(LAYER_USER_ID)).toBeDefined();
    nothingWritten([layerUsers]);
    noHookReached();

    memberHolds([
      Permission.DeleteOnCallDutyPolicyScheduleLayer,
      Permission.ReadOnCallDutyPolicyScheduleLayer,
    ]);
    const layerHolder: HttpResult = await call({
      method: "DELETE",
      path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
      as: AS_MEMBER,
    });

    expect(errorOf(layerHolder)).toBe(PAST);
  });

  test("all four layer user permissions together add, read, move and take out no one", async () => {
    memberHolds([
      Permission.CreateOnCallDutyPolicyScheduleLayerUser,
      Permission.ReadOnCallDutyPolicyScheduleLayerUser,
      Permission.EditOnCallDutyPolicyScheduleLayerUser,
      Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
    ]);

    const results: Array<HttpResult> = [
      await call({
        method: "POST",
        path: "/on-call-duty-schedule-layer-user",
        as: AS_MEMBER,
        body: LAYER_USER_BODY,
      }),
      await call({
        method: "POST",
        path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}/get-item`,
        as: AS_MEMBER,
        body: { select: { _id: true } },
      }),
      await call({
        method: "PUT",
        path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
        as: AS_MEMBER,
        body: { data: { order: 2 } },
      }),
      await call({
        method: "DELETE",
        path: `/on-call-duty-schedule-layer-user/${LAYER_USER_ID}`,
        as: AS_MEMBER,
      }),
    ];

    expect(
      results.map((result: HttpResult): number => {
        return result.status;
      }),
    ).toEqual([422, 422, 422, 422]);
    nothingWritten([layerUsers]);
    noHookReached();
  });
});

describe("Create Invoices and Delete Invoices create and delete no invoice; Read Invoices still reads them", () => {
  const INVOICE_BODY: JSONObject = {
    data: {
      projectId: PROJECT_ID.toString(),
      invoiceNumber: "INV-2",
      amount: 900,
      currencyCode: "usd",
    },
  };

  test.each([
    [
      "the member with Create Invoices",
      AS_MEMBER,
      [Permission.CreateInvoices, Permission.ReadInvoices],
    ],
    ["the member without it", AS_MEMBER, [Permission.ReadInvoices]],
    ["a Project Owner", AS_OWNER, []],
  ] as Array<[string, Caller, Array<Permission>]>)(
    "%s: refused an invoice of its own",
    async (_label: string, caller: Caller, holds: Array<Permission>) => {
      memberHolds(holds);

      const result: HttpResult = await call({
        method: "POST",
        path: "/billing-invoices",
        as: caller,
        body: INVOICE_BODY,
      });

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe(refusalOf(BillingInvoice, "create"));
      expect(errorOf(result)).toBe("create on Invoice is not allowed.");
      nothingWritten([invoices]);
      noHookReached();
    },
  );

  test.each([
    [
      "the member with Delete Invoices",
      AS_MEMBER,
      [Permission.DeleteInvoices, Permission.ReadInvoices],
    ],
    ["the member without it", AS_MEMBER, [Permission.ReadInvoices]],
    ["a Project Owner", AS_OWNER, []],
  ] as Array<[string, Caller, Array<Permission>]>)(
    "%s: refused the deletion of one",
    async (_label: string, caller: Caller, holds: Array<Permission>) => {
      memberHolds(holds);

      const result: HttpResult = await call({
        method: "DELETE",
        path: `/billing-invoices/${INVOICE_ID}`,
        as: caller,
      });

      expect(result.status).toBe(422);
      expect(errorOf(result)).toBe("delete on Invoice is not allowed.");
      expect(invoices.get(INVOICE_ID)).toBeDefined();
      nothingWritten([invoices]);
      noHookReached();
    },
  );

  test("Read Invoices reads them; Create and Delete Invoices without it read none", async () => {
    memberHolds([Permission.ReadInvoices]);
    const reader: HttpResult = await call({
      method: "POST",
      path: "/billing-invoices/get-list",
      as: AS_MEMBER,
      body: { query: {}, select: { _id: true, invoiceNumber: true } },
    });

    expect(reader.status).toBe(200);
    expect(
      (reader.body["data"] as Array<JSONObject>).map(
        (invoice: JSONObject): string => {
          return String(invoice["_id"]).toLowerCase();
        },
      ),
    ).toEqual([INVOICE_ID]);

    memberHolds([Permission.CreateInvoices, Permission.DeleteInvoices]);
    const holder: HttpResult = await call({
      method: "POST",
      path: "/billing-invoices/get-list",
      as: AS_MEMBER,
      body: { query: {}, select: { _id: true } },
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(refusalOf(BillingInvoice, "read"));
  });
});

describe("Add Label to Resources labels no monitor; Edit Monitor still does", () => {
  const LABELLING: JSONObject = { data: { labels: [{ _id: LABEL_ID }] } };

  test("its holder, who may read the monitor, is refused, as the member without it is", async () => {
    memberHolds([
      Permission.AddLabelsToProjectResources,
      Permission.ReadProjectMonitor,
    ]);
    const holder: HttpResult = await call({
      method: "PUT",
      path: `/monitor/${MONITOR_ID}`,
      as: AS_MEMBER,
      body: LABELLING,
    });

    memberHolds([Permission.ReadProjectMonitor]);
    const without: HttpResult = await call({
      method: "PUT",
      path: `/monitor/${MONITOR_ID}`,
      as: AS_MEMBER,
      body: LABELLING,
    });

    expect(holder.status).toBe(422);
    expect(errorOf(holder)).toBe(refusalOf(Monitor, "update"));
    expect([without.status, errorOf(without)]).toEqual([
      holder.status,
      errorOf(holder),
    ]);
    expect(monitors.get(MONITOR_ID)!["labels"]).toEqual([]);
    nothingWritten([monitors]);
    noHookReached();
  });

  test("Edit Monitor gets past every check", async () => {
    memberHolds([Permission.EditProjectMonitor, Permission.ReadProjectMonitor]);

    const result: HttpResult = await call({
      method: "PUT",
      path: `/monitor/${MONITOR_ID}`,
      as: AS_MEMBER,
      body: LABELLING,
    });

    expect(errorOf(result)).toBe(PAST);
  });
});

/*
 * None of the 28 can be given again: the API refuses each to a team, an
 * API key and a custom role, as the pickers no longer offer it (#8281's
 * check, which reads isAssignableToTenant).
 */
describe("none of the 28 can be given again", () => {
  const CALLERS: Array<[string, Caller]> = [
    [AS_OWNER.label, AS_OWNER],
    [AS_OWNER_KEY.label, AS_OWNER_KEY],
  ];

  describe.each(CALLERS)("as %s", (_label: string, caller: Caller) => {
    test.each(each(THE_28))(
      "%s is refused to a team, to an API key and in a custom role, and no row is written",
      async (permission: Permission) => {
        const team: HttpResult = await call({
          method: "POST",
          path: "/team-permission",
          as: caller,
          body: {
            data: {
              teamId: MEMBERS_TEAM,
              projectId: PROJECT_ID.toString(),
              permission,
              isBlockPermission: false,
              scope: PermissionScope.All,
            },
          },
        });
        const key: HttpResult = await call({
          method: "POST",
          path: "/api-key-permission",
          as: caller,
          body: {
            data: {
              apiKeyId: CI_KEY_ID,
              projectId: PROJECT_ID.toString(),
              permission,
              isBlockPermission: false,
            },
          },
        });
        const role: HttpResult = await call({
          method: "POST",
          path: "/custom-role-permission",
          as: caller,
          body: {
            data: {
              customRoleId: ROLE_ID,
              projectId: PROJECT_ID.toString(),
              permission,
              scope: PermissionScope.All,
            },
          },
        });

        expect([team.status, key.status, role.status]).toEqual([400, 400, 400]);
        expect(errorOf(team)).toBe(
          getTenantPermissionProblem({
            permission,
            holder: PermissionHolder.Team,
          }),
        );
        expect(errorOf(key)).toBe(
          getTenantPermissionProblem({
            permission,
            holder: PermissionHolder.ApiKey,
          }),
        );
        expect(errorOf(role)).toBe(
          `${PermissionHelper.getTitle(permission)} can't be given to a team, so it can't be part of a custom role.`,
        );
        nothingWritten([teamPermissions, apiKeyPermissions, rolePermissions]);
      },
    );
  });

  test("as a block too", async () => {
    const result: HttpResult = await call({
      method: "POST",
      path: "/team-permission",
      as: AS_OWNER,
      body: {
        data: {
          teamId: MEMBERS_TEAM,
          projectId: PROJECT_ID.toString(),
          permission: Permission.EditIncidentFeed,
          isBlockPermission: true,
          scope: PermissionScope.All,
        },
      },
    });

    expect(result.status).toBe(400);
    expect(errorOf(result)).toBe(
      "Edit Incident Feed can't be given to a team. Pick one of the permissions Add Permission lists on the team's page.",
    );
    nothingWritten([teamPermissions]);
  });

  test("what does what they were offered for is still given", async () => {
    for (const permission of [
      Permission.CreateOnCallDutyPolicyScheduleLayer,
      Permission.ReadIncidentFeed,
      Permission.ReadInvoices,
      Permission.EditProjectMonitor,
    ]) {
      const result: HttpResult = await call({
        method: "POST",
        path: "/team-permission",
        as: AS_OWNER,
        body: {
          data: {
            teamId: MEMBERS_TEAM,
            projectId: PROJECT_ID.toString(),
            permission,
            isBlockPermission: false,
            scope: PermissionScope.All,
          },
        },
      });

      expect({ permission, status: result.status }).toEqual({
        permission,
        status: 200,
      });
    }

    expect(
      teamPermissions.inserts.map((row: StoredRow): unknown => {
        return row["permission"];
      }),
    ).toEqual([
      Permission.CreateOnCallDutyPolicyScheduleLayer,
      Permission.ReadIncidentFeed,
      Permission.ReadInvoices,
      Permission.EditProjectMonitor,
    ]);
  });
});

/*
 * A row stored before the migration took them - or before it ran, while
 * the release rolls out - is not kept as it is, and is still deleted.
 */
describe("a row of one stored before the migration", () => {
  beforeEach(() => {
    teamPermissions.rows.push(
      teamPermissionRow({
        id: MEMBERS_LAYER_USER_ROW,
        teamId: MEMBERS_TEAM,
        permission: Permission.CreateOnCallDutyPolicyScheduleLayerUser,
      }),
    );
  });

  test("is not kept on a change of something else: a team's, a key's and a role's", async () => {
    const team: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${MEMBERS_LAYER_USER_ROW}`,
      as: AS_OWNER,
      body: { data: { scope: PermissionScope.All } },
    });
    const key: HttpResult = await call({
      method: "PUT",
      path: `/api-key-permission/${CI_EDIT_INCIDENT_FEED}`,
      as: AS_OWNER,
      body: { data: { isBlockPermission: true } },
    });
    const role: HttpResult = await call({
      method: "PUT",
      path: `/custom-role-permission/${ROLE_ADD_LABELS}`,
      as: AS_OWNER,
      body: { data: { scope: PermissionScope.All } },
    });

    expect([team.status, key.status, role.status]).toEqual([400, 400, 400]);
    expect(errorOf(team)).toBe(
      getTenantPermissionProblem({
        permission: Permission.CreateOnCallDutyPolicyScheduleLayerUser,
        holder: PermissionHolder.Team,
      }),
    );
    expect(errorOf(key)).toBe(
      getTenantPermissionProblem({
        permission: Permission.EditIncidentFeed,
        holder: PermissionHolder.ApiKey,
      }),
    );
    expect(errorOf(role)).toBe(
      "Add Label to Resources can't be given to a team, so it can't be part of a custom role.",
    );
  });

  test("may be made the permission that does what it was offered for", async () => {
    const result: HttpResult = await call({
      method: "PUT",
      path: `/team-permission/${MEMBERS_LAYER_USER_ROW}`,
      as: AS_OWNER,
      body: {
        data: { permission: Permission.CreateOnCallDutyPolicyScheduleLayer },
      },
    });

    expect(result.status).toBe(200);
    expect(teamPermissions.get(MEMBERS_LAYER_USER_ROW)!["permission"]).toBe(
      Permission.CreateOnCallDutyPolicyScheduleLayer,
    );
  });

  test("is deleted, from a team, a key and a role, and nothing else is", async () => {
    const team: HttpResult = await call({
      method: "DELETE",
      path: `/team-permission/${MEMBERS_LAYER_USER_ROW}`,
      as: AS_OWNER,
    });
    const key: HttpResult = await call({
      method: "DELETE",
      path: `/api-key-permission/${CI_EDIT_INCIDENT_FEED}`,
      as: AS_OWNER_KEY,
    });
    const role: HttpResult = await call({
      method: "DELETE",
      path: `/custom-role-permission/${ROLE_ADD_LABELS}`,
      as: AS_OWNER,
    });

    expect([team.status, key.status, role.status]).toEqual([200, 200, 200]);
    expect(teamPermissions.get(MEMBERS_LAYER_USER_ROW)).toBeUndefined();
    expect(apiKeyPermissions.get(CI_EDIT_INCIDENT_FEED)).toBeUndefined();
    expect(rolePermissions.get(ROLE_ADD_LABELS)).toBeUndefined();
    expect(apiKeyPermissions.get(CI_READ_INCIDENT)).toBeDefined();
    expect(rolePermissions.get(ROLE_READ_INCIDENT)).toBeDefined();
  });

  test("while it is there, it lets its holder add no one to a layer", async () => {
    // The member's team: Read On-Call Schedule Layer, and the stored row.
    teamPermissions.rows.push(
      teamPermissionRow({
        id: "8b000000-0000-4000-8000-0000000000da",
        teamId: MEMBERS_TEAM,
        permission: Permission.ReadOnCallDutyPolicyScheduleLayer,
      }),
    );

    const result: HttpResult = await call({
      method: "POST",
      path: "/on-call-duty-schedule-layer-user",
      as: AS_MEMBER,
      body: {
        data: {
          projectId: PROJECT_ID.toString(),
          onCallDutyPolicyScheduleId: SCHEDULE_ID,
          onCallDutyPolicyScheduleLayerId: LAYER_ID,
          userId: PERSON,
        },
      },
    });

    expect(result.status).toBe(422);
    expect(errorOf(result)).toBe(
      refusalOf(OnCallDutyPolicyScheduleLayerUser, "create"),
    );
    nothingWritten([layerUsers]);
  });

  test("the teams table is untouched by any of it", () => {
    expect(teams.inserts).toEqual([]);
    expect(teams.updates).toEqual([]);
  });
});
