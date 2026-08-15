import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import SloHistoryService from "../../../Server/Services/SloHistoryService";
import PasswordHash from "../../../Server/Utils/PasswordHash";
import PublicDashboardSloHistoryPolicy from "../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import HashedString from "../../../Types/HashedString";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
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

const RESOURCE_LIST_ROUTE: string =
  "/dashboard/resource-list/:dashboardId/:resourceType";
const SLO_HISTORY_ROUTE: string =
  "/dashboard/slo-history-aggregate/:dashboardId";

const RANGE_START: Date = new Date("2026-08-09T00:00:00.000Z");
const RANGE_END: Date = new Date("2026-08-09T06:00:00.000Z");

/*
 * An SLO on a public dashboard is a deliberate publication: the owner drops
 * the widget on a shared board and, by doing so, publishes that one SLO's
 * headline numbers and — for a Chart widget — the series behind them.
 *
 * These tests hold the two halves of that bargain. The widget's data really
 * does reach an anonymous viewer, AND nothing else does: not another SLO in
 * the project, not another series of the same SLO, not the SLO's definition,
 * and not another tenant's project.
 */
describe("DashboardAPI public SLO", () => {
  let dashboardId: ObjectID;
  let projectId: ObjectID;
  let serviceLevelObjectiveId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  interface BuiltWidget {
    widget: JSONObject;
    componentId: ObjectID;
  }

  type BuildSloWidgetFunction = (argumentsObject?: JSONObject) => BuiltWidget;

  const buildSloWidget: BuildSloWidgetFunction = (
    argumentsObject?: JSONObject,
  ): BuiltWidget => {
    const componentId: ObjectID = ObjectID.generate();

    return {
      componentId,
      widget: {
        _type: "DashboardComponent",
        componentId: componentId.toString(),
        componentType: DashboardComponentType.Slo,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 3,
        heightInDashboardUnits: 3,
        arguments: {
          serviceLevelObjectiveId: serviceLevelObjectiveId.toString(),
          ...(argumentsObject || {}),
        },
      },
    };
  };

  type BuildChartWidgetFunction = (argumentsObject?: JSONObject) => BuiltWidget;

  const buildSloChartWidget: BuildChartWidgetFunction = (
    argumentsObject?: JSONObject,
  ): BuiltWidget => {
    return buildSloWidget({
      displayType: SloWidgetDisplayType.Chart,
      ...(argumentsObject || {}),
    });
  };

  type SetWidgetsFunction = (widgets: Array<JSONObject>) => void;

  const setWidgets: SetWidgetsFunction = (widgets: Array<JSONObject>): void => {
    dashboard.dashboardViewConfig = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: widgets,
      variables: [],
    } as unknown as DashboardViewConfig;
  };

  type CallResourceListFunction = (body?: JSONObject) => Promise<void>;

  const callResourceList: CallResourceListFunction = async (
    body?: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
        resourceType: "slo",
      },
      body: body || {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", RESOURCE_LIST_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  /*
   * The window a widget really sends, alongside the fields it also sends that
   * the server must throw away.
   */
  type BuildAggregateByFunction = (overrides?: JSONObject) => JSONObject;

  const buildAggregateBy: BuildAggregateByFunction = (
    overrides?: JSONObject,
  ): JSONObject => {
    return {
      query: {
        projectId: projectId,
        sloId: serviceLevelObjectiveId,
        metricName: "sli.percent",
        bucketStart: new InBetween<Date>(RANGE_START, RANGE_END),
      },
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "bucketStart",
      aggregationInterval: AggregationInterval.FiveMinutes,
      startTimestamp: RANGE_START,
      endTimestamp: RANGE_END,
      sort: { bucketStart: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      ...(overrides || {}),
    } as unknown as JSONObject;
  };

  type CallSloHistoryFunction = (body?: JSONObject) => Promise<void>;

  const callSloHistory: CallSloHistoryFunction = async (
    body?: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        dashboardId: dashboardId.toString(),
      },
      body: body || {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", SLO_HISTORY_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  type GetFindByArgsFunction = () => JSONObject;

  const getFindByArgs: GetFindByArgsFunction = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      ServiceLevelObjectiveService.findBy as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![0] as JSONObject;
  };

  type GetAggregateArgsFunction = () => JSONObject;

  const getAggregateArgs: GetAggregateArgsFunction = (): JSONObject => {
    const calls: Array<Array<unknown>> = (
      SloHistoryService.aggregateBy as jest.Mock
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

  type ExpectNothingReadFunction = () => void;

  const expectNothingRead: ExpectNothingReadFunction = (): void => {
    expect(ServiceLevelObjectiveService.findBy).not.toHaveBeenCalled();
    expect(SloHistoryService.aggregateBy).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    projectId = ObjectID.generate();
    serviceLevelObjectiveId = ObjectID.generate();

    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = projectId;
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;
    setWidgets([]);

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
    jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(SloHistoryService, "aggregateBy")
      .mockResolvedValue({ data: [] } as never);

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

  describe("resource-list: the SLO's current numbers", () => {
    it("serves the SLO the widget names, pinned to the dashboard's project", async () => {
      const slo: BuiltWidget = buildSloWidget();
      setWidgets([slo.widget]);

      await callResourceList({ componentId: slo.componentId.toString() });

      expect(nextFunction).not.toHaveBeenCalled();

      const findByArgs: JSONObject = getFindByArgs();
      const query: JSONObject = findByArgs["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect((query["_id"] as ObjectID).toString()).toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect(findByArgs["limit"]).toBe(1);
      expect(findByArgs["skip"]).toBe(0);
      expect(findByArgs["props"]).toEqual({ isRoot: true });
      expect(findByArgs["select"]).toEqual({
        _id: true,
        name: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
      });
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
    });

    it("refuses to read an SLO the dashboard does not show", async () => {
      const foreignSloId: ObjectID = ObjectID.generate();
      const slo: BuiltWidget = buildSloWidget();
      setWidgets([slo.widget]);

      await callResourceList({
        componentId: slo.componentId.toString(),
        query: { _id: foreignSloId.toString() },
        select: { description: true, metricQueryConfig: true, monitors: true },
        sort: { createdAt: SortOrder.Descending },
        limit: LIMIT_PER_PROJECT,
      });

      const findByArgs: JSONObject = getFindByArgs();
      const query: JSONObject = findByArgs["query"] as JSONObject;

      expect((query["_id"] as ObjectID).toString()).toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect((query["_id"] as ObjectID).toString()).not.toBe(
        foreignSloId.toString(),
      );
      expect(
        (findByArgs["select"] as JSONObject)["description"],
      ).toBeUndefined();
      expect(
        (findByArgs["select"] as JSONObject)["metricQueryConfig"],
      ).toBeUndefined();
      expect((findByArgs["select"] as JSONObject)["monitors"]).toBeUndefined();
      expect(findByArgs["limit"]).toBe(1);
    });

    it("refuses the resource entirely when the dashboard has no SLO widget", async () => {
      setWidgets([]);

      await callResourceList({});

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("reads the exact widget when a dashboard shows several SLOs", async () => {
      const otherSloId: ObjectID = ObjectID.generate();
      const first: BuiltWidget = buildSloWidget();
      const second: BuiltWidget = buildSloWidget({
        serviceLevelObjectiveId: otherSloId.toString(),
      });
      setWidgets([first.widget, second.widget]);

      await callResourceList({ componentId: second.componentId.toString() });

      const query: JSONObject = getFindByArgs()["query"] as JSONObject;
      expect((query["_id"] as ObjectID).toString()).toBe(otherSloId.toString());
    });

    it("requires a componentId once more than one SLO widget exists", async () => {
      setWidgets([buildSloWidget().widget, buildSloWidget().widget]);

      await callResourceList({});

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("auto-binds the only SLO widget when no componentId is sent", async () => {
      setWidgets([buildSloWidget().widget]);

      await callResourceList({});

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ServiceLevelObjectiveService.findBy).toHaveBeenCalledTimes(1);
    });

    it("serves a Tile widget as readily as a Chart widget", async () => {
      for (const displayType of Object.values(SloWidgetDisplayType)) {
        jest.clearAllMocks();
        const slo: BuiltWidget = buildSloWidget({ displayType });
        setWidgets([slo.widget]);

        await callResourceList({ componentId: slo.componentId.toString() });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(ServiceLevelObjectiveService.findBy).toHaveBeenCalledTimes(1);
      }
    });

    it("fails closed on a widget whose stored SLO id is missing or malformed", async () => {
      for (const brokenId of [undefined, "", "not-a-uuid"]) {
        jest.clearAllMocks();
        const slo: BuiltWidget = buildSloWidget({
          serviceLevelObjectiveId: brokenId as string,
        });
        setWidgets([slo.widget]);

        await callResourceList({ componentId: slo.componentId.toString() });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });
  });

  describe("slo-history-aggregate: the series behind the numbers", () => {
    it("aggregates only the widget's own SLO and series", async () => {
      const slo: BuiltWidget = buildSloChartWidget({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
      });
      setWidgets([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const aggregateArgs: JSONObject = getAggregateArgs();
      const query: JSONObject = aggregateArgs["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect((query["sloId"] as ObjectID).toString()).toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect(query["metricName"]).toBe("error.budget.remaining.percent");

      const bucketStart: InBetween<Date> = query[
        "bucketStart"
      ] as unknown as InBetween<Date>;
      expect(bucketStart).toBeInstanceOf(InBetween);
      expect(new Date(bucketStart.startValue).toISOString()).toBe(
        RANGE_START.toISOString(),
      );
      expect(new Date(bucketStart.endValue).toISOString()).toBe(
        RANGE_END.toISOString(),
      );

      expect(aggregateArgs["aggregationType"]).toBe(AggregationType.Avg);
      expect(aggregateArgs["aggregateColumnName"]).toBe("value");
      expect(aggregateArgs["aggregationTimestampColumnName"]).toBe(
        "bucketStart",
      );
      expect(aggregateArgs["aggregationInterval"]).toBe(
        AggregationInterval.FiveMinutes,
      );
      expect(aggregateArgs["sort"]).toEqual({
        bucketStart: SortOrder.Ascending,
      });
      expect(aggregateArgs["limit"]).toBe(LIMIT_PER_PROJECT);
      expect(aggregateArgs["skip"]).toBe(0);
      expect(aggregateArgs["props"]).toEqual({ isRoot: true });
    });

    it("ignores a forged project, SLO, series, column and page", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      const foreignProjectId: ObjectID = ObjectID.generate();
      const foreignSloId: ObjectID = ObjectID.generate();

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy({
          query: {
            projectId: foreignProjectId,
            sloId: foreignSloId,
            metricName: "burn.rate",
            bucketStart: new InBetween<Date>(
              new Date("2000-01-01T00:00:00.000Z"),
              new Date("2030-01-01T00:00:00.000Z"),
            ),
          },
          aggregationType: AggregationType.Max,
          aggregateColumnName: "version",
          aggregationTimestampColumnName: "version",
          aggregationInterval: AggregationInterval.Total,
          sort: { version: SortOrder.Descending },
          limit: 1,
          skip: 5000,
        } as unknown as JSONObject),
      });

      const aggregateArgs: JSONObject = getAggregateArgs();
      const query: JSONObject = aggregateArgs["query"] as JSONObject;

      expect(query["projectId"]).toBe(projectId);
      expect(query["projectId"]).not.toBe(foreignProjectId);
      expect((query["sloId"] as ObjectID).toString()).toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect(query["metricName"]).toBe("sli.percent");
      expect(aggregateArgs["aggregationType"]).toBe(AggregationType.Avg);
      expect(aggregateArgs["aggregateColumnName"]).toBe("value");
      expect(aggregateArgs["aggregationTimestampColumnName"]).toBe(
        "bucketStart",
      );
      expect(aggregateArgs["aggregationInterval"]).toBe(
        AggregationInterval.FiveMinutes,
      );
      expect(aggregateArgs["limit"]).toBe(LIMIT_PER_PROJECT);
      expect(aggregateArgs["skip"]).toBe(0);
    });

    it("takes the window from the request", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      const start: Date = new Date("2026-07-10T00:00:00.000Z");
      const end: Date = new Date("2026-07-17T00:00:00.000Z");

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy({
          startTimestamp: start,
          endTimestamp: end,
        } as unknown as JSONObject),
      });

      const aggregateArgs: JSONObject = getAggregateArgs();
      expect(
        new Date(aggregateArgs["startTimestamp"] as string).toISOString(),
      ).toBe(start.toISOString());
      expect(
        new Date(aggregateArgs["endTimestamp"] as string).toISOString(),
      ).toBe(end.toISOString());
      // A week-long window buckets hourly, whatever the caller asked for.
      expect(aggregateArgs["aggregationInterval"]).toBe(
        AggregationInterval.Hour,
      );
    });

    it("accepts an aggregateBy that has been through the wire serializer", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: JSONFunctions.serialize(
          buildAggregateBy() as JSONObject,
        ) as JSONObject,
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;
      const bucketStart: InBetween<Date> = query[
        "bucketStart"
      ] as unknown as InBetween<Date>;

      expect(new Date(bucketStart.startValue).toISOString()).toBe(
        RANGE_START.toISOString(),
      );
      expect(new Date(bucketStart.endValue).toISOString()).toBe(
        RANGE_END.toISOString(),
      );
    });

    it("returns the aggregation result to the viewer", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      jest.spyOn(SloHistoryService, "aggregateBy").mockResolvedValue({
        data: [{ timestamp: RANGE_START, value: 99.95 }],
      } as never);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

      const responseBody: JSONObject = (
        Response.sendJsonObjectResponse as jest.Mock
      ).mock.calls[0]![2] as JSONObject;

      expect((responseBody["data"] as Array<JSONObject>).length).toBe(1);
    });

    it("refuses a Tile widget, which publishes no series", async () => {
      const slo: BuiltWidget = buildSloWidget({
        displayType: SloWidgetDisplayType.Tile,
      });
      setWidgets([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("refuses a componentId that is not an SLO widget on this dashboard", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      for (const componentId of [
        ObjectID.generate().toString(),
        "not-a-uuid",
        42,
        {},
      ]) {
        jest.clearAllMocks();

        await callSloHistory({
          componentId: componentId as string,
          aggregateBy: buildAggregateBy(),
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("reads the exact chart widget when a dashboard charts several SLOs", async () => {
      const otherSloId: ObjectID = ObjectID.generate();
      const first: BuiltWidget = buildSloChartWidget();
      const second: BuiltWidget = buildSloChartWidget({
        serviceLevelObjectiveId: otherSloId.toString(),
        sloMetric: SloWidgetMetric.BurnRate,
      });
      setWidgets([first.widget, second.widget]);

      await callSloHistory({
        componentId: second.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;
      expect((query["sloId"] as ObjectID).toString()).toBe(
        otherSloId.toString(),
      );
      expect((query["sloId"] as ObjectID).toString()).not.toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect(query["metricName"]).toBe("burn.rate");
    });

    it("requires a componentId once more than one SLO widget exists", async () => {
      setWidgets([buildSloChartWidget().widget, buildSloChartWidget().widget]);

      await callSloHistory({ aggregateBy: buildAggregateBy() });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("refuses when the dashboard has no SLO widget at all", async () => {
      setWidgets([]);

      await callSloHistory({ aggregateBy: buildAggregateBy() });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("requires an aggregateBy body", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      for (const body of [
        {},
        { componentId: slo.componentId.toString() },
        { componentId: slo.componentId.toString(), aggregateBy: null },
      ] as Array<JSONObject>) {
        jest.clearAllMocks();

        await callSloHistory(body);

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("rejects an unusable window before touching ClickHouse", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      const brokenWindows: Array<JSONObject> = [
        { startTimestamp: "yesterday" },
        { endTimestamp: null },
        { startTimestamp: RANGE_END, endTimestamp: RANGE_START },
        { startTimestamp: RANGE_START, endTimestamp: RANGE_START },
      ] as unknown as Array<JSONObject>;

      for (const brokenWindow of brokenWindows) {
        jest.clearAllMocks();

        await callSloHistory({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(brokenWindow),
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    /*
     * A window reaching past SloHistory's retention is answered, not refused
     * — the public range picker is unbounded and the metric widgets on the
     * same page render whatever it produces. Only the reach back is cut, so
     * ClickHouse is still never asked to grid out decades.
     */
    it("clamps an over-long window instead of erroring the widget", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      const endDate: Date = new Date("2026-01-01T00:00:00.000Z");
      const startDate: Date = new Date("2020-01-01T00:00:00.000Z");

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy({
          startTimestamp: startDate,
          endTimestamp: endDate,
        } as unknown as JSONObject),
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const aggregateArgs: JSONObject = getAggregateArgs();
      const bucketStart: InBetween<Date> = (
        aggregateArgs["query"] as JSONObject
      )["bucketStart"] as unknown as InBetween<Date>;

      const retentionInMs: number = 400 * 24 * 60 * 60 * 1000;
      expect(new Date(bucketStart.endValue).toISOString()).toBe(
        endDate.toISOString(),
      );
      expect(new Date(bucketStart.startValue).toISOString()).toBe(
        new Date(endDate.getTime() - retentionInMs).toISOString(),
      );
      expect(new Date(bucketStart.startValue).getTime()).toBeGreaterThan(
        startDate.getTime(),
      );
    });
  });

  describe("dashboard authorization", () => {
    it("rejects both routes for a dashboard that is not public", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);
      dashboard.isPublicDashboard = false;

      await callResourceList({ componentId: slo.componentId.toString() });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();

      jest.clearAllMocks();
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();
    });

    it("rejects both routes for a dashboard with no project", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);
      delete dashboard.projectId;

      await callResourceList({ componentId: slo.componentId.toString() });
      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingRead();

      jest.clearAllMocks();
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expectNothingRead();
    });

    /*
     * The two routes must go through DashboardService.hasReadAccess rather
     * than checking `isPublicDashboard` themselves — both already load the
     * dashboard, so open-coding the flag is an easy and silent regression
     * that would drop master-password and IP-allowlist gating entirely.
     */
    it("rejects both routes on a password-protected dashboard with no cookie", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);
      dashboard.enableMasterPassword = true;
      dashboard.masterPasswordSalt = PasswordHash.generateSalt();
      dashboard.masterPassword = new HashedString(
        await PasswordHash.hash({
          plainValue: "correct-horse-battery-staple",
          salt: dashboard.masterPasswordSalt,
        }),
        true,
      );

      await callResourceList({ componentId: slo.componentId.toString() });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();

      jest.clearAllMocks();
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(getThrownError()).toBeInstanceOf(NotAuthenticatedException);
      expectNothingRead();
    });

    it("rejects both routes when the viewer's IP is not on the allowlist", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);
      dashboard.ipWhitelist = "10.0.0.1";

      await callResourceList({ componentId: slo.componentId.toString() });
      expect(getThrownError()).toBeInstanceOf(ForbiddenException);
      expectNothingRead();

      jest.clearAllMocks();
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(getThrownError()).toBeInstanceOf(ForbiddenException);
      expectNothingRead();
    });

    it("checks access before it ever reads the widget", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);
      dashboard.isPublicDashboard = false;

      const buildSpy: jest.SpiedFunction<
        typeof PublicDashboardSloHistoryPolicy.build
      > = jest.spyOn(PublicDashboardSloHistoryPolicy, "build");

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(buildSpy).not.toHaveBeenCalled();
    });
  });
});
