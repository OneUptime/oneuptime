jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("isolated-vm", () => {
  return {};
});

import ApiKeyAPI from "../../../Server/API/ApiKeyAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import BillingPaymentMethodAPI from "../../../Server/API/BillingPaymentMethodAPI";
import CloudConnectionAPI from "../../../Server/API/CloudConnectionAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import DataObservabilityAPI from "../../../Server/API/DataObservabilityAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import PacketCaptureAPI from "../../../Server/API/PacketCaptureAPI";
import ProjectAPI from "../../../Server/API/ProjectAPI";
import ProjectSsoAPI from "../../../Server/API/ProjectSSO";
import TeamMemberAPI from "../../../Server/API/TeamMemberAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import BillingPaymentMethodService from "../../../Server/Services/BillingPaymentMethodService";
import CloudConnectionService from "../../../Server/Services/CloudConnectionService";
import CustomRoleService from "../../../Server/Services/CustomRoleService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DataStoreService from "../../../Server/Services/DataStoreService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import PacketCaptureService from "../../../Server/Services/PacketCaptureService";
import ProbeService from "../../../Server/Services/ProbeService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import RunnerService from "../../../Server/Services/RunnerService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import WorkflowService from "../../../Server/Services/WorkflowService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { DATA_OBSERVABILITY_API_ROUTES } from "../../../Types/DataObservability/DataObservabilityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "../../../Types/PacketCapture/PacketCapturePermissions";
import Permission, { UserPermission } from "../../../Types/Permission";
import { PRODUCT_LEVEL_PERMISSION_VALUES } from "../../../Types/Product/ProductLevels";
import UserType from "../../../Types/UserType";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
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

/*
 * A PRODUCT'S ADMIN MANAGES THEIR PRODUCT AND NOTHING ELSE, THROUGH THE
 * ROUTES THE APP SERVES (#10289).
 *
 * Every request here goes over HTTP through the routes the App mounts - the
 * CRUD API (BaseAPI) and the custom API classes it uses for these records
 * (TeamMemberAPI, ApiKeyAPI, ProjectAPI, ProjectSsoAPI,
 * BillingPaymentMethodAPI, CloudConnectionAPI, MonitorAPI, PacketCaptureAPI,
 * DataObservabilityAPI) - the permission layer and the error handler, into
 * tables held in memory:
 *
 *   - someone who holds every product's every level at once reaches none of
 *     the project's own records: its teams, their members and permissions,
 *     custom roles, API keys and their permissions, the project itself, its
 *     SSO, billing, labels, probes, ingestion keys, nor another product's
 *     records (monitors, workflows), nor what a product with levels keeps
 *     from them on a table it shares (a data store, a Runner's key) or from
 *     everyone (a cloud connection's credentials);
 *   - someone who may change what teams can do, and holds Cloud Admin,
 *     hands on Cloud Admin and nothing they do not hold: not another
 *     product's level, not Project Admin, not Cloud Admin for more records
 *     than they hold it for;
 *   - a product's own routes take its levels where they take the role:
 *     Data Observability's Admin connects a warehouse, Network's Admin stops
 *     and downloads a capture, Cloud's Admin tests a connection - and the
 *     levels below them are refused, as the roles they follow are.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10289000-0000-4000-8000-000000000002",
);
const TEAM_ID: string = "10289000-0000-4000-8000-0000000000b1";
const ROW_ID: string = "10289000-0000-4000-8000-0000000000b2";
const LABEL_ID: ObjectID = new ObjectID("10289000-0000-4000-8000-0000000000b3");

// The status the permission layer refuses with (NotAuthorizedException).
const REFUSED: number = 422;

const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

// A caller holding exactly these rows: some may be limited to labels.
function callerWithRows(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  };
}

function row(
  permission: Permission,
  labelIds: Array<ObjectID> = [],
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: labelIds,
    isBlockPermission: false,
    scope: labelIds.length > 0 ? PermissionScope.Labels : PermissionScope.All,
  };
}

/*
 * Every product's every level, at once: the most a product level can hold -
 * with Project User, which every member of a project holds
 * (AccessTokenService).
 */
