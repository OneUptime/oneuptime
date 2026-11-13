import CommonAPI from "../../../Server/API/CommonAPI";
import AiOutcomesReader from "../../../Server/Utils/AI/Outcomes/AiOutcomesReader";
import IncidentAlertAiInsightsReader from "../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiInsightsReader";
import IncidentAlertAiLogsReader from "../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import { AI_OUTCOMES_PATH, AiOutcomes } from "../../../Types/AI/AiOutcomes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-activity/outcomes (Common/Server/API/IncidentAlertAiActivityAPI.ts),
 * the call behind Settings → AI → AI Results (issue #6800): a signed-in
 * user inside exactly one project, pinned to that project before anything
 * is read, and AiOutcomesReader's answer sent back as it came (the
 * reader's own suite holds who sees what).
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

const mockRouter: Record<string, jest.Mock> = {
  get: jest.fn().mockImplementation(registerRoute("get") as never),
  post: jest.fn().mockImplementation(registerRoute("post") as never),
  put: jest.fn().mockImplementation(registerRoute("put") as never),
  delete: jest.fn().mockImplementation(registerRoute("delete") as never),
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
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

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

const OUTCOMES: AiOutcomes = {
  windowStart: "2026-08-22T00:00:00.000Z",
  windowEnd: "2026-11-13T15:00:00.000Z",
  pages: {
    resolvedByAi: 12,
    recoveredOnItsOwn: 3,
    handledByPerson: 4,
    handedOff: 20,
    holdTimeRanOut: 1,
    pageNowPressed: 0,
    holding: 2,
  },
  remediationFixes: null,
  pullRequestFixes: {
    verified: 5,
    regressed: 1,
    watching: 2,
    awaitingDeploy: 0,
    unverifiable: 1,
  },
  rootCauses: null,
  weeks: [],
  isPartial: true,
};

function outcomesRoutes(): Array<MockRoute> {
  return mockRoutes.filter((route: MockRoute): boolean => {
    return route.uri === AI_OUTCOMES_PATH;
  });
}

function outcomesRoute(): MockRoute {
  const routes: Array<MockRoute> = outcomesRoutes();

  if (routes.length !== 1) {
    throw new Error(`Expected one route for ${AI_OUTCOMES_PATH}.`);
  }

  return routes[0]!;
}

interface CallResult {
  error: unknown;
  sent: JSONObject | undefined;
  sentTo: Array<unknown> | undefined;
}

async function call(body: unknown): Promise<CallResult> {
  const next: jest.Mock = jest.fn();
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const req: ExpressRequest = {
    params: {},
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;

  await outcomesRoute().handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  const lastSend: Array<unknown> | undefined =
    sendJson.mock.calls[sendJson.mock.calls.length - 1];

  return {
    error: next.mock.calls[0]?.[0],
    sent: lastSend ? (lastSend[2] as JSONObject) : undefined,
    sentTo: lastSend ? [lastSend[0] === req, lastSend[1] === res] : undefined,
  };
}

let readSpy: jest.SpiedFunction<typeof AiOutcomesReader.read>;
let propsSpy: jest.SpiedFunction<
  typeof CommonAPI.getDatabaseCommonInteractionProps
>;

beforeAll(async () => {
  // The routes register at import, once the mock router exists.
  await import("../../../Server/API/IncidentAlertAiActivityAPI");
});

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  readSpy = jest.spyOn(AiOutcomesReader, "read").mockResolvedValue(OUTCOMES);
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(signedInProps());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-activity/outcomes", () => {
  test("one route, a POST, behind the user middleware", () => {
    expect(AI_OUTCOMES_PATH).toBe("/ai-activity/outcomes");
    expect(
      outcomesRoutes().map((route: MockRoute): string => {
        return route.method;
      }),
    ).toEqual(["POST"]);
    expect(outcomesRoute().middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("reads the outcomes of the request's project, pinned to it, and sends them as they came", async () => {
    const result: CallResult = await call({});

    expect(result.error).toBeUndefined();
    expect(propsSpy).toHaveBeenCalledTimes(1);
    expect(readSpy).toHaveBeenCalledTimes(1);

    const options: Parameters<typeof AiOutcomesReader.read>[0] =
      readSpy.mock.calls[0]![0];

    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    // A multi-tenant request would answer from every project the user is in.
    expect(options.props.isMultiTenantRequest).toBe(false);
    expect(options.props.userId).toBe(USER_ID);
    expect(options.props.tenantId).toBe(PROJECT_ID);
    // Never root: each part follows the caller's own read access.
    expect(options.props.isRoot).toBeFalsy();
    // The reader's clock: the route names no other time.
    expect(options.now).toBeUndefined();
    expect(result.sent).toEqual(OUTCOMES);
    expect(result.sentTo).toEqual([true, true]);
  });

  test("the project is the tenant's, never what the body names", async () => {
    await call({ projectId: OTHER_PROJECT_ID, now: "2020-01-01" });

    const options: Parameters<typeof AiOutcomesReader.read>[0] =
      readSpy.mock.calls[0]![0];

    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(options.now).toBeUndefined();
  });

  test.each([[undefined], [null], ["nonsense"], [[1, 2]]])(
    "any body, %j included, reads the same",
    async (body: unknown) => {
      const result: CallResult = await call(body);

      expect(result.error).toBeUndefined();
      expect(result.sent).toEqual(OUTCOMES);
    },
  );

  test("refuses a request without a signed-in user, before reading anything", async () => {
    propsSpy.mockResolvedValue(signedInProps({ userId: undefined }));

    const result: CallResult = await call({});

    expect(result.error).toBeDefined();
    expect(readSpy).not.toHaveBeenCalled();
    expect(result.sent).toBeUndefined();
  });

  test("refuses a project API key: the page is for people", async () => {
    propsSpy.mockResolvedValue(
      signedInProps({ userId: undefined, userType: UserType.API }),
    );

    const result: CallResult = await call({});

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("refuses a request that names no project", async () => {
    propsSpy.mockResolvedValue(signedInProps({ tenantId: undefined }));

    const result: CallResult = await call({});

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
    expect(result.sent).toBeUndefined();
  });

  test("hands a failure from the reader on, and sends nothing", async () => {
    readSpy.mockRejectedValue(new Error("The database went away."));

    const result: CallResult = await call({});

    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("The database went away.");
    expect(result.sent).toBeUndefined();
  });

  test("hands a failure reading the caller's props on, and reads nothing", async () => {
    propsSpy.mockRejectedValue(
      new NotAuthorizedException("Your session has expired."),
    );

    const result: CallResult = await call({});

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("the other AI activity routes do not read the outcomes, nor it theirs", async () => {
    const logsSpy: jest.SpiedFunction<typeof IncidentAlertAiLogsReader.read> =
      jest.spyOn(IncidentAlertAiLogsReader, "read");
    const insightsSpy: jest.SpiedFunction<
      typeof IncidentAlertAiInsightsReader.read
    > = jest.spyOn(IncidentAlertAiInsightsReader, "read");

    await call({});

    expect(logsSpy).not.toHaveBeenCalled();
    expect(insightsSpy).not.toHaveBeenCalled();
    expect(
      mockRoutes
        .filter((route: MockRoute): boolean => {
          return route.uri !== AI_OUTCOMES_PATH;
        })
        .every((route: MockRoute): boolean => {
          return route.handlerFunction !== outcomesRoute().handlerFunction;
        }),
    ).toBe(true);
  });
});

/*
 * BaseAPI answers on `${crudApiPath}` plus these suffixes
 * (Common/Server/API/BaseAPI.ts): a CRUD router would win the outcomes
 * path if one of them matched it - a model at /ai-activity would, with
 * "/:id".
 */
const CRUD_ROUTE_SUFFIXES: Array<string> = [
  "",
  "/get-list",
  "/count",
  "/:id",
  "/:id/get-item",
  "/:id/update-item",
  "/:id/delete-item",
];

// Express 4 semantics: case-insensitive, optional trailing slash.
function expressPattern(route: string): RegExp {
  const source: string = route
    .split("/")
    .map((segment: string): string => {
      return segment.startsWith(":") ? "[^/]+" : escapeRegExp(segment);
    })
    .join("/");
  return new RegExp(`^${source}/?$`, "i");
}

describe("no CRUD router claims /ai-activity/outcomes", () => {
  function allCrudApiPaths(): Array<{ owner: string; route: string }> {
    const paths: Array<{ owner: string; route: string }> = [];

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      const route: string | undefined = new modelType().crudApiPath?.toString();

      if (route) {
        paths.push({ owner: modelType.name, route });
      }
    }

    for (const modelType of AnalyticsModels as Array<{
      new (): AnalyticsBaseModel;
    }>) {
      const route: string | undefined = new modelType().crudApiPath?.toString();

      if (route) {
        paths.push({ owner: modelType.name, route });
      }
    }

    return paths;
  }

  test("no CRUD route pattern matches it", () => {
    const crudPaths: Array<{ owner: string; route: string }> =
      allCrudApiPaths();
    const collisions: Array<string> = [];

    // The list is real, so the check below does not pass vacuously.
    expect(crudPaths.length).toBeGreaterThan(300);

    for (const entry of crudPaths) {
      for (const suffix of CRUD_ROUTE_SUFFIXES) {
        if (expressPattern(`${entry.route}${suffix}`).test(AI_OUTCOMES_PATH)) {
          collisions.push(`${entry.owner} (${entry.route}${suffix})`);
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  test("the pattern check itself would catch a model at /ai-activity", () => {
    expect(expressPattern("/ai-activity/:id").test(AI_OUTCOMES_PATH)).toBe(
      true,
    );
    expect(expressPattern("/ai-activity/count").test(AI_OUTCOMES_PATH)).toBe(
      false,
    );
  });
});
