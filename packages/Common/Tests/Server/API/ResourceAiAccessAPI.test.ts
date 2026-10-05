import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DatabaseServerService from "../../../Server/Services/DatabaseServerService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import HostService from "../../../Server/Services/HostService";
import IncidentService from "../../../Server/Services/IncidentService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import ResourceAiAgentService from "../../../Server/Services/ResourceAiAgentService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import VMwareVCenterService from "../../../Server/Services/VMwareVCenterService";
import ResourceCommandJobRunner, {
  RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
  ResourceCommandJobOutcome,
} from "../../../Server/Utils/AI/ResourceAccess/ResourceCommandJobRunner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import Label from "../../../Models/DatabaseModels/Label";
import ResourceAiAgent from "../../../Models/DatabaseModels/ResourceAiAgent";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import {
  RESOURCE_AI_ACCESS_LOGS_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
  RESOURCE_AI_LOGS_LIMIT,
  ResourceAiLogs,
} from "../../../Types/AI/ResourceAiAccessApi";
import { getResourceAiAgentResetRefusal } from "../../../Types/AI/ResourceAiAccessPermissions";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS,
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Common/Server/API/ResourceAiAccessAPI.ts — the calls behind the AI pages of
 * every resource a resource AI agent serves, the resource-agnostic sibling
 * of KubernetesClusterAiAccessAPI (whose tests these mirror):
 *
 * - every route reads the resource through ITS OWN service, under the
 *   user's own props and scoped to the tenant: another project's id reads
 *   exactly like a missing one, and nothing past the lookup runs — which
 *   is what guards the agent data (the ResourceAiAgent table is readable by
 *   anyone who may read any one of the eight types);
 * - /status needs only read access; /test needs edit access to the resource
 *   (a block row is a denial, not a grant); /reset-agent needs one of
 *   RESOURCE_AI_ACCESS_ADMIN_PERMISSIONS;
 * - /test runs the type's test commands through ResourceCommandJobRunner.run
 *   as an access test with no AI run, through the resource's CURRENT agent,
 *   and keeps going only while commands succeed; a gap that blocks the
 *   transport (no agent, an offline one) stops it before anything runs,
 *   and a gap about the project's AI never does;
 * - /test has its own limits (one at a time per resource, a few per minute
 *   and a ceiling per hour per resource, a few per minute per user) on
 *   step ids of its own, so it never counts against a cluster's tests;
 * - /logs returns summaries only, read as root after the read gate.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

type MockRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const mockRoutes: Array<MockRoute> = [];

type RegisterRouteFunction = (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void;

const registerRoute: RegisterRouteFunction = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: MockRouter = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): MockRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

const sendJsonObjectResponseMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

// Every resource type's service and the permissions that read and edit it.
interface Kind {
  resourceType: AiResourceType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
  readPermission: Permission;
  editPermission: Permission;
  subjectRelation: string;
  sentenceName: string;
}

const KINDS: Array<Kind> = [
  {
    resourceType: AiResourceType.DockerHost,
    service: DockerHostService,
    readPermission: Permission.ReadDockerHost,
    editPermission: Permission.EditDockerHost,
    subjectRelation: "dockerHosts",
    sentenceName: "Docker host",
  },
  {
    resourceType: AiResourceType.PodmanHost,
    service: PodmanHostService,
    readPermission: Permission.ReadPodmanHost,
    editPermission: Permission.EditPodmanHost,
    subjectRelation: "podmanHosts",
    sentenceName: "Podman host",
  },
  {
    resourceType: AiResourceType.DockerSwarmCluster,
    service: DockerSwarmClusterService,
    readPermission: Permission.ReadDockerSwarmCluster,
    editPermission: Permission.EditDockerSwarmCluster,
    subjectRelation: "dockerSwarmClusters",
    sentenceName: "Docker Swarm cluster",
  },
  {
    resourceType: AiResourceType.ProxmoxCluster,
    service: ProxmoxClusterService,
    readPermission: Permission.ReadProxmoxCluster,
    editPermission: Permission.EditProxmoxCluster,
    subjectRelation: "proxmoxClusters",
    sentenceName: "Proxmox cluster",
  },
  {
    resourceType: AiResourceType.VMwareVCenter,
    service: VMwareVCenterService,
    readPermission: Permission.ReadVMwareVCenter,
    editPermission: Permission.EditVMwareVCenter,
    subjectRelation: "vmwareVCenters",
    sentenceName: "VMware vCenter",
  },
  {
    resourceType: AiResourceType.CephCluster,
    service: CephClusterService,
    readPermission: Permission.ReadCephCluster,
    editPermission: Permission.EditCephCluster,
    subjectRelation: "cephClusters",
    sentenceName: "Ceph cluster",
  },
  {
    resourceType: AiResourceType.DatabaseServer,
    service: DatabaseServerService,
    readPermission: Permission.ReadDatabaseServer,
    editPermission: Permission.EditDatabaseServer,
    subjectRelation: "databaseServers",
    sentenceName: "database server",
  },
  {
    resourceType: AiResourceType.Host,
    service: HostService,
    readPermission: Permission.ReadHost,
    editPermission: Permission.EditHost,
    subjectRelation: "hosts",
    sentenceName: "host",
  },
];

// The full route behaviour runs against these three; the table covers all eight.
const COVERED: Array<Kind> = KINDS.filter((kind: Kind) => {
  return [
    AiResourceType.DockerHost,
    AiResourceType.DatabaseServer,
    AiResourceType.Host,
  ].includes(kind.resourceType);
});

// The models of the covered types, for rows that carry their labels.
const LABELLED_MODELS: Partial<Record<AiResourceType, { new (): BaseModel }>> =
  {
    [AiResourceType.DockerHost]: DockerHost,
    [AiResourceType.DatabaseServer]: DatabaseServer,
    [AiResourceType.Host]: Host,
  };

function kindOf(resourceType: AiResourceType): Kind {
  return KINDS.find((kind: Kind) => {
    return kind.resourceType === resourceType;
  })!;
}

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function matchRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === uri;
  });

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

function body(
  resourceType: AiResourceType | string,
  resourceId: string = RESOURCE_ID.toString(),
): JSONObject {
  return { resourceType, resourceId };
}

async function callRoute(
  uri: string,
  requestBody: JSONObject,
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: requestBody,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute(uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

/*
 * The per-resource hourly count and the per-minute count differ only in how
 * far back createdAt reaches: an hour, or a minute.
 */
function isWithinTheLastHourOnly(query: Record<string, unknown>): boolean {
  const filter: { objectLiteralParameters?: Record<string, unknown> } =
    (query["createdAt"] as {
      objectLiteralParameters?: Record<string, unknown>;
    }) || {};
  const since: unknown = Object.values(filter.objectLiteralParameters || {})[0];

  return since instanceof Date && Date.now() - since.getTime() > 10 * 60 * 1000;
}

// The ids a QueryHelper.any(...) filter asks for.
function idsIn(filter: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (filter as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  const values: unknown = Object.values(parameters)[0];

  return Array.isArray(values)
    ? values.map((value: unknown) => {
        return String(value);
      })
    : [];
}

function lastResponse(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock
    .calls as Array<Array<unknown>>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![2] as JSONObject;
}

/*
 * A caller's permission rows as an access token carries them: every row is
 * a grant or a block (isBlockPermission is always set), optionally limited
 * to some labels (`scoped`).
 */
function userProps(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  scoped?:
    | Array<{
        permission: Permission;
        labelIds: Array<ObjectID>;
        isBlockPermission?: boolean | undefined;
      }>
    | undefined;
  userId?: ObjectID | undefined | null;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      ...data.permissions.map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission;
      }),
      ...(data.blocked || []).map((permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: true,
        } as UserPermission;
      }),
      ...(data.scoped || []).map(
        (row: {
          permission: Permission;
          labelIds: Array<ObjectID>;
          isBlockPermission?: boolean | undefined;
        }): UserPermission => {
          return {
            _type: "UserPermission",
            permission: row.permission,
            labelIds: row.labelIds,
            isBlockPermission: Boolean(row.isBlockPermission),
          } as UserPermission;
        },
      ),
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: data.userId === undefined ? USER_ID : data.userId || undefined,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
}

function gap(
  code: ResourceAiAccessGapCode,
  blocks: { investigation: boolean; remediation: boolean } = {
    investigation: true,
    remediation: true,
  },
): ResourceAiAccessGap {
  return {
    code,
    title: `${code} title`,
    nextStep: `${code} next step`,
    blocksInvestigation: blocks.investigation,
    blocksRemediation: blocks.remediation,
  };
}

function readyStatus(
  resourceType: AiResourceType,
  overrides: Partial<ResourceAiAccessStatus> = {},
): ResourceAiAccessStatus {
  return {
    resourceType,
    resourceId: RESOURCE_ID.toString(),
    resourceName: "prod-1",
    isAiInvestigationEnabled: false,
    aiRemediationMode: ResourceAiRemediationMode.Disabled,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID.toString(),
      connectionStatus: "connected",
      isOnline: true,
    },
    // The switches are off: the test must run anyway.
    gaps: [
      gap("investigation_disabled", {
        investigation: true,
        remediation: false,
      }),
      gap("remediation_disabled", { investigation: false, remediation: true }),
    ],
    isInvestigationReady: false,
    isRemediationReady: false,
    ...overrides,
  };
}

