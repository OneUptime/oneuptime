import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../../Server/Services/KubernetesClusterAiAccessService";
import ProjectService from "../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import RunnerService from "../../../Server/Services/RunnerService";
import CommandPlanExecutor from "../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "../../../Models/DatabaseModels/Project";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
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
 * POST /auto-remediation/approve for RESOURCE rounds and the resource AI
 * agent (Common/Server/API/AutoRemediationAPI.ts) — the resource sibling of
 * AutoRemediationApproveClusterRound.
 *
 * Pinned here:
 * - "Enable AI command execution" stops rule rounds only: a resource round
 *   (the suggestion names a resource and no rule) is approvable with it off;
 *   Enable AI / auto-remediation still stop it. The lane is read off the
 *   row, so resourceType and resourceId must be selected.
 * - A ResourceCommand step names its resource's AI agent where a Runner id
 *   would be; the Runner table is never re-read for it. The agent must be
 *   the resource's CURRENT agent and online; only ResourceCommand steps may
 *   target it, and only for its own resource.
 * - Every ResourceCommand is re-checked live: the resource must exist and be
 *   remediation-ready (the gap and its next step named), the command and its
 *   rollback must still pass the policy and the agent's reported write scope
 *   — with a next step naming the agent's own settings.
 * - Each resource's status is read once per approval.
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
// The ResourceAiAgent row's id — what a plan stores in runnerId for the agent.
const AGENT_ID: string = "55555555-5555-4555-8555-555555555555";
const OTHER_AGENT_ID: string = "56565656-5656-4565-8565-565656565656";
const RUNNER_ID: string = "66666666-6666-4666-8666-666666666666";
const RESOURCE_ID: string = "77777777-7777-4777-8777-777777777777";
const OTHER_RESOURCE_ID: string = "78787878-7878-4787-8787-787878787878";
const RULE_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

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

function buildUserProps(): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [Permission.ProjectMember].map((permission: Permission) => {
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

// A resource command as a resource round records it for the resource's AI agent.
function resourceCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
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
    ...overrides,
  } as JSONObject;
}

function fakeProject(
  overrides: Partial<Record<string, unknown>> = {},
): Project {
  return {
    _id: PROJECT_ID.toString(),
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: false,
    ...overrides,
  } as unknown as Project;
}

function resourceRoundRow(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: new ObjectID(SUGGESTION_ID.toString()),
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    verificationWindowMinutes: 15,
    resourceType: AiResourceType.DockerHost,
    resourceId: new ObjectID(RESOURCE_ID),
    ruleNameSnapshot: 'AI remediation for Docker host "web-1"',
    ...overrides,
  };
}

function posture(
  overrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAgentPosture {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceIdentifier: "web-1",
    allowWrites: true,
    writeTargets: [],
    protectedTargets: [],
    reachable: true,
    ...overrides,
  };
}

