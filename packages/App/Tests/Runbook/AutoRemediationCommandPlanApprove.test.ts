import CommonAPI from "Common/Server/API/CommonAPI";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "Common/Server/Services/AutoRemediationSuggestionService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import ProjectService from "Common/Server/Services/ProjectService";
import RunbookRuleEngineService from "Common/Server/Services/RunbookRuleEngineService";
import RunnerService from "Common/Server/Services/RunnerService";
import CommandPlanExecutor from "Common/Server/Utils/AutoRemediation/CommandPlanExecutor";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import Project from "Common/Models/DatabaseModels/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import Runner from "Common/Models/DatabaseModels/Runner";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import { AiRemediationCommandExecutionStatus } from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
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
 * Route tests for the CommandPlan branch of the auto-remediation approve and
 * dismiss endpoints (Common/Server/API/AutoRemediationAPI.ts).
 *
 * Approving a CommandPlan suggestion runs AI-composed Bash/SSH commands on
 * the project's own Runners, so the invariants pinned here are the ones that
 * keep that from happening without authority or twice:
 *
 * - the runbook-execute permission gate fires BEFORE any state is claimed —
 *   a denied caller must leave no CAS attempt behind;
 * - the PROJECT opt-in is re-read at approval time, not trusted from when
 *   the plan was composed: a project that has since turned AI command
 *   execution (or AI, or auto-remediation) off rejects the plan before any
 *   claim, and the check runs before the Runner-consent loop;
 * - a plan that fails fail-closed parsing (missing, empty, denylisted
 *   verdict) is rejected without claiming the suggestion;
 * - a target Runner that lost canRunAiCommands consent (or was deleted)
 *   since the plan was composed rejects the whole plan up front;
 * - the CAS Suggested -> Approved carries the approver's id plus the
 *   verification stamps, and losing the CAS is a clean 400 with the plan
 *   never handed to the executor;
 * - the executor is fired DETACHED — the response is sent while the plan's
 *   promise is still pending — and told only the suggestion id;
 * - dismissing a CommandPlan suggestion posts the command-plan feed wording,
 *   not the runbook wording;
 * - dismissing a plan whose commands ALREADY ran tells the truth about it —
 *   the feed says how many ran and that nothing was rolled back, and the
 *   workspace is pinged, because those changes are now outside the
 *   verification loop.
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

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
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

