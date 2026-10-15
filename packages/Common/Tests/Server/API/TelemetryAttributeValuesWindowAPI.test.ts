import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import ProjectService from "../../../Server/Services/ProjectService";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
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
 * /telemetry/<signal>/get-attribute-values TAKES THE READER'S WINDOW
 * (issue #4708).
 *
 * The explorers send the time range on screen with a value lookup, so the
 * values offered under `@key:` are those of the rows the reader is looking
 * at. The window is optional - a dashboard variable or a chart editor has
 * none, and older pages never sent one - and a broken one is refused rather
 * than read as "no window". Each route runs through its real guards and
 * handler; the attribute service behind it is answered here.
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouterFunction>;
};

const recordedRoutes: Array<RecordedRoute> = [];

type RecordRouteFunction = (
  method: string,
) => (uri: string, ...handlers: Array<RouterFunction>) => void;

const recordRoute: RecordRouteFunction = (method: string) => {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    recordedRoutes.push({
      method: method.toUpperCase(),
      uri: uri,
      handlers: handlers,
    });
  };
};

const telemetryRouter: JSONObject = {
  get: recordRoute("get"),
  post: recordRoute("post"),
  put: recordRoute("put"),
  delete: recordRoute("delete"),
} as unknown as JSONObject;

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return telemetryRouter;
    },
    getClientIp: () => {
      return "203.0.113.7";
    },
  };
});

const responses: {
  json: Array<JSONObject>;
  errors: Array<unknown>;
} = { json: [], errors: [] };

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: (
      _req: unknown,
      _res: unknown,
      body: JSONObject,
    ): void => {
      responses.json.push(body);
    },
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: (_req: unknown, _res: unknown, error: unknown): void => {
      responses.errors.push(error);
    },
  };
});

const ROUTES: Array<{ uri: string; type: TelemetryType }> = [
  { uri: "/telemetry/logs/get-attribute-values", type: TelemetryType.Log },
  { uri: "/telemetry/traces/get-attribute-values", type: TelemetryType.Trace },
  {
    uri: "/telemetry/exceptions/get-attribute-values",
    type: TelemetryType.Exception,
  },
  {
    uri: "/telemetry/metrics/get-attribute-values",
    type: TelemetryType.Metric,
  },
  {
    uri: "/telemetry/security-events/get-attribute-values",
    type: TelemetryType.SecurityEvent,
  },
];

const LOGS_ROUTE: string = "/telemetry/logs/get-attribute-values";

