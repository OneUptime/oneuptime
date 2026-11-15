import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { mockRouter } from "../../Server/API/Helpers";

/*
 * ISSUE #6280: A PUBLIC DASHBOARD'S CHART READS WHAT THE SIGNED-IN ONE READS.
 *
 * A chart saved with a service filter (#6266) charted every service on the
 * public dashboard: the public metrics endpoint rebuilt each query from an
 * allowlist of fields and dropped the filter. These tests run the whole
 * read on both sides with the production code:
 *
 *   Add to dashboard saves an explorer view as a chart (MetricExplorerUrl,
 *   MetricConfigReconstruct, the dashboard utils), as the JSON column keeps
 *   it. Signed in, the dashboard draws the stored config and the chart's
 *   reads go to the private analytics API. On the public page the config
 *   is the one /view-config serves, and the same chart code's reads go
 *   through the public dashboard's context to the real public route
 *   (DashboardAPI), as JSON, and on to the metric store.
 *
 * What reaches the store must be the same query on both sides - its
 * services above all - for every chart. A field the public route drops or
 * rewrites, now or later, shows here as a difference.
 */

const mockAnalyticsAggregate: MockFunction = getJestMockFunction();
const mockSendJsonObjectResponse: MockFunction = getJestMockFunction();

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: (...args: Array<unknown>) => {
      return mockSendJsonObjectResponse(...args);
    },
    sendEntityArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return mockAnalyticsAggregate(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        // The dashboard's own project, so both sides read the same one.
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import MetricService from "../../../Server/Services/MetricService";
import { PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE } from "../../../Server/Utils/Dashboard/PublicDashboardMetricServices";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardChartComponent from "../../../Types/Dashboard/DashboardComponents/DashboardChartComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardViewConfigUtil from "../../../Utils/Dashboard/DashboardViewConfig";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import MetricExplorerUrl, {
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DASHBOARD_ID: string = "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4";
const METRICS_AGGREGATE_ROUTE: string =
  "/dashboard/metrics-aggregate/:dashboardId";

const API: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CHECKOUT: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const BILLING: string = "3b241101-e2bb-4255-8caf-4136c566a962";

const LATENCY: string = "http.server.duration";
const CPU: string = "system.cpu.utilization";
const MEMORY: string = "system.memory.usage";

let dashboard: Dashboard;
let windowCount: number = 0;

// A window of its own per read: the client caches equal reads a few seconds.
function nextWindow(): InBetween<Date> {
  windowCount++;

  return new InBetween<Date>(
    new Date(Date.UTC(2026, 10, 7, 10, 0, windowCount)),
    new Date(Date.UTC(2026, 10, 7, 11, 0, windowCount)),
  );
}

interface ViewQuerySpec {
  metricName: string;
  variable: string;
  serviceIds?: Array<string> | undefined;
  attributes?: JSONObject | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
  aggregationType?: MetricsAggregationType | undefined;
}

// A query of a metric explorer view, as the explorer holds it.
function viewQuery(spec: ViewQuerySpec): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: spec.variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: spec.metricName,
        aggegationType: spec.aggregationType || MetricsAggregationType.Avg,
        attributes: spec.attributes || {},
        ...(spec.serviceIds ? { telemetryServiceIds: spec.serviceIds } : {}),
      } as never,
      ...(spec.groupByAttributeKeys
        ? { groupByAttributeKeys: spec.groupByAttributeKeys }
        : {}),
    },
  };
}

/*
 * Add to dashboard, step for step (AddToDashboardModal): the view's queries
 * through the shared serializer and rebuilt, appended as a chart, and the
 * config written as the JSON column then hands it back.
 */
function addToDashboard(
  stored: unknown,
  view: Array<MetricQueryConfigData>,
): JSONObject {
  const serializedQueries: Array<SerializedMetricQuery> = view
    .map((queryConfig: MetricQueryConfigData): SerializedMetricQuery => {
      return MetricExplorerUrl.buildSerializedMetricQuery(queryConfig);
    })
    .filter(MetricExplorerUrl.isMeaningfulMetricQuery);

  const plainQueryConfigs: Array<MetricQueryConfigData> =
    buildQueryConfigsFromSerializedQueries(serializedQueries);

  const chartComponent: DashboardChartComponent =
    DashboardChartComponentUtil.getDefaultComponent();

  chartComponent.arguments = {
    metricQueryConfig: plainQueryConfigs[0],
    ...(plainQueryConfigs.length > 1
      ? { metricQueryConfigs: plainQueryConfigs.slice(1) }
      : {}),
    chartTitle: "Metric Chart",
  };

  const updatedViewConfig: DashboardViewConfig =
    DashboardViewConfigUtil.addComponentToDashboard({
      component: chartComponent,
      dashboardViewConfig: StoredDashboardViewConfig.read(stored),
    });

  return JSON.parse(
    JSON.stringify(
      JSONFunctions.serializeValue(updatedViewConfig as unknown as JSONObject),
    ),
  ) as JSONObject;
}