jest.mock("Common/Server/Utils/Response", () => {
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

/*
 * The executor is not under test — what matters is whether (and with what)
 * the route fires it, and that the route does not wait for it. Mocking the
 * module also keeps the RunnerJob claim machinery out of this suite.
 */
jest.mock("Common/Server/Utils/AutoRemediation/CommandPlanExecutor", () => {
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
const RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const RUNBOOK_EXECUTION_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
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

async function callRoute(data: {
  uri: string;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: data.body || { suggestionId: SUGGESTION_ID.toString() },
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute(data.uri).handlerFunction(
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
 * Shaped like what CommonAPI.getDatabaseCommonInteractionProps returns for a
 * logged-in dashboard user whose request carried a `tenantid` header.
 */
function buildUserProps(data: {
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: data.permissions.map((permission: Permission) => {
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

function validCommandJson(
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

function validPlanJson(): JSONObject {
  return {
    commands: [validCommandJson()],
  } as JSONObject;
}

/*
 * The project row as the approve route selects it: the three switches that
 * together gate the AI command-execution lane.
 */
function fakeProject(
  overrides: Partial<Record<string, unknown>> = {},
): Project {
  return {
    _id: PROJECT_ID.toString(),
    id: PROJECT_ID,
    enableAi: true,
    enableAutoRemediation: true,
    enableAiCommandExecution: true,
    ...overrides,
  } as unknown as Project;
}

function executedCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return validCommandJson({
    wasAutoExecuted: true,
    execution: {
      status: AiRemediationCommandExecutionStatus.Succeeded,
      runnerJobId: "77777777-7777-4777-8777-777777777777",
      output: "nginx restarted",
      exitCode: 0,
      startedAt: "2024-01-01T00:00:00.000Z",
      completedAt: "2024-01-01T00:00:05.000Z",
    },
    ...overrides,
  });
}

function fakeSuggestion(
  overrides: Partial<Record<string, unknown>> = {},
): AutoRemediationSuggestion {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: validPlanJson(),
    verificationWindowMinutes: 15,
    ruleNameSnapshot: "High CPU on web tier",
    ...overrides,
  } as unknown as AutoRemediationSuggestion;
}

describe("Auto-remediation CommandPlan approve/dismiss routes", () => {
  let getPropsSpy: jest.SpyInstance;
  let suggestionFindSpy: jest.SpyInstance;
  let casSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let runnerFindSpy: jest.SpyInstance;
  let incidentFeedSpy: jest.SpyInstance;
  let alertFeedSpy: jest.SpyInstance;

  beforeAll(async () => {
    /*
     * AutoRemediationAPI registers its routes at module scope, so the import
     * is deferred until the mock router above is fully constructed.
     */
    await import("Common/Server/API/AutoRemediationAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();

    executeApprovedPlanMock.mockResolvedValue(undefined);

    getPropsSpy = jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(
        buildUserProps({ permissions: [Permission.ProjectMember] }),
      );

    /*
     * The route reads the suggestion twice — once under the caller's props
     * as the access check, once as root for the full row. Both get the same
     * fake unless a test overrides it.
     */
    suggestionFindSpy = jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(fakeSuggestion());

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);

    /*
     * The approve route re-reads the project's AI switches before claiming.
     * Fully opted in unless a test says otherwise.
     */
    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(fakeProject());

    runnerFindSpy = jest.spyOn(RunnerService, "findOneBy").mockResolvedValue({
      _id: RUNNER_ID.toString(),
    } as unknown as Runner);

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

  function mockSuggestion(overrides: Partial<Record<string, unknown>>): void {
    suggestionFindSpy.mockResolvedValue(fakeSuggestion(overrides));
  }

  function expectNoClaimAndNoExecution(): void {
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeApprovedPlanMock).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  }

  describe("POST /auto-remediation/approve — permission gate", () => {
    test("a caller without a runbook-execute permission is rejected with NO CAS attempted", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({ permissions: [Permission.Viewer] }),
      );

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      // The gate fires before the plan is even inspected.
      expect(runnerFindSpy).not.toHaveBeenCalled();
      expectNoClaimAndNoExecution();
    });

    test("a credential-less caller is rejected before the suggestion is read at all", async () => {
      getPropsSpy.mockResolvedValue({
        userType: UserType.Public,
        tenantId: PROJECT_ID,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(suggestionFindSpy).not.toHaveBeenCalled();
      expectNoClaimAndNoExecution();
    });
  });

  describe("POST /auto-remediation/approve — project opt-in re-check", () => {
    /*
     * The plan may have been composed hours before a human clicks Approve.
     * Whatever the project allowed back then is irrelevant — the switch as
     * it stands NOW decides, and turning it off must stop pending plans, not
     * just new ones.
     */
    test.each([
      ["the project row is gone", null],
      [
        "enableAiCommandExecution is false",
        fakeProject({ enableAiCommandExecution: false }),
      ],
      [
        "enableAiCommandExecution was never set",
        fakeProject({ enableAiCommandExecution: undefined }),
      ],
      ["enableAi is false", fakeProject({ enableAi: false })],
      [
        "enableAutoRemediation is false",
        fakeProject({ enableAutoRemediation: false }),
      ],
    ])(
      "refuses to run the plan when %s — nothing claimed, nothing executed",
      async (_label: string, project: Project | null) => {
        projectFindSpy.mockResolvedValue(project);

        const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as BadDataException).message).toContain(
          "AI command execution is disabled",
        );
        // Rejected before the plan is even parsed or its Runners polled.
        expect(runnerFindSpy).not.toHaveBeenCalled();
        expectNoClaimAndNoExecution();
      },
    );

    test("reads the project as root, by the SUGGESTION's project id", async () => {
      await callRoute({ uri: APPROVE_ROUTE });

      expect(projectFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PROJECT_ID,
          select: expect.objectContaining({
            enableAi: true,
            enableAutoRemediation: true,
            enableAiCommandExecution: true,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
    });

    test("a fully opted-in project proceeds — and the opt-in was checked BEFORE the Runner consent loop and the claim", async () => {
      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(projectFindSpy).toHaveBeenCalledTimes(1);
      expect(casSpy).toHaveBeenCalledTimes(1);
      expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);

      const projectOrder: number = projectFindSpy.mock.invocationCallOrder[0]!;
      expect(projectOrder).toBeLessThan(
        runnerFindSpy.mock.invocationCallOrder[0]!,
      );
      expect(projectOrder).toBeLessThan(casSpy.mock.invocationCallOrder[0]!);
    });

    test("the opt-in is NOT re-checked for a runbook suggestion — that lane has its own gates", async () => {
      mockSuggestion({
        suggestionType: AutoRemediationSuggestionType.Runbook,
        commandPlan: undefined,
        runbookId: RUNBOOK_ID,
      });
      const startRunbookSpy: jest.SpyInstance = jest
        .spyOn(RunbookRuleEngineService, "startRunbookFor")
        .mockResolvedValue({
          id: RUNBOOK_EXECUTION_ID,
        } as unknown as RunbookExecution);
      jest
        .spyOn(AutoRemediationSuggestionService, "updateOneById")
        .mockResolvedValue(undefined as never);

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(startRunbookSpy).toHaveBeenCalledTimes(1);
      // The command-execution switch has no say over the runbook lane.
      expect(projectFindSpy).not.toHaveBeenCalled();
      expect(executeApprovedPlanMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /auto-remediation/approve — plan validation", () => {
    test.each([
      ["is missing entirely", undefined],
      ["has no commands", { commands: [] } as JSONObject],
      [
        "carries a Denied policy verdict",
        {
          commands: [validCommandJson({ policyVerdict: "Denied" })],
        } as JSONObject,
      ],
      [
        "uses a step type outside Bash/SSH",
        {
          commands: [validCommandJson({ stepType: RunbookStepType.Manual })],
        } as JSONObject,
      ],
    ])(
      "rejects without claiming the suggestion when the plan %s",
      async (_label: string, commandPlan: JSONObject | undefined) => {
        mockSuggestion({ commandPlan });

        const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect((result.thrownToNext as BadDataException).message).toContain(
          "no valid command plan",
        );
        expect(runnerFindSpy).not.toHaveBeenCalled();
        expectNoClaimAndNoExecution();
      },
    );
  });

  describe("POST /auto-remediation/approve — Runner consent re-check", () => {
    test("rejects the whole plan when a target Runner no longer accepts AI commands", async () => {
      runnerFindSpy.mockResolvedValue(null);

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as BadDataException).message).toContain(
        "no longer accepts AI commands",
      );
      // The consent query is pinned: id + project + the consent flag itself.
      expect(runnerFindSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            _id: RUNNER_ID.toString(),
            projectId: PROJECT_ID,
            canRunAiCommands: true,
          }),
          props: expect.objectContaining({ isRoot: true }),
        }),
      );
      expectNoClaimAndNoExecution();
    });

    test("checks each distinct Runner exactly once even when commands share one", async () => {
      mockSuggestion({
        commandPlan: {
          commands: [
            validCommandJson({ sequence: 1 }),
            validCommandJson({
              sequence: 2,
              command: "systemctl status nginx",
            }),
            validCommandJson({
              sequence: 3,
              runnerId: OTHER_RUNNER_ID.toString(),
              command: "systemctl restart php-fpm",
            }),
          ],
        } as JSONObject,
      });

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(runnerFindSpy).toHaveBeenCalledTimes(2);

      const queriedRunnerIds: Array<string> = runnerFindSpy.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { query: { _id: string } }).query._id;
        },
      );
      expect(queriedRunnerIds.sort()).toEqual(
        [RUNNER_ID.toString(), OTHER_RUNNER_ID.toString()].sort(),
      );
    });
  });

  describe("POST /auto-remediation/approve — CAS claim and detached execution", () => {
    test("CAS Suggested -> Approved carries the approver and the verification stamps", async () => {
      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(casSpy).toHaveBeenCalledTimes(1);
      expect(casSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Approved,
            approvedByUserId: USER_ID.toString(),
            approvedAt: expect.any(Date),
            verificationStatus: AutoRemediationVerificationStatus.Pending,
            verificationDeadlineAt: expect.any(Date),
          }),
        }),
      );
    });

    test("fires the executor DETACHED with the suggestion id — the response does not wait for the plan", async () => {
      /*
       * A plan can legitimately take minutes, so the route must answer while
       * the executor's promise is still pending. A never-settling promise
       * proves the handler did not await it.
       */
      executeApprovedPlanMock.mockReturnValue(
        new Promise<void>((): void => {
          /* never settles */
        }),
      );

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(executeApprovedPlanMock).toHaveBeenCalledTimes(1);

      const executorArgs: { suggestionId: ObjectID } = executeApprovedPlanMock
        .mock.calls[0]![0] as { suggestionId: ObjectID };
      expect(executorArgs.suggestionId.toString()).toBe(
        SUGGESTION_ID.toString(),
      );

      // The response went out even though the plan never finished.
      expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
    });

    test("responds with the CommandPlan shape — no runbookExecutionId", async () => {
      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(sendJsonObjectResponseMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          suggestionId: SUGGESTION_ID.toString(),
          status: AutoRemediationSuggestionStatus.Approved,
          suggestionType: AutoRemediationSuggestionType.CommandPlan,
        },
      );
      // And the approval is announced on the incident feed with a ping.
      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          incidentId: INCIDENT_ID,
          feedInfoInMarkdown: expect.stringContaining(
            "AI command plan approved",
          ),
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: true,
          }),
        }),
      );
      expect(alertFeedSpy).not.toHaveBeenCalled();
    });

    test("losing the CAS is a clean 400 and the plan is never handed to the executor", async () => {
      casSpy.mockResolvedValue(0);

      const result: RouteCallResult = await callRoute({ uri: APPROVE_ROUTE });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as BadDataException).message).toContain(
        "just actioned",
      );
      expect(executeApprovedPlanMock).not.toHaveBeenCalled();
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
      expect(incidentFeedSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /auto-remediation/dismiss — CommandPlan wording", () => {
    test("dismissing a CommandPlan suggestion posts the command-plan feed wording, without a ping", async () => {
      const result: RouteCallResult = await callRoute({ uri: DISMISS_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(casSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.Suggested,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Dismissed,
            dismissedByUserId: USER_ID.toString(),
          }),
        }),
      );
      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          feedInfoInMarkdown: expect.stringContaining(
            "command plan will not be run",
          ),
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: false,
          }),
        }),
      );
      expect(sendJsonObjectResponseMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          suggestionId: SUGGESTION_ID.toString(),
          status: AutoRemediationSuggestionStatus.Dismissed,
        },
      );
    });

    /*
     * A FullAuto run executes commands inline while the suggestion is still
     * Planning. If a human dismisses it at that moment, "will not be run" is
     * a lie about the state of their infrastructure — the feed has to say
     * what already happened, and the workspace has to hear about it, because
     * those changes now sit outside the verification/rollback loop.
     */
    test("dismissing a Planning plan whose commands ALREADY ran says so, with the count, and pings the workspace", async () => {
      mockSuggestion({
        status: AutoRemediationSuggestionStatus.Planning,
        commandPlan: {
          commands: [
            executedCommandJson({ sequence: 1 }),
            executedCommandJson({
              sequence: 2,
              command: "systemctl restart php-fpm",
            }),
          ],
        } as JSONObject,
      });
      // The Suggested CAS loses; the Planning CAS is the one that wins.
      casSpy.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const result: RouteCallResult = await callRoute({ uri: DISMISS_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(casSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          fromStatus: AutoRemediationSuggestionStatus.Planning,
          set: expect.objectContaining({
            status: AutoRemediationSuggestionStatus.Dismissed,
          }),
        }),
      );

      expect(incidentFeedSpy).toHaveBeenCalledTimes(1);
      const markdown: string = incidentFeedSpy.mock.calls[0]![0]
        .feedInfoInMarkdown as string;
      expect(markdown).toContain("2 command(s) had ALREADY run");
      expect(markdown).toContain("nothing was rolled back");
      // The quiet wording must be nowhere near this message.
      expect(markdown).not.toContain("will not be run");

      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: true,
          }),
        }),
      );
    });

    test("a single executed command still reports honestly rather than rounding down to the quiet wording", async () => {
      mockSuggestion({
        status: AutoRemediationSuggestionStatus.Planning,
        commandPlan: {
          commands: [
            executedCommandJson({ sequence: 1 }),
            // Composed but never reached — no execution state at all.
            validCommandJson({
              sequence: 2,
              command: "systemctl status nginx",
            }),
          ],
        } as JSONObject,
      });

      const result: RouteCallResult = await callRoute({ uri: DISMISS_ROUTE });

      expect(result.nextCallCount).toBe(0);
      const markdown: string = incidentFeedSpy.mock.calls[0]![0]
        .feedInfoInMarkdown as string;
      expect(markdown).toContain("1 command(s) had ALREADY run");
    });

    test("a plan whose commands never ran keeps the quiet wording and does NOT ping the workspace", async () => {
      mockSuggestion({
        status: AutoRemediationSuggestionStatus.Planning,
        commandPlan: {
          commands: [
            validCommandJson({ sequence: 1 }),
            validCommandJson({
              sequence: 2,
              command: "systemctl status nginx",
            }),
          ],
        } as JSONObject,
      });

      const result: RouteCallResult = await callRoute({ uri: DISMISS_ROUTE });

      expect(result.nextCallCount).toBe(0);
      const markdown: string = incidentFeedSpy.mock.calls[0]![0]
        .feedInfoInMarkdown as string;
      expect(markdown).toContain("command plan will not be run");
      expect(markdown).not.toContain("ALREADY run");
      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceNotification: expect.objectContaining({
            sendWorkspaceNotification: false,
          }),
        }),
      );
    });

    test("a Runbook-type suggestion keeps the runbook wording — the two lanes do not blur", async () => {
      mockSuggestion({
        suggestionType: AutoRemediationSuggestionType.Runbook,
        commandPlan: undefined,
        runbookNameSnapshot: "Restart web tier",
      });

      const result: RouteCallResult = await callRoute({ uri: DISMISS_ROUTE });

      expect(result.nextCallCount).toBe(0);
      expect(incidentFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          feedInfoInMarkdown: expect.stringContaining(
            'runbook "Restart web tier" will not be run',
          ),
        }),
      );
    });
  });
});
