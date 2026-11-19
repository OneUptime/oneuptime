import CommonAPI from "../../../Server/API/CommonAPI";
import type { ParsedRecordsRequest } from "../../../Server/API/IncidentAlertAiActivityAPI";
import AiOutcomesReader from "../../../Server/Utils/AI/Outcomes/AiOutcomesReader";
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
import {
  AI_OUTCOMES_PART_OUTCOMES,
  AI_OUTCOMES_PARTS,
  AI_OUTCOMES_PATH,
  AI_OUTCOMES_RECORDS_PATH,
  AI_OUTCOMES_SCAN_LIMIT,
  AiOutcomesPart,
  AiOutcomesRecords,
} from "../../../Types/AI/AiOutcomes";
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
 * POST /ai-activity/outcomes/records (Common/Server/API/
 * IncidentAlertAiActivityAPI.ts, issue #7768): the records one of AI
 * Results' numbers counts. A signed-in user inside exactly one project,
 * pinned to it before anything is read; a request that names a part and
 * one of its outcomes, and optionally the moment the number was counted
 * and how many records the reader already has; AiOutcomesReader's answer
 * sent back as it came (the reader's own suite holds what is listed).
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

const RECORDS: AiOutcomesRecords = {
  part: AiOutcomesPart.Pages,
  outcome: "holdTimeRanOut",
  total: 4,
  records: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      at: "2026-11-10T09:00:00.000Z",
      subject: {
        kind: "incident",
        id: "55555555-5555-4555-8555-555555555555",
        title: "Checkout is down",
        numberWithPrefix: "INC-42",
      },
    },
  ],
  nextSkip: null,
};

function recordsRoutes(): Array<MockRoute> {
  return mockRoutes.filter((route: MockRoute): boolean => {
    return route.uri === AI_OUTCOMES_RECORDS_PATH;
  });
}

function recordsRoute(): MockRoute {
  const routes: Array<MockRoute> = recordsRoutes();

  if (routes.length !== 1) {
    throw new Error(`Expected one route for ${AI_OUTCOMES_RECORDS_PATH}.`);
  }

  return routes[0]!;
}

interface CallResult {
  error: unknown;
  sent: JSONObject | undefined;
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

  await recordsRoute().handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  const lastSend: Array<unknown> | undefined =
    sendJson.mock.calls[sendJson.mock.calls.length - 1];

  return {
    error: next.mock.calls[0]?.[0],
    sent: lastSend ? (lastSend[2] as JSONObject) : undefined,
  };
}

let readSpy: jest.SpiedFunction<typeof AiOutcomesReader.readRecords>;
let propsSpy: jest.SpiedFunction<
  typeof CommonAPI.getDatabaseCommonInteractionProps
>;

type ApiModule =
  typeof import("../../../Server/API/IncidentAlertAiActivityAPI");

let parseRecordsRequest: ApiModule["parseRecordsRequest"];

