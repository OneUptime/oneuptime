import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunnerService from "../../../Server/Services/RunnerService";
import CommandPlanExecutor from "../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  KubectlCommandTier,
  KubernetesAiAccessGap,
  KubernetesAiAccessRunnerSummary,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
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
 * POST /auto-remediation/approve for cluster rounds and the Kubernetes AI
 * agent (Common/Server/API/AutoRemediationAPI.ts).
 *
 * Pinned here:
 *
 * The project switch, for every lane.
 * - Enable AI, the project's only AI switch, stops every command plan: a
 *   rule round's, a cluster round's (the suggestion names a cluster and no
 *   rule) and one whose cluster was deleted alike. There is no second
 *   project opt-in for rule rounds any more: the retired "Enable
 *   auto-remediation" and "Enable AI command execution" switches are never
 *   read, even on a row that still carries them.
 * - Past that switch, every kubectl command is re-checked against its
 *   cluster's own consent, whichever lane composed it.
 *
 * The Kubernetes AI agent as a plan's target.
 * - A kubectl command composed for a cluster's AI agent names the agent's
 *   id where a Runner id would be. The agent is not a Runner row, so for an
 *   id the cluster's status resolves to the agent the Runner table is not
 *   re-read (it would refuse every agent plan); the agent must be online
 *   instead, and Bash/SSH steps aimed at it are refused.
 * - Only the cluster's CURRENT status makes an id the agent: a Runner is
 *   never mistaken for it, and an agent that is no longer the cluster's
 *   target falls back to the Runner re-read, which refuses it.
 * - Each cluster's status is still read once per approval.
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

// What the route answers, word for word, while the project has AI off.
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
// The KubernetesAiAgent row's id — what a plan stores in runnerId for the agent.
const AGENT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const RULE_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const OTHER_AGENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

async function callApprove(): Promise<RouteCallResult> {
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

  await matchRoute(APPROVE_ROUTE).handlerFunction(
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
  morePermissions: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [Permission.ProjectMember, ...morePermissions].map(
      (permission: Permission) => {
        const userPermission: UserPermission = {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
        };

        return userPermission;
      },
    ),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

// A kubectl command as a cluster round records it for the cluster's AI agent.
function agentKubectlCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
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
    ...overrides,
  } as JSONObject;
}

function bashCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
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
    ...overrides,
  } as JSONObject;
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

// The suggestion row as the database holds it.
function clusterRoundRow(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    verificationWindowMinutes: 15,
    kubernetesClusterId: CLUSTER_ID,
    ruleNameSnapshot: 'AI remediation for cluster "prod-us"',
    ...overrides,
  };
}

function ruleRoundRow(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return clusterRoundRow(commands, {
    kubernetesClusterId: undefined,
    autoRemediationRuleId: RULE_ID,
    ruleNameSnapshot: "Web pods wedged",
    ...overrides,
  });
}

function agentSummary(
  overrides: Partial<KubernetesAiAccessRunnerSummary> = {},
): KubernetesAiAccessRunnerSummary {
  return {
    id: AGENT_ID.toString(),
    name: KUBERNETES_AI_AGENT_DISPLAY_NAME,
    kind: "ai_agent",
    isOnline: true,
    canRunAiCommands: true,
    posture: { inCluster: true, allowWrites: true },
    ...overrides,
  };
}

// The cluster exactly as the plan was composed for it: ready, reached through its AI agent.
function agentStatus(
  overrides: Partial<KubernetesClusterAiAccessStatus> = {},
): KubernetesClusterAiAccessStatus {
  return {
    clusterId: CLUSTER_ID.toString(),
    clusterName: "prod-us",
    clusterIdentifier: "prod-us",
    runner: agentSummary(),
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
    ...overrides,
  };
}

