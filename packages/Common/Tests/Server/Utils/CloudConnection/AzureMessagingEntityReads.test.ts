import { describe, expect, test } from "@jest/globals";
import AzureArm, {
  AzureMetricFailure,
  AzureMetricSeries,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureCloudConnector from "../../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import { storedAttributesOf } from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { collectCloudResourceReadings } from "../../../../Server/Utils/CloudConnection/CloudResourceReadings";
import {
  CloudConnectionSettings,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  AZURE_ENTITY_NAME_ATTRIBUTE,
  AZURE_MAX_SPLIT_SERIES_PER_METRIC,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * An Azure cloud connection reads a Service Bus or Event Hubs namespace's
 * metrics split by EntityName - a series per queue, topic and event hub -
 * in the same one Azure Monitor call it made for the namespace's totals,
 * and writes each series as the collector's azure_monitor receiver does,
 * so the ingest files it on its queue. The answers here have the shape
 * Azure Monitor's Metrics - List (2023-10-01) answers with: a metric's
 * timeseries, each with its dimension values (metadatavalues, the name
 * lowercased), its errorCode, and no next page.
 */

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const NOW: Date = new Date("2026-10-21T12:07:00Z");

const SERVICE_BUS: string = `/subscriptions/${SUB}/resourceGroups/rg-msg/providers/Microsoft.ServiceBus/namespaces/sb-orders`;
const EVENT_HUBS: string = `/subscriptions/${SUB}/resourceGroups/rg-msg/providers/Microsoft.EventHub/namespaces/eh-clicks`;
const VM: string = `/subscriptions/${SUB}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/vm-web-1`;

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
    metricAvailabilities: [
      { timeGrain: "PT1M", retention: "P93D" },
      { timeGrain: "PT5M", retention: "P93D" },
      { timeGrain: "PT1H", retention: "P93D" },
    ],
  };
}

// As Azure Monitor's supported metrics list them: each one's default aggregation.
const SERVICE_BUS_DEFINITIONS: Array<JSONObject> = [
  definition("IncomingMessages", "Total"),
  definition("OutgoingMessages", "Total"),
  definition("ActiveMessages", "Average"),
  definition("DeadletteredMessages", "Average"),
  definition("ServerErrors", "Total"),
  definition("ThrottledRequests", "Total"),
  definition("Size", "Average", "Bytes"),
];

const EVENT_HUBS_DEFINITIONS: Array<JSONObject> = [
  definition("IncomingMessages", "Total"),
  definition("OutgoingMessages", "Total"),
  definition("ThrottledRequests", "Total"),
  definition("ServerErrors", "Total"),
];

const VM_DEFINITIONS: Array<JSONObject> = [
  definition("Percentage CPU", "Average", "Percent"),
];

// One timeseries of a split answer: the entity, and its points.
interface FakeEntitySeries {
  entity: string;
  values: Array<number | null>;
}

interface FakeAzureOptions {
  // Per resource id: the entities a split answer has, for every metric.
  entities?: Record<string, Array<FakeEntitySeries>>;
  // Per resource id and metric: Azure Monitor's own error for that metric.
  metricErrors?: Record<string, Record<string, string>>;
  // Per resource id: the responses its metrics calls get in turn.
  metricResponses?: Record<string, Array<FakeResponse>>;
  resources?: Array<JSONObject>;
}

interface FakeAzure extends FakeProviderApi {
  metricCalls: Array<URL>;
}

function timeseriesOf(data: {
  aggregation: string;
  start: number;
  series: FakeEntitySeries;
}): JSONObject {
  return {
    metadatavalues: [
      {
        name: { value: "entityname", localizedValue: "entityname" },
        value: data.series.entity,
      },
    ],
    data: data.series.values.map(
      (value: number | null, index: number): JSONObject => {
        const point: JSONObject = {
          timeStamp: new Date(data.start + index * 60000).toISOString(),
        };

        if (value !== null) {
          point[data.aggregation] = value;
        }

        return point;
      },
    ),
  };
}

const AGGREGATION_OF: Record<string, string> = {
  incomingmessages: "total",
  outgoingmessages: "total",
  activemessages: "average",
  deadletteredmessages: "average",
  servererrors: "total",
  throttledrequests: "total",
  "percentage cpu": "average",
};

