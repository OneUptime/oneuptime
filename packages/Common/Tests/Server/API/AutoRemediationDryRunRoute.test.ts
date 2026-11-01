import CommonAPI from "../../../Server/API/CommonAPI";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import ResourceAiAccessService from "../../../Server/Services/ResourceAiAccessService";
import CloudChangeDryRun, {
  CloudDryRunStart,
} from "../../../Server/Utils/AutoRemediation/CloudChangeDryRun";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
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
 * POST /auto-remediation/dry-run (Common/Server/API/AutoRemediationAPI.ts):
 * "Dry run" / "Dry run again" on the Remediation card.
 *
 * Pinned here:
 * - it checks a fix that waits for approval (Suggested, a command plan)
 *   with at least one cloud change that has not run, and nothing else;
 * - the bar is approving's: running runbooks in the project, and an edit
 *   of every resource the plan changes - the dry run is a job sent to the
 *   account's Cloud AI agent;
 * - it answers once each change is marked as being checked
 *   (CloudChangeDryRun.startDryRun), so the card's read right after shows
 *   the dry run on its way; the dry runs go on in the background; refused,
 *   it starts nothing.
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

const registerRoute: (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void = (method: string) => {
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

const DRY_RUN_ROUTE: string = "/auto-remediation/dry-run";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const AGENT_ID: string = "55555555-5555-4555-8555-555555555555";
const ACCOUNT_ID: string = "77777777-7777-4777-8777-777777777777";
const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";

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

async function callDryRun(): Promise<RouteCallResult> {
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

  await matchRoute(DRY_RUN_ROUTE).handlerFunction(
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

function cloudCommandJson(
  overrides: Partial<Record<string, unknown>> = {},
): JSONObject {
  return {
    sequence: 1,
    stepType: RunbookStepType.ResourceCommand,
    runnerId: AGENT_ID,
    runnerNameSnapshot: "Cloud AI agent",
    resourceType: AiResourceType.AwsAccount,
    resourceId: ACCOUNT_ID,
    resourceNameSnapshot: "prod",
    resourceCommandTier: "SafeWrite",
    command: `cloud scale-out ${ECS} --count 4`,
    timeoutInMs: 60000,
    rationale: "more tasks",
    expectedEffect: "latency drops",
    policyVerdict: "RequiresApproval",
    ...overrides,
  } as JSONObject;
}

function suggestionRow(
  commands: Array<JSONObject>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: new ObjectID(SUGGESTION_ID.toString()),
    _id: SUGGESTION_ID.toString(),
    projectId: PROJECT_ID,
    status: AutoRemediationSuggestionStatus.Suggested,
    suggestionType: AutoRemediationSuggestionType.CommandPlan,
    commandPlan: { commands } as JSONObject,
    resourceType: AiResourceType.AwsAccount,
    resourceId: new ObjectID(ACCOUNT_ID),
    ...overrides,
  };
}

describe("POST /auto-remediation/dry-run", () => {
  let suggestionFindSpy: jest.SpyInstance;
  let mayChangeSpy: jest.SpyInstance;
  let dryRunSpy: jest.SpyInstance;

  beforeAll(async () => {
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

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildUserProps());

    suggestionFindSpy = jest.spyOn(
      AutoRemediationSuggestionService,
      "findOneById",
    );
    mockRow(suggestionRow([cloudCommandJson()]));

    mayChangeSpy = jest
      .spyOn(ResourceAiAccessService, "assertCallerMayChangeResource")
      .mockResolvedValue(undefined);

    dryRunSpy = jest
      .spyOn(CloudChangeDryRun, "startDryRun")
      .mockResolvedValue({ kind: "started", changes: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectRefused(result: RouteCallResult): Error {
    expect(result.nextCallCount).toBe(1);
    expect(dryRunSpy).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    return result.thrownToNext as Error;
  }

  test("is mounted once, as a POST", () => {
    expect(
      mockRoutes.filter((route: MockRoute): boolean => {
        return route.uri === DRY_RUN_ROUTE;
      }),
    ).toHaveLength(1);
  });

  test("starts the dry run of a fix that waits for approval, and answers at once", async () => {
    const result: RouteCallResult = await callDryRun();

    expect(result.nextCallCount).toBe(0);
    expect(dryRunSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        dryRunSpy.mock.calls[0]![0] as { suggestionId: ObjectID }
      ).suggestionId.toString(),
    ).toBe(SUGGESTION_ID.toString());
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponseMock.mock.calls[0]![2]).toEqual({
      suggestionId: SUGGESTION_ID.toString(),
      started: true,
      changes: 1,
    });
  });

  test("holds the caller to approving's bar: an edit of every resource the plan changes", async () => {
    await callDryRun();

    expect(mayChangeSpy).toHaveBeenCalledTimes(1);
    expect(mayChangeSpy).toHaveBeenCalledWith({
      props: expect.anything(),
      projectId: PROJECT_ID,
      resourceType: AiResourceType.AwsAccount,
      resourceId: new ObjectID(ACCOUNT_ID),
    });

    mayChangeSpy.mockRejectedValue(
      new NotAuthorizedException("You may not change this AWS account."),
    );
    sendJsonObjectResponseMock.mockClear();
    dryRunSpy.mockClear();

    const error: Error = expectRefused(await callDryRun());

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("a caller who may not run runbooks may not ask for one", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(buildUserProps([Permission.Viewer]));

    expectRefused(await callDryRun());
  });

  test.each([
    AutoRemediationSuggestionStatus.Approved,
    AutoRemediationSuggestionStatus.AutoExecuted,
    AutoRemediationSuggestionStatus.Dismissed,
    AutoRemediationSuggestionStatus.Planning,
  ])(
    "a %s fix is not dry-run",
    async (status: AutoRemediationSuggestionStatus) => {
      mockRow(suggestionRow([cloudCommandJson()], { status }));

      const error: Error = expectRefused(await callDryRun());

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(
        "Only a fix that waits for approval can be checked with a dry run.",
      );
    },
  );

  test("a runbook a rule proposes is not dry-run", async () => {
    mockRow(
      suggestionRow([], {
        suggestionType: AutoRemediationSuggestionType.Runbook,
        commandPlan: null,
      }),
    );

    expect(expectRefused(await callDryRun()).message).toBe(
      "Only a fix that waits for approval can be checked with a dry run.",
    );
  });

  test("a fix that changes no cloud account has nothing to dry-run", async () => {
    mockRow(
      suggestionRow([
        cloudCommandJson({
          resourceType: AiResourceType.DockerHost,
          runnerNameSnapshot: "Docker AI agent",
          command: "docker restart web",
        }),
      ]),
    );

    expect(expectRefused(await callDryRun()).message).toBe(
      "This fix changes no cloud account, so there is nothing to dry-run.",
    );
    expect(mayChangeSpy).not.toHaveBeenCalled();
  });

  test("answers only once the changes are marked as being checked, never before", async () => {
    let markDone: (start: CloudDryRunStart) => void = (): void => {
      return undefined;
    };

    dryRunSpy.mockImplementation((): Promise<CloudDryRunStart> => {
      return new Promise<CloudDryRunStart>(
        (resolve: (start: CloudDryRunStart) => void): void => {
          markDone = resolve;
        },
      );
    });

    const call: Promise<RouteCallResult> = callDryRun();

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
    expect(dryRunSpy).toHaveBeenCalledTimes(1);
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();

    markDone({ kind: "started", changes: 1 });

    expect((await call).nextCallCount).toBe(0);
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  });

  test("while another dry run of it runs, it answers that none was started: that one marked the changes already", async () => {
    dryRunSpy.mockResolvedValue({ kind: "busy" });

    const result: RouteCallResult = await callDryRun();

    expect(result.nextCallCount).toBe(0);
    expect(sendJsonObjectResponseMock.mock.calls[0]![2]).toEqual({
      suggestionId: SUGGESTION_ID.toString(),
      started: false,
      changes: 1,
    });
  });

  test("approved or dismissed between the check and the mark: refused with why", async () => {
    dryRunSpy.mockResolvedValue({ kind: "not-awaiting-approval" });

    const result: RouteCallResult = await callDryRun();

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Error).message).toBe(
      "This fix no longer waits for approval, so there is nothing to dry-run.",
    );
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });

  test("a fix it could not read or mark is an error, and nothing is answered as started", async () => {
    dryRunSpy.mockRejectedValue(new Error("database down"));

    const result: RouteCallResult = await callDryRun();

    expect(result.nextCallCount).toBe(1);
    expect((result.thrownToNext as Error).message).toBe("database down");
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });
});
