import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import RunnerService from "../../../Server/Services/RunnerService";
import CommandPlanExecutor from "../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
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
 * Enable AI as the one project gate on POST /auto-remediation/approve
 * (Common/Server/API/AutoRemediationAPI.ts).
 *
 * The project used to have three AI switches: Enable AI, Enable
 * auto-remediation and Enable AI command execution (an opt-in rule rounds
 * needed on top of the other two). The last two were folded into Enable AI,
 * so approving an AI-composed command plan now asks the project exactly one
 * question. Pinned here, for every lane — a rule round's Bash plan, a rule
 * round's kubectl plan, a cluster round and a resource round:
 *
 * - Enable AI off (or the project row gone) refuses the click with one
 *   sentence naming the page the switch is on, before anything is claimed,
 *   run, posted to a feed or read about the plan's targets.
 * - Enable AI on — or not selected, since the column defaults to on — is
 *   all a plan needs from the project: no second opt-in, and a row that
 *   still carries the retired switches is judged on Enable AI alone.
 * - The project is read once, as root, for { _id, enableAi } and nothing
 *   else, after the caller's permission check and before the plan is parsed.
 * - The switch gates AI-composed command plans only: a runbook suggestion
 *   is approved as before, and a plan can always be dismissed — which is
 *   what the refusal tells the approver to do.
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

jest.mock("../../../Server/Utils/AutoRemediation/CommandPlanExecutor", () => {
  return {
    __esModule: true,
    default: {
      executeApprovedPlan: jest.fn(),
    },
  };
});

const executeApprovedPlanMock: jest.Mock =
  CommandPlanExecutor.executeApprovedPlan as unknown as jest.Mock;

const sendJsonObjectResponseMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;

const APPROVE_ROUTE: string = "/auto-remediation/approve";
const DISMISS_ROUTE: string = "/auto-remediation/dismiss";

// What the approve route answers, word for word, while the project has AI off.
const AI_DISABLED_REFUSAL: string =
  "AI is disabled for this project, so this plan cannot be run. Re-enable it in Project Settings → AI Features, or dismiss the suggestion.";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ALERT_ID: ObjectID = new ObjectID("45454545-4545-4545-8545-454545454545");
// The KubernetesAiAgent row's id — what a plan stores in runnerId for it.
const AGENT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RULE_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
// The ResourceAiAgent row's id — what a resource command stores in runnerId.
const RESOURCE_AGENT_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESOURCE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUNBOOK_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RUNBOOK_EXECUTION_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

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

async function callRoute(uri: string): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: { suggestionId: SUGGESTION_ID.toString() },
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

function buildUserProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission) => {
      const userPermission: UserPermission = {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };

      return userPermission;
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

// The project row as the approve route selects it: Enable AI, nothing else.
function fakeProject(
  overrides: Partial<Record<string, unknown>> = {},
): Project {
  return {
    _id: PROJECT_ID.toString(),
    id: PROJECT_ID,
    enableAi: true,
    ...overrides,
  } as unknown as Project;
}

function bashCommandJson(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Bash,
    runnerId: RUNNER_ID.toString(),
    runnerNameSnapshot: "web-runner-1",
    command: "systemctl restart nginx",
    timeoutInMs: 60000,
    rationale: "nginx workers are wedged",
    expectedEffect: "restores HTTP responses",
    policyVerdict: "RequiresApproval",
  } as JSONObject;
}

// A kubectl command composed for the cluster's Kubernetes AI agent.
function agentKubectlCommandJson(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.Kubectl,
    runnerId: AGENT_ID.toString(),
    runnerNameSnapshot: KUBERNETES_AI_AGENT_DISPLAY_NAME,
    kubernetesClusterId: CLUSTER_ID.toString(),
    kubernetesClusterNameSnapshot: "prod-us",
    kubectlTier: KubectlCommandTier.SafeWrite,
    command: "kubectl rollout restart deployment/web -n web",
    timeoutInMs: 60000,
    rationale: "web pods are wedged",
    expectedEffect: "fresh pods serve traffic",
    policyVerdict: "RequiresApproval",
  } as JSONObject;
}

