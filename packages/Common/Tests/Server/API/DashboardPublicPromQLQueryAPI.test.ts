import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import PublicDashboardRateLimit, {
  PublicDashboardRateLimitBucket,
} from "../../../Server/Middleware/PublicDashboardRateLimit";
import DashboardService from "../../../Server/Services/DashboardService";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
  getVariableValueNotOfferedMessage,
} from "../../../Server/Utils/Dashboard/PublicDashboardPromQLPolicy";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { PUBLIC_DASHBOARD_PROMQL_QUERY_PATH } from "../../../Types/Dashboard/PublicDashboardPromQL";
import { DataSourceResultKind } from "../../../Types/DataSource/DataSourceQueryConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
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

/*
 * Every PromQL query the route runs, by what it is asked: the engine and
 * the project's metrics are stood in for, so what the route hands them is
 * what is tested.
 */
const runPromQLMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/PromQL/PromQLDataSourceQuery", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/PromQL/PromQLDataSourceQuery",
  );

  return {
    ...actual,
    runPromQLOverProjectMetrics: (...args: Array<unknown>): unknown => {
      return runPromQLMock(...args);
    },
  };
});

/*
 * A public dashboard's PromQL widgets (issue #10226), through the route an
 * anonymous visitor's page calls, tried as an attacker would: a query sent
 * in the body, a widget id from another dashboard, a variable outside its
 * allowed values and a dashboard of another project - and access, decided
 * before anything is read.
 */

const ROUTE: string = `/dashboard${PUBLIC_DASHBOARD_PROMQL_QUERY_PATH}/:dashboardId`;

const CHART_ID: string = "ab000000-0000-4000-8000-0000000000c1";
const VALUE_ID: string = "ab000000-0000-4000-8000-0000000000c2";
const OUTSIDE_ID: string = "ab000000-0000-4000-8000-0000000000c3";

const STORED_QUERY: string =
  'sum by (pod) (rate(http_requests_total{env="{{env}}"}[{{range}}]))';

const WINDOW: JSONObject = {
  startDate: "2026-11-20T08:00:00.000Z",
  endDate: "2026-11-20T09:00:00.000Z",
};

type BuildConfigFunction = (
  widgets: Array<JSONObject>,
) => DashboardViewConfig;

const buildConfig: BuildConfigFunction = (
  widgets: Array<JSONObject>,
): DashboardViewConfig => {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 24,
    variables: [
      {
        id: "var-range",
        name: "range",
        type: DashboardVariableType.CustomList,
        customListValues: "1m,5m",
        selectedValue: "5m",
      },
      {
        id: "var-env",
        name: "env",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: "deployment.environment",
        defaultValue: "prod",
      },
    ],
    components: widgets.map((widget: JSONObject, index: number) => {
      return {
        _type: "DashboardComponent",
        topInDashboardUnits: index,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
        ...widget,
      };
    }),
  } as unknown as DashboardViewConfig;
};

const WIDGETS: Array<JSONObject> = [
  {
    componentId: CHART_ID,
    componentType: DashboardComponentType.DataSourceChart,
    arguments: {
      chartTitle: "Requests",
      queries: [
        {
          id: "q1",
          dataSourceId: "oneuptime-metrics",
          query: STORED_QUERY,
          legend: "{{pod}}",
        },
      ],
    },
  },
  {
    componentId: VALUE_ID,
    componentType: DashboardComponentType.DataSourceValue,
    arguments: {
      title: "Up",
      query: { dataSourceId: "oneuptime-metrics", query: "sum(up)" },
    },
  },
  // A widget of an outside Prometheus: never on a public dashboard.
  {
    componentId: OUTSIDE_ID,
    componentType: DashboardComponentType.DataSourceValue,
    arguments: {
      title: "Outside",
      query: {
        dataSourceId: "ab000000-0000-4000-8000-0000000000d1",
        query: "outside_secret_metric",
      },
    },
  },
];

