import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import KubectlJobRunner from "../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
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
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
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
 * The cluster AI page's two custom routes
 * (Common/Server/API/KubernetesClusterAiAccessAPI.ts).
 *
 *   POST /kubernetes-cluster/ai-access/status — the readiness checklist.
 *   POST /kubernetes-cluster/ai-access/test   — `kubectl version` and
 *     `kubectl auth can-i --list` through the bound Runner.
 *
 * Pinned here:
 * - both routes read the cluster under the USER's props, scoped to the
 *   tenant; a cluster id from another project is reported exactly like a
 *   missing one, and nothing past the lookup runs;
 * - /status needs only read access; /test needs edit access to the cluster
 *   (a block row is a denial, not a grant) and says so in its own words;
 * - /test has its own limits — one test at a time per cluster (an atomic
 *   reservation, so concurrent requests cannot all start), a few per minute
 *   and a ceiling per hour per cluster, and a few per minute per user
 *   (counted under a per-user lock) — checked before anything is enqueued;
 * - /status and /test show the credential's name only to a caller who may
 *   read credentials;
 * - an access-test command that times out reads in kubectl's words;
 * - /test enqueues through the kubectl chokepoint AS AN ACCESS TEST, so it
 *   is exempt from the investigation switch and never spends the project's
 *   investigation brake; it keeps going only while commands succeed, and a
 *   gap that blocks the transport stops it before any job exists.
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

const STATUS_ROUTE: string = "/kubernetes-cluster/ai-access/status";
const TEST_ROUTE: string = "/kubernetes-cluster/ai-access/test";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: string = "55555555-5555-4555-8555-555555555555";

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

async function callRoute(
  uri: string,
  body: JSONObject = { clusterId: CLUSTER_ID.toString() },
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body,
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
 * The per-cluster hourly count and the per-minute count differ only in how
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

function lastResponse(): JSONObject {
  const calls: Array<Array<unknown>> = sendJsonObjectResponseMock.mock
    .calls as Array<Array<unknown>>;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![2] as JSONObject;
}

function userProps(data: {
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  userId?: ObjectID | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  const grants: Array<UserPermission> = data.permissions.map(
    (permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
      } as UserPermission;
    },
  );

  const blocks: Array<UserPermission> = (data.blocked || []).map(
    (permission: Permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: true,
      } as UserPermission;
    },
  );

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [...grants, ...blocks],
  };

  return {
    tenantId: PROJECT_ID,
    userId: data.userId === undefined ? USER_ID : data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
}

function readyStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: RUNNER_ID.toString(),
      name: "office-runner",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "credential",
    credentialId: CREDENTIAL_ID,
    credentialName: "prod-us kubeconfig",
    kubectlAllowlist: [],
    isInvestigationEnabled: false,
    isInvestigationReady: false,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    // The switches are off: the test must run anyway.
    gaps: [
      {
        code: "investigation_disabled",
        title: "AI investigation is turned off for this cluster",
        description: "",
        nextStep: "",
        blocks: "investigation",
      },
      {
        code: "remediation_disabled",
        title: "AI remediation is turned off for this cluster",
        description: "",
        nextStep: "",
        blocks: "remediation",
      },
    ],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function gap(
  code: KubernetesAiAccessGap["code"],
  blocks: KubernetesAiAccessGap["blocks"] = "both",
): KubernetesAiAccessGap {
  return {
    code,
    title: `${code} title`,
    description: "",
    nextStep: `${code} next step`,
    blocks,
  };
}

function clusterRow(projectId: ObjectID = PROJECT_ID): KubernetesCluster {
  return {
    id: CLUSTER_ID,
    _id: CLUSTER_ID.toString(),
    projectId,
    name: "prod-us",
  } as unknown as KubernetesCluster;
}