function chartsOf(config: DashboardViewConfig): Array<DashboardChartComponent> {
  return config.components.filter((component: unknown): boolean => {
    return (
      (component as DashboardChartComponent).componentType ===
      DashboardComponentType.Chart
    );
  }) as Array<DashboardChartComponent>;
}

// The config the signed-in dashboard draws: the stored one.
function signedInConfig(stored: JSONObject): DashboardViewConfig {
  return StoredDashboardViewConfig.read(stored);
}

// The config the public page draws: what /view-config serves, as it reads it.
function publicConfig(stored: JSONObject): DashboardViewConfig {
  const served: unknown = JSON.parse(
    JSON.stringify(
      JSONFunctions.serialize(
        PublicDashboardViewConfig.sanitize(
          stored as unknown as DashboardViewConfig,
        ) as unknown as JSONObject,
      ),
    ),
  );

  return StoredDashboardViewConfig.read(served);
}

// The queries a chart reads, as DashboardChartComponent gathers them.
function chartQueries(
  chart: DashboardChartComponent,
  variables: Array<DashboardVariable> | undefined,
): Array<MetricQueryConfigData> {
  const configs: Array<MetricQueryConfigData> = [];

  if (chart.arguments.metricQueryConfig) {
    configs.push(chart.arguments.metricQueryConfig);
  }

  if (chart.arguments.metricQueryConfigs) {
    configs.push(...chart.arguments.metricQueryConfigs);
  }

  return DashboardVariableInterpolation.applyToQueryConfigs(configs, variables);
}

/*
 * The public dashboard's API client, answered by the real public route: the
 * body goes as JSON, and the route's answer or refusal comes back as the
 * client's HTTP response would.
 */
function publicDashboardContext(): PublicDashboardContext {
  return {
    dashboardId: new ObjectID(DASHBOARD_ID),
    apiUrl: URL.fromString("http://localhost/public-dashboard-api"),
    postJSON: async (
      route: string,
      data: JSONObject,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      expect(route).toBe(`/metrics-aggregate/${DASHBOARD_ID}`);

      let answer: JSONObject | undefined = undefined;
      let refusal: unknown = undefined;

      mockSendJsonObjectResponse.mockImplementationOnce(
        (...args: Array<unknown>) => {
          answer = args[2] as JSONObject;
        },
      );

      const request: ExpressRequest = {
        params: { dashboardId: DASHBOARD_ID },
        body: JSON.parse(JSON.stringify(data)),
        query: {},
        cookies: {},
        headers: {},
        socket: {},
        ips: [],
      } as unknown as ExpressRequest;

      await mockRouter.match("post", METRICS_AGGREGATE_ROUTE).handlerFunction(
        request,
        {
          cookie: jest.fn(),
          send: jest.fn(),
          json: jest.fn(),
          status: jest.fn().mockReturnThis(),
        } as unknown as ExpressResponse,
        (err?: unknown) => {
          refusal = err;
        },
      );

      if (refusal || !answer) {
        return new HTTPErrorResponse(
          400,
          { error: (refusal as Error | undefined)?.message || "No answer." },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, answer, {});
    },
    apiClient: {} as PublicDashboardContext["apiClient"],
  };
}

// Recursively key-sorted, so two reads compare whatever order they were built in.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }

    return sorted;
  }

  return value;
}

/*
 * One read as the store gets it, comparable across the two sides: as JSON,
 * without the route's own run-as-root props, with its services in one order
 * (a list of ids is a set to `IN`).
 */