const EVERY_LEVEL: Array<Permission> = [
  ...PRODUCT_LEVEL_PERMISSION_VALUES,
  Permission.ProjectUser,
];

function saidIn(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function oneRow(extra: StoredRow = {}): Array<StoredRow> {
  return [
    {
      _id: ROW_ID,
      projectId: PROJECT_ID.toString(),
      name: "the row",
      ...extra,
    },
  ];
}

beforeAll(async () => {
  // The session guards, as a signed-in member passes them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);

  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      TeamPermissionService.modelType as { new (): BaseModel },
      asService(TeamPermissionService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      TeamService.modelType as { new (): BaseModel },
      asService(TeamService),
    ).getRouter(),
    new TeamMemberAPI().getRouter(),
    new ApiKeyAPI().getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      ApiKeyPermissionService.modelType as { new (): BaseModel },
      asService(ApiKeyPermissionService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      CustomRoleService.modelType as { new (): BaseModel },
      asService(CustomRoleService),
    ).getRouter(),
    new ProjectAPI().getRouter(),
    new ProjectSsoAPI().getRouter(),
    new BillingPaymentMethodAPI().getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      LabelService.modelType as { new (): BaseModel },
      asService(LabelService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      ProbeService.modelType as { new (): BaseModel },
      asService(ProbeService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      TelemetryIngestionKeyService.modelType as { new (): BaseModel },
      asService(TelemetryIngestionKeyService),
    ).getRouter(),
    new MonitorAPI().getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      WorkflowService.modelType as { new (): BaseModel },
      asService(WorkflowService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      DataStoreService.modelType as { new (): BaseModel },
      asService(DataStoreService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      RunnerService.modelType as { new (): BaseModel },
      asService(RunnerService),
    ).getRouter(),
    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
      NetworkDeviceService.modelType as { new (): BaseModel },
      asService(NetworkDeviceService),
    ).getRouter(),
    new CloudConnectionAPI().getRouter(),
    new PacketCaptureAPI().getRouter(),
    new DataObservabilityAPI().getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
  jest.restoreAllMocks();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  stubProjectDirectory({});
  everyServerProductIsOn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });
});

afterEach(() => {
  jest.restoreAllMocks();

  // The session guards stay as the routers were built with them.
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
});

interface Attempt {
  name: string;
  service: DatabaseService<BaseModel>;
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: JSONObject | undefined;
}

const list: (path: string, select?: JSONObject) => JSONObject = (
  _path: string,
  select?: JSONObject,
): JSONObject => {
  return { query: {}, select: select || { _id: true }, limit: 10, skip: 0 };
};