describe("POST /auto-remediation/approve — cluster rounds and the Kubernetes AI agent", () => {
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let runnerFindSpy: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;
  let getScopeRefusalNextStep: (
    runner: KubernetesClusterAiAccessStatus["runner"],
  ) => string;

  beforeAll(async () => {
    /*
     * AutoRemediationAPI registers its routes at module scope, so the import
     * is deferred until the mock router above is fully constructed.
     */
    const api: typeof import("../../../Server/API/AutoRemediationAPI") =
      await import("../../../Server/API/AutoRemediationAPI");
    getScopeRefusalNextStep = api.getScopeRefusalNextStep;
  });

  /*
   * The row the route reads: honours the select, so a column the route
   * forgets to ask for is genuinely absent — exactly what a real
   * findOneById does. The access check under the user's props selects only
   * _id, and gets only that.
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

  beforeEach(() => {
    jest.clearAllMocks();

    executeApprovedPlanMock.mockResolvedValue(undefined);

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildUserProps());

    suggestionFindSpy = jest.spyOn(
      AutoRemediationSuggestionService,
      "findOneById",
    );
    mockRow(clusterRoundRow([agentKubectlCommandJson()]));

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    runnerFindSpy = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID.toString(),
      name: "web-runner-1",
    } as unknown as Runner);

    statusSpy = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(agentStatus());

    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectRefusedBeforeClaim(result: RouteCallResult): BadDataException {
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeApprovedPlanMock).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    return result.thrownToNext as BadDataException;
  }

  function expectClaimedAndExecuted(result: RouteCallResult): void {
    expect(result.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);
  }

  describe("the project switch, for every lane", () => {
    test("the project is read as root, by the suggestion's project, for Enable AI alone", async () => {
      await callApprove();

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
      // Exactly: the retired switches are never asked for.
      expect(args.select).toEqual({ _id: true, enableAi: true });
      expect(args.props.isRoot).toBe(true);
    });

    test.each([
      ["on", true],
      ["not selected (the column defaults to on)", undefined],
    ])(
      "a cluster round is approvable with Enable AI %s",
      async (_label: string, value: boolean | undefined) => {
        projectFindSpy.mockResolvedValue(fakeProject({ enableAi: value }));

        expectClaimedAndExecuted(await callApprove());
      },
    );

    test("a RULE round whose plan is only kubectl is approved on Enable AI alone, and its command is still re-checked against the cluster", async () => {
      mockRow(ruleRoundRow([agentKubectlCommandJson()]));

      expectClaimedAndExecuted(await callApprove());

      // The cluster's own consent is what the kubectl command answers to.
      expect(statusSpy).toHaveBeenCalledTimes(1);
      // The AI agent is not a Runner row: no Runner was re-read.
      expect(runnerFindSpy).not.toHaveBeenCalled();
    });

    test("a RULE round with Bash commands is approved on Enable AI alone, re-reading its Runner's consent", async () => {
      mockRow(ruleRoundRow([bashCommandJson()]));

      expectClaimedAndExecuted(await callApprove());

      expect(runnerFindSpy).toHaveBeenCalledTimes(1);
      expect(runnerFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _id: RUNNER_ID.toString(),
            projectId: PROJECT_ID,
            canRunAiCommands: true,
          }),
        }),
      );
      // A Bash-only plan names no cluster.
      expect(statusSpy).not.toHaveBeenCalled();
    });

    test("a row that still carries the retired switches, both off, is approved — only Enable AI is read", async () => {
      mockRow(ruleRoundRow([agentKubectlCommandJson()]));
      projectFindSpy.mockResolvedValue(
        fakeProject({
          enableAutoRemediation: false,
          enableAiCommandExecution: false,
        }),
      );

      expectClaimedAndExecuted(await callApprove());
    });

    /*
     * The lane no longer matters to the project gate: whichever columns the
     * row carries, Enable AI on approves it and Enable AI off refuses it.
     */
    const LANES: Array<[string, Record<string, unknown>]> = [
      ["a cluster round", clusterRoundRow([agentKubectlCommandJson()])],
      ["a rule round", ruleRoundRow([agentKubectlCommandJson()])],
      [
        "a row naming a rule AND a cluster",
        clusterRoundRow([agentKubectlCommandJson()], {
          autoRemediationRuleId: RULE_ID,
        }),
      ],
      [
        "a round whose cluster was deleted (no cluster, no rule)",
        clusterRoundRow([agentKubectlCommandJson()], {
          kubernetesClusterId: undefined,
        }),
      ],
    ];

    test.each(LANES)(
      "%s is approved with Enable AI on",
      async (_label: string, row: Record<string, unknown>) => {
        mockRow(row);

        expectClaimedAndExecuted(await callApprove());
      },
    );

    test.each(LANES)(
      "%s is refused with Enable AI off, before any target is looked at",
      async (_label: string, row: Record<string, unknown>) => {
        mockRow(row);
        projectFindSpy.mockResolvedValue(fakeProject({ enableAi: false }));

        const error: BadDataException = expectRefusedBeforeClaim(
          await callApprove(),
        );

        expect(error.message).toBe(AI_DISABLED_REFUSAL);
        expect(statusSpy).not.toHaveBeenCalled();
        expect(runnerFindSpy).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["the project row is gone", null],
      ["Enable AI is off", fakeProject({ enableAi: false })],
      [
        "Enable AI is off, whatever the retired switches say",
        fakeProject({
          enableAi: false,
          enableAutoRemediation: true,
          enableAiCommandExecution: true,
        }),
      ],
    ])(
      "a cluster round is refused when %s, naming the page with the switch",
      async (_label: string, project: Project | null) => {
        projectFindSpy.mockResolvedValue(project);

        const error: BadDataException = expectRefusedBeforeClaim(
          await callApprove(),
        );

        expect(error.message).toBe(AI_DISABLED_REFUSAL);
        expect(error.message).toContain("Project Settings → AI Features");
        expect(error.message).not.toContain("AI Credits");
        expect(error.message).not.toContain("auto-remediation");
        expect(error.message).not.toContain("command execution");
        expect(statusSpy).not.toHaveBeenCalled();
      },
    );

    test("a cluster round reached through an advanced Runner is held back by the cluster's own gap once Enable AI is on", async () => {
      const gap: KubernetesAiAccessGap = {
        code: "remediation_write_access_missing",
        title: "The Runner is read-only",
        description:
          'Runner "ops-runner" reports that it may not change the cluster, so kubectl changes would be refused.',
        nextStep:
          "Set ONEUPTIME_KUBECTL_ALLOW_WRITES=true on the Runner's host and restart it (ONEUPTIME_KUBECTL_WRITE_NAMESPACES limits the namespaces it may change).",
        blocks: "remediation",
      };
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: RUNNER_ID.toString(),
            name: "ops-runner",
            kind: "runner",
            isOnline: true,
            canRunAiCommands: true,
          },
          accessMethod: "credential",
          credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          isRemediationReady: false,
          gaps: [gap],
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain("no longer allows AI remediation");
      expect(error.message).toContain(gap.title);
      expect(error.message).toContain(
        "Fix that on the cluster's AI agent page (AI → Agent)",
      );
    });

    test("negative control: the same Runner-reached cluster round is approved once the cluster is ready again", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: RUNNER_ID.toString(),
            name: "ops-runner",
            kind: "runner",
            isOnline: true,
            canRunAiCommands: true,
          },
          accessMethod: "credential",
          credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      );

      expectClaimedAndExecuted(await callApprove());
      expect(runnerFindSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("the Kubernetes AI agent as a plan's target", () => {
    test("a kubectl plan on the cluster's AI agent proceeds WITHOUT a Runner-table read", async () => {
      const result: RouteCallResult = await callApprove();

      expectClaimedAndExecuted(result);
      expect(runnerFindSpy).not.toHaveBeenCalled();
    });

    test("the cluster status is read once, however many agent commands and checks use it", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({ sequence: 1 }),
          agentKubectlCommandJson({
            sequence: 2,
            command: "kubectl rollout status deployment/web -n web",
          }),
        ]),
      );

      expectClaimedAndExecuted(await callApprove());
      expect(statusSpy).toHaveBeenCalledTimes(1);

      const call: { clusterId: ObjectID; projectId: ObjectID } = statusSpy.mock
        .calls[0]![0] as { clusterId: ObjectID; projectId: ObjectID };
      expect(call.clusterId.toString()).toBe(CLUSTER_ID.toString());
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    });

    test("an offline agent refuses the click, pointing at the AI agent page", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({ runner: agentSummary({ isOnline: false }) }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        'The Kubernetes AI agent of cluster "prod-us" is offline',
      );
      expect(error.message).toContain("AI agent page (AI → Agent)");
      expect(runnerFindSpy).not.toHaveBeenCalled();
    });

    test("an offline agent is refused for being offline even before the cluster's own readiness gap is named", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: agentSummary({ isOnline: false }),
          isRemediationReady: false,
          gaps: [
            {
              code: "ai_agent_offline",
              title: "The Kubernetes AI agent is offline",
              description: "No heartbeat.",
              nextStep: "kubectl logs -n oneuptime-agent -l component=ai-agent",
              blocks: "both",
            },
          ],
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain("is offline, so this plan cannot be run");
    });

    test.each([RunbookStepType.Bash, RunbookStepType.SSH])(
      "a %s step aimed at the AI agent is refused — it runs only Kubectl steps",
      async (stepType: RunbookStepType) => {
        /*
         * An approver who may read runbook credentials, so what refuses is
         * the step itself rather than the credential an SSH step runs with.
         */
        jest
          .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
          .mockResolvedValue(
            buildUserProps([Permission.ReadRunbookCredential]),
          );

        mockRow(
          clusterRoundRow([
            agentKubectlCommandJson({ sequence: 1 }),
            bashCommandJson({
              sequence: 2,
              stepType,
              runnerId: AGENT_ID.toString(),
              runnerNameSnapshot: KUBERNETES_AI_AGENT_DISPLAY_NAME,
              // An SSH step only parses with the credential it logs in with.
              ...(stepType === RunbookStepType.SSH
                ? { credentialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
                : {}),
            }),
          ]),
        );

        const error: BadDataException = expectRefusedBeforeClaim(
          await callApprove(),
        );

        expect(error.message).toContain(`Command 2 is a ${stepType} step`);
        expect(error.message).toContain("Kubernetes AI agent");
        expect(error.message).toContain("runs only Kubectl steps");
        expect(runnerFindSpy).not.toHaveBeenCalled();
      },
    );

    test("a mixed plan: the agent is recognised from the status, the ordinary Runner is still re-read", async () => {
      mockRow(
        ruleRoundRow([
          agentKubectlCommandJson({ sequence: 1 }),
          bashCommandJson({ sequence: 2 }),
        ]),
      );

      expectClaimedAndExecuted(await callApprove());

      expect(runnerFindSpy).toHaveBeenCalledTimes(1);
      expect(runnerFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _id: RUNNER_ID.toString(),
            projectId: PROJECT_ID,
            canRunAiCommands: true,
          }),
        }),
      );
    });

    test("an ordinary Runner's refusal still wins in a mixed plan", async () => {
      mockRow(
        ruleRoundRow([
          agentKubectlCommandJson({ sequence: 1 }),
          bashCommandJson({ sequence: 2 }),
        ]),
      );
      runnerFindSpy.mockResolvedValue(null);

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain("no longer accepts AI commands");
    });

    test("a Runner target is never mistaken for the agent: kind runner keeps the Runner re-read", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "kubernetes-agent/prod-us",
          }),
        ]),
      );
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: RUNNER_ID.toString(),
            name: "kubernetes-agent/prod-us",
            kind: "runner",
            isOnline: true,
            canRunAiCommands: true,
          },
        }),
      );
      runnerFindSpy.mockResolvedValue(null);

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(runnerFindSpy).toHaveBeenCalledTimes(1);
      expect(error.message).toContain("no longer accepts AI commands");
    });

    test("a summary with no kind is a Runner, as documented — the Runner table is re-read", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({ runnerId: RUNNER_ID.toString() }),
        ]),
      );
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: RUNNER_ID.toString(),
            name: "kubernetes-agent/prod-us",
            isOnline: true,
            canRunAiCommands: true,
          },
        }),
      );

      expectClaimedAndExecuted(await callApprove());
      expect(runnerFindSpy).toHaveBeenCalledTimes(1);
    });

    test("an agent that is no longer the cluster's target falls back to the Runner re-read, which refuses it", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: {
            id: RUNNER_ID.toString(),
            name: "ops-runner",
            kind: "runner",
            isOnline: true,
            canRunAiCommands: true,
          },
        }),
      );
      runnerFindSpy.mockResolvedValue(null);

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(runnerFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ _id: AGENT_ID.toString() }),
        }),
      );
      expect(error.message).toContain("no longer accepts AI commands");
    });

    test("another cluster's agent id is not this cluster's agent: the per-command check refuses the mismatch", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({ sequence: 1 }),
          agentKubectlCommandJson({
            sequence: 2,
            kubernetesClusterId: OTHER_CLUSTER_ID.toString(),
            kubernetesClusterNameSnapshot: "staging-eu",
          }),
        ]),
      );
      statusSpy.mockImplementation(
        async (data: {
          clusterId: ObjectID;
        }): Promise<KubernetesClusterAiAccessStatus> => {
          return data.clusterId.toString() === CLUSTER_ID.toString()
            ? agentStatus()
            : agentStatus({
                clusterId: OTHER_CLUSTER_ID.toString(),
                clusterName: "staging-eu",
                runner: agentSummary({ id: OTHER_AGENT_ID.toString() }),
              });
        },
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain('"staging-eu"');
      expect(error.message).toContain("command 2");
      expect(error.message).toContain("no longer reached through");
      expect(runnerFindSpy).not.toHaveBeenCalled();
    });

    test("an agent plan on a cluster whose remediation was switched off is refused with the gap, after the agent checks pass", async () => {
      const gap: KubernetesAiAccessGap = {
        code: "remediation_disabled",
        title: "Fixes are off for this cluster",
        description: "An operator switched fixes off.",
        nextStep: "Choose Ask for approval on the cluster's AI agent page.",
        blocks: "remediation",
      };
      statusSpy.mockResolvedValue(
        agentStatus({
          remediationMode: KubernetesAiRemediationMode.Disabled,
          isRemediationReady: false,
          gaps: [gap],
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain("no longer allows AI remediation");
      expect(error.message).toContain(gap.title);
      expect(error.message).toContain("AI agent page (AI → Agent)");
      expect(error.message).not.toContain("cluster's AI page");
    });

    test("a command outside the agent's write scope names the AI agent's write access, not a Runner", async () => {
      statusSpy.mockResolvedValue(
        agentStatus({
          runner: agentSummary({
            posture: {
              inCluster: true,
              allowWrites: true,
              writeNamespaces: ["api"],
            },
          }),
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        'Command 1 cannot run on cluster "prod-us"',
      );
      expect(error.message).toContain(
        "change the AI agent's write access (aiAgent.remediation.*) on the Kubernetes agent chart and approve again.",
      );
      expect(error.message).not.toContain("Runner");
    });
  });

  /*
   * Where a write-scope refusal sends the approver, three ways by who runs
   * kubectl for the cluster (§5.3) — the same split as the refusal's own
   * wording (RemediationCommandToolkit.getRunnerScopeSettings), so one
   * message never names two different places. The agent case is above.
   */
  describe("a write-scope refusal names where that target's scope is set", () => {
    // A cluster reached through a Runner row, as the plan was composed for it.
    function runnerTargetStatus(
      runner: Partial<KubernetesAiAccessRunnerSummary>,
      overrides: Partial<KubernetesClusterAiAccessStatus> = {},
    ): KubernetesClusterAiAccessStatus {
      return agentStatus({
        runner: {
          id: RUNNER_ID.toString(),
          name: "kubernetes-agent/prod-us",
          kind: "runner",
          isOnline: true,
          canRunAiCommands: true,
          ...runner,
        },
        ...overrides,
      });
    }

    beforeEach(() => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "kubernetes-agent/prod-us",
          }),
        ]),
      );
    });

    test("the chart's previous in-cluster Runner points at upgrading to the AI agent, not at approving this plan again", async () => {
      statusSpy.mockResolvedValue(
        runnerTargetStatus({
          posture: {
            inCluster: true,
            allowWrites: true,
            writeNamespaces: ["api"],
          },
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        'Command 1 cannot run on cluster "prod-us"',
      );
      expect(error.message).toContain(
        "Nothing ran. Dismiss the suggestion and let a new plan be composed. To allow changes like this, upgrade the Kubernetes agent chart to the AI agent and set aiAgent.remediation.*.",
      );
      /*
       * Upgrading replaces this Runner with the AI agent, so this plan —
       * composed for the Runner — could not be approved afterwards.
       */
      expect(error.message).not.toContain("approve again");
      expect(error.message).not.toContain("on the Runner's host and approve");
    });

    test("the previous in-cluster Runner is recognised by its posture when it is not named like one", async () => {
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "renamed-agent",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        runnerTargetStatus({
          name: "renamed-agent",
          posture: {
            inCluster: true,
            clusterIdentifier: "prod-us",
            allowWrites: true,
            writeNamespaces: ["api"],
          },
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        "upgrade the Kubernetes agent chart to the AI agent and set aiAgent.remediation.*",
      );
    });

    test("a credential Runner points at its own host, never at the Kubernetes agent chart", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        runnerTargetStatus(
          {
            name: "ops-runner",
            posture: {
              inCluster: false,
              allowWrites: true,
              writeNamespaces: ["api"],
            },
          },
          {
            accessMethod: "credential",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        ),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        'Command 1 cannot run on cluster "prod-us"',
      );
      // The refusal and the next step name the same place.
      expect(error.message).toContain(
        "ONEUPTIME_KUBECTL_WRITE_NAMESPACES on the Runner's host",
      );
      expect(error.message).toContain(
        "Nothing ran. Dismiss the suggestion and let a new plan be composed, or change the Runner's write scope on the Runner's host and approve again.",
      );
      expect(error.message).not.toContain("Kubernetes agent chart");
      expect(error.message).not.toContain("aiAgent.remediation");
    });

    test("a Runner that merely lives in a pod, with no cluster identity, is treated as a credential Runner", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        runnerTargetStatus(
          {
            name: "ops-runner",
            posture: {
              inCluster: true,
              allowWrites: true,
              writeNamespaces: ["api"],
            },
          },
          {
            accessMethod: "credential",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        ),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain(
        "change the Runner's write scope on the Runner's host and approve again.",
      );
      expect(error.message).not.toContain("upgrade the Kubernetes agent chart");
    });

    test("a rollback outside the scope gets the same next step as the command", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            command: "kubectl rollout restart deployment/web -n api",
            rollbackCommand: "kubectl rollout undo deployment/web -n web",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        runnerTargetStatus(
          {
            name: "ops-runner",
            posture: {
              inCluster: false,
              allowWrites: true,
              writeNamespaces: ["api"],
            },
          },
          {
            accessMethod: "credential",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        ),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );

      expect(error.message).toContain("Command 1's rollback cannot run");
      expect(error.message).toContain(
        "change the Runner's write scope on the Runner's host and approve again.",
      );
    });

    test("negative control: a command inside a credential Runner's scope is approved", async () => {
      mockRow(
        clusterRoundRow([
          agentKubectlCommandJson({
            runnerId: RUNNER_ID.toString(),
            runnerNameSnapshot: "ops-runner",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            command: "kubectl rollout restart deployment/web -n api",
          }),
        ]),
      );
      runnerFindSpy.mockResolvedValue({
        _id: RUNNER_ID.toString(),
        name: "ops-runner",
      } as unknown as Runner);
      statusSpy.mockResolvedValue(
        runnerTargetStatus(
          {
            name: "ops-runner",
            posture: {
              inCluster: false,
              allowWrites: true,
              writeNamespaces: ["api"],
            },
          },
          {
            accessMethod: "credential",
            credentialId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        ),
      );

      expectClaimedAndExecuted(await callApprove());
    });
  });

  describe("getScopeRefusalNextStep", () => {
    function summary(
      overrides: Partial<KubernetesAiAccessRunnerSummary>,
    ): KubernetesAiAccessRunnerSummary {
      return {
        id: RUNNER_ID.toString(),
        name: "ops-runner",
        kind: "runner",
        isOnline: true,
        canRunAiCommands: true,
        ...overrides,
      };
    }

    test("the AI agent: its chart values, and the plan can be approved again", () => {
      expect(getScopeRefusalNextStep(agentSummary())).toBe(
        "Dismiss the suggestion and let a new plan be composed, or change the AI agent's write access (aiAgent.remediation.*) on the Kubernetes agent chart and approve again.",
      );
    });

    test("an AI agent is recognised by its kind even under a Runner-like name", () => {
      expect(
        getScopeRefusalNextStep(
          agentSummary({ name: "kubernetes-agent/prod-us" }),
        ),
      ).toContain("the AI agent's write access (aiAgent.remediation.*)");
    });

    test("the previous in-cluster Runner, by its server-owned name", () => {
      expect(
        getScopeRefusalNextStep(summary({ name: "kubernetes-agent/prod-us" })),
      ).toBe(
        "Dismiss the suggestion and let a new plan be composed. To allow changes like this, upgrade the Kubernetes agent chart to the AI agent and set aiAgent.remediation.*.",
      );
    });

    test("the previous in-cluster Runner's name is matched case-insensitively", () => {
      expect(
        getScopeRefusalNextStep(summary({ name: "Kubernetes-Agent/prod-us" })),
      ).toContain("upgrade the Kubernetes agent chart to the AI agent");
    });

    test("the previous in-cluster Runner, by its posture alone", () => {
      expect(
        getScopeRefusalNextStep(
          summary({
            name: "renamed-agent",
            posture: { inCluster: true, clusterIdentifier: "prod-us" },
          }),
        ),
      ).toContain("upgrade the Kubernetes agent chart to the AI agent");
    });

    test("a summary with no kind is a Runner, as the field is documented", () => {
      expect(
        getScopeRefusalNextStep(
          summary({ kind: undefined, name: "ops-runner" }),
        ),
      ).toBe(
        "Dismiss the suggestion and let a new plan be composed, or change the Runner's write scope on the Runner's host and approve again.",
      );
    });

    test("a credential Runner in a pod but with no cluster identity keeps the host wording", () => {
      expect(
        getScopeRefusalNextStep(
          summary({ posture: { inCluster: true, clusterIdentifier: "  " } }),
        ),
      ).toContain("the Runner's write scope on the Runner's host");
    });

    test("no target at all falls back to the Runner wording instead of throwing", () => {
      expect(getScopeRefusalNextStep(null)).toContain(
        "the Runner's write scope on the Runner's host",
      );
    });
  });
});