function comparableRead(aggregateBy: JSONObject): string {
  const withoutProps: JSONObject = { ...aggregateBy };
  delete withoutProps["props"];

  const read: JSONObject = JSON.parse(
    JSON.stringify(JSONFunctions.serialize(withoutProps)),
  ) as JSONObject;

  const query: JSONObject = (read["query"] || {}) as JSONObject;
  const services: JSONObject | undefined = query["primaryEntityId"] as
    | JSONObject
    | undefined;

  if (services && Array.isArray(services["value"])) {
    services["value"] = [...(services["value"] as Array<string>)].sort();
  }

  return JSON.stringify(canonical(read));
}

interface ChartReads {
  // Each read the store got, comparable, in a stable order.
  reads: Array<string>;
  // The services each read ran for, in read order: undefined for every service.
  services: Array<Array<string> | undefined>;
}

function servicesOf(aggregateBy: JSONObject): Array<string> | undefined {
  const services: unknown = (aggregateBy["query"] as JSONObject)[
    "primaryEntityId"
  ];

  if (services === undefined) {
    return undefined;
  }

  expect(services).toBeInstanceOf(Includes);

  return [...((services as Includes).values as Array<string>)];
}

// A chart's fetch, as DashboardChartComponent makes it.
async function fetchChart(
  chart: DashboardChartComponent,
  variables: Array<DashboardVariable> | undefined,
  window: InBetween<Date>,
): Promise<void> {
  await MetricUtil.fetchResults({
    metricViewData: {
      startAndEndDate: window,
      queryConfigs: chartQueries(chart, variables),
      formulaConfigs: [],
    },
    metricTypes: [],
    defaultTopN: true,
    topNOverrideScope: chart.componentId.toString(),
  });
}

function toChartReads(aggregateBys: Array<JSONObject>): ChartReads {
  return {
    reads: aggregateBys.map(comparableRead).sort(),
    services: aggregateBys.map(servicesOf),
  };
}

// What the store gets when a signed-in viewer's dashboard draws the chart.
async function readSignedIn(
  chart: DashboardChartComponent,
  variables: Array<DashboardVariable> | undefined,
  window: InBetween<Date>,
): Promise<ChartReads> {
  setPublicDashboardContext(null);
  mockAnalyticsAggregate.mockClear();

  await fetchChart(chart, variables, window);

  // As the private route reads its body: sent as JSON, revived.
  return toChartReads(
    mockAnalyticsAggregate.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        const aggregateBy: JSONObject = (call[0] as { aggregateBy: JSONObject })
          .aggregateBy;

        return JSONFunctions.deserialize(
          JSON.parse(JSON.stringify(JSONFunctions.serialize(aggregateBy))),
        );
      },
    ),
  );
}

// What the store gets when the public page draws the chart.
async function readPublic(
  chart: DashboardChartComponent,
  variables: Array<DashboardVariable> | undefined,
  window: InBetween<Date>,
): Promise<ChartReads> {
  setPublicDashboardContext(publicDashboardContext());
  (MetricService.aggregateBy as jest.Mock).mockClear();

  try {
    await fetchChart(chart, variables, window);
  } finally {
    setPublicDashboardContext(null);
  }

  return toChartReads(
    (MetricService.aggregateBy as jest.Mock).mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      },
    ),
  );
}

/*
 * Every chart of a stored dashboard, read both ways over the same window:
 * the signed-in reads and the public ones, chart by chart.
 */
async function readEveryChart(
  stored: JSONObject,
): Promise<Array<{ signedIn: ChartReads; public: ChartReads }>> {
  dashboard.dashboardViewConfig = stored as unknown as DashboardViewConfig;

  const signedInCharts: Array<DashboardChartComponent> = chartsOf(
    signedInConfig(stored),
  );
  const publicView: DashboardViewConfig = publicConfig(stored);
  const publicCharts: Array<DashboardChartComponent> = chartsOf(publicView);

  expect(publicCharts.length).toBe(signedInCharts.length);

  const reads: Array<{ signedIn: ChartReads; public: ChartReads }> = [];

  for (let index: number = 0; index < signedInCharts.length; index++) {
    const window: InBetween<Date> = nextWindow();

    reads.push({
      signedIn: await readSignedIn(
        signedInCharts[index]!,
        signedInConfig(stored).variables,
        window,
      ),
      public: await readPublic(
        publicCharts[index]!,
        publicView.variables,
        window,
      ),
    });
  }

  return reads;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new DashboardAPI();
});