const ATTEMPTS: Array<Attempt> = [
  {
    name: "give their team Project Admin",
    service: asService(TeamPermissionService),
    method: "POST",
    path: "/api/team-permission",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        teamId: TEAM_ID,
        permission: Permission.ProjectAdmin,
        isBlockPermission: false,
      },
    },
  },
  {
    name: "give their team another product's Admin",
    service: asService(TeamPermissionService),
    method: "POST",
    path: "/api/team-permission",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        teamId: TEAM_ID,
        permission: Permission.MonitorAdmin,
        isBlockPermission: false,
      },
    },
  },
  {
    name: "read the project's team permissions... and change one",
    service: asService(TeamPermissionService),
    method: "PUT",
    path: `/api/team-permission/${ROW_ID}`,
    body: { data: { permission: Permission.ProjectOwner } },
  },
  {
    name: "rename a team",
    service: asService(TeamService),
    method: "PUT",
    path: `/api/team/${ROW_ID}`,
    body: { data: { name: "Owners now" } },
  },
  {
    name: "create a team",
    service: asService(TeamService),
    method: "POST",
    path: "/api/team",
    body: { data: { projectId: PROJECT_ID.toString(), name: "Theirs" } },
  },
  {
    name: "invite a member to a team",
    service: asService(TeamMemberService),
    method: "POST",
    path: "/api/team-member",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        teamId: TEAM_ID,
        userId: ObjectID.generate().toString(),
      },
    },
  },
  {
    name: "read the project's API keys",
    service: asService(ApiKeyService),
    method: "POST",
    path: "/api/api-key/get-list",
    body: list("/api/api-key"),
  },
  {
    name: "create an API key",
    service: asService(ApiKeyService),
    method: "POST",
    path: "/api/api-key",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        name: "a key",
        expiresAt: "2030-01-01T00:00:00.000Z",
      },
    },
  },
  {
    name: "give an API key a permission",
    service: asService(ApiKeyPermissionService),
    method: "POST",
    path: "/api/api-key-permission",
    body: {
      data: {
        projectId: PROJECT_ID.toString(),
        apiKeyId: ROW_ID,
        permission: Permission.CloudAdmin,
        isBlockPermission: false,
      },
    },
  },
  /*
   * A custom role's create is refused by the edition first, on a server
   * without the Enterprise Edition, as this one is: its read and its
   * change are refused by the permission layer.
   */
  {
    name: "read the project's custom roles",
    service: asService(CustomRoleService),
    method: "POST",
    path: "/api/custom-role/get-list",
    body: list("/api/custom-role"),
  },
  {
    name: "change a custom role",
    service: asService(CustomRoleService),
    method: "PUT",
    path: `/api/custom-role/${ROW_ID}`,
    body: { data: { name: "Cloud Root" } },
  },
  {
    name: "change the project",
    service: asService(ProjectService),
    method: "PUT",
    path: `/api/project/${PROJECT_ID.toString()}`,
    body: { data: { name: "Theirs now" } },
  },
  /*
   * Every member sees which SSO providers there are, to sign in with one;
   * how one is set up is kept from them.
   */
  {
    name: "read how the project's SSO is set up",
    service: asService(ProjectSsoService),
    method: "POST",
    path: "/api/project-sso/get-list",
    body: list("/api/project-sso", {
      _id: true,
      issuerURL: true,
      publicCertificate: true,
    }),
  },
  {
    name: "set up SSO",
    service: asService(ProjectSsoService),
    method: "POST",
    path: "/api/project-sso",
    body: { data: { projectId: PROJECT_ID.toString(), name: "Their IdP" } },
  },
  /*
   * A read of the payment methods asks the payment provider first; a write
   * is weighed before anything is read.
   */
  {
    name: "remove the project's payment method",
    service: asService(BillingPaymentMethodService),
    method: "DELETE",
    path: `/api/billing-payment-methods/${ROW_ID}`,
  },
  {
    name: "create a label",
    service: asService(LabelService),
    method: "POST",
    path: "/api/label",
    body: { data: { projectId: PROJECT_ID.toString(), name: "Payments" } },
  },
  {
    name: "add a probe",
    service: asService(ProbeService),
    method: "POST",
    path: "/api/probe",
    body: { data: { projectId: PROJECT_ID.toString(), name: "Theirs" } },
  },
  {
    name: "read the project's telemetry ingestion keys",
    service: asService(TelemetryIngestionKeyService),
    method: "POST",
    path: "/api/telemetry-ingestion-key/get-list",
    body: list("/api/telemetry-ingestion-key"),
  },
  {
    name: "read a product without levels: monitors",
    service: asService(MonitorService),
    method: "POST",
    path: "/api/monitor/get-list",
    body: list("/api/monitor"),
  },
  {
    name: "create a workflow",
    service: asService(WorkflowService),
    method: "POST",
    path: "/api/workflow",
    body: { data: { projectId: PROJECT_ID.toString(), name: "Theirs" } },
  },
  {
    name: "read a data store, which Data Observability shares with Data Security",
    service: asService(DataStoreService),
    method: "POST",
    path: "/api/data-store/get-list",
    body: list("/api/data-store"),
  },
  {
    name: "read a Runner's key, which claims its runbooks' jobs",
    service: asService(RunnerService),
    method: "POST",
    path: "/api/runner/get-list",
    body: list("/api/runner", { _id: true, key: true }),
  },
  {
    name: "change a Runner, which Code reads and Runbooks runs on",
    service: asService(RunnerService),
    method: "PUT",
    path: `/api/runner/${ROW_ID}`,
    body: { data: { name: "renamed" } },
  },
  {
    name: "read a cloud connection's credentials back",
    service: asService(CloudConnectionService),
    method: "POST",
    path: "/api/cloud-connection/get-list",
    body: list("/api/cloud-connection", { _id: true, secrets: true }),
  },
];

