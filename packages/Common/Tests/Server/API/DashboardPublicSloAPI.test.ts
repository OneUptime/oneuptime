import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import SloHistoryService from "../../../Server/Services/SloHistoryService";
import PasswordHash from "../../../Server/Utils/PasswordHash";
import PublicDashboardSloHistoryPolicy from "../../../Server/Utils/Dashboard/PublicDashboardSloHistoryPolicy";
import {
  PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE,
  PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE,
  PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE,
} from "../../../Server/Utils/Dashboard/PublicDashboardSloWidget";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import { SLO_LIST_DEFAULT_MAX_ROWS } from "../../../Utils/Slo/SloListWidgetFormat";
import DashboardResourceList from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/DashboardResourceList";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import Includes from "../../../Types/BaseDatabase/Includes";
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
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import Timezone from "../../../Types/Timezone";
import { INVALID_TIMEZONE_MESSAGE } from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
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

    /*
     * The viewer's zone (issue #7277): a three-month chart reads days, and
     * each starts at the viewer's midnight, so the zone the page sends is
     * passed to the read - checked, and nothing else with it.
     */
    it("reads the history's days in the zone the viewer sends", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: JSONFunctions.serialize(
          buildAggregateBy({
            startTimestamp: new Date("2026-04-01T00:00:00.000Z"),
            endTimestamp: new Date("2026-07-01T00:00:00.000Z"),
            timezone: Timezone.AmericaNew_York,
          } as unknown as JSONObject) as JSONObject,
        ) as JSONObject,
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const aggregateArgs: JSONObject = getAggregateArgs();
      expect(aggregateArgs["timezone"]).toBe(Timezone.AmericaNew_York);
      expect(aggregateArgs["aggregationInterval"]).toBe(
        AggregationInterval.Day,
      );
    });

    it("reads UTC's days, as before, when the viewer sends no zone", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(getAggregateArgs()["timezone"]).toBeUndefined();
    });

    it("refuses a zone that is not a name from the Timezone list, before touching ClickHouse", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setWidgets([slo.widget]);

      for (const notAZone of [
        "america/new_york",
        "UTC'), 'UTC') AS bucketStart FROM system.one --",
        42,
      ]) {
        jest.clearAllMocks();

        await callSloHistory({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy({
            timezone: notAZone,
          } as unknown as JSONObject),
        });

        const thrown: unknown = getThrownError();
        expect(thrown).toBeInstanceOf(BadDataException);
        expect((thrown as BadDataException).message).toBe(
          INVALID_TIMEZONE_MESSAGE,
        );
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

  /*
   * A widget that follows the dashboard's SLO variable instead of pinning an
   * SLO. The author's binding publishes whichever ACTIVE SLO a viewer picks —
   * and nothing else: no read without a single pick, an exact-name match
   * inside the dashboard's own project, and a refusal rather than a guess when
   * a name matches none or two.
   */
  describe("an SLO widget that follows the dashboard's SLO variable", () => {
    const VARIABLE_ID: string = "slo-variable";
    const PICKED_SLO: string = "Checkout API";

    type BuildFollowingWidgetFunction = (
      argumentsObject?: JSONObject,
    ) => BuiltWidget;

    const buildFollowingWidget: BuildFollowingWidgetFunction = (
      argumentsObject?: JSONObject,
    ): BuiltWidget => {
      return buildSloWidget({
        serviceLevelObjectiveId: undefined as unknown as string,
        serviceLevelObjectiveVariableId: VARIABLE_ID,
        ...(argumentsObject || {}),
      });
    };

    type SetWidgetsWithVariableFunction = (widgets: Array<JSONObject>) => void;

    const setWidgetsWithVariable: SetWidgetsWithVariableFunction = (
      widgets: Array<JSONObject>,
    ): void => {
      dashboard.dashboardViewConfig = {
        _type: "DashboardViewConfig",
        heightInDashboardUnits: 24,
        components: widgets,
        variables: [
          {
            id: VARIABLE_ID,
            name: "slo",
            label: "SLO",
            type: "Telemetry Attribute",
            attributeKey: "sloName",
            isMultiSelect: false,
          },
        ],
      } as unknown as DashboardViewConfig;
    };

    const PICK: Array<JSONObject> = [
      { id: VARIABLE_ID, selectedValue: PICKED_SLO, selectedValues: [] },
    ];

    type MatchingSloFunction = (id: ObjectID) => ServiceLevelObjective;

    const matchingSlo: MatchingSloFunction = (
      id: ObjectID,
    ): ServiceLevelObjective => {
      const slo: ServiceLevelObjective = new ServiceLevelObjective();
      slo._id = id.toString();
      return slo;
    };

    it("serves the picked SLO by exact name among active SLOs in the dashboard's project", async () => {
      const slo: BuiltWidget = buildFollowingWidget();
      setWidgetsWithVariable([slo.widget]);

      await callResourceList({
        componentId: slo.componentId.toString(),
        variables: PICK,
        query: { _id: serviceLevelObjectiveId.toString(), isArchived: true },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const findByArgs: JSONObject = getFindByArgs();

      expect(findByArgs["query"]).toEqual({
        name: PICKED_SLO,
        isArchived: false,
        projectId: projectId,
      });
      expect(findByArgs["limit"]).toBe(2);
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
    });

    it("reads nothing until a single SLO is picked", async () => {
      const slo: BuiltWidget = buildFollowingWidget();
      setWidgetsWithVariable([slo.widget]);

      for (const variables of [
        undefined,
        [],
        [{ id: VARIABLE_ID, selectedValue: "", selectedValues: [] }],
        [{ id: "not-this-dashboards", selectedValue: PICKED_SLO }],
      ] as Array<Array<JSONObject> | undefined>) {
        jest.clearAllMocks();

        await callResourceList({
          componentId: slo.componentId.toString(),
          variables: variables,
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingRead();
      }
    });

    it("aggregates the history of the one active SLO carrying the picked name", async () => {
      const matchedId: ObjectID = ObjectID.generate();
      const slo: BuiltWidget = buildFollowingWidget({
        displayType: SloWidgetDisplayType.Chart,
        sloMetric: SloWidgetMetric.BurnRate,
      });
      setWidgetsWithVariable([slo.widget]);

      jest
        .spyOn(ServiceLevelObjectiveService, "findBy")
        .mockResolvedValue([matchingSlo(matchedId)] as never);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
        variables: PICK,
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const findByArgs: JSONObject = getFindByArgs();

      expect(findByArgs["query"]).toEqual({
        projectId: projectId,
        name: PICKED_SLO,
        isArchived: false,
      });
      expect(findByArgs["select"]).toEqual({ _id: true });
      expect(findByArgs["limit"]).toBe(2);
      expect(findByArgs["props"]).toEqual({ isRoot: true });

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect((query["sloId"] as ObjectID).toString()).toBe(
        matchedId.toString(),
      );
      // The request named the pinned test SLO; it plays no part.
      expect((query["sloId"] as ObjectID).toString()).not.toBe(
        serviceLevelObjectiveId.toString(),
      );
      expect(query["projectId"]).toBe(projectId);
      expect(query["metricName"]).toBe("burn.rate");
    });

    it("refuses to aggregate when no active SLO carries the name", async () => {
      const slo: BuiltWidget = buildFollowingWidget({
        displayType: SloWidgetDisplayType.Chart,
      });
      setWidgetsWithVariable([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
        variables: PICK,
      });

      expect(getThrownError()).toBeInstanceOf(NotFoundException);
      expect(SloHistoryService.aggregateBy).not.toHaveBeenCalled();
    });

    it("refuses to aggregate either of two SLOs sharing the name", async () => {
      const slo: BuiltWidget = buildFollowingWidget({
        displayType: SloWidgetDisplayType.Chart,
      });
      setWidgetsWithVariable([slo.widget]);

      jest
        .spyOn(ServiceLevelObjectiveService, "findBy")
        .mockResolvedValue([
          matchingSlo(ObjectID.generate()),
          matchingSlo(ObjectID.generate()),
        ] as never);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
        variables: PICK,
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(SloHistoryService.aggregateBy).not.toHaveBeenCalled();
    });

    it("refuses history without a pick, before any read", async () => {
      const slo: BuiltWidget = buildFollowingWidget({
        displayType: SloWidgetDisplayType.Chart,
      });
      setWidgetsWithVariable([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("never looks a pinned chart up by name, whatever the selection says", async () => {
      const slo: BuiltWidget = buildSloChartWidget({
        serviceLevelObjectiveVariableId: VARIABLE_ID,
      });
      setWidgetsWithVariable([slo.widget]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
        variables: PICK,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(ServiceLevelObjectiveService.findBy).not.toHaveBeenCalled();
      expect(
        (
          (getAggregateArgs()["query"] as JSONObject)["sloId"] as ObjectID
        ).toString(),
      ).toBe(serviceLevelObjectiveId.toString());
    });
  });

  /*
   * The SLO List widget publishes every ACTIVE SLO's headline numbers through
   * its own resource type — never through the single-SLO routes.
   */
  describe("resource-list: the SLO List widget", () => {
    type BuildSloListWidgetFunction = (
      argumentsObject?: JSONObject,
    ) => BuiltWidget;

    const buildSloListWidget: BuildSloListWidgetFunction = (
      argumentsObject?: JSONObject,
    ): BuiltWidget => {
      const componentId: ObjectID = ObjectID.generate();

      return {
        componentId,
        widget: {
          _type: "DashboardComponent",
          componentId: componentId.toString(),
          componentType: DashboardComponentType.SloList,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: 12,
          heightInDashboardUnits: 5,
          arguments: {
            title: "Service Level Objectives",
            maxRows: 50,
            ...(argumentsObject || {}),
          },
        },
      };
    };

    type CallResourceListAsFunction = (
      resourceType: string,
      body?: JSONObject,
    ) => Promise<void>;

    const callResourceListAs: CallResourceListAsFunction = async (
      resourceType: string,
      body?: JSONObject,
    ): Promise<void> => {
      const request: ExpressRequest = {
        params: {
          dashboardId: dashboardId.toString(),
          resourceType: resourceType,
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

    it("lists active SLOs in the dashboard's project, least budget first, capped by the widget", async () => {
      const list: BuiltWidget = buildSloListWidget();
      setWidgets([list.widget]);

      await callResourceListAs("slo-list", {
        componentId: list.componentId.toString(),
        query: { isArchived: true, projectId: ObjectID.generate().toString() },
        limit: LIMIT_PER_PROJECT,
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const findByArgs: JSONObject = getFindByArgs();

      expect(findByArgs["query"]).toEqual({
        isArchived: false,
        projectId: projectId,
      });
      expect(findByArgs["sort"]).toEqual({
        isEnabled: SortOrder.Descending,
        errorBudgetRemainingPercentage: SortOrder.Ascending,
        name: SortOrder.Ascending,
      });
      expect(findByArgs["limit"]).toBe(50);
      expect(findByArgs["props"]).toEqual({ isRoot: true });
      /*
       * The seven display fields plus isEnabled, so a disabled SLO reads
       * Disabled on the public page instead of its frozen status.
       */
      expect(findByArgs["select"]).toEqual({
        _id: true,
        name: true,
        targetPercentage: true,
        currentSliPercentage: true,
        errorBudgetRemainingPercentage: true,
        errorBudgetRemainingSeconds: true,
        currentBurnRate: true,
        sloStatus: true,
        isEnabled: true,
      });
    });

    it("pins a stored status filter to enabled SLOs, as the browser list does", async () => {
      const list: BuiltWidget = buildSloListWidget({
        sloStatuses: [SloStatus.BudgetExhausted],
      });
      setWidgets([list.widget]);

      await callResourceListAs("slo-list", {
        componentId: list.componentId.toString(),
        query: { isEnabled: false },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getFindByArgs()["query"] as JSONObject;

      expect(query["isArchived"]).toBe(false);
      expect(query["isEnabled"]).toBe(true);
      expect(query["projectId"]).toEqual(projectId);
    });

    it("is not served through the single-SLO resource, nor an SLO widget through slo-list", async () => {
      const list: BuiltWidget = buildSloListWidget();
      const slo: BuiltWidget = buildSloWidget();
      setWidgets([list.widget, slo.widget]);

      await callResourceListAs("slo", {
        componentId: list.componentId.toString(),
      });
      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();

      jest.clearAllMocks();

      await callResourceListAs("slo-list", {
        componentId: slo.componentId.toString(),
      });
      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("never counts as an SLO widget on the history route", async () => {
      const list: BuiltWidget = buildSloListWidget();
      setWidgets([list.widget]);

      await callSloHistory({
        componentId: list.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingRead();
    });

    it("still auto-binds the only SLO chart when a dashboard also shows an SLO List", async () => {
      const list: BuiltWidget = buildSloListWidget();
      const chart: BuiltWidget = buildSloChartWidget();
      setWidgets([list.widget, chart.widget]);

      await callSloHistory({ aggregateBy: buildAggregateBy() });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(SloHistoryService.aggregateBy).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * Issue #6297: an SLO widget stored with its arguments as JSON text is
   * drawn by the public page, and was refused here as "Dashboard widget
   * arguments must be an object." Its numbers and its series are now read
   * as those of the same widget stored with its arguments as an object.
   */
  describe("an SLO widget with its arguments as JSON text (issue #6297)", () => {
    type WithTextArgumentsFunction = (widget: JSONObject) => JSONObject;

    const withTextArguments: WithTextArgumentsFunction = (
      widget: JSONObject,
    ): JSONObject => {
      return { ...widget, arguments: JSON.stringify(widget["arguments"]) };
    };

    it("lists its SLO as the same widget stored as an object does", async () => {
      const slo: BuiltWidget = buildSloWidget();

      setWidgets([slo.widget]);
      await callResourceList({ componentId: slo.componentId.toString() });
      expect(nextFunction).not.toHaveBeenCalled();
      const asObject: JSONObject = getFindByArgs();

      jest.clearAllMocks();

      setWidgets([withTextArguments(slo.widget)]);
      await callResourceList({ componentId: slo.componentId.toString() });
      expect(nextFunction).not.toHaveBeenCalled();
      const asText: JSONObject = getFindByArgs();

      expect(asText).toEqual(asObject);
      expect(JSON.stringify(asText["query"])).toContain(
        serviceLevelObjectiveId.toString(),
      );
    });

    it("aggregates its SLO's series as the same widget stored as an object does", async () => {
      const slo: BuiltWidget = buildSloChartWidget({
        sloMetric: SloWidgetMetric.ErrorBudgetRemaining,
      });

      setWidgets([slo.widget]);
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(nextFunction).not.toHaveBeenCalled();
      const asObject: JSONObject = getAggregateArgs();

      jest.clearAllMocks();

      setWidgets([withTextArguments(slo.widget)]);
      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });
      expect(nextFunction).not.toHaveBeenCalled();
      const asText: JSONObject = getAggregateArgs();

      expect(asText).toEqual(asObject);
      expect((asText["query"] as JSONObject)["metricName"]).toBe(
        "error.budget.remaining.percent",
      );
    });

    it("reads one whose arguments are text that says no object as the page draws it: with no SLO selected (issue #6315)", async () => {
      const slo: BuiltWidget = buildSloChartWidget();

      setWidgets([
        {
          ...slo.widget,
          arguments: JSON.stringify(JSON.stringify(slo.widget["arguments"])),
        },
      ]);

      await callSloHistory({
        componentId: slo.componentId.toString(),
        aggregateBy: buildAggregateBy(),
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect((getThrownError() as Error).message).toBe(
        PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE,
      );
      expectNothingRead();
    });
  });

  /*
   * Issue #6315. Both routes read the dashboard as the public page draws it
   * (PublicDashboardViewConfig.getDrawnConfig): the widget, its settings and
   * the variables. Read as stored, a variable list written as JSON text, a
   * variable without an id or sharing one, `isMultiSelect` written as
   * "true" or a default written as a number refused every SLO widget on the
   * dashboard - a pinned one too, which reads no variable at all - and an
   * SLO widget saved without settings was refused as "Dashboard widget
   * arguments must be an object.". The page's own request is sent: every
   * variable's pick under the id the page draws it under.
   */
  describe("a dashboard stored in another shape (issue #6315)", () => {
    const SLO_VARIABLE: JSONObject = {
      id: "slo-variable",
      name: "slo",
      label: "SLO",
      type: "Telemetry Attribute",
      attributeKey: "sloName",
      isMultiSelect: false,
    };

    const setConfig: (widgets: Array<unknown>, variables: unknown) => void = (
      widgets: Array<unknown>,
      variables: unknown,
    ): void => {
      dashboard.dashboardViewConfig = {
        _type: "DashboardViewConfig",
        heightInDashboardUnits: 24,
        components: widgets,
        variables,
      } as unknown as DashboardViewConfig;
    };

    // What the public page draws: what /view-config serves, sent as JSON, read as the page reads it.
    const pageDraws: () => DashboardViewConfig = (): DashboardViewConfig => {
      return StoredDashboardViewConfig.read(
        JSON.parse(
          JSON.stringify(
            JSONFunctions.serialize(
              PublicDashboardViewConfig.sanitize(
                dashboard.dashboardViewConfig,
              ) as unknown as JSONObject,
            ),
          ),
        ),
      );
    };

    // The page's picks, by variable: sent as DashboardResourceList sends them, under the ids it draws them under.
    const pageVariables: (picks: Array<JSONObject | null>) => JSONArray = (
      picks: Array<JSONObject | null>,
    ): JSONArray => {
      return DashboardResourceList.getVariableSelections(
        (pageDraws().variables || []).map(
          (variable: DashboardVariable, index: number): DashboardVariable => {
            const pick: JSONObject | null = picks[index] || null;
            return pick
              ? ({ ...variable, ...pick } as unknown as DashboardVariable)
              : variable;
          },
        ),
      );
    };

    const withoutId: (variable: JSONObject) => JSONObject = (
      variable: JSONObject,
    ): JSONObject => {
      const copy: JSONObject = { ...variable };
      delete copy["id"];
      return copy;
    };

    // Variables in shapes that once refused every SLO widget on the dashboard.
    const OTHER_SHAPES: Array<[string, unknown]> = [
      ["written as JSON text", JSON.stringify([SLO_VARIABLE])],
      ["without an id", [withoutId(SLO_VARIABLE)]],
      ["two sharing one id", [SLO_VARIABLE, SLO_VARIABLE]],
      [
        'isMultiSelect written as "true"',
        [{ ...SLO_VARIABLE, isMultiSelect: "true" }],
      ],
      [
        "a default written as a number",
        [{ ...SLO_VARIABLE, defaultValue: 42 }],
      ],
      ["an id written as a number", [{ ...SLO_VARIABLE, id: 7 }]],
      ["an entry that is no variable", [null, "slo-variable", SLO_VARIABLE]],
      [
        "a project label variable with no choices",
        [
          {
            id: "unit",
            name: "UNIT",
            type: DashboardVariableType.ProjectLabel,
            labelOptions: "x",
          },
        ],
      ],
    ];

    const matching: (id: ObjectID) => ServiceLevelObjective = (
      id: ObjectID,
    ): ServiceLevelObjective => {
      const slo: ServiceLevelObjective = new ServiceLevelObjective();
      slo._id = id.toString();
      return slo;
    };

    it.each(OTHER_SHAPES)(
      "serves a pinned SLO on both routes when the dashboard's variables are %s",
      async (_shape: string, variables: unknown) => {
        const slo: BuiltWidget = buildSloChartWidget();
        setConfig([slo.widget], variables);

        await callResourceList({
          componentId: slo.componentId.toString(),
          variables: pageVariables([]),
        });
        expect(nextFunction).not.toHaveBeenCalled();
        expect(
          (
            (getFindByArgs()["query"] as JSONObject)["_id"] as ObjectID
          ).toString(),
        ).toBe(serviceLevelObjectiveId.toString());

        jest.clearAllMocks();

        await callSloHistory({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(),
          variables: pageVariables([]),
        });
        expect(nextFunction).not.toHaveBeenCalled();
        expect(
          (
            (getAggregateArgs()["query"] as JSONObject)["sloId"] as ObjectID
          ).toString(),
        ).toBe(serviceLevelObjectiveId.toString());
      },
    );

    /*
     * A widget that follows a variable names it by id, so these are the
     * shapes its binding can still name it in. On both routes, the viewer's
     * pick names the SLO - or, with no pick, the variable's default does.
     */
    const FOLLOWED_SHAPES: Array<
      [string, unknown, string, Array<JSONObject | null>, string]
    > = [
      [
        "written as JSON text",
        JSON.stringify([SLO_VARIABLE]),
        "slo-variable",
        [{ selectedValue: "Checkout API" }],
        "Checkout API",
      ],
      [
        "its id written as a number",
        [{ ...SLO_VARIABLE, id: 7 }],
        "7",
        [{ selectedValue: "Checkout API" }],
        "Checkout API",
      ],
      [
        "its id with spaces around it",
        [{ ...SLO_VARIABLE, id: "  slo-variable  " }],
        "slo-variable",
        [{ selectedValue: "Checkout API" }],
        "Checkout API",
      ],
      [
        'isMultiSelect written as "true", one SLO picked',
        [{ ...SLO_VARIABLE, isMultiSelect: "true" }],
        "slo-variable",
        [{ selectedValues: ["Checkout API"] }],
        "Checkout API",
      ],
      [
        "a default written as a number, nothing picked",
        [{ ...SLO_VARIABLE, defaultValue: 42 }],
        "slo-variable",
        [null],
        "42",
      ],
      [
        "first of two sharing its id",
        [SLO_VARIABLE, { ...SLO_VARIABLE, attributeKey: "other" }],
        "slo-variable",
        [{ selectedValue: "Checkout API" }, { selectedValue: "Payments" }],
        "Checkout API",
      ],
      [
        "after an entry that is no variable",
        [null, SLO_VARIABLE],
        "slo-variable",
        [{ selectedValue: "Checkout API" }],
        "Checkout API",
      ],
      // A key filters lists; the widget follows the pick by name, with or without one - as on the page.
      [
        "a Telemetry Attribute variable stored without a key",
        [{ ...SLO_VARIABLE, attributeKey: undefined }],
        "slo-variable",
        [{ selectedValue: "Checkout API" }],
        "Checkout API",
      ],
    ];

    it.each(FOLLOWED_SHAPES)(
      "follows the picked SLO on both routes when its variable is %s",
      async (
        _shape: string,
        variables: unknown,
        variableId: string,
        picks: Array<JSONObject | null>,
        sloName: string,
      ) => {
        const matchedId: ObjectID = ObjectID.generate();
        const slo: BuiltWidget = buildSloChartWidget({
          serviceLevelObjectiveId: undefined as unknown as string,
          serviceLevelObjectiveVariableId: variableId,
        });
        setConfig([slo.widget], variables);

        await callResourceList({
          componentId: slo.componentId.toString(),
          variables: pageVariables(picks),
        });
        expect(nextFunction).not.toHaveBeenCalled();
        expect(getFindByArgs()["query"]).toEqual({
          name: sloName,
          isArchived: false,
          projectId,
        });

        jest.clearAllMocks();
        jest
          .spyOn(ServiceLevelObjectiveService, "findBy")
          .mockResolvedValue([matching(matchedId)] as never);

        await callSloHistory({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(),
          variables: pageVariables(picks),
        });
        expect(nextFunction).not.toHaveBeenCalled();
        expect((getFindByArgs()["query"] as JSONObject)["name"]).toBe(sloName);
        expect(
          (
            (getAggregateArgs()["query"] as JSONObject)["sloId"] as ObjectID
          ).toString(),
        ).toBe(matchedId.toString());
      },
    );

    it("never follows a pick sent under the id the page draws a later variable sharing the binding's id under", async () => {
      const slo: BuiltWidget = buildSloChartWidget({
        serviceLevelObjectiveId: undefined as unknown as string,
        serviceLevelObjectiveVariableId: "slo-variable",
      });
      setConfig([slo.widget], [SLO_VARIABLE, SLO_VARIABLE]);

      const secondId: string = pageDraws().variables![1]!.id;
      expect(secondId).not.toBe("slo-variable");

      for (const call of [callResourceList, callSloHistory]) {
        jest.clearAllMocks();
        await call({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(),
          variables: [
            { id: secondId, selectedValue: "Payments", selectedValues: [] },
          ],
        });

        // The variable it follows has no pick: there is no one SLO to show.
        expect((getThrownError() as Error).message).toBe(
          PUBLIC_SLO_WIDGET_NO_SELECTION_MESSAGE,
        );
        expectNothingRead();
      }
    });

    it("refuses to follow a variable of another type that holds the id first, as the page does", async () => {
      const slo: BuiltWidget = buildSloChartWidget({
        serviceLevelObjectiveId: undefined as unknown as string,
        serviceLevelObjectiveVariableId: "slo-variable",
      });
      setConfig(
        [slo.widget],
        [
          {
            ...SLO_VARIABLE,
            type: DashboardVariableType.ProjectLabel,
            labelOptions: [],
          },
          SLO_VARIABLE,
        ],
      );

      for (const call of [callResourceList, callSloHistory]) {
        jest.clearAllMocks();
        await call({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(),
          variables: pageVariables([null, { selectedValue: "Checkout API" }]),
        });

        expect((getThrownError() as Error).message).toBe(
          PUBLIC_SLO_WIDGET_VARIABLE_MISSING_MESSAGE,
        );
        expectNothingRead();
      }
    });

    it("refuses an over-long or over-many pick under a derived id before anything is read", async () => {
      const slo: BuiltWidget = buildSloChartWidget();
      setConfig([slo.widget], [withoutId(SLO_VARIABLE)]);
      const pageId: string = pageDraws().variables![0]!.id;

      for (const variables of [
        [{ id: pageId, selectedValue: "x".repeat(1025) }],
        [{ id: pageId, selectedValues: Array(101).fill("SLO") }],
        [
          { id: pageId, selectedValue: "a" },
          { id: pageId, selectedValue: "b" },
        ],
        Array.from({ length: 51 }, (_: unknown, index: number) => {
          return {
            id: index === 0 ? pageId : `v-${index}`,
            selectedValue: "v",
          };
        }),
      ]) {
        for (const call of [callResourceList, callSloHistory]) {
          jest.clearAllMocks();
          await call({
            componentId: slo.componentId.toString(),
            aggregateBy: buildAggregateBy(),
            variables,
          });

          expect(getThrownError()).toBeInstanceOf(BadDataException);
          expectNothingRead();
        }
      }
    });

    const NO_SETTINGS: Array<[string, (widget: JSONObject) => JSONObject]> = [
      [
        "saved without arguments",
        (widget: JSONObject): JSONObject => {
          const copy: JSONObject = { ...widget };
          delete copy["arguments"];
          return copy;
        },
      ],
      [
        "with arguments null",
        (widget: JSONObject): JSONObject => {
          return { ...widget, arguments: null };
        },
      ],
      [
        "with arguments encoded twice",
        (widget: JSONObject): JSONObject => {
          return {
            ...widget,
            arguments: JSON.stringify(JSON.stringify(widget["arguments"])),
          };
        },
      ],
      [
        "with arguments cut short",
        (widget: JSONObject): JSONObject => {
          return {
            ...widget,
            arguments: JSON.stringify(widget["arguments"]).slice(0, 10),
          };
        },
      ],
    ];

    it.each(NO_SETTINGS)(
      "reads an SLO widget %s as one with no SLO selected, as it is drawn, on both routes",
      async (_shape: string, storeAs: (widget: JSONObject) => JSONObject) => {
        const slo: BuiltWidget = buildSloChartWidget();
        setConfig([storeAs(slo.widget)], []);

        expect(pageDraws().components[0]?.arguments).toEqual({});

        for (const call of [callResourceList, callSloHistory]) {
          jest.clearAllMocks();
          await call({
            componentId: slo.componentId.toString(),
            aggregateBy: buildAggregateBy(),
          });

          expect((getThrownError() as Error).message).toBe(
            PUBLIC_SLO_WIDGET_NOT_CONFIGURED_MESSAGE,
          );
          expectNothingRead();
        }
      },
    );

    it.each(NO_SETTINGS)(
      "lists an SLO List widget %s with the list's defaults",
      async (_shape: string, storeAs: (widget: JSONObject) => JSONObject) => {
        const componentId: ObjectID = ObjectID.generate();
        const list: JSONObject = {
          _type: "DashboardComponent",
          componentId: componentId.toString(),
          componentType: DashboardComponentType.SloList,
          arguments: { maxRows: 9 },
        };
        setConfig([storeAs(list)], []);

        await mockRouter.match("post", RESOURCE_LIST_ROUTE).handlerFunction(
          {
            params: {
              dashboardId: dashboardId.toString(),
              resourceType: "slo-list",
            },
            body: { componentId: componentId.toString() },
            query: {},
            cookies: {},
            headers: {},
            socket: {},
            ips: [],
          } as unknown as ExpressRequest,
          mockResponse,
          nextFunction,
        );

        expect(nextFunction).not.toHaveBeenCalled();
        const findByArgs: JSONObject = getFindByArgs();
        expect(findByArgs["query"]).toEqual({ isArchived: false, projectId });
        expect(findByArgs["limit"]).toBe(SLO_LIST_DEFAULT_MAX_ROWS);
      },
    );

    /*
     * Issue #6328: an SLO widget whose SLO is stored as an ObjectID - in
     * object arguments, in arguments written as JSON text, and in a widget
     * the page draws from its stored JSON because something else in it
     * cannot be revived - draws that SLO, signed in and on the public page
     * alike: every board reads the id as the id it names. Both routes now
     * serve its numbers and its history exactly as for the id stored as
     * text. Before, the page fell into the widget's error boundary, and
     * both routes refused it.
     */
    it("serves an SLO widget whose SLO is stored as an ObjectID, in every encoding, exactly as the id stored as text", async () => {
      const servedFor: (
        settings: JSONObject,
        encode: (settings: JSONObject) => unknown,
      ) => Promise<Array<unknown>> = async (
        settings: JSONObject,
        encode: (settings: JSONObject) => unknown,
      ): Promise<Array<unknown>> => {
        const slo: BuiltWidget = buildSloChartWidget();
        setConfig(
          [
            {
              ...slo.widget,
              arguments: encode({
                ...settings,
                displayType: SloWidgetDisplayType.Chart,
              }) as JSONObject,
            },
          ],
          [],
        );

        // The page holds the id as text, in every encoding.
        expect(
          (pageDraws().components[0]?.arguments as JSONObject | undefined)?.[
            "serviceLevelObjectiveId"
          ],
        ).toBe(serviceLevelObjectiveId.toString());

        const answers: Array<unknown> = [];

        for (const call of [callResourceList, callSloHistory]) {
          jest.clearAllMocks();
          await call({
            componentId: slo.componentId.toString(),
            aggregateBy: buildAggregateBy(),
          });

          expect((nextFunction as jest.Mock).mock.calls).toEqual([]);
          answers.push(
            call === callResourceList
              ? getFindByArgs()["query"]
              : (getAggregateArgs()["query"] as JSONObject)["sloId"],
          );
        }

        return answers;
      };

      const asText: Array<unknown> = await servedFor(
        { serviceLevelObjectiveId: serviceLevelObjectiveId.toString() },
        (settings: JSONObject): unknown => {
          return settings;
        },
      );

      // Not vacuous: both routes read the widget's own SLO.
      expect(asText).toEqual([
        { _id: serviceLevelObjectiveId, projectId: projectId },
        serviceLevelObjectiveId,
      ]);

      for (const [name, encode] of [
        [
          "object arguments",
          (settings: JSONObject): unknown => {
            return settings;
          },
        ],
        [
          "JSON-text arguments",
          (settings: JSONObject): unknown => {
            return JSON.stringify(settings);
          },
        ],
        [
          "a widget the page draws from its stored JSON",
          (settings: JSONObject): unknown => {
            // Includes.fromJSON cannot iterate a number.
            return { ...settings, unrelated: { _type: "Includes", value: 5 } };
          },
        ],
      ] as Array<[string, (settings: JSONObject) => unknown]>) {
        expect([
          name,
          await servedFor(
            { serviceLevelObjectiveId: serviceLevelObjectiveId.toJSON() },
            encode,
          ),
        ]).toEqual([name, asText]);
      }
    });

    it("lists an SLO List widget whose labels are stored as ObjectIDs as with the label ids stored as text", async () => {
      const labelId: ObjectID = ObjectID.generate();
      const listedFor: (
        labelIds: Array<JSONValue>,
      ) => Promise<JSONObject> = async (
        labelIds: Array<JSONValue>,
      ): Promise<JSONObject> => {
        const componentId: ObjectID = ObjectID.generate();
        setConfig(
          [
            {
              componentId: componentId.toString(),
              componentType: DashboardComponentType.SloList,
              arguments: JSON.stringify({ labelIds }),
            },
          ],
          [],
        );
        jest.clearAllMocks();

        await mockRouter.match("post", RESOURCE_LIST_ROUTE).handlerFunction(
          {
            params: {
              dashboardId: dashboardId.toString(),
              resourceType: "slo-list",
            },
            body: { componentId: componentId.toString() },
            query: {},
            cookies: {},
            headers: {},
            socket: {},
            ips: [],
          } as unknown as ExpressRequest,
          mockResponse,
          nextFunction,
        );

        expect(nextFunction).not.toHaveBeenCalled();
        return getFindByArgs()["query"] as JSONObject;
      };

      const asText: JSONObject = await listedFor([labelId.toString()]);
      expect(asText["labels"]).toEqual(new Includes([labelId.toString()]));
      expect(await listedFor([labelId.toJSON()])).toEqual(asText);
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

  /*
   * Issue #6327: an SLO widget stored inside more layers of envelope or
   * JSON text than any board reads through is drawn as "This widget could
   * not be shown", signed in and on the public page alike. Both routes
   * answer it while every board reads it as an SLO widget, and refuse it
   * past that - before, they answered one in six to ten layers that the
   * owner's own board could not show.
   */
  describe("an SLO widget stored deeper than any board reads (issue #6327)", () => {
    const envelopes: (widget: JSONObject, layers: number) => unknown = (
      widget: JSONObject,
      layers: number,
    ): unknown => {
      let entry: unknown = widget;

      for (let layer: number = 0; layer < layers; layer++) {
        entry =
          layer % 2 === 1
            ? JSON.stringify({ _type: "DashboardComponent", value: entry })
            : { _type: "DashboardComponent", value: entry };
      }

      return entry;
    };

    it("serves its numbers and its history while every board reads it, and refuses both past that", async () => {
      for (let layers: number = 0; layers <= 12; layers++) {
        const slo: BuiltWidget = buildSloChartWidget();

        setWidgets([envelopes(slo.widget, layers) as JSONObject]);

        /*
         * Each layer is an envelope, and every second one is also written
         * as JSON text. A board reads text in the step that opens the
         * envelope holding it; only the outermost text - the stored entry
         * itself - takes a step of its own.
         */
        const isTextOutermost: boolean = layers >= 2 && layers % 2 === 0;
        const isRead: boolean = layers + (isTextOutermost ? 1 : 0) <= 5;

        jest.clearAllMocks();

        await callResourceList({ componentId: slo.componentId.toString() });

        if (isRead) {
          expect([layers, (nextFunction as jest.Mock).mock.calls]).toEqual([
            layers,
            [],
          ]);
          expect(getFindByArgs()["limit"]).toBe(1);
        } else {
          expect([layers, getThrownError()]).toEqual([
            layers,
            new BadDataException(
              "This resource is not part of this dashboard.",
            ),
          ]);
          expectNothingRead();
        }

        jest.clearAllMocks();

        await callSloHistory({
          componentId: slo.componentId.toString(),
          aggregateBy: buildAggregateBy(),
        });

        if (isRead) {
          expect([layers, (nextFunction as jest.Mock).mock.calls]).toEqual([
            layers,
            [],
          ]);
          expect(
            (
              (getAggregateArgs()["query"] as JSONObject)["sloId"] as ObjectID
            ).toString(),
          ).toBe(serviceLevelObjectiveId.toString());
        } else {
          expect([
            layers,
            getThrownError() instanceof BadDataException,
          ]).toEqual([layers, true]);
          expectNothingRead();
        }
      }
    });
  });
});