beforeEach(() => {
  mockAnalyticsAggregate.mockReset();
  mockAnalyticsAggregate.mockImplementation(() => {
    return Promise.resolve({ data: [] });
  });
  mockSendJsonObjectResponse.mockReset();

  dashboard = new Dashboard();
  dashboard.id = new ObjectID(DASHBOARD_ID);
  dashboard.projectId = new ObjectID(PROJECT_ID);
  dashboard.isPublicDashboard = true;
  dashboard.enableMasterPassword = false;

  jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
  jest.spyOn(MetricService, "aggregateBy").mockResolvedValue({ data: [] });
});

afterEach(() => {
  setPublicDashboardContext(null);
  jest.restoreAllMocks();
});

describe("a chart added from a view read for some services", () => {
  test("charts those services on the public dashboard, as it does signed in", async () => {
    const stored: JSONObject = addToDashboard(null, [
      viewQuery({
        metricName: LATENCY,
        variable: "a",
        serviceIds: [API, CHECKOUT],
        attributes: { "http.route": "/pay" },
      }),
    ]);

    const [chart] = await readEveryChart(stored);

    expect(chart!.signedIn.services).toEqual([[API, CHECKOUT]]);
    expect(chart!.public.services).toEqual([[API, CHECKOUT]]);
    expect(chart!.public.reads).toEqual(chart!.signedIn.reads);
  });

  test("reads each of its queries for that query's own services", async () => {
    const stored: JSONObject = addToDashboard(null, [
      viewQuery({ metricName: LATENCY, variable: "a", serviceIds: [API] }),
      viewQuery({
        metricName: LATENCY,
        variable: "b",
        serviceIds: [CHECKOUT, BILLING],
      }),
      viewQuery({ metricName: CPU, variable: "c" }),
    ]);

    const [chart] = await readEveryChart(stored);

    const sortedServices: (
      services: Array<Array<string> | undefined>,
    ) => Array<string> = (
      services: Array<Array<string> | undefined>,
    ): Array<string> => {
      return services
        .map((serviceIds: Array<string> | undefined): string => {
          return serviceIds ? serviceIds.join(",") : "every service";
        })
        .sort();
    };

    expect(sortedServices(chart!.public.services)).toEqual(
      [API, `${CHECKOUT},${BILLING}`, "every service"].sort(),
    );
    expect(chart!.public.reads).toEqual(chart!.signedIn.reads);
  });

  test("keeps its services next to a dashboard variable's pick and its grouping", async () => {
    const stored: JSONObject = addToDashboard(
      {
        _type: "DashboardViewConfig",
        heightInDashboardUnits: 24,
        components: [],
        variables: [
          {
            id: "cluster",
            name: "cluster",
            type: DashboardVariableType.TelemetryAttribute,
            attributeKey: "resource.k8s.cluster.name",
            selectedValue: "prod-eu",
          },
        ],
      },
      [
        viewQuery({
          metricName: CPU,
          variable: "a",
          serviceIds: [BILLING],
          attributes: { "resource.k8s.cluster.name": "staging" },
          groupByAttributeKeys: ["host.name"],
        }),
      ],
    );

    const [chart] = await readEveryChart(stored);

    expect(chart!.public.services).toEqual([[BILLING]]);
    expect(chart!.public.reads).toEqual(chart!.signedIn.reads);

    const publicRead: JSONObject = JSON.parse(
      chart!.public.reads[0]!,
    ) as JSONObject;

    // The viewer's pick, as the signed-in chart reads it.
    expect(
      ((publicRead["query"] as JSONObject)["attributes"] as JSONObject)[
        "resource.k8s.cluster.name"
      ],
    ).toBe("prod-eu");
    expect(publicRead["groupByAttributeKeys"]).toEqual(["host.name"]);
  });
});

describe("a chart added from a view of every service", () => {
  test("reads every service on both, with the query it read before service filters", async () => {
    const stored: JSONObject = addToDashboard(null, [
      viewQuery({
        metricName: MEMORY,
        variable: "a",
        attributes: { "host.name": "web-1" },
      }),
    ]);

    const [chart] = await readEveryChart(stored);

    expect(chart!.signedIn.services).toEqual([undefined]);
    expect(chart!.public.services).toEqual([undefined]);
    expect(chart!.public.reads).toEqual(chart!.signedIn.reads);

    const publicRead: JSONObject = JSON.parse(
      chart!.public.reads[0]!,
    ) as JSONObject;

    expect(Object.keys(publicRead["query"] as JSONObject).sort()).toEqual([
      "attributes",
      "name",
      "projectId",
      "time",
    ]);
  });

  test("on a dashboard beside a chart of the same metric read for some services, each chart reads its own", async () => {
    const withServices: JSONObject = addToDashboard(null, [
      viewQuery({ metricName: LATENCY, variable: "a", serviceIds: [API] }),
    ]);
    const stored: JSONObject = addToDashboard(withServices, [
      viewQuery({ metricName: LATENCY, variable: "a" }),
    ]);

    const charts: Array<{ signedIn: ChartReads; public: ChartReads }> =
      await readEveryChart(stored);

    expect(
      charts.map((chart: { signedIn: ChartReads; public: ChartReads }) => {
        return chart.public.services;
      }),
    ).toEqual([[[API]], [undefined]]);

    for (const chart of charts) {
      expect(chart.public.reads).toEqual(chart.signedIn.reads);
    }
  });
});