// A resource command composed for a Docker host's resource AI agent.
function resourceCommandJson(): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: RESOURCE_AGENT_ID,
    runnerNameSnapshot: "Docker AI agent",
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceNameSnapshot: "web-1",
    resourceCommandTier: "RiskyWrite",
    command: "docker stop web",
    rollbackCommand: "docker start web",
    timeoutInMs: 30000,
    rationale: "web is leaking memory",
    expectedEffect: "the leak stops",
    policyVerdict: "RequiresApproval",
  } as JSONObject;
}

// The cluster as the plan was composed for it: ready, reached through its AI agent.
function readyClusterStatus(): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: {
      id: AGENT_ID.toString(),
      name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      kind: "ai_agent",
      isOnline: true,
      canRunAiCommands: true,
      posture: { inCluster: true, allowWrites: true },
    },
    accessMethod: "in_cluster",
    aiAgent: null,
    automaticInvestigation: { incidents: false, alerts: false },
    kubectlAllowlist: [],
    isInvestigationEnabled: true,
    isInvestigationReady: true,
    remediationMode: KubernetesAiRemediationMode.RequireApproval,
    isRemediationReady: true,
    gaps: [],
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// The Docker host as the plan was composed for it: ready, its agent online and writable.
function readyResourceStatus(): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: RESOURCE_AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: {
        resourceType: AiResourceType.DockerHost,
        resourceIdentifier: "web-1",
        allowWrites: true,
        writeTargets: [],
        protectedTargets: [],
        reachable: true,
      },
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

// One lane: what the suggestion row says about its round, and its plan.
type Lane = {
  row: Record<string, unknown>;
  commands: Array<JSONObject>;
};

const LANES: Array<[string, Lane]> = [
  [
    "a rule round's Bash plan",
    { row: { autoRemediationRuleId: RULE_ID }, commands: [bashCommandJson()] },
  ],
  [
    "a rule round's kubectl plan",
    {
      row: { autoRemediationRuleId: RULE_ID },
      commands: [agentKubectlCommandJson()],
    },
  ],
  [
    "a cluster round",
    {
      row: { kubernetesClusterId: CLUSTER_ID },
      commands: [agentKubectlCommandJson()],
    },
  ],
  [
    "a resource round",
    {
      row: {
        resourceType: AiResourceType.DockerHost,
        resourceId: new ObjectID(RESOURCE_ID),
      },
      commands: [resourceCommandJson()],
    },
  ],
];

// The suggestion row as the database holds it.
function suggestionRow(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands: [bashCommandJson()] } as JSONObject,
    verificationWindowMinutes: 15,
    ruleNameSnapshot: "Web tier wedged",
    ...overrides,
  };
}

