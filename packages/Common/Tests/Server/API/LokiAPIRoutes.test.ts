import type {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouteHandler>;
};

const recordedRoutes: Array<RecordedRoute> = [];

// The permission middleware, tagged with what it was asked to check.
const permissionChecks: Array<unknown> = [];

jest.mock("../../../Server/Utils/Express", () => {
  const record: (method: string) => (...args: Array<unknown>) => void = (
    method: string,
  ) => {
    return (...args: Array<unknown>): void => {
      recordedRoutes.push({
        method,
        uri: args[0] as string,
        handlers: args.slice(1) as Array<RouteHandler>,
      });
    };
  };
  return {
    getRouter: () => {
      return {
        get: jest.fn().mockImplementation(record("GET")),
        post: jest.fn().mockImplementation(record("POST")),
      };
    },
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    getUserMiddleware: jest.fn(),
    requireUserAuthentication: jest.fn(),
    requirePermission: jest.fn().mockImplementation((check: unknown) => {
      const middleware: jest.Mock = jest.fn();
      permissionChecks.push({ middleware, check });
      return middleware;
    }),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendCustomResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

import LokiAPI, { LOKI_API_PATH } from "../../../Server/API/LokiAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CompatibleQueryRateLimit, {
  COMPATIBLE_QUERY_TOO_MANY_MESSAGE,
  CompatibleQueryRateLimitOutcome,
} from "../../../Server/Middleware/CompatibleQueryRateLimit";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import LogService from "../../../Server/Services/LogService";
import TelemetryAttributeService from "../../../Server/Services/TelemetryAttributeService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { LOKI_BUILD_INFO } from "../../../Server/Utils/LogQL/LokiHttpApi";
import Response from "../../../Server/Utils/Response";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import Log from "../../../Models/AnalyticsModels/Log";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";

/*
 * The Loki HTTP API's routes (issue #7700): who may call them, a project's
 * rate, and Grafana's calls answered end to end with ClickHouse in a test
 * double - in Loki's own shapes, and its errors as plain text.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a6d3b1c-7f8e-4a2b-9c0d-1e2f3a4b5c6d",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0f1e2d3c-4b5a-4968-8776-655443322110",
);

const NS: bigint = BigInt(1000000000);
const T0_S: number = 1763632800;

const at: (seconds: number) => string = (seconds: number): string => {
  return (BigInt(T0_S + seconds) * NS + BigInt(123)).toString();
};

const CHECKOUT_ROW: (seconds: number, body: string) => JSONObject = (
  seconds: number,
  body: string,
): JSONObject => {
  return {
    timeNs: at(seconds),
    body,
    severityText: "ERROR",
    severityNumber: 17,
    attributes: {
      "resource.service.name": "checkout",
      "http.method": "POST",
    },
  };
};

const findRoute: (method: string, uri: string) => RecordedRoute = (
  method: string,
  uri: string,
): RecordedRoute => {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute): boolean => {
      return candidate.method === method && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: ${method} ${uri}`);
  }

  return route;
};

const call: (data: {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}) => Promise<{ next: jest.Mock }> = async (data: {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}): Promise<{ next: jest.Mock }> => {
  const route: RecordedRoute = findRoute(
    data.method,
    `${LOKI_API_PATH}${data.path}`,
  );
  const handler: RouteHandler = route.handlers[route.handlers.length - 1]!;
  const next: jest.Mock = jest.fn();

  await handler(
    {
      params: data.params || {},
      query: data.query || {},
      body: data.body || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { next };
};

const lastJson: () => JSONObject = (): JSONObject => {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return calls[calls.length - 1]![2] as JSONObject;
};

const lastText: () => {
  statusCode: number;
  text: string;
  headers: Record<string, string>;
} = (): {
  statusCode: number;
  text: string;
  headers: Record<string, string>;
} => {
  const calls: Array<Array<unknown>> = (
    Response.sendCustomResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;
  const last: Array<unknown> = calls[calls.length - 1]!;

  return {
    statusCode: last[2] as number,
    text: last[3] as string,
    headers: last[4] as Record<string, string>,
  };
};

describe("Loki API routes", () => {
  const statements: Array<Statement> = [];
  let rows: Array<JSONObject> = [];

  beforeEach(() => {
    statements.length = 0;
    rows = [];
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ tenantId: PROJECT_ID } as never);
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({ serviceIds: [SERVICE_ID] });
    jest
      .spyOn(LogService, "executeQuery")
      .mockImplementation(
        async (statement: Statement | string): Promise<never> => {
          statements.push(statement as Statement);

          return {
            json: async (): Promise<{ data: Array<JSONObject> }> => {
              return { data: rows };
            },
          } as never;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
    (Response.sendCustomResponse as jest.Mock).mockClear();
  });

  test("is one router, served under /api/loki as Loki's own paths", () => {
    expect(LokiAPI).toBeDefined();
    expect(LOKI_API_PATH).toBe("/loki/loki/api/v1");
  });

  test.each([
    ["GET", "/query"],
    ["POST", "/query"],
    ["GET", "/query_range"],
    ["POST", "/query_range"],
    ["GET", "/labels"],
    ["POST", "/labels"],
    ["GET", "/label"],
    ["GET", "/label/:labelName/values"],
    ["GET", "/series"],
    ["POST", "/series"],
    ["GET", "/status/buildinfo"],
  ])(
    "%s %s needs a caller who may read logs, within the project's rate",
    (method: string, path: string) => {
      const route: RecordedRoute = findRoute(method, `${LOKI_API_PATH}${path}`);
      const permission: { middleware: jest.Mock; check: unknown } =
        permissionChecks[0] as { middleware: jest.Mock; check: unknown };
      const readUser: number = route.handlers.indexOf(
        UserMiddleware.getUserMiddleware as unknown as RouteHandler,
      );
      const checkPermission: number = route.handlers.indexOf(
        permission.middleware as unknown as RouteHandler,
      );

      // The key moved from Authorization first, then the user, then the rate.
      expect(readUser).toBe(1);
      expect(route.handlers).toContain(
        UserMiddleware.requireUserAuthentication as unknown as RouteHandler,
      );
      expect(checkPermission).toBeGreaterThan(readUser);
      expect(route.handlers.length).toBe(checkPermission + 3);
    },
  );

  test("checks the permissions the Log model declares", () => {
    expect(permissionChecks).toHaveLength(1);
    expect((permissionChecks[0] as { check: unknown }).check).toEqual({
      permissions: new Log().getReadPermissions(),
      wildcard: Permission.ReadAllOperationalResources,
    });
  });

  test("a project over its rate is answered 429 in plain text, before a row is read", async () => {
    jest.spyOn(CompatibleQueryRateLimit, "consume").mockResolvedValue({
      outcome: CompatibleQueryRateLimitOutcome.RateLimited,
      retryAfterSeconds: 12,
      isFirstRejectionInWindow: false,
    });

    const route: RecordedRoute = findRoute(
      "GET",
      `${LOKI_API_PATH}/query_range`,
    );
    const rateLimit: RouteHandler = route.handlers[route.handlers.length - 2]!;
    const setHeader: jest.Mock = jest.fn();
    const next: jest.Mock = jest.fn();

    await rateLimit(
      { tenantId: PROJECT_ID, headers: {} } as unknown as ExpressRequest,
      { setHeader } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "12");
    expect(lastText()).toEqual({
      statusCode: 429,
      text: `${COMPATIBLE_QUERY_TOO_MANY_MESSAGE}\n`,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
    expect(statements).toHaveLength(0);
  });

  test("a log query reads the caller's project and services, newest first, and answers streams", async () => {
    rows = [
      CHECKOUT_ROW(20, "POST /pay 503"),
      CHECKOUT_ROW(10, "POST /pay 500"),
    ];

    await call({
      method: "GET",
      path: "/query_range",
      query: {
        query: '{service_name="checkout"} |= "pay"',
        start: at(0),
        end: at(60),
        limit: "2",
      },
    });

    const body: JSONObject = lastJson();
    const data: JSONObject = body["data"] as JSONObject;

    expect(body["status"]).toBe("success");
    expect(data["resultType"]).toBe("streams");
    expect(data["result"]).toEqual([
      {
        stream: {
          detected_level: "error",
          http_method: "POST",
          service_name: "checkout",
        },
        values: [
          [at(20), "POST /pay 503"],
          [at(10), "POST /pay 500"],
        ],
      },
    ]);
    expect(data["stats"]).toMatchObject({
      summary: { totalEntriesReturned: 2, totalLinesProcessed: 2 },
    });

    expect(statements).toHaveLength(1);
    const params: Array<unknown> = Object.values(statements[0]!.query_params);
    expect(params).toContain(PROJECT_ID.toString());
    expect(params).toContainEqual([SERVICE_ID.toString()]);
    expect(params).toContain("checkout");
    expect(params).toContain("pay");
    expect(statements[0]!.query).toContain(
      "ORDER BY time DESC, timeUnixNano DESC",
    );
  });

  test("Grafana's health check is answered without reading a log", async () => {
    await call({
      method: "GET",
      path: "/query",
      query: { query: "vector(1)+vector(1)", time: String(T0_S) },
    });

    expect(lastJson()).toMatchObject({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: {}, value: [T0_S, "2"] }],
      },
    });
    expect(statements).toHaveLength(0);
  });

  test("a query mistake answers 400 in plain text, as Loki does", async () => {
    await call({
      method: "POST",
      path: "/query_range",
      body: { query: "{}" },
    });

    const answer: {
      statusCode: number;
      text: string;
      headers: Record<string, string>;
    } = lastText();

    expect(answer.statusCode).toBe(400);
    expect(answer.text).toMatch(
      /^parse error at line 1, col 1: .*at least one regexp or equality matcher/,
    );
    expect(answer.headers["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(statements).toHaveLength(0);
  });

  test("labels are the keys the caller's logs were seen with, as Loki labels, and detected_level", async () => {
    const keys: jest.SpiedFunction<
      typeof TelemetryAttributeService.fetchAttributes
    > = jest
      .spyOn(TelemetryAttributeService, "fetchAttributes")
      .mockResolvedValue(["resource.service.name", "http.method", "level"]);

    await call({ method: "GET", path: "/labels" });

    expect(lastJson()).toEqual({
      status: "success",
      data: ["detected_level", "http_method", "level", "service_name"],
    });
    expect(keys).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      telemetryType: TelemetryType.Log,
      serviceFilter: { serviceIds: [SERVICE_ID] },
    });
  });

  test("a label's values are read from the keys that are that label, in the window", async () => {
    jest
      .spyOn(TelemetryAttributeService, "fetchAttributes")
      .mockResolvedValue(["resource.service.name", "http.method"]);
    const values: jest.SpiedFunction<
      typeof TelemetryAttributeService.fetchAttributeValues
    > = jest
      .spyOn(TelemetryAttributeService, "fetchAttributeValues")
      .mockResolvedValue(["checkout", "billing"]);

    await call({
      method: "GET",
      path: "/label/:labelName/values",
      params: { labelName: "service_name" },
      query: { start: String(T0_S), end: String(T0_S + 3600) },
    });

    expect(lastJson()).toEqual({
      status: "success",
      data: ["billing", "checkout"],
    });
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      telemetryType: TelemetryType.Log,
      attributeKey: "resource.service.name",
      serviceFilter: { serviceIds: [SERVICE_ID] },
      startTime: new Date(T0_S * 1000),
      endTime: new Date((T0_S + 3600) * 1000),
    });
  });

  test("detected_level's values are the levels the caller's logs have", async () => {
    jest
      .spyOn(TelemetryAttributeService, "fetchAttributes")
      .mockResolvedValue([]);
    rows = [{ level: "error" }, { level: "info" }];

    await call({
      method: "GET",
      path: "/label/:labelName/values",
      params: { labelName: "detected_level" },
    });

    expect(lastJson()).toEqual({
      status: "success",
      data: ["error", "info"],
    });
    expect(statements[0]!.query).toContain("SELECT DISTINCT");
    expect(statements[0]!.query).toContain("read_overflow_mode = 'break'");
  });

  test("series answers the label sets match[] selects, each once", async () => {
    rows = [CHECKOUT_ROW(10, "a"), CHECKOUT_ROW(20, "b")];

    await call({
      method: "GET",
      path: "/series",
      query: { "match[]": '{service_name="checkout"}' },
    });

    expect(lastJson()).toEqual({
      status: "success",
      data: [
        {
          detected_level: "error",
          http_method: "POST",
          service_name: "checkout",
        },
      ],
    });
  });

  test("buildinfo is answered unwrapped, as Loki answers it", async () => {
    const route: RecordedRoute = findRoute(
      "GET",
      `${LOKI_API_PATH}/status/buildinfo`,
    );

    await route.handlers[route.handlers.length - 1]!(
      {} as ExpressRequest,
      {} as ExpressResponse,
      jest.fn() as unknown as NextFunction,
    );

    expect(lastJson()).toEqual(LOKI_BUILD_INFO);
  });

  test("a request with no project is handed to the server's error handling", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({} as never);

    const { next } = await call({
      method: "GET",
      path: "/query_range",
      query: { query: '{service_name="checkout"}' },
    });

    expect(next).toHaveBeenCalled();
    expect(String((next.mock.calls[0] as Array<unknown>)[0])).toContain(
      "names no project",
    );
  });
});