/*
 * A chart over days is read in the viewer's zone, where each day bucket
 * starts (issue #7277). Signed in, AnalyticsModelAPI.aggregate adds the
 * zone to the read the chart hands it (mocked here, so the signed-in read
 * is taken as it would add it); on the public page the chart's code adds it
 * to the body it posts, and the public route passes it to the store.
 */
describe("a chart read over days, in the viewer's zone", () => {
  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
  });

  async function readBothOver(
    window: InBetween<Date>,
  ): Promise<{ signedIn: Array<string>; public: ChartReads }> {
    const stored: JSONObject = addToDashboard(null, [
      viewQuery({ metricName: LATENCY, variable: "a", serviceIds: [API] }),
    ]);

    dashboard.dashboardViewConfig = stored as unknown as DashboardViewConfig;

    setPublicDashboardContext(null);
    mockAnalyticsAggregate.mockClear();
    await fetchChart(chartsOf(signedInConfig(stored))[0]!, undefined, window);

    const signedIn: Array<string> = mockAnalyticsAggregate.mock.calls
      .map((call: Array<unknown>): string => {
        const sent: unknown = AggregationIntervalUtil.withReaderTimezone(
          (call[0] as { aggregateBy: never }).aggregateBy,
        );

        return comparableRead(
          JSONFunctions.deserialize(
            JSON.parse(
              JSON.stringify(JSONFunctions.serialize(sent as JSONObject)),
            ),
          ),
        );
      })
      .sort();

    return {
      signedIn: signedIn,
      public: await readPublic(
        chartsOf(publicConfig(stored))[0]!,
        publicConfig(stored).variables,
        window,
      ),
    };
  }

  test("a month read in New York reaches the store in New York's days, as it does signed in", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);
    windowCount++;

    const reads: { signedIn: Array<string>; public: ChartReads } =
      await readBothOver(
        new InBetween<Date>(
          new Date(Date.UTC(2026, 9, 1, 4, 0, windowCount)),
          new Date(Date.UTC(2026, 10, 1, 4, 0, windowCount)),
        ),
      );

    expect(reads.signedIn.length).toBeGreaterThan(0);
    expect((MetricService.aggregateBy as jest.Mock).mock.calls.length).toBe(
      reads.signedIn.length,
    );
    for (const call of (MetricService.aggregateBy as jest.Mock).mock.calls) {
      expect((call[0] as JSONObject)["timezone"]).toBe(
        Timezone.AmericaNew_York,
      );
    }
    expect(reads.public.reads).toEqual(reads.signedIn);
  });

  test("an hour's read carries no zone on either side", async () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    const reads: { signedIn: Array<string>; public: ChartReads } =
      await readBothOver(nextWindow());

    expect(reads.signedIn.length).toBeGreaterThan(0);
    for (const call of (MetricService.aggregateBy as jest.Mock).mock.calls) {
      expect(call[0] as JSONObject).not.toHaveProperty("timezone");
    }
    expect(reads.public.reads).toEqual(reads.signedIn);
  });
});

/*
 * PROPERTY: EVERY CHART OF A SEEDED DASHBOARD READS THE SAME ON THE PUBLIC
 * PAGE AS SIGNED IN, AND NONE IS REFUSED.
 *
 * Dashboards built with Add to dashboard from seeded views: one to three
 * queries each, of a few metrics, each for some services or every one, with
 * attribute filters and groupings now and then - several charts of one
 * metric among them, for different services.
 */