describe("KubernetesClusterAiAccessAPI", () => {
  let propsSpy: jest.SpyInstance;
  let clusterFind: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;
  let enqueueSpy: jest.SpyInstance;
  let pollSpy: jest.SpyInstance;
  let countSpy: jest.SpyInstance;
  let outcomeSpy: jest.SpyInstance;

  // What the access-test counters answer, by which query asks.
  let inFlightTests: number;
  let recentTestsForCluster: number;
  let testsForClusterThisHour: number;
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
  let heldLocks: Map<string, Promise<void>>;

  beforeAll(async () => {
    /*
     * The router registers its routes at module scope, so the import is
     * deferred until the mock router above is fully constructed.
     */
    await import("../../../Server/API/KubernetesClusterAiAccessAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    inFlightTests = 0;
    recentTestsForCluster = 0;
    testsForClusterThisHour = 0;
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
    jest
      .spyOn(Semaphore, "release")
      .mockImplementation(async (mutex: SemaphoreMutex): Promise<void> => {
        (mutex as unknown as { unlock: () => void }).unlock();
      });

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        userProps({ permissions: [Permission.EditKubernetesCluster] }),
      );

    clusterFind = jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue(clusterRow());

    statusSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyStatus());

    let jobCounter: number = 0;
    enqueueSpy = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        jobCounter++;
        return {
          id: new ObjectID(
            `aaaaaaaa-aaaa-4aaa-8aaa-${String(jobCounter).padStart(12, "0")}`,
          ),
          payload: {
            displayCommand: (data as { command: string }).command,
          },
        } as unknown as RunnerJob;
      });

    pollSpy = jest
      .spyOn(RunnerJobService, "pollUntilTerminal")
      .mockResolvedValue({
        status: RunnerJobStatus.Succeeded,
        exitCode: 0,
        output: "Client Version: v1.31.4",
      } as unknown as RunnerJob);

    countSpy = jest
      .spyOn(RunnerJobService, "countBy")
      .mockImplementation(async (args: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["status"]) {
          return new PositiveNumber(inFlightTests);
        }

        if (query["kubernetesClusterId"]) {
          return new PositiveNumber(
            isWithinTheLastHourOnly(query)
              ? testsForClusterThisHour
              : recentTestsForCluster,
          );
        }

        return new PositiveNumber(recentTestsByUser);
      });

    outcomeSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("tenant isolation and the cluster lookup (both routes)", () => {
    function testTenantIsolation(uri: string): void {
      test(`${uri}: reads the cluster under the user's props, scoped to the tenant`, async () => {
        await callRoute(uri);

        const args: {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        } = clusterFind.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          props: DatabaseCommonInteractionProps;
        };

        expect(args.query["_id"]).toBe(CLUSTER_ID.toString());
        expect(args.query["projectId"]!.toString()).toBe(PROJECT_ID.toString());
        expect(args.props.isRoot).toBeFalsy();
        expect(args.props.userId?.toString()).toBe(USER_ID.toString());
        expect(args.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
      });

      test(`${uri}: a cluster id from another project reads exactly like a missing one, and nothing else runs`, async () => {
        // What the tenant-scoped read answers for another project's id.
        clusterFind.mockResolvedValue(null);

        const missing: RouteCallResult = await callRoute(uri);

        expect(missing.thrownToNext).toBeInstanceOf(BadDataException);
        const missingMessage: string = (missing.thrownToNext as Error).message;

        // Belt and braces: a row that somehow came back from elsewhere.
        clusterFind.mockResolvedValue(clusterRow(OTHER_PROJECT_ID));

        const foreign: RouteCallResult = await callRoute(uri);

        expect(foreign.thrownToNext).toBeInstanceOf(BadDataException);
        expect((foreign.thrownToNext as Error).message).toBe(missingMessage);
        expect(missingMessage).toContain("not found");

        expect(statusSpy).not.toHaveBeenCalled();
        expect(countSpy).not.toHaveBeenCalled();
        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
      });

      test(`${uri}: rejects a missing or malformed clusterId before any lookup`, async () => {
        for (const body of [{}, { clusterId: "not-a-uuid" }]) {
          const result: RouteCallResult = await callRoute(
            uri,
            body as JSONObject,
          );
          expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        }

        expect(clusterFind).not.toHaveBeenCalled();
      });

      test(`${uri}: requires a logged-in user`, async () => {
        propsSpy.mockResolvedValue({
          ...userProps({ permissions: [Permission.ProjectOwner] }),
          userId: undefined,
        });

        const result: RouteCallResult = await callRoute(uri);

        expect(result.nextCallCount).toBe(1);
        expect(clusterFind).not.toHaveBeenCalled();
      });
    }

    for (const uri of [STATUS_ROUTE, TEST_ROUTE]) {
      testTenantIsolation(uri);
    }
  });

  describe("POST /kubernetes-cluster/ai-access/status", () => {
    test("returns the status for a user who may only read the cluster", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ReadKubernetesCluster] }),
      );

      const result: RouteCallResult = await callRoute(STATUS_ROUTE);

      expect(result.nextCallCount).toBe(0);
      const call: { clusterId: ObjectID; projectId: ObjectID } = statusSpy.mock
        .calls[0]![0] as { clusterId: ObjectID; projectId: ObjectID };
      expect(call.clusterId.toString()).toBe(CLUSTER_ID.toString());
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(lastResponse()["clusterId"]).toBe(CLUSTER_ID.toString());
      // Reading the status never runs anything.
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /kubernetes-cluster/ai-access/test — who may run it", () => {
    test("refuses a user who may only read the cluster, in the test's own words", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ReadKubernetesCluster] }),
      );

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toContain(
        "permission to edit this Kubernetes cluster to run its AI access test",
      );
      expect(countSpy).not.toHaveBeenCalled();
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    test("a block row is a denial, not a grant", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [Permission.ReadKubernetesCluster],
          blocked: [Permission.EditKubernetesCluster],
        }),
      );

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    test("admits every role that may edit the cluster, and a master admin", async () => {
      for (const props of [
        userProps({ permissions: [Permission.ProjectMember] }),
        userProps({ permissions: [Permission.EditKubernetesCluster] }),
        userProps({ permissions: [], isMasterAdmin: true }),
      ]) {
        jest.clearAllMocks();
        propsSpy.mockResolvedValue(props);

        const result: RouteCallResult = await callRoute(TEST_ROUTE);

        expect(result.nextCallCount).toBe(0);
        expect(enqueueSpy).toHaveBeenCalledTimes(2);
      }
    });
  });

  describe("POST /kubernetes-cluster/ai-access/test — the happy path", () => {
    test("runs both commands through the chokepoint as an access test, through the bound Runner and credential", async () => {
      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.nextCallCount).toBe(0);
      expect(enqueueSpy).toHaveBeenCalledTimes(2);

      const commands: Array<string> = [];

      for (const [index, call] of enqueueSpy.mock.calls.entries()) {
        const data: Record<string, unknown> = call[0] as Record<
          string,
          unknown
        >;

        commands.push(data["command"] as string);
        expect(data["isAccessTest"]).toBe(true);
        expect(data["origin"]).toBe(RunnerJobOrigin.AiInvestigation);
        expect(data["aiRunId"]).toBeUndefined();
        expect(data["projectId"]!.toString()).toBe(PROJECT_ID.toString());
        expect(data["kubernetesClusterId"]!.toString()).toBe(
          CLUSTER_ID.toString(),
        );
        expect(data["targetAgentId"]!.toString()).toBe(RUNNER_ID.toString());
        expect(data["credentialId"]).toBe(CREDENTIAL_ID);
        // Each test's commands name the user who ran it, first command first.
        expect(data["stepId"]).toBe(
          `ai-access-test-${index + 1}-${USER_ID.toString()}`,
        );
      }

      expect(commands).toEqual([
        "kubectl version",
        "kubectl auth can-i --list",
      ]);

      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(true);
      expect((response["results"] as Array<JSONObject>).length).toBe(2);
      expect((response["results"] as Array<JSONObject>)[0]).toMatchObject({
        command: "kubectl version",
        succeeded: true,
        exitCode: 0,
        output: "Client Version: v1.31.4",
      });
      expect(outcomeSpy).toHaveBeenCalledTimes(2);
    });

    test("shapes the output with the shared kubectl redaction before anyone sees it", async () => {
      const redact: jest.SpyInstance = jest.spyOn(
        KubectlJobRunner,
        "redactAndCap",
      );

      await callRoute(TEST_ROUTE);

      expect(redact).toHaveBeenCalledWith("Client Version: v1.31.4");
    });

    test("still runs when only the project AI switch or the LLM provider is missing (neither is transport)", async () => {
      statusSpy.mockResolvedValue(
        readyStatus({
          gaps: [gap("project_ai_disabled"), gap("llm_provider_missing")],
        }),
      );

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).toHaveBeenCalledTimes(2);
      expect(lastResponse()["ok"]).toBe(true);
    });

    test("stops after the first failed command and reports one result", async () => {
      pollSpy.mockResolvedValue({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        output: "",
        errorMessage: "error: You must be logged in to the server",
      } as unknown as RunnerJob);

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(false);
      expect((response["results"] as Array<JSONObject>).length).toBe(1);
      expect((response["results"] as Array<JSONObject>)[0]).toMatchObject({
        succeeded: false,
        exitCode: 1,
      });
      expect(
        String((response["results"] as Array<JSONObject>)[0]!["errorMessage"]),
      ).toContain("logged in");
    });

    test("reports a refusal from the chokepoint as a failed command, and stops", async () => {
      enqueueSpy.mockRejectedValue(
        new BadDataException(
          'Cluster "prod-us" is no longer reached through this Runner.',
        ),
      );

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.nextCallCount).toBe(0);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(false);
      expect(
        String((response["results"] as Array<JSONObject>)[0]!["errorMessage"]),
      ).toContain("no longer reached through this Runner");
    });

    test("does not start when a gap blocks the transport (the Runner is offline)", async () => {
      statusSpy.mockResolvedValue(
        readyStatus({ gaps: [gap("runner_offline")] }),
      );

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).not.toHaveBeenCalled();
      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(false);
      expect(response["message"]).toContain("runner_offline next step");
      expect(response["results"]).toEqual([]);
    });

    test("does not start without a bound Runner", async () => {
      statusSpy.mockResolvedValue(readyStatus({ runner: null, gaps: [] }));

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(lastResponse()["ok"]).toBe(false);
    });
  });

  describe("POST /kubernetes-cluster/ai-access/test — its own limits", () => {
    test("refuses a second test while one is still running for the cluster", async () => {
      inFlightTests = 1;

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect((result.thrownToNext as Error).message).toContain(
        "already running",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(statusSpy).not.toHaveBeenCalled();

      // The in-flight count looks at this cluster's live access-test jobs.
      const query: Record<string, unknown> = (
        countSpy.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]!.toString()).toBe(PROJECT_ID.toString());
      expect(query["kubernetesClusterId"]!.toString()).toBe(
        CLUSTER_ID.toString(),
      );
      expect(query["status"]).toBeDefined();
      expect(query["createdAt"]).toBeDefined();
    });

    test("refuses once the cluster was tested 3 times in the last minute; admits at 2", async () => {
      recentTestsForCluster = 3;

      const refused: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect((refused.thrownToNext as Error).message).toContain(
        "This cluster's AI access was tested 3 times",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();

      jest.clearAllMocks();
      recentTestsForCluster = 2;

      const admitted: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(admitted.nextCallCount).toBe(0);
      expect(enqueueSpy).toHaveBeenCalledTimes(2);
    });

    test("refuses once the user ran 6 tests in the last minute, across clusters; admits at 5", async () => {
      recentTestsByUser = 6;

      const refused: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect((refused.thrownToNext as Error).message).toContain(
        "You ran 6 AI access tests",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();

      // The per-user count is not scoped to one cluster.
      const userQuery: Record<string, unknown> | undefined = countSpy.mock.calls
        .map((call: Array<unknown>) => {
          return (call[0] as { query: Record<string, unknown> }).query;
        })
        .find((query: Record<string, unknown>) => {
          return !query["kubernetesClusterId"];
        });
      expect(userQuery).toBeDefined();
      const stepFilter: { objectLiteralParameters?: Record<string, unknown> } =
        userQuery!["stepId"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
      expect(Object.values(stepFilter.objectLiteralParameters || {})).toEqual([
        `ai-access-test-1-${USER_ID.toString()}%`,
      ]);

      jest.clearAllMocks();
      recentTestsByUser = 5;

      const admitted: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(admitted.nextCallCount).toBe(0);
      expect(enqueueSpy).toHaveBeenCalledTimes(2);
    });

    test("counts tests (their first command), not commands, per cluster", async () => {
      await callRoute(TEST_ROUTE);

      const clusterQuery: Record<string, unknown> | undefined =
        countSpy.mock.calls
          .map((call: Array<unknown>) => {
            return (call[0] as { query: Record<string, unknown> }).query;
          })
          .find((query: Record<string, unknown>) => {
            return query["kubernetesClusterId"] && !query["status"];
          });

      const stepFilter: { objectLiteralParameters?: Record<string, unknown> } =
        clusterQuery!["stepId"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
      expect(Object.values(stepFilter.objectLiteralParameters || {})).toEqual([
        "ai-access-test-1-%",
      ]);
    });

    test("refuses once the cluster was tested 30 times in the last hour; admits at 29", async () => {
      testsForClusterThisHour = 30;

      const refused: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect((refused.thrownToNext as Error).message).toContain(
        "30 times in the last hour",
      );
      expect(enqueueSpy).not.toHaveBeenCalled();

      jest.clearAllMocks();
      testsForClusterThisHour = 29;

      const admitted: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(admitted.nextCallCount).toBe(0);
      expect(enqueueSpy).toHaveBeenCalledTimes(2);
    });

    /*
     * Access-test jobs have no AI run, so the project's investigation brake
     * (which counts rows WITH one) never sees them — the hourly ceiling
     * above is theirs.
     */
    test("the chokepoint is told it is an access test, so it stays out of the investigation brake", async () => {
      await callRoute(TEST_ROUTE);

      for (const call of enqueueSpy.mock.calls) {
        expect((call[0] as Record<string, unknown>)["isAccessTest"]).toBe(true);
        expect((call[0] as Record<string, unknown>)["aiRunId"]).toBeUndefined();
      }
    });
  });

  /*
   * SIA-5: the limits used to be count-then-enqueue with nothing reserved,
   * so concurrent requests all read "nothing running" and all started.
   */
  describe("POST /kubernetes-cluster/ai-access/test — the limits are atomic", () => {
    function deferred(): {
      promise: Promise<RunnerJob>;
      resolve: (job: RunnerJob) => void;
    } {
      let resolve: (job: RunnerJob) => void = (): void => {
        return undefined;
      };
      const promise: Promise<RunnerJob> = new Promise<RunnerJob>(
        (done: (job: RunnerJob) => void) => {
          resolve = done;
        },
      );
      return { promise, resolve };
    }

    const SUCCEEDED: RunnerJob = {
      status: RunnerJobStatus.Succeeded,
      exitCode: 0,
      output: "ok",
    } as unknown as RunnerJob;

    test("two tests started together for one cluster: exactly one runs, the other is told one is running", async () => {
      const held: {
        promise: Promise<RunnerJob>;
        resolve: (job: RunnerJob) => void;
      } = deferred();
      pollSpy.mockReturnValue(held.promise);

      const first: Promise<RouteCallResult> = callRoute(TEST_ROUTE);
      const second: Promise<RouteCallResult> = callRoute(TEST_ROUTE);

      const secondResult: RouteCallResult = await second;
      expect(secondResult.thrownToNext).toBeInstanceOf(
        TooManyRequestsException,
      );
      expect((secondResult.thrownToNext as Error).message).toContain(
        "already running",
      );

      held.resolve(SUCCEEDED);
      pollSpy.mockResolvedValue(SUCCEEDED);
      const firstResult: RouteCallResult = await first;

      expect(firstResult.nextCallCount).toBe(0);
      // Both of the ONE test's commands, and nothing from the other.
      expect(enqueueSpy).toHaveBeenCalledTimes(2);
    });

    /*
     * Negative control: with a reservation that always succeeds (what
     * round one had — no reservation at all), the same two requests both
     * start, because the row counts read zero for both. This is what the
     * test above guards against.
     */
    test("negative control: without the reservation both would run", async () => {
      reserveSpy.mockResolvedValue(true);
      const held: {
        promise: Promise<RunnerJob>;
        resolve: (job: RunnerJob) => void;
      } = deferred();
      pollSpy.mockReturnValue(held.promise);

      const first: Promise<RouteCallResult> = callRoute(TEST_ROUTE);
      const second: Promise<RouteCallResult> = callRoute(TEST_ROUTE);

      // Let both reach their first command.
      for (let i: number = 0; i < 50 && enqueueSpy.mock.calls.length < 2; i++) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      held.resolve(SUCCEEDED);
      pollSpy.mockResolvedValue(SUCCEEDED);
      await Promise.all([first, second]);

      expect(enqueueSpy.mock.calls.length).toBeGreaterThan(2);
    });

    test("releases the reservation when the test ends, so the next one is admitted", async () => {
      await callRoute(TEST_ROUTE);

      expect(reserveSpy).toHaveBeenCalledTimes(1);
      const [namespace, key, token] = reserveSpy.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(key).toBe(CLUSTER_ID.toString());
      expect(releaseSpy).toHaveBeenCalledWith(namespace, key, token);
      expect(cacheKeys.size).toBe(0);

      const again: RouteCallResult = await callRoute(TEST_ROUTE);
      expect(again.nextCallCount).toBe(0);
    });

    test("releases it after a failed command, a refused limit and a transport gap too", async () => {
      pollSpy.mockResolvedValue({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "error: You must be logged in to the server",
      } as unknown as RunnerJob);
      await callRoute(TEST_ROUTE);
      expect(cacheKeys.size).toBe(0);

      recentTestsForCluster = 3;
      const refused: RouteCallResult = await callRoute(TEST_ROUTE);
      expect(refused.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect(cacheKeys.size).toBe(0);

      recentTestsForCluster = 0;
      statusSpy.mockResolvedValue(
        readyStatus({ gaps: [gap("runner_offline")] }),
      );
      await callRoute(TEST_ROUTE);
      expect(cacheKeys.size).toBe(0);
    });

    test("a reservation that cannot be checked fails closed, and nothing is enqueued", async () => {
      reserveSpy.mockRejectedValue(new Error("Cache is not connected"));

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(ServiceUnavailableException);
      expect(countSpy).not.toHaveBeenCalled();
      expect(enqueueSpy).not.toHaveBeenCalled();
    });

    test("a held reservation refuses the test before anything is counted", async () => {
      cacheKeys.set(
        `kubernetes-ai-access-test-${CLUSTER_ID.toString()}`,
        "someone-else",
      );

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect(countSpy).not.toHaveBeenCalled();
      // Never releases someone else's reservation.
      expect(cacheKeys.size).toBe(1);
    });

    /*
     * The per-user limit spans clusters, so the cluster reservation does
     * not serialize it: the user's count is read and the first job created
     * under a per-user lock.
     */
    function userAtFiveOfSixOnTwoClusters(): ObjectID {
      const OTHER_CLUSTER: ObjectID = new ObjectID(
        "66666666-6666-4666-8666-666666666666",
      );
      clusterFind.mockImplementation(
        async (args: unknown): Promise<KubernetesCluster> => {
          const id: string = String(
            (args as { query: Record<string, unknown> }).query["_id"],
          );
          return {
            id: new ObjectID(id),
            _id: id,
            projectId: PROJECT_ID,
            name: id,
          } as unknown as KubernetesCluster;
        },
      );

      // The user's count: 5 before, plus every first command created since.
      countSpy.mockImplementation(
        async (args: unknown): Promise<PositiveNumber> => {
          const query: Record<string, unknown> = (
            args as { query: Record<string, unknown> }
          ).query;
          if (query["kubernetesClusterId"] || query["status"]) {
            return new PositiveNumber(0);
          }
          const firstCommands: number = enqueueSpy.mock.calls.filter(
            (call: Array<unknown>) => {
              return String(
                (call[0] as Record<string, unknown>)["stepId"],
              ).startsWith("ai-access-test-1-");
            },
          ).length;
          return new PositiveNumber(5 + firstCommands);
        },
      );

      return OTHER_CLUSTER;
    }

    test("a user at 5 of 6 starting tests on two clusters at once gets exactly one", async () => {
      const OTHER_CLUSTER: ObjectID = userAtFiveOfSixOnTwoClusters();

      const results: Array<RouteCallResult> = await Promise.all([
        callRoute(TEST_ROUTE, { clusterId: CLUSTER_ID.toString() }),
        callRoute(TEST_ROUTE, { clusterId: OTHER_CLUSTER.toString() }),
      ]);

      const refused: Array<RouteCallResult> = results.filter(
        (result: RouteCallResult) => {
          return result.thrownToNext instanceof TooManyRequestsException;
        },
      );
      expect(refused).toHaveLength(1);
      expect((refused[0]!.thrownToNext as Error).message).toContain(
        "You ran 6 AI access tests",
      );
      expect(
        lockSpy.mock.calls.every((call: Array<unknown>) => {
          return (call[0] as { key: string }).key === USER_ID.toString();
        }),
      ).toBe(true);
    });

    // Negative control: without the per-user lock both read 5 and both run.
    test("negative control: without the per-user lock both would start", async () => {
      const OTHER_CLUSTER: ObjectID = userAtFiveOfSixOnTwoClusters();
      lockSpy.mockResolvedValue({
        unlock: (): void => {
          return undefined;
        },
      } as unknown as SemaphoreMutex);

      const results: Array<RouteCallResult> = await Promise.all([
        callRoute(TEST_ROUTE, { clusterId: CLUSTER_ID.toString() }),
        callRoute(TEST_ROUTE, { clusterId: OTHER_CLUSTER.toString() }),
      ]);

      expect(
        results.filter((result: RouteCallResult) => {
          return result.thrownToNext instanceof TooManyRequestsException;
        }),
      ).toHaveLength(0);
    });

    test("a user lock that cannot be had refuses with 429, and nothing is enqueued", async () => {
      lockSpy.mockRejectedValue(new Error("lock timeout"));

      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(TooManyRequestsException);
      expect(enqueueSpy).not.toHaveBeenCalled();
      // And the cluster's reservation was released on the way out.
      expect(cacheKeys.size).toBe(0);
    });
  });

  /*
   * IP-3: an access-test command that nobody picked up used to read "No
   * runbook agent picked up this step … then try again" — in the results
   * and as the cluster's Last error. The row itself now carries kubectl's
   * words (RunnerJobService.pollUntilTerminal), so every reader agrees.
   */
  describe("POST /kubernetes-cluster/ai-access/test — timeouts read in kubectl's words", () => {
    test("an unclaimed first command says nothing was run, in the results and the recorded error", async () => {
      pollSpy.mockRestore();
      jest.spyOn(RunnerJobService, "findOneById").mockResolvedValue({
        status: RunnerJobStatus.Pending,
        origin: RunnerJobOrigin.AiInvestigation,
        stepType: "Kubectl",
        claimDeadlineAt: new Date(Date.now() - 1000),
      } as unknown as RunnerJob);
      const timeoutSpy: jest.SpyInstance = jest
        .spyOn(RunnerJobService, "timeoutJob")
        .mockImplementation(
          async (data: { reason: string }): Promise<RunnerJob> => {
            return {
              status: RunnerJobStatus.TimedOut,
              errorMessage: data.reason,
            } as unknown as RunnerJob;
          },
        );

      await callRoute(TEST_ROUTE);

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      const result: JSONObject = (
        lastResponse()["results"] as Array<JSONObject>
      )[0]!;
      expect(result["succeeded"]).toBe(false);
      expect(String(result["errorMessage"])).toContain("Nothing was run");
      expect(String(result["errorMessage"])).toMatch(/kubectl/);
      expect(String(result["errorMessage"])).not.toMatch(/runbook/i);
      expect(String(result["errorMessage"])).not.toMatch(/\bstep\b/i);

      const recorded: { errorMessage?: string } = outcomeSpy.mock
        .calls[0]![0] as { errorMessage?: string };
      expect(recorded.errorMessage).toBe(result["errorMessage"]);
    });

    test("negative control: a command that ran and failed keeps kubectl's own error", async () => {
      pollSpy.mockResolvedValue({
        status: RunnerJobStatus.Failed,
        exitCode: 1,
        errorMessage: "error: You must be logged in to the server",
      } as unknown as RunnerJob);

      await callRoute(TEST_ROUTE);

      const result: JSONObject = (
        lastResponse()["results"] as Array<JSONObject>
      )[0]!;
      expect(result["errorMessage"]).toBe(
        "error: You must be logged in to the server",
      );
    });
  });

  /*
   * The cluster's AI page shows the credential's NAME only to someone who
   * may read credentials — the rule its credential picker and the
   * investigation panel apply. Reading the cluster is not enough.
   */
  describe("the credential is shown only to callers who may read credentials", () => {
    const CREDENTIAL_GAP: KubernetesAiAccessGap = {
      code: "credential_missing",
      title: "The Kubernetes credential is not usable by the Runner",
      description:
        '"prod-us kubeconfig" is not assigned to Runner "office-runner".',
      nextStep: "Assign it.",
      blocks: "both",
    };

    test("/status withholds the credential's id and name, and the gap text that names it", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ReadKubernetesCluster] }),
      );
      statusSpy.mockResolvedValue(readyStatus({ gaps: [CREDENTIAL_GAP] }));

      await callRoute(STATUS_ROUTE);

      const response: JSONObject = lastResponse();
      expect(response).not.toHaveProperty("credentialId");
      expect(response).not.toHaveProperty("credentialName");
      expect(JSON.stringify(response)).not.toContain("prod-us kubeconfig");
      const gaps: Array<JSONObject> = response["gaps"] as Array<JSONObject>;
      expect(gaps[0]!["description"]).toContain(
        "Someone who can view Runner credentials",
      );
      // Everything else a cluster reader may see is still there.
      expect(response["accessMethod"]).toBe("credential");
      expect(response["clusterId"]).toBe(CLUSTER_ID.toString());
    });

    test("a block row for credential read is a denial even with a grant", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [
            Permission.ReadKubernetesCluster,
            Permission.ReadRunbookCredential,
          ],
          blocked: [Permission.ReadRunbookCredential],
        }),
      );

      await callRoute(STATUS_ROUTE);

      expect(lastResponse()).not.toHaveProperty("credentialName");
    });

    test("negative control: a caller who may read credentials sees them", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [
            Permission.ReadKubernetesCluster,
            Permission.ReadRunbookCredential,
          ],
        }),
      );
      statusSpy.mockResolvedValue(readyStatus({ gaps: [CREDENTIAL_GAP] }));

      await callRoute(STATUS_ROUTE);

      const response: JSONObject = lastResponse();
      expect(response["credentialId"]).toBe(CREDENTIAL_ID);
      expect(response["credentialName"]).toBe("prod-us kubeconfig");
      expect(
        (response["gaps"] as Array<JSONObject>)[0]!["description"],
      ).toContain("prod-us kubeconfig");
    });

    test("/test withholds them from its status too, yet still runs through the bound credential", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.EditKubernetesCluster] }),
      );

      await callRoute(TEST_ROUTE);

      expect(
        (enqueueSpy.mock.calls[0]![0] as Record<string, unknown>)[
          "credentialId"
        ],
      ).toBe(CREDENTIAL_ID);
      const status: JSONObject = lastResponse()["status"] as JSONObject;
      expect(status).not.toHaveProperty("credentialName");
      expect(status).not.toHaveProperty("credentialId");
    });
  });
});
