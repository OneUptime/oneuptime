import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Server/Services/IncidentService";
import KubernetesAiAgentService from "../../../Server/Services/KubernetesAiAgentService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import RunnerJobService from "../../../Server/Services/RunnerJobService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import KubernetesAiAgent from "../../../Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import {
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  KUBERNETES_CLUSTER_AI_INSIGHTS_LIMIT,
  KubernetesClusterAiInsights,
} from "../../../Types/Kubernetes/KubernetesClusterAiInsights";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
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
 * The cluster AI routes the Kubernetes AI agent brought
 * (Common/Server/API/KubernetesClusterAiAccessAPI.ts):
 *
 * - /test targets the cluster's RESOLVED access target — the agent's row id
 *   with no credential when the agent is the target — and a gap about the
 *   project's AI (credits included) never stops it; the agent's own
 *   connection gaps do;
 * - /reset-agent is for the people who may loosen AI access
 *   (KUBERNETES_AI_ACCESS_ADMIN_PERMISSIONS, or a master admin), after the
 *   same cluster read gate as the status, and calls
 *   KubernetesAiAgentService.resetAgent for THIS cluster;
 * - /insights has the status's read gate, reads everything else as root,
 *   and returns summaries only: investigations (runs that ran kubectl on
 *   the cluster UNION runs of incidents and alerts linked to it), fixes
 *   (the cluster's own rounds UNION suggestions whose kubectl ran on it),
 *   and command counts that leave the connection tests out.
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
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

const mockRouter: Record<string, jest.Mock> = {};

for (const method of ["get", "post", "put", "delete"]) {
  mockRouter[method] = jest
    .fn()
    .mockImplementation(
      (uri: string, _middleware: RouterFunction, handler: RouterFunction) => {
        mockRoutes.push({
          method: method.toUpperCase(),
          uri,
          handlerFunction: handler,
        });
      },
    );
}

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, jest.Mock> => {
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

const TEST_ROUTE: string = "/kubernetes-cluster/ai-access/test";
const RESET_ROUTE: string = "/kubernetes-cluster/ai-access/reset-agent";
const INSIGHTS_ROUTE: string = "/kubernetes-cluster/ai-access/insights";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const AGENT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

type RouteCallResult = {
  thrownToNext: unknown;
};

async function callRoute(
  uri: string,
  body: JSONObject = { clusterId: CLUSTER_ID.toString() },
): Promise<RouteCallResult> {
  const route: MockRoute | undefined = mockRoutes.find((candidate: MockRoute) => {
    return candidate.method === "POST" && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    { params: {}, query: {}, body, headers: {} } as unknown as ExpressRequest,
    {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined };
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
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
}

function agentStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: AGENT_ID.toString(),
      name: "Kubernetes AI agent",
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
    },
    accessMethod: "in_cluster",
    aiAgent: {
      id: AGENT_ID.toString(),
      isOnline: true,
      connectionStatus: "connected",
    },
    automaticInvestigation: { incidents: true, alerts: true },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.Disabled,
    isRemediationReady: false,
    gaps: [],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function gap(code: KubernetesAiAccessGap["code"]): KubernetesAiAccessGap {
  return {
    code,
    title: `${code} title`,
    description: "",
    nextStep: `${code} next step`,
    blocks: "both",
  };
}

describe("KubernetesClusterAiAccessAPI and the Kubernetes AI agent", () => {
  let propsSpy: jest.SpyInstance;
  let clusterFind: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;
  let enqueueSpy: jest.SpyInstance;

  beforeAll(async () => {
    await import("../../../Server/API/KubernetesClusterAiAccessAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockResolvedValue(true);
    jest.spyOn(GlobalCache, "deleteKeyIfValue").mockResolvedValue(true);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    propsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        userProps({ permissions: [Permission.EditKubernetesCluster] }),
      );
    clusterFind = jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockResolvedValue({
        id: CLUSTER_ID,
        _id: CLUSTER_ID.toString(),
        projectId: PROJECT_ID,
        name: "prod-us",
      } as unknown as KubernetesCluster);
    statusSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(agentStatus());
    enqueueSpy = jest
      .spyOn(RunnerJobService, "enqueueAiKubectlCommand")
      .mockImplementation(async (data: unknown): Promise<RunnerJob> => {
        return {
          id: ObjectID.generate(),
          targetKubernetesAiAgentId: AGENT_ID,
          payload: { displayCommand: (data as { command: string }).command },
        } as unknown as RunnerJob;
      });
    jest.spyOn(RunnerJobService, "pollUntilTerminal").mockResolvedValue({
      status: RunnerJobStatus.Succeeded,
      exitCode: 0,
      output: "Client Version: v1.36.4",
    } as unknown as RunnerJob);
    jest
      .spyOn(RunnerJobService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterAiAccessService, "recordCommandOutcome")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /kubernetes-cluster/ai-access/test through the agent", () => {
    test("targets the agent's row id with no credential, and says so", async () => {
      const result: RouteCallResult = await callRoute(TEST_ROUTE);

      expect(result.thrownToNext).toBeUndefined();
      expect(enqueueSpy).toHaveBeenCalledTimes(2);

      for (const call of enqueueSpy.mock.calls) {
        const data: Record<string, unknown> = call[0] as Record<
          string,
          unknown
        >;
        expect(String(data["targetAgentId"])).toBe(AGENT_ID.toString());
        expect(data["credentialId"]).toBeUndefined();
        expect(data["isAccessTest"]).toBe(true);
      }

      expect(lastResponse()["ok"]).toBe(true);
      expect(lastResponse()["message"]).toBe(
        'OneUptime AI can run kubectl on "prod-us" through the Kubernetes AI agent.',
      );
    });

    test("still names the Runner when a Runner is the target", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: ObjectID.generate().toString(),
            name: "kubernetes-agent/prod-us",
            isOnline: true,
            canRunAiCommands: true,
          },
        }),
      );

      await callRoute(TEST_ROUTE);

      expect(lastResponse()["message"]).toBe(
        'OneUptime AI can run kubectl on "prod-us" through Runner "kubernetes-agent/prod-us".',
      );
    });

    test.each([
      ["ai_agent_offline" as const],
      ["ai_agent_not_connected" as const],
      ["runner_offline" as const],
    ])(
      "stops before anything is enqueued on %s",
      async (code: KubernetesAiAccessGap["code"]) => {
        statusSpy.mockResolvedValue(agentStatus({ gaps: [gap(code)] }));

        await callRoute(TEST_ROUTE);

        expect(enqueueSpy).not.toHaveBeenCalled();
        expect(lastResponse()["ok"]).toBe(false);
        expect(lastResponse()["message"]).toBe(
          `${code} title. ${code} next step`,
        );
      },
    );

    test("runs despite the project being out of AI credits: the test runs kubectl, not a model", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({
          gaps: [
            gap("ai_balance_insufficient"),
            gap("project_ai_disabled"),
            gap("llm_provider_missing"),
          ],
        }),
      );

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).toHaveBeenCalledTimes(2);
      expect(lastResponse()["ok"]).toBe(true);
    });

    test("with nothing to reach the cluster through it says to install the agent", async () => {
      statusSpy.mockResolvedValue(agentStatus({ runner: null, gaps: [] }));

      await callRoute(TEST_ROUTE);

      expect(enqueueSpy).not.toHaveBeenCalled();
      expect(lastResponse()["message"]).toBe(
        "Nothing can reach this cluster yet: install the Kubernetes AI agent.",
      );
    });
  });

  describe("POST /kubernetes-cluster/ai-access/reset-agent", () => {
    let resetSpy: jest.SpyInstance;
    let agentLookup: jest.SpyInstance;

    beforeEach(() => {
      resetSpy = jest
        .spyOn(KubernetesAiAgentService, "resetAgent")
        .mockResolvedValue(undefined);
      agentLookup = jest
        .spyOn(KubernetesAiAgentService, "findForCluster")
        .mockResolvedValue({ id: AGENT_ID } as unknown as KubernetesAiAgent);
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ])("resets this cluster's agent for %s", async (role: Permission) => {
      propsSpy.mockResolvedValue(userProps({ permissions: [role] }));

      const result: RouteCallResult = await callRoute(RESET_ROUTE);

      expect(result.thrownToNext).toBeUndefined();
      expect(resetSpy).toHaveBeenCalledTimes(1);
      const call: Record<string, unknown> = resetSpy.mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(String(call["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(call["kubernetesClusterId"])).toBe(CLUSTER_ID.toString());
      expect(String(call["userId"])).toBe(USER_ID.toString());
      expect(agentLookup).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        kubernetesClusterId: CLUSTER_ID,
      });

      const response: JSONObject = lastResponse();
      expect(response["ok"]).toBe(true);
      expect(response["message"]).toBe(
        "The Kubernetes AI agent was reset. It reconnects on its own within a few minutes.",
      );
      expect(response["status"]).toBeDefined();
    });

    test("lets a master admin reset without any project permission", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [], isMasterAdmin: true }),
      );

      await callRoute(RESET_ROUTE);

      expect(resetSpy).toHaveBeenCalledTimes(1);
    });

    test.each([
      Permission.EditKubernetesCluster,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.ReadKubernetesCluster,
    ])(
      "refuses %s: editing the cluster is not enough",
      async (role: Permission) => {
        propsSpy.mockResolvedValue(userProps({ permissions: [role] }));

        const result: RouteCallResult = await callRoute(RESET_ROUTE);

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          "You need one of these permissions to reset this cluster's Kubernetes AI agent: Project Owner, Project Admin, Edit Auto Remediation Rule.",
        );
        expect(resetSpy).not.toHaveBeenCalled();
      },
    );

    test("does not read a block row as a grant", async () => {
      propsSpy.mockResolvedValue(
        userProps({
          permissions: [Permission.EditKubernetesCluster],
          blocked: [Permission.ProjectAdmin],
        }),
      );

      const result: RouteCallResult = await callRoute(RESET_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(resetSpy).not.toHaveBeenCalled();
    });

    test("checks the cluster first, under the user's own props, scoped to the tenant", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );
      clusterFind.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(RESET_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(resetSpy).not.toHaveBeenCalled();
      const query: Record<string, unknown> = (
        clusterFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query["projectId"]).toBe(PROJECT_ID);
    });

    test("says so when the cluster has no agent to reset", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );
      agentLookup.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute(RESET_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as Error).message).toBe(
        "This cluster has no Kubernetes AI agent to reset.",
      );
      expect(resetSpy).not.toHaveBeenCalled();
    });

    test("refuses a missing or malformed clusterId", async () => {
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ProjectAdmin] }),
      );

      const result: RouteCallResult = await callRoute(RESET_ROUTE, {
        clusterId: "not-an-id",
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /kubernetes-cluster/ai-access/insights", () => {
    const INCIDENT_ID: ObjectID = ObjectID.generate();
    const ALERT_ID: ObjectID = ObjectID.generate();

    let jobFind: jest.SpyInstance;
    let incidentFind: jest.SpyInstance;
    let alertFind: jest.SpyInstance;
    let runFind: jest.SpyInstance;
    let suggestionFind: jest.SpyInstance;
    let jobCount: jest.SpyInstance;

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
        rationaleMarkdown: "Restart the web deployment.",
        createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
        ...overrides,
      } as unknown as AutoRemediationSuggestion;
    }

    beforeEach(() => {
      jobFind = jest.spyOn(RunnerJobService, "findBy").mockResolvedValue([]);
      incidentFind = jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
      alertFind = jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
      runFind = jest.spyOn(AIRunService, "findBy").mockResolvedValue([]);
      suggestionFind = jest
        .spyOn(AutoRemediationSuggestionService, "findBy")
        .mockResolvedValue([]);
      jobCount = (
        RunnerJobService.countBy as unknown as jest.SpyInstance
      ).mockResolvedValue(new PositiveNumber(0));
      propsSpy.mockResolvedValue(
        userProps({ permissions: [Permission.ReadKubernetesCluster] }),
      );
    });

    test("needs only read access to the cluster, and refuses one the user cannot read", async () => {
      const ok: RouteCallResult = await callRoute(INSIGHTS_ROUTE);
      expect(ok.thrownToNext).toBeUndefined();

      clusterFind.mockResolvedValue(null);
      const refused: RouteCallResult = await callRoute(INSIGHTS_ROUTE);
      expect(refused.thrownToNext).toBeInstanceOf(BadDataException);
      expect((refused.thrownToNext as Error).message).toBe(
        "Kubernetes cluster not found (or you do not have access to it).",
      );
    });

    test("reads the cluster under the USER's props, and everything else as root", async () => {
      await callRoute(INSIGHTS_ROUTE);

      const clusterProps: DatabaseCommonInteractionProps = (
        clusterFind.mock.calls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        }
      ).props;
      expect(clusterProps.isRoot).toBeUndefined();

      for (const spy of [jobFind, incidentFind, alertFind, suggestionFind]) {
        for (const call of spy.mock.calls) {
          expect(
            (call[0] as { props: DatabaseCommonInteractionProps }).props,
          ).toEqual({ isRoot: true });
        }
      }
    });

    test("an empty cluster: empty lists and zero counts, and no AI run read", async () => {
      await callRoute(INSIGHTS_ROUTE);

      expect(lastResponse()).toEqual({
        clusterId: CLUSTER_ID.toString(),
        investigations: [],
        fixes: [],
        commandCounts: { investigation: 0, remediation: 0 },
      });
      expect(runFind).not.toHaveBeenCalled();
    });

    test("investigations: runs that ran kubectl here UNION runs of linked incidents and alerts, deduplicated, newest first", async () => {
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
        return query["kubernetesClusters"]
          ? [{ id: INCIDENT_ID }]
          : [{ id: INCIDENT_ID, title: "DB down", incidentNumber: 42 }];
      });
      alertFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return query["kubernetesClusters"]
          ? [{ id: ALERT_ID }]
          : [{ id: ALERT_ID, title: "High latency" }];
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

      await callRoute(INSIGHTS_ROUTE);

      const insights: KubernetesClusterAiInsights =
        lastResponse() as unknown as KubernetesClusterAiInsights;

      expect(
        insights.investigations.map((row: { aiRunId: string }) => {
          return row.aiRunId;
        }),
      ).toEqual([
        fromAlert.toString(),
        fromIncident.toString(),
        fromBoth.toString(),
        fromJobs.toString(),
      ]);
      expect(insights.investigations[0]!.alert).toEqual({
        id: ALERT_ID.toString(),
        title: "High latency",
      });
      expect(insights.investigations[1]!.incident).toEqual({
        id: INCIDENT_ID.toString(),
        title: "DB down",
        number: 42,
      });
      expect(insights.investigations[3]!.analysisTldr).toBe(
        `tldr ${fromJobs.toString()}`,
      );

      // Only investigations, and only this project's.
      for (const call of runFind.mock.calls) {
        const query: Record<string, unknown> = (
          call[0] as { query: Record<string, unknown> }
        ).query;
        expect(query["runType"]).toBe(AIRunType.Investigation);
        expect(query["projectId"]).toBe(PROJECT_ID);
      }

      // The kubectl jobs read are this cluster's kubectl jobs.
      const jobQuery: Record<string, unknown> = (
        jobFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(jobQuery["kubernetesClusterId"]).toEqual(CLUSTER_ID);
      expect(jobQuery["stepType"]).toBe(RunbookStepType.Kubectl);
      expect(jobQuery["projectId"]).toBe(PROJECT_ID);
    });

    test(`returns at most ${KUBERNETES_CLUSTER_AI_INSIGHTS_LIMIT} investigations and fixes`, async () => {
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

      await callRoute(INSIGHTS_ROUTE);

      const insights: KubernetesClusterAiInsights =
        lastResponse() as unknown as KubernetesClusterAiInsights;
      expect(insights.investigations).toHaveLength(
        KUBERNETES_CLUSTER_AI_INSIGHTS_LIMIT,
      );
      expect(insights.fixes).toHaveLength(KUBERNETES_CLUSTER_AI_INSIGHTS_LIMIT);
      // Newest first.
      expect(insights.investigations[0]!.aiRunId).toBe(ids[0]!.toString());
    });

    test("fixes: the cluster's own rounds UNION suggestions whose kubectl ran here, summarised", async () => {
      const round: ObjectID = ObjectID.generate();
      const ruleRound: ObjectID = ObjectID.generate();

      jobFind.mockResolvedValue([
        { autoRemediationSuggestionId: ruleRound },
      ] as unknown as Array<RunnerJob>);
      suggestionFind.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        if (query["kubernetesClusterId"]) {
          return [
            suggestion(round, 10, {
              rationaleMarkdown: "x".repeat(1000),
              incidentId: INCIDENT_ID,
              approvedAt: new Date("2026-09-01T00:00:00.000Z"),
            }),
          ];
        }

        return [suggestion(ruleRound, 2, { alertId: ALERT_ID })];
      });

      await callRoute(INSIGHTS_ROUTE);

      const insights: KubernetesClusterAiInsights =
        lastResponse() as unknown as KubernetesClusterAiInsights;

      expect(
        insights.fixes.map((fix: { id: string }) => {
          return fix.id;
        }),
      ).toEqual([ruleRound.toString(), round.toString()]);
      expect(insights.fixes[0]).toMatchObject({
        status: "Suggested",
        executionMode: "Suggest",
        suggestionType: "Commands",
        rationale: "Restart the web deployment.",
        alertId: ALERT_ID.toString(),
      });
      expect(insights.fixes[1]!.rationale).toHaveLength(300);
      expect(insights.fixes[1]!.incidentId).toBe(INCIDENT_ID.toString());
      expect(insights.fixes[1]!.approvedAt).toBe("2026-09-01T00:00:00.000Z");

      // Summaries only: no plan, no output.
      const serialized: string = JSON.stringify(insights);
      expect(serialized).not.toContain("commandPlan");
      expect(serialized).not.toContain("output");
    });

    test("counts kubectl commands of the last 30 days by kind, leaving the connection tests out", async () => {
      jobCount.mockImplementation(async (args: unknown) => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;
        return new PositiveNumber(
          query["origin"] === RunnerJobOrigin.AiInvestigation ? 17 : 3,
        );
      });

      await callRoute(INSIGHTS_ROUTE);

      expect(lastResponse()["commandCounts"]).toEqual({
        investigation: 17,
        remediation: 3,
      });

      const queries: Array<Record<string, unknown>> = jobCount.mock.calls.map(
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

      // A connection test is the only kubectl job without an AI run.
      expect(investigation["aiRunId"]).toBeDefined();
      expect(remediation["aiRunId"]).toBeUndefined();

      for (const query of [investigation, remediation]) {
        expect(query["kubernetesClusterId"]).toEqual(CLUSTER_ID);
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(query["stepType"]).toBe(RunbookStepType.Kubectl);
        expect(query["createdAt"]).toBeDefined();
      }
    });

    test("links incidents and alerts through their cluster relation, in this project", async () => {
      await callRoute(INSIGHTS_ROUTE);

      for (const spy of [incidentFind, alertFind]) {
        const query: Record<string, unknown> = (
          spy.mock.calls[0]![0] as { query: Record<string, unknown> }
        ).query;
        expect(query["projectId"]).toBe(PROJECT_ID);
        expect(
          (query["kubernetesClusters"] as Array<ObjectID>).map(
            (id: ObjectID) => {
              return id.toString();
            },
          ),
        ).toEqual([CLUSTER_ID.toString()]);
      }
    });
  });
});
