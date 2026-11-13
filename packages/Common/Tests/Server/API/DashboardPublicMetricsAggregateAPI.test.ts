import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import MetricService from "../../../Server/Services/MetricService";
import MetricTypeService from "../../../Server/Services/MetricTypeService";
import { PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE } from "../../../Server/Utils/Dashboard/PublicDashboardMetricServices";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardComponentType, {
  DataSourceComponentTypes,
} from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { INVALID_TIMEZONE_MESSAGE } from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
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

/*
 * Telemetry service ids (issue #6280), with letters in them so a change of
 * case is a change of id.
 */
const API_SERVICE_ID: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CHECKOUT_SERVICE_ID: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UNSAVED_SERVICE_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

// A query's services as the client sends them (MetricQueryServices.getServiceQuery).
type ServicesFilterFunction = (serviceIds: Array<string>) => JSONObject;

const servicesFilter: ServicesFilterFunction = (
  serviceIds: Array<string>,
): JSONObject => {
  return new Includes(serviceIds).toJSON();
};

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
    /*
     * `metricQueryData.filterData.attributes` — the attribute filter a chart
     * widget persists when the author pins a value in the query editor.
     */
    attributes?: JSONObject | undefined;
    /*
     * `arguments.attributeFilters` — the table widget's widget-level filter,
     * spread into every column's query by resolveQueries().
     */
    attributeFilters?: JSONObject | undefined;
    /*
     * `metricQueryData.filterData.telemetryServiceIds` — the services a chart
     * is read for, saved by Add to dashboard from a view of a Metrics monitor
     * limited to some services (issue #6266).
     */
    telemetryServiceIds?: unknown;
  };

  type BuildViewConfigFunction = (
    widgets: Array<MetricWidgetSpec>,
    variableAttributeKeys?: Array<string> | undefined,
  ) => DashboardViewConfig;

  /*
   * A stored chart widget, shaped the way the canvas persists it: the query
   * lives under `arguments.metricQueryConfigs[].metricQueryData`. A widget
   * with the table's own settings - its group-by attributes, its
   * widget-level attribute filters - is a table: a public dashboard serves
   * a widget only the settings its type has (issue #6338), and a chart has
   * neither, so no chart draws with them.
   */
  const buildViewConfig: BuildViewConfigFunction = (
    widgets: Array<MetricWidgetSpec>,
    variableAttributeKeys?: Array<string> | undefined,
  ): DashboardViewConfig => {
    return {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      variables: (variableAttributeKeys || []).map(
        (attributeKey: string, index: number): JSONObject => {
          return {
            id: ObjectID.generate().toString(),
            name: `variable-${index}`,
            label: `Variable ${index}`,
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: attributeKey,
          };
        },
      ),
      components: widgets.map(
        (widget: MetricWidgetSpec, index: number): JSONObject => {
          return {
            _type: "DashboardComponent",
            componentId: ObjectID.generate().toString(),
            componentType:
              widget.groupByAttributes || widget.attributeFilters
                ? DashboardComponentType.Table
                : DashboardComponentType.Chart,
            topInDashboardUnits: index,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 12,
            heightInDashboardUnits: 6,
            arguments: {
              ...(widget.groupByAttributes
                ? { groupByAttributes: widget.groupByAttributes }
                : {}),
              ...(widget.attributeFilters
                ? { attributeFilters: widget.attributeFilters }
                : {}),
              metricQueryConfigs: [
                {
                  metricQueryData: {
                    filterData: {
                      metricName: widget.metricName,
                      ...(widget.attributes
                        ? { attributes: widget.attributes }
                        : {}),
                      ...(widget.telemetryServiceIds !== undefined
                        ? {
                            telemetryServiceIds:
                              widget.telemetryServiceIds as JSONValue,
                          }
                        : {}),
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

  type SetWidgetsFunction = (
    widgets: Array<MetricWidgetSpec>,
    variableAttributeKeys?: Array<string> | undefined,
  ) => void;

  const setWidgets: SetWidgetsFunction = (
    widgets: Array<MetricWidgetSpec>,
    variableAttributeKeys?: Array<string> | undefined,
  ): void => {
    dashboard.dashboardViewConfig = buildViewConfig(
      widgets,
      variableAttributeKeys,
    );
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

  describe("query filter allowlist", () => {
    /*
     * Pinning `query.name` left the rest of the client's query merged in.
     * An `attributes` filter on an arbitrary key is a blind oracle: the
     * caller cannot see the values, but "did this aggregation return rows"
     * leaks them a character at a time through operators like StartsWith.
     * MetricService deliberately leaves the pre-aggregated fast path when an
     * attributes filter is present, so the probe runs against raw rows.
     */
    it("refuses an attributes filter on a key the dashboard never filters by", async () => {
      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          attributes: {
            "enduser.id": { _type: "StartsWith", value: "a" },
          },
        },
      });

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This attribute is not part of this dashboard.",
      );
      expectNothingAggregated();
    });

    it("refuses every operator shape usable as a blind oracle", async () => {
      const operatorTypes: Array<string> = [
        "Search",
        "StartsWith",
        "EndsWith",
        "NotContains",
        "EqualTo",
        "NotEqual",
        "Includes",
      ];

      for (const operatorType of operatorTypes) {
        jest.clearAllMocks();

        await callWithAggregate({
          query: {
            name: CHARTED_METRIC_NAME,
            attributes: {
              "user.email": { _type: operatorType, value: "a" },
            },
          },
        });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("forwards an attributes filter on a key the widget itself filters by", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          attributes: { "host.name": "web-1" },
        },
      ]);

      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          attributes: { "host.name": "web-2" },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect((query["attributes"] as JSONObject)["host.name"]).toBe("web-2");
    });

    it("forwards an attributes filter on a key only a dashboard variable binds to", async () => {
      /*
       * The shipped templates persist `filterData: { metricName,
       * aggegationType }` and no attributes at all — the filter on
       * `resource.k8s.cluster.name` is injected at render time by
       * DashboardVariableInterpolation once the viewer picks a cluster. An
       * allowlist built only from stored filters would reject every real
       * templated dashboard the moment its variable is used.
       */
      setWidgets(
        [{ metricName: CHARTED_METRIC_NAME }],
        ["resource.k8s.cluster.name"],
      );

      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          attributes: { "resource.k8s.cluster.name": "prod-eu" },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(
        (query["attributes"] as JSONObject)["resource.k8s.cluster.name"],
      ).toBe("prod-eu");
    });

    it("forwards the widget-level attributeFilters a table widget persists", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          attributeFilters: { environment: "production" },
        },
      ]);

      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          attributes: { environment: "production" },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    /*
     * primaryEntityId is no longer among these: it is the service filter a
     * chart can be saved with (issue #6280), so one the dashboard does not
     * save is refused rather than dropped ("service filter" below).
     */
    it("drops every other client-supplied query key", async () => {
      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          serviceId: ObjectID.generate().toString(),
          retentionDate: "2020-01-01",
          value: { _type: "GreaterThan", value: 0 },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(Object.keys(query).sort()).toEqual(["name", "projectId"]);
    });

    it("keeps the time window the widget asks for", async () => {
      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          time: {
            _type: "InBetween",
            value: {
              startValue: "2026-01-01T00:00:00.000Z",
              endValue: "2026-01-02T00:00:00.000Z",
            },
          },
        },
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(query["time"]).toBeDefined();
    });

    it("pins the metric name as an own property of the query it aggregates", async () => {
      await callWithAggregate();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      expect(Object.prototype.hasOwnProperty.call(query, "name")).toBe(true);
      expect(query["name"]).toBe(CHARTED_METRIC_NAME);
    });

    it("refuses a query that is not an object", async () => {
      const badQueries: Array<unknown> = [null, "name", ["name"], 42, true];

      for (const badQuery of badQueries) {
        jest.clearAllMocks();

        await callWithAggregate({ query: badQuery as JSONObject });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });
  });

  /*
   * Issue #6280. A chart saved with a service filter (#6266) charts those
   * services only, and the public page now asks for them: its query carries
   * `primaryEntityId: Includes(ids)`. The route reads the services from the
   * saved dashboard - for each metric, the services each of its queries is
   * saved with - and runs the request for the saved query it names, as
   * saved. Nothing a request says can widen a chart to more services, narrow
   * it to one of them, or borrow another metric's.
   */
  describe("service filter (issue #6280)", () => {
    type CallForServicesFunction = (
      primaryEntityId?: unknown,
      overrides?: JSONObject,
    ) => Promise<void>;

    // A request for the charted metric with this service filter, or none.
    const callForServices: CallForServicesFunction = async (
      primaryEntityId?: unknown,
      overrides?: JSONObject,
    ): Promise<void> => {
      const query: JSONObject = {
        name: CHARTED_METRIC_NAME,
        ...(overrides && overrides["query"]
          ? (overrides["query"] as JSONObject)
          : {}),
      };

      if (primaryEntityId !== undefined) {
        query["primaryEntityId"] = primaryEntityId as JSONObject;
      }

      await callWithAggregate({ ...(overrides || {}), query: query });
    };

    type GetAggregatedServiceIdsFunction = () => Array<string> | undefined;

    // The services the aggregation ran for; undefined for every service.
    const getAggregatedServiceIds: GetAggregatedServiceIdsFunction = ():
      | Array<string>
      | undefined => {
      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

      if (!Object.prototype.hasOwnProperty.call(query, "primaryEntityId")) {
        // Not even inherited: nothing reaches the store that was not checked.
        for (const key in query) {
          expect(key).not.toBe("primaryEntityId");
        }

        return undefined;
      }

      const filter: unknown = query["primaryEntityId"];

      expect(filter).toBeInstanceOf(Includes);

      return [...((filter as Includes).values as Array<string>)];
    };

    type ExpectServicesRefusedFunction = () => void;

    const expectServicesRefused: ExpectServicesRefusedFunction = (): void => {
      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
      );
      expectNothingAggregated();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    };

    describe("a chart saved with services", () => {
      beforeEach(() => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID, CHECKOUT_SERVICE_ID],
          },
        ]);
      });

      it("charts those services only", async () => {
        await callForServices(
          servicesFilter([API_SERVICE_ID, CHECKOUT_SERVICE_ID]),
        );

        expect(getAggregatedServiceIds()).toEqual([
          API_SERVICE_ID,
          CHECKOUT_SERVICE_ID,
        ]);

        const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

        expect(Object.keys(query).sort()).toEqual([
          "name",
          "primaryEntityId",
          "projectId",
        ]);
        expect(query["name"]).toBe(CHARTED_METRIC_NAME);
        expect(query["projectId"]).toBe(projectId);
      });

      it("is read for its services as saved, whatever order the request names them in", async () => {
        for (const requested of [
          [CHECKOUT_SERVICE_ID, API_SERVICE_ID],
          [API_SERVICE_ID, CHECKOUT_SERVICE_ID],
        ]) {
          jest.clearAllMocks();

          await callForServices(servicesFilter(requested));

          // The dashboard's ids in the dashboard's order: never the request's.
          expect(getAggregatedServiceIds()).toEqual([
            API_SERVICE_ID,
            CHECKOUT_SERVICE_ID,
          ]);
        }
      });

      it("refuses its services with one of them named twice, which no page sends", async () => {
        for (const requested of [
          [CHECKOUT_SERVICE_ID, API_SERVICE_ID, CHECKOUT_SERVICE_ID],
          [API_SERVICE_ID, API_SERVICE_ID, CHECKOUT_SERVICE_ID],
          [
            API_SERVICE_ID,
            CHECKOUT_SERVICE_ID,
            API_SERVICE_ID,
            CHECKOUT_SERVICE_ID,
          ],
        ]) {
          jest.clearAllMocks();

          await callForServices(servicesFilter(requested));
          expectServicesRefused();
        }
      });

      it("keeps the rest of the chart's query: its time window, filters and grouping", async () => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            attributes: { "host.name": "web-1" },
            groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
            telemetryServiceIds: [API_SERVICE_ID],
          },
        ]);

        const startDate: Date = new Date("2026-01-01T00:00:00.000Z");
        const endDate: Date = new Date("2026-01-02T00:00:00.000Z");

        await callRoute({
          aggregateBy: JSON.parse(
            JSON.stringify(
              JSONFunctions.serialize({
                query: {
                  projectId: ObjectID.generate(),
                  name: CHARTED_METRIC_NAME,
                  time: new InBetween(startDate, endDate),
                  attributes: { "host.name": "web-1" },
                  primaryEntityId: new Includes([API_SERVICE_ID]),
                },
                aggregationType: "Avg",
                aggregateColumnName: "value",
                aggregationTimestampColumnName: "time",
                startTimestamp: startDate,
                endTimestamp: endDate,
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
                topK: { count: 10, rankBy: "max" },
              } as unknown as JSONObject),
            ),
          ) as JSONObject,
        });

        expect(getAggregatedServiceIds()).toEqual([API_SERVICE_ID]);

        const args: JSONObject = getAggregateArgs();
        const query: JSONObject = args["query"] as JSONObject;

        expect(Object.keys(query).sort()).toEqual([
          "attributes",
          "name",
          "primaryEntityId",
          "projectId",
          "time",
        ]);
        expect(query["time"]).toBeInstanceOf(InBetween);
        expect((query["attributes"] as JSONObject)["host.name"]).toBe("web-1");
        expect(args["groupByAttributeKeys"]).toEqual([CHARTED_GROUP_BY_KEY]);
        expect(args["topK"]).toEqual({ count: 10, rankBy: "max" });
        // The project is the dashboard's, not the one the request named.
        expect(query["projectId"]).toBe(projectId);
      });

      it("refuses to chart every service instead", async () => {
        await callForServices();
        expectServicesRefused();

        jest.clearAllMocks();

        // A null filter is no filter: every service, refused alike.
        await callForServices(null);
        expectServicesRefused();
      });

      it("refuses a service it does not chart, alone or among its own", async () => {
        for (const requested of [
          [UNSAVED_SERVICE_ID],
          [API_SERVICE_ID, CHECKOUT_SERVICE_ID, UNSAVED_SERVICE_ID],
          [API_SERVICE_ID, UNSAVED_SERVICE_ID],
        ]) {
          jest.clearAllMocks();

          await callForServices(servicesFilter(requested));
          expectServicesRefused();
        }
      });

      it("refuses one of its services on its own", async () => {
        for (const requested of [[API_SERVICE_ID], [CHECKOUT_SERVICE_ID]]) {
          jest.clearAllMocks();

          await callForServices(servicesFilter(requested));
          expectServicesRefused();
        }
      });

      it("refuses its services for a metric the dashboard does not chart", async () => {
        await callWithAggregate({
          query: {
            name: "billing.revenue.total",
            primaryEntityId: servicesFilter([
              API_SERVICE_ID,
              CHECKOUT_SERVICE_ID,
            ]),
          },
        });

        const error: unknown = getThrownError();

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toBe(
          "This metric is not part of this dashboard.",
        );
        expectNothingAggregated();
      });

      it("says nothing in its refusal about the services it charts", async () => {
        await callForServices(servicesFilter([UNSAVED_SERVICE_ID]));

        const message: string = (getThrownError() as Error).message;

        expect(message).toBe(PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE);
        expect(message).not.toContain(API_SERVICE_ID);
        expect(message).not.toContain(CHECKOUT_SERVICE_ID);
        expect(message).not.toContain(UNSAVED_SERVICE_ID);
      });
    });

    describe("a dashboard of several charts", () => {
      it("reads each metric for its own charts' services, never another metric's", async () => {
        const memoryMetricName: string = "system.memory.usage";

        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID],
          },
          {
            metricName: memoryMetricName,
            telemetryServiceIds: [CHECKOUT_SERVICE_ID],
          },
        ]);

        const cases: Array<{
          metricName: string;
          serviceIds: Array<string>;
          read: boolean;
        }> = [
          {
            metricName: CHARTED_METRIC_NAME,
            serviceIds: [API_SERVICE_ID],
            read: true,
          },
          {
            metricName: memoryMetricName,
            serviceIds: [CHECKOUT_SERVICE_ID],
            read: true,
          },
          {
            metricName: CHARTED_METRIC_NAME,
            serviceIds: [CHECKOUT_SERVICE_ID],
            read: false,
          },
          {
            metricName: memoryMetricName,
            serviceIds: [API_SERVICE_ID],
            read: false,
          },
          {
            metricName: CHARTED_METRIC_NAME,
            serviceIds: [API_SERVICE_ID, CHECKOUT_SERVICE_ID],
            read: false,
          },
          { metricName: CHARTED_METRIC_NAME, serviceIds: [], read: false },
          { metricName: memoryMetricName, serviceIds: [], read: false },
        ];

        for (const testCase of cases) {
          jest.clearAllMocks();

          await callWithAggregate({
            query: {
              name: testCase.metricName,
              ...(testCase.serviceIds.length > 0
                ? { primaryEntityId: servicesFilter(testCase.serviceIds) }
                : {}),
            },
          });

          if (testCase.read) {
            expect(getAggregatedServiceIds()).toEqual(testCase.serviceIds);
          } else {
            expectServicesRefused();
          }
        }
      });

      it("reads a metric charted both with and without services either way, and for no other services", async () => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID],
          },
          { metricName: CHARTED_METRIC_NAME },
        ]);

        await callForServices();
        expect(getAggregatedServiceIds()).toBeUndefined();

        jest.clearAllMocks();

        await callForServices(servicesFilter([API_SERVICE_ID]));
        expect(getAggregatedServiceIds()).toEqual([API_SERVICE_ID]);

        jest.clearAllMocks();

        await callForServices(servicesFilter([CHECKOUT_SERVICE_ID]));
        expectServicesRefused();
      });

      it("reads two charts of one metric each for its own services, and never for both together", async () => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID],
          },
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [CHECKOUT_SERVICE_ID],
          },
        ]);

        await callForServices(servicesFilter([API_SERVICE_ID]));
        expect(getAggregatedServiceIds()).toEqual([API_SERVICE_ID]);

        jest.clearAllMocks();

        await callForServices(servicesFilter([CHECKOUT_SERVICE_ID]));
        expect(getAggregatedServiceIds()).toEqual([CHECKOUT_SERVICE_ID]);

        for (const requested of [
          servicesFilter([API_SERVICE_ID, CHECKOUT_SERVICE_ID]),
          undefined,
        ]) {
          jest.clearAllMocks();

          await callForServices(requested);
          expectServicesRefused();
        }
      });

      it("reads a chart's fallback for the fallback's own saved services", async () => {
        const fallbackMetricName: string = "k8s.container.restarts";

        dashboard.dashboardViewConfig = {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [
            {
              _type: "DashboardComponent",
              componentId: ObjectID.generate().toString(),
              componentType: DashboardComponentType.Chart,
              topInDashboardUnits: 0,
              leftInDashboardUnits: 0,
              widthInDashboardUnits: 12,
              heightInDashboardUnits: 6,
              arguments: {
                metricQueryConfig: {
                  metricQueryData: {
                    filterData: {
                      metricName: CHARTED_METRIC_NAME,
                      telemetryServiceIds: [API_SERVICE_ID],
                    },
                  },
                  fallback: {
                    queryConfig: {
                      metricQueryData: {
                        filterData: { metricName: fallbackMetricName },
                      },
                    },
                  },
                },
              },
            },
          ],
        } as unknown as DashboardViewConfig;

        await callWithAggregate({ query: { name: fallbackMetricName } });
        expect(getAggregatedServiceIds()).toBeUndefined();

        jest.clearAllMocks();

        // The main query's services are its own, not the fallback's.
        await callWithAggregate({
          query: {
            name: fallbackMetricName,
            primaryEntityId: servicesFilter([API_SERVICE_ID]),
          },
        });
        expectServicesRefused();

        jest.clearAllMocks();

        await callForServices(servicesFilter([API_SERVICE_ID]));
        expect(getAggregatedServiceIds()).toEqual([API_SERVICE_ID]);
      });
    });

    describe("a dashboard saved before service filters", () => {
      it("reads every service with exactly the query it read before", async () => {
        setWidgets(
          [
            {
              metricName: CHARTED_METRIC_NAME,
              attributes: { "host.name": "web-1" },
            },
          ],
          ["resource.k8s.cluster.name"],
        );

        await callForServices();

        expect(getAggregatedServiceIds()).toBeUndefined();
        expect(
          Object.keys(getAggregateArgs()["query"] as JSONObject).sort(),
        ).toEqual(["name", "projectId"]);

        jest.clearAllMocks();

        await callWithAggregate({
          query: {
            name: CHARTED_METRIC_NAME,
            time: {
              _type: "InBetween",
              value: {
                startValue: "2026-01-01T00:00:00.000Z",
                endValue: "2026-01-02T00:00:00.000Z",
              },
            },
            attributes: {
              "host.name": "web-2",
              "resource.k8s.cluster.name": "prod-eu",
            },
          },
        });

        expect(getAggregatedServiceIds()).toBeUndefined();
        expect(
          Object.keys(getAggregateArgs()["query"] as JSONObject).sort(),
        ).toEqual(["attributes", "name", "projectId", "time"]);
      });

      it("refuses a service filter of any shape, rather than dropping it", async () => {
        for (const requested of [
          servicesFilter([API_SERVICE_ID]),
          servicesFilter([UNSAVED_SERVICE_ID]),
          "smuggled",
          API_SERVICE_ID,
        ]) {
          jest.clearAllMocks();

          await callForServices(requested);
          expectServicesRefused();
        }
      });

      it("reads saved services that name none as every service, as the public page does", async () => {
        const savedNone: Array<unknown> = [
          [],
          null,
          API_SERVICE_ID,
          { 0: API_SERVICE_ID },
          [null, "", "   "],
          7,
        ];

        for (const telemetryServiceIds of savedNone) {
          jest.clearAllMocks();
          setWidgets([
            {
              metricName: CHARTED_METRIC_NAME,
              telemetryServiceIds: telemetryServiceIds,
            },
          ]);

          await callForServices();
          expect(getAggregatedServiceIds()).toBeUndefined();

          jest.clearAllMocks();

          await callForServices(servicesFilter([API_SERVICE_ID]));
          expectServicesRefused();
        }
      });
    });

    describe("ids as saved", () => {
      it("reads saved ids the way the public page does: trimmed, each once, ObjectID JSON as its id", async () => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [
              ` ${API_SERVICE_ID} `,
              { _type: "ObjectID", value: CHECKOUT_SERVICE_ID },
              API_SERVICE_ID,
            ],
          },
        ]);

        await callForServices(
          servicesFilter([API_SERVICE_ID, CHECKOUT_SERVICE_ID]),
        );

        expect(getAggregatedServiceIds()).toEqual([
          API_SERVICE_ID,
          CHECKOUT_SERVICE_ID,
        ]);
      });

      it("does not read a chart saved with something that is not a service id among its services, nor every service instead", async () => {
        for (const notAnId of ["smuggled", 7]) {
          setWidgets([
            {
              metricName: CHARTED_METRIC_NAME,
              telemetryServiceIds: [API_SERVICE_ID, notAnId],
            },
          ]);

          for (const requested of [
            // What the page sends for it: MetricQueryServices reads 7 as "7".
            servicesFilter([API_SERVICE_ID, String(notAnId)]),
            servicesFilter([API_SERVICE_ID]),
            undefined,
          ]) {
            jest.clearAllMocks();

            await callForServices(requested);
            expectServicesRefused();
          }
        }
      });

      it("matches a requested id exactly", async () => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID],
          },
        ]);

        for (const looseId of [
          ` ${API_SERVICE_ID}`,
          `${API_SERVICE_ID} `,
          `${API_SERVICE_ID}\n`,
          API_SERVICE_ID.toUpperCase(),
          API_SERVICE_ID.replace(/-/g, ""),
        ]) {
          jest.clearAllMocks();

          await callForServices(servicesFilter([looseId]));
          expectServicesRefused();
        }
      });
    });

    describe("a tampered service filter", () => {
      beforeEach(() => {
        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            telemetryServiceIds: [API_SERVICE_ID],
          },
        ]);
      });

      it("is refused in every other shape a request can give it", async () => {
        const shapes: Array<[string, unknown]> = [
          ["one id", API_SERVICE_ID],
          ["a number", 42],
          ["true", true],
          ["an object", {}],
          ["a plain list of the id", [API_SERVICE_ID]],
          [
            "the filter as JSON text",
            JSON.stringify(servicesFilter([API_SERVICE_ID])),
          ],
          ["a list holding the filter", [servicesFilter([API_SERVICE_ID])]],
          ["an empty list", []],
          ["an ObjectID", { _type: "ObjectID", value: API_SERVICE_ID }],
          ["an empty Includes", { _type: "Includes", value: [] }],
          ["an Includes of a number", { _type: "Includes", value: [42] }],
          ["an Includes of null", { _type: "Includes", value: [null] }],
          ["an Includes of an empty id", { _type: "Includes", value: [""] }],
          [
            "an Includes naming the id twice",
            { _type: "Includes", value: [API_SERVICE_ID, API_SERVICE_ID] },
          ],
          [
            "an Includes of a text that is not an id",
            { _type: "Includes", value: ["smuggled"] },
          ],
          [
            "an Includes of the id followed by SQL",
            {
              _type: "Includes",
              value: [`${API_SERVICE_ID}') OR ('1'='1`],
            },
          ],
          [
            "an Includes of an ObjectID",
            {
              _type: "Includes",
              value: [{ _type: "ObjectID", value: API_SERVICE_ID }],
            },
          ],
          [
            "an Includes of a list",
            { _type: "Includes", value: [[API_SERVICE_ID]] },
          ],
          [
            "an Includes of an object",
            { _type: "Includes", value: [{ value: API_SERVICE_ID }] },
          ],
          [
            "an Includes of an Includes",
            {
              _type: "Includes",
              value: [{ _type: "Includes", value: [API_SERVICE_ID] }],
            },
          ],
          [
            "an Includes of the id's letters",
            { _type: "Includes", value: API_SERVICE_ID },
          ],
          [
            "IncludesNone, which reads every other service",
            { _type: "IncludesNone", value: [API_SERVICE_ID] },
          ],
          ["IncludesAll", { _type: "IncludesAll", value: [API_SERVICE_ID] }],
          ["EqualTo", { _type: "EqualTo", value: API_SERVICE_ID }],
          ["NotEqual", { _type: "NotEqual", value: API_SERVICE_ID }],
          ["Search", { _type: "Search", value: API_SERVICE_ID }],
          ["StartsWith", { _type: "StartsWith", value: API_SERVICE_ID }],
          ["IsNull", { _type: "IsNull", value: null }],
          ["NotNull", { _type: "NotNull", value: null }],
          [
            "a Mongo-style operator",
            { $in: [API_SERVICE_ID], $ne: UNSAVED_SERVICE_ID },
          ],
        ];

        for (const [label, shape] of shapes) {
          jest.clearAllMocks();

          await callForServices(shape);

          const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
            .calls as Array<Array<unknown>>;

          if (
            calls.length !== 1 ||
            !(calls[0]![0] instanceof BadDataException) ||
            (calls[0]![0] as BadDataException).message !==
              PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE
          ) {
            throw new Error(
              `${label} was not refused: ${String(calls[0]?.[0])}`,
            );
          }

          expectNothingAggregated();
        }
      });

      it("is refused when its filter JSON cannot even be read", async () => {
        for (const shape of [
          { _type: "Includes", value: {} },
          { _type: "Includes", value: 5 },
          // The filter wrapped in a filter: its value is no list.
          { _type: "Includes", value: servicesFilter([API_SERVICE_ID]) },
        ]) {
          jest.clearAllMocks();

          await callForServices(shape);

          expect(nextFunction).toHaveBeenCalledTimes(1);
          expectNothingAggregated();
          expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
        }
      });

      it("cannot name ten thousand services to cover the saved one", async () => {
        const serviceIds: Array<string> = [API_SERVICE_ID];

        for (let index: number = 0; index < 10000; index++) {
          serviceIds.push(ObjectID.generate().toString());
        }

        await callForServices(servicesFilter(serviceIds));
        expectServicesRefused();
      });

      it("hidden on the query's prototype reaches nothing", async () => {
        const protoBody: string =
          `{"aggregateBy":{"query":{"name":"${CHARTED_METRIC_NAME}",` +
          `"__proto__":{"primaryEntityId":{"_type":"Includes","value":["${UNSAVED_SERVICE_ID}"]}}},` +
          `"aggregateColumnName":"value","aggregationType":"Avg",` +
          `"aggregationTimestampColumnName":"time",` +
          `"startTimestamp":"2026-01-01T00:00:00.000Z",` +
          `"endTimestamp":"2026-01-02T00:00:00.000Z","limit":100,"skip":0}}`;

        // Read as no filter: every service, which this chart does not chart.
        await callRoute(JSON.parse(protoBody) as JSONObject);
        expectServicesRefused();

        jest.clearAllMocks();

        // And on a chart of every service, no filter reaches the store at all.
        setWidgets([{ metricName: CHARTED_METRIC_NAME }]);

        await callRoute(JSON.parse(protoBody) as JSONObject);
        expect(getAggregatedServiceIds()).toBeUndefined();
      });

      it("cannot move the aggregation to another project", async () => {
        const otherProjectId: ObjectID = ObjectID.generate();

        await callForServices(servicesFilter([API_SERVICE_ID]), {
          query: { projectId: otherProjectId.toString() },
        });

        expect(getAggregatedServiceIds()).toEqual([API_SERVICE_ID]);

        const query: JSONObject = getAggregateArgs()["query"] as JSONObject;

        expect(query["projectId"]).toBe(projectId);
      });
    });
  });

  /*
   * JSON.parse turns a literal "__proto__" member into a real own key, and
   * JSONFunctions.deserialize copies it with `newVal[key] = ...`, which fires
   * Object.prototype's __proto__ setter. Every one of these bodies must be
   * built with JSON.parse — a JS object literal sets the prototype at parse
   * time and never produces the own key that makes the attack work.
   */
  describe("prototype-carried keys", () => {
    type ProtoBodyFunction = (json: string) => JSONObject;

    const protoBody: ProtoBodyFunction = (json: string): JSONObject => {
      return JSON.parse(json) as JSONObject;
    };

    it("refuses a metric name inherited through __proto__", async () => {
      /*
       * The allowlist check used to read `query["name"]` (which walks the
       * prototype chain and saw the allowlisted name) while the project pin
       * spread only own properties (which dropped it) — so the aggregation
       * reached ClickHouse with NO name predicate at all: every metric in
       * the project, from one anonymous request.
       */
      await callRoute(
        protoBody(
          `{"aggregateBy":{"query":{"__proto__":{"name":"${CHARTED_METRIC_NAME}"}},` +
            `"aggregateColumnName":"value","aggregationType":"Avg",` +
            `"aggregationTimestampColumnName":"time",` +
            `"startTimestamp":"2026-01-01T00:00:00.000Z",` +
            `"endTimestamp":"2026-01-02T00:00:00.000Z","limit":100,"skip":0}}`,
        ),
      );

      const error: unknown = getThrownError();

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "This metric is not part of this dashboard.",
      );
      expectNothingAggregated();
    });

    it("refuses an attributes filter smuggled through __proto__", async () => {
      await callRoute(
        protoBody(
          `{"aggregateBy":{"query":{"name":"${CHARTED_METRIC_NAME}",` +
            `"attributes":{"__proto__":{"user.email":"a"}}},` +
            `"aggregateColumnName":"value","aggregationType":"Avg",` +
            `"aggregationTimestampColumnName":"time",` +
            `"startTimestamp":"2026-01-01T00:00:00.000Z",` +
            `"endTimestamp":"2026-01-02T00:00:00.000Z","limit":100,"skip":0}}`,
        ),
      );

      expect(nextFunction).not.toHaveBeenCalled();

      const query: JSONObject = getAggregateArgs()["query"] as JSONObject;
      const attributes: unknown = query["attributes"];

      // Nothing inherited may survive into the object handed to the service.
      for (const key in (attributes || {}) as Record<string, unknown>) {
        expect(key).not.toBe("user.email");
      }
    });

    it("does not let a group-by column hide on the prototype", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupBy: { serviceEntityKey: true },
        },
      ]);

      await callRoute(
        protoBody(
          `{"aggregateBy":{"query":{"name":"${CHARTED_METRIC_NAME}"},` +
            `"groupBy":{"serviceEntityKey":true,"__proto__":{"attributes":true}},` +
            `"aggregateColumnName":"value","aggregationType":"Avg",` +
            `"aggregationTimestampColumnName":"time",` +
            `"startTimestamp":"2026-01-01T00:00:00.000Z",` +
            `"endTimestamp":"2026-01-02T00:00:00.000Z","limit":100,"skip":0}}`,
        ),
      );

      expect(nextFunction).not.toHaveBeenCalled();

      /*
       * The guard uses Object.keys but the SQL builder walks groupBy with
       * for...in, so an inherited key would reach GROUP BY unvalidated.
       * Assert the two agree on the object actually handed to the service.
       */
      const groupBy: Record<string, unknown> = getAggregateArgs()[
        "groupBy"
      ] as Record<string, unknown>;
      const enumerated: Array<string> = [];

      for (const key in groupBy) {
        enumerated.push(key);
      }

      expect(enumerated).toEqual(["serviceEntityKey"]);
    });

    it("does not treat a prototype key as a configured grouping", async () => {
      await callWithAggregate({
        groupByAttributeKeys: ["__proto__", "constructor", "toString"],
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });
  });

  /*
   * The viewer's zone (issue #7277): a chart over a month reads days, and
   * each starts at the viewer's midnight, so the zone the page sends reaches
   * the read. MetricService.aggregateBy refuses one the Timezone list does
   * not name before it reads anything, the point type included.
   */
  describe("the viewer's zone", () => {
    it("reads a month of days in the zone the viewer sends", async () => {
      await callWithAggregate({
        startTimestamp: "2026-01-01T00:00:00.000Z",
        endTimestamp: "2026-02-01T00:00:00.000Z",
        timezone: "America/New_York",
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getAggregateArgs()["timezone"]).toBe(Timezone.AmericaNew_York);
    });

    it("reads UTC's days, as before, when the viewer sends no zone", async () => {
      await callWithAggregate();

      expect(nextFunction).not.toHaveBeenCalled();
      expect(getAggregateArgs()["timezone"]).toBeUndefined();
    });

    it("refuses a zone that is not one, before anything is read", async () => {
      jest.spyOn(MetricService, "aggregateBy").mockRestore();

      const executeQuery: jest.SpyInstance = jest
        .spyOn(
          MetricService as unknown as {
            executeQuery: () => Promise<unknown>;
          },
          "executeQuery",
        )
        .mockResolvedValue({ data: [] });

      for (const notAZone of [
        "america/new_york",
        "UTC'), 'UTC') AS time FROM system.one --",
        330,
      ]) {
        jest.clearAllMocks();

        await callWithAggregate({
          startTimestamp: "2026-01-01T00:00:00.000Z",
          endTimestamp: "2026-02-01T00:00:00.000Z",
          timezone: notAZone,
        });

        const thrown: unknown = getThrownError();
        expect(thrown).toBeInstanceOf(BadDataException);
        expect((thrown as BadDataException).message).toBe(
          INVALID_TIMEZONE_MESSAGE,
        );
        expect(executeQuery).not.toHaveBeenCalled();
      }
    });
  });

  describe("aggregate column and pagination", () => {
    /*
     * `aggregateColumnName` was forwarded verbatim. A non-`value` column
     * skips every MetricService fast path and falls through to
     * `max(<column>) as <column>`; the row mapper only parseFloats strings
     * and copies anything else into `value` untouched — so asking to
     * aggregate `attributes` returned a whole attribute map per time bucket.
     */
    it("refuses an aggregateColumnName the widgets never aggregate", async () => {
      const columns: Array<string> = [
        "attributes",
        "name",
        "serviceEntityKey",
        "projectId",
        "time",
      ];

      for (const column of columns) {
        jest.clearAllMocks();

        await callWithAggregate({ aggregateColumnName: column });

        const error: unknown = getThrownError();

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toBe(
          "Invalid aggregateColumnName.",
        );
        expectNothingAggregated();
      }
    });

    it("refuses an aggregationTimestampColumnName other than time", async () => {
      for (const column of ["createdAt", "attributes", "value"]) {
        jest.clearAllMocks();

        await callWithAggregate({ aggregationTimestampColumnName: column });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("accepts the value/time pair every widget actually sends", async () => {
      await callWithAggregate({
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    it("clamps an oversized limit and a negative skip", async () => {
      await callWithAggregate({ limit: 10000000, skip: -5 });

      expect(nextFunction).not.toHaveBeenCalled();

      const args: JSONObject = getAggregateArgs();

      expect(args["limit"]).toBe(LIMIT_PER_PROJECT);
      expect(args["skip"]).toBe(0);
    });

    it("falls back to a sane limit for a nonsensical one", async () => {
      for (const limit of [0, -1, "not-a-number", null]) {
        jest.clearAllMocks();

        await callWithAggregate({ limit: limit as number });

        expect(nextFunction).not.toHaveBeenCalled();

        const limitSent: unknown = getAggregateArgs()["limit"];

        expect(typeof limitSent).toBe("number");
        expect(limitSent as number).toBeGreaterThan(0);
        expect(limitSent as number).toBeLessThanOrEqual(LIMIT_PER_PROJECT);
      }
    });

    it("honours a sensible limit and skip", async () => {
      await callWithAggregate({ limit: 25, skip: 50 });

      const args: JSONObject = getAggregateArgs();

      expect(args["limit"]).toBe(25);
      expect(args["skip"]).toBe(50);
    });
  });

  describe("null handling", () => {
    /*
     * JSONFunctions.serialize drops `undefined` but preserves `null`, and
     * both downstream sinks already treat a null groupBy as absent — so the
     * route must too, or an ungrouped widget round-tripped through the wire
     * would 400.
     */
    it("treats an explicit null groupBy and groupByAttributeKeys as absent", async () => {
      await callWithAggregate({
        groupBy: null as unknown as JSONObject,
        groupByAttributeKeys: null as unknown as Array<string>,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
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

  describe("stored config shapes", () => {
    it("collects group-by keys from every shape the widgets persist", async () => {
      /*
       * The table's own shapes are a table's: a public dashboard serves a
       * widget only the settings its type has (issue #6338).
       */
      const shapes: Array<{ label: string; config: JSONObject }> = [
        {
          label: "table widget groupByAttributes",
          config: {
            componentType: DashboardComponentType.Table,
            arguments: {
              groupByAttributes: [{ key: "shape.key" }],
              metricQueryConfigs: [
                { metricQueryData: { filterData: { metricName: "m" } } },
              ],
            },
          },
        },
        {
          label: "table widget groupByAttributeKeys",
          config: {
            componentType: DashboardComponentType.Table,
            arguments: {
              groupByAttributeKeys: ["shape.key"],
              metricQueryConfigs: [
                { metricQueryData: { filterData: { metricName: "m" } } },
              ],
            },
          },
        },
        {
          label: "legacy singular metricQueryConfig",
          config: {
            arguments: {
              metricQueryConfig: {
                metricQueryData: {
                  filterData: { metricName: "m" },
                  groupByAttributeKeys: ["shape.key"],
                },
              },
            },
          },
        },
        {
          label: "plural metricQueryConfigs",
          config: {
            arguments: {
              metricQueryConfigs: [
                {
                  metricQueryData: {
                    filterData: { metricName: "m" },
                    groupByAttributeKeys: ["shape.key"],
                  },
                },
              ],
            },
          },
        },
      ];

      for (const shape of shapes) {
        jest.clearAllMocks();

        dashboard.dashboardViewConfig = {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [
            {
              componentType: DashboardComponentType.Chart,
              ...shape.config,
            },
          ],
        } as unknown as DashboardViewConfig;

        await callWithAggregate({
          query: { name: "m" },
          groupByAttributeKeys: ["shape.key"],
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
      }
    });

    it("survives malformed groupByAttributes without widening the allowlist", async () => {
      const malformed: Array<unknown> = [
        null,
        7,
        "shape.key",
        {},
        { key: 42 },
        { key: "" },
        [],
      ];

      for (const entry of malformed) {
        jest.clearAllMocks();

        setWidgets([
          {
            metricName: CHARTED_METRIC_NAME,
            groupByAttributes: [entry as JSONObject],
          },
        ]);

        await callWithAggregate({ groupByAttributeKeys: ["shape.key"] });

        expect(getThrownError()).toBeInstanceOf(BadDataException);
        expectNothingAggregated();
      }
    });

    it("allows whole-attribute-map grouping when the widget itself is configured that way", async () => {
      // Legacy stored configs still carry groupBy: { attributes: true }.
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupBy: { attributes: true },
        },
      ]);

      await callWithAggregate({ groupBy: { attributes: true } });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });

    it("accepts an aggregateBy that has been through the wire serializer", async () => {
      /*
       * The client serializes AggregateBy before POSTing it, so operators
       * and dates arrive as `_type`-tagged objects and are revived by
       * JSONFunctions.deserialize inside the handler. Round-trip a realistic
       * payload through serialize -> JSON -> the route.
       */
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          attributes: { "host.name": "web-1" },
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      const startDate: Date = new Date("2026-01-01T00:00:00.000Z");
      const endDate: Date = new Date("2026-01-02T00:00:00.000Z");

      const wirePayload: JSONObject = JSON.parse(
        JSON.stringify(
          JSONFunctions.serialize({
            query: {
              projectId: ObjectID.generate(),
              name: CHARTED_METRIC_NAME,
              time: new InBetween(startDate, endDate),
              attributes: { "host.name": new Includes(["web-1", "web-2"]) },
            },
            aggregationType: "Avg",
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: startDate,
            endTimestamp: endDate,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
            topK: { count: 10, rankBy: "max" },
          } as unknown as JSONObject),
        ),
      ) as JSONObject;

      await callRoute({ aggregateBy: wirePayload });

      expect(nextFunction).not.toHaveBeenCalled();

      const args: JSONObject = getAggregateArgs();
      const query: JSONObject = args["query"] as JSONObject;

      expect(args["startTimestamp"]).toBeInstanceOf(Date);
      expect(args["groupByAttributeKeys"]).toEqual([CHARTED_GROUP_BY_KEY]);
      expect(args["topK"]).toEqual({ count: 10, rankBy: "max" });
      expect(query["name"]).toBe(CHARTED_METRIC_NAME);
      expect(query["projectId"]).toBe(projectId);
      expect((query["attributes"] as JSONObject)["host.name"]).toBeInstanceOf(
        Includes,
      );
      expect(query["time"]).toBeInstanceOf(InBetween);
    });

    it("refuses an aggregateBy that is not an object", async () => {
      const badPayloads: Array<unknown> = [0, "", "aggregate", [], true, 42];

      for (const payload of badPayloads) {
        jest.clearAllMocks();

        await callRoute({ aggregateBy: payload as JSONObject });

        expect(nextFunction).toHaveBeenCalled();
        expectNothingAggregated();
      }
    });
  });

  describe("normalization", () => {
    it("does not trim the requested metric name", async () => {
      await callWithAggregate({
        query: { name: ` ${CHARTED_METRIC_NAME} ` },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("does not trim a requested group-by key", async () => {
      setWidgets([
        {
          metricName: CHARTED_METRIC_NAME,
          groupByAttributeKeys: [CHARTED_GROUP_BY_KEY],
        },
      ]);

      await callWithAggregate({
        groupByAttributeKeys: [` ${CHARTED_GROUP_BY_KEY} `],
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });

    it("matches metric names case-sensitively", async () => {
      await callWithAggregate({
        query: { name: CHARTED_METRIC_NAME.toUpperCase() },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingAggregated();
    });
  });

  describe("response", () => {
    it("returns the aggregated rows unchanged", async () => {
      const aggregated: JSONObject = {
        data: [{ time: "2026-01-01T00:00:00.000Z", value: 1 }],
        totalGroups: 7,
      };

      jest
        .spyOn(MetricService, "aggregateBy")
        .mockResolvedValue(aggregated as never);

      await callWithAggregate();

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

      const responseCall: Array<unknown> = (
        Response.sendJsonObjectResponse as jest.Mock
      ).mock.calls[0] as Array<unknown>;

      expect(responseCall[2]).toEqual(aggregated);
    });

    it("sends no response at all when the request is refused", async () => {
      await callWithAggregate({ query: { name: "billing.revenue.total" } });

      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
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

  /*
   * Issue #4571. The public page now draws a dashboard whose config was
   * stored as JSON text or inside the API reference's
   * `{"_type": "DashboardViewConfig", "value": {...}}` envelope, so its
   * charts ask for their metrics. The allowlists are built from that same
   * config: the charted metric, the keys it groups and filters by - and
   * still nothing else.
   */
  describe("a dashboard stored in another shape (issue #4571)", () => {
    const STORED_SHAPES: Array<
      [string, (config: DashboardViewConfig) => unknown]
    > = [
      [
        "JSON text",
        (config: DashboardViewConfig): unknown => {
          return JSON.stringify(config);
        },
      ],
      [
        "the DashboardViewConfig envelope",
        (config: DashboardViewConfig): unknown => {
          return { _type: "DashboardViewConfig", value: config };
        },
      ],
      [
        "the envelope as JSON text",
        (config: DashboardViewConfig): unknown => {
          return JSON.stringify({
            _type: "DashboardViewConfig",
            value: config,
          });
        },
      ],
    ];

    describe.each(STORED_SHAPES)(
      "stored as %s",
      (_name: string, storeAs: (config: DashboardViewConfig) => unknown) => {
        it("aggregates the metric it charts", async () => {
          dashboard.dashboardViewConfig = storeAs(
            buildViewConfig([{ metricName: CHARTED_METRIC_NAME }]),
          ) as DashboardViewConfig;

          await callWithAggregate();

          expect(nextFunction).not.toHaveBeenCalled();
          expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
        });

        it("still refuses a metric it does not chart", async () => {
          dashboard.dashboardViewConfig = storeAs(
            buildViewConfig([{ metricName: CHARTED_METRIC_NAME }]),
          ) as DashboardViewConfig;

          await callWithAggregate({ query: { name: "billing.revenue.total" } });

          expect(getThrownError()).toBeInstanceOf(BadDataException);
          expectNothingAggregated();
        });

        it("allows the key its chart groups by, and no other", async () => {
          dashboard.dashboardViewConfig = storeAs(
            buildViewConfig([
              {
                metricName: CHARTED_METRIC_NAME,
                groupByAttributeKeys: ["host.name"],
              },
            ]),
          ) as DashboardViewConfig;

          await callWithAggregate({ groupByAttributeKeys: ["host.name"] });
          expect(nextFunction).not.toHaveBeenCalled();

          jest.clearAllMocks();

          await callWithAggregate({ groupByAttributeKeys: ["enduser.id"] });
          expect(getThrownError()).toBeInstanceOf(BadDataException);
          expectNothingAggregated();
        });

        it("reads its chart for the services the chart is saved with, and no other", async () => {
          dashboard.dashboardViewConfig = storeAs(
            buildViewConfig([
              {
                metricName: CHARTED_METRIC_NAME,
                telemetryServiceIds: [API_SERVICE_ID],
              },
            ]),
          ) as DashboardViewConfig;

          await callWithAggregate({
            query: {
              name: CHARTED_METRIC_NAME,
              primaryEntityId: servicesFilter([API_SERVICE_ID]),
            },
          });

          expect(nextFunction).not.toHaveBeenCalled();
          const query: JSONObject = getAggregateArgs()["query"] as JSONObject;
          expect((query["primaryEntityId"] as Includes).values).toEqual([
            API_SERVICE_ID,
          ]);

          for (const requested of [
            undefined,
            servicesFilter([UNSAVED_SERVICE_ID]),
          ]) {
            jest.clearAllMocks();

            await callWithAggregate({
              query: {
                name: CHARTED_METRIC_NAME,
                ...(requested ? { primaryEntityId: requested } : {}),
              },
            });

            expect((getThrownError() as Error).message).toBe(
              PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
            );
            expectNothingAggregated();
          }
        });

        it("forwards a filter on a key only its variable binds to", async () => {
          dashboard.dashboardViewConfig = storeAs(
            buildViewConfig(
              [{ metricName: CHARTED_METRIC_NAME }],
              ["k8s.cluster.name"],
            ),
          ) as DashboardViewConfig;

          await callWithAggregate({
            query: {
              name: CHARTED_METRIC_NAME,
              attributes: { "k8s.cluster.name": "prod" },
            },
          });

          expect(nextFunction).not.toHaveBeenCalled();
          const query: JSONObject = getAggregateArgs()["query"] as JSONObject;
          expect((query["attributes"] as JSONObject)["k8s.cluster.name"]).toBe(
            "prod",
          );
        });
      },
    );

    /*
     * Issue #6297. Inside the widget list, a widget can be stored in four
     * more shapes the public page draws: as JSON text (a widget encoded
     * twice), in the DashboardComponent envelope with its value as JSON
     * text, in a widget list itself written as text, and with its
     * arguments written as text. The public metric routes read the widgets
     * the page draws, so each metric widget - chart, value, gauge, table -
     * reads in each shape exactly as it does stored as an object: its
     * metric, with its groupings, attribute-filter keys and services, and
     * still nothing it does not save. The two shapes that already worked -
     * an object, and the envelope with an object value - run alongside.
     */
    describe("a widget stored in another shape (issue #6297)", () => {
      const METRIC_TYPES_ROUTE: string = "/dashboard/metric-types/:dashboardId";

      const WIDGET_METRIC: string = "http.server.duration";
      const WIDGET_GROUP_BY_KEY: string = "host.name";
      const WIDGET_FILTER_KEY: string = "http.route";
      const FOREIGN_METRIC: string = "billing.revenue.total";
      const FOREIGN_KEY: string = "enduser.id";

      const METRIC_WIDGET_TYPES: Array<DashboardComponentType> = [
        DashboardComponentType.Chart,
        DashboardComponentType.Value,
        DashboardComponentType.Gauge,
        DashboardComponentType.Table,
      ];

      interface WidgetSpec {
        metricName: string;
        groupByKey: string;
        filterKey: string;
        /*
         * The services a chart, value or gauge query is saved with, one of
         * them as the ObjectID JSON a serialized id is stored as. A table's
         * columns name no services: it reads every service.
         */
        serviceIds: Array<string>;
      }

      const SPEC: WidgetSpec = {
        metricName: WIDGET_METRIC,
        groupByKey: WIDGET_GROUP_BY_KEY,
        filterKey: WIDGET_FILTER_KEY,
        serviceIds: [API_SERVICE_ID, CHECKOUT_SERVICE_ID],
      };

      type SavedQueryFunction = (spec: WidgetSpec) => JSONObject;

      // A query as the query editor saves it.
      const savedQuery: SavedQueryFunction = (spec: WidgetSpec): JSONObject => {
        return {
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: spec.metricName,
              aggegationType: "Avg",
              attributes: { [spec.filterKey]: "/pay" },
              ...(spec.serviceIds.length > 0
                ? {
                    telemetryServiceIds: spec.serviceIds.map(
                      (serviceId: string, index: number): JSONValue => {
                        return index === 1
                          ? { _type: "ObjectID", value: serviceId }
                          : serviceId;
                      },
                    ),
                  }
                : {}),
            },
            groupByAttributeKeys: [spec.groupByKey],
          },
        };
      };

      type BuildWidgetFunction = (
        componentType: string,
        spec: WidgetSpec,
      ) => JSONObject;

      // A metric widget of this type as the dashboard editor saves it.
      const buildWidget: BuildWidgetFunction = (
        componentType: string,
        spec: WidgetSpec,
      ): JSONObject => {
        const widget: JSONObject = {
          _type: "DashboardComponent",
          componentId: ObjectID.generate().toString(),
          componentType: componentType,
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: 6,
          heightInDashboardUnits: 4,
          minWidthInDashboardUnits: 1,
          minHeightInDashboardUnits: 1,
        };

        switch (componentType) {
          case DashboardComponentType.Value:
            widget["arguments"] = {
              title: "Latency",
              metricQueryConfig: savedQuery(spec),
            };
            break;
          case DashboardComponentType.Gauge:
            widget["arguments"] = {
              gaugeTitle: "Latency",
              minValue: 0,
              maxValue: 100,
              metricQueryConfig: savedQuery(spec),
            };
            break;
          case DashboardComponentType.Table:
            widget["arguments"] = {
              tableTitle: "Latency by host",
              columns: [
                {
                  id: "c1",
                  variable: "a",
                  header: "Latency",
                  kind: "Metric",
                  metricName: spec.metricName,
                  aggregation: "Avg",
                },
              ],
              groupByAttributes: [{ key: spec.groupByKey, header: "Host" }],
              attributeFilters: { [spec.filterKey]: "/pay" },
            };
            break;
          default:
            widget["arguments"] = {
              chartTitle: "Latency",
              chartType: "Line",
              metricQueryConfig: savedQuery(spec),
              metricQueryConfigs: [],
            };
        }

        return widget;
      };

      // The services a widget of this type is read for: [] for every one.
      const servicesOf: (componentType: string) => Array<string> = (
        componentType: string,
      ): Array<string> => {
        return componentType === DashboardComponentType.Table
          ? []
          : SPEC.serviceIds;
      };

      type StoreFunction = (
        widgets: Array<JSONObject>,
        junk?: Array<unknown>,
      ) => unknown;

      type WidgetShape = {
        name: string;
        store: StoreFunction;
        // The shape encoded once more, or cut short: read as no widget.
        unreadable?: Array<[string, StoreFunction]>;
      };

      type ConfigOfFunction = (components: unknown) => JSONObject;

      const configOf: ConfigOfFunction = (components: unknown): JSONObject => {
        return {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: components as JSONValue,
        };
      };

      // JSON text cut short: no JSON at all.
      const cutShort: (text: string) => string = (text: string): string => {
        return text.slice(0, Math.floor(text.length / 2));
      };

      const WIDGET_SHAPES: Array<WidgetShape> = [
        {
          name: "as an object",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(widgets);
          },
        },
        {
          name: "in the DashboardComponent envelope",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(
              widgets.map((widget: JSONObject): JSONObject => {
                return { _type: "DashboardComponent", value: widget };
              }),
            );
          },
        },
        {
          name: "as JSON text",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(
              widgets.map((widget: JSONObject): string => {
                return JSON.stringify(widget);
              }),
            );
          },
          unreadable: [
            [
              "encoded twice",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): string => {
                    return JSON.stringify(JSON.stringify(widget));
                  }),
                );
              },
            ],
            [
              "cut short",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): string => {
                    return cutShort(JSON.stringify(widget));
                  }),
                );
              },
            ],
          ],
        },
        {
          name: "in the DashboardComponent envelope, its value as JSON text",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(
              widgets.map((widget: JSONObject): JSONObject => {
                return {
                  _type: "DashboardComponent",
                  value: JSON.stringify(widget),
                };
              }),
            );
          },
          unreadable: [
            [
              "encoded twice",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): JSONObject => {
                    return {
                      _type: "DashboardComponent",
                      value: JSON.stringify(JSON.stringify(widget)),
                    };
                  }),
                );
              },
            ],
            [
              "cut short",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): JSONObject => {
                    return {
                      _type: "DashboardComponent",
                      value: cutShort(JSON.stringify(widget)),
                    };
                  }),
                );
              },
            ],
          ],
        },
        {
          name: "in a widget list written as JSON text",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(JSON.stringify(widgets));
          },
          unreadable: [
            [
              "encoded twice",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(JSON.stringify(JSON.stringify(widgets)));
              },
            ],
            [
              "cut short",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(cutShort(JSON.stringify(widgets)));
              },
            ],
          ],
        },
        {
          name: "with its arguments as JSON text",
          store: (widgets: Array<JSONObject>): unknown => {
            return configOf(
              widgets.map((widget: JSONObject): JSONObject => {
                return {
                  ...widget,
                  arguments: JSON.stringify(widget["arguments"]),
                };
              }),
            );
          },
          unreadable: [
            [
              "encoded twice",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): JSONObject => {
                    return {
                      ...widget,
                      arguments: JSON.stringify(
                        JSON.stringify(widget["arguments"]),
                      ),
                    };
                  }),
                );
              },
            ],
            [
              "cut short",
              (widgets: Array<JSONObject>): unknown => {
                return configOf(
                  widgets.map((widget: JSONObject): JSONObject => {
                    return {
                      ...widget,
                      arguments: cutShort(JSON.stringify(widget["arguments"])),
                    };
                  }),
                );
              },
            ],
          ],
        },
      ];

      type PageRequestFunction = (
        componentType: string,
        overrides?: { query?: JSONObject; aggregateBy?: JSONObject },
      ) => JSONObject;

      /*
       * The read the public page makes for the widget: its metric, with its
       * filter and grouping, for its services - as the widget's query asks.
       */
      const pageRequest: PageRequestFunction = (
        componentType: string,
        overrides?: { query?: JSONObject; aggregateBy?: JSONObject },
      ): JSONObject => {
        const serviceIds: Array<string> = servicesOf(componentType);

        return {
          query: {
            name: WIDGET_METRIC,
            attributes: { [WIDGET_FILTER_KEY]: "/pay" },
            ...(serviceIds.length > 0
              ? { primaryEntityId: servicesFilter(serviceIds) }
              : {}),
            ...(overrides?.query || {}),
          },
          groupByAttributeKeys: [WIDGET_GROUP_BY_KEY],
          ...(overrides?.aggregateBy || {}),
        };
      };

      type ExpectRefusedFunction = (message: string) => void;

      const expectRefused: ExpectRefusedFunction = (message: string): void => {
        const error: unknown = getThrownError();

        expect(error).toBeInstanceOf(BadDataException);
        expect((error as BadDataException).message).toBe(message);
        expectNothingAggregated();
      };

      const METRIC_REFUSED: string =
        "This metric is not part of this dashboard.";
      const ATTRIBUTE_REFUSED: string =
        "This attribute is not part of this dashboard.";

      type CallMetricTypesFunction = () => Promise<Array<string>>;

      // The metric types /metric-types lists, by name.
      const callMetricTypes: CallMetricTypesFunction = async (): Promise<
        Array<string>
      > => {
        jest.clearAllMocks();

        const request: ExpressRequest = {
          params: {
            dashboardId: dashboardId.toString(),
          },
          body: {},
          query: {},
          cookies: {},
          headers: {},
          socket: {},
          ips: [],
        } as unknown as ExpressRequest;

        await mockRouter
          .match("post", METRIC_TYPES_ROUTE)
          .handlerFunction(request, mockResponse, nextFunction);

        expect(nextFunction).not.toHaveBeenCalled();

        const calls: Array<Array<unknown>> = (
          Response.sendJsonObjectResponse as jest.Mock
        ).mock.calls as Array<Array<unknown>>;

        expect(calls.length).toBe(1);

        return (
          (calls[0]![2] as JSONObject)["metricTypes"] as Array<JSONObject>
        ).map((metricType: JSONObject): string => {
          return metricType["name"] as string;
        });
      };

      beforeEach(() => {
        // The project has the widget's metric, and others it does not chart.
        jest.spyOn(MetricTypeService, "findBy").mockResolvedValue(
          [WIDGET_METRIC, FOREIGN_METRIC, CHARTED_METRIC_NAME].map(
            (name: string): MetricType => {
              const metricType: MetricType = new MetricType();
              metricType.name = name;
              metricType.unit = "ms";
              return metricType;
            },
          ),
        );
      });

      describe.each(WIDGET_SHAPES)("stored $name", (shape: WidgetShape) => {
        describe.each(METRIC_WIDGET_TYPES)(
          "a %s widget",
          (componentType: DashboardComponentType) => {
            beforeEach(() => {
              dashboard.dashboardViewConfig = shape.store([
                buildWidget(componentType, SPEC),
              ]) as DashboardViewConfig;
            });

            it("charts its metric with its saved grouping, attribute filter and services, as stored as an object", async () => {
              await callWithAggregate(pageRequest(componentType));

              expect(nextFunction).not.toHaveBeenCalled();

              const args: JSONObject = getAggregateArgs();
              const query: JSONObject = args["query"] as JSONObject;

              expect(query["name"]).toBe(WIDGET_METRIC);
              expect(query["projectId"]).toBe(projectId);
              expect(query["attributes"]).toEqual({
                [WIDGET_FILTER_KEY]: "/pay",
              });
              expect(args["groupByAttributeKeys"]).toEqual([
                WIDGET_GROUP_BY_KEY,
              ]);

              if (servicesOf(componentType).length === 0) {
                expect(
                  Object.prototype.hasOwnProperty.call(
                    query,
                    "primaryEntityId",
                  ),
                ).toBe(false);
              } else {
                // As saved, the ObjectID JSON one read as its id.
                expect(query["primaryEntityId"]).toBeInstanceOf(Includes);
                expect((query["primaryEntityId"] as Includes).values).toEqual(
                  SPEC.serviceIds,
                );
              }
            });

            it("refuses a metric it does not chart", async () => {
              await callWithAggregate(
                pageRequest(componentType, {
                  query: { name: FOREIGN_METRIC },
                }),
              );

              expectRefused(METRIC_REFUSED);
            });

            it("refuses a grouping it does not save", async () => {
              await callWithAggregate(
                pageRequest(componentType, {
                  aggregateBy: { groupByAttributeKeys: [FOREIGN_KEY] },
                }),
              );

              expectRefused(ATTRIBUTE_REFUSED);
            });

            it("refuses a filter on a key it does not filter by", async () => {
              await callWithAggregate(
                pageRequest(componentType, {
                  query: { attributes: { [FOREIGN_KEY]: "a" } },
                }),
              );

              expectRefused(ATTRIBUTE_REFUSED);
            });

            it("refuses services it is not saved with", async () => {
              const requests: Array<unknown> =
                servicesOf(componentType).length === 0
                  ? [servicesFilter([API_SERVICE_ID])]
                  : [
                      undefined,
                      servicesFilter([API_SERVICE_ID]),
                      servicesFilter([
                        API_SERVICE_ID,
                        CHECKOUT_SERVICE_ID,
                        UNSAVED_SERVICE_ID,
                      ]),
                      servicesFilter([UNSAVED_SERVICE_ID]),
                    ];

              for (const requested of requests) {
                jest.clearAllMocks();

                const request: JSONObject = pageRequest(componentType);
                const query: JSONObject = request["query"] as JSONObject;

                delete query["primaryEntityId"];

                if (requested !== undefined) {
                  query["primaryEntityId"] = requested as JSONObject;
                }

                await callWithAggregate(request);

                expectRefused(PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE);
              }
            });

            it("is listed by /metric-types, with no metric it does not chart", async () => {
              expect(await callMetricTypes()).toEqual([WIDGET_METRIC]);
            });
          },
        );

        /*
         * A widget the public page does not draw asks for nothing, so it
         * unlocks nothing - in this shape as in any other.
         */
        describe("what the page does not draw stays unreadable", () => {
          const HIDDEN_TYPES: Array<[string, string]> = [
            ["a Data Source chart", DashboardComponentType.DataSourceChart],
            ["a Data Source table", DashboardComponentType.DataSourceTable],
            ["a removed type", "HostMetricChart"],
            ["a type spelt with spaces", " Chart "],
            ["a type spelt in lower case", "chart"],
            ["a widget that charts no metrics", DashboardComponentType.Text],
          ];

          it.each(HIDDEN_TYPES)(
            "%s holding a metric query",
            async (_label: string, componentType: string) => {
              dashboard.dashboardViewConfig = shape.store([
                buildWidget(componentType, SPEC),
              ]) as DashboardViewConfig;

              await callWithAggregate(
                pageRequest(DashboardComponentType.Chart),
              );
              expectRefused(METRIC_REFUSED);

              expect(await callMetricTypes()).toEqual([]);
            },
          );

          it("a metric widget's query kept outside its arguments, where the page never reads one", async () => {
            const widget: JSONObject = buildWidget(
              DashboardComponentType.Chart,
              SPEC,
            );
            const stray: JSONObject = {
              ...widget,
              metricQueryConfig: (widget["arguments"] as JSONObject)[
                "metricQueryConfig"
              ] as JSONObject,
            };

            delete stray["arguments"];

            dashboard.dashboardViewConfig = shape.store([
              stray,
            ]) as DashboardViewConfig;

            await callWithAggregate(pageRequest(DashboardComponentType.Chart));
            expectRefused(METRIC_REFUSED);
          });

          it("a chart of a type the page does not draw beside one it draws: neither its services nor its keys read", async () => {
            const hiddenSpec: WidgetSpec = {
              metricName: WIDGET_METRIC,
              groupByKey: FOREIGN_KEY,
              filterKey: "user.email",
              serviceIds: [UNSAVED_SERVICE_ID],
            };

            dashboard.dashboardViewConfig = shape.store([
              buildWidget(DashboardComponentType.DataSourceChart, hiddenSpec),
              buildWidget(DashboardComponentType.Chart, SPEC),
              buildWidget("HostMetricChart", hiddenSpec),
            ]) as DashboardViewConfig;

            // The drawn chart reads, as saved.
            await callWithAggregate(pageRequest(DashboardComponentType.Chart));
            expect(nextFunction).not.toHaveBeenCalled();

            // The others' grouping, filter key and services do not.
            const refusals: Array<[JSONObject, string]> = [
              [
                pageRequest(DashboardComponentType.Chart, {
                  aggregateBy: { groupByAttributeKeys: [FOREIGN_KEY] },
                }),
                ATTRIBUTE_REFUSED,
              ],
              [
                pageRequest(DashboardComponentType.Chart, {
                  query: { attributes: { "user.email": "a" } },
                }),
                ATTRIBUTE_REFUSED,
              ],
              [
                pageRequest(DashboardComponentType.Chart, {
                  query: {
                    primaryEntityId: servicesFilter([UNSAVED_SERVICE_ID]),
                  },
                }),
                PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
              ],
            ];

            for (const [request, message] of refusals) {
              jest.clearAllMocks();

              await callWithAggregate(request);

              expectRefused(message);
            }
          });

          it("a widget hidden inside another widget's settings", async () => {
            const nested: JSONObject = buildWidget(
              DashboardComponentType.Chart,
              SPEC,
            );

            dashboard.dashboardViewConfig = shape.store([
              {
                ...buildWidget(DashboardComponentType.Text, SPEC),
                arguments: { text: "Latency", widget: nested },
              },
            ]) as DashboardViewConfig;

            await callWithAggregate(pageRequest(DashboardComponentType.Chart));
            expectRefused(METRIC_REFUSED);
          });

          if (shape.unreadable) {
            it.each(shape.unreadable)(
              "the shape %s: read loosely by no reader, so read by none",
              async (_label: string, storeUnreadable: StoreFunction) => {
                dashboard.dashboardViewConfig = storeUnreadable([
                  buildWidget(DashboardComponentType.Chart, SPEC),
                ]) as DashboardViewConfig;

                await callWithAggregate(
                  pageRequest(DashboardComponentType.Chart),
                );
                expectRefused(METRIC_REFUSED);

                expect(await callMetricTypes()).toEqual([]);
              },
            );
          }
        });
      });

      /*
       * Issue #6327: a widget stored inside more layers of envelope or JSON
       * text than any board reads through is drawn as "This widget could
       * not be shown", signed in and on the public page alike, and served
       * as that alone. Its metric is read while every board reads the
       * widget, and refused past that. Before, the public page read five
       * layers more than the signed-in board, and these routes served the
       * metric of a chart in six to ten layers that the owner's own board
       * could not show.
       */
      describe("a widget stored deeper than any board reads (issue #6327)", () => {
        const envelopes: (widget: JSONObject, layers: number) => unknown = (
          widget: JSONObject,
          layers: number,
        ): unknown => {
          let entry: unknown = widget;

          for (let layer: number = 0; layer < layers; layer++) {
            entry =
              layer % 3 === 2
                ? { _type: "DashboardComponent", value: JSON.stringify(entry) }
                : { _type: "DashboardComponent", value: entry };
          }

          return entry;
        };

        it.each(METRIC_WIDGET_TYPES)(
          "a %s widget's metric is read while every board reads the widget, and refused past that",
          async (componentType: DashboardComponentType) => {
            for (let layers: number = 0; layers <= 12; layers++) {
              jest.clearAllMocks();

              dashboard.dashboardViewConfig = configOf([
                envelopes(buildWidget(componentType, SPEC), layers),
              ]) as unknown as DashboardViewConfig;

              await callWithAggregate(pageRequest(componentType));

              if (layers <= 5) {
                expect([
                  layers,
                  (nextFunction as jest.Mock).mock.calls,
                ]).toEqual([layers, []]);
                expect(
                  (getAggregateArgs()["query"] as JSONObject)["name"],
                ).toBe(WIDGET_METRIC);
                expect([layers, await callMetricTypes()]).toEqual([
                  layers,
                  [WIDGET_METRIC],
                ]);
              } else {
                const refusal: unknown = getThrownError();

                expect([
                  layers,
                  refusal instanceof BadDataException,
                  (refusal as Error).message,
                ]).toEqual([layers, true, METRIC_REFUSED]);
                expectNothingAggregated();
                expect([layers, await callMetricTypes()]).toEqual([layers, []]);
              }
            }
          },
        );

        it.each([...DataSourceComponentTypes])(
          "a %s widget holding a metric query is never read, at any depth",
          async (componentType: DashboardComponentType) => {
            for (let layers: number = 0; layers <= 30; layers++) {
              jest.clearAllMocks();

              dashboard.dashboardViewConfig = configOf([
                envelopes(buildWidget(componentType, SPEC), layers),
              ]) as unknown as DashboardViewConfig;

              await callWithAggregate(
                pageRequest(DashboardComponentType.Chart),
              );

              const refusal: unknown = getThrownError();

              expect([
                layers,
                refusal instanceof BadDataException,
                (refusal as Error).message,
              ]).toEqual([layers, true, METRIC_REFUSED]);
              expectNothingAggregated();
              expect([layers, await callMetricTypes()]).toEqual([layers, []]);
            }
          },
        );
      });

      /*
       * PROPERTY: THE ALLOWLISTS ARE EXACTLY WHAT THE PUBLIC PAGE DRAWS.
       *
       * Seeded dashboards of several widgets, each of a metric widget type
       * or of one the page does not draw, each stored in a shape of its own
       * - an object, JSON text, either envelope, its arguments as text, a
       * layer of each - and now and then encoded once more or cut short, in
       * a widget list now and then written as text itself, between junk
       * entries, in a config stored as an object, as text or in its
       * envelope. Each widget has a metric, grouping, filter key and
       * services of its own; now and then a widget the page does not draw
       * names a drawn one's metric with keys and services of its own.
       *
       * The answer is worked out from what was generated alone, checked
       * against what the public page draws - the config /view-config
       * serves, sent as JSON, read as the page reads it - and then every
       * metric, key, column and set of services is asked for, on both
       * routes.
       */
      describe("property: the allowlists are exactly what the public page draws", () => {
        type Visibility =
          | "drawn"
          | "a Data Source widget"
          | "a type the page does not draw"
          | "a widget that charts no metrics"
          | "encoded twice"
          | "cut short";

        interface GeneratedWidget {
          componentType: string;
          spec: WidgetSpec;
          groupsByAttributes: boolean;
          visibility: Visibility;
        }

        const SERVICES: Array<string> = [
          API_SERVICE_ID,
          CHECKOUT_SERVICE_ID,
          UNSAVED_SERVICE_ID,
        ];

        const HIDDEN: Array<Visibility> = [
          "a Data Source widget",
          "a type the page does not draw",
          "a widget that charts no metrics",
          "encoded twice",
          "cut short",
        ];

        type WidgetOfFunction = (generated: GeneratedWidget) => JSONObject;

        // The widget as the editor saves it, its type as generated.
        const widgetOf: WidgetOfFunction = (
          generated: GeneratedWidget,
        ): JSONObject => {
          const componentType: string =
            generated.visibility === "a Data Source widget"
              ? DashboardComponentType.DataSourceChart
              : generated.visibility === "a type the page does not draw"
                ? "HostMetricChart"
                : generated.visibility === "a widget that charts no metrics"
                  ? DashboardComponentType.Text
                  : generated.componentType;

          const widget: JSONObject = buildWidget(componentType, generated.spec);

          if (generated.groupsByAttributes) {
            const widgetArguments: JSONObject = widget[
              "arguments"
            ] as JSONObject;
            const queryConfig: JSONObject | undefined = widgetArguments[
              "metricQueryConfig"
            ] as JSONObject | undefined;

            if (queryConfig) {
              (queryConfig["metricQueryData"] as JSONObject)["groupBy"] = {
                attributes: true,
              };
            } else {
              widgetArguments["groupBy"] = { attributes: true };
            }
          }

          return widget;
        };

        type EntryOfFunction = (
          generated: GeneratedWidget,
          random: SeededRandom,
        ) => unknown;

        // The widget as one entry of the stored list, in a shape of its own.
        const entryOf: EntryOfFunction = (
          generated: GeneratedWidget,
          random: SeededRandom,
        ): unknown => {
          const widget: JSONObject = widgetOf(generated);
          const text: string = JSON.stringify(widget);
          const argumentsText: string = JSON.stringify(widget["arguments"]);

          if (generated.visibility === "encoded twice") {
            return [
              JSON.stringify(text),
              { _type: "DashboardComponent", value: JSON.stringify(text) },
              { ...widget, arguments: JSON.stringify(argumentsText) },
            ][random(3)];
          }

          if (generated.visibility === "cut short") {
            return [
              cutShort(text),
              { _type: "DashboardComponent", value: cutShort(text) },
              { ...widget, arguments: cutShort(argumentsText) },
            ][random(3)];
          }

          return [
            widget,
            text,
            { _type: "DashboardComponent", value: widget },
            { _type: "DashboardComponent", value: text },
            { ...widget, arguments: argumentsText },
            JSON.stringify({ _type: "DashboardComponent", value: text }),
            JSON.stringify({ ...widget, arguments: argumentsText }),
          ][random(7)];
        };

        type StoreConfigFunction = (
          config: JSONObject,
          random: SeededRandom,
        ) => unknown;

        // The whole config, as an object, as text or in its envelope.
        const storeConfig: StoreConfigFunction = (
          config: JSONObject,
          random: SeededRandom,
        ): unknown => {
          return [
            config,
            JSON.stringify(config),
            { _type: "DashboardViewConfig", value: config },
            JSON.stringify({ _type: "DashboardViewConfig", value: config }),
          ][random(4)];
        };

        type PageDrawsFunction = (stored: unknown) => Array<string>;

        /*
         * The metrics of the metric widgets the public page draws: what
         * /view-config serves, sent as JSON, read as the page reads it. A
         * metric widget it draws with no query - its arguments unreadable -
         * charts nothing.
         */
        const metricsThePageDraws: PageDrawsFunction = (
          stored: unknown,
        ): Array<string> => {
          const served: unknown = JSON.parse(
            JSON.stringify(
              JSONFunctions.serialize(
                PublicDashboardViewConfig.sanitize(
                  stored as DashboardViewConfig,
                ) as unknown as JSONObject,
              ),
            ),
          );

          const metricNames: Array<string> = [];

          for (const component of StoredDashboardViewConfig.read(served)
            .components) {
            if (!METRIC_WIDGET_TYPES.includes(component.componentType)) {
              continue;
            }

            const widgetArguments: JSONObject = (component.arguments ||
              {}) as JSONObject;
            const columns: unknown = widgetArguments["columns"];
            const queryData: JSONObject | undefined = (
              widgetArguments["metricQueryConfig"] as JSONObject | undefined
            )?.["metricQueryData"] as JSONObject | undefined;
            const metricName: unknown = Array.isArray(columns)
              ? (columns[0] as JSONObject | undefined)?.["metricName"]
              : (queryData?.["filterData"] as JSONObject | undefined)?.[
                  "metricName"
                ];

            if (typeof metricName === "string") {
              metricNames.push(metricName);
            }
          }

          return metricNames.sort();
        };

        type AnsweredFunction = () => boolean;

        // Whether the last request was read, or refused - and nothing else.
        const answered: AnsweredFunction = (): boolean => {
          const refusals: Array<Array<unknown>> = (nextFunction as jest.Mock)
            .mock.calls as Array<Array<unknown>>;

          if (refusals.length === 0) {
            expect(MetricService.aggregateBy).toHaveBeenCalledTimes(1);
            return true;
          }

          expect(refusals.length).toBe(1);
          expect(refusals[0]![0]).toBeInstanceOf(BadDataException);
          expectNothingAggregated();
          return false;
        };

        type AskFunction = (aggregateBy: JSONObject) => Promise<boolean>;

        const ask: AskFunction = async (
          aggregateBy: JSONObject,
        ): Promise<boolean> => {
          jest.clearAllMocks();
          await callWithAggregate(aggregateBy);
          return answered();
        };

        type ServiceQueryFunction = (serviceIds: Array<string>) => JSONObject;

        // A query's services as the page sends them: none for every service.
        const serviceQuery: ServiceQueryFunction = (
          serviceIds: Array<string>,
        ): JSONObject => {
          return serviceIds.length > 0
            ? { primaryEntityId: servicesFilter(serviceIds) }
            : {};
        };

        const isSameSet: (a: Array<string>, b: Array<string>) => boolean = (
          a: Array<string>,
          b: Array<string>,
        ): boolean => {
          return (
            a.length === b.length &&
            a.every((value: string): boolean => {
              return b.includes(value);
            })
          );
        };

        test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
          "seed %i",
          async (seed: number) => {
            const random: SeededRandom = seededRandom(6297 + seed);
            const generated: Array<GeneratedWidget> = [];

            const widgetCount: number = 2 + random(5);

            for (let index: number = 0; index < widgetCount; index++) {
              const componentType: DashboardComponentType =
                METRIC_WIDGET_TYPES[random(METRIC_WIDGET_TYPES.length)]!;
              const serviceIds: Array<string> =
                componentType === DashboardComponentType.Table ||
                random(3) === 0
                  ? []
                  : shuffled(SERVICES, random).slice(0, 1 + random(2));

              const widget: GeneratedWidget = {
                componentType: componentType,
                spec: {
                  metricName: `metric.${seed}.${index}`,
                  groupByKey: `group.${index}`,
                  filterKey: `filter.${index}`,
                  serviceIds: serviceIds,
                },
                groupsByAttributes: random(4) === 0,
                visibility:
                  random(3) === 0 ? HIDDEN[random(HIDDEN.length)]! : "drawn",
              };

              generated.push(widget);

              // Now and then a hidden widget of the same metric, keys its own.
              if (random(3) === 0) {
                generated.push({
                  componentType: DashboardComponentType.Chart,
                  spec: {
                    metricName: widget.spec.metricName,
                    groupByKey: `shadow.group.${index}`,
                    filterKey: `shadow.filter.${index}`,
                    serviceIds: [UNSAVED_SERVICE_ID],
                  },
                  groupsByAttributes: random(2) === 0,
                  visibility: HIDDEN[random(HIDDEN.length)]!,
                });
              }
            }

            const order: Array<GeneratedWidget> = shuffled(generated, random);
            const entries: Array<unknown> = [];

            for (const widget of order) {
              if (random(4) === 0) {
                entries.push([null, 7, "junk", [], "{"][random(5)]);
              }

              entries.push(entryOf(widget, random));
            }

            const variableKeys: Array<string> = [];
            const variables: Array<JSONObject> = [];

            for (let index: number = 0; index < random(3); index++) {
              variableKeys.push(`variable.${seed}.${index}`);
              variables.push({
                id: ObjectID.generate().toString(),
                name: `variable-${index}`,
                type: DashboardVariableType.TelemetryAttribute,
                attributeKey: `variable.${seed}.${index}`,
              });
            }

            const config: JSONObject = {
              _type: "DashboardViewConfig",
              heightInDashboardUnits: 24,
              components: (random(4) === 0
                ? JSON.stringify(entries)
                : entries) as JSONValue,
              variables: (random(3) === 0
                ? JSON.stringify(variables)
                : variables) as JSONValue,
              // Read by no toolbar: a variable's shape where no variable is.
              hiddenVariables: [
                {
                  type: DashboardVariableType.TelemetryAttribute,
                  attributeKey: "hidden.variable",
                },
              ],
            };

            const stored: unknown = storeConfig(config, random);

            dashboard.dashboardViewConfig = stored as DashboardViewConfig;

            // The answer, from what was generated alone.
            const drawn: Array<GeneratedWidget> = generated.filter(
              (widget: GeneratedWidget): boolean => {
                return widget.visibility === "drawn";
              },
            );
            const drawnMetrics: Array<string> = Array.from(
              new Set(
                drawn.map((widget: GeneratedWidget): string => {
                  return widget.spec.metricName;
                }),
              ),
            ).sort();
            const groupKeys: Set<string> = new Set(
              drawn.map((widget: GeneratedWidget): string => {
                return widget.spec.groupByKey;
              }),
            );
            const filterKeys: Set<string> = new Set([
              ...drawn.map((widget: GeneratedWidget): string => {
                return widget.spec.filterKey;
              }),
              ...variableKeys,
            ]);
            /*
             * A widget's `groupBy` counts where the page reads it, in one of
             * its queries. A table here has none: its `groupBy` is put beside
             * its settings, where no board reads it, so a public dashboard
             * does not serve it (issue #6338), and no route reads it either.
             */
            const groupsByAttributes: boolean = drawn.some(
              (widget: GeneratedWidget): boolean => {
                return (
                  widget.groupsByAttributes &&
                  widget.componentType !== DashboardComponentType.Table
                );
              },
            );

            const context: string = `seed ${seed}`;

            // ...which is what the public page draws.
            expect([context, metricsThePageDraws(stored)]).toEqual([
              context,
              drawn
                .map((widget: GeneratedWidget): string => {
                  return widget.spec.metricName;
                })
                .sort(),
            ]);

            let read: number = 0;
            let refused: number = 0;

            const tally: (wasRead: boolean) => void = (
              wasRead: boolean,
            ): void => {
              if (wasRead) {
                read++;
              } else {
                refused++;
              }
            };

            // Every metric: read for a drawn widget's services, else never.
            for (const metricName of [
              ...generated.map((widget: GeneratedWidget): string => {
                return widget.spec.metricName;
              }),
              FOREIGN_METRIC,
            ]) {
              const drawnOfMetric: GeneratedWidget | undefined = drawn.find(
                (widget: GeneratedWidget): boolean => {
                  return widget.spec.metricName === metricName;
                },
              );
              const anyOfMetric: GeneratedWidget | undefined = generated.find(
                (widget: GeneratedWidget): boolean => {
                  return widget.spec.metricName === metricName;
                },
              );
              const serviceIds: Array<string> =
                (drawnOfMetric || anyOfMetric)?.spec.serviceIds || [];

              const wasRead: boolean = await ask({
                query: { name: metricName, ...serviceQuery(serviceIds) },
              });

              expect([context, metricName, wasRead]).toEqual([
                context,
                metricName,
                drawnMetrics.includes(metricName),
              ]);
              tally(wasRead);
            }

            const first: GeneratedWidget | undefined = drawn[0];

            if (first) {
              const firstQuery: JSONObject = {
                name: first.spec.metricName,
                ...serviceQuery(first.spec.serviceIds),
              };

              // Every grouping key generated, and one nobody saves.
              for (const groupKey of [
                ...generated.map((widget: GeneratedWidget): string => {
                  return widget.spec.groupByKey;
                }),
                FOREIGN_KEY,
              ]) {
                const wasRead: boolean = await ask({
                  query: firstQuery,
                  groupByAttributeKeys: [groupKey],
                });

                expect([context, groupKey, wasRead]).toEqual([
                  context,
                  groupKey,
                  groupKeys.has(groupKey),
                ]);
                tally(wasRead);
              }

              // Every filter key generated, the variables', and the hidden one.
              for (const filterKey of [
                ...generated.map((widget: GeneratedWidget): string => {
                  return widget.spec.filterKey;
                }),
                ...variableKeys,
                "hidden.variable",
                FOREIGN_KEY,
              ]) {
                const wasRead: boolean = await ask({
                  query: { ...firstQuery, attributes: { [filterKey]: "v" } },
                });

                expect([context, filterKey, wasRead]).toEqual([
                  context,
                  filterKey,
                  filterKeys.has(filterKey),
                ]);
                tally(wasRead);
              }

              // The whole attribute map, only when a drawn widget groups so.
              const groupedWhole: boolean = await ask({
                query: firstQuery,
                groupBy: { attributes: true },
              });

              expect([context, "groupBy attributes", groupedWhole]).toEqual([
                context,
                "groupBy attributes",
                groupsByAttributes,
              ]);
              tally(groupedWhole);
            }

            // Every drawn metric, for every set of services anyone saves.
            const candidateSets: Array<Array<string>> = [
              [],
              [UNSAVED_SERVICE_ID],
              ...generated.map((widget: GeneratedWidget): Array<string> => {
                return widget.spec.serviceIds;
              }),
            ];

            for (const metricName of drawnMetrics) {
              const savedSets: Array<Array<string>> = drawn
                .filter((widget: GeneratedWidget): boolean => {
                  return widget.spec.metricName === metricName;
                })
                .map((widget: GeneratedWidget): Array<string> => {
                  return widget.spec.serviceIds;
                });

              for (const serviceIds of candidateSets) {
                const wasRead: boolean = await ask({
                  query: {
                    name: metricName,
                    ...serviceQuery(shuffled(serviceIds, random)),
                  },
                });

                expect([context, metricName, serviceIds, wasRead]).toEqual([
                  context,
                  metricName,
                  serviceIds,
                  savedSets.some((savedSet: Array<string>): boolean => {
                    return isSameSet(savedSet, serviceIds);
                  }),
                ]);
                tally(wasRead);
              }
            }

            // /metric-types lists the drawn metrics, of all the project has.
            jest.spyOn(MetricTypeService, "findBy").mockResolvedValue(
              Array.from(
                new Set([
                  ...generated.map((widget: GeneratedWidget): string => {
                    return widget.spec.metricName;
                  }),
                  FOREIGN_METRIC,
                ]),
              ).map((name: string): MetricType => {
                const metricType: MetricType = new MetricType();
                metricType.name = name;
                return metricType;
              }),
            );

            expect([context, (await callMetricTypes()).sort()]).toEqual([
              context,
              drawnMetrics,
            ]);

            // The sweep tried both answers.
            expect(refused).toBeGreaterThan(0);

            if (first) {
              expect(read).toBeGreaterThan(0);
            }
          },
        );
      });
    });
  });
});