describe("every product's every level at once reaches none of the project's own records", () => {
  test("the suite holds every level", () => {
    expect(PRODUCT_LEVEL_PERMISSION_VALUES.length).toBe(75);
    expect(EVERY_LEVEL).toEqual(
      expect.arrayContaining([...PRODUCT_LEVEL_PERMISSION_VALUES]),
    );
  });

  test.each(
    ATTEMPTS.map((attempt: Attempt): [string, Attempt] => {
      return [attempt.name, attempt];
    }),
  )("they cannot %s", async (_name: string, attempt: Attempt) => {
    caller = callerWith(EVERY_LEVEL);

    useInMemoryTable(attempt.service, oneRow());
    useInMemoryTable(asService(TeamService), [
      {
        _id: TEAM_ID,
        projectId: PROJECT_ID.toString(),
        name: "Cloud",
        isPermissionsEditable: true,
      },
    ]);

    const sent: SentRequest = await server.request(
      attempt.method,
      attempt.path,
      attempt.body,
    );

    expect({
      attempt: attempt.name,
      status: sent.status,
      said: saidIn(sent),
    }).toEqual({
      attempt: attempt.name,
      status: REFUSED,
      said: expect.stringMatching(/permission/i),
    });
  });

  test("and what they do read of them is what every member reads: the project's labels", async () => {
    caller = callerWith(EVERY_LEVEL);
    useInMemoryTable(asService(LabelService), oneRow());

    const sent: SentRequest = await server.request(
      "POST",
      "/api/label/get-list",
      list("/api/label", { _id: true, name: true }),
    );

    expect(sent.status).toBe(200);
  });

  test("Code reads the Runners without their keys, and Cloud the connections without their credentials", async () => {
    caller = callerWith([Permission.CodeAdmin, Permission.CloudAdmin]);

    useInMemoryTable(asService(RunnerService), oneRow());
    expect(
      (
        await server.request(
          "POST",
          "/api/runner/get-list",
          list("/api/runner", { _id: true, name: true }),
        )
      ).status,
    ).toBe(200);

    useInMemoryTable(asService(CloudConnectionService), oneRow());
    expect(
      (
        await server.request(
          "POST",
          "/api/cloud-connection/get-list",
          list("/api/cloud-connection", { _id: true, name: true }),
        )
      ).status,
    ).toBe(200);
  });
});

