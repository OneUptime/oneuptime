import CommonAPI from "../../../Server/API/CommonAPI";
import TelemetryAiActivityReader from "../../../Server/Utils/AI/TelemetryAi/TelemetryAiActivityReader";
import TelemetryAiPersonFix from "../../../Server/Utils/AI/TelemetryAi/TelemetryAiPersonFix";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_FIX_PATH,
  TELEMETRY_AI_FIX_SUGGESTION_PATH,
  TELEMETRY_AI_LOGS_PAGE_SIZE,
  TELEMETRY_AI_LOGS_PATH,
  TELEMETRY_AI_READINESS_PATH,
  TelemetryAiLogsJSON,
  TelemetryAiReadinessJSON,
} from "../../../Types/AI/TelemetryAiActivity";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
} from "../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Common/Server/API/TelemetryAiAPI.ts - the calls behind the AI section of a
 * telemetry product's menu, the Profiler's first. Both take a signed-in user
 * inside exactly one project and a lane they know; the logs page a skip
 * within reach. The rest is TelemetryAiActivityReader's, whose suite holds
 * who sees what.
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

const mockRoutes: Array<MockRoute> = [];

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn(),
  post: jest.fn().mockImplementation(((
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({ method: "POST", uri, middleware, handlerFunction });
  }) as never),
  put: jest.fn(),
  delete: jest.fn(),
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

const PROJECT_ID: ObjectID = new ObjectID(
  "5092ffff-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("5092ffff-2222-4222-8222-222222222222");

function signedInProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    isMultiTenantRequest: true,
    userTenantAccessPermission: {},
    ...overrides,
  } as DatabaseCommonInteractionProps;
}