function createFakeAzure(options: FakeAzureOptions = {}): FakeAzure {
  const metricCalls: Array<URL> = [];
  const responsesServed: Record<string, number> = {};

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
          value: options.resources || [
            {
              id: SERVICE_BUS,
              name: "sb-orders",
              // Resource Manager answers the type in its own casing.
              type: "Microsoft.ServiceBus/Namespaces",
              location: "westeurope",
            },
            {
              id: EVENT_HUBS,
              name: "eh-clicks",
              type: "Microsoft.EventHub/Namespaces",
              location: "westeurope",
            },
            {
              id: VM,
              name: "vm-web-1",
              type: "Microsoft.Compute/virtualMachines",
              location: "westeurope",
            },
          ],
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metricDefinitions$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const path: string = url.pathname.toLowerCase();

        return json({
          value: path.includes("microsoft.servicebus")
            ? SERVICE_BUS_DEFINITIONS
            : path.includes("microsoft.eventhub")
              ? EVENT_HUBS_DEFINITIONS
              : VM_DEFINITIONS,
        });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metrics$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        metricCalls.push(url);
        const resourceId: string = url.pathname.replace(
          "/providers/Microsoft.Insights/metrics",
          "",
        );
        const queued: Array<FakeResponse> | undefined =
          options.metricResponses?.[resourceId];

        if (queued) {
          const served: number = responsesServed[resourceId] || 0;
          responsesServed[resourceId] = served + 1;

          if (served < queued.length) {
            return queued[served]!;
          }
        }

        const names: Array<string> = (url.searchParams.get("metricnames") || "")
          .split(",")
          .filter((name: string): boolean => {
            return Boolean(name);
          });
        const start: number = Date.parse(
          (url.searchParams.get("timespan") || "").split("/")[0]!,
        );
        const isSplit: boolean = url.searchParams.has("$filter");

        return json({
          cost: names.length,
          timespan: url.searchParams.get("timespan"),
          interval: url.searchParams.get("interval"),
          value: names.map((name: string): JSONObject => {
            const aggregation: string =
              AGGREGATION_OF[name.toLowerCase()] || "average";
            const error: string | undefined =
              options.metricErrors?.[resourceId]?.[name];

            if (error) {
              return {
                id: `${resourceId}/providers/Microsoft.Insights/metrics/${name}`,
                type: "Microsoft.Insights/metrics",
                name: { value: name, localizedValue: name },
                unit: "Count",
                timeseries: [],
                errorCode: "InternalServerError",
                errorMessage: error,
              };
            }

            const entities: Array<FakeEntitySeries> = isSplit
              ? options.entities?.[resourceId] || []
              : [{ entity: "", values: [10, 11, null] }];

            return {
              id: `${resourceId}/providers/Microsoft.Insights/metrics/${name}`,
              type: "Microsoft.Insights/metrics",
              name: { value: name, localizedValue: name },
              displayDescription: `${name} of the resource.`,
              unit: "Count",
              timeseries: entities.map(
                (series: FakeEntitySeries): JSONObject => {
                  const timeseries: JSONObject = timeseriesOf({
                    aggregation,
                    start,
                    series,
                  });

                  return isSplit
                    ? timeseries
                    : { ...timeseries, metadatavalues: [] };
                },
              ),
              errorCode: "Success",
            };
          }),
          namespace: "Microsoft.ServiceBus/namespaces",
          resourceregion: "westeurope",
        });
      },
    },
  ];

  return { ...createFakeProviderApi(routes), metricCalls };
}