function resourceStatus(
  overrides: Partial<ResourceAiAccessStatus> = {},
  postureOverrides: Partial<ResourceAiAgentPosture> = {},
): ResourceAiAccessStatus {
  return {
    resourceType: AiResourceType.DockerHost,
    resourceId: RESOURCE_ID,
    resourceName: "web-1",
    isAiInvestigationEnabled: true,
    aiRemediationMode: ResourceAiRemediationMode.RequireApproval,
    aiCommandAllowlist: [],
    agent: {
      agentId: AGENT_ID,
      connectionStatus: "connected",
      isOnline: true,
      posture: posture(postureOverrides),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
    ...overrides,
  };
}

describe("POST /auto-remediation/approve — resource rounds and the resource AI agent", () => {
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let runnerFindSpy: jest.SpyInstance;
  let statusSpy: jest.SpyInstance;
  let clusterStatusSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Routes register at module scope, after the mock router exists.
    await import("../../../Server/API/AutoRemediationAPI");
  });

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
    mockRow(resourceRoundRow([resourceCommandJson()]));

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    runnerFindSpy = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID,
      name: "web-runner-1",
    } as unknown as Runner);

    statusSpy = jest
      .spyOn(ResourceAiAccessService, "getStatusForResource")
      .mockResolvedValue(resourceStatus());

    clusterStatusSpy = jest.spyOn(
      KubernetesClusterAiAccessService,
      "getStatusForCluster",
    );

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

  describe("the project switches, by lane", () => {
    test("the root read selects the resource columns that tell a resource round from a rule round", async () => {
      await callApprove();

      const rootSelect: Record<string, unknown> | undefined = (
        suggestionFindSpy.mock.calls as Array<
          Array<{
            select: Record<string, unknown>;
            props: { isRoot?: boolean };
          }>
        >
      )
        .map(
          (
            call: Array<{
              select: Record<string, unknown>;
              props: { isRoot?: boolean };
            }>,
          ) => {
            return call[0]!;
          },
        )
        .find((args: { props: { isRoot?: boolean } }) => {
          return args.props?.isRoot === true;
        })?.select;

      expect(rootSelect).toEqual(
        expect.objectContaining({
          resourceType: true,
          resourceId: true,
          autoRemediationRuleId: true,
        }),
      );
    });

    test("a resource round is approvable with AI command execution off, and runs the plan", async () => {
      expectClaimedAndExecuted(await callApprove());

      // The agent is not a Runner row: the Runner table is never read for it.
      expect(runnerFindSpy).not.toHaveBeenCalled();
      expect(clusterStatusSpy).not.toHaveBeenCalled();
      // One status read, shared by the agent check and the command re-check.
      expect(statusSpy).toHaveBeenCalledTimes(1);
      expect(statusSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        resourceType: AiResourceType.DockerHost,
        resourceId: new ObjectID(RESOURCE_ID),
      });
    });

    test("a RULE round whose plan has resource commands still needs the opt-in", async () => {
      mockRow(
        resourceRoundRow([resourceCommandJson()], {
          resourceType: undefined,
          resourceId: undefined,
          autoRemediationRuleId: RULE_ID,
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain("AI command execution is disabled");
    });

    test.each([
      ["AI", { enableAi: false }],
      ["auto-remediation", { enableAutoRemediation: false }],
    ])(
      "a resource round is stopped when %s is disabled for the project",
      async (_label: string, overrides: Record<string, unknown>) => {
        projectFindSpy.mockResolvedValue(fakeProject(overrides));

        const error: BadDataException = expectRefusedBeforeClaim(
          await callApprove(),
        );
        expect(error.message).toContain(
          "AI or auto-remediation is disabled for this project",
        );
      },
    );
  });

  describe("the resource AI agent as the plan's target", () => {
    test("refuses when the agent is offline", async () => {
      statusSpy.mockResolvedValue(
        resourceStatus({
          agent: {
            agentId: AGENT_ID,
            connectionStatus: "connected",
            isOnline: false,
            posture: posture(),
          },
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        'The Docker AI agent of Docker host "web-1" is offline',
      );
      expect(error.message).toContain("AI → AI agent");
    });

    test("refuses when the resource is reached through another agent now", async () => {
      statusSpy.mockResolvedValue(
        resourceStatus({
          agent: {
            agentId: OTHER_AGENT_ID,
            connectionStatus: "connected",
            isOnline: true,
            posture: posture(),
          },
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        "is no longer reached through the Docker AI agent this plan was composed for",
      );
      expect(runnerFindSpy).not.toHaveBeenCalled();
    });

    test("refuses a Bash step aimed at the resource's agent", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson(),
          {
            sequence: 2,
            stepType: RunbookStepType.Bash,
            runnerId: AGENT_ID,
            runnerNameSnapshot: "Docker AI agent",
            command: "systemctl restart docker",
            timeoutInMs: 30000,
            rationale: "r",
            expectedEffect: "e",
            policyVerdict: "RequiresApproval",
          } as JSONObject,
        ]),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        "Command 2 is a Bash step on the Docker AI agent",
      );
      expect(error.message).toContain("runs only ResourceCommand steps");
    });

    test("refuses a step for another resource sent to the same agent", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson(),
          resourceCommandJson({ sequence: 2, resourceId: OTHER_RESOURCE_ID }),
        ]),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        "Command 2 names a different resource than the Docker AI agent it is sent to serves",
      );
    });

    test("refuses when the resource was deleted", async () => {
      statusSpy.mockResolvedValue(null);

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        'Docker host "web-1" (command 1) no longer exists in this project',
      );
    });

    test("a Runner step in the same plan is still checked against the Runner table", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson(),
          {
            sequence: 2,
            stepType: RunbookStepType.Bash,
            runnerId: RUNNER_ID,
            runnerNameSnapshot: "web-runner-1",
            command: "systemctl status nginx",
            timeoutInMs: 30000,
            rationale: "r",
            expectedEffect: "e",
            policyVerdict: "RequiresApproval",
          } as JSONObject,
        ]),
      );
      runnerFindSpy.mockResolvedValue(null);

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        "A Runner this plan targets no longer accepts AI commands",
      );
    });
  });

  describe("the live re-check of every resource command", () => {
    test("refuses when the resource no longer allows remediation, naming the gap and its next step", async () => {
      statusSpy.mockResolvedValue(
        resourceStatus({
          isRemediationReady: false,
          gaps: [
            {
              code: "remediation_write_access_missing",
              title: "The Docker AI agent is read-only",
              nextStep:
                "Set ONEUPTIME_AI_ALLOW_WRITES=true on the Docker AI agent and restart it.",
              blocksInvestigation: false,
              blocksRemediation: true,
            },
          ],
        }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        'Docker host "web-1" (command 1) no longer allows AI remediation: The Docker AI agent is read-only — Set ONEUPTIME_AI_ALLOW_WRITES=true',
      );
      expect(error.message).toContain(
        "the Docker host's AI agent page (AI → AI agent)",
      );
    });

    test("refuses a command the policy denies now", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson({ command: "docker exec web sh" }),
        ]),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        "Command 1 is denied by the Docker host command policy",
      );
      expect(error.message).toContain("Nothing ran.");
    });

    test("refuses a command the agent's write scope rules out, with the next step", async () => {
      statusSpy.mockResolvedValue(
        resourceStatus({}, { protectedTargets: ["web"] }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        'Command 1 cannot run on Docker host "web-1"',
      );
      expect(error.message).toContain("which the Docker AI agent protects");
      expect(error.message).toContain(
        "change the Docker AI agent's write access (ONEUPTIME_AI_ALLOW_WRITES and ONEUPTIME_AI_WRITE_TARGETS",
      );
    });

    test("refuses a plan whose ROLLBACK the agent's write scope rules out", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson({
            command: "docker stop web",
            rollbackCommand: "docker start api",
          }),
        ]),
      );
      statusSpy.mockResolvedValue(
        resourceStatus({}, { writeTargets: ["web"] }),
      );

      const error: BadDataException = expectRefusedBeforeClaim(
        await callApprove(),
      );
      expect(error.message).toContain(
        'Command 1\'s rollback cannot run on Docker host "web-1"',
      );
      expect(error.message).toContain("ONEUPTIME_AI_WRITE_TARGETS=web");
    });

    test("reads each resource once, however many commands target it", async () => {
      mockRow(
        resourceRoundRow([
          resourceCommandJson(),
          resourceCommandJson({ sequence: 2, command: "docker restart web" }),
        ]),
      );

      expectClaimedAndExecuted(await callApprove());
      expect(statusSpy).toHaveBeenCalledTimes(1);
    });
  });
});