function routeFor(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No route for ${uri}`);
  }

  return route;
}

interface CallResult {
  error: unknown;
  sent: JSONObject | undefined;
}

async function call(uri: string, body: unknown): Promise<CallResult> {
  const next: jest.Mock = jest.fn();
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  await routeFor(uri).handlerFunction(
    { params: {}, query: {}, body, headers: {} } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const lastSend: Array<unknown> | undefined =
    sendJson.mock.calls[sendJson.mock.calls.length - 1];

  return {
    error: next.mock.calls[0]?.[0],
    sent: lastSend ? (lastSend[2] as JSONObject) : undefined,
  };
}

const READINESS: TelemetryAiReadinessJSON = {
  lane: TelemetryAiLane.Profile,
  isAiEnabled: true,
  isLaneOn: true,
  connectedRepositoryCount: 1,
  blocker: null,
  automaticFixesToday: 0,
  maxAutomaticFixesPerDay: 5,
};

const LOGS: TelemetryAiLogsJSON = { entries: [], totalCount: 0 };

const INSIGHT_ID: string = "5092ffff-3333-4333-8333-333333333333";
const REPOSITORY_ID: string = "5092ffff-4444-4444-8444-444444444444";

const SUGGESTION: TelemetryAiFixSuggestion = {
  ...NO_TELEMETRY_AI_FIX_SUGGESTION,
  offer: SuggestionOffer.Act,
  repository: { id: REPOSITORY_ID, name: "acme/checkout" },
};

let readinessSpy: jest.SpiedFunction<
  typeof TelemetryAiActivityReader.readReadiness
>;
let logsSpy: jest.SpiedFunction<typeof TelemetryAiActivityReader.readLogs>;
let propsSpy: jest.SpiedFunction<
  typeof CommonAPI.getDatabaseCommonInteractionProps
>;
let suggestionSpy: jest.SpiedFunction<
  typeof TelemetryAiPersonFix.getSuggestion
>;
let fixSpy: jest.SpiedFunction<typeof TelemetryAiPersonFix.createFixTask>;

beforeAll(async () => {
  // The routes register at import, once the mock router exists.
  await import("../../../Server/API/TelemetryAiAPI");
});

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  readinessSpy = jest
    .spyOn(TelemetryAiActivityReader, "readReadiness")
    .mockResolvedValue(READINESS);
  logsSpy = jest
    .spyOn(TelemetryAiActivityReader, "readLogs")
    .mockResolvedValue(LOGS);
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(signedInProps());
  suggestionSpy = jest
    .spyOn(TelemetryAiPersonFix, "getSuggestion")
    .mockResolvedValue(SUGGESTION);
  fixSpy = jest
    .spyOn(TelemetryAiPersonFix, "createFixTask")
    .mockResolvedValue({ taskId: "5092ffff-5555-4555-8555-555555555555" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the telemetry AI routes", () => {
  test("four, each behind the user middleware", () => {
    expect(TELEMETRY_AI_READINESS_PATH).toBe("/telemetry-ai/readiness");
    expect(TELEMETRY_AI_LOGS_PATH).toBe("/telemetry-ai/logs");
    expect(TELEMETRY_AI_FIX_SUGGESTION_PATH).toBe(
      "/telemetry-ai/fix-suggestion",
    );
    expect(TELEMETRY_AI_FIX_PATH).toBe("/telemetry-ai/fix");

    for (const path of [
      TELEMETRY_AI_READINESS_PATH,
      TELEMETRY_AI_LOGS_PATH,
      TELEMETRY_AI_FIX_SUGGESTION_PATH,
      TELEMETRY_AI_FIX_PATH,
    ]) {
      expect(routeFor(path).middleware).toBe(UserMiddleware.getUserMiddleware);
    }
  });

  test("readiness: a Trace lane's too", async () => {
    await call(TELEMETRY_AI_READINESS_PATH, { lane: TelemetryAiLane.Trace });

    expect(readinessSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Trace);
  });

  test("readiness and logs: the Log lane's too", async () => {
    await call(TELEMETRY_AI_READINESS_PATH, { lane: TelemetryAiLane.Log });
    await call(TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Log, skip: 20 });

    expect(readinessSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Log);
    expect(logsSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Log);
    expect(logsSpy.mock.calls[0]![0].skip).toBe(20);
  });

  test("readiness and logs: a Metric lane's too", async () => {
    await call(TELEMETRY_AI_READINESS_PATH, { lane: TelemetryAiLane.Metric });
    await call(TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Metric });

    expect(readinessSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Metric);
    expect(logsSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Metric);
  });

  test("fix suggestion: the finding's, read as the caller pinned to the tenant", async () => {
    const result: CallResult = await call(TELEMETRY_AI_FIX_SUGGESTION_PATH, {
      insightId: INSIGHT_ID,
    });

    expect(result.error).toBeUndefined();

    const options: Parameters<typeof TelemetryAiPersonFix.getSuggestion>[0] =
      suggestionSpy.mock.calls[0]![0];

    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(options.insightId.toString()).toBe(INSIGHT_ID);
    expect(options.props.isMultiTenantRequest).toBe(false);
    expect(options.props.userId).toBe(USER_ID);
    expect(result.sent).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
      repository: { id: REPOSITORY_ID, name: "acme/checkout" },
      repositories: [],
      taskId: null,
    });
  });

  test("fix: the caller's task, in the repository they picked, answered with its id", async () => {
    const result: CallResult = await call(TELEMETRY_AI_FIX_PATH, {
      insightId: INSIGHT_ID,
      repositoryId: REPOSITORY_ID,
    });

    expect(result.error).toBeUndefined();

    const options: Parameters<typeof TelemetryAiPersonFix.createFixTask>[0] =
      fixSpy.mock.calls[0]![0];

    expect(options.userId).toBe(USER_ID);
    expect(options.insightId.toString()).toBe(INSIGHT_ID);
    expect(options.repositoryId?.toString()).toBe(REPOSITORY_ID);
    expect(options.props.isMultiTenantRequest).toBe(false);
    expect(result.sent).toEqual({
      taskId: "5092ffff-5555-4555-8555-555555555555",
    });
  });

  test("fix: with no repository picked, the finding's lane picks it", async () => {
    await call(TELEMETRY_AI_FIX_PATH, { insightId: INSIGHT_ID });

    expect(fixSpy.mock.calls[0]![0].repositoryId).toBeUndefined();
  });

  test.each([
    [TELEMETRY_AI_FIX_SUGGESTION_PATH, {}],
    [TELEMETRY_AI_FIX_SUGGESTION_PATH, { insightId: "not-an-id" }],
    [TELEMETRY_AI_FIX_SUGGESTION_PATH, { insightId: 7 }],
    [TELEMETRY_AI_FIX_PATH, null],
    [TELEMETRY_AI_FIX_PATH, { insightId: INSIGHT_ID, repositoryId: "x" }],
    [TELEMETRY_AI_FIX_PATH, { insightId: INSIGHT_ID, repositoryId: 3 }],
  ])(
    "%s refuses %j and starts nothing",
    async (path: string, body: unknown) => {
      const result: CallResult = await call(path, body);

      expect(result.error).toBeInstanceOf(BadDataException);
      expect(suggestionSpy).not.toHaveBeenCalled();
      expect(fixSpy).not.toHaveBeenCalled();
    },
  );

  test.each([TELEMETRY_AI_FIX_SUGGESTION_PATH, TELEMETRY_AI_FIX_PATH])(
    "%s refuses a request that is not one signed-in user's",
    async (path: string) => {
      propsSpy.mockResolvedValue(signedInProps({ userId: undefined } as never));

      const noUser: CallResult = await call(path, { insightId: INSIGHT_ID });

      expect(noUser.error).toBeInstanceOf(NotAuthenticatedException);
      expect(suggestionSpy).not.toHaveBeenCalled();
      expect(fixSpy).not.toHaveBeenCalled();
    },
  );

  test("readiness: the lane's, for the tenant's project", async () => {
    const result: CallResult = await call(TELEMETRY_AI_READINESS_PATH, {
      lane: TelemetryAiLane.Profile,
    });

    expect(result.error).toBeUndefined();
    expect(readinessSpy).toHaveBeenCalledTimes(1);
    expect(readinessSpy.mock.calls[0]![0].lane).toBe(TelemetryAiLane.Profile);
    expect(readinessSpy.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(result.sent).toEqual(READINESS);
  });

  test("logs: a page of the lane's, read as the caller pinned to the tenant", async () => {
    const result: CallResult = await call(TELEMETRY_AI_LOGS_PATH, {
      lane: TelemetryAiLane.Profile,
      skip: 40,
    });

    expect(result.error).toBeUndefined();

    const options: Parameters<typeof TelemetryAiActivityReader.readLogs>[0] =
      logsSpy.mock.calls[0]![0];

    expect(options.lane).toBe(TelemetryAiLane.Profile);
    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    // A multi-tenant request would answer from every project the user is in.
    expect(options.props.isMultiTenantRequest).toBe(false);
    expect(options.props.userId).toBe(USER_ID);
    expect(options.skip).toBe(40);
    expect(options.limit).toBe(TELEMETRY_AI_LOGS_PAGE_SIZE);
    expect(result.sent).toEqual(LOGS);
  });

  test("logs start at the first page when the body names no skip", async () => {
    await call(TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Profile });

    expect(logsSpy.mock.calls[0]![0].skip).toBe(0);
  });

  test.each([
    [TELEMETRY_AI_READINESS_PATH, {}],
    [TELEMETRY_AI_READINESS_PATH, { lane: "Traces" }],
    [TELEMETRY_AI_READINESS_PATH, { lane: "Logs" }],
    [TELEMETRY_AI_LOGS_PATH, { lane: "log" }],
    [TELEMETRY_AI_LOGS_PATH, { lane: 1 }],
    [TELEMETRY_AI_LOGS_PATH, null],
    [TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Profile, skip: -1 }],
    [TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Profile, skip: 1.5 }],
    [TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Profile, skip: "20" }],
    [TELEMETRY_AI_LOGS_PATH, { lane: TelemetryAiLane.Profile, skip: 10001 }],
  ])("%s refuses %j and reads nothing", async (path: string, body: unknown) => {
    const result: CallResult = await call(path, body);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readinessSpy).not.toHaveBeenCalled();
    expect(logsSpy).not.toHaveBeenCalled();
  });

  test.each([TELEMETRY_AI_READINESS_PATH, TELEMETRY_AI_LOGS_PATH])(
    "%s refuses a request that is not one signed-in user's in one project",
    async (path: string) => {
      propsSpy.mockResolvedValue(
        signedInProps({ tenantId: undefined } as never),
      );

      const noTenant: CallResult = await call(path, {
        lane: TelemetryAiLane.Profile,
      });

      expect(noTenant.error).toBeDefined();

      propsSpy.mockResolvedValue(signedInProps({ userId: undefined } as never));

      const noUser: CallResult = await call(path, {
        lane: TelemetryAiLane.Profile,
      });

      expect(noUser.error).toBeInstanceOf(NotAuthenticatedException);
      expect(readinessSpy).not.toHaveBeenCalled();
      expect(logsSpy).not.toHaveBeenCalled();
    },
  );
});