/*
 * The one chart the two sides do not read alike: an explorer link written
 * by hand can name text that is no service id, and Add to dashboard keeps
 * it. Signed in, the text matches no row. A public request can name only
 * service ids, so the public page cannot ask for that chart's services, and
 * it is refused - never read for every service instead.
 */
describe("a chart added from a link naming text that is no service id", () => {
  test("is refused on the public dashboard, and never read for every service", async () => {
    const serviceIds: Array<string> = MetricExplorerUrl.parseServicesParam(
      JSON.stringify([API, "smuggled"]),
    );

    expect(serviceIds).toEqual([API, "smuggled"]);

    const stored: JSONObject = addToDashboard(null, [
      viewQuery({ metricName: LATENCY, variable: "a", serviceIds }),
    ]);

    dashboard.dashboardViewConfig = stored as unknown as DashboardViewConfig;

    const window: InBetween<Date> = nextWindow();

    const signedIn: ChartReads = await readSignedIn(
      chartsOf(signedInConfig(stored))[0]!,
      undefined,
      window,
    );

    expect(signedIn.services).toEqual([[API, "smuggled"]]);

    let refusal: unknown = undefined;

    try {
      await readPublic(chartsOf(publicConfig(stored))[0]!, undefined, window);
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(HTTPErrorResponse);
    expect((refusal as HTTPErrorResponse).message).toBe(
      PUBLIC_DASHBOARD_SERVICES_REFUSED_MESSAGE,
    );
    expect(MetricService.aggregateBy).not.toHaveBeenCalled();
  });
});

describe("property: a public dashboard's charts read what the signed-in ones read", () => {
  const METRICS: Array<string> = [LATENCY, CPU, MEMORY];
  const SERVICES: Array<string> = [API, CHECKOUT, BILLING];
  const ATTRIBUTES: Array<JSONObject> = [
    {},
    { "http.route": "/pay" },
    { "host.name": "web-1" },
    { "host.name": new Includes(["web-1", "web-2"]) as unknown as JSONValue },
  ];

  test.each([1, 2, 3, 4, 5, 6])("seed %i", async (seed: number) => {
    const random: SeededRandom = seededRandom(62800 + seed);
    let stored: JSONObject | null = null;
    let queriesWithServices: number = 0;

    const chartCount: number = 2 + random(3);

    for (let chartIndex: number = 0; chartIndex < chartCount; chartIndex++) {
      const view: Array<MetricQueryConfigData> = [];
      const queryCount: number = 1 + random(3);

      for (let queryIndex: number = 0; queryIndex < queryCount; queryIndex++) {
        const serviceIds: Array<string> | undefined =
          random(3) === 0
            ? undefined
            : shuffled(SERVICES, random).slice(0, 1 + random(3));

        if (serviceIds) {
          queriesWithServices++;
        }

        view.push(
          viewQuery({
            metricName: METRICS[random(METRICS.length)]!,
            variable: String.fromCharCode(97 + queryIndex),
            serviceIds,
            attributes: ATTRIBUTES[random(ATTRIBUTES.length)],
            groupByAttributeKeys: random(2) === 0 ? ["host.name"] : undefined,
          }),
        );
      }

      stored = addToDashboard(stored, view);
    }

    expect(queriesWithServices).toBeGreaterThan(0);

    const charts: Array<{ signedIn: ChartReads; public: ChartReads }> =
      await readEveryChart(stored!);

    expect(charts.length).toBe(chartCount);

    for (const chart of charts) {
      expect(chart.public.reads.length).toBeGreaterThan(0);
      expect(chart.public.reads).toEqual(chart.signedIn.reads);
    }
  });
});

/*
 * ISSUE #6297: A CHART STORED IN ANOTHER SHAPE READS THE SAME.
 *
 * The API, Terraform and scripts can store a widget inside the widget list
 * as JSON text, in the DashboardComponent envelope with its value as text,
 * in a widget list written as text, or with its arguments as text. Signed
 * in and on the public page alike, the dashboard draws each as the chart it
 * holds - so the public route must answer each read the chart makes, with
 * its services, filter and grouping, exactly as signed in.
 */
describe("a chart stored in another shape (issue #6297)", () => {
  type ReshapeFunction = (stored: JSONObject) => JSONObject;

  const widgetsOf: (stored: JSONObject) => Array<JSONObject> = (
    stored: JSONObject,
  ): Array<JSONObject> => {
    return stored["components"] as Array<JSONObject>;
  };

  const SHAPES: Array<[string, ReshapeFunction]> = [
    [
      "as JSON text",
      (stored: JSONObject): JSONObject => {
        return {
          ...stored,
          components: widgetsOf(stored).map((widget: JSONObject): string => {
            return JSON.stringify(widget);
          }),
        };
      },
    ],
    [
      "in the envelope, its value as JSON text",
      (stored: JSONObject): JSONObject => {
        return {
          ...stored,
          components: widgetsOf(stored).map(
            (widget: JSONObject): JSONObject => {
              return {
                _type: "DashboardComponent",
                value: JSON.stringify(widget),
              };
            },
          ),
        };
      },
    ],
    [
      "in a widget list written as JSON text",
      (stored: JSONObject): JSONObject => {
        return { ...stored, components: JSON.stringify(widgetsOf(stored)) };
      },
    ],
    [
      "with its arguments as JSON text",
      (stored: JSONObject): JSONObject => {
        return {
          ...stored,
          components: widgetsOf(stored).map(
            (widget: JSONObject): JSONObject => {
              return {
                ...widget,
                arguments: JSON.stringify(widget["arguments"]),
              };
            },
          ),
        };
      },
    ],
  ];

  const servicesInOrder: (
    services: Array<Array<string> | undefined>,
  ) => Array<string> = (
    services: Array<Array<string> | undefined>,
  ): Array<string> => {
    return services
      .map((serviceIds: Array<string> | undefined): string => {
        return serviceIds ? [...serviceIds].sort().join(",") : "every service";
      })
      .sort();
  };

  test.each(SHAPES)(
    "%s: charts its services, filter and grouping on the public dashboard as signed in",
    async (_label: string, reshape: ReshapeFunction) => {
      const stored: JSONObject = reshape(
        addToDashboard(null, [
          viewQuery({
            metricName: LATENCY,
            variable: "a",
            serviceIds: [API, CHECKOUT],
            attributes: { "http.route": "/pay" },
            groupByAttributeKeys: ["host.name"],
          }),
          viewQuery({ metricName: CPU, variable: "b" }),
        ]),
      );

      const [chart] = await readEveryChart(stored);

      expect(servicesInOrder(chart!.signedIn.services)).toEqual(
        servicesInOrder([[API, CHECKOUT], undefined]),
      );
      expect(chart!.public.reads.length).toBe(2);
      expect(chart!.public.reads).toEqual(chart!.signedIn.reads);
    },
  );

  test.each(SHAPES)(
    "%s: its services saved as ObjectID JSON read as those ids, on both",
    async (_label: string, reshape: ReshapeFunction) => {
      const saved: JSONObject = addToDashboard(null, [
        viewQuery({
          metricName: MEMORY,
          variable: "a",
          serviceIds: [API, BILLING],
        }),
      ]);

      // A serialized id is stored as its JSON.
      const withObjectIds: JSONObject = JSON.parse(
        JSON.stringify(saved).replace(
          `"${BILLING}"`,
          JSON.stringify({ _type: "ObjectID", value: BILLING }),
        ),
      ) as JSONObject;

      expect(JSON.stringify(withObjectIds)).toContain('"_type":"ObjectID"');

      const [chart] = await readEveryChart(reshape(withObjectIds));

      expect(chart!.signedIn.services).toEqual([[API, BILLING]]);
      expect(chart!.public.services).toEqual([[API, BILLING]]);
      expect(chart!.public.reads).toEqual(chart!.signedIn.reads);
    },
  );

  test.each(SHAPES)(
    "%s: beside a dashboard variable's pick, as signed in",
    async (_label: string, reshape: ReshapeFunction) => {
      const stored: JSONObject = reshape(
        addToDashboard(
          {
            _type: "DashboardViewConfig",
            heightInDashboardUnits: 24,
            components: [],
            variables: [
              {
                id: "cluster",
                name: "cluster",
                type: DashboardVariableType.TelemetryAttribute,
                attributeKey: "resource.k8s.cluster.name",
                selectedValue: "prod-eu",
              },
            ],
          },
          [
            viewQuery({
              metricName: CPU,
              variable: "a",
              serviceIds: [BILLING],
            }),
          ],
        ),
      );

      const [chart] = await readEveryChart(stored);

      expect(chart!.public.services).toEqual([[BILLING]]);
      expect(chart!.public.reads).toEqual(chart!.signedIn.reads);
      expect(chart!.public.reads[0]).toContain("prod-eu");
    },
  );
});
