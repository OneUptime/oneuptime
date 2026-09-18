import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import MetricService from "../../../Server/Services/MetricService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
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
  };

  type BuildViewConfigFunction = (
    widgets: Array<MetricWidgetSpec>,
    variableAttributeKeys?: Array<string> | undefined,
  ) => DashboardViewConfig;

  /*
   * A stored chart widget, shaped the way the canvas persists it: the query
   * lives under `arguments.metricQueryConfigs[].metricQueryData`.
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
            componentType: DashboardComponentType.Chart,
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

    it("drops every other client-supplied query key", async () => {
      await callWithAggregate({
        query: {
          name: CHARTED_METRIC_NAME,
          serviceId: ObjectID.generate().toString(),
          primaryEntityId: "smuggled",
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
      const shapes: Array<{ label: string; config: JSONObject }> = [
        {
          label: "table widget groupByAttributes",
          config: {
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
});
