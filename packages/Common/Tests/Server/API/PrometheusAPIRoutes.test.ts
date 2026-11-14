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
    sendErrorResponse: jest.fn(),
  };
});

import PrometheusAPI, {
  PROMETHEUS_API_PATH,
  PROMETHEUS_BUILD_INFO,
  readApiKeyFromAuthorization,
} from "../../../Server/API/PrometheusAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import MetricService from "../../../Server/Services/MetricService";
import MetricTypeService from "../../../Server/Services/MetricTypeService";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { getMetricReadPermissions } from "../../../Server/Utils/Telemetry/MetricReadPermissions";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The Prometheus HTTP API's routes (issue #6796): who may call them, how a
 * Prometheus client's credentials reach the API key check, and a query
 * answered end to end with ClickHouse in a test double.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a6d3b1c-7f8e-4a2b-9c0d-1e2f3a4b5c6d",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0f1e2d3c-4b5a-4968-8776-655443322110",
);
const API_KEY: string = "8c5e3a2b-1d4f-4e6a-9b7c-0d1e2f3a4b5c";

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
    `${PROMETHEUS_API_PATH}${data.path}`,
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

const lastAnswer: () => { body: JSONObject; statusCode: number } = (): {
  body: JSONObject;
  statusCode: number;
} => {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;
  const last: Array<unknown> = calls[calls.length - 1]!;
  const options: { statusCode?: { toNumber: () => number } } | undefined =
    last[3] as { statusCode?: { toNumber: () => number } } | undefined;

  return {
    body: last[2] as JSONObject,
    statusCode: options?.statusCode?.toNumber() ?? 200,
  };
};

describe("Prometheus API routes", () => {
  const statements: Array<Statement> = [];

  beforeEach(() => {
    statements.length = 0;
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({ tenantId: PROJECT_ID } as never);
    jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockResolvedValue({ serviceIds: [SERVICE_ID] });
    jest
      .spyOn(MetricTypeService, "findBy")
      .mockResolvedValue([{ name: "http_requests" } as MetricType] as never);
    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation(
        async (statement: Statement | string): Promise<never> => {
          /*
           * The service takes a bare string too; the routes bind every
           * read's values in a Statement, which the tests below read.
           */
          statements.push(statement as Statement);
          const rows: Array<JSONObject> = [];

          // A counter that grows by 60 a minute: one per second.
          for (let minute: number = 1; minute <= 10; minute++) {
            rows.push({
              name: "http_requests",
              metricPointType: "Sum",
              aggregationTemporality: "Cumulative",
              attributes: { "resource.service.name": "checkout" },
              timestampMs: String(minute * 60000),
              value: minute * 60,
            });
          }

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
  });

  test("is one router, served under /api", () => {
    expect(PrometheusAPI).toBeDefined();
    expect(PROMETHEUS_API_PATH).toBe("/prometheus/api/v1");
  });

  test.each([
    ["GET", "/query"],
    ["POST", "/query"],
    ["GET", "/query_range"],
    ["POST", "/query_range"],
    ["GET", "/series"],
    ["POST", "/series"],
    ["GET", "/labels"],
    ["POST", "/labels"],
    ["GET", "/label/:labelName/values"],
    ["GET", "/metadata"],
    ["GET", "/status/buildinfo"],
    ["GET", "/query_exemplars"],
    ["GET", "/rules"],
    ["GET", "/alerts"],
  ])(
    "%s %s needs a caller who may read metrics",
    (method: string, path: string) => {
      const route: RecordedRoute = findRoute(
        method,
        `${PROMETHEUS_API_PATH}${path}`,
      );

      expect(route.handlers).toContain(
        UserMiddleware.getUserMiddleware as unknown as RouteHandler,
      );
      expect(route.handlers).toContain(
        UserMiddleware.requireUserAuthentication as unknown as RouteHandler,
      );

      const permission: { middleware: jest.Mock; check: unknown } =
        permissionChecks[0] as { middleware: jest.Mock; check: unknown };

      expect(route.handlers).toContain(
        permission.middleware as unknown as RouteHandler,
      );
    },
  );

  test("checks the permissions the Metric model declares", () => {
    expect(permissionChecks).toHaveLength(1);
    expect((permissionChecks[0] as { check: unknown }).check).toEqual({
      permissions: getMetricReadPermissions(),
      wildcard: Permission.ReadAllOperationalResources,
    });
  });

  test("a range query reads the caller's project and services, and answers in Prometheus' shape", async () => {
    await call({
      method: "POST",
      path: "/query_range",
      body: {
        query: "sum by (job) (rate(http_requests_total[5m]))",
        start: "540",
        end: "600",
        step: "60",
      },
    });

    expect(lastAnswer()).toEqual({
      statusCode: 200,
      body: {
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { job: "checkout" },
              values: [
                [540, "1"],
                [600, "1"],
              ],
            },
          ],
        },
      },
    });

    expect(statements).toHaveLength(1);
    expect(Object.values(statements[0]!.query_params)).toContain(
      PROJECT_ID.toString(),
    );
    expect(Object.values(statements[0]!.query_params)).toContainEqual([
      SERVICE_ID.toString(),
    ]);
  });

  test("an instant query over GET", async () => {
    await call({
      method: "GET",
      path: "/query",
      query: { query: "sum(http_requests_total)", time: "600" },
    });

    expect(lastAnswer().body).toEqual({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: {}, value: [600, "600"] }],
      },
    });
  });

  test("a query mistake answers 400 with Prometheus' errorType", async () => {
    await call({
      method: "GET",
      path: "/query",
      query: { query: "rate(http_requests_total)" },
    });

    const answer: { body: JSONObject; statusCode: number } = lastAnswer();

    expect(answer.statusCode).toBe(400);
    expect(answer.body["status"]).toBe("error");
    expect(answer.body["errorType"]).toBe("bad_data");
    expect(answer.body["error"]).toContain("must be a range vector");
    expect(statements).toHaveLength(0);
  });

  test("series answers the label sets match[] selects", async () => {
    await call({
      method: "GET",
      path: "/series",
      query: { "match[]": "http_requests_total", start: "0", end: "600" },
    });

    expect(lastAnswer().body).toEqual({
      status: "success",
      data: [
        {
          __name__: "http_requests_total",
          job: "checkout",
          resource_service_name: "checkout",
        },
      ],
    });
  });

  test("series without match[] is refused", async () => {
    await call({ method: "GET", path: "/series" });

    expect(lastAnswer().statusCode).toBe(400);
    expect(lastAnswer().body["error"]).toContain("match[]");
  });

  test("label values with match[] are read from the series", async () => {
    await call({
      method: "GET",
      path: "/label/:labelName/values",
      params: { labelName: "job" },
      query: { "match[]": "http_requests_total", start: "0", end: "600" },
    });

    expect(lastAnswer().body).toEqual({
      status: "success",
      data: ["checkout"],
    });
  });

  test("buildinfo says it is a Prometheus 3 API", async () => {
    await call({ method: "GET", path: "/status/buildinfo" });

    expect(lastAnswer().body).toEqual({
      status: "success",
      data: PROMETHEUS_BUILD_INFO,
    });
  });

  test("rules and alerts are empty: OneUptime alerts with monitors", async () => {
    await call({ method: "GET", path: "/rules" });
    expect(lastAnswer().body).toEqual({
      status: "success",
      data: { groups: [] },
    });

    await call({ method: "GET", path: "/alerts" });
    expect(lastAnswer().body).toEqual({
      status: "success",
      data: { alerts: [] },
    });
  });

  test("a request with no project is handed to the server's error handling", async () => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({} as never);

    const { next } = await call({
      method: "GET",
      path: "/query",
      query: { query: "up" },
    });

    expect(next).toHaveBeenCalled();
    expect(String((next.mock.calls[0] as Array<unknown>)[0])).toContain(
      "names no project",
    );
  });
});