beforeAll(async () => {
  // The routes register at import, once the mock router exists.
  const api: ApiModule = await import(
    "../../../Server/API/IncidentAlertAiActivityAPI"
  );
  parseRecordsRequest = api.parseRecordsRequest;
});

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  readSpy = jest
    .spyOn(AiOutcomesReader, "readRecords")
    .mockResolvedValue(RECORDS);
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(signedInProps());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /ai-activity/outcomes/records", () => {
  test("one route, a POST, behind the user middleware, apart from the outcomes' own", () => {
    expect(AI_OUTCOMES_RECORDS_PATH).toBe("/ai-activity/outcomes/records");
    expect(
      recordsRoutes().map((route: MockRoute): string => {
        return route.method;
      }),
    ).toEqual(["POST"]);
    expect(recordsRoute().middleware).toBe(UserMiddleware.getUserMiddleware);
    expect(
      mockRoutes.filter((route: MockRoute): boolean => {
        return route.uri === AI_OUTCOMES_PATH;
      }),
    ).toHaveLength(1);
  });

  test("reads the records of the request's project, pinned to it, and sends them as they came", async () => {
    const result: CallResult = await call({
      part: "pages",
      outcome: "holdTimeRanOut",
      windowEnd: "2026-11-13T15:00:00.000Z",
      skip: 50,
    });

    expect(result.error).toBeUndefined();
    expect(readSpy).toHaveBeenCalledTimes(1);

    const options: Parameters<typeof AiOutcomesReader.readRecords>[0] =
      readSpy.mock.calls[0]![0];

    expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(options.props.isMultiTenantRequest).toBe(false);
    expect(options.props.userId).toBe(USER_ID);
    expect(options.props.tenantId).toBe(PROJECT_ID);
    // Never root: what is listed follows the caller's own read access.
    expect(options.props.isRoot).toBeFalsy();
    expect(options.part).toBe(AiOutcomesPart.Pages);
    expect(options.outcome).toBe("holdTimeRanOut");
    expect(options.windowEnd).toEqual(new Date("2026-11-13T15:00:00.000Z"));
    expect(options.skip).toBe(50);
    // The reader's clock: the route names no other time.
    expect(options.now).toBeUndefined();
    expect(result.sent).toEqual(RECORDS);
  });

  test("the project is the tenant's, never what the body names", async () => {
    await call({
      part: "rootCauses",
      outcome: "wrong",
      projectId: OTHER_PROJECT_ID,
    });

    expect(readSpy.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("refuses a project API key: the page is for people", async () => {
    propsSpy.mockResolvedValue(
      signedInProps({ userId: undefined, userType: UserType.API }),
    );

    const result: CallResult = await call({
      part: "pages",
      outcome: "handedOff",
    });

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("refuses a request that names no project", async () => {
    propsSpy.mockResolvedValue(signedInProps({ tenantId: undefined }));

    const result: CallResult = await call({
      part: "pages",
      outcome: "handedOff",
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("refuses a request it cannot read, before reading anything", async () => {
    const result: CallResult = await call({ part: "pages", outcome: "nope" });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
    expect(result.sent).toBeUndefined();
  });

  test("hands a refusal from the reader on - a part the caller may not read - and sends nothing", async () => {
    readSpy.mockRejectedValue(
      new NotAuthorizedException(
        "Your role cannot read what this number counts.",
      ),
    );

    const result: CallResult = await call({
      part: "pullRequestFixes",
      outcome: "regressed",
    });

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(result.sent).toBeUndefined();
  });
});

describe("parseRecordsRequest", () => {
  test("every part and each of its outcomes", () => {
    for (const part of AI_OUTCOMES_PARTS) {
      for (const outcome of AI_OUTCOMES_PART_OUTCOMES[part]) {
        expect(parseRecordsRequest({ part, outcome })).toEqual({
          part,
          outcome,
        });
      }
    }
  });

  test.each([
    [undefined],
    [null],
    ["pages"],
    [[1, 2]],
    [{}],
    [{ outcome: "handedOff" }],
    [{ part: "everything", outcome: "handedOff" }],
    [{ part: "pages" }],
    [{ part: "pages", outcome: "verified" }],
    [{ part: "rootCauses", outcome: "completed" }],
    [{ part: "pages", outcome: 3 }],
    [{ part: ["pages"], outcome: "handedOff" }],
  ])("refuses %j", (body: unknown) => {
    expect(() => {
      return parseRecordsRequest(body);
    }).toThrow(BadDataException);
  });

  test("windowEnd: an ISO date, or left out", () => {
    expect(
      parseRecordsRequest({
        part: "pages",
        outcome: "handedOff",
        windowEnd: "2026-11-13T15:00:00.000Z",
      }).windowEnd,
    ).toEqual(new Date("2026-11-13T15:00:00.000Z"));

    for (const windowEnd of [undefined, null, ""]) {
      expect(
        parseRecordsRequest({ part: "pages", outcome: "handedOff", windowEnd })
          .windowEnd,
      ).toBeUndefined();
    }

    const parse: ApiModule["parseRecordsRequest"] = parseRecordsRequest;

    for (const windowEnd of ["yesterday", 12, { at: "now" }]) {
      expect(() => {
        return parse({ part: "pages", outcome: "handedOff", windowEnd });
      }).toThrow("The windowEnd field must be an ISO date.");
    }
  });

  test("skip: a whole number from 0 to the scan limit, or left out", () => {
    const parsed: (skip: unknown) => ParsedRecordsRequest = (
      skip: unknown,
    ): ParsedRecordsRequest => {
      return parseRecordsRequest({ part: "pages", outcome: "handedOff", skip });
    };

    expect(parsed(0).skip).toBe(0);
    expect(parsed(50).skip).toBe(50);
    expect(parsed(AI_OUTCOMES_SCAN_LIMIT).skip).toBe(AI_OUTCOMES_SCAN_LIMIT);
    expect(parsed(undefined).skip).toBeUndefined();
    expect(parsed(null).skip).toBeUndefined();

    for (const skip of [-1, 1.5, "50", AI_OUTCOMES_SCAN_LIMIT + 1, true]) {
      expect(() => {
        return parsed(skip);
      }).toThrow(BadDataException);
    }
  });

  test("anything else in the body is ignored", () => {
    expect(
      parseRecordsRequest({
        part: "remediationFixes",
        outcome: "failed",
        projectId: OTHER_PROJECT_ID,
        isRoot: true,
      }),
    ).toEqual({ part: "remediationFixes", outcome: "failed" });
  });
});

// BaseAPI's suffixes (Common/Server/API/BaseAPI.ts): a CRUD router must not win the path.
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

describe("no CRUD router claims /ai-activity/outcomes/records", () => {
  test("no CRUD route pattern matches it", () => {
    const collisions: Array<string> = [];
    let paths: number = 0;

    const check: (owner: string, route: string | undefined) => void = (
      owner: string,
      route: string | undefined,
    ): void => {
      if (!route) {
        return;
      }

      paths++;

      for (const suffix of CRUD_ROUTE_SUFFIXES) {
        if (
          expressPattern(`${route}${suffix}`).test(AI_OUTCOMES_RECORDS_PATH)
        ) {
          collisions.push(`${owner} (${route}${suffix})`);
        }
      }
    };

    for (const modelType of AllModelTypes as Array<DatabaseBaseModelType>) {
      check(modelType.name, new modelType().crudApiPath?.toString());
    }

    for (const modelType of AnalyticsModels as Array<{
      new (): AnalyticsBaseModel;
    }>) {
      check(modelType.name, new modelType().crudApiPath?.toString());
    }

    // The list is real, so the check does not pass vacuously.
    expect(paths).toBeGreaterThan(300);
    expect(collisions).toEqual([]);
  });
});
