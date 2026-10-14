import CommonAPI from "../../../Server/API/CommonAPI";
import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import ResourceEntityFilter, {
  ResourceEntityScope,
} from "../../../Server/Utils/Telemetry/ResourceEntityFilter";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import QueryTimeoutException from "../../../Types/Exception/QueryTimeoutException";
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
 * A telemetry search stopped at the 45 s query limit, at the API (issue
 * #4707).
 *
 * The routes behind the explorers run through their real guards and
 * handlers; the reads behind them reject the way they do when ClickHouse
 * stops them (a QueryTimeoutException, see ClickhouseReadResult). Each route
 * hands that to the error handler as it is — none of them swallows it into
 * an empty chart or a file of zero rows — and the error handler answers what
 * the reader and an API caller can act on:
 *
 *   504, {"error": "This query took longer than 45 seconds and was stopped
 *   before it finished. Try a shorter time range or more specific filters."}
 *
 * where a SyntaxError used to answer 500 {"error": "Server Error"}. Not 408:
 * a browser resends a request answered 408 on a reused connection, which
 * would run the 45-second search again before the reader saw anything.
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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const LIMIT_MESSAGE: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

interface Spy {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (implementation: (...args: Array<any>) => any) => unknown;
}

function spyOn<K extends string, T extends Record<K, unknown>>(
  target: T,
  method: K,
): Spy {
  return jest.spyOn(target as never, method as never) as unknown as Spy;
}

interface RouteOutcome {
  // What the handler passed to next(): the error the API answers with.
  thrownToNext: unknown;
  // Whether it wrote a response of its own instead.
  sent: boolean;
  sentBody: unknown;
}

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

describe("telemetry reads stopped at the query time limit", () => {
  let projectId: ObjectID;
  let viewerRequest: JSONObject;

  beforeAll(() => {
    recordedRoutes.length = 0;
    // TelemetryAPI calls Express.getRouter() at module scope; load it lazily.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../../../Server/API/TelemetryAPI");
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    projectId = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();

    const permissionMap: Dictionary<UserTenantAccessPermission> = {};
    permissionMap[projectId.toString()] = {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [Permission.ProjectMember].map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    };

    const databaseProps: DatabaseCommonInteractionProps = {
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: permissionMap,
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(databaseProps);

    viewerRequest = {
      userType: UserType.User,
      tenantId: projectId,
      userTenantAccessPermission: permissionMap,
      userAuthorization: { userId: userId },
    } as unknown as JSONObject;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function callRoute(
    uri: string,
    body: JSONObject,
  ): Promise<RouteOutcome> {
    const route: RecordedRoute = findRoute(uri);

    const outcome: RouteOutcome = {
      thrownToNext: undefined,
      sent: false,
      sentBody: undefined,
    };

    const req: ExpressRequest = {
      ...viewerRequest,
      body: body,
      params: {},
      query: {},
      headers: { "user-agent": "jest-agent" },
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      setHeader: (): void => {
        // no-op
      },
      status: (): ExpressResponse => {
        return res;
      },
      send: (sent: unknown): void => {
        outcome.sent = true;
        outcome.sentBody = sent;
      },
      json: (): void => {
        outcome.sent = true;
      },
    } as unknown as ExpressResponse;

    // Index 0 (getUserMiddleware) only fills in what the request carries.
    for (let index: number = 1; index < route.handlers.length; index++) {
      const step: { calledNext: boolean } = { calledNext: false };

      const next: NextFunction = ((error?: unknown): void => {
        step.calledNext = true;

        if (error) {
          outcome.thrownToNext = error;
        }
      }) as unknown as NextFunction;

      await route.handlers[index]!(req, res, next);

      if (!step.calledNext || outcome.thrownToNext) {
        break;
      }
    }

    if (
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock.calls
        .length > 0
    ) {
      outcome.sent = true;
    }

    return outcome;
  }

  /*
   * What the error handler answers for an error a route passed to next():
   * an Exception's code is the status and its message the body's `error`
   * (StartServerErrorStatus pins the handler itself).
   */
  function answerFor(error: unknown): { status: number; body: unknown } {
    return {
      status: (error as QueryTimeoutException).code,
      body: { error: (error as QueryTimeoutException).message },
    };
  }

  function stopAtLimit(service: unknown, method: string): Spy {
    const spy: Spy = spyOn(service as Record<string, unknown>, method);
    spy.mockImplementation(async (): Promise<never> => {
      throw new QueryTimeoutException(LIMIT_MESSAGE);
    });
    return spy;
  }

  describe.each([
    ["/telemetry/logs/histogram", LogAggregationService, "getHistogram", {}],
    [
      "/telemetry/logs/analytics",
      LogAggregationService,
      "getAnalyticsTimeseries",
      { chartType: "timeseries" },
    ],
    ["/telemetry/logs/export", LogAggregationService, "getExportLogs", {}],
    [
      "/telemetry/logs/error-patterns",
      LogAggregationService,
      "getTopErrorPatterns",
      {},
    ],
    [
      "/telemetry/traces/histogram",
      TraceAggregationService,
      "getHistogram",
      {},
    ],
    [
      "/telemetry/traces/analytics",
      TraceAggregationService,
      "getAnalyticsTimeseries",
      { chartType: "timeseries" },
    ],
    [
      "/telemetry/exceptions/histogram",
      ExceptionAggregationService,
      "getHistogram",
      {},
    ],
  ])(
    "POST %s",
    (uri: string, service: unknown, method: string, body: JSONObject) => {
      test("hands the stop to the error handler, which answers 504 with what to try", async () => {
        const read: Spy = stopAtLimit(service, method);

        const outcome: RouteOutcome = await callRoute(uri, body);

        expect(read.mock.calls.length).toBe(1);
        // Nothing written of its own: no empty chart, no empty file.
        expect(outcome.sent).toBe(false);
        expect(outcome.thrownToNext).toBeInstanceOf(QueryTimeoutException);
        expect(answerFor(outcome.thrownToNext)).toEqual({
          status: 504,
          body: { error: LIMIT_MESSAGE },
        });
      });
    },
  );

  describe("POST /telemetry/logs/export", () => {
    /*
     * The export took the time range, services, severities, body text and
     * trace / span / session ids, and dropped the rest: a search narrowed
     * to one attribute value exported every row of the window. It now takes
     * every filter the histogram and the facets take.
     */
    test("narrows the file by the attribute, entity-key and resource filters the search uses", async () => {
      const fleetId: string = ObjectID.generate().toString();
      const fleetScope: ResourceEntityScope = {
        entityIds: [fleetId],
        entityKeys: [],
        attributeKey: "resource.iot.fleet.name",
        attributeValues: ["sensors"],
      };
      spyOn(ResourceEntityFilter, "resolveScopes").mockImplementation(
        async (): Promise<Array<ResourceEntityScope>> => {
          return [fleetScope];
        },
      );

      const exportRead: Spy = spyOn(LogAggregationService, "getExportLogs");
      exportRead.mockImplementation(async (): Promise<Array<JSONObject>> => {
        return [];
      });

      const attributes: JSONObject = {
        "http.route": "/orders/export",
        "http.method": ["GET", "POST"],
        "user.id": { _type: "StartsWith", value: "user-1" },
      };

      await callRoute("/telemetry/logs/export", {
        attributes: attributes,
        entityKeys: ["entity-key-1"],
        resourceFilters: { iotFleetId: [fleetId] },
        severityTexts: ["Error"],
        bodySearchText: "timeout",
        format: "json",
      });

      expect(exportRead.mock.calls.length).toBe(1);
      expect(exportRead.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          projectId: projectId,
          attributes: attributes,
          entityKeys: ["entity-key-1"],
          resourceScopes: [fleetScope],
          severityTexts: ["Error"],
          bodySearchText: "timeout",
        }),
      );
    });

    test("a search with none of them exports as before", async () => {
      const exportRead: Spy = spyOn(LogAggregationService, "getExportLogs");
      exportRead.mockImplementation(async (): Promise<Array<JSONObject>> => {
        return [{ body: "a" }];
      });

      const outcome: RouteOutcome = await callRoute("/telemetry/logs/export", {
        format: "json",
      });

      const request: JSONObject = exportRead.mock.calls[0]![0] as JSONObject;

      expect(request["attributes"]).toBeUndefined();
      expect(request["entityKeys"]).toBeUndefined();
      expect(request["resourceScopes"]).toBeUndefined();
      expect(outcome.sentBody).toBe(JSON.stringify([{ body: "a" }], null, 2));
    });
  });
});
