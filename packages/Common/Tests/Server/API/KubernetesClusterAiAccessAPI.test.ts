import CommonAPI from "../../../Server/API/CommonAPI";
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
 * - /test has its own limits — one test at a time per cluster, a few per
 *   minute per cluster and per user — checked before anything is enqueued;
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

  // What the three access-test counters answer, by which query asks.
  let inFlightTests: number;
  let recentTestsForCluster: number;
  let recentTestsByUser: number;

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
    recentTestsByUser = 0;

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
          return new PositiveNumber(recentTestsForCluster);
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
  });
});