describe("a product's admin who may change what teams can do hands on only what they hold", () => {
  let permissions: InMemoryTable;

  function giveTeam(
    permission: Permission,
    labelIds: Array<ObjectID> = [],
  ): Promise<SentRequest> {
    permissions = useInMemoryTable(asService(TeamPermissionService), []);
    useInMemoryTable(asService(TeamService), [
      {
        _id: TEAM_ID,
        projectId: PROJECT_ID.toString(),
        name: "Cloud",
        isPermissionsEditable: true,
      },
    ]);
    useInMemoryTable(asService(TeamMemberService), []);
    useInMemoryTable(asService(LabelService), [
      { _id: LABEL_ID.toString(), projectId: PROJECT_ID.toString() },
    ]);

    return server.request("POST", "/api/team-permission", {
      data: {
        projectId: PROJECT_ID.toString(),
        teamId: TEAM_ID,
        permission: permission,
        isBlockPermission: false,
        scope:
          labelIds.length > 0 ? PermissionScope.Labels : PermissionScope.All,
        ...(labelIds.length > 0
          ? {
              labels: labelIds.map((labelId: ObjectID): JSONObject => {
                return { _id: labelId.toString() };
              }),
            }
          : {}),
      },
    });
  }

  beforeEach(() => {
    caller = callerWith([
      Permission.CloudAdmin,
      Permission.EditProjectTeamPermissions,
    ]);
  });

  test("Cloud Admin, which they hold, is given", async () => {
    const sent: SentRequest = await giveTeam(Permission.CloudAdmin);

    expect({ status: sent.status, said: saidIn(sent) }).toEqual({
      status: 200,
      said: "",
    });
    expect(permissions.inserts).toHaveLength(1);
    expect(permissions.inserts[0]!["permission"]).toBe(Permission.CloudAdmin);
  });

  test.each([
    ["another product's Admin", Permission.NetworkAdmin],
    ["another product's Viewer", Permission.NetworkViewer],
    ["a level of Cloud they do not hold", Permission.CloudViewer],
    ["Project Admin", Permission.ProjectAdmin],
    ["Project Owner", Permission.ProjectOwner],
    [
      "the Settings roles, which reach every infrastructure product",
      Permission.SettingsAdmin,
    ],
  ])(
    "%s is refused, and nothing is written",
    async (_name: string, permission: Permission) => {
      const sent: SentRequest = await giveTeam(permission);

      expect({ permission, status: sent.status }).toEqual({
        permission,
        status: REFUSED,
      });
      expect(saidIn(sent)).toContain("cannot grant");
      expect(permissions.inserts).toHaveLength(0);
    },
  );

  // The ceiling is what they hold: what they hold, they may hand on.
  test("Edit Team Permissions, which they hold, is theirs to hand on as well", async () => {
    const sent: SentRequest = await giveTeam(
      Permission.EditProjectTeamPermissions,
    );

    expect({ status: sent.status, said: saidIn(sent) }).toEqual({
      status: 200,
      said: "",
    });
  });

  test("Cloud Admin for more records than they hold it for is refused", async () => {
    caller = callerWithRows([
      row(Permission.CloudAdmin, [LABEL_ID]),
      row(Permission.EditProjectTeamPermissions),
    ]);

    const wider: SentRequest = await giveTeam(Permission.CloudAdmin);

    expect(wider.status).toBe(REFUSED);
    expect(saidIn(wider)).toContain("cannot grant");
    expect(permissions.inserts).toHaveLength(0);

    // The same labels they hold it for are theirs to hand on.
    const same: SentRequest = await giveTeam(Permission.CloudAdmin, [LABEL_ID]);

    expect({ status: same.status, said: saidIn(same) }).toEqual({
      status: 200,
      said: "",
    });
  });

  test("a Cloud Admin who may not change what teams can do gives nothing at all", async () => {
    caller = callerWith([Permission.CloudAdmin]);

    const sent: SentRequest = await giveTeam(Permission.CloudAdmin);

    expect(sent.status).toBe(REFUSED);
    expect(permissions.inserts).toHaveLength(0);
  });
});