function findRoute(uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${uri}`);
  }

  return route;
}

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

// A project owner: every route above lets them in.
function principal(): JSONObject {
  const permissions: Array<UserPermission> = [
    {
      _type: "UserPermission",
      permission: Permission.ProjectOwner,
      labelIds: [],
      isBlockPermission: false,
    } as UserPermission,
  ];

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions,
  } as UserTenantAccessPermission;

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[projectId.toString()] = tenantPermission;

  return {
    userType: UserType.User,
    tenantId: projectId,
    userTenantAccessPermission: permissionMap,
    userAuthorization: { userId: userId },
  } as unknown as JSONObject;
}

interface CallResult {
  thrownToNext: unknown;
  refusedWith: unknown;
  body: JSONObject | undefined;
}

// Runs the route's chain after getUserMiddleware, whose session the principal stands in for.
async function call(uri: string, body: JSONObject): Promise<CallResult> {
  const route: RecordedRoute = findRoute(uri);

  const req: ExpressRequest = {
    ...principal(),
    body: body,
    params: {},
    query: {},
    headers: { "user-agent": "jest-agent" },
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    setHeader: (): void => {},
    send: (): void => {},
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  const outcome: { thrownToNext: unknown } = { thrownToNext: undefined };

  for (let index: number = 1; index < route.handlers.length; index++) {
    const step: { calledNext: boolean } = { calledNext: false };

    await route.handlers[index]!(req, res, ((error?: unknown): void => {
      step.calledNext = true;

      if (error) {
        outcome.thrownToNext = error;
      }
    }) as unknown as NextFunction);

    if (!step.calledNext || outcome.thrownToNext) {
      break;
    }
  }

  return {
    thrownToNext: outcome.thrownToNext,
    refusedWith: responses.errors[0],
    body: responses.json[0],
  };
}

interface ServiceSpy {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: unknown) => unknown;
}

let fetchAttributeValues: ServiceSpy;

beforeAll(() => {
  recordedRoutes.length = 0;
  // TelemetryAPI builds its router at module scope: load it after the mocks.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../../Server/API/TelemetryAPI");
});

beforeEach(() => {
  responses.json = [];
  responses.errors = [];

  // CI runs with billing on; these projects never exist in Postgres.
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

  // A project owner reads every resource.
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({} as never);

  fetchAttributeValues = jest.spyOn(
    TelemetryAttributeService,
    "fetchAttributeValues" as never,
  ) as unknown as ServiceSpy;
  fetchAttributeValues.mockResolvedValue(["GET"]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lookupOf(call: number = 0): JSONObject {
  return fetchAttributeValues.mock.calls[call]![0] as JSONObject;
}

describe("the value routes take the reader's window", () => {
  test.each(ROUTES)(
    "$uri hands the window to the lookup",
    async (route: { uri: string; type: TelemetryType }) => {
      const result: CallResult = await call(route.uri, {
        attributeKey: "http.method",
        startTime: "2026-10-07T14:00:00.000Z",
        endTime: "2026-10-07T15:00:00.000Z",
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.body).toEqual({ values: ["GET"] });

      const lookup: JSONObject = lookupOf();

      expect(lookup["telemetryType"]).toBe(route.type);
      expect(lookup["attributeKey"]).toBe("http.method");
      expect(lookup["startTime"]).toEqual(new Date("2026-10-07T14:00:00.000Z"));
      expect(lookup["endTime"]).toEqual(new Date("2026-10-07T15:00:00.000Z"));
    },
  );

  test("without a window, the lookup gets none and reads its default", async () => {
    await call(LOGS_ROUTE, { attributeKey: "env" });

    const lookup: JSONObject = lookupOf();

    expect(lookup["startTime"]).toBeUndefined();
    expect(lookup["endTime"]).toBeUndefined();
  });

  test("an empty or null edge is no edge", async () => {
    await call(LOGS_ROUTE, {
      attributeKey: "env",
      startTime: "",
      endTime: null,
    });

    const lookup: JSONObject = lookupOf();

    expect(lookup["startTime"]).toBeUndefined();
    expect(lookup["endTime"]).toBeUndefined();
  });

  test("one edge alone is passed on alone", async () => {
    await call(LOGS_ROUTE, {
      attributeKey: "env",
      startTime: "2026-10-07T14:00:00.000Z",
    });

    expect(lookupOf()["startTime"]).toEqual(
      new Date("2026-10-07T14:00:00.000Z"),
    );
    expect(lookupOf()["endTime"]).toBeUndefined();
  });

  test.each([
    ["a word", { startTime: "yesterday" }],
    ["a number", { endTime: 1760000000000 }],
    ["an object", { startTime: { value: "2026-10-07" } }],
  ])(
    "a window edge that is %s is refused, and nothing is read",
    async (_label: string, edges: JSONObject) => {
      const result: CallResult = await call(LOGS_ROUTE, {
        attributeKey: "env",
        ...edges,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(result.body).toBeUndefined();
      expect(fetchAttributeValues.mock.calls).toHaveLength(0);
    },
  );

  test("an end before the start is refused, and nothing is read", async () => {
    const result: CallResult = await call(LOGS_ROUTE, {
      attributeKey: "env",
      startTime: "2026-10-07T15:00:00.000Z",
      endTime: "2026-10-07T14:00:00.000Z",
    });

    expect(result.refusedWith).toBeInstanceOf(BadDataException);
    expect((result.refusedWith as BadDataException).message).toBe(
      "startTime must not be after endTime",
    );
    expect(fetchAttributeValues.mock.calls).toHaveLength(0);
  });

  test("the key and the search text still arrive as before", async () => {
    await call(LOGS_ROUTE, {
      attributeKey: "http.route",
      searchText: "orders",
    });

    expect(lookupOf()).toMatchObject({
      projectId: projectId,
      attributeKey: "http.route",
      searchText: "orders",
    });
  });
});
