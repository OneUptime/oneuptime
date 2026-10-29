import CommonAPI from "../../../Server/API/CommonAPI";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import ExternalMcpServerService from "../../../Server/Services/ExternalMcpServerService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import ProjectService from "../../../Server/Services/ProjectService";
import McpRemediationRunner from "../../../Server/Utils/AI/Remediation/McpRemediationRunner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import ExternalMcpServer from "../../../Models/DatabaseModels/ExternalMcpServer";
import Project from "../../../Models/DatabaseModels/Project";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlanUtil,
  ExternalMcpToolCallStatus,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * Approving and dismissing a fix through the project's external MCP
 * servers (POST /auto-remediation/approve and /dismiss).
 *
 *   - Approving makes exactly the changes OneUptime AI recorded, through
 *     McpRemediationRunner.executeApprovedCalls, once: the approval is
 *     claimed (Suggested -> Approved) before anything is made, and the
 *     verification window starts.
 *   - It is refused, before anything is claimed or made, for someone who
 *     may not run runbooks, while Enable AI is off, for a fix with no
 *     change to make, and when a server a change goes to was turned off or
 *     removed - saying which, and how to go on.
 *   - Dismissing a fix that already made changes says so, and pings the
 *     workspace: nothing is undone.
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

const registerRoute: (
  method: string,
) => (
  uri: string,
  _middleware: RouterFunction,
  handler: RouterFunction,
) => void = (method: string) => {
  return (
    uri: string,
    _middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({ method: method.toUpperCase(), uri, handlerFunction });
  };
};

const mockRouter: Record<string, jest.Mock> = {
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

const APPROVE_ROUTE: string = "/auto-remediation/approve";
const DISMISS_ROUTE: string = "/auto-remediation/dismiss";

const PROJECT_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b01",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b02",
);
const USER_ID: ObjectID = new ObjectID("aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b03");
const INCIDENT_ID: ObjectID = new ObjectID(
  "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b04",
);
const AWS_ID: string = "aa1b6f0e-1f1c-4f43-9a7c-3e4a2d6c8b05";

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
}

async function callRoute(uri: string): Promise<RouteCallResult> {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    {
      params: {},
      query: {},
      headers: {},
      body: { suggestionId: SUGGESTION_ID.toString() },
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function caller(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };
    }),
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function call(
  sequence: number,
  status: ExternalMcpToolCallStatus,
  serverId: string = AWS_ID,
): ExternalMcpToolCall {
  return {
    sequence,
    serverId,
    serverNameSnapshot: "AWS",
    toolName: "restart_service",
    arguments: { service: "api" },
    status,
  };
}

function mcpFixRow(
  calls: Array<ExternalMcpToolCall>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SUGGESTION_ID,
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.McpToolCalls,
    mcpToolCallPlan: ExternalMcpToolCallPlanUtil.toJSON({ calls }),
    verificationWindowMinutes: 15,
    ruleNameSnapshot: "Fix the API",
    ...overrides,
  };
}

function awsServer(): ExternalMcpServer {
  const server: ExternalMcpServer = new ExternalMcpServer();
  server.id = new ObjectID(AWS_ID);
  server._id = AWS_ID;
  server.projectId = PROJECT_ID;
  return server;
}