describe("a product's own routes take its levels where they take the role", () => {
  test("Data Observability's Admin connects a warehouse; its Member and Viewer, and Cloud's Admin, may not", async () => {
    const refusal: string =
      "You do not have permission to do this in Data Observability.";

    for (const [permission, isLetThrough] of [
      [Permission.DataObservabilityAdmin, true],
      [Permission.ProjectAdmin, true],
      [Permission.DataObservabilityMember, false],
      [Permission.DataObservabilityViewer, false],
      [Permission.ProjectMember, false],
      [Permission.CloudAdmin, false],
    ] as Array<[Permission, boolean]>) {
      caller = callerWith([permission]);

      // An empty body: let through, the connect itself says what is missing.
      const sent: SentRequest = await server.request(
        "POST",
        `/api${DATA_OBSERVABILITY_API_ROUTES.connectStore}`,
        {},
      );

      expect({
        permission,
        refused: saidIn(sent) === refusal,
      }).toEqual({ permission, refused: !isLetThrough });
    }
  });

  test("Network's Admin stops and downloads a packet capture; its Member and Viewer, and Cloud's Admin, may not", async () => {
    for (const [permission, isLetThrough] of [
      [Permission.NetworkAdmin, true],
      [Permission.ProjectAdmin, true],
      [Permission.NetworkMember, false],
      [Permission.NetworkViewer, false],
      [Permission.ProjectMember, false],
      [Permission.CloudAdmin, false],
    ] as Array<[Permission, boolean]>) {
      caller = callerWith([permission]);
      useInMemoryTable(asService(PacketCaptureService), []);

      for (const [action, refusal] of [
        ["stop", PACKET_CAPTURE_STOP_REFUSED_MESSAGE],
        ["download", PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE],
      ] as Array<[string, string]>) {
        const sent: SentRequest = await server.request(
          "POST",
          `/api/packet-capture/${ROW_ID}/${action}`,
          {},
        );

        expect({
          permission,
          action,
          refused: saidIn(sent) === refusal,
        }).toEqual({ permission, action, refused: !isLetThrough });
      }
    }
  });

  test("Cloud's Admin connects and tests a cloud; its Member and Viewer may not", async () => {
    const refusal: RegExp = /Project Owners and Project Admins can/;

    for (const [permission, isLetThrough] of [
      [Permission.CloudAdmin, true],
      [Permission.ProjectAdmin, true],
      [Permission.CloudMember, false],
      [Permission.CloudViewer, false],
      [Permission.NetworkAdmin, false],
    ] as Array<[Permission, boolean]>) {
      caller = callerWith([permission]);
      useInMemoryTable(asService(CloudConnectionService), []);

      const sent: SentRequest = await server.request(
        "POST",
        "/api/cloud-connection/test",
        {},
      );

      expect({
        permission,
        refused: refusal.test(saidIn(sent)),
      }).toEqual({ permission, refused: !isLetThrough });
    }
  });
});

describe("a product's level held through an API key, or taken away by a block", () => {
  test("an API key given Network Viewer reads network devices and nothing of Cloud", async () => {
    caller = {
      ...customDomainCaller({
        permissions: [Permission.NetworkViewer],
        projectId: PROJECT_ID,
        isApiKey: true,
      }),
      ...ON_HIGHEST_PLAN,
    };

    useInMemoryTable(asService(NetworkDeviceService), oneRow());
    expect(
      (
        await server.request(
          "POST",
          "/api/network-device/get-list",
          list("/api/network-device"),
        )
      ).status,
    ).toBe(200);

    useInMemoryTable(asService(CloudConnectionService), oneRow());
    expect(
      (
        await server.request(
          "POST",
          "/api/cloud-connection/get-list",
          list("/api/cloud-connection"),
        )
      ).status,
    ).toBe(REFUSED);
  });

  test("a team's block on Network Viewer takes it away, whatever else they hold of it", async () => {
    caller = {
      ...customDomainCaller({
        permissions: [Permission.NetworkViewer],
        blocks: [Permission.NetworkViewer],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    useInMemoryTable(asService(NetworkDeviceService), oneRow());

    const sent: SentRequest = await server.request(
      "POST",
      "/api/network-device/get-list",
      list("/api/network-device"),
    );

    expect(sent.status).toBe(REFUSED);
    expect(saidIn(sent)).toContain("Network Viewer");
  });
});