describe("POST /auto-remediation/approve — Enable AI is the one project gate", () => {
  let getPropsSpy: jest.SpyInstance;
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let runnerFindSpy: jest.SpyInstance;
  let clusterStatusSpy: jest.SpyInstance;
  let resourceStatusSpy: jest.SpyInstance;
  let mayChangeSpy: jest.SpyInstance;
  let incidentFeedSpy: jest.SpyInstance;
  let alertFeedSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Routes register at module scope, after the mock router exists.
    await import("../../../Server/API/AutoRemediationAPI");
  });

  /*
   * The row the route reads: honours the select, so a column the route does
   * not ask for is genuinely absent — exactly what a real findOneById does.
   */
  function mockRow(row: Record<string, unknown>): void {
    suggestionFindSpy.mockImplementation(
      async (args: unknown): Promise<AutoRemediationSuggestion> => {
        const select: Record<string, unknown> = (
          args as { select: Record<string, unknown> }
        ).select;
        const picked: Record<string, unknown> = { id: row["id"] };
        for (const key of Object.keys(select)) {
          if (key in row) {
            picked[key] = row[key];
          }
        }
        return picked as unknown as AutoRemediationSuggestion;
      },
    );
  }

  function mockLane(
    lane: Lane,
    overrides: Partial<Record<string, unknown>> = {},
  ): void {
    mockRow(
      suggestionRow({
        ...lane.row,
        commandPlan: { commands: lane.commands } as JSONObject,
        ...overrides,
      }),
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();

    executeApprovedPlanMock.mockResolvedValue(undefined);

    getPropsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildUserProps());

    suggestionFindSpy = jest.spyOn(
      AutoRemediationSuggestionService,
      "findOneById",
    );
    mockRow(suggestionRow({ autoRemediationRuleId: RULE_ID }));

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    // AI on unless a test says otherwise.
    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    runnerFindSpy = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID.toString(),
      name: "web-runner-1",
    } as unknown as Runner);

    clusterStatusSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(readyClusterStatus());

    resourceStatusSpy = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(readyResourceStatus());

    mayChangeSpy = jest
      .spyOn(ResourceAiAccessService, "assertCallerMayChangeResource")
      .mockResolvedValue(undefined);

    incidentFeedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    alertFeedSpy = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Refused at the project gate: nothing claimed, run, answered or posted,
   * and none of the plan's targets looked at.
   */
  function expectRefusedAtTheGate(result: RouteCallResult): void {
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toBe(
      AI_DISABLED_REFUSAL,
    );

    expect(casSpy).not.toHaveBeenCalled();
    expect(executeApprovedPlanMock).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    expect(incidentFeedSpy).not.toHaveBeenCalled();
    expect(alertFeedSpy).not.toHaveBeenCalled();

    expect(runnerFindSpy).not.toHaveBeenCalled();
    expect(clusterStatusSpy).not.toHaveBeenCalled();
    expect(resourceStatusSpy).not.toHaveBeenCalled();
    expect(mayChangeSpy).not.toHaveBeenCalled();
  }

  // Claimed Suggested -> Approved, handed to the executor, and announced.
  function expectApproved(result: RouteCallResult): void {
    expect(result.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(casSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AutoRemediationSuggestionStatus.Suggested,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.Approved,
        }),
      }),
    );
    expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  }

  describe.each(LANES)("%s", (_label: string, lane: Lane) => {
    test.each([
      ["Enable AI is off", fakeProject({ enableAi: false })],
      ["the project row is gone", null],
      [
        "Enable AI is off, whatever the retired switches say",
        fakeProject({
          enableAi: false,
          enableAutoRemediation: true,
          enableAiCommandExecution: true,
        }),
      ],
    ])(
      "is refused when %s — nothing claimed, run, posted or read",
      async (_state: string, project: Project | null) => {
        mockLane(lane);
        projectFindSpy.mockResolvedValue(project);

        expectRefusedAtTheGate(await callRoute(APPROVE_ROUTE));
      },
    );

    test.each([
      ["Enable AI is on", fakeProject()],
      [
        "Enable AI was not selected (the column defaults to on)",
        fakeProject({ enableAi: undefined }),
      ],
      [
        "the row still carries the retired switches, both off",
        fakeProject({
          enableAutoRemediation: false,
          enableAiCommandExecution: false,
        }),
      ],
    ])(
      "is approved when %s — no other project switch is asked for",
      async (_state: string, project: Project) => {
        mockLane(lane);
        projectFindSpy.mockResolvedValue(project);

        expectApproved(await callRoute(APPROVE_ROUTE));
      },
    );
  });

  describe("the project read", () => {
    test("is one read, as root, of the suggestion's project, for exactly { _id, enableAi }", async () => {
      expectApproved(await callRoute(APPROVE_ROUTE));

      expect(projectFindSpy).toHaveBeenCalledTimes(1);
      const args: {
        id: ObjectID;
        select: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = projectFindSpy.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
        props: { isRoot?: boolean };
      };
      expect(args.id.toString()).toBe(PROJECT_ID.toString());
      expect(args.select).toEqual({ _id: true, enableAi: true });
      expect(args.props.isRoot).toBe(true);
    });

    test("comes before the plan is parsed: an unparseable plan is refused for AI being off first", async () => {
      mockRow(
        suggestionRow({ autoRemediationRuleId: RULE_ID, commandPlan: null }),
      );
      projectFindSpy.mockResolvedValue(fakeProject({ enableAi: false }));

      expectRefusedAtTheGate(await callRoute(APPROVE_ROUTE));
    });

    test("negative control: with AI on, the same unparseable plan is refused for the plan", async () => {
      mockRow(
        suggestionRow({ autoRemediationRuleId: RULE_ID, commandPlan: null }),
      );

      const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as BadDataException).message).toContain(
        "no valid command plan",
      );
      expect(casSpy).not.toHaveBeenCalled();
    });

    test("comes after the caller's permission check: a caller who may not run runbooks is refused for that, and the project is never read", async () => {
      getPropsSpy.mockResolvedValue(buildUserProps([Permission.Viewer]));
      projectFindSpy.mockResolvedValue(fakeProject({ enableAi: false }));

      const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(projectFindSpy).not.toHaveBeenCalled();
      expect(casSpy).not.toHaveBeenCalled();
    });

    test("is re-read on every click: turning AI back on lets the same pending plan through", async () => {
      projectFindSpy.mockResolvedValueOnce(fakeProject({ enableAi: false }));

      const refused: RouteCallResult = await callRoute(APPROVE_ROUTE);
      expect((refused.thrownToNext as BadDataException).message).toBe(
        AI_DISABLED_REFUSAL,
      );
      expect(casSpy).not.toHaveBeenCalled();

      const approved: RouteCallResult = await callRoute(APPROVE_ROUTE);
      expect(approved.nextCallCount).toBe(0);
      expect(projectFindSpy).toHaveBeenCalledTimes(2);
      expect(casSpy).toHaveBeenCalledTimes(1);
      expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("the plan's subject", () => {
    test.each([
      ["an incident", { incidentId: INCIDENT_ID }],
      ["an alert", { incidentId: undefined, alertId: ALERT_ID }],
    ])(
      "a refused plan on %s posts nothing to any feed",
      async (_label: string, subject: Partial<Record<string, unknown>>) => {
        mockRow(suggestionRow({ autoRemediationRuleId: RULE_ID, ...subject }));
        projectFindSpy.mockResolvedValue(fakeProject({ enableAi: false }));

        expectRefusedAtTheGate(await callRoute(APPROVE_ROUTE));
      },
    );

    test("an approved plan on an alert is announced on the alert's feed only", async () => {
      mockRow(
        suggestionRow({
          autoRemediationRuleId: RULE_ID,
          incidentId: undefined,
          alertId: ALERT_ID,
        }),
      );

      expectApproved(await callRoute(APPROVE_ROUTE));

      expect(alertFeedSpy).toHaveBeenCalledTimes(1);
      expect(alertFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId: ALERT_ID,
          feedInfoInMarkdown: expect.stringContaining(
            "AI command plan approved",
          ),
        }),
      );
      expect(incidentFeedSpy).not.toHaveBeenCalled();
    });
  });

  describe("what the switch does not gate", () => {
    test.each([
      ["on", fakeProject()],
      ["off", fakeProject({ enableAi: false })],
    ])(
      "a runbook suggestion is approved as before with Enable AI %s — the project is not read",
      async (_state: string, project: Project) => {
        projectFindSpy.mockResolvedValue(project);
        mockRow(
          suggestionRow({
            suggestionType: AutoRemediationSuggestionType.Runbook,
            commandPlan: undefined,
            runbookId: RUNBOOK_ID,
            runbookNameSnapshot: "Restart web tier",
          }),
        );
        const startRunbookSpy: jest.SpyInstance = jest
          .spyOn(RunbookRuleEngineService, "startRunbookFor")
          .mockResolvedValue({
            id: RUNBOOK_EXECUTION_ID,
          } as unknown as RunbookExecution);
        jest
          .spyOn(AutoRemediationSuggestionService, "updateOneById")
          .mockResolvedValue(undefined as never);

        const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

        expect(result.nextCallCount).toBe(0);
        expect(startRunbookSpy).toHaveBeenCalledTimes(1);
        expect(projectFindSpy).not.toHaveBeenCalled();
        expect(executeApprovedPlanMock).not.toHaveBeenCalled();
      },
    );

    test("a command plan can still be dismissed with Enable AI off, as the refusal tells the approver to", async () => {
      projectFindSpy.mockResolvedValue(fakeProject({ enableAi: false }));

      const result: RouteCallResult = await callRoute(DISMISS_ROUTE);

      expect(result.nextCallCount).toBe(0);
      expect(casSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Dismissed,
          }),
        }),
      );
      expect(projectFindSpy).not.toHaveBeenCalled();
      expect(executeApprovedPlanMock).not.toHaveBeenCalled();
      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          feedInfoInMarkdown: expect.stringContaining(
            "command plan will not be run",
          ),
        }),
      );
    });
  });
});