describe("DashboardAPI public PromQL query", () => {
  let dashboards: Map<string, Dashboard>;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: jest.Mock;
  let selects: Array<{ id: string; select: JSONObject }>;
  let promQLRateLimit: unknown;

  beforeAll(() => {
    mockRouter.routes.length = 0;

    const getMiddleware: typeof PublicDashboardRateLimit.getMiddleware =
      PublicDashboardRateLimit.getMiddleware.bind(PublicDashboardRateLimit);

    const spy: jest.SpyInstance = jest
      .spyOn(PublicDashboardRateLimit, "getMiddleware")
      .mockImplementation(
        (bucket?: PublicDashboardRateLimitBucket): ReturnType<
          typeof PublicDashboardRateLimit.getMiddleware
        > => {
          const middleware: ReturnType<
            typeof PublicDashboardRateLimit.getMiddleware
          > = getMiddleware(bucket);

          if (bucket === PublicDashboardRateLimitBucket.PromQL) {
            promQLRateLimit = middleware;
          }

          return middleware;
        },
      );

    new DashboardAPI();
    spy.mockRestore();
  });

  const makeDashboard: (data: {
    projectId: ObjectID;
    widgets: Array<JSONObject>;
    isPublicDashboard?: boolean;
  }) => Dashboard = (data: {
    projectId: ObjectID;
    widgets: Array<JSONObject>;
    isPublicDashboard?: boolean;
  }): Dashboard => {
    const made: Dashboard = new Dashboard();
    made.id = ObjectID.generate();
    made.projectId = data.projectId;
    made.isPublicDashboard = data.isPublicDashboard ?? true;
    made.enableMasterPassword = false;
    made.requireSignIn = false;
    made.isArchived = false;
    made.dashboardViewConfig = buildConfig(data.widgets);
    dashboards.set(made.id.toString(), made);
    return made;
  };

  const call: (body: JSONObject, target?: Dashboard) => Promise<void> =
    async (body: JSONObject, target?: Dashboard): Promise<void> => {
      const request: ExpressRequest = {
        params: { dashboardId: (target || dashboard).id!.toString() },
        body: { ...WINDOW, ...body },
        query: {},
        cookies: {},
        headers: {},
        socket: {},
        ips: [],
      } as unknown as ExpressRequest;

      await mockRouter
        .match("post", ROUTE)
        .handlerFunction(request, mockResponse, nextFunction);
    };

  const thrown: () => unknown = (): unknown => {
    expect(nextFunction).toHaveBeenCalledTimes(1);
    return nextFunction.mock.calls[0]![0];
  };

  const asked: () => JSONObject = (): JSONObject => {
    expect(runPromQLMock).toHaveBeenCalledTimes(1);
    return runPromQLMock.mock.calls[0]![0] as JSONObject;
  };

  const answered: () => JSONObject = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return calls[0]![2] as JSONObject;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dashboards = new Map<string, Dashboard>();
    selects = [];
    dashboard = makeDashboard({
      projectId: ObjectID.generate(),
      widgets: WIDGETS,
    });

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    // A lookup gets back only the columns it selected.
    jest
      .spyOn(DashboardService, "findOneById")
      .mockImplementation(
        async (findBy: {
          id: ObjectID;
          select: JSONObject;
        }): Promise<Dashboard | null> => {
          selects.push({ id: findBy.id.toString(), select: findBy.select });
          const found: Dashboard | undefined = dashboards.get(
            findBy.id.toString(),
          );

          if (!found) {
            return null;
          }

          const projected: Dashboard = new Dashboard();

          for (const column of Object.keys(findBy.select)) {
            (projected as unknown as Record<string, unknown>)[column] = (
              found as unknown as Record<string, unknown>
            )[column];
          }

          projected.id = found.id!;

          return projected;
        },
      );

    runPromQLMock.mockResolvedValue({
      resultKind: DataSourceResultKind.TimeSeries,
      result: {
        data: [
          {
            timestamp: new Date("2026-11-20T08:30:00.000Z"),
            value: 4,
            attributes: { pod: "api-1", node: "secret-node" },
          } as unknown as AggregatedModel,
        ],
        truncated: false,
      },
    });

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("runs the query stored in the widget, with its variables at their saved values, over the dashboard's project", async () => {
    await call({ componentId: CHART_ID, queryIndex: 0 });

    expect(nextFunction).not.toHaveBeenCalled();

    const request: JSONObject = asked();

    expect(request["query"]).toBe(
      'sum by (pod) (rate(http_requests_total{env="prod"}[5m]))',
    );
    expect(request["projectId"]).toEqual(dashboard.projectId);
    expect(request["serviceFilter"]).toEqual({});
    expect(request["resultKind"]).toBe(DataSourceResultKind.TimeSeries);
    expect((request["startDate"] as Date).toISOString()).toBe(
      WINDOW["startDate"],
    );
    // The step is worked out from the window, never sent.
    expect(request["stepInSeconds"]).toBeUndefined();
  });

  it("never runs a query sent in the body: the stored one runs, whatever the request names", async () => {
    await call({
      componentId: VALUE_ID,
      query: 'secret_metric_total{token=~".+"}',
      promQL: "secret_metric_total",
      dataSourceId: "ab000000-0000-4000-8000-0000000000d1",
      resultKind: DataSourceResultKind.Table,
      stepInSeconds: 1,
      projectId: ObjectID.generate().toString(),
    });

    const request: JSONObject = asked();

    expect(request["query"]).toBe("sum(up)");
    expect(request["resultKind"]).toBe(DataSourceResultKind.TimeSeries);
    expect(request["stepInSeconds"]).toBeUndefined();
    expect(request["projectId"]).toEqual(dashboard.projectId);
    expect(JSON.stringify(request)).not.toContain("secret");
  });

  it("refuses a widget id from another dashboard - one of another project too - and runs nothing", async () => {
    const otherProjectWidgetId: string = "ab000000-0000-4000-8000-0000000000e1";

    makeDashboard({
      projectId: ObjectID.generate(),
      widgets: [
        {
          componentId: otherProjectWidgetId,
          componentType: DashboardComponentType.DataSourceValue,
          arguments: {
            query: {
              dataSourceId: "oneuptime-metrics",
              query: "other_project_secret",
            },
          },
        },
      ],
    });

    await call({ componentId: otherProjectWidgetId });

    const error: unknown = thrown();

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
    );
    expect(runPromQLMock).not.toHaveBeenCalled();
  });

  it("reads another project's dashboard for its own project only, never the one asked about first", async () => {
    const other: Dashboard = makeDashboard({
      projectId: ObjectID.generate(),
      widgets: WIDGETS,
    });

    await call({ componentId: VALUE_ID }, other);

    expect(asked()["projectId"]).toEqual(other.projectId);
    expect(asked()["projectId"]).not.toEqual(dashboard.projectId);
  });

  it("refuses a widget of an outside system, which a public dashboard leaves out, and runs nothing", async () => {
    await call({ componentId: OUTSIDE_ID });

    expect((thrown() as Error).message).toBe(
      PUBLIC_DASHBOARD_PROMQL_WIDGET_NOT_FOUND_MESSAGE,
    );
    expect(runPromQLMock).not.toHaveBeenCalled();
  });

  it("refuses a variable outside its allowed values, and runs nothing", async () => {
    await call({
      componentId: CHART_ID,
      variables: [{ id: "var-range", selectedValue: "5m]) or vector(1" }],
    });

    expect((thrown() as Error).message).toBe(
      getVariableValueNotOfferedMessage("range"),
    );
    expect(runPromQLMock).not.toHaveBeenCalled();
  });

  it("fills an allowed pick in, a free value only as the matcher's quoted value", async () => {
    await call({
      componentId: CHART_ID,
      variables: [
        { id: "var-range", selectedValue: "1m" },
        { id: "var-env", selectedValue: 'x"} or vector(1) or up{a="' },
      ],
    });

    expect(asked()["query"]).toBe(
      'sum by (pod) (rate(http_requests_total{env="x\\"} or vector(1) or up{a=\\""}[1m]))',
    );
  });

  it("decides access before anything is read: a dashboard shared only with its project reads nothing it would send", async () => {
    const privateDashboard: Dashboard = makeDashboard({
      projectId: ObjectID.generate(),
      widgets: WIDGETS,
      isPublicDashboard: false,
    });

    await call({ componentId: VALUE_ID }, privateDashboard);

    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(runPromQLMock).not.toHaveBeenCalled();
    expect(
      selects.some((lookup: { select: JSONObject }): boolean => {
        return Boolean(lookup.select["dashboardViewConfig"]);
      }),
    ).toBe(false);
  });

  it("answers a value that is no dashboard id like a missing dashboard, without a query", async () => {
    const request: ExpressRequest = {
      params: { dashboardId: "not-a-dashboard" },
      body: { componentId: VALUE_ID, ...WINDOW },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    expect(nextFunction).toHaveBeenCalledTimes(1);
    expect(selects).toEqual([]);
    expect(runPromQLMock).not.toHaveBeenCalled();
  });

  it("answers only what the widget draws: a chart named by its legend gets only the labels it names", async () => {
    await call({ componentId: CHART_ID });

    const body: JSONObject = answered();

    expect(body["resultKind"]).toBe(DataSourceResultKind.TimeSeries);
    expect(JSON.stringify(body)).not.toContain("secret-node");
    expect(
      (
        (body["result"] as JSONObject)["data"] as Array<JSONObject>
      )[0]!["attributes"],
    ).toEqual({ pod: "api-1" });
  });

  it("is held to a rate bucket of its own, ahead of everything else", () => {
    const route: { middlewares: Array<unknown> } = mockRouter.match(
      "post",
      ROUTE,
    );

    expect(promQLRateLimit).toBeDefined();
    expect(route.middlewares[0]).toBe(promQLRateLimit);
  });

  it("is served without its queries' text, so the page names them by place", () => {
    const served: string = JSON.stringify(
      JSONFunctions.serialize(
        PublicDashboardViewConfig.sanitize(
          dashboard.dashboardViewConfig,
        ) as unknown as JSONObject,
      ),
    );

    expect(served).not.toContain("http_requests_total");
    expect(served).not.toContain("outside_secret_metric");
    expect(served).toContain(CHART_ID);
    expect(served).toContain(VALUE_ID);
    expect(served).not.toContain(OUTSIDE_ID);
  });
});