describe("a Prometheus client's credentials", () => {
  test("a bearer API key is read", () => {
    expect(readApiKeyFromAuthorization(`Bearer ${API_KEY}`)).toBe(API_KEY);
    expect(readApiKeyFromAuthorization(`bearer  ${API_KEY}`)).toBe(API_KEY);
  });

  test("a basic-auth password, or a user name alone, is read", () => {
    const encode: (text: string) => string = (text: string): string => {
      return Buffer.from(text).toString("base64");
    };

    expect(
      readApiKeyFromAuthorization(`Basic ${encode(`grafana:${API_KEY}`)}`),
    ).toBe(API_KEY);
    expect(readApiKeyFromAuthorization(`Basic ${encode(`${API_KEY}:`)}`)).toBe(
      API_KEY,
    );
    expect(
      readApiKeyFromAuthorization(`Basic ${encode("user:password")}`),
    ).toBe(undefined);
  });

  test("a signed-in session's token is left alone", () => {
    expect(
      readApiKeyFromAuthorization("Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc"),
    ).toBeUndefined();
    expect(readApiKeyFromAuthorization(undefined)).toBeUndefined();
    expect(readApiKeyFromAuthorization("Bearer")).toBeUndefined();
    expect(readApiKeyFromAuthorization(`Token ${API_KEY}`)).toBeUndefined();
  });

  test("the key is moved to the ApiKey header before the user is read", () => {
    const route: RecordedRoute = findRoute(
      "GET",
      `${PROMETHEUS_API_PATH}/query`,
    );
    const translate: RouteHandler = route.handlers[0]!;
    const req: ExpressRequest = {
      headers: { authorization: `Bearer ${API_KEY}` },
    } as unknown as ExpressRequest;
    const next: jest.Mock = jest.fn();

    translate(req, {} as ExpressResponse, next as unknown as NextFunction);

    expect(req.headers["apikey"]).toBe(API_KEY);
    expect(req.headers["authorization"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
    expect(route.handlers.indexOf(translate)).toBeLessThan(
      route.handlers.indexOf(
        UserMiddleware.getUserMiddleware as unknown as RouteHandler,
      ),
    );
  });

  test("an ApiKey header already sent is kept", () => {
    const route: RecordedRoute = findRoute(
      "GET",
      `${PROMETHEUS_API_PATH}/query`,
    );
    const translate: RouteHandler = route.handlers[0]!;
    const req: ExpressRequest = {
      headers: { apikey: "existing", authorization: `Bearer ${API_KEY}` },
    } as unknown as ExpressRequest;

    translate(req, {} as ExpressResponse, jest.fn() as unknown as NextFunction);

    expect(req.headers["apikey"]).toBe("existing");
  });
});
