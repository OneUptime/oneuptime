import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import MetricService from "../../../Server/Services/MetricService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
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

const METRICS_AGGREGATE_ROUTE: string =
  "/dashboard/metrics-aggregate/:dashboardId";

const CHARTED_METRIC_NAME: string = "system.cpu.utilization";

const CHARTED_GROUP_BY_KEY: string = "resource.host.name";

describe("DashboardAPI public metrics-aggregate", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  type MetricWidgetSpec = {
    metricName: string;
    groupByAttributeKeys?: Array<string> | undefined;
    groupByAttributes?: Array<JSONObject> | undefined;
    groupBy?: JSONObject | undefined;
  };

  type BuildViewConfigFunction = (
    widgets: Array<MetricWidgetSpec>,
  ) => DashboardViewConfig;

  /*
   * A stored chart widget, shaped the way the canvas persists it: the query
   * lives under `arguments.metricQueryConfigs[].metricQueryData`.
   */
  const buildViewConfig: BuildViewConfigFunction = (
    widgets: Array<MetricWidgetSpec>,
  ): DashboardViewConfig => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: widgets.map(
        (widget: MetricWidgetSpec, index: number): JSONObject => {
          return {
            _type: "DashboardComponent",
            componentId: ObjectID.generate().toString(),
            componentType: DashboardComponentType.Chart,
            topInDashboardUnits: index,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 12,
            heightInDashboardUnits: 6,
            arguments: {
              ...(widget.groupByAttributes
                ? { groupByAttributes: widget.groupByAttributes }
                : {}),
              metricQueryConfigs: [
                {
                  metricQueryData: {
                    filterData: {
                      metricName: widget.metricName,
                    },
                    ...(widget.groupByAttributeKeys
                      ? { groupByAttributeKeys: widget.groupByAttributeKeys }
                      : {}),
                    ...(widget.groupBy ? { groupBy: widget.groupBy } : {}),
                  },
                },
              ],
            },
          };
        },
      ),
    } as unknown as DashboardViewConfig;
  };

  type SetWidgetsFunction = (widgets: Array<MetricWidgetSpec>) => void;

  const setWidgets: SetWidgetsFunction = (
    widgets: Array<MetricWidgetSpec>,
  ): void => {
    dashboard.dashboardViewConfig = buildViewConfig(widgets);
  };

  type BuildAggregateByFunction = (overrides?: JSONObject) => JSONObject;

  const buildAggregateBy: BuildAggregateByFunction = (
    overrides?: JSONObject,
  ): JSONObject => {
    return {
      query: {
        name: CHARTED_METRIC_NAME,
      },
      aggregateColumnName: "value",
      aggregationType: "Avg",
      aggregationTimestampColumnName: "time",
      startTimestamp: "2026-01-01T00:00:00.000Z",
      endTimestamp: "2026-01-02T00:00:00.000Z",
      limit: 100,
      skip: 0,
      ...(overrides || {}),
    };
  };

  type CallRouteFunction = (body?: JSONObject) => Promise<void>;

  const callRoute: CallRouteFunction = async (
    body?: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
      },
      body: body === undefined ? { aggregateBy: buildAggregateBy() } : body,
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", METRICS_AGGREGATE_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  type CallWithAggregateFunction = (overrides?: JSONObject) => Promise<void>;

  const callWithAggregate: CallWithAggregateFunction = async (
    overrides?: JSONObject,
  ): Promise<void> => {
    await callRoute({ aggregateBy: buildAggregateBy(overrides) });
  };

  type GetAggregateArgsFunction = () => JSONObject;

  const getAggregateArgs: GetAggregateArgsFunction = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      MetricService.aggregateBy as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0] as JSONObject;
  };

  type GetThrownErrorFunction = () => unknown;

  const getThrownError: GetThrownErrorFunction = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0];
  };

  type ExpectNothingAggregatedFunction = () => void;

  const expectNothingAggregated: ExpectNothingAggregatedFunction = (): void => {
    expect(MetricService.aggregateBy).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    projectId = ObjectID.generate();

    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = projectId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;
    setWidgets([{ metricName: CHARTED_METRIC_NAME }]);

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);

    jest.spyOn(MetricService, "aggregateBy").mockResolvedValue({ data: [] });

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("metric allowlist", () => {
    it("aggregates a metric the dashboard charts", async () => {
      await callWithAggregate();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    it("refuses a metric the dashboard does not chart", async () => {
      await callWithAggregate({ query: { name: "billing.revenue.total" } });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This metric is not part of this dashboard.",
      );
      expectNothingAggregated();
    });

    it("refuses a non-string metric name used as an operator", async () => {
      await callWithAggregate({
        query: { name: { $ne: "nothing" } as unknown as string },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("requires an aggregateBy body", async () => {
      await callRoute({});

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "aggregateBy is required.",
      );
      expectNothingAggregated();
    });
  });

  describe("group-by attribute allowlist (GHSA-w332-x78m-vf3v, related)", () => {
    it("refuses to group an allowlisted metric by an attribute the widget never renders", async () => {
      /*
       * Grouped results echo each group's key values back to the caller, so
       * an unrestricted groupByAttributeKeys turns a charted metric into a
       * reader for arbitrary attribute values.
       */
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      await callWithAggregate({ groupByAttributeKeys: ["enduser.id"] });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This attribute is not part of this dashboard.",
      );
      expectNothingAggregated();
    });

    it("refuses any group-by attribute at all when the widget groups by none", async () => {
      for (const attributeKey of [
        "user.email",
        "http.url",
        "db.statement",
        "resource.host.name",
      ]) {
        jest.clearAllMocks();
        setWidgets([{ metricName: CHARTED_METRIC_NAME }]);

        await callWithAggregate({ groupByAttributeKeys: [attributeKey] });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("allows the attribute keys the widget is configured to group by", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY, "disk.device"],
        },
      ]);

      await callWithAggregate({
        groupByAttributeKeys: [CHARTED_GROUP_BY_KEY, "disk.device"],
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getAggregateArgs()["groupByAttributeKeys"]).toEqual([
        CHARTED_GROUP_BY_KEY,
        "disk.device",
      ]);
    });

    it("allows keys configured through the table widget's groupByAttributes form", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributes: [{ key: "resource.service.name" }],
        },
      ]);

      await callWithAggregate({
        groupByAttributeKeys: ["resource.service.name"],
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    it("rejects a request that smuggles one forbidden key in beside allowed ones", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      await callWithAggregate({
        groupByAttributeKeys: [CHARTED_GROUP_BY_KEY, "user.email"],
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("rejects a groupByAttributeKeys that is not an array of strings", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      const badValues: Array<unknown> = [
        CHARTED_GROUP_BY_KEY,
        42,
        { 0: CHARTED_GROUP_BY_KEY },
        [42],
        [null],
        [{ key: CHARTED_GROUP_BY_KEY }],
      ];

      for (const badValue of badValues) {
        jest.clearAllMocks();

        await callWithAggregate({
          groupByAttributeKeys: badValue as Array<string>,
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("leaves an ungrouped request untouched", async () => {
      await callWithAggregate();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getAggregateArgs()["groupByAttributeKeys"]).toBeUndefined();
    });

    it("accepts an explicitly empty group-by list", async () => {
      await callWithAggregate({ groupByAttributeKeys: [] });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });
  });

  describe("group-by column allowlist", () => {
    it("refuses to hand back the whole attribute map of a charted metric", async () => {
      /*
       * `groupBy: { attributes: true }` groups on the ENTIRE attribute map
       * and echoes it back in every result row — a project-wide attribute
       * dump for any metric the dashboard happens to chart.
       */
      await callWithAggregate({ groupBy: { attributes: true } });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This grouping is not part of this dashboard.",
      );
      expectNothingAggregated();
    });

    it("refuses a column the widget does not group by", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupBy: { serviceId: true },
        },
      ]);

      await callWithAggregate({ groupBy: { attributes: true } });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("allows the column the widget is configured to group by", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupBy: { serviceId: true },
        },
      ]);

      await callWithAggregate({ groupBy: { serviceId: true } });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getAggregateArgs()["groupBy"]).toEqual({ serviceId: true });
    });

    it("does not treat a disabled group-by column as configured", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupBy: { attributes: false },
        },
      ]);

      await callWithAggregate({ groupBy: { attributes: true } });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("rejects a groupBy that is not an object", async () => {
      const badValues: Array<unknown> = [
        "attributes",
        ["attributes"],
        42,
        true,
      ];

      for (const badValue of badValues) {
        jest.clearAllMocks();

        await callWithAggregate({ groupBy: badValue as JSONObject });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("accepts an explicitly empty groupBy", async () => {
      await callWithAggregate({ groupBy: {} });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    it("does not let one widget's grouping unlock another widget's metric", async () => {
      /*
       * The allowlists are dashboard-wide by design (the config is a single
       * tenant-owned document), but neither may be widened by the client.
       */
      setWidgets([
        { metricName: CHARTED_METRIC_NAME },
        {
          metricName: "system.memory.usage",
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      await callWithAggregate({
        query: { name: "system.disk.io" },
        groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });
  });

  describe("authorization", () => {
    it("rejects a dashboard that is not public before aggregating anything", async () => {
      dashboard.isPublicDashboard = false;

      await callWithAggregate();

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingAggregated();
    });

    it("rejects a dashboard that cannot be found", async () => {
      jest.spyOn(DashboardService, "findOneById").mockResolvedValue(null);

      await callWithAggregate();

      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingAggregated();
    });

    it("rejects a dashboard with no project", async () => {
      delete dashboard.projectId;

      await callWithAggregate();

      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingAggregated();
    });
  });

  describe("project scoping", () => {
    it("pins the aggregation to the dashboard's own project", async () => {
      await callWithAggregate();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
    });

    it("ignores a client-supplied projectId pointing at another tenant", async () => {
      const otherProjectId: ObjectID = ObjectID.generate();

      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          projectId: otherProjectId.toString(),
        },
      });

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["projectId"]).not.toBe(otherProjectId.toString());
    });
  });
});