describe("approving and dismissing a fix through MCP servers", () => {
  let row: Record<string, unknown>;
  let casSpy: jest.SpyInstance;
  let projectFindSpy: jest.SpyInstance;
  let serversSpy: jest.SpyInstance;
  let executeSpy: jest.SpyInstance;
  let feedSpy: jest.SpyInstance;

  beforeAll(async () => {
    await import("../../../Server/API/AutoRemediationAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    row = mcpFixRow([call(1, ExternalMcpToolCallStatus.Proposed)]);

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(caller());

    jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockImplementation((async (args: {
        select: Record<string, unknown>;
      }): Promise<AutoRemediationSuggestion> => {
        const picked: Record<string, unknown> = { id: row["id"] };

        for (const key of Object.keys(args.select)) {
          if (key in row) {
            picked[key] = row[key];
          }
        }

        return picked as unknown as AutoRemediationSuggestion;
      }) as never);

    casSpy = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    projectFindSpy = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ enableAi: true } as unknown as Project as never);

    serversSpy = jest
      .spyOn(ExternalMcpServerService, "findServersForRun")
      .mockResolvedValue([awsServer()] as never);

    executeSpy = jest
      .spyOn(McpRemediationRunner, "executeApprovedCalls")
      .mockResolvedValue(undefined as never);

    feedSpy = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectRefused(result: RouteCallResult, message: string): void {
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toContain(
      message,
    );
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  }

  test("approving claims the fix, starts its verification window, and makes exactly the recorded changes", async () => {
    const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

    expect(result.nextCallCount).toBe(0);
    expect(casSpy).toHaveBeenCalledTimes(1);
    expect(casSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AutoRemediationSuggestionStatus.Suggested,
        set: expect.objectContaining({
          status: AutoRemediationSuggestionStatus.Approved,
          approvedByUserId: USER_ID.toString(),
          verificationStatus: AutoRemediationVerificationStatus.Pending,
        }),
      }),
    );
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith({ suggestionId: SUGGESTION_ID });
    expect(serversSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      allowance: { isEveryServer: false, serverIds: [AWS_ID] },
    });
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
    const approval: string = String(
      feedSpy.mock.calls[0]![0].feedInfoInMarkdown,
    );
    expect(approval).toContain("Fix through MCP servers approved");
    // The count in words, as the channel reads it: never "1 change(s)".
    expect(approval).toContain("(1 change)");
    expect(approval).not.toContain("change(s)");
  });

  test("a click that lost to someone else's makes nothing", async () => {
    casSpy.mockResolvedValue(0 as never);

    const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

    expect(result.nextCallCount).toBe(1);
    expect((result.thrownToNext as BadDataException).message).toContain(
      "just actioned by someone else",
    );
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("someone who may not run runbooks may not approve it", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(caller([Permission.Viewer]));

    const result: RouteCallResult = await callRoute(APPROVE_ROUTE);

    expect(result.nextCallCount).toBe(1);
    expect(casSpy).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("refused while Enable AI is off", async () => {
    projectFindSpy.mockResolvedValue({
      enableAi: false,
    } as unknown as Project as never);

    expectRefused(await callRoute(APPROVE_ROUTE), "AI is disabled");
  });

  test("refused for a fix with no change to make", async () => {
    row = mcpFixRow([call(1, ExternalMcpToolCallStatus.Skipped)]);

    expectRefused(
      await callRoute(APPROVE_ROUTE),
      "This suggestion has no changes to make.",
    );
  });

  test("refused when a server a change goes to was turned off or removed, naming it", async () => {
    serversSpy.mockResolvedValue([] as never);

    const result: RouteCallResult = await callRoute(APPROVE_ROUTE);
    expectRefused(
      result,
      'The MCP server "AWS" this fix uses was turned off or removed',
    );
    // Where to turn it on, by the menu's own path (ProjectSettingsMenuPathsInProductText).
    expect((result.thrownToNext as BadDataException).message).toContain(
      "Turn the server on again under Project Settings → AI → External MCP Servers",
    );
  });

  test("only a fix waiting for approval can be approved", async () => {
    row = mcpFixRow([call(1, ExternalMcpToolCallStatus.Proposed)], {
      status: AutoRemediationSuggestionStatus.Planning,
    });

    expectRefused(
      await callRoute(APPROVE_ROUTE),
      "Only suggested remediations can be approved",
    );
  });

  test("dismissing a proposed fix says it will not be made", async () => {
    const result: RouteCallResult = await callRoute(DISMISS_ROUTE);

    expect(result.nextCallCount).toBe(0);
    const feed: { feedInfoInMarkdown: string; workspaceNotification: unknown } =
      feedSpy.mock.calls[0]![0];
    expect(feed.feedInfoInMarkdown).toContain(
      "the fix through MCP servers will not be made",
    );
    expect(feed.workspaceNotification).toEqual({
      sendWorkspaceNotification: false,
      leadWithAuthor: true,
    });
    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("dismissing a fix that already made changes says so, and pings the workspace", async () => {
    row = mcpFixRow(
      [
        call(1, ExternalMcpToolCallStatus.Succeeded),
        call(2, ExternalMcpToolCallStatus.Running),
      ],
      { status: AutoRemediationSuggestionStatus.Planning },
    );
    casSpy.mockResolvedValueOnce(0 as never).mockResolvedValueOnce(1 as never);

    const result: RouteCallResult = await callRoute(DISMISS_ROUTE);

    expect(result.nextCallCount).toBe(0);
    const feed: { feedInfoInMarkdown: string; workspaceNotification: unknown } =
      feedSpy.mock.calls[0]![0];
    expect(feed.feedInfoInMarkdown).toContain(
      "2 changes through MCP servers had ALREADY been made",
    );
    expect(feed.feedInfoInMarkdown).toContain("nothing was undone");
    // Opening with whoever dismissed it, as the feed names them.
    expect(feed.workspaceNotification).toEqual({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
  });
});
