import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAlertAiLogsReader from "../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsReader";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  INCIDENT_ALERT_AI_LOGS_PATHS,
  INCIDENT_ALERT_AI_SUBJECT_KINDS,
  IncidentAlertAiLogKind,
  IncidentAlertAiLogs,
  IncidentAlertAiSubjectKind,
} from "../../../Types/AI/IncidentAlertAiLogs";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Common/Server/API/IncidentAlertAiActivityAPI.ts - the calls behind the AI
 * section of the Incidents and Alerts menus. The logs routes take a
 * signed-in user inside exactly one project, pin the request to that
 * project before anything is read, check what the body asks for, and hand
 * the rest to IncidentAlertAiLogsReader (whose own suites hold who sees
 * what).
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

function routeFor(subjectKind: IncidentAlertAiSubjectKind): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute): boolean => {
      return (
        candidate.method === "POST" &&
        candidate.uri === INCIDENT_ALERT_AI_LOGS_PATHS[subjectKind]
      );
    },
  );

  if (!route) {
    throw new Error(`No route for ${subjectKind} logs`);
  }

  return route;
}

interface CallResult {
  error: unknown;
  sent: JSONObject | undefined;
}

async function call(
  subjectKind: IncidentAlertAiSubjectKind,
  body: unknown,
): Promise<CallResult> {
  const next: jest.Mock = jest.fn();
  const sendJson: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  await routeFor(subjectKind).handlerFunction(
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

const LOGS: IncidentAlertAiLogs = {
  subjectKind: "incident",
  entries: [],
  nextBefore: null,
  hiddenKinds: [],
};

let readSpy: jest.SpiedFunction<typeof IncidentAlertAiLogsReader.read>;
let propsSpy: jest.SpiedFunction<
  typeof CommonAPI.getDatabaseCommonInteractionProps
>;

beforeAll(async () => {
  // The routes register at import, once the mock router exists.
  await import("../../../Server/API/IncidentAlertAiActivityAPI");
});

beforeEach(() => {
  (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
  readSpy = jest
    .spyOn(IncidentAlertAiLogsReader, "read")
    .mockResolvedValue(LOGS);
  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(signedInProps());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the logs routes", () => {
  test("one per product, each behind the user middleware", () => {
    expect(INCIDENT_ALERT_AI_LOGS_PATHS).toEqual({
      incident: "/ai-activity/incident/logs",
      alert: "/ai-activity/alert/logs",
    });

    for (const subjectKind of INCIDENT_ALERT_AI_SUBJECT_KINDS) {
      expect(routeFor(subjectKind).middleware).toBe(
        UserMiddleware.getUserMiddleware,
      );
    }
  });

  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "the %s route reads that product's record, pinned to the tenant, and sends it",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      const logs: IncidentAlertAiLogs = { ...LOGS, subjectKind };
      readSpy.mockResolvedValue(logs);

      const result: CallResult = await call(subjectKind, {});

      expect(result.error).toBeUndefined();
      expect(readSpy).toHaveBeenCalledTimes(1);

      const options: Parameters<typeof IncidentAlertAiLogsReader.read>[0] =
        readSpy.mock.calls[0]![0];

      expect(options.subjectKind).toBe(subjectKind);
      expect(options.projectId.toString()).toBe(PROJECT_ID.toString());
      // A multi-tenant request would answer from every project the user is in.
      expect(options.props.isMultiTenantRequest).toBe(false);
      expect(options.props.userId).toBe(USER_ID);
      expect(options.before).toBeUndefined();
      expect(options.kinds).toBeUndefined();
      expect(result.sent).toEqual(logs);
    },
  );

  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "the %s route passes the page and the kinds asked for",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      await call(subjectKind, {
        before: "2026-10-05T10:00:00.000Z",
        kinds: [IncidentAlertAiLogKind.Command, IncidentAlertAiLogKind.Fix],
      });

      const options: Parameters<typeof IncidentAlertAiLogsReader.read>[0] =
        readSpy.mock.calls[0]![0];

      expect(options.before?.toISOString()).toBe("2026-10-05T10:00:00.000Z");
      expect(options.kinds).toEqual([
        IncidentAlertAiLogKind.Command,
        IncidentAlertAiLogKind.Fix,
      ]);
    },
  );

  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "the %s route refuses a request without a signed-in user, before reading anything",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      propsSpy.mockResolvedValue(signedInProps({ userId: undefined }));

      const result: CallResult = await call(subjectKind, {});

      expect(result.error).toBeDefined();
      expect(readSpy).not.toHaveBeenCalled();
      expect(result.sent).toBeUndefined();
    },
  );

  test("refuses a project API key: the page is for people", async () => {
    propsSpy.mockResolvedValue(
      signedInProps({ userId: undefined, userType: UserType.API }),
    );

    const result: CallResult = await call("incident", {});

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test.each(INCIDENT_ALERT_AI_SUBJECT_KINDS)(
    "the %s route refuses a request that names no project",
    async (subjectKind: IncidentAlertAiSubjectKind) => {
      propsSpy.mockResolvedValue(signedInProps({ tenantId: undefined }));

      const result: CallResult = await call(subjectKind, {});

      expect(result.error).toBeInstanceOf(BadDataException);
      expect(readSpy).not.toHaveBeenCalled();
    },
  );

  test("hands a refusal from the reader on, and sends nothing", async () => {
    readSpy.mockRejectedValue(
      new NotAuthorizedException("You may not read incidents."),
    );

    const result: CallResult = await call("incident", {});

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(result.sent).toBeUndefined();
  });

  test.each([
    [{ before: "yesterday" }],
    [{ before: 12345 }],
    [{ kinds: "Fix" }],
    [{ kinds: ["Fix", "Everything"] }],
  ])("refuses a body asking for %j", async (body: JSONObject) => {
    const result: CallResult = await call("alert", body);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("parseLogsRequest", () => {
  let parseLogsRequest: (body: unknown) => {
    before?: Date | undefined;
    kinds?: Array<IncidentAlertAiLogKind> | undefined;
  };

  beforeAll(async () => {
    parseLogsRequest = (
      await import("../../../Server/API/IncidentAlertAiActivityAPI")
    ).parseLogsRequest;
  });

  test("an empty body asks for the newest page of everything", () => {
    expect(parseLogsRequest({})).toEqual({});
    expect(parseLogsRequest(undefined)).toEqual({});
    expect(parseLogsRequest(null)).toEqual({});
    expect(parseLogsRequest("nonsense")).toEqual({});
    expect(parseLogsRequest([1, 2])).toEqual({});
  });

  test("an empty before or kinds is no filter", () => {
    expect(parseLogsRequest({ before: "", kinds: null })).toEqual({});
    expect(parseLogsRequest({ before: null })).toEqual({});
  });

  test("reads an ISO before", () => {
    expect(
      parseLogsRequest({ before: "2026-10-05T10:00:00.123Z" }).before,
    ).toEqual(new Date("2026-10-05T10:00:00.123Z"));
  });

  test("reads every kind it knows, and only those", () => {
    expect(
      parseLogsRequest({
        kinds: [
          IncidentAlertAiLogKind.Investigation,
          IncidentAlertAiLogKind.Fix,
          IncidentAlertAiLogKind.FixTask,
          IncidentAlertAiLogKind.Command,
        ],
      }).kinds,
    ).toHaveLength(4);
    expect(() => {
      return parseLogsRequest({ kinds: ["investigation"] });
    }).toThrow(BadDataException);
  });

  test("ignores what else the body holds", () => {
    expect(
      parseLogsRequest({ projectId: "someone else's", limit: 10000 }),
    ).toEqual({});
  });
});