function resourceRow(
  projectId: ObjectID = PROJECT_ID,
): Record<string, unknown> {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId,
    name: "prod-1",
  };
}

function outcome(
  command: string,
  overrides: Partial<ResourceCommandJobOutcome> = {},
): ResourceCommandJobOutcome {
  return {
    jobId: ObjectID.generate().toString(),
    succeeded: true,
    exitCode: 0,
    output: `output of ${command}`,
    displayCommand: command,
    executed: true,
    ...overrides,
  };
}

describe("ResourceAiAccessAPI", () => {
  let propsSpy: jest.SpyInstance;
  let findSpies: Map<AiResourceType, jest.SpyInstance>;
  let statusSpy: jest.SpyInstance;
  let runSpy: jest.SpyInstance;
  let countSpy: jest.SpyInstance;

  // What the access-test counters answer, by which query asks.
  let inFlightTests: number;
  let recentTestsForResource: number;
  let testsForResourceThisHour: number;
  let recentTestsByUser: number;

  /*
   * An in-memory stand-in for Redis: SET NX and compare-and-delete with the
   * semantics GlobalCache gives them, and a mutex per key that queues its
   * waiters, as redis-semaphore's does.
   */
  let cacheKeys: Map<string, string>;
  let reserveSpy: jest.SpyInstance;
  let releaseSpy: jest.SpyInstance;
  let lockSpy: jest.SpyInstance;
  let lockReleaseSpy: jest.SpyInstance;
  let heldLocks: Map<string, Promise<void>>;

  beforeAll(async () => {
    /*
     * The router registers its routes at module scope, so the import is
     * deferred until the mock router above is fully constructed.
     */
    await import("../../../Server/API/ResourceAiAccessAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    inFlightTests = 0;
    recentTestsForResource = 0;
    testsForResourceThisHour = 0;
    recentTestsByUser = 0;

    cacheKeys = new Map<string, string>();
    reserveSpy = jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<boolean> => {
          const cacheKey: string = `${namespace}-${key}`;
          if (cacheKeys.has(cacheKey)) {
            return false;
          }
          cacheKeys.set(cacheKey, value);
          return true;
        },
      );
    releaseSpy = jest
      .spyOn(GlobalCache, "deleteKeyIfValue")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<boolean> => {
          const cacheKey: string = `${namespace}-${key}`;
          if (cacheKeys.get(cacheKey) !== value) {
            return false;
          }
          cacheKeys.delete(cacheKey);
          return true;
        },
      );

    heldLocks = new Map<string, Promise<void>>();
    lockSpy = jest
      .spyOn(Semaphore, "lock")
      .mockImplementation(
        async (data: {
          key: string;
          namespace: string;
        }): Promise<SemaphoreMutex> => {
          const lockKey: string = `${data.namespace}-${data.key}`;

          while (heldLocks.has(lockKey)) {
            await heldLocks.get(lockKey);
          }

          let unlock: () => void = (): void => {
            return undefined;
          };
          heldLocks.set(
            lockKey,
            new Promise<void>((resolve: () => void) => {
              unlock = resolve;
            }),
          );

          return {
            lockKey,
            unlock: (): void => {
              heldLocks.delete(lockKey);
              unlock();
            },
          } as unknown as SemaphoreMutex;
        },
      );
    lockReleaseSpy = jest
      .spyOn(Semaphore, "release")
      .mockImplementation(async (mutex: SemaphoreMutex): Promise<void> => {
        (mutex as unknown as { unlock: () => void }).unlock();
      });

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        userProps({ permissions: [Permission.ProjectMember] }),
      );

    findSpies = new Map<AiResourceType, jest.SpyInstance>();
    for (const kind of KINDS) {
      findSpies.set(
        kind.resourceType,
        jest.spyOn(kind.service, "findOneBy").mockResolvedValue(resourceRow()),
      );
    }

    statusSpy = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockImplementation(async (data: unknown) => {
        return readyStatus(
          (data as { resourceType: AiResourceType }).resourceType,
        );
      });

    runSpy = jest
      .spyOn(ResourceCommandJobRunner, "run")
      .mockImplementation(async (data: unknown) => {
        return outcome((data as { command: string }).command);
      });

    countSpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockImplementation(async (args: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["status"]) {
          return new PositiveNumber(inFlightTests);
        }

        if (query["resourceId"]) {
          return new PositiveNumber(
            isWithinTheLastHourOnly(query)
              ? testsForResourceThisHour
              : recentTestsForResource,
          );
        }

        return new PositiveNumber(recentTestsByUser);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("registers the four routes, each behind the user middleware", () => {
    for (const path of [
      RESOURCE_AI_ACCESS_STATUS_PATH,
      RESOURCE_AI_ACCESS_TEST_PATH,
      RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
      RESOURCE_AI_ACCESS_LOGS_PATH,
    ]) {
      const route: MockRoute = matchRoute(path);
      expect(route.middleware).toBeDefined();
    }

    expect([
      RESOURCE_AI_ACCESS_STATUS_PATH,
      RESOURCE_AI_ACCESS_TEST_PATH,
      RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
      RESOURCE_AI_ACCESS_LOGS_PATH,
    ]).toEqual([
      "/resource-ai-access/status",
      "/resource-ai-access/test",
      "/resource-ai-access/reset-agent",
      "/resource-ai-access/logs",
    ]);
  });

  describe.each(KINDS)(
    "$resourceType: the resource lookup goes through its own service",
    (kind: Kind) => {
      test("status reads the resource through its service, under the user's props, scoped to the tenant", async () => {
        propsSpy.mockResolvedValue(
          userProps({ permissions: [kind.readPermission] }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_STATUS_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);

        const spy: jest.SpyInstance = findSpies.get(kind.resourceType)!;
        expect(spy).toHaveBeenCalledTimes(1);
        const args: {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        } = spy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        };
        expect(args.query["_id"]).toBe(RESOURCE_ID.toString());
        expect(String(args.query["projectId"])).toBe(PROJECT_ID.toString());
        expect(args.props.isRoot).toBeFalsy();
        expect(String(args.props.userId)).toBe(USER_ID.toString());

        // No other type's table was read.
        for (const other of KINDS) {
          if (other.resourceType !== kind.resourceType) {
            expect(findSpies.get(other.resourceType)).not.toHaveBeenCalled();
          }
        }

        const statusCall: Record<string, unknown> = statusSpy.mock
          .calls[0]![0] as Record<string, unknown>;
        expect(statusCall["resourceType"]).toBe(kind.resourceType);
        expect(String(statusCall["resourceId"])).toBe(RESOURCE_ID.toString());
        expect(String(statusCall["projectId"])).toBe(PROJECT_ID.toString());
        expect(lastResponse()["resourceType"]).toBe(kind.resourceType);
      });

      test("a resource the user cannot read is refused in the type's own words", async () => {
        findSpies.get(kind.resourceType)!.mockResolvedValue(null);

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_STATUS_PATH,
          body(kind.resourceType),
        );

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as Error).message).toBe(
          `${AI_RESOURCE_TYPE_INFO[kind.resourceType].displayName} not found (or you do not have access to it).`,
        );
        expect(statusSpy).not.toHaveBeenCalled();
      });

      test("the access test is for the people who may edit this type", async () => {
        propsSpy.mockResolvedValue(
          userProps({ permissions: [kind.readPermission] }),
        );

        const refused: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(refused.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((refused.thrownToNext as Error).message).toBe(
          `You need permission to edit this ${kind.sentenceName} to run its AI access test.`,
        );
        expect(runSpy).not.toHaveBeenCalled();

        // A custom role that may read and edit this type (the route reads it first).
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [kind.readPermission, kind.editPermission],
          }),
        );

        const admitted: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(admitted.nextCallCount).toBe(0);
        expect(
          runSpy.mock.calls.map((call: Array<unknown>) => {
            return (call[0] as { command: string }).command;
          }),
        ).toEqual([...AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands]);
      });

      test("links incidents and alerts through the type's own relation for logs", async () => {
        const incidentFind: jest.SpyInstance = jest
          .spyOn(IncidentService, "findBy")
          .mockResolvedValue([]);
        const alertFind: jest.SpyInstance = jest
          .spyOn(AlertService, "findBy")
          .mockResolvedValue([]);
        jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
        jest
          .spyOn(AutoRemediationSuggestionService, "findBy")
          .mockResolvedValue([]);

        await callRoute(
          RESOURCE_AI_ACCESS_LOGS_PATH,
          body(kind.resourceType),
        );

        for (const spy of [incidentFind, alertFind]) {
          const query: Record<string, unknown> = (
            spy.mock.calls[0]![0] as { query: Record<string, unknown> }
          ).query;
          expect(query[kind.subjectRelation]).toBeDefined();
          expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
        }
      });
    },
  );

  test("the kinds table covers every resource type", () => {
    expect(
      KINDS.map((kind: Kind) => {
        return kind.resourceType;
      }),
    ).toEqual([...ALL_AI_RESOURCE_TYPES]);
  });

  describe("reading the request", () => {
    test("accepts a type in any case and an agent alias", async () => {
      for (const [spelled, type] of [
        ["dockerhost", AiResourceType.DockerHost],
        ["docker", AiResourceType.DockerHost],
        ["db", AiResourceType.DatabaseServer],
        ["HOST", AiResourceType.Host],
      ] as Array<[string, AiResourceType]>) {
        jest.clearAllMocks();

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_STATUS_PATH,
          body(spelled),
        );

        expect(result.nextCallCount).toBe(0);
        expect(findSpies.get(type)).toHaveBeenCalledTimes(1);
      }
    });

    test.each([
      [RESOURCE_AI_ACCESS_STATUS_PATH],
      [RESOURCE_AI_ACCESS_TEST_PATH],
      [RESOURCE_AI_ACCESS_RESET_AGENT_PATH],
      [RESOURCE_AI_ACCESS_LOGS_PATH],
    ])(
      "%s rejects a missing or unknown type, and a missing or malformed id, before any lookup",
      async (uri: string) => {
        for (const requestBody of [
          {},
          { resourceId: RESOURCE_ID.toString() },
          body("KubernetesCluster"),
          body("serverless"),
          body(AiResourceType.DockerHost, ""),
          body(AiResourceType.DockerHost, "not-a-uuid"),
          { resourceType: AiResourceType.DockerHost, resourceId: 42 },
        ] as Array<JSONObject>) {
          const result: RouteCallResult = await callRoute(uri, requestBody);
          expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        }

        for (const spy of findSpies.values()) {
          expect(spy).not.toHaveBeenCalled();
        }
      },
    );

    test("names the valid types when the type is wrong", async () => {
      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_STATUS_PATH,
        body("KubernetesCluster"),
      );

      expect((result.thrownToNext as Error).message).toBe(
        "resourceType is required and must be one of DockerHost, PodmanHost, DockerSwarmCluster, ProxmoxCluster, VMwareVCenter, CephCluster, DatabaseServer, Host.",
      );
    });
  });

  describe.each(COVERED)(
    "$resourceType: tenant isolation (every route)",
    (kind: Kind) => {
      test.each([
        [RESOURCE_AI_ACCESS_STATUS_PATH],
        [RESOURCE_AI_ACCESS_TEST_PATH],
        [RESOURCE_AI_ACCESS_RESET_AGENT_PATH],
        [RESOURCE_AI_ACCESS_LOGS_PATH],
      ])(
        "%s: another project's id reads exactly like a missing one, and nothing else runs",
        async (uri: string) => {
          propsSpy.mockResolvedValue(
            userProps({ permissions: [Permission.ProjectOwner] }),
          );
          const resetSpy: jest.SpyInstance = jest
            .spyOn(ResourceAiAgentService, "resetAgent")
            .mockResolvedValue(undefined);
          const jobFind: jest.SpyInstance = jest
            .spyOn(RunnerJobService, "findBy")
            .mockResolvedValue([]);

          findSpies.get(kind.resourceType)!.mockResolvedValue(null);
          const missing: RouteCallResult = await callRoute(
            uri,
            body(kind.resourceType),
          );

          expect(missing.thrownToNext).toBeInstanceOf(BadDataException);
          const missingMessage: string = (missing.thrownToNext as Error)
            .message;

          // Belt and braces: a row that somehow came back from elsewhere.
          findSpies
            .get(kind.resourceType)!
            .mockResolvedValue(resourceRow(OTHER_PROJECT_ID));

          const foreign: RouteCallResult = await callRoute(
            uri,
            body(kind.resourceType),
          );

          expect(foreign.thrownToNext).toBeInstanceOf(BadDataException);
          expect((foreign.thrownToNext as Error).message).toBe(missingMessage);
          expect(missingMessage).toContain("not found");

          expect(statusSpy).not.toHaveBeenCalled();
          expect(countSpy).not.toHaveBeenCalled();
          expect(runSpy).not.toHaveBeenCalled();
          expect(resetSpy).not.toHaveBeenCalled();
          expect(jobFind).not.toHaveBeenCalled();
          expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
        },
      );

      test.each([
        [RESOURCE_AI_ACCESS_STATUS_PATH],
        [RESOURCE_AI_ACCESS_TEST_PATH],
        [RESOURCE_AI_ACCESS_RESET_AGENT_PATH],
        [RESOURCE_AI_ACCESS_LOGS_PATH],
      ])("%s: requires a logged-in user", async (uri: string) => {
        propsSpy.mockResolvedValue(
          userProps({ permissions: [Permission.ProjectOwner], userId: null }),
        );

        const result: RouteCallResult = await callRoute(
          uri,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(1);
        expect(findSpies.get(kind.resourceType)).not.toHaveBeenCalled();
      });
    },
  );

  describe.each(COVERED)("$resourceType: POST /status", (kind: Kind) => {
    test("returns the status for a user who may only read the resource, and runs nothing", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [kind.readPermission] }),
      );

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_STATUS_PATH,
        body(kind.resourceType),
      );

      expect(result.nextCallCount).toBe(0);
      expect(lastResponse()).toEqual(
        readyStatus(kind.resourceType) as unknown as JSONObject,
      );
      expect(runSpy).not.toHaveBeenCalled();
      expect(countSpy).not.toHaveBeenCalled();
    });

    test("a status that cannot be computed (the resource went away meanwhile) is not found", async () => {
      statusSpy.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_STATUS_PATH,
        body(kind.resourceType),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        `${AI_RESOURCE_TYPE_INFO[kind.resourceType].displayName} not found.`,
      );
    });
  });

  describe.each(COVERED)(
    "$resourceType: POST /test — who may run it",
    (kind: Kind) => {
      test("refuses a user who may only read the resource, before any count or command", async () => {
        propsSpy.mockResolvedValue(
          userProps({ permissions: [kind.readPermission] }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(countSpy).not.toHaveBeenCalled();
        expect(reserveSpy).not.toHaveBeenCalled();
        expect(runSpy).not.toHaveBeenCalled();
      });

      test("a block row is a denial, not a grant", async () => {
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [kind.readPermission],
            blocked: [kind.editPermission],
          }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(runSpy).not.toHaveBeenCalled();
      });

      test("admits every role that may edit the resource, and a master admin", async () => {
        for (const props of [
          userProps({ permissions: [Permission.ProjectMember] }),
          userProps({ permissions: [Permission.SettingsMember] }),
          userProps({
            permissions: [kind.readPermission, kind.editPermission],
          }),
          userProps({ permissions: [], isMasterAdmin: true }),
        ]) {
          jest.clearAllMocks();
          propsSpy.mockResolvedValue(props);

          const result: RouteCallResult = await callRoute(
            RESOURCE_AI_ACCESS_TEST_PATH,
            body(kind.resourceType),
          );

          expect(result.nextCallCount).toBe(0);
          expect(runSpy).toHaveBeenCalledTimes(
            AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands.length,
          );
        }
      });

      test("a table-wide block row on the edit permission refuses even a project member", async () => {
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [Permission.ProjectMember],
            blocked: [kind.editPermission],
          }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(reserveSpy).not.toHaveBeenCalled();
        expect(runSpy).not.toHaveBeenCalled();
      });
    },
  );

  /*
   * Edit access is decided for THIS resource, from its own labels, as a CRUD
   * update of it would be — not "may the caller edit some resource of this
   * type somewhere in the project".
   */
  describe.each(COVERED)(
    "$resourceType: POST /test — edit access to THIS resource, labels included",
    (kind: Kind) => {
      const PROD_LABEL_ID: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      const STAGING_LABEL_ID: ObjectID = new ObjectID(
        "55555555-5555-4555-8555-555555555555",
      );

      // The resource as its table holds it: a model with its labels.
      function serveResourceLabelled(labelId: ObjectID, name: string): void {
        const label: Label = new Label();
        label.id = labelId;
        label.name = name;

        const row: BaseModel = new LABELLED_MODELS[kind.resourceType]!();
        row.id = RESOURCE_ID;
        const record: Record<string, unknown> = row as unknown as Record<
          string,
          unknown
        >;
        record["projectId"] = PROJECT_ID;
        record["name"] = "prod-1";
        record["labels"] = [label];

        findSpies.get(kind.resourceType)!.mockResolvedValue(row);
      }

      function refusedBeforeAnythingRan(result: RouteCallResult): void {
        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          `You need permission to edit this ${kind.sentenceName} to run its AI access test.`,
        );
        expect(reserveSpy).not.toHaveBeenCalled();
        expect(countSpy).not.toHaveBeenCalled();
        expect(statusSpy).not.toHaveBeenCalled();
        expect(runSpy).not.toHaveBeenCalled();
      }

      test("an edit grant limited to another label does not reach this resource", async () => {
        serveResourceLabelled(PROD_LABEL_ID, "prod");
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [kind.readPermission],
            scoped: [
              { permission: kind.editPermission, labelIds: [STAGING_LABEL_ID] },
            ],
          }),
        );

        refusedBeforeAnythingRan(
          await callRoute(
            RESOURCE_AI_ACCESS_TEST_PATH,
            body(kind.resourceType),
          ),
        );
      });

      test("negative control: the same grant reaches a resource with its label", async () => {
        serveResourceLabelled(STAGING_LABEL_ID, "staging");
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [kind.readPermission],
            scoped: [
              { permission: kind.editPermission, labelIds: [STAGING_LABEL_ID] },
            ],
          }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);
        expect(runSpy).toHaveBeenCalledTimes(
          AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands.length,
        );
      });

      test("a block row on the edit permission for this resource's label refuses a project member", async () => {
        serveResourceLabelled(PROD_LABEL_ID, "prod");
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [Permission.ProjectMember],
            scoped: [
              {
                permission: kind.editPermission,
                labelIds: [PROD_LABEL_ID],
                isBlockPermission: true,
              },
            ],
          }),
        );

        refusedBeforeAnythingRan(
          await callRoute(
            RESOURCE_AI_ACCESS_TEST_PATH,
            body(kind.resourceType),
          ),
        );
      });

      test("negative control: that block does not touch a resource without the label", async () => {
        serveResourceLabelled(STAGING_LABEL_ID, "staging");
        propsSpy.mockResolvedValue(
          userProps({
            permissions: [Permission.ProjectMember],
            scoped: [
              {
                permission: kind.editPermission,
                labelIds: [PROD_LABEL_ID],
                isBlockPermission: true,
              },
            ],
          }),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);
        expect(runSpy).toHaveBeenCalledTimes(
          AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands.length,
        );
      });
    },
  );

  describe.each(COVERED)(
    "$resourceType: POST /test — the happy path",
    (kind: Kind) => {
      test("runs each test command through ResourceCommandJobRunner.run as an access test, through the resource's current agent", async () => {
        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);

        const commands: ReadonlyArray<string> =
          AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands;
        expect(runSpy).toHaveBeenCalledTimes(commands.length);

        runSpy.mock.calls.forEach((call: Array<unknown>, index: number) => {
          const data: Record<string, unknown> = call[0] as Record<
            string,
            unknown
          >;

          expect(data["command"]).toBe(commands[index]);
          expect(data["origin"]).toBe(RunnerJobOrigin.AiInvestigation);
          expect(data["aiRunId"]).toBeUndefined();
          expect(data["autoRemediationSuggestionId"]).toBeUndefined();
          expect(data["isAccessTest"]).toBe(true);
          expect(data["resourceType"]).toBe(kind.resourceType);
          expect(String(data["resourceId"])).toBe(RESOURCE_ID.toString());
          expect(String(data["projectId"])).toBe(PROJECT_ID.toString());
          expect(String(data["targetResourceAiAgentId"])).toBe(
            AGENT_ID.toString(),
          );
          expect(data["timeoutInMs"]).toBe(DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS);
          expect(data["claimTimeoutInMs"]).toBe(
            RESOURCE_COMMAND_CLAIM_TIMEOUT_MS,
          );
          expect(data["stepId"]).toBe(
            `resource-ai-access-test-${index + 1}-${USER_ID.toString()}`,
          );
        });

        const response: JSONObject = lastResponse();
        expect(response["ok"]).toBe(true);
        expect(response["message"]).toBe(
          `OneUptime AI can run commands on "prod-1" through the ${
            AI_RESOURCE_TYPE_INFO[kind.resourceType].agentDisplayName
          }.`,
        );
        expect(response["results"]).toEqual(
          commands.map((command: string) => {
            return {
              command,
              succeeded: true,
              exitCode: 0,
              output: `output of ${command}`,
              errorMessage: null,
            };
          }),
        );
        // The status is read again after the test: it may have changed "Last verified".
        expect(statusSpy).toHaveBeenCalledTimes(2);
        expect(response["status"]).toBeDefined();
      });

      test("keeps the response shape: five fields per command, nothing more", async () => {
        runSpy.mockImplementation(async (data: unknown) => {
          return outcome((data as { command: string }).command, {
            redactionCount: 3,
            isTruncated: true,
            runState: undefined,
            jobId: "job",
          });
        });

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        for (const row of lastResponse()["results"] as Array<JSONObject>) {
          expect(Object.keys(row).sort()).toEqual([
            "command",
            "errorMessage",
            "exitCode",
            "output",
            "succeeded",
          ]);
        }
      });

      test("still runs with the switches off, the project's AI gaps, and an agent that could not reach the resource at its last probe", async () => {
        statusSpy.mockResolvedValue(
          readyStatus(kind.resourceType, {
            gaps: [
              gap("investigation_disabled", {
                investigation: true,
                remediation: false,
              }),
              gap("remediation_disabled", {
                investigation: false,
                remediation: true,
              }),
              gap("remediation_write_access_missing", {
                investigation: false,
                remediation: true,
              }),
              gap("ai_disabled_for_project"),
              gap("llm_provider_missing"),
              gap("ai_balance_insufficient"),
              gap("ai_agent_unreachable_resource"),
            ],
          }),
        );

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        expect(runSpy).toHaveBeenCalledTimes(
          AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands.length,
        );
        expect(lastResponse()["ok"]).toBe(true);
      });

      test.each([
        ["ai_agent_offline" as const],
        ["ai_agent_not_connected" as const],
      ])(
        "stops before anything runs on %s, with the gap's own title and next step",
        async (code: ResourceAiAccessGapCode) => {
          statusSpy.mockResolvedValue(
            readyStatus(kind.resourceType, { gaps: [gap(code)] }),
          );

          await callRoute(
            RESOURCE_AI_ACCESS_TEST_PATH,
            body(kind.resourceType),
          );

          expect(runSpy).not.toHaveBeenCalled();
          const response: JSONObject = lastResponse();
          expect(response["ok"]).toBe(false);
          expect(response["message"]).toBe(`${code} title. ${code} next step`);
          expect(response["results"]).toEqual([]);
          expect(response["status"]).toBeDefined();
        },
      );

      test("with no agent at all it says to install the type's agent", async () => {
        statusSpy.mockResolvedValue(
          readyStatus(kind.resourceType, { agent: null, gaps: [] }),
        );

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        expect(runSpy).not.toHaveBeenCalled();
        expect(lastResponse()["message"]).toBe(
          `Nothing can reach this ${kind.sentenceName} yet: install the ${
            AI_RESOURCE_TYPE_INFO[kind.resourceType].agentDisplayName
          }.`,
        );
      });

      test("with an offline agent and no gap saying so it still does not run", async () => {
        statusSpy.mockResolvedValue(
          readyStatus(kind.resourceType, {
            agent: {
              agentId: AGENT_ID.toString(),
              connectionStatus: "disconnected",
              isOnline: false,
            },
            gaps: [],
          }),
        );

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        expect(runSpy).not.toHaveBeenCalled();
        expect(lastResponse()["ok"]).toBe(false);
        expect(lastResponse()["message"]).toContain("is offline");
      });

      test("stops after the first command that did not succeed, and reports it", async () => {
        runSpy.mockImplementation(async (data: unknown) => {
          return outcome((data as { command: string }).command, {
            succeeded: false,
            exitCode: 1,
            output: "",
            errorMessage: "Cannot connect to the server",
            isAccessFailure: true,
          });
        });

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        expect(runSpy).toHaveBeenCalledTimes(1);
        const response: JSONObject = lastResponse();
        expect(response["ok"]).toBe(false);
        expect(response["message"]).toBe(
          `The ${
            AI_RESOURCE_TYPE_INFO[kind.resourceType].agentDisplayName
          } could not run the test commands successfully — see the command output below.`,
        );
        expect(response["results"]).toEqual([
          {
            command: AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands[0],
            succeeded: false,
            exitCode: 1,
            output: "",
            errorMessage: "Cannot connect to the server",
          },
        ]);
      });

      test("reports a refusal from the chokepoint (a thrown error) as a failed command, and stops", async () => {
        runSpy.mockRejectedValue(
          new BadDataException("The agent is read-only for this command."),
        );

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_TEST_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);
        expect(runSpy).toHaveBeenCalledTimes(1);
        expect(lastResponse()["results"]).toEqual([
          {
            command: AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands[0],
            succeeded: false,
            exitCode: null,
            output: "",
            errorMessage: "The agent is read-only for this command.",
          },
        ]);
      });

      test("a later command that throws is reported in its turn", async () => {
        const commands: ReadonlyArray<string> =
          AI_RESOURCE_TYPE_INFO[kind.resourceType].testCommands;

        if (commands.length < 2) {
          return;
        }

        runSpy
          .mockImplementationOnce(async (data: unknown) => {
            return outcome((data as { command: string }).command);
          })
          .mockRejectedValueOnce("boom");

        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        const results: Array<JSONObject> = lastResponse()[
          "results"
        ] as Array<JSONObject>;
        expect(results).toHaveLength(2);
        expect(results[1]).toEqual({
          command: commands[1],
          succeeded: false,
          exitCode: null,
          output: "",
          errorMessage: "boom",
        });
        expect(lastResponse()["ok"]).toBe(false);
      });

      test("never uses a Kubernetes cluster's step ids, so its tests never count against a cluster's", async () => {
        await callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));

        for (const call of runSpy.mock.calls) {
          const stepId: string = (call[0] as { stepId: string }).stepId;
          expect(stepId.startsWith("ai-access-test-")).toBe(false);
          expect(stepId.startsWith("resource-ai-access-test-")).toBe(true);
        }
      });
    },
  );

  describe.each(COVERED)(
    "$resourceType: POST /test — its own limits",
    (kind: Kind) => {
      async function runTest(): Promise<RouteCallResult> {
        return callRoute(RESOURCE_AI_ACCESS_TEST_PATH, body(kind.resourceType));
      }

      test("refuses a second test while one is still running for the resource", async () => {
        inFlightTests = 1;

        const result: RouteCallResult = await runTest();

        expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect((result.thrownToNext as Error).message).toBe(
          `An AI access test is already running for this ${kind.sentenceName}. Wait for it to finish, then run it again.`,
        );
        expect(runSpy).not.toHaveBeenCalled();
      });

      test("refuses once the resource was tested 3 times in the last minute; admits at 2", async () => {
        recentTestsForResource = 3;
        const refused: RouteCallResult = await runTest();
        expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect((refused.thrownToNext as Error).message).toContain(
          "3 times in the last minute",
        );
        expect(runSpy).not.toHaveBeenCalled();

        recentTestsForResource = 2;
        const admitted: RouteCallResult = await runTest();
        expect(admitted.nextCallCount).toBe(0);
        expect(runSpy).toHaveBeenCalled();
      });

      test("refuses once the resource was tested 30 times in the last hour; admits at 29", async () => {
        testsForResourceThisHour = 30;
        const refused: RouteCallResult = await runTest();
        expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect((refused.thrownToNext as Error).message).toContain(
          "30 times in the last hour",
        );

        testsForResourceThisHour = 29;
        const admitted: RouteCallResult = await runTest();
        expect(admitted.nextCallCount).toBe(0);
      });

      test("refuses once the user ran 6 tests in the last minute; admits at 5", async () => {
        recentTestsByUser = 6;
        const refused: RouteCallResult = await runTest();
        expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect((refused.thrownToNext as Error).message).toBe(
          "You ran 6 AI access tests in the last minute, which is the limit (6). Try again in a minute.",
        );
        expect(runSpy).not.toHaveBeenCalled();

        recentTestsByUser = 5;
        const admitted: RouteCallResult = await runTest();
        expect(admitted.nextCallCount).toBe(0);
      });

      test("counts this resource's tests (their first command) on its own rows, and the user's across resources", async () => {
        await runTest();

        const queries: Array<Record<string, unknown>> = countSpy.mock.calls.map(
          (call: Array<unknown>) => {
            return (call[0] as { query: Record<string, unknown> }).query;
          },
        );

        const resourceQueries: Array<Record<string, unknown>> = queries.filter(
          (query: Record<string, unknown>) => {
            return Boolean(query["resourceId"]);
          },
        );
        // In flight, per minute and per hour.
        expect(resourceQueries).toHaveLength(3);
        for (const query of resourceQueries) {
          expect(query["resourceType"]).toBe(kind.resourceType);
          expect(String(query["resourceId"])).toBe(RESOURCE_ID.toString());
          expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
          expect(query["stepId"]).toBeDefined();
        }

        const userQueries: Array<Record<string, unknown>> = queries.filter(
          (query: Record<string, unknown>) => {
            return !query["resourceId"];
          },
        );
        expect(userQueries).toHaveLength(1);
        expect(JSON.stringify(userQueries[0]!["stepId"])).toContain(
          `resource-ai-access-test-1-${USER_ID.toString()}`,
        );

        for (const call of countSpy.mock.calls) {
          expect((call[0] as { props: unknown }).props).toEqual({
            isRoot: true,
          });
        }
      });

      test("one test at a time per resource: a reservation keyed by type and id, released when the test ends", async () => {
        await runTest();

        expect(reserveSpy).toHaveBeenCalledTimes(1);
        const [namespace, key]: Array<unknown> = reserveSpy.mock.calls[0]!;
        expect(namespace).toBe("resource-ai-access-test");
        expect(key).toBe(`${kind.resourceType}:${RESOURCE_ID.toString()}`);
        expect(releaseSpy).toHaveBeenCalledTimes(1);
        expect(cacheKeys.size).toBe(0);

        const next: RouteCallResult = await runTest();
        expect(next.nextCallCount).toBe(0);
      });

      test("a held reservation refuses the test before anything is counted", async () => {
        cacheKeys.set(
          `resource-ai-access-test-${kind.resourceType}:${RESOURCE_ID.toString()}`,
          "someone-else",
        );

        const result: RouteCallResult = await runTest();

        expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect(countSpy).not.toHaveBeenCalled();
        expect(runSpy).not.toHaveBeenCalled();
        // Not ours to release.
        expect(
          cacheKeys.get(
            `resource-ai-access-test-${kind.resourceType}:${RESOURCE_ID.toString()}`,
          ),
        ).toBe("someone-else");
      });

      test("two tests started together for one resource: exactly one runs", async () => {
        let releaseFirst: () => void = (): void => {
          return undefined;
        };
        const firstStarted: Promise<void> = new Promise<void>(
          (resolve: () => void) => {
            runSpy.mockImplementationOnce(async (data: unknown) => {
              resolve();
              await new Promise<void>((done: () => void) => {
                releaseFirst = done;
              });
              return outcome((data as { command: string }).command);
            });
          },
        );

        const first: Promise<RouteCallResult> = runTest();
        await firstStarted;
        const second: RouteCallResult = await runTest();
        releaseFirst();
        const firstResult: RouteCallResult = await first;

        expect(firstResult.nextCallCount).toBe(0);
        expect(second.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      });

      test("releases the reservation after a failed command, a refused limit and a transport gap too", async () => {
        runSpy.mockRejectedValueOnce(new Error("nope"));
        await runTest();
        expect(cacheKeys.size).toBe(0);

        recentTestsForResource = 3;
        await runTest();
        expect(cacheKeys.size).toBe(0);
        recentTestsForResource = 0;

        statusSpy.mockResolvedValue(
          readyStatus(kind.resourceType, { gaps: [gap("ai_agent_offline")] }),
        );
        await runTest();
        expect(cacheKeys.size).toBe(0);
      });

      test("a reservation that cannot be checked fails closed (503), and nothing runs", async () => {
        reserveSpy.mockRejectedValue(new Error("redis down"));

        const result: RouteCallResult = await runTest();

        expect(result.thrownToNext).toBeInstanceOf(ServiceUnavailableException);
        expect(runSpy).not.toHaveBeenCalled();
      });

      test("a user lock that cannot be had refuses with 429, and nothing runs", async () => {
        lockSpy.mockRejectedValue(new Error("timeout"));

        const result: RouteCallResult = await runTest();

        expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
        expect((result.thrownToNext as Error).message).toBe(
          "Another AI access test of yours is starting right now. Try again in a moment.",
        );
        expect(runSpy).not.toHaveBeenCalled();
        expect(cacheKeys.size).toBe(0);
      });

      test("holds the user's lock (its own namespace) until the first command finished, then releases it", async () => {
        const events: Array<string> = [];
        lockSpy.mockImplementation(async (data: { namespace: string }) => {
          events.push(`lock:${data.namespace}`);
          return {} as SemaphoreMutex;
        });
        lockReleaseSpy.mockImplementation(async () => {
          events.push("release");
        });
        runSpy.mockImplementation(async (data: unknown) => {
          events.push(
            `run:${(data as { stepId: string }).stepId.split("-")[4]}`,
          );
          return outcome((data as { command: string }).command);
        });

        await runTest();

        expect(events[0]).toBe("lock:resource-ai-access-test-user");
        expect(events[1]).toBe("run:1");
        expect(events[2]).toBe("release");
      });

      test("releases the user's lock after a first command that could not start", async () => {
        runSpy.mockRejectedValue(new Error("refused"));

        await runTest();

        expect(lockReleaseSpy).toHaveBeenCalledTimes(1);
        expect(heldLocks.size).toBe(0);
      });
    },
  );

  describe.each(COVERED)("$resourceType: POST /reset-agent", (kind: Kind) => {
    let resetSpy: jest.SpyInstance;
    let agentLookup: jest.SpyInstance;

    beforeEach(() => {
      resetSpy = jest
        .spyOn(ResourceAiAgentService, "resetAgent")
        .mockResolvedValue(undefined);
      agentLookup = jest
        .spyOn(ResourceAiAgentService, "findAgentForResource")
        .mockResolvedValue({ id: AGENT_ID } as unknown as ResourceAiAgent);
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ])("resets this resource's agent for %s", async (role: Permission) => {
      propsSpy.mockResolvedValue(userProps({ permissions: [role] }));

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(result.thrownToNext).toBeUndefined();
      expect(agentLookup).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        resourceType: kind.resourceType,
        resourceId: RESOURCE_ID,
      });
      expect(resetSpy).toHaveBeenCalledTimes(1);
      const call: Record<string, unknown> = resetSpy.mock
        .calls[0]![0] as Record<string, unknown>;
      expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
      expect(call["resourceType"]).toBe(kind.resourceType);
      expect(String(call["resourceId"])).toBe(RESOURCE_ID.toString());
      expect(String(call["userId"])).toBe(USER_ID.toString());

      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(true);
      expect(response["message"]).toBe(
        `The ${
          AI_RESOURCE_TYPE_INFO[kind.resourceType].agentDisplayName
        } was reset. It reconnects on its own within a few minutes.`,
      );
      expect(response["status"]).toBeDefined();
    });

    test("lets a master admin reset without any project permission", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [], isMasterAdmin: true }),
      );

      await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    test("answers without a status when it can no longer be computed", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );
      statusSpy.mockResolvedValue(null);

      await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(lastResponse()["ok"]).toBe(true);
      expect(lastResponse()["status"]).toBeUndefined();
    });

    test.each([
      [Permission.ProjectMember],
      [Permission.SettingsAdmin],
      [Permission.SettingsMember],
      [kind.editPermission],
      [kind.readPermission],
    ])(
      "refuses %s: editing the resource is not enough",
      async (role: Permission) => {
        propsSpy.mockResolvedValue(userProps({ permissions: [role] }));

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
          body(kind.resourceType),
        );

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          getResourceAiAgentResetRefusal(kind.resourceType),
        );
        expect(agentLookup).not.toHaveBeenCalled();
        expect(resetSpy).not.toHaveBeenCalled();
      },
    );

    test("does not read a block row as a grant", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [Permission.ProjectAdmin],
          blocked: [Permission.ProjectAdmin],
        }),
      );

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(resetSpy).not.toHaveBeenCalled();
    });

    test("checks the resource first, under the user's own props", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );
      findSpies.get(kind.resourceType)!.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(agentLookup).not.toHaveBeenCalled();
      expect(resetSpy).not.toHaveBeenCalled();
    });

    test("says so when the resource has no agent to reset", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );
      agentLookup.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
        body(kind.resourceType),
      );

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        `This ${kind.sentenceName} has no ${
          AI_RESOURCE_TYPE_INFO[kind.resourceType].agentDisplayName
        } to reset.`,
      );
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });

  describe.each(COVERED)("$resourceType: POST /logs", (kind: Kind) => {
    const INCIDENT_ID: ObjectID = ObjectID.generate();
    const ALERT_ID: ObjectID = ObjectID.generate();

    let jobFind: jest.SpyInstance;
    let incidentFind: jest.SpyInstance;
    let alertFind: jest.SpyInstance;
    let runFind: jest.SpyInstance;
    let suggestionFind: jest.SpyInstance;

    function run(
      id: ObjectID,
      minutesAgo: number,
      overrides: Record<string, unknown> = {},
    ): AIRun {
      return {
        id,
        status: AIRunStatus.Completed,
        analysisTldr: `tldr ${id.toString()}`,
        createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
        completedAt: new Date(Date.now() - (minutesAgo - 1) * 60 * 1000),
        ...overrides,
      } as unknown as AIRun;
    }

    function suggestion(
      id: ObjectID,
      minutesAgo: number,
      overrides: Record<string, unknown> = {},
    ): AutoRemediationSuggestion {
      return {
        id,
        status: "Suggested",
        executionMode: "Suggest",
        suggestionType: "Commands",
        rationaleMarkdown: "Restart the web container.",
        commandPlan: { commands: [] },
        createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
        ...overrides,
      } as unknown as AutoRemediationSuggestion;
    }

    beforeEach(() => {
      jobFind = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
      incidentFind = jest
        .spyOn(IncidentService, "findBy")
        .mockResolvedValue([]);
      alertFind = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
      runFind = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
      suggestionFind = jest
        .spyOn(AutoRemediationSuggestionService, "findBy")
        .mockResolvedValue([]);
      countSpy.mockResolvedValue(new PositiveNumber(0));
      // Someone who may read everything summarised here.
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectMember] }),
      );
    });

    function isCallerProps(call: Array<unknown>): boolean {
      const props: DatabaseCommonInteractionProps = (
        call[0] as { props: DatabaseCommonInteractionProps }
      ).props;
      return !props.isRoot && String(props.userId) === USER_ID.toString();
    }

    function isRootProps(call: Array<unknown>): boolean {
      return (
        JSON.stringify(
          (call[0] as { props: DatabaseCommonInteractionProps }).props,
        ) === JSON.stringify({ isRoot: true })
      );
    }

    test("needs only read access to the resource", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [kind.readPermission] }),
      );

      const ok: RouteCallResult = await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );
      expect(ok.thrownToNext).toBeUndefined();
    });

    test("reads the resource, incidents and alerts under the USER's props, and the jobs, runs, suggestions and counts as root", async () => {
      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      expect(
        isCallerProps(findSpies.get(kind.resourceType)!.mock.calls[0]!),
      ).toBe(true);

      for (const spy of [incidentFind, alertFind]) {
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls.every(isCallerProps)).toBe(true);
      }

      for (const spy of [jobFind, suggestionFind, countSpy]) {
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.calls.every(isRootProps)).toBe(true);
      }
    });

    test("an empty resource: empty lists and zero counts, and no AI run read", async () => {
      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      expect(lastResponse()).toEqual({
        resourceType: kind.resourceType,
        resourceId: RESOURCE_ID.toString(),
        investigations: [],
        fixes: [],
        commandCounts: { investigation: 0, remediation: 0 },
      });
      expect(runFind).not.toHaveBeenCalled();
    });

    test("investigations: runs that ran commands here UNION runs of linked incidents and alerts, deduplicated, newest first", async () => {
      const fromJobs: ObjectID = ObjectID.generate();
      const fromBoth: ObjectID = ObjectID.generate();
      const fromIncident: ObjectID = ObjectID.generate();
      const fromAlert: ObjectID = ObjectID.generate();

      jobFind.mockResolvedValue([
        { aiRunId: fromJobs },
        { aiRunId: fromBoth },
        { aiRunId: fromBoth },
        // A connection test: no AI run, no suggestion.
        {},
      ] as unknown as Array<RunnerJob>);
      incidentFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return query[kind.subjectRelation]
          ? [{ id: INCIDENT_ID }]
          : [{ id: INCIDENT_ID, title: "Web down", incidentNumber: 42 }];
      });
      alertFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return query[kind.subjectRelation]
          ? [{ id: ALERT_ID }]
          : [{ id: ALERT_ID, title: "High memory" }];
      });
      runFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["triggeredByIncidentId"]) {
          return [
            run(fromIncident, 5, { triggeredByIncidentId: INCIDENT_ID }),
            run(fromBoth, 30),
          ];
        }

        if (query["triggeredByAlertId"]) {
          return [run(fromAlert, 1, { triggeredByAlertId: ALERT_ID })];
        }

        return [run(fromJobs, 60), run(fromBoth, 30)];
      });

      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      const logs: ResourceAiLogs =
        lastResponse() as unknown as ResourceAiLogs;

      expect(
        logs.investigations.map((row: { aiRunId: string }) => {
          return row.aiRunId;
        }),
      ).toEqual([
        fromAlert.toString(),
        fromIncident.toString(),
        fromBoth.toString(),
        fromJobs.toString(),
      ]);
      expect(logs.investigations[0]!.alert).toEqual({
        id: ALERT_ID.toString(),
        title: "High memory",
      });
      expect(logs.investigations[1]!.incident).toEqual({
        id: INCIDENT_ID.toString(),
        title: "Web down",
        number: 42,
      });

      for (const call of runFind.mock.calls) {
        const query: Record<string, unknown> = (
          call[0] as { query: Record<string, unknown> }
        ).query;
        expect(query["runType"]).toBe(AIRunType.Investigation);
        expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      }

      // The jobs read are this resource's agent jobs.
      const jobQuery: Record<string, unknown> = (
        jobFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(jobQuery["resourceType"]).toBe(kind.resourceType);
      expect(String(jobQuery["resourceId"])).toBe(RESOURCE_ID.toString());
      expect(jobQuery["stepType"]).toBe(RunbookStepType.ResourceCommand);
      expect(String(jobQuery["projectId"])).toBe(PROJECT_ID.toString());
    });

    test(`returns at most ${RESOURCE_AI_LOGS_LIMIT} investigations and fixes`, async () => {
      const ids: Array<ObjectID> = Array.from({ length: 40 }, () => {
        return ObjectID.generate();
      });
      jobFind.mockResolvedValue(
        ids.map((id: ObjectID) => {
          return { aiRunId: id, autoRemediationSuggestionId: id };
        }) as unknown as Array<RunnerJob>,
      );
      runFind.mockResolvedValue(
        ids.map((id: ObjectID, index: number) => {
          return run(id, index + 1);
        }),
      );
      suggestionFind.mockResolvedValue(
        ids.map((id: ObjectID, index: number) => {
          return suggestion(id, index + 1);
        }),
      );

      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      const logs: ResourceAiLogs =
        lastResponse() as unknown as ResourceAiLogs;
      expect(logs.investigations).toHaveLength(RESOURCE_AI_LOGS_LIMIT);
      expect(logs.fixes).toHaveLength(RESOURCE_AI_LOGS_LIMIT);
      expect(logs.investigations[0]!.aiRunId).toBe(ids[0]!.toString());
    });

    test("fixes: the resource's own rounds UNION suggestions whose commands ran here, summarised", async () => {
      const round: ObjectID = ObjectID.generate();
      const ruleRound: ObjectID = ObjectID.generate();

      jobFind.mockResolvedValue([
        { autoRemediationSuggestionId: ruleRound },
      ] as unknown as Array<RunnerJob>);

      const rows: Array<AutoRemediationSuggestion> = [
        suggestion(round, 10, {
          rationaleMarkdown: "x".repeat(1000),
          incidentId: INCIDENT_ID,
          approvedAt: new Date("2026-09-01T00:00:00.000Z"),
        }),
        suggestion(ruleRound, 2, { alertId: ALERT_ID }),
      ];

      suggestionFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["resourceId"]) {
          expect(query["resourceType"]).toBe(kind.resourceType);
          return [rows[0]!];
        }

        const ids: Array<string> = idsIn(query["_id"]);

        return rows.filter((row: AutoRemediationSuggestion) => {
          return ids.includes(row.id!.toString());
        });
      });

      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      const logs: ResourceAiLogs =
        lastResponse() as unknown as ResourceAiLogs;

      expect(
        logs.fixes.map((fix: { id: string }) => {
          return fix.id;
        }),
      ).toEqual([ruleRound.toString(), round.toString()]);
      expect(logs.fixes[0]).toMatchObject({
        status: "Suggested",
        executionMode: "Suggest",
        suggestionType: "Commands",
        rationale: "Restart the web container.",
        alertId: ALERT_ID.toString(),
      });
      expect(logs.fixes[1]!.rationale).toHaveLength(300);
      expect(logs.fixes[1]!.incidentId).toBe(INCIDENT_ID.toString());
      expect(logs.fixes[1]!.approvedAt).toBe("2026-09-01T00:00:00.000Z");

      // Summaries only: no plan, no output.
      const serialized: string = JSON.stringify(logs);
      expect(serialized).not.toContain("commandPlan");
      expect(serialized).not.toContain("output");

      for (const call of suggestionFind.mock.calls) {
        const select: Record<string, unknown> = (
          call[0] as { select: Record<string, unknown> }
        ).select;
        expect(select["commandPlan"]).toBeUndefined();
      }
    });

    test("counts commands of the last 30 days by kind, leaving the connection tests out", async () => {
      countSpy.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return new PositiveNumber(
          query["origin"] === RunnerJobOrigin.AiInvestigation ? 17 : 3,
        );
      });

      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      expect(lastResponse()["commandCounts"]).toEqual({
        investigation: 17,
        remediation: 3,
      });

      const queries: Array<Record<string, unknown>> = countSpy.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { query: Record<string, unknown> }).query;
        },
      );
      const investigation: Record<string, unknown> = queries.find(
        (query: Record<string, unknown>) => {
          return query["origin"] === RunnerJobOrigin.AiInvestigation;
        },
      )!;
      const remediation: Record<string, unknown> = queries.find(
        (query: Record<string, unknown>) => {
          return query["origin"] === RunnerJobOrigin.AiRemediation;
        },
      )!;

      // A connection test is the only resource command without an AI run.
      expect(investigation["aiRunId"]).toBeDefined();
      expect(remediation["aiRunId"]).toBeUndefined();

      for (const query of [investigation, remediation]) {
        expect(query["resourceType"]).toBe(kind.resourceType);
        expect(String(query["resourceId"])).toBe(RESOURCE_ID.toString());
        expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
        expect(query["stepType"]).toBe(RunbookStepType.ResourceCommand);
        expect(query["createdAt"]).toBeDefined();
      }
    });

    test("links incidents and alerts through the resource's relation, in this project", async () => {
      await callRoute(
        RESOURCE_AI_ACCESS_LOGS_PATH,
        body(kind.resourceType),
      );

      for (const spy of [incidentFind, alertFind]) {
        const query: Record<string, unknown> = (
          spy.mock.calls[0]![0] as { query: Record<string, unknown> }
        ).query;
        expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
        expect(
          (query[kind.subjectRelation] as Array<ObjectID>).map(
            (id: ObjectID) => {
              return id.toString();
            },
          ),
        ).toEqual([RESOURCE_ID.toString()]);
      }
    });

    /*
     * ---------------------------------------------------------------------
     * What the logs say about incidents, alerts, AI runs and suggestions
     * follows the caller's own read access to them. The world below is one
     * resource's AI history, served the way the permission layer would serve
     * it: as root everything; under the caller's props a table the caller
     * may not read is refused outright (the table-level check), and only the
     * incidents and suggestions the caller's labels and private-incident
     * membership reach come back.
     * ---------------------------------------------------------------------
     */
    describe("reading what the caller may read", () => {
      const OTHER_INCIDENT_ID: ObjectID = ObjectID.generate();
      const INSIGHT_ID: ObjectID = ObjectID.generate();
      const TRIAGE_RUN: ObjectID = ObjectID.generate();
      const INCIDENT_RUN: ObjectID = ObjectID.generate();
      const OTHER_INCIDENT_RUN: ObjectID = ObjectID.generate();
      const ALERT_RUN: ObjectID = ObjectID.generate();
      const OWN_FIX: ObjectID = ObjectID.generate();
      const RULE_FIX: ObjectID = ObjectID.generate();
      const STAGING_LABEL_ID: ObjectID = ObjectID.generate();

      const INCIDENT_TITLES: Dictionary<{ title: string; number: number }> = {
        [INCIDENT_ID.toString()]: { title: "Web down", number: 42 },
        [OTHER_INCIDENT_ID.toString()]: {
          title: "Payroll database breach",
          number: 7,
        },
      };

      function refuseUnlessTableReadable(
        props: DatabaseCommonInteractionProps,
        modelType: { new (): BaseModel },
      ): void {
        if (props.isRoot || props.isMasterAdmin) {
          return;
        }

        const allowed: Array<Permission> = new modelType().getReadPermissions();
        const rows: Array<UserPermission> =
          props.userTenantAccessPermission?.[PROJECT_ID.toString()]
            ?.permissions || [];

        if (
          !rows.some((row: UserPermission) => {
            return !row.isBlockPermission && allowed.includes(row.permission);
          })
        ) {
          throw new NotAuthorizedException(
            `You do not have permissions to read ${new modelType().singularName}.`,
          );
        }
      }

      function serveHistory(
        reach: {
          incidentIds?: Array<ObjectID> | undefined;
          suggestionIds?: Array<ObjectID> | undefined;
        } = {},
      ): void {
        const reaches: (
          props: DatabaseCommonInteractionProps,
          id: string,
          reachable: Array<ObjectID> | undefined,
        ) => boolean = (
          props: DatabaseCommonInteractionProps,
          id: string,
          reachable: Array<ObjectID> | undefined,
        ): boolean => {
          return (
            Boolean(props.isRoot) ||
            !reachable ||
            reachable.some((reachableId: ObjectID) => {
              return reachableId.toString() === id;
            })
          );
        };

        jobFind.mockResolvedValue([
          { aiRunId: TRIAGE_RUN },
          { autoRemediationSuggestionId: RULE_FIX },
        ] as unknown as Array<RunnerJob>);

        incidentFind.mockImplementation(async (args: unknown) => {
          const { query, props } = args as {
            query: Record<string, unknown>;
            props: DatabaseCommonInteractionProps;
          };
          refuseUnlessTableReadable(props, Incident);

          const ids: Array<string> = query[kind.subjectRelation]
            ? [INCIDENT_ID.toString(), OTHER_INCIDENT_ID.toString()]
            : idsIn(query["_id"]);

          return ids
            .filter((id: string) => {
              return reaches(props, id, reach.incidentIds);
            })
            .map((id: string) => {
              return query[kind.subjectRelation]
                ? { id: new ObjectID(id) }
                : {
                    id: new ObjectID(id),
                    title: INCIDENT_TITLES[id]!.title,
                    incidentNumber: INCIDENT_TITLES[id]!.number,
                  };
            });
        });

        alertFind.mockImplementation(async (args: unknown) => {
          const { query, props } = args as {
            query: Record<string, unknown>;
            props: DatabaseCommonInteractionProps;
          };
          refuseUnlessTableReadable(props, Alert);

          return query[kind.subjectRelation]
            ? [{ id: ALERT_ID }]
            : [{ id: ALERT_ID, title: "High memory" }];
        });

        // AI runs are only ever read as root: they are private to their author.
        runFind.mockImplementation(async (args: unknown) => {
          const { query } = args as { query: Record<string, unknown> };

          if (query["triggeredByIncidentId"]) {
            const ids: Array<string> = idsIn(query["triggeredByIncidentId"]);
            return [
              run(INCIDENT_RUN, 2, { triggeredByIncidentId: INCIDENT_ID }),
              run(OTHER_INCIDENT_RUN, 3, {
                triggeredByIncidentId: OTHER_INCIDENT_ID,
              }),
            ].filter((row: AIRun) => {
              return ids.includes(row.triggeredByIncidentId!.toString());
            });
          }

          if (query["triggeredByAlertId"]) {
            return [run(ALERT_RUN, 4, { triggeredByAlertId: ALERT_ID })];
          }

          // An AI insight's triage ran commands here: no incident, no alert.
          return [run(TRIAGE_RUN, 1, { triggeredByAiInsightId: INSIGHT_ID })];
        });

        const suggestions: Array<AutoRemediationSuggestion> = [
          suggestion(OWN_FIX, 5, {
            rationaleMarkdown: "Restart the web container.",
            incidentId: INCIDENT_ID,
          }),
          suggestion(RULE_FIX, 6, {
            rationaleMarkdown: "Free memory on the host.",
            alertId: ALERT_ID,
          }),
        ];

        // Only the columns asked for come back, as from the database.
        suggestionFind.mockImplementation(async (args: unknown) => {
          const { query, select, props } = args as {
            query: Record<string, unknown>;
            select: Record<string, unknown>;
            props: DatabaseCommonInteractionProps;
          };
          refuseUnlessTableReadable(props, AutoRemediationSuggestion);

          const ids: Array<string> = query["resourceId"]
            ? [OWN_FIX.toString()]
            : idsIn(query["_id"]);

          return suggestions
            .filter((row: AutoRemediationSuggestion) => {
              return (
                ids.includes(row.id!.toString()) &&
                reaches(props, row.id!.toString(), reach.suggestionIds)
              );
            })
            .map((row: AutoRemediationSuggestion) => {
              return select["rationaleMarkdown"]
                ? row
                : ({
                    ...row,
                    rationaleMarkdown: undefined,
                  } as unknown as AutoRemediationSuggestion);
            });
        });
      }

      async function logsFor(
        props: DatabaseCommonInteractionProps,
      ): Promise<ResourceAiLogs> {
        propsSpy.mockResolvedValue(props);

        const result: RouteCallResult = await callRoute(
          RESOURCE_AI_ACCESS_LOGS_PATH,
          body(kind.resourceType),
        );

        expect(result.nextCallCount).toBe(0);
        return lastResponse() as unknown as ResourceAiLogs;
      }

      function investigationIds(logs: ResourceAiLogs): Array<string> {
        return logs.investigations.map((row: { aiRunId: string }) => {
          return row.aiRunId;
        });
      }

      function fixFor(
        logs: ResourceAiLogs,
        id: ObjectID,
      ): ResourceAiLogs["fixes"][number] {
        return logs.fixes.find((fix: { id: string }) => {
          return fix.id === id.toString();
        })!;
      }

      test("a role that may read only the resource gets no incident or alert, no TL;DR and no rationale", async () => {
        serveHistory();

        const logs: ResourceAiLogs = await logsFor(
          userProps({ permissions: [kind.readPermission] }),
        );

        // Only the run with no subject is left, and without its TL;DR.
        expect(investigationIds(logs)).toEqual([TRIAGE_RUN.toString()]);
        expect(logs.investigations[0]!.analysisTldr).toBeUndefined();
        expect(logs.investigations[0]!.incident).toBeUndefined();
        expect(logs.investigations[0]!.alert).toBeUndefined();

        // The fixes on the resource are listed, their rationale is not.
        expect(
          logs.fixes.map((fix: { id: string }) => {
            return fix.id;
          }),
        ).toEqual([OWN_FIX.toString(), RULE_FIX.toString()]);
        expect(fixFor(logs, OWN_FIX).rationale).toBeUndefined();
        expect(fixFor(logs, RULE_FIX).rationale).toBeUndefined();

        const serialized: string = JSON.stringify(logs);
        for (const secret of [
          "Web down",
          "High memory",
          "Payroll database breach",
          "tldr ",
          "Restart the web container.",
          "Free memory on the host.",
        ]) {
          expect(serialized).not.toContain(secret);
        }
        expect(serialized).not.toContain(INCIDENT_RUN.toString());
        expect(serialized).not.toContain(ALERT_RUN.toString());
      });

      test("a caller whose incident read is label-scoped sees only the incidents their labels reach", async () => {
        serveHistory({ incidentIds: [INCIDENT_ID] });

        const logs: ResourceAiLogs = await logsFor(
          userProps({
            permissions: [kind.readPermission, Permission.AlertViewer],
            scoped: [
              {
                permission: Permission.ReadProjectIncident,
                labelIds: [STAGING_LABEL_ID],
              },
            ],
          }),
        );

        expect(investigationIds(logs)).toEqual([
          TRIAGE_RUN.toString(),
          INCIDENT_RUN.toString(),
          ALERT_RUN.toString(),
        ]);
        expect(JSON.stringify(logs)).not.toContain(
          "Payroll database breach",
        );
        expect(JSON.stringify(logs)).not.toContain(
          OTHER_INCIDENT_RUN.toString(),
        );

        /*
         * With a subject the caller may read, the TL;DR is shown — the
         * incident's own AI panel shows them the whole analysis.
         */
        expect(logs.investigations[1]!.incident).toEqual({
          id: INCIDENT_ID.toString(),
          title: "Web down",
          number: 42,
        });
        expect(logs.investigations[1]!.analysisTldr).toBe(
          `tldr ${INCIDENT_RUN.toString()}`,
        );
        expect(logs.investigations[2]!.alert).toEqual({
          id: ALERT_ID.toString(),
          title: "High memory",
        });
        expect(logs.investigations[2]!.analysisTldr).toBe(
          `tldr ${ALERT_RUN.toString()}`,
        );

        // A run with no subject: only for those who may read AIRun.
        expect(logs.investigations[0]!.analysisTldr).toBeUndefined();

        // Suggestions are not theirs to read.
        expect(fixFor(logs, OWN_FIX).rationale).toBeUndefined();
        expect(fixFor(logs, RULE_FIX).rationale).toBeUndefined();
      });

      test("a viewer (incidents, alerts and AI runs, not suggestions) gets every TL;DR but no rationale", async () => {
        serveHistory();

        const logs: ResourceAiLogs = await logsFor(
          userProps({ permissions: [Permission.Viewer] }),
        );

        expect(investigationIds(logs)).toEqual([
          TRIAGE_RUN.toString(),
          INCIDENT_RUN.toString(),
          OTHER_INCIDENT_RUN.toString(),
          ALERT_RUN.toString(),
        ]);
        for (const investigation of logs.investigations) {
          expect(investigation.analysisTldr).toBe(
            `tldr ${investigation.aiRunId}`,
          );
        }
        expect(fixFor(logs, OWN_FIX).rationale).toBeUndefined();
        expect(fixFor(logs, RULE_FIX).rationale).toBeUndefined();
      });

      test("a project member gets everything; a suggestion hidden by its incident's privacy loses only its rationale", async () => {
        serveHistory();

        const all: ResourceAiLogs = await logsFor(
          userProps({ permissions: [Permission.ProjectMember] }),
        );

        expect(investigationIds(all)).toHaveLength(4);
        expect(all.investigations[2]!.incident).toEqual({
          id: OTHER_INCIDENT_ID.toString(),
          title: "Payroll database breach",
          number: 7,
        });
        expect(all.investigations[0]!.analysisTldr).toBe(
          `tldr ${TRIAGE_RUN.toString()}`,
        );
        expect(fixFor(all, OWN_FIX).rationale).toBe(
          "Restart the web container.",
        );
        expect(fixFor(all, RULE_FIX).rationale).toBe(
          "Free memory on the host.",
        );

        jest.clearAllMocks();
        serveHistory({ suggestionIds: [RULE_FIX] });

        const partly: ResourceAiLogs = await logsFor(
          userProps({ permissions: [Permission.ProjectMember] }),
        );

        expect(fixFor(partly, OWN_FIX).rationale).toBeUndefined();
        expect(fixFor(partly, RULE_FIX).rationale).toBe(
          "Free memory on the host.",
        );
      });

      test("a master admin gets everything", async () => {
        serveHistory();

        const logs: ResourceAiLogs = await logsFor(
          userProps({ permissions: [], isMasterAdmin: true }),
        );

        expect(investigationIds(logs)).toHaveLength(4);
        expect(logs.investigations[0]!.analysisTldr).toBe(
          `tldr ${TRIAGE_RUN.toString()}`,
        );
        expect(fixFor(logs, OWN_FIX).rationale).toBe(
          "Restart the web container.",
        );
      });

      test("titles, numbers and rationales are only ever read under the caller's props", async () => {
        serveHistory();

        await logsFor(
          userProps({ permissions: [Permission.ProjectMember] }),
        );

        for (const [spy, columns] of [
          [incidentFind, ["title", "incidentNumber"]],
          [alertFind, ["title"]],
          [suggestionFind, ["rationaleMarkdown"]],
        ] as Array<[jest.SpyInstance, Array<string>]>) {
          const reading: Array<Array<unknown>> = spy.mock.calls.filter(
            (call: Array<unknown>) => {
              const select: Record<string, unknown> = (
                call[0] as { select: Record<string, unknown> }
              ).select;
              return columns.some((column: string) => {
                return Boolean(select[column]);
              });
            },
          );

          expect(reading.length).toBeGreaterThan(0);
          expect(reading.every(isCallerProps)).toBe(true);
        }

        // The runs (private to their author) are read as root.
        expect(runFind).toHaveBeenCalled();
        expect(runFind.mock.calls.every(isRootProps)).toBe(true);
      });
    });
  });

  test("the Kubernetes-only kinds are not served here", () => {
    expect(kindOf(AiResourceType.Host).subjectRelation).toBe("hosts");
    expect(
      (ALL_AI_RESOURCE_TYPES as ReadonlyArray<string>).includes(
        "KubernetesCluster",
      ),
    ).toBe(false);
  });
});
