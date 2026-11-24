import { describe, expect, test } from "@jest/globals";
import AzureCloudConnector, {
  SelectedMetric,
  buildAzureMetricRequest,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AzureMetricCallGroup,
  AzureMetricRequest,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureMetricReads";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { collectCloudResourceReadings } from "../../../../Server/Utils/CloudConnection/CloudResourceReadings";
import {
  CloudConnectionSettings,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  AZURE_KEY_METRIC_SPLIT_TOP,
  AZURE_STATUS_CODE_CATEGORY_ATTRIBUTE,
  AZURE_STATUS_CODE_CATEGORY_DIMENSION,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * A CONTAINER APP'S REQUESTS, READ BY THEIR STATUS CODE CATEGORY (#10837).
 *
 * An Azure connection reads a Container App's Requests split by the
 * statusCodeCategory dimension Microsoft's supported metrics of
 * Microsoft.App/containerapps list for it - a series per category, whose
 * "5xx" is the app's server errors - in a call of its own, since a call's
 * filter splits every metric in it that has the dimension, and
 * ResponseTime has it too. The type's resources of a subscription and
 * Region share that call in batches (metrics:getBatch with a filter), as
 * they share their other metrics' call. Each series is written as the
 * azure_monitor receiver writes a split one (metadata_statuscodecategory),
 * and the app's readings add the categories up, as its whole read before.
 * The answers have the shape Azure Monitor's Metrics Batch (2023-10-01)
 * answers with: per resource, each metric's timeseries with its dimension
 * values (metadatavalues, the name lowercased), and a minute with no data
 * written without a value.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const REGION: string = "eastus";
const CONTAINER_APP_TYPE: string = "Microsoft.App/containerApps";

function containerApp(name: string): string {
  return `/subscriptions/${SUB}/resourceGroups/rg-apps/providers/Microsoft.App/containerApps/${name}`;
}

const CHECKOUT: string = containerApp("checkout");
const CART: string = containerApp("cart");

const connector: AzureCloudConnector = new AzureCloudConnector();

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: CLIENT,
      cloud: "public",
      subscriptionIds: SUB,
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

function definition(
  name: string,
  aggregation: string,
  unit: string = "Count",
): JSONObject {
  return {
    name: { value: name, localizedValue: name },
    unit,
    primaryAggregationType: aggregation,
    // As Microsoft lists a Container App's: Average, Total, Maximum, Minimum.
    supportedAggregationTypes: [
      "None",
      "Average",
      "Total",
      "Maximum",
      "Minimum",
    ],
    metricAvailabilities: [{ timeGrain: "PT1M", retention: "P93D" }],
  };
}

// A Container App's key metrics, each with the aggregation it is read with.
const CONTAINER_APP_DEFINITIONS: Array<JSONObject> = [
  definition("Requests", "Total"),
  definition("UsageNanoCores", "Average", "NanoCores"),
  definition("WorkingSetBytes", "Average", "Bytes"),
  definition("RestartCount", "Total"),
  definition("ResponseTime", "Average", "Milliseconds"),
  definition("CpuPercentage", "Average", "Percent"),
  definition("MemoryPercentage", "Average", "Percent"),
  definition("Replicas", "Average"),
  definition("RxBytes", "Total", "Bytes"),
  definition("TxBytes", "Total", "Bytes"),
];

const AGGREGATION_OF: Record<string, string> = {
  requests: "total",
  restartcount: "total",
  rxbytes: "total",
  txbytes: "total",
};

// One category's points, a minute each from the window's start; null: no data.
interface FakeCategorySeries {
  category: string;
  values: Array<number | null>;
}

interface FakeAzureOptions {
  // Per resource id: its Requests' series, by category, when a call splits them.
  categories?: Record<string, Array<FakeCategorySeries>>;
  // How Azure answers every split batch, in place of its series (a refusal).
  splitBatchAnswer?: FakeResponse | undefined;
}

interface FakeAzure extends FakeProviderApi {
  batchCalls: Array<URL>;
  singleCalls: Array<URL>;
}

function pointsOf(data: {
  aggregation: string;
  start: number;
  values: Array<number | null>;
}): JSONArray {
  return data.values.map((value: number | null, index: number): JSONObject => {
    const point: JSONObject = {
      timeStamp: new Date(data.start + index * 60000).toISOString(),
    };

    if (value !== null) {
      point[data.aggregation] = value;
    }

    return point;
  });
}

// One resource's metrics, as Azure Monitor answers them; split by category when asked.
function metricsOf(data: {
  resourceId: string;
  names: Array<string>;
  start: number;
  splitBy: string;
  options: FakeAzureOptions;
}): JSONArray {
  return data.names.map((name: string): JSONObject => {
    const aggregation: string = AGGREGATION_OF[name.toLowerCase()] || "average";
    const split: boolean =
      Boolean(data.splitBy) &&
      data.splitBy.toLowerCase() ===
        AZURE_STATUS_CODE_CATEGORY_DIMENSION.toLowerCase() &&
      name === "Requests";

    return {
      id: `${data.resourceId}/providers/Microsoft.Insights/metrics/${name}`,
      type: "Microsoft.Insights/metrics",
      name: { value: name, localizedValue: name },
      unit: "Count",
      timeseries: split
        ? (data.options.categories?.[data.resourceId] || []).map(
            (series: FakeCategorySeries): JSONObject => {
              return {
                metadatavalues: [
                  {
                    name: {
                      value: "statuscodecategory",
                      localizedValue: "statusCodeCategory",
                    },
                    value: series.category,
                  },
                ],
                data: pointsOf({
                  aggregation,
                  start: data.start,
                  values: series.values,
                }),
              };
            },
          )
        : [
            {
              metadatavalues: [],
              data: pointsOf({
                aggregation,
                start: data.start,
                values: [10, 11],
              }),
            },
          ],
      errorCode: "Success",
    };
  });
}

// A split filter's dimension, `<dimension> eq '*'`, as a call asks it.
const SPLIT_FILTER: RegExp = /^(\w+) eq '\*'$/;

function splitByOf(filter: string | null): string {
  return SPLIT_FILTER.exec(filter || "")?.[1] || "";
}

function namesOf(url: URL): Array<string> {
  return (url.searchParams.get("metricnames") || "")
    .split(",")
    .filter((name: string): boolean => {
      return Boolean(name);
    });
}

function createFakeAzure(options: FakeAzureOptions = {}): FakeAzure {
  const batchCalls: Array<URL> = [];
  const singleCalls: Array<URL> = [];

  const routes: Array<FakeRoute> = [
    {
      host: "login.microsoftonline.com",
      path: `/${TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "azure-access-token", expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: `/subscriptions/${SUB}/resources`,
      respond: (): FakeResponse => {
        return json({
          value: [CHECKOUT, CART].map((id: string): JSONObject => {
            return {
              id,
              name: id.split("/").pop()!,
              // Resource Manager answers the type in its own casing.
              type: "Microsoft.App/containerapps",
              location: REGION,
            };
          }),
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metricDefinitions$/,
      respond: (): FakeResponse => {
        return json({ value: CONTAINER_APP_DEFINITIONS });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metrics$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        singleCalls.push(url);
        const resourceId: string = url.pathname.replace(
          "/providers/Microsoft.Insights/metrics",
          "",
        );

        return json({
          value: metricsOf({
            resourceId,
            names: namesOf(url),
            start: Date.parse(
              (url.searchParams.get("timespan") || "").split("/")[0]!,
            ),
            splitBy: splitByOf(url.searchParams.get("$filter")),
            options,
          }),
        });
      },
    },
    {
      host: `${REGION}.metrics.monitor.azure.com`,
      path: `/subscriptions/${SUB}/metrics:getBatch`,
      method: "POST",
      respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
        batchCalls.push(url);
        const splitBy: string = splitByOf(url.searchParams.get("filter"));

        if (splitBy && options.splitBatchAnswer) {
          return options.splitBatchAnswer;
        }

        const body: JSONObject = (
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : request.body || {}
        ) as JSONObject;
        const start: number = Date.parse(
          url.searchParams.get("starttime") || "",
        );

        return json({
          values: ((body["resourceids"] as Array<string>) || []).map(
            (resourceId: string): JSONObject => {
              return {
                starttime: url.searchParams.get("starttime"),
                endtime: url.searchParams.get("endtime"),
                interval: url.searchParams.get("interval"),
                namespace: "microsoft.app/containerapps",
                resourceregion: REGION,
                resourceid: resourceId.toLowerCase(),
                value: metricsOf({
                  resourceId,
                  names: namesOf(url),
                  start,
                  splitBy,
                  options,
                }),
              };
            },
          ),
        });
      },
    },
  ];

  return { ...createFakeProviderApi(routes), batchCalls, singleCalls };
}

async function read(fake: FakeAzure): Promise<CloudReadResult> {
  return await connector.read(settings(), {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
    random: (): number => {
      return 0;
    },
    state: {},
    serviceName: "Production Azure",
    connectionId: "33333333-3333-4333-8333-333333333333",
    maxRequests: 3000,
    maxDurationMs: 60000,
  });
}

interface WrittenPoint {
  metricName: string;
  stored: JSONObject;
  value: number;
  timeMs: number;
}

function written(result: CloudReadResult): Array<WrittenPoint> {
  const found: Array<WrittenPoint> = [];

  for (const payload of result.payloads) {
    for (const rm of payload["resourceMetrics"] as JSONArray) {
      const resourceAttributes: JSONArray = (
        (rm as JSONObject)["resource"] as JSONObject
      )["attributes"] as JSONArray;

      for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
        for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
          for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
            "dataPoints"
          ] as JSONArray) {
            found.push({
              metricName: (metric as JSONObject)["name"] as string,
              stored: storedAttributesOf(
                resourceAttributes as never,
                (point as JSONObject)["attributes"] as never,
              ) as JSONObject,
              value: (point as JSONObject)["asDouble"] as number,
              timeMs: Number(
                String((point as JSONObject)["timeUnixNano"]).slice(0, -6),
              ),
            });
          }
        }
      }
    }
  }

  return found;
}

const CHECKOUT_CATEGORIES: Array<FakeCategorySeries> = [
  { category: "2xx", values: [90, 100] },
  { category: "4xx", values: [6, 4] },
  // No 5xx the first minute: Azure writes the minute without a value.
  { category: "5xx", values: [null, 3] },
];

describe("a Container App's request, read through the connection (#10837)", () => {
  test("its Requests are a batch call of their own, split by statusCodeCategory, beside its other metrics' batch", async () => {
    const fake: FakeAzure = createFakeAzure({
      categories: {
        [CHECKOUT]: CHECKOUT_CATEGORIES,
        [CART]: [{ category: "2xx", values: [20, 30] }],
      },
    });

    const result: CloudReadResult = await read(fake);

    // Two calls for both apps: no call a resource, and none on Resource Manager.
    expect(fake.singleCalls).toEqual([]);
    expect(fake.batchCalls).toHaveLength(2);

    const split: URL = fake.batchCalls.find((url: URL): boolean => {
      return url.searchParams.has("filter");
    })!;
    const whole: URL = fake.batchCalls.find((url: URL): boolean => {
      return !url.searchParams.has("filter");
    })!;

    // The batch API's own filter and top (no $, and no ValidateDimensions).
    expect(Object.fromEntries(split.searchParams.entries())).toEqual(
      expect.objectContaining({
        metricnamespace: CONTAINER_APP_TYPE,
        metricnames: "Requests",
        aggregation: "Total",
        filter: "statusCodeCategory eq '*'",
        top: String(AZURE_KEY_METRIC_SPLIT_TOP),
      }),
    );
    expect(split.searchParams.has("$filter")).toBe(false);
    expect(split.searchParams.has("ValidateDimensions")).toBe(false);

    // Every other key metric, whole, in the one call: ResponseTime is never split.
    expect(namesOf(whole).sort()).toEqual([
      "CpuPercentage",
      "MemoryPercentage",
      "Replicas",
      "ResponseTime",
      "RestartCount",
      "RxBytes",
      "TxBytes",
      "UsageNanoCores",
      "WorkingSetBytes",
    ]);
    expect(whole.searchParams.has("top")).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  test("each category's series is written with its category, as the azure_monitor receiver files a split series, and the rest whole", async () => {
    const fake: FakeAzure = createFakeAzure({
      categories: { [CHECKOUT]: CHECKOUT_CATEGORIES },
    });

    const points: Array<WrittenPoint> = written(await read(fake));
    const requests: Array<WrittenPoint> = points.filter(
      (point: WrittenPoint): boolean => {
        return (
          point.metricName === "azure_requests_total" &&
          point.stored["azuremonitor.resource_id"] === CHECKOUT
        );
      },
    );

    expect(
      requests
        .map((point: WrittenPoint): string => {
          return `${point.stored[AZURE_STATUS_CODE_CATEGORY_ATTRIBUTE]} ${point.value}`;
        })
        .sort(),
    ).toEqual(["2xx 100", "2xx 90", "4xx 4", "4xx 6", "5xx 3"]);
    expect(AZURE_STATUS_CODE_CATEGORY_ATTRIBUTE).toBe(
      "metadata_statuscodecategory",
    );
    expect(requests[0]!.stored).toEqual(
      expect.objectContaining({
        "azuremonitor.resource_id": CHECKOUT,
        name: "checkout",
        type: CONTAINER_APP_TYPE,
        timegrain: "PT1M",
      }),
    );

    // Its response time, and every other metric, carry no category.
    for (const point of points) {
      if (point.metricName === "azure_requests_total") {
        continue;
      }

      expect({
        metric: point.metricName,
        category: point.stored[AZURE_STATUS_CODE_CATEGORY_ATTRIBUTE],
      }).toEqual({ metric: point.metricName, category: undefined });
    }
  });

  test("its requests reading adds the categories up at the newest minute, the whole it read before", async () => {
    const fake: FakeAzure = createFakeAzure({
      categories: { [CHECKOUT]: CHECKOUT_CATEGORIES },
    });

    const result: CloudReadResult = await read(fake);
    const point: WrittenPoint = written(result).find(
      (each: WrittenPoint): boolean => {
        return each.stored["azuremonitor.resource_id"] === CHECKOUT;
      },
    )!;
    const resource: CloudMonitoredResource | null =
      resolveCloudMonitoredResource({
        metricName: point.metricName,
        attributes: point.stored,
      });
    const app: { readings: unknown } | undefined = collectCloudResourceReadings(
      result.payloads,
    ).get(buildCloudMonitoredResourceIdentifier(resource!).toLowerCase());

    // 100 + 4 + 3 at the newest minute.
    expect(
      ((app?.readings as JSONObject)["requests"] as JSONObject)["value"],
    ).toBe(107);
  });

  test("a split batch Azure refuses is asked a resource at a time, still split by the dimension, on Resource Manager", async () => {
    const fake: FakeAzure = createFakeAzure({
      categories: { [CHECKOUT]: CHECKOUT_CATEGORIES },
      splitBatchAnswer: {
        status: 400,
        body: JSON.stringify({
          error: { code: "BadRequest", message: "The filter is not valid." },
        }),
      },
    });

    const points: Array<WrittenPoint> = written(await read(fake));

    expect(
      fake.singleCalls
        .map((url: URL): string => {
          return `${url.pathname.split("/").pop()} ${url.searchParams.get("metricnames")} ${url.searchParams.get("$filter")} ${url.searchParams.get("ValidateDimensions")}`;
        })
        .sort(),
    ).toEqual([
      "metrics Requests statusCodeCategory eq '*' false",
      "metrics Requests statusCodeCategory eq '*' false",
    ]);
    expect(
      points
        .filter((point: WrittenPoint): boolean => {
          return (
            point.metricName === "azure_requests_total" &&
            point.stored["azuremonitor.resource_id"] === CHECKOUT
          );
        })
        .map((point: WrittenPoint): unknown => {
          return point.stored[AZURE_STATUS_CODE_CATEGORY_ATTRIBUTE];
        })
        .sort(),
    ).toEqual(["2xx", "2xx", "4xx", "4xx", "5xx"]);
  });
});

/*
 * What a resource asks Azure Monitor for (buildAzureMetricRequest): a
 * Container App's Requests in a call group of their own, split by
 * statusCodeCategory and batched; a metric someone added keeps its own
 * split; and no other type's key metric is split alone.
 */
describe("a Container App's read groups", () => {
  function selected(name: string, aggregation: string): SelectedMetric {
    return {
      name,
      aggregation,
      grain: "PT1M",
      unit: "Count",
      supportedAggregations: ["Average", "Total", "Maximum", "Minimum"],
    };
  }

  function requestOf(
    type: string,
    metrics: Array<SelectedMetric>,
  ): AzureMetricRequest<SelectedMetric> {
    return buildAzureMetricRequest({
      entry: {
        armId: CHECKOUT,
        subscriptionId: SUB,
        location: REGION,
        type,
      },
      selected: metrics,
      readGroups: new Map([
        [
          "PT1M",
          {
            grain: "PT1M",
            cursorKey: "PT1M",
            window: {
              periodSeconds: 60,
              start: new Date("2026-10-21T11:58:00Z"),
              end: new Date("2026-10-21T12:03:00Z"),
            },
          },
        ],
      ]),
      now: NOW,
    });
  }

  function shapeOf(group: AzureMetricCallGroup<SelectedMetric>): JSONObject {
    return {
      metrics: group.metrics
        .map((metric: SelectedMetric): string => {
          return metric.name;
        })
        .join(","),
      splitBy: group.splitBy || null,
      top: group.top ?? null,
      batchesSplit: Boolean(group.batchesSplit),
      reportsCapped: Boolean(group.reportsCapped),
    };
  }

  test("its Requests are a group of their own, split by statusCodeCategory and batched, its other metrics one whole group", () => {
    const request: AzureMetricRequest<SelectedMetric> = requestOf(
      CONTAINER_APP_TYPE,
      [
        selected("Requests", "Total"),
        selected("ResponseTime", "Average"),
        selected("CpuPercentage", "Average"),
      ],
    );

    expect(request.groups.map(shapeOf)).toEqual([
      {
        metrics: "Requests",
        splitBy: AZURE_STATUS_CODE_CATEGORY_DIMENSION,
        top: AZURE_KEY_METRIC_SPLIT_TOP,
        batchesSplit: true,
        reportsCapped: false,
      },
      {
        metrics: "ResponseTime,CpuPercentage",
        splitBy: null,
        top: null,
        batchesSplit: false,
        reportsCapped: true,
      },
    ]);
  });

  test("an added metric of the type keeps its own split, never batched, and a metric named Requests of another type is not split", () => {
    const request: AzureMetricRequest<SelectedMetric> = requestOf(
      CONTAINER_APP_TYPE,
      [
        selected("Requests", "Total"),
        {
          ...selected("ResiliencyRequestRetries", "Total"),
          isAdded: true,
          splitBy: "revisionName",
        },
      ],
    );

    expect(request.groups.map(shapeOf)).toEqual([
      {
        metrics: "Requests",
        splitBy: AZURE_STATUS_CODE_CATEGORY_DIMENSION,
        top: AZURE_KEY_METRIC_SPLIT_TOP,
        batchesSplit: true,
        reportsCapped: false,
      },
      {
        metrics: "ResiliencyRequestRetries",
        splitBy: "revisionName",
        top: 10,
        batchesSplit: false,
        reportsCapped: false,
      },
    ]);

    // An App Service app's Requests are read whole, as before.
    expect(
      requestOf("Microsoft.Web/sites", [
        selected("Requests", "Total"),
        selected("Http5xx", "Total"),
      ]).groups.map(shapeOf),
    ).toEqual([
      {
        metrics: "Requests,Http5xx",
        splitBy: null,
        top: null,
        batchesSplit: false,
        reportsCapped: true,
      },
    ]);
  });
});
