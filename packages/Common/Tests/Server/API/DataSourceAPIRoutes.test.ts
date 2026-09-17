import type {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

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

/*
 * The shared Helpers.mockRouter assumes (uri, middleware, handler) routes;
 * DataSourceAPI stacks TWO middlewares before the handler, so this file
 * records the full handler chain instead.
 */
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
        put: jest.fn().mockImplementation(record("PUT")),
        delete: jest.fn().mockImplementation(record("DELETE")),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

import DataSourceAPI from "../../../Server/API/DataSourceAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Response from "../../../Server/Utils/Response";
import DataSourceService from "../../../Server/Services/DataSourceService";
import ConnectorRegistry from "../../../Server/Utils/DataSource/ConnectorRegistry";
import { DataSourceConnector } from "../../../Server/Utils/DataSource/Types";
import DataSource from "../../../Models/DatabaseModels/DataSource";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import { DataSourceResultKind } from "../../../Types/DataSource/DataSourceQueryConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";

const QUERY_ROUTE: string = "/data-source/query";
const TEST_ROUTE: string = "/data-source/test";

function findRoute(uri: string): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute) => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );
  if (!route) {
    throw new Error(`Route not registered: POST ${uri}`);
  }
  return route;
}

async function callRoute(
  uri: string,
  body: JSONObject,
): Promise<{ next: jest.Mock }> {
  const route: RecordedRoute = findRoute(uri);
  const handler: RouteHandler = route.handlers[route.handlers.length - 1]!;

  const req: ExpressRequest = {
    params: {},
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await handler(req, res, next as unknown as NextFunction);
  return { next };
}

function fakeConnector(): DataSourceConnector & {
  queryTimeSeries: jest.Mock;
  queryTable: jest.Mock;
  testConnection: jest.Mock;
} {
  return {
    dataSourceType: DataSourceType.Prometheus,
    testConnection: jest.fn(),
    queryTimeSeries: jest
      .fn()
      .mockResolvedValue({ data: [], truncated: false } as never),
    queryTable: jest.fn().mockResolvedValue({ columns: [], rows: [] } as never),
  } as unknown as DataSourceConnector & {
    queryTimeSeries: jest.Mock;
    queryTable: jest.Mock;
    testConnection: jest.Mock;
  };
}

describe("DataSourceAPI custom routes", () => {
  const dataSourceId: ObjectID = ObjectID.generate();

  beforeAll(() => {
    recordedRoutes.length = 0;
    new DataSourceAPI();
  });

  beforeEach(() => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        tenantId: ObjectID.generate(),
        userId: ObjectID.generate(),
      } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Response.sendErrorResponse as jest.Mock).mockClear();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  });

  test("both custom routes require authentication (middleware chain)", () => {
    for (const uri of [QUERY_ROUTE, TEST_ROUTE]) {
      const route: RecordedRoute = findRoute(uri);
      expect(route.handlers).toContain(
        UserMiddleware.getUserMiddleware as unknown as RouteHandler,
      );
      expect(route.handlers).toContain(
        UserMiddleware.requireUserAuthentication as unknown as RouteHandler,
      );
    }
  });

  test("query route rejects a missing query without touching the database", async () => {
    const findSpy: jest.SpiedFunction<typeof DataSourceService.findOneById> =
      jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(null);

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      startDate: new Date().toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(Response.sendErrorResponse).toHaveBeenCalled();
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("query route rejects an invalid time window", async () => {
    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(null);

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "up",
      startDate: "not-a-date",
      endDate: new Date().toISOString(),
    });
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "up",
      // start after end.
      startDate: new Date(Date.now() + 60_000).toISOString(),
      endDate: new Date().toISOString(),
    });
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(2);
  });

  test("query route denies access before any root credential read", async () => {
    // User-scoped read comes back null: wrong project or no permission.
    const findSpy: jest.SpiedFunction<typeof DataSourceService.findOneById> =
      jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(null);
    const settingsSpy: jest.SpiedFunction<
      typeof DataSourceService.getConnectionSettingsById
    > = jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue(null);

    const { next } = await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "up",
      startDate: new Date(Date.now() - 3600_000).toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
  });

  test("query route rejects a malformed id without a database query", async () => {
    const findSpy: jest.SpiedFunction<typeof DataSourceService.findOneById> =
      jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(null);

    const { next } = await callRoute(QUERY_ROUTE, {
      dataSourceId: "'; DROP TABLE users; --",
      query: "up",
      startDate: new Date(Date.now() - 3600_000).toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(findSpy).not.toHaveBeenCalled();
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
  });

  test("query route executes a time-series query through the connector", async () => {
    const record: DataSource = {
      id: dataSourceId,
      _id: dataSourceId.toString(),
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.Prometheus,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    const startDate: Date = new Date(Date.now() - 3600_000);
    const endDate: Date = new Date();

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "up",
      resultKind: DataSourceResultKind.TimeSeries,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      stepInSeconds: 30,
    });

    expect(connector.queryTimeSeries).toHaveBeenCalledTimes(1);
    expect(connector.queryTable).not.toHaveBeenCalled();

    const callArguments: Array<unknown> = connector.queryTimeSeries.mock
      .calls[0] as Array<unknown>;
    expect(callArguments[1]).toBe("up");
    const window: { startDate: Date; endDate: Date; stepInSeconds?: number } =
      callArguments[2] as {
        startDate: Date;
        endDate: Date;
        stepInSeconds?: number;
      };
    expect(window.startDate.getTime()).toBe(startDate.getTime());
    expect(window.endDate.getTime()).toBe(endDate.getTime());
    expect(window.stepInSeconds).toBe(30);

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    const payload: JSONObject = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0]![2] as JSONObject;
    expect(payload["resultKind"]).toBe(DataSourceResultKind.TimeSeries);
    expect(payload["result"]).toEqual({ data: [], truncated: false });
  });

  test("query route clamps fractional stepInSeconds and drops non-positive ones", async () => {
    const record: DataSource = {
      id: dataSourceId,
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.Prometheus,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    /*
     * A sub-second step would floor to 0, which Loki/Prometheus reject —
     * the route clamps up to 1. Larger fractions floor; non-positive
     * steps are dropped so the connector derives its own.
     */
    const stepCases: Array<{ input: number; expected: number | undefined }> = [
      { input: 0.5, expected: 1 },
      { input: 90.9, expected: 90 },
      { input: -5, expected: undefined },
    ];

    for (const stepCase of stepCases) {
      await callRoute(QUERY_ROUTE, {
        dataSourceId: dataSourceId.toString(),
        query: "up",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(Date.now() - 3600_000).toISOString(),
        endDate: new Date().toISOString(),
        stepInSeconds: stepCase.input,
      });
    }

    expect(connector.queryTimeSeries).toHaveBeenCalledTimes(stepCases.length);

    stepCases.forEach(
      (
        stepCase: { input: number; expected: number | undefined },
        index: number,
      ) => {
        const window: { stepInSeconds?: number } = connector.queryTimeSeries
          .mock.calls[index]![2] as { stepInSeconds?: number };
        expect(window.stepInSeconds).toBe(stepCase.expected);
      },
    );
  });

  test("query route routes Table result kind to queryTable", async () => {
    const record: DataSource = {
      id: dataSourceId,
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.PostgreSQL,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.PostgreSQL,
        databaseHost: "db.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "SELECT 1 AS value",
      resultKind: DataSourceResultKind.Table,
      startDate: new Date(Date.now() - 3600_000).toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(connector.queryTable).toHaveBeenCalledTimes(1);
    expect(connector.queryTimeSeries).not.toHaveBeenCalled();
  });

  test("query route surfaces connector failures as a friendly error", async () => {
    const record: DataSource = {
      id: dataSourceId,
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.Prometheus,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    connector.queryTimeSeries.mockRejectedValue(
      new BadDataException("parse error at char 5") as never,
    );
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    await callRoute(QUERY_ROUTE, {
      dataSourceId: dataSourceId.toString(),
      query: "up{",
      startDate: new Date(Date.now() - 3600_000).toISOString(),
      endDate: new Date().toISOString(),
    });

    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    const error: BadDataException = (Response.sendErrorResponse as jest.Mock)
      .mock.calls[0]![2] as BadDataException;
    expect(error.message).toContain("parse error at char 5");
  });

  test("test route reports connector failures as ok:false, not an exception", async () => {
    const record: DataSource = {
      id: dataSourceId,
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.Prometheus,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    connector.testConnection.mockRejectedValue(
      new BadDataException("connection refused") as never,
    );
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    await callRoute(TEST_ROUTE, {
      dataSourceId: dataSourceId.toString(),
    });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
    const payload: JSONObject = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0]![2] as JSONObject;
    expect(payload["ok"]).toBe(false);
    expect(payload["message"]).toContain("connection refused");
  });

  test("test route reports success", async () => {
    const record: DataSource = {
      id: dataSourceId,
      projectId: ObjectID.generate(),
      dataSourceType: DataSourceType.Prometheus,
    } as unknown as DataSource;

    jest.spyOn(DataSourceService, "findOneById").mockResolvedValue(record);
    jest
      .spyOn(DataSourceService, "getConnectionSettingsById")
      .mockResolvedValue({
        dataSourceType: DataSourceType.Prometheus,
        url: "https://prometheus.example.com",
      });

    const connector: ReturnType<typeof fakeConnector> = fakeConnector();
    jest.spyOn(ConnectorRegistry, "getConnector").mockReturnValue(connector);

    await callRoute(TEST_ROUTE, {
      dataSourceId: dataSourceId.toString(),
    });

    const payload: JSONObject = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0]![2] as JSONObject;
    expect(payload["ok"]).toBe(true);
  });
});
