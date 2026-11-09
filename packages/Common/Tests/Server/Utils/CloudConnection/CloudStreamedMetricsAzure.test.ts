import {
  buildMetricsPayloads,
  CloudMetricGroup,
  connectionResourceAttributes,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { withoutStreamedMetrics } from "../../../../Server/Utils/CloudConnection/CloudStreamedMetrics";
import {
  AZURE_KEY_METRICS,
  AzureTypeKeyMetrics,
  getAzureStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudStreamSummary,
  getStreamedMetricKey,
  getStreamedMetricKeys,
} from "../../../../Types/CloudConnection/CloudStream";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * An Azure connection's read, while its event hubs deliver: of the
 * subscriptions, regions and resource types a stream delivered lately, the
 * read leaves out the key metrics the stream writes in its place - those
 * it reads a minute at a time that a diagnostic setting exports - and
 * keeps writing everything else, unchanged: another subscription's,
 * another region's, another type's, a metric it reads at a coarser grain,
 * one a diagnostic setting cannot export, and every series of a Service
 * Bus or Event Hubs namespace, which it splits by queue. What it is handed
 * is never changed.
 */

const SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER_SUBSCRIPTION: string = "22222222-bbbb-4bbb-8bbb-222222222222";
const VM_TYPE: string = "Microsoft.Compute/virtualMachines";
const SERVICE_BUS_TYPE: string = "Microsoft.ServiceBus/namespaces";
const EVENT_HUBS_TYPE: string = "Microsoft.EventHub/namespaces";

type DatapointSet =
  CloudMetricGroup["metrics"][number]["datapointSets"][number];

function set(data: {
  name: string;
  type: string;
  location: string;
  grain: string;
  subscriptionId?: string;
  entity?: string | undefined;
}): DatapointSet {
  const attributes: DatapointSet["attributes"] = [
    stringAttribute(
      "azuremonitor.resource_id",
      `/subscriptions/${data.subscriptionId || SUBSCRIPTION}/resourceGroups/rg/providers/${data.type}/${data.name}`,
    ),
    stringAttribute("name", data.name),
    stringAttribute("type", data.type),
    stringAttribute("resource_group", "rg"),
    stringAttribute("location", data.location),
    stringAttribute("timegrain", data.grain),
  ];

  if (data.entity !== undefined) {
    attributes.push(stringAttribute("metadata_entityname", data.entity));
  }

  return {
    attributes,
    points: [{ timeMs: Date.UTC(2026, 10, 6, 10, 0), value: 1 }],
  };
}

function group(
  subscriptionId: string,
  metrics: CloudMetricGroup["metrics"],
): CloudMetricGroup {
  return {
    resourceAttributes: [
      ...connectionResourceAttributes({
        serviceName: "Production Azure",
        connectionId: "33333333-3333-4333-8333-333333333333",
        cloudProvider: CloudProvider.Azure,
      }),
      stringAttribute("azuremonitor.subscription_id", subscriptionId),
    ],
    metrics,
  };
}

function streamed(types: Array<string>, region: string): Set<string> {
  return new Set<string>(
    types.map((type: string): string => {
      return getStreamedMetricKey({
        accountId: SUBSCRIPTION,
        region,
        namespace: type,
      });
    }),
  );
}

const PAYLOAD: JSONObject = buildMetricsPayloads([
  group(SUBSCRIPTION, [
    {
      name: "azure_percentage_cpu_average",
      unit: "Percent",
      datapointSets: [
        set({
          name: "web-01",
          type: VM_TYPE,
          location: "eastus",
          grain: "PT1M",
        }),
        set({
          name: "web-02",
          type: VM_TYPE,
          location: "westeurope",
          grain: "PT1M",
        }),
      ],
    },
    {
      name: "azure_network_in_total_total",
      unit: "Bytes",
      datapointSets: [
        set({
          name: "web-01",
          type: VM_TYPE,
          location: "eastus",
          grain: "PT1M",
        }),
      ],
    },
    {
      name: "azure_transactions_total",
      unit: "Count",
      datapointSets: [
        set({
          name: "acmedata",
          type: "Microsoft.Storage/storageAccounts",
          location: "eastus",
          grain: "PT1M",
        }),
      ],
    },
    {
      name: "azure_usedcapacity_average",
      unit: "Bytes",
      datapointSets: [
        set({
          name: "acmedata",
          type: "Microsoft.Storage/storageAccounts",
          location: "eastus",
          grain: "PT1H",
        }),
      ],
    },
    {
      name: "azure_requests_total",
      unit: "Count",
      datapointSets: [
        set({
          name: "checkout",
          type: "Microsoft.Web/sites",
          location: "eastus",
          grain: "PT1M",
        }),
      ],
    },
  ]),
  group(OTHER_SUBSCRIPTION, [
    {
      name: "azure_percentage_cpu_average",
      unit: "Percent",
      datapointSets: [
        set({
          name: "db-01",
          type: VM_TYPE,
          location: "eastus",
          grain: "PT1M",
          subscriptionId: OTHER_SUBSCRIPTION,
        }),
      ],
    },
  ]),
])[0]!;

function attributeOf(point: JSONObject, key: string): string | undefined {
  const attribute: JSONObject | undefined = (
    point["attributes"] as Array<JSONObject>
  ).find((candidate: JSONObject) => {
    return candidate["key"] === key;
  });

  return attribute
    ? ((attribute["value"] as JSONObject)["stringValue"] as string)
    : undefined;
}

function pointsOf(payload: JSONObject | null): Array<{
  subscription: string;
  metric: string;
  point: JSONObject;
}> {
  if (!payload) {
    return [];
  }

  const points: Array<{
    subscription: string;
    metric: string;
    point: JSONObject;
  }> = [];

  for (const resource of payload["resourceMetrics"] as Array<JSONObject>) {
    const subscription: string = attributeOf(
      resource["resource"] as JSONObject,
      "azuremonitor.subscription_id",
    )!;

    for (const metric of (resource["scopeMetrics"] as Array<JSONObject>)[0]![
      "metrics"
    ] as Array<JSONObject>) {
      for (const point of (metric["gauge"] as JSONObject)[
        "dataPoints"
      ] as JSONArray) {
        points.push({
          subscription,
          metric: metric["name"] as string,
          point: point as JSONObject,
        });
      }
    }
  }

  return points;
}

// What is left: "<subscription> <metric> <resource>" for each datapoint.
function written(payload: JSONObject | null): Array<string> {
  return pointsOf(payload).map(
    (entry: {
      subscription: string;
      metric: string;
      point: JSONObject;
    }): string => {
      return `${entry.subscription.slice(0, 8)} ${entry.metric} ${attributeOf(
        entry.point,
        "name",
      )}`;
    },
  );
}

describe("an Azure connection's read, while its event hubs deliver", () => {
  test("leaves out the key metrics a stream writes of the types streamed in their region, and only those", () => {
    const summary: CloudStreamSummary = {
      metricSources: [
        {
          accountId: SUBSCRIPTION,
          region: "eastus",
          namespaces: [VM_TYPE, "Microsoft.Storage/storageAccounts"],
          lastAt: new Date().toISOString(),
        },
      ],
      logSources: [],
    };
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: getStreamedMetricKeys({ summary, now: new Date() }),
      });

    expect(result.leftOut).toBe(2);
    expect(written(result.payload)).toEqual([
      // Another region's VM: streamed from no event hub of its own.
      "11111111 azure_percentage_cpu_average web-02",
      // A diagnostic setting cannot export it: the read's, streamed or not.
      "11111111 azure_network_in_total_total web-01",
      // Read hourly: never the stream's.
      "11111111 azure_usedcapacity_average acmedata",
      // A type no stream delivered.
      "11111111 azure_requests_total checkout",
      // Another subscription.
      "22222222 azure_percentage_cpu_average db-01",
    ]);
  });

  test("a metric no stream delivers keeps the attribute that files it on its resource", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: streamed([VM_TYPE], "eastus"),
      });
    const network: JSONObject = pointsOf(result.payload).find(
      (entry: { metric: string }): boolean => {
        return entry.metric === "azure_network_in_total_total";
      },
    )!.point;

    expect(attributeOf(network, "azuremonitor.resource_id")).toBe(
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/${VM_TYPE}/web-01`,
    );
    expect(attributeOf(network, "timegrain")).toBe("PT1M");
  });

  test("the key is the subscription, the region and the type, whatever their case", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>([
          getStreamedMetricKey({
            accountId: SUBSCRIPTION.toUpperCase(),
            region: "EastUS",
            namespace: "microsoft.web/SITES",
          }),
        ]),
      });

    expect(result.leftOut).toBe(1);
    expect(written(result.payload)).not.toContain(
      "11111111 azure_requests_total checkout",
    );
  });

  test("with no stream lately it writes everything, and what it is handed is never changed", () => {
    const before: string = JSON.stringify(PAYLOAD);

    expect(
      withoutStreamedMetrics({ payload: PAYLOAD, streamedKeys: new Set() }),
    ).toEqual({
      payload: PAYLOAD,
      leftOut: 0,
    });

    withoutStreamedMetrics({
      payload: PAYLOAD,
      streamedKeys: streamed([VM_TYPE], "eastus"),
    });

    expect(JSON.stringify(PAYLOAD)).toBe(before);
  });
});

describe("every key metric of every type, while a stream delivers every type", () => {
  const label: (entry: AzureTypeKeyMetrics, metric: string) => string = (
    entry: AzureTypeKeyMetrics,
    metric: string,
  ): string => {
    return `${entry.type} ${metric}`;
  };

  // One datapoint of each key metric of each type, as the read writes it.
  const EVERY: JSONObject = buildMetricsPayloads([
    group(
      SUBSCRIPTION,
      AZURE_KEY_METRICS.flatMap(
        (entry: AzureTypeKeyMetrics): CloudMetricGroup["metrics"] => {
          return entry.metrics.map(
            (metric: string): CloudMetricGroup["metrics"][number] => {
              return {
                name: getAzureStoredMetricName(metric, "Average"),
                unit: "Count",
                datapointSets: [
                  set({
                    name: label(entry, metric),
                    type: entry.type,
                    location: "eastus",
                    grain: "PT1M",
                    ...(entry.splitByDimension ? { entity: "orders" } : {}),
                  }),
                ],
              };
            },
          );
        },
      ),
    ),
  ])[0]!;

  const ALL_TYPES: Array<string> = AZURE_KEY_METRICS.map(
    (entry: AzureTypeKeyMetrics): string => {
      return entry.type;
    },
  );

  test("the read keeps exactly the ones a diagnostic setting cannot export, and every one of a namespace it splits by queue", () => {
    const kept: Array<string> = [];
    let streamedCount: number = 0;

    for (const entry of AZURE_KEY_METRICS) {
      for (const metric of entry.metrics) {
        if (
          entry.splitByDimension ||
          (entry.notExportedByDiagnosticSettings || []).includes(metric)
        ) {
          kept.push(
            `11111111 ${getAzureStoredMetricName(metric, "Average")} ${label(entry, metric)}`,
          );
        } else {
          streamedCount++;
        }
      }
    }

    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: EVERY,
        streamedKeys: streamed(ALL_TYPES, "eastus"),
      });

    expect(written(result.payload)).toEqual(kept);
    expect(result.leftOut).toBe(streamedCount);
    // Both sides are real: some metrics are the stream's, some stay the read's.
    expect(streamedCount).toBeGreaterThan(50);
    expect(kept.length).toBe(30);
  });

  test("a type whose every key metric a diagnostic setting cannot export loses none of them", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: EVERY,
        streamedKeys: streamed(
          [
            "Microsoft.Network/natGateways",
            "Microsoft.Compute/disks",
            "Microsoft.DocumentDB/databaseAccounts",
          ],
          "eastus",
        ),
      });

    expect(result.leftOut).toBe(0);
    expect(written(result.payload)).toEqual(written(EVERY));
  });

  test("in a region no stream delivers, the read writes every one of them", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: EVERY,
        streamedKeys: streamed(ALL_TYPES, "westeurope"),
      });

    expect(result.leftOut).toBe(0);
    expect(written(result.payload)).toEqual(written(EVERY));
  });
});

describe("a streamed Service Bus or Event Hubs namespace", () => {
  function namespaceSet(data: {
    subscriptionId: string;
    type: string;
    namespace: string;
    entity: string | null;
  }): DatapointSet {
    return set({
      name: data.namespace,
      type: data.type,
      location: "eastus",
      grain: "PT1M",
      subscriptionId: data.subscriptionId,
      ...(data.entity !== null ? { entity: data.entity } : {}),
    });
  }

  const QUEUES: JSONObject = buildMetricsPayloads([
    group(SUBSCRIPTION, [
      {
        // Exported by a diagnostic setting, as the namespace's total only.
        name: "azure_incomingmessages_total",
        unit: "Count",
        datapointSets: [
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "orders",
          }),
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "invoices",
          }),
          // A total split by nothing.
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: null,
          }),
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: EVENT_HUBS_TYPE,
            namespace: "eh-telemetry",
            entity: "clicks",
          }),
        ],
      },
      {
        // Not exported by a diagnostic setting at all.
        name: "azure_activemessages_average",
        unit: "Count",
        datapointSets: [
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "orders",
          }),
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "invoices",
          }),
        ],
      },
      {
        name: "azure_servererrors_total",
        unit: "Count",
        datapointSets: [
          namespaceSet({
            subscriptionId: SUBSCRIPTION,
            type: EVENT_HUBS_TYPE,
            namespace: "eh-telemetry",
            entity: "clicks",
          }),
        ],
      },
    ]),
    group(OTHER_SUBSCRIPTION, [
      {
        name: "azure_incomingmessages_total",
        unit: "Count",
        datapointSets: [
          namespaceSet({
            subscriptionId: OTHER_SUBSCRIPTION,
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "orders",
          }),
        ],
      },
    ]),
  ])[0]!;

  const STREAMED: Set<string> = streamed(
    [SERVICE_BUS_TYPE, EVENT_HUBS_TYPE],
    "eastus",
  );

  test("is written whole by the read - every queue's series of every metric, exported or not - and a stream writes none of it", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({ payload: QUEUES, streamedKeys: STREAMED });

    expect(result.leftOut).toBe(0);
    expect(written(result.payload)).toEqual([
      "11111111 azure_incomingmessages_total sb-orders",
      "11111111 azure_incomingmessages_total sb-orders",
      "11111111 azure_incomingmessages_total sb-orders",
      "11111111 azure_incomingmessages_total eh-telemetry",
      "11111111 azure_activemessages_average sb-orders",
      "11111111 azure_activemessages_average sb-orders",
      "11111111 azure_servererrors_total eh-telemetry",
      "22222222 azure_incomingmessages_total sb-orders",
    ]);
    expect(result.payload).toEqual(QUEUES);
  });

  test("each queue's series stays on the namespace's resource id, which its totals add up, and on its queue", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({ payload: QUEUES, streamedKeys: STREAMED });

    for (const entry of pointsOf(result.payload)) {
      expect(attributeOf(entry.point, "azuremonitor.resource_id")).toBe(
        `/subscriptions/${entry.subscription}/resourceGroups/rg/providers/${attributeOf(
          entry.point,
          "type",
        )}/${attributeOf(entry.point, "name")}`,
      );
    }

    expect(
      pointsOf(result.payload).map(
        (entry: { point: JSONObject }): string | undefined => {
          return attributeOf(entry.point, "metadata_entityname");
        },
      ),
    ).toEqual([
      "orders",
      "invoices",
      undefined,
      "clicks",
      "orders",
      "invoices",
      "clicks",
      "orders",
    ]);
  });

  test("what the read is handed is never changed", () => {
    const before: string = JSON.stringify(QUEUES);

    withoutStreamedMetrics({ payload: QUEUES, streamedKeys: STREAMED });

    expect(JSON.stringify(QUEUES)).toBe(before);
  });
});
