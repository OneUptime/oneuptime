import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DashboardComponentType, {
  DataSourceComponentTypes,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
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

/*
 * PublicDashboardViewConfig.sanitize() strips the external Data Source
 * widgets out of the dashboard config served to ANONYMOUS public-dashboard
 * viewers, and it has thorough unit coverage of its own. What that unit
 * coverage structurally cannot see is a PUBLIC ROUTE THAT FORGETS TO CALL IT
 * — and the call sites are the whole of the protection.
 *
 * That is the leak these tests exist to prevent. A Data Source widget's
 * stored config IS the query: raw SQL naming internal tables and columns,
 * PromQL naming internal jobs and instances, plus the id of the connected
 * Data Source. The client already refuses to render those widgets publicly
 * (it draws a placeholder), so dropping them costs the viewer nothing; but
 * a route that serves `dashboard.dashboardViewConfig` straight from the
 * column publishes the query text to anyone who opens the page and reads
 * the API response — no authentication, no master password, no trace.
 *
 * Two handlers in Common/Server/API/DashboardAPI.ts read the stored config
 * for anonymous viewers, and both are covered here:
 *   - /overview/:dashboardIdOrDomain (POST and GET share one handler)
 *   - /view-config/:dashboardId
 *
 * The tests assert on the RESPONSE BODY rather than on the sanitizer being
 * called, so they hold whichever way the strip is implemented, and they are
 * driven off DataSourceComponentTypes so a fifth widget type added later is
 * covered on both routes the day it is added.
 */

const OVERVIEW_ROUTE: string = "/dashboard/overview/:dashboardIdOrDomain";

const VIEW_CONFIG_ROUTE: string = "/dashboard/view-config/:dashboardId";

/*
 * Distinctive strings that only ever live inside a Data Source widget. Any
 * one of them turning up in a public response body is the leak itself.
 */
const CHART_QUERY_SECRET: string =
  "SELECT token FROM internal_billing_accounts";

const TABLE_QUERY_SECRET: string =
  "SELECT email, card_last4 FROM internal_customer_ledger";

const LEGEND_SECRET: string = "{{customer_email}}";

const DATA_SOURCE_ID_SECRET: string = "ds-internal-warehouse-9f21";

const DATA_SOURCE_TITLE_SECRET: string = "Internal billing revenue by tenant";

const DATA_SOURCE_SECRETS: Array<string> = [
  CHART_QUERY_SECRET,
  TABLE_QUERY_SECRET,
  LEGEND_SECRET,
  DATA_SOURCE_ID_SECRET,
  DATA_SOURCE_TITLE_SECRET,
];

// Everything an anonymous viewer is still supposed to receive.
const PUBLIC_CHART_TITLE: string = "Public CPU";

const PUBLIC_METRIC_NAME: string = "system.cpu.utilization";

const PUBLIC_TEXT: string = "Status of the public service";

type PublicConfigRoute = {
  name: string;
  method: string;
  uri: string;
  idParamName: string;
  // Only the overview endpoint reshapes the config into widget summaries.
  servesComponentSummaries: boolean;
};

const PUBLIC_CONFIG_ROUTES: Array<PublicConfigRoute> = [
  {
    name: "POST /dashboard/overview/:dashboardIdOrDomain",
    method: "post",
    uri: OVERVIEW_ROUTE,
    idParamName: "dashboardIdOrDomain",
    servesComponentSummaries: true,
  },
  {
    name: "GET /dashboard/overview/:dashboardIdOrDomain",
    method: "get",
    uri: OVERVIEW_ROUTE,
    idParamName: "dashboardIdOrDomain",
    servesComponentSummaries: true,
  },
  {
    name: "POST /dashboard/view-config/:dashboardId",
    method: "post",
    uri: VIEW_CONFIG_ROUTE,
    idParamName: "dashboardId",
    servesComponentSummaries: false,
  },
];

const OVERVIEW_ROUTES: Array<PublicConfigRoute> = PUBLIC_CONFIG_ROUTES.filter(
  (route: PublicConfigRoute): boolean => {
    return route.servesComponentSummaries;
  },
);

type StripCase = {
  routeName: string;
  componentType: DashboardComponentType;
  route: PublicConfigRoute;
};

/*
 * One case per Data Source widget type, per public route. Driven off
 * DataSourceComponentTypes rather than a hand-written list so a fifth type
 * is exercised on every route from the moment it is added to the enum.
 */
const STRIP_CASES: Array<StripCase> = PUBLIC_CONFIG_ROUTES.flatMap(
  (route: PublicConfigRoute): Array<StripCase> => {
    return DataSourceComponentTypes.map(
      (componentType: DashboardComponentType): StripCase => {
        return {
          routeName: route.name,
          componentType: componentType,
          route: route,
        };
      },
    );
  },
);

describe("DashboardAPI public Data Source strip", () => {
  let dashboardId: ObjectID;
  let dashboard: Dashboard;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  type BuiltWidget = {
    componentId: string;
    widget: JSONObject;
  };

  type BuildWidgetFunction = (
    componentType: DashboardComponentType,
    argumentsObject?: JSONObject,
  ) => BuiltWidget;

  const buildWidget: BuildWidgetFunction = (
    componentType: DashboardComponentType,
    argumentsObject?: JSONObject,
  ): BuiltWidget => {
    const componentId: string = ObjectID.generate().toString();

    return {
      componentId: componentId,
      widget: {
        _type: "DashboardComponent",
        componentId: componentId,
        componentType: componentType,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 12,
        heightInDashboardUnits: 6,
        minWidthInDashboardUnits: 1,
        minHeightInDashboardUnits: 1,
        arguments: argumentsObject || {},
      },
    };
  };

  type SetDashboardWidgetsFunction = (widgets: Array<JSONObject>) => void;

  const setDashboardWidgets: SetDashboardWidgetsFunction = (
    widgets: Array<JSONObject>,
  ): void => {
    dashboard.dashboardViewConfig = {
      _type: "DashboardViewConfig",
      heightInDashboardUnits: 24,
      components: widgets,
    } as unknown as DashboardViewConfig;
  };

  type LeakyDashboard = {
    publicComponentIds: Array<string>;
    dataSourceComponentIds: Array<string>;
  };

  /*
   * A realistic public dashboard: two widgets an anonymous viewer may keep
   * seeing, interleaved with two Data Source widgets whose stored config
   * carries the raw query text, the legend template, and the id of the
   * connected Data Source.
   */
  type SetLeakyDashboardFunction = () => LeakyDashboard;

  const setLeakyDashboard: SetLeakyDashboardFunction = (): LeakyDashboard => {
    const metricChart: BuiltWidget = buildWidget(DashboardComponentType.Chart, {
      chartTitle: PUBLIC_CHART_TITLE,
      metricQueryConfigs: [
        {
          metricQueryData: {
            filterData: { metricName: PUBLIC_METRIC_NAME },
          },
        },
      ],
    });

    const text: BuiltWidget = buildWidget(DashboardComponentType.Text, {
      text: PUBLIC_TEXT,
    });

    const dataSourceChart: BuiltWidget = buildWidget(
      DashboardComponentType.DataSourceChart,
      {
        chartTitle: DATA_SOURCE_TITLE_SECRET,
        queries: [
          {
            id: "query-1",
            dataSourceId: DATA_SOURCE_ID_SECRET,
            query: CHART_QUERY_SECRET,
            legend: LEGEND_SECRET,
          },
        ],
      },
    );

    const dataSourceTable: BuiltWidget = buildWidget(
      DashboardComponentType.DataSourceTable,
      {
        maxRows: 25,
        query: {
          dataSourceId: DATA_SOURCE_ID_SECRET,
          query: TABLE_QUERY_SECRET,
        },
      },
    );

    setDashboardWidgets([
      metricChart.widget,
      dataSourceChart.widget,
      text.widget,
      dataSourceTable.widget,
    ]);

    return {
      publicComponentIds: [metricChart.componentId, text.componentId],
      dataSourceComponentIds: [
        dataSourceChart.componentId,
        dataSourceTable.componentId,
      ],
    };
  };

  type CallRouteFunction = (route: PublicConfigRoute) => Promise<void>;

  const callRoute: CallRouteFunction = async (
    route: PublicConfigRoute,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        [route.idParamName]: dashboardId.toString(),
      },
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match(route.method, route.uri)
      .handlerFunction(request, mockResponse, nextFunction);
  };

  type GetResponseBodyFunction = () => JSONObject;

  const getResponseBody: GetResponseBodyFunction = (): JSONObject => {
    expect(nextFunction).not.toHaveBeenCalled();

    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);

    return calls[0]![2] as JSONObject;
  };

  type GetServedComponentsFunction = (body: JSONObject) => Array<JSONObject>;

  const getServedComponents: GetServedComponentsFunction = (
    body: JSONObject,
  ): Array<JSONObject> => {
    const servedConfig: JSONObject | null = body[
      "dashboardViewConfig"
    ] as JSONObject | null;

    expect(servedConfig).not.toBeNull();

    return (servedConfig!["components"] || []) as unknown as Array<JSONObject>;
  };

  type ComponentIdsOfFunction = (
    components: Array<JSONObject>,
  ) => Array<string>;

  const componentIdsOf: ComponentIdsOfFunction = (
    components: Array<JSONObject>,
  ): Array<string> => {
    return components.map((component: JSONObject): string => {
      return String(component["componentId"]);
    });
  };

  type ComponentTypesOfFunction = (
    components: Array<JSONObject>,
  ) => Array<string>;

  const componentTypesOf: ComponentTypesOfFunction = (
    components: Array<JSONObject>,
  ): Array<string> => {
    return components.map((component: JSONObject): string => {
      return String(component["componentType"]);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();

    dashboard = new Dashboard();
    dashboard.id = dashboardId;
    dashboard.projectId = ObjectID.generate();
    dashboard.isPublicDashboard = true;
    dashboard.enableMasterPassword = false;
    dashboard.name = "Public Dashboard";
    setDashboardWidgets([]);

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);

    /*
     * PublicDashboardViewConfig.sanitize is deliberately NOT stubbed. The
     * whole point of this file is that the routes CALL it — a stub would
     * make every assertion below pass against a handler that forgot to.
     */

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

  describe("query text never reaches an anonymous viewer", () => {
    it.each(PUBLIC_CONFIG_ROUTES)(
      "$name serves the public widgets and none of the Data Source config",
      async (route: PublicConfigRoute) => {
        const built: LeakyDashboard = setLeakyDashboard();

        /*
         * Guard against a vacuous test: the STORED config really does carry
         * every secret, so `not.toContain` below can only pass because the
         * route stripped the widgets.
         */
        const storedConfig: string = JSON.stringify(
          dashboard.dashboardViewConfig,
        );

        for (const secret of DATA_SOURCE_SECRETS) {
          expect(storedConfig).toContain(secret);
        }

        await callRoute(route);

        const body: JSONObject = getResponseBody();
        const servedBody: string = JSON.stringify(body);

        for (const secret of DATA_SOURCE_SECRETS) {
          expect(servedBody).not.toContain(secret);
        }

        for (const componentId of built.dataSourceComponentIds) {
          expect(servedBody).not.toContain(componentId);
        }

        // ...and the widgets a public viewer can render are untouched.
        expect(componentIdsOf(getServedComponents(body))).toEqual(
          built.publicComponentIds,
        );
        expect(componentTypesOf(getServedComponents(body))).toEqual([
          DashboardComponentType.Chart,
          DashboardComponentType.Text,
        ]);
        expect(servedBody).toContain(PUBLIC_CHART_TITLE);
        expect(servedBody).toContain(PUBLIC_TEXT);
      },
    );

    it.each(PUBLIC_CONFIG_ROUTES)(
      "$name never serves the connected Data Source id, even with nothing to hide behind",
      async (route: PublicConfigRoute) => {
        /*
         * dataSourceId is the one field a field-stripping (rather than
         * widget-dropping) implementation is most likely to keep: it is not
         * query text, it just points at the connected source. It still tells
         * an anonymous viewer which internal Data Source records exist.
         */
        const dataSourceValue: BuiltWidget = buildWidget(
          DashboardComponentType.DataSourceValue,
          {
            query: {
              dataSourceId: DATA_SOURCE_ID_SECRET,
              query: CHART_QUERY_SECRET,
            },
          },
        );

        setDashboardWidgets([dataSourceValue.widget]);

        await callRoute(route);

        const body: JSONObject = getResponseBody();

        expect(JSON.stringify(body)).not.toContain(DATA_SOURCE_ID_SECRET);
        expect(getServedComponents(body)).toEqual([]);
      },
    );

    it.each(STRIP_CASES)(
      "$routeName drops a $componentType widget and its stored query",
      async (stripCase: StripCase) => {
        const publicWidget: BuiltWidget = buildWidget(
          DashboardComponentType.Value,
          { title: PUBLIC_CHART_TITLE },
        );

        const querySecret: string = `SELECT secret FROM internal_${stripCase.componentType}_rows`;

        /*
         * Both persisted shapes at once: the chart widget stores an array of
         * queries, the value/gauge/table widgets store a single one. A widget
         * type added later gets whichever of the two it uses covered here.
         */
        const dataSourceWidget: BuiltWidget = buildWidget(
          stripCase.componentType,
          {
            chartTitle: DATA_SOURCE_TITLE_SECRET,
            query: {
              dataSourceId: DATA_SOURCE_ID_SECRET,
              query: querySecret,
            },
            queries: [
              {
                id: "query-1",
                dataSourceId: DATA_SOURCE_ID_SECRET,
                query: querySecret,
              },
            ],
          },
        );

        setDashboardWidgets([publicWidget.widget, dataSourceWidget.widget]);

        await callRoute(stripCase.route);

        const body: JSONObject = getResponseBody();
        const servedBody: string = JSON.stringify(body);

        expect(servedBody).not.toContain(querySecret);
        expect(servedBody).not.toContain(DATA_SOURCE_ID_SECRET);
        expect(servedBody).not.toContain(DATA_SOURCE_TITLE_SECRET);
        expect(servedBody).not.toContain(stripCase.componentType);
        expect(componentIdsOf(getServedComponents(body))).toEqual([
          publicWidget.componentId,
        ]);
      },
    );
  });

  describe("the public routes agree with each other", () => {
    it("serves the identical surviving widget set from every public route", async () => {
      /*
       * One stored config in, one set of widget ids out — whichever public
       * route the viewer reaches for. A route that skipped the strip would
       * show up here as a wider set than its siblings, even if the secrets
       * themselves were renamed out from under the assertions above.
       */
      const built: LeakyDashboard = setLeakyDashboard();

      type RouteResult = {
        route: string;
        componentIds: Array<string>;
      };

      const results: Array<RouteResult> = [];

      for (const route of PUBLIC_CONFIG_ROUTES) {
        jest.clearAllMocks();

        await callRoute(route);

        results.push({
          route: route.name,
          componentIds: componentIdsOf(getServedComponents(getResponseBody())),
        });
      }

      expect(results).toEqual(
        PUBLIC_CONFIG_ROUTES.map((route: PublicConfigRoute): RouteResult => {
          return {
            route: route.name,
            componentIds: built.publicComponentIds,
          };
        }),
      );
    });

    it("registers one shared handler for both overview methods", () => {
      /*
       * POST and GET are registered with the same handler function on
       * purpose, so the strip can never drift between the two methods. If
       * they are ever split into separate handlers, this fails and the
       * per-method cases above become load-bearing rather than redundant.
       */
      expect(mockRouter.match("post", OVERVIEW_ROUTE).handlerFunction).toBe(
        mockRouter.match("get", OVERVIEW_ROUTE).handlerFunction,
      );
    });
  });

  describe("overview summaries are built from the sanitized config", () => {
    it.each(OVERVIEW_ROUTES)(
      "$name summarises only the widgets that survived the strip",
      async (route: PublicConfigRoute) => {
        /*
         * The overview endpoint does not only echo the config: it also
         * reshapes it into `components` summaries and a `metricsUsed` list.
         * Both must be derived from the SANITIZED config — a summary built
         * from the stored column would republish the Data Source widget's
         * title and every metric name buried in its query config.
         */
        setLeakyDashboard();

        await callRoute(route);

        const body: JSONObject = getResponseBody();
        const summaries: Array<JSONObject> = body[
          "components"
        ] as unknown as Array<JSONObject>;

        expect(componentTypesOf(summaries)).toEqual([
          DashboardComponentType.Chart,
          DashboardComponentType.Text,
        ]);
        expect(body["metricsUsed"]).toEqual([PUBLIC_METRIC_NAME]);
      },
    );
  });

  describe("an absent stored config stays null", () => {
    it.each(PUBLIC_CONFIG_ROUTES)(
      "$name serves dashboardViewConfig null rather than an empty object",
      async (route: PublicConfigRoute) => {
        /*
         * Load-bearing for the public page, not just for tidiness.
         * App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx
         * does `response.data["dashboardViewConfig"] || createDefaultDashboardViewConfig()`.
         * JSONFunctions.serialize(null) returns `{}`, which is truthy — it
         * would sail past the fallback and the canvas would then read
         * `.components.length` off undefined and throw.
         */
        const absentConfigs: Array<DashboardViewConfig | null | undefined> = [
          null,
          undefined,
        ];

        for (const absentConfig of absentConfigs) {
          jest.clearAllMocks();

          dashboard.dashboardViewConfig =
            absentConfig as unknown as DashboardViewConfig;

          await callRoute(route);

          const body: JSONObject = getResponseBody();

          expect(
            Object.prototype.hasOwnProperty.call(body, "dashboardViewConfig"),
          ).toBe(true);
          expect(body["dashboardViewConfig"]).toBeNull();
          expect(body["dashboardViewConfig"]).not.toEqual({});
        }
      },
    );

    it.each(PUBLIC_CONFIG_ROUTES)(
      "$name serves an empty component list, not null, once a config exists",
      async (route: PublicConfigRoute) => {
        /*
         * The opposite side of the same line: a dashboard whose only widget
         * is a Data Source widget still HAS a stored config, so the viewer
         * must get a real config with zero components — not the null that
         * means "nothing was ever stored".
         */
        const dataSourceGauge: BuiltWidget = buildWidget(
          DashboardComponentType.DataSourceGauge,
          {
            query: {
              dataSourceId: DATA_SOURCE_ID_SECRET,
              query: CHART_QUERY_SECRET,
            },
          },
        );

        setDashboardWidgets([dataSourceGauge.widget]);

        await callRoute(route);

        const body: JSONObject = getResponseBody();

        expect(body["dashboardViewConfig"]).not.toBeNull();
        expect(getServedComponents(body)).toEqual([]);
      },
    );
  });
});
