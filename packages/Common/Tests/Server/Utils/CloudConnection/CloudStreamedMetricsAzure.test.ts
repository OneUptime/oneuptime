import {
  buildMetricsPayloads,
  CloudMetricGroup,
  connectionResourceAttributes,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { withoutStreamedMetrics } from "../../../../Server/Utils/CloudConnection/CloudStreamedMetrics";
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
 * read leaves out the key metrics it reads a minute at a time - the stream
 * writes those, in the very same series - and keeps writing everything
 * else: another subscription's, another region's, another type's, and a
 * metric it reads at a coarser grain, which no stream writes. What it is
 * handed is never changed.
 */

const SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER_SUBSCRIPTION: string = "22222222-bbbb-4bbb-8bbb-222222222222";

function set(data: {
  name: string;
  type: string;
  location: string;
  grain: string;
}): CloudMetricGroup["metrics"][number]["datapointSets"][number] {
  return {
    attributes: [
      stringAttribute(
        "azuremonitor.resource_id",
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/${data.type}/${data.name}`,
      ),
      stringAttribute("name", data.name),
      stringAttribute("type", data.type),
      stringAttribute("resource_group", "rg"),
      stringAttribute("location", data.location),
      stringAttribute("timegrain", data.grain),
    ],
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

const PAYLOAD: JSONObject = buildMetricsPayloads([
  group(SUBSCRIPTION, [
    {
      name: "azure_percentage_cpu_average",
      unit: "Percent",
      datapointSets: [
        set({
          name: "web-01",
          type: "Microsoft.Compute/virtualMachines",
          location: "eastus",
          grain: "PT1M",
        }),
        set({
          name: "web-02",
          type: "Microsoft.Compute/virtualMachines",
          location: "westeurope",
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
          type: "Microsoft.Compute/virtualMachines",
          location: "eastus",
          grain: "PT1M",
        }),
      ],
    },
  ]),
])[0]!;

// What is left: "<subscription> <metric> <resource>" for each datapoint.
function written(payload: JSONObject | null): Array<string> {
  if (!payload) {
    return [];
  }

  const lines: Array<string> = [];

  for (const resource of payload["resourceMetrics"] as Array<JSONObject>) {
    const subscription: string = (
      (
        (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
      ).find((attribute: JSONObject) => {
        return attribute["key"] === "azuremonitor.subscription_id";
      })!["value"] as JSONObject
    )["stringValue"] as string;

    for (const metric of (resource["scopeMetrics"] as Array<JSONObject>)[0]![
      "metrics"
    ] as Array<JSONObject>) {
      for (const point of (metric["gauge"] as JSONObject)[
        "dataPoints"
      ] as JSONArray) {
        const name: string = (
          ((point as JSONObject)["attributes"] as Array<JSONObject>).find(
            (attribute: JSONObject) => {
              return attribute["key"] === "name";
            },
          )!["value"] as JSONObject
        )["stringValue"] as string;

        lines.push(`${subscription.slice(0, 8)} ${metric["name"]} ${name}`);
      }
    }
  }

  return lines;
}

describe("an Azure connection's read, while its event hubs deliver", () => {
  test("leaves out the key metrics read a minute at a time of the types streamed in their region, and only those", () => {
    const summary: CloudStreamSummary = {
      metricSources: [
        {
          accountId: SUBSCRIPTION,
          region: "eastus",
          namespaces: [
            "Microsoft.Compute/virtualMachines",
            "Microsoft.Storage/storageAccounts",
          ],
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
      // Read hourly: never the stream's.
      "11111111 azure_usedcapacity_average acmedata",
      // A type no stream delivered.
      "11111111 azure_requests_total checkout",
      // Another subscription.
      "22222222 azure_percentage_cpu_average db-01",
    ]);
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
      streamedKeys: new Set<string>([
        getStreamedMetricKey({
          accountId: SUBSCRIPTION,
          region: "eastus",
          namespace: "Microsoft.Compute/virtualMachines",
        }),
      ]),
    });

    expect(JSON.stringify(PAYLOAD)).toBe(before);
  });
});

describe("a streamed Service Bus namespace's queues", () => {
  const SERVICE_BUS_TYPE: string = "Microsoft.ServiceBus/namespaces";

  function namespaceSet(
    subscriptionId: string,
    entity: string | null,
  ): CloudMetricGroup["metrics"][number]["datapointSets"][number] {
    const attributes: CloudMetricGroup["metrics"][number]["datapointSets"][number]["attributes"] =
      [
        stringAttribute(
          "azuremonitor.resource_id",
          `/subscriptions/${subscriptionId}/resourceGroups/rg/providers/${SERVICE_BUS_TYPE}/sb-orders`,
        ),
        stringAttribute("name", "sb-orders"),
        stringAttribute("type", SERVICE_BUS_TYPE),
        stringAttribute("resource_group", "rg"),
        stringAttribute("location", "eastus"),
        stringAttribute("timegrain", "PT1M"),
      ];

    if (entity !== null) {
      attributes.push(stringAttribute("metadata_entityname", entity));
    }

    return {
      attributes,
      points: [{ timeMs: Date.UTC(2026, 10, 6, 10, 0), value: 3 }],
    };
  }

  const QUEUES: JSONObject = buildMetricsPayloads([
    group(SUBSCRIPTION, [
      {
        name: "azure_incomingmessages_total",
        unit: "Count",
        datapointSets: [
          namespaceSet(SUBSCRIPTION, "orders"),
          namespaceSet(SUBSCRIPTION, "invoices"),
          // A total split by nothing: the stream's.
          namespaceSet(SUBSCRIPTION, null),
        ],
      },
    ]),
    group(OTHER_SUBSCRIPTION, [
      {
        name: "azure_incomingmessages_total",
        unit: "Count",
        datapointSets: [namespaceSet(OTHER_SUBSCRIPTION, "orders")],
      },
    ]),
  ])[0]!;

  const STREAMED: Set<string> = new Set<string>([
    getStreamedMetricKey({
      accountId: SUBSCRIPTION,
      region: "eastus",
      namespace: SERVICE_BUS_TYPE,
    }),
  ]);

  function attributeKeysOf(payload: JSONObject): Array<Array<string>> {
    const keys: Array<Array<string>> = [];

    for (const resource of payload["resourceMetrics"] as Array<JSONObject>) {
      for (const metric of (resource["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>) {
        for (const point of (metric["gauge"] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          keys.push(
            (point["attributes"] as Array<JSONObject>).map(
              (attribute: JSONObject): string => {
                return attribute["key"] as string;
              },
            ),
          );
        }
      }
    }

    return keys;
  }

  test("are still the read's - a stream exports the namespace's totals only - without the namespace's resource id", () => {
    const result: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({ payload: QUEUES, streamedKeys: STREAMED });

    // Only the unsplit total is left to the stream.
    expect(result.leftOut).toBe(1);
    expect(written(result.payload)).toEqual([
      "11111111 azure_incomingmessages_total sb-orders",
      "11111111 azure_incomingmessages_total sb-orders",
      "22222222 azure_incomingmessages_total sb-orders",
    ]);

    const keys: Array<Array<string>> = attributeKeysOf(result.payload!);

    // The streamed subscription's queues: filed on their queue, not on the namespace.
    for (const pointKeys of keys.slice(0, 2)) {
      expect(pointKeys).not.toContain("azuremonitor.resource_id");
      expect(pointKeys).toEqual(
        expect.arrayContaining(["name", "type", "metadata_entityname"]),
      );
    }

    // Another subscription's queue is not streamed: written as read.
    expect(keys[2]).toContain("azuremonitor.resource_id");
  });

  test("what the read is handed is never changed", () => {
    const before: string = JSON.stringify(QUEUES);

    withoutStreamedMetrics({ payload: QUEUES, streamedKeys: STREAMED });

    expect(JSON.stringify(QUEUES)).toBe(before);
  });
});