async function read(
  fake: FakeAzure,
  sleeps: Array<number> = [],
): Promise<CloudReadResult> {
  return await connector.read(settings(), {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
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

function callsTo(fake: FakeAzure, resourceId: string): Array<URL> {
  return fake.metricCalls.filter((url: URL): boolean => {
    return (
      url.pathname === `${resourceId}/providers/Microsoft.Insights/metrics`
    );
  });
}

function queues(count: number): Array<FakeEntitySeries> {
  const list: Array<FakeEntitySeries> = [];

  for (let index: number = 1; index <= count; index++) {
    list.push({ entity: `queue-${index}`, values: [index, index + 1] });
  }

  return list;
}

// A real-shaped Metrics - List answer, split by EntityName.
const SPLIT_ANSWER: JSONObject = {
  cost: 1,
  timespan: "2026-10-21T11:58:00.000Z/2026-10-21T12:03:00.000Z",
  interval: "PT1M",
  value: [
    {
      id: `${SERVICE_BUS}/providers/Microsoft.Insights/metrics/IncomingMessages`,
      type: "Microsoft.Insights/metrics",
      name: { value: "IncomingMessages", localizedValue: "Incoming Messages" },
      displayDescription: "Incoming Messages for Microsoft.ServiceBus.",
      unit: "Count",
      timeseries: [
        {
          metadatavalues: [
            {
              name: { value: "entityname", localizedValue: "entityname" },
              value: "orders",
            },
          ],
          data: [
            { timeStamp: "2026-10-21T12:01:00Z", total: 12 },
            { timeStamp: "2026-10-21T12:02:00Z", total: 7 },
          ],
        },
        {
          metadatavalues: [
            {
              name: { value: "entityname", localizedValue: "entityname" },
              value: "invoices",
            },
          ],
          data: [{ timeStamp: "2026-10-21T12:02:00Z", total: 3 }],
        },
        {
          // A queue with nothing that window: its minutes carry no value.
          metadatavalues: [
            {
              name: { value: "entityname", localizedValue: "entityname" },
              value: "idle",
            },
          ],
          data: [
            { timeStamp: "2026-10-21T12:01:00Z" },
            { timeStamp: "2026-10-21T12:02:00Z" },
          ],
        },
        {
          // The namespace's own share, not a queue's.
          metadatavalues: [
            {
              name: { value: "EntityName", localizedValue: "EntityName" },
              value: "-NamespaceOnlyMetric-",
            },
          ],
          data: [{ timeStamp: "2026-10-21T12:02:00Z", total: 1 }],
        },
      ],
      errorCode: "Success",
    },
    {
      id: `${SERVICE_BUS}/providers/Microsoft.Insights/metrics/ActiveMessages`,
      type: "Microsoft.Insights/metrics",
      name: { value: "ActiveMessages", localizedValue: "Active Messages" },
      unit: "Count",
      // A namespace without queues: no series at all.
      timeseries: [],
      errorCode: "Success",
    },
    {
      id: `${SERVICE_BUS}/providers/Microsoft.Insights/metrics/ThrottledRequests`,
      type: "Microsoft.Insights/metrics",
      name: {
        value: "ThrottledRequests",
        localizedValue: "Throttled Requests",
      },
      unit: "Count",
      timeseries: [],
      errorCode: "InternalServerError",
      errorMessage: "The metric could not be read. Try again later.",
    },
  ],
  namespace: "Microsoft.ServiceBus/namespaces",
  resourceregion: "westeurope",
};

describe("Azure Monitor's answer, split by EntityName", () => {
  test("is one series per queue and topic, each with its entity as Azure names it, lowercased", () => {
    const series: Array<AzureMetricSeries> = AzureArm.readMetricSeries(
      SPLIT_ANSWER,
      {
        incomingmessages: "Total",
        activemessages: "Average",
        throttledrequests: "Total",
      },
    );

    expect(series).toEqual([
      {
        metricName: "IncomingMessages",
        unit: "Count",
        points: [
          { timeMs: Date.parse("2026-10-21T12:01:00Z"), value: 12 },
          { timeMs: Date.parse("2026-10-21T12:02:00Z"), value: 7 },
        ],
        dimensions: [{ name: "entityname", value: "orders" }],
      },
      {
        metricName: "IncomingMessages",
        unit: "Count",
        points: [{ timeMs: Date.parse("2026-10-21T12:02:00Z"), value: 3 }],
        dimensions: [{ name: "entityname", value: "invoices" }],
      },
      // The idle queue is left out: it has no point.
      {
        metricName: "IncomingMessages",
        unit: "Count",
        points: [{ timeMs: Date.parse("2026-10-21T12:02:00Z"), value: 1 }],
        dimensions: [{ name: "entityname", value: "-NamespaceOnlyMetric-" }],
      },
    ]);
  });

  test("an unsplit answer is one series with no dimension, as before", () => {
    const series: Array<AzureMetricSeries> = AzureArm.readMetricSeries(
      {
        value: [
          {
            name: { value: "Percentage CPU" },
            unit: "Percent",
            timeseries: [
              {
                metadatavalues: [],
                data: [{ timeStamp: "2026-10-21T12:00:00Z", average: 4 }],
              },
            ],
            errorCode: "Success",
          },
        ],
      },
      { "percentage cpu": "Average" },
    );

    expect(series).toEqual([
      {
        metricName: "Percentage CPU",
        unit: "Percent",
        points: [{ timeMs: Date.parse("2026-10-21T12:00:00Z"), value: 4 }],
        dimensions: [],
      },
    ]);
  });

  test("a metric Azure Monitor could not read says so, while the others are answered", () => {
    const failures: Array<AzureMetricFailure> =
      AzureArm.readMetricFailures(SPLIT_ANSWER);

    expect(failures).toEqual([
      {
        metricName: "ThrottledRequests",
        code: "InternalServerError",
        message: "The metric could not be read. Try again later.",
      },
    ]);
    // Success, in any case, or no code at all, is no failure.
    expect(
      AzureArm.readMetricFailures({
        value: [
          { name: { value: "A" }, errorCode: "success" },
          { name: { value: "B" } },
          { name: { value: "C" }, errorCode: "" },
        ],
      }),
    ).toEqual([]);
  });

  test("a metric answered with as many series as were asked for may have more: it is capped", () => {
    expect(AzureArm.readCappedMetrics(SPLIT_ANSWER, 4)).toEqual([
      "IncomingMessages",
    ]);
    expect(AzureArm.readCappedMetrics(SPLIT_ANSWER, 5)).toEqual([]);
    expect(AzureArm.readCappedMetrics({ value: [] }, 1)).toEqual([]);
  });
});

describe("reading Service Bus and Event Hubs namespaces through the connection", () => {
  test("each namespace is one Azure Monitor call split by EntityName, never one a queue: 50 queues cost what one does", async () => {
    const one: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(1), [EVENT_HUBS]: queues(1) },
    });
    const fifty: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(50), [EVENT_HUBS]: queues(50) },
    });

    const oneRead: CloudReadResult = await read(one);
    const fiftyRead: CloudReadResult = await read(fifty);

    expect(callsTo(fifty, SERVICE_BUS)).toHaveLength(1);
    expect(callsTo(fifty, EVENT_HUBS)).toHaveLength(1);
    expect(fiftyRead.requestCount).toBe(oneRead.requestCount);
    expect(fifty.metricCalls).toHaveLength(one.metricCalls.length);

    const call: URL = callsTo(fifty, SERVICE_BUS)[0]!;
    expect(call.searchParams.get("$filter")).toBe("EntityName eq '*'");
    expect(call.searchParams.get("top")).toBe(
      String(AZURE_MAX_SPLIT_SERIES_PER_METRIC),
    );
    expect(call.searchParams.get("ValidateDimensions")).toBe("false");
    expect(call.searchParams.get("interval")).toBe("PT1M");
    // The six key metrics the namespace publishes, Size left out: one call's worth.
    expect(
      (call.searchParams.get("metricnames") || "").split(",").sort(),
    ).toEqual([
      "ActiveMessages",
      "DeadletteredMessages",
      "IncomingMessages",
      "OutgoingMessages",
      "ServerErrors",
      "ThrottledRequests",
    ]);
    expect(call.searchParams.get("aggregation")).toBe("Total,Average");

    // A virtual machine is never split.
    const vm: URL = callsTo(fifty, VM)[0]!;
    expect(vm.searchParams.has("$filter")).toBe(false);
    expect(vm.searchParams.has("top")).toBe(false);
    expect(vm.searchParams.has("ValidateDimensions")).toBe(false);

    // Every queue of every metric is written: 50 queues x 6 metrics x 2 minutes.
    const serviceBusPoints: Array<WrittenPoint> = written(fiftyRead).filter(
      (point: WrittenPoint): boolean => {
        return point.stored["name"] === "sb-orders";
      },
    );
    expect(serviceBusPoints).toHaveLength(50 * 6 * 2);
    expect(fiftyRead.warnings).toEqual([]);
  });

  test("each series is filed on its queue, topic or event hub, exactly as the azure_monitor receiver's are", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: {
        [SERVICE_BUS]: [
          { entity: "orders", values: [4, 5] },
          { entity: "audit-topic", values: [1, 2] },
          { entity: "-NamespaceOnlyMetric-", values: [9, 9] },
        ],
        [EVENT_HUBS]: [{ entity: "clickstream", values: [100, 120] }],
      },
    });

    const result: CloudReadResult = await read(fake);
    const points: Array<WrittenPoint> = written(result);

    const incoming: WrittenPoint = points.find(
      (point: WrittenPoint): boolean => {
        return (
          point.metricName === "azure_incomingmessages_total" &&
          point.stored[AZURE_ENTITY_NAME_ATTRIBUTE] === "orders"
        );
      },
    )!;

    expect(incoming.stored).toEqual(
      expect.objectContaining({
        "azuremonitor.resource_id": SERVICE_BUS,
        name: "sb-orders",
        // The catalog's spelling of the type; the Queues catalog reads any casing.
        type: "Microsoft.ServiceBus/namespaces",
        resource_group: "rg-msg",
        location: "westeurope",
        timegrain: "PT1M",
        metadata_entityname: "orders",
        "resource.azuremonitor.subscription_id": SUB,
        "resource.oneuptime.cloud.connection.id":
          "33333333-3333-4333-8333-333333333333",
      }),
    );

    // The metric names are the receiver's, so the Queues catalog knows them.
    expect(
      Array.from(
        new Set(
          points
            .filter((point: WrittenPoint): boolean => {
              return point.stored["name"] === "sb-orders";
            })
            .map((point: WrittenPoint): string => {
              return point.metricName;
            }),
        ),
      ).sort(),
    ).toEqual([
      "azure_activemessages_average",
      "azure_deadletteredmessages_average",
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ]);

    const destinationOf: (
      point: WrittenPoint,
    ) => ResolvedMessagingDestination | null = (
      point: WrittenPoint,
    ): ResolvedMessagingDestination | null => {
      return resolveMessagingMetricDatapoint({
        metricName: point.metricName,
        getAttribute: (key: string): unknown => {
          return point.stored[key];
        },
      });
    };

    // The ingest's own resolver files it on the namespace's queue.
    expect(destinationOf(incoming)).toEqual(
      expect.objectContaining({
        system: "servicebus",
        destination: "orders",
        brokerScope: "sb-orders",
      }),
    );

    const topic: WrittenPoint = points.find((point: WrittenPoint): boolean => {
      return (
        point.metricName === "azure_activemessages_average" &&
        point.stored[AZURE_ENTITY_NAME_ATTRIBUTE] === "audit-topic"
      );
    })!;
    expect(destinationOf(topic)).toEqual(
      expect.objectContaining({
        system: "servicebus",
        destination: "audit-topic",
      }),
    );

    const eventHub: WrittenPoint = points.find(
      (point: WrittenPoint): boolean => {
        return (
          point.metricName === "azure_incomingmessages_total" &&
          point.stored[AZURE_ENTITY_NAME_ATTRIBUTE] === "clickstream"
        );
      },
    )!;
    expect(destinationOf(eventHub)).toEqual(
      expect.objectContaining({
        system: "eventhubs",
        destination: "clickstream",
        brokerScope: "eh-clicks",
      }),
    );

    // The namespace's own share is no queue.
    const namespaceOnly: WrittenPoint = points.find(
      (point: WrittenPoint): boolean => {
        return (
          point.stored[AZURE_ENTITY_NAME_ATTRIBUTE] === "-NamespaceOnlyMetric-"
        );
      },
    )!;
    expect(destinationOf(namespaceOnly)).toBeNull();

    // Every series still lands on the namespace's cloud resource too.
    for (const point of [incoming, topic, namespaceOnly]) {
      const resource: CloudMonitoredResource | null =
        resolveCloudMonitoredResource({
          metricName: point.metricName,
          attributes: point.stored,
        });

      expect(resource?.providerResourceId).toBe(SERVICE_BUS);
    }
  });

  test("the namespace's readings are the sum of its queues at the newest minute, as its total was", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: {
        [SERVICE_BUS]: [
          { entity: "orders", values: [4, 5] },
          { entity: "invoices", values: [1, 2] },
          { entity: "-NamespaceOnlyMetric-", values: [0, 3] },
        ],
      },
    });

    const result: CloudReadResult = await read(fake);
    const readings: Array<{ type: string; readings: JSONObject }> = Array.from(
      collectCloudResourceReadings(result.payloads).values(),
    ).map((entry: { resourceType: string; readings: unknown }) => {
      return {
        type: entry.resourceType,
        readings: entry.readings as JSONObject,
      };
    });
    const namespace: JSONObject = readings.find(
      (entry: { type: string }): boolean => {
        return entry.type.toLowerCase() === "microsoft.servicebus/namespaces";
      },
    )!.readings;

    // 5 + 2 + 3 at the newest minute: every queue's dead letters, and the namespace's.
    expect((namespace["deadletteredmessages"] as JSONObject)["value"]).toBe(10);
    expect((namespace["servererrors"] as JSONObject)["value"]).toBe(10);
  });

  test("a namespace with no queues writes nothing of its own, and says nothing", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: [] },
    });

    const result: CloudReadResult = await read(fake);

    expect(
      written(result).filter((point: WrittenPoint): boolean => {
        return point.stored["name"] === "sb-orders";
      }),
    ).toEqual([]);
    expect(callsTo(fake, SERVICE_BUS)).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  test("a queue with no point that window is left out, the others written", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: {
        [SERVICE_BUS]: [
          { entity: "orders", values: [4, 5] },
          { entity: "idle", values: [null, null] },
        ],
      },
    });

    const result: CloudReadResult = await read(fake);
    const entities: Set<unknown> = new Set(
      written(result)
        .filter((point: WrittenPoint): boolean => {
          return point.stored["name"] === "sb-orders";
        })
        .map((point: WrittenPoint): unknown => {
          return point.stored[AZURE_ENTITY_NAME_ATTRIBUTE];
        }),
    );

    expect(Array.from(entities)).toEqual(["orders"]);
  });

  test("a metric Azure Monitor could not read is said once, with how many namespaces, and the rest is written", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(2), [EVENT_HUBS]: queues(2) },
      metricErrors: {
        [SERVICE_BUS]: { ThrottledRequests: "Metric is not available." },
        [EVENT_HUBS]: { ThrottledRequests: "Metric is not available." },
      },
    });

    const result: CloudReadResult = await read(fake);

    expect(result.warnings).toEqual([
      "Azure Monitor could not read ThrottledRequests of 2 resources: Metric is not available.",
    ]);
    const names: Set<string> = new Set(
      written(result).map((point: WrittenPoint): string => {
        return point.metricName;
      }),
    );
    expect(names.has("azure_throttledrequests_total")).toBe(false);
    expect(names.has("azure_incomingmessages_total")).toBe(true);
    expect(result.complete).toBe(true);
  });

  test("a namespace with as many queues as one read reads is said, with the way to read the rest", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(AZURE_MAX_SPLIT_SERIES_PER_METRIC) },
    });

    const result: CloudReadResult = await read(fake);

    expect(result.warnings).toEqual([
      "sb-orders has 1,000 or more queues, topics or event hubs: a read takes the metrics of 1,000 of them. The collector's azure_monitor receiver can read the rest.",
    ]);
    // Still one call.
    expect(callsTo(fake, SERVICE_BUS)).toHaveLength(1);
  });

  test("several such namespaces are said in one warning, each by name", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: {
        [SERVICE_BUS]: queues(AZURE_MAX_SPLIT_SERIES_PER_METRIC),
        [EVENT_HUBS]: queues(AZURE_MAX_SPLIT_SERIES_PER_METRIC + 5),
      },
    });

    const result: CloudReadResult = await read(fake);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(
      /^(sb-orders and eh-clicks|eh-clicks and sb-orders) have 1,000 or more queues, topics or event hubs each: a read takes the metrics of 1,000 of each\. The collector's azure_monitor receiver can read the rest\.$/,
    );
  });

  test("Azure Monitor's throttling - a 429, or a 529 while its queries are throttled - is asked again, and the read goes on", async () => {
    const fake: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(3) },
      metricResponses: {
        [SERVICE_BUS]: [
          {
            status: 429,
            body: '{"code":"TooManyRequests","message":"The request is throttled."}',
          },
          {
            status: 529,
            body: '{"code":"ServerBusy","message":"Too many metric queries."}',
          },
        ],
      },
    });
    const sleeps: Array<number> = [];

    const result: CloudReadResult = await read(fake, sleeps);

    // Asked three times: two throttled answers, then the read.
    expect(callsTo(fake, SERVICE_BUS)).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(
      written(result).filter((point: WrittenPoint): boolean => {
        return point.stored["name"] === "sb-orders";
      }),
    ).toHaveLength(3 * 6 * 2);
    expect(result.warnings).toEqual([]);
  });

  test("throttled past every retry, the namespace is said as not read this time, and the others are written", async () => {
    const throttled: FakeResponse = {
      status: 529,
      body: '{"code":"ServerBusy","message":"Too many metric queries."}',
    };
    const fake: FakeAzure = createFakeAzure({
      entities: { [SERVICE_BUS]: queues(3), [EVENT_HUBS]: queues(1) },
      metricResponses: {
        [SERVICE_BUS]: [throttled, throttled, throttled, throttled],
      },
    });

    const result: CloudReadResult = await read(fake);

    expect(callsTo(fake, SERVICE_BUS)).toHaveLength(4);
    expect(result.warnings).toEqual([
      "Could not read the metrics of 1 resource this time.",
    ]);
    expect(
      written(result).some((point: WrittenPoint): boolean => {
        return point.stored["name"] === "eh-clicks";
      }),
    ).toBe(true);
  });
});
