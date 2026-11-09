import { describe, expect, test } from "@jest/globals";
import {
  COLLECTOR_ENTITY_ATTRIBUTES,
  COLLECTOR_QUEUE_LOOKBACK_MS,
  CollectorMessagingQueues,
  NO_COLLECTOR_QUEUES,
  getMessagingNamespaceSeriesKey,
  getMessagingQueueSeriesKey,
  getSplitMessagingMetricNames,
  isSplitMessagingType,
  readMessagingQueueSeriesKey,
  withoutCollectorQueues,
} from "../../../../Server/Utils/CloudConnection/CloudCollectorQueues";
import {
  COLLECTOR_QUEUE_LOOKUP_LIMIT,
  readCollectorQueuesFromRows,
} from "../../../../Server/Utils/CloudConnection/CloudCollectorQueuesReader";
import CloudConnectionPullRunner, {
  COLLECTOR_QUEUES_UNKNOWN_WARNING,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionPullRunner";
import {
  buildMetricsPayloads,
  CloudMetricGroup,
  OtlpAttribute,
  connectionResourceAttributes,
  stringAttribute,
} from "../../../../Server/Utils/CloudConnection/CloudMetricPayload";
import { withoutStreamedMetrics } from "../../../../Server/Utils/CloudConnection/CloudStreamedMetrics";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { getStreamedMetricKey } from "../../../../Types/CloudConnection/CloudStream";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A queue a collector reads is the collector's: of an Azure connection's
 * split Service Bus and Event Hubs read, the series of each queue and
 * metric a collector's azure_monitor receiver delivered in the last half
 * hour are left out of what the read writes - every other queue, and every
 * metric the collector does not read, the read writes. Where a collector
 * sent a namespace's own total of a metric, split by no queue, the read
 * still writes each queue's series of it, but off the namespace: without
 * the resource id the namespace's totals add up. What it is handed is
 * never changed.
 */

const SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const PROJECT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-11-09T10:30:00Z");
const SERVICE_BUS_TYPE: string = "Microsoft.ServiceBus/namespaces";
const EVENT_HUBS_TYPE: string = "Microsoft.EventHub/namespaces";

function series(data: {
  namespace: string;
  type?: string;
  entity?: string;
  entityKey?: string;
  values?: Array<number>;
}): CloudMetricGroup["metrics"][number]["datapointSets"][number] {
  const type: string = data.type || SERVICE_BUS_TYPE;
  const attributes: Array<OtlpAttribute> = [
    stringAttribute(
      "azuremonitor.resource_id",
      `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/${type}/${data.namespace}`,
    ),
    stringAttribute("name", data.namespace),
    stringAttribute("type", type),
    stringAttribute("resource_group", "rg"),
    stringAttribute("location", "westeurope"),
    stringAttribute("timegrain", "PT1M"),
  ];

  if (data.entity !== undefined) {
    attributes.push(
      stringAttribute(data.entityKey || "metadata_entityname", data.entity),
    );
  }

  return {
    attributes,
    points: (data.values || [1, 2]).map(
      (value: number, index: number): { timeMs: number; value: number } => {
        return { timeMs: Date.UTC(2026, 10, 9, 10, 20 + index), value };
      },
    ),
  };
}

function payloadOf(metrics: CloudMetricGroup["metrics"]): JSONObject {
  return buildMetricsPayloads([
    {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "Production Azure",
          connectionId: "33333333-3333-4333-8333-333333333333",
          cloudProvider: CloudProvider.Azure,
        }),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      metrics,
    },
  ])[0]!;
}

const PAYLOAD: JSONObject = payloadOf([
  {
    name: "azure_incomingmessages_total",
    unit: "Count",
    datapointSets: [
      series({ namespace: "sb-orders", entity: "orders" }),
      series({ namespace: "sb-orders", entity: "invoices" }),
      series({
        namespace: "eh-clicks",
        type: EVENT_HUBS_TYPE,
        entity: "clicks",
      }),
    ],
  },
  {
    name: "azure_activemessages_average",
    unit: "Count",
    datapointSets: [
      series({ namespace: "sb-orders", entity: "orders" }),
      series({ namespace: "sb-orders", entity: "invoices" }),
    ],
  },
  {
    // A virtual machine: never split, never a collector's queue.
    name: "azure_percentage_cpu_average",
    unit: "Percent",
    datapointSets: [
      series({
        namespace: "vm-web-1",
        type: "Microsoft.Compute/virtualMachines",
      }),
    ],
  },
]);

// Each written series as metric|namespace|entity, with its point count.
function seriesWritten(payload: JSONObject | null): Array<string> {
  const found: Array<string> = [];

  for (const rm of ((payload || {})["resourceMetrics"] as JSONArray) || []) {
    for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
      for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
        for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
          "dataPoints"
        ] as JSONArray) {
          const attributes: Array<OtlpAttribute> = (point as JSONObject)[
            "attributes"
          ] as unknown as Array<OtlpAttribute>;
          const valueOf: (key: string) => string = (key: string): string => {
            const attribute: OtlpAttribute | undefined = attributes.find(
              (candidate: OtlpAttribute): boolean => {
                return candidate.key === key;
              },
            );
            return (
              (attribute?.value as { stringValue?: string } | undefined)
                ?.stringValue || ""
            );
          };

          found.push(
            `${(metric as JSONObject)["name"] as string}|${valueOf("name")}|${
              valueOf("metadata_entityname") || valueOf("metadata_EntityName")
            }`,
          );
        }
      }
    }
  }

  return found;
}

// Each written series as metric|namespace|entity|its resource id, or none.
function seriesFiled(payload: JSONObject | null): Array<string> {
  const found: Array<string> = [];

  for (const rm of ((payload || {})["resourceMetrics"] as JSONArray) || []) {
    for (const sm of (rm as JSONObject)["scopeMetrics"] as JSONArray) {
      for (const metric of (sm as JSONObject)["metrics"] as JSONArray) {
        for (const point of ((metric as JSONObject)["gauge"] as JSONObject)[
          "dataPoints"
        ] as JSONArray) {
          const attributes: Array<OtlpAttribute> = (point as JSONObject)[
            "attributes"
          ] as unknown as Array<OtlpAttribute>;
          const valueOf: (key: string) => string = (key: string): string => {
            const attribute: OtlpAttribute | undefined = attributes.find(
              (candidate: OtlpAttribute): boolean => {
                return candidate.key === key;
              },
            );
            return (
              (attribute?.value as { stringValue?: string } | undefined)
                ?.stringValue || ""
            );
          };
          const resourceId: string = valueOf("azuremonitor.resource_id");

          found.push(
            `${(metric as JSONObject)["name"] as string}|${valueOf("name")}|${valueOf(
              "metadata_entityname",
            )}|${resourceId ? resourceId.split("/").slice(-1)[0] : "none"}`,
          );
        }
      }
    }
  }

  return found;
}

function collector(data: {
  series?: Array<string>;
  wholeNamespaces?: Array<string>;
  namespaceTotals?: Array<string>;
}): CollectorMessagingQueues {
  return {
    series: new Set<string>(data.series || []),
    wholeNamespaces: new Set<string>(data.wholeNamespaces || []),
    namespaceTotals: new Set<string>(data.namespaceTotals || []),
  };
}

describe("one queue's metric, as a key", () => {
  test("is the metric, the type, the namespace and the entity, whatever their case or spaces", () => {
    expect(
      getMessagingQueueSeriesKey({
        metricName: "azure_incomingmessages_total",
        type: "Microsoft.ServiceBus/Namespaces",
        namespace: " SB-Orders ",
        entity: "Orders",
      }),
    ).toBe(
      getMessagingQueueSeriesKey({
        metricName: "AZURE_INCOMINGMESSAGES_TOTAL",
        type: "microsoft.servicebus/namespaces",
        namespace: "sb-orders",
        entity: "orders",
      }),
    );
    // A namespace's key is the queue's without the entity.
    expect(
      getMessagingQueueSeriesKey({
        metricName: "m",
        type: "t",
        namespace: "n",
        entity: "e",
      }).startsWith(
        `${getMessagingNamespaceSeriesKey({ metricName: "m", type: "t", namespace: "n" })}\n`,
      ),
    ).toBe(true);
    // Another queue, metric or namespace is another key.
    expect(
      new Set([
        getMessagingQueueSeriesKey({
          metricName: "m",
          type: SERVICE_BUS_TYPE,
          namespace: "a",
          entity: "q",
        }),
        getMessagingQueueSeriesKey({
          metricName: "m",
          type: SERVICE_BUS_TYPE,
          namespace: "b",
          entity: "q",
        }),
        getMessagingQueueSeriesKey({
          metricName: "m",
          type: EVENT_HUBS_TYPE,
          namespace: "a",
          entity: "q",
        }),
        getMessagingQueueSeriesKey({
          metricName: "n",
          type: SERVICE_BUS_TYPE,
          namespace: "a",
          entity: "q",
        }),
      ]).size,
    ).toBe(4);
  });

  test("only Service Bus and Event Hubs namespaces are split", () => {
    expect(isSplitMessagingType("Microsoft.ServiceBus/namespaces")).toBe(true);
    expect(isSplitMessagingType("MICROSOFT.EVENTHUB/NAMESPACES")).toBe(true);
    expect(isSplitMessagingType("Microsoft.Compute/virtualMachines")).toBe(
      false,
    );
    expect(isSplitMessagingType("")).toBe(false);
  });

  test("a datapoint's key reads the entity in either of the receiver's spellings", () => {
    expect(COLLECTOR_ENTITY_ATTRIBUTES).toEqual([
      "metadata_entityname",
      "metadata_EntityName",
    ]);

    for (const entityKey of COLLECTOR_ENTITY_ATTRIBUTES) {
      expect(
        readMessagingQueueSeriesKey(
          "azure_activemessages_average",
          series({ namespace: "sb-orders", entity: "orders", entityKey })
            .attributes as unknown as JSONArray,
        ),
      ).toEqual({
        metricName: "azure_activemessages_average",
        type: SERVICE_BUS_TYPE,
        namespace: "sb-orders",
        entity: "orders",
      });
    }

    // Unsplit, another type, or no namespace: no queue's metric.
    expect(
      readMessagingQueueSeriesKey(
        "azure_activemessages_average",
        series({ namespace: "sb-orders" }).attributes as unknown as JSONArray,
      ),
    ).toBeNull();
    expect(
      readMessagingQueueSeriesKey(
        "azure_percentage_cpu_average",
        series({
          namespace: "vm-1",
          type: "Microsoft.Compute/virtualMachines",
          entity: "x",
        }).attributes as unknown as JSONArray,
      ),
    ).toBeNull();
    expect(
      readMessagingQueueSeriesKey("", [
        stringAttribute("type", SERVICE_BUS_TYPE),
        stringAttribute("name", "sb"),
        stringAttribute("metadata_entityname", "q"),
      ] as unknown as JSONArray),
    ).toBeNull();
    expect(
      readMessagingQueueSeriesKey("azure_size_average", [
        stringAttribute("type", SERVICE_BUS_TYPE),
        stringAttribute("metadata_entityname", "q"),
      ] as unknown as JSONArray),
    ).toBeNull();
  });
});

describe("the metrics a read split per queue", () => {
  test("are the ones with a queue's series, sorted, each named once", () => {
    expect(getSplitMessagingMetricNames([PAYLOAD, PAYLOAD])).toEqual([
      "azure_activemessages_average",
      "azure_incomingmessages_total",
    ]);
  });

  test("are none for a read of nothing split: nothing is looked up", () => {
    expect(
      getSplitMessagingMetricNames([
        payloadOf([
          {
            name: "azure_percentage_cpu_average",
            unit: "Percent",
            datapointSets: [
              series({
                namespace: "vm-web-1",
                type: "Microsoft.Compute/virtualMachines",
              }),
            ],
          },
        ]),
        { resourceMetrics: [] },
        {},
      ]),
    ).toEqual([]);
  });
});

describe("a read's payload without the collector's queues", () => {
  test("leaves out each queue's metric a collector delivered, and nothing else", () => {
    const toWrite: { payload: JSONObject | null; leftOut: number } =
      withoutCollectorQueues({
        payload: PAYLOAD,
        collector: collector({
          series: [
            getMessagingQueueSeriesKey({
              metricName: "azure_incomingmessages_total",
              type: SERVICE_BUS_TYPE,
              namespace: "sb-orders",
              entity: "orders",
            }),
          ],
        }),
      });

    // The collector's orders incoming messages (two minutes) are left out.
    expect(toWrite.leftOut).toBe(2);
    expect(seriesWritten(toWrite.payload)).toEqual([
      "azure_incomingmessages_total|sb-orders|invoices",
      "azure_incomingmessages_total|sb-orders|invoices",
      "azure_incomingmessages_total|eh-clicks|clicks",
      "azure_incomingmessages_total|eh-clicks|clicks",
      // A metric the collector does not read of that queue: the read's.
      "azure_activemessages_average|sb-orders|orders",
      "azure_activemessages_average|sb-orders|orders",
      "azure_activemessages_average|sb-orders|invoices",
      "azure_activemessages_average|sb-orders|invoices",
      "azure_percentage_cpu_average|vm-web-1|",
      "azure_percentage_cpu_average|vm-web-1|",
    ]);
  });

  test("a whole namespace's metric is the collector's when its queues could not all be listed", () => {
    const toWrite: { payload: JSONObject | null; leftOut: number } =
      withoutCollectorQueues({
        payload: PAYLOAD,
        collector: collector({
          wholeNamespaces: [
            getMessagingNamespaceSeriesKey({
              metricName: "azure_activemessages_average",
              type: SERVICE_BUS_TYPE,
              namespace: "SB-ORDERS",
            }),
          ],
        }),
      });

    expect(toWrite.leftOut).toBe(4);
    expect(
      seriesWritten(toWrite.payload).filter((entry: string): boolean => {
        return entry.startsWith("azure_activemessages_average");
      }),
    ).toEqual([]);
  });

  test("a metric left without points goes, and a payload left without any is nothing to write", () => {
    const everyQueue: CollectorMessagingQueues = collector({
      series: [
        [
          "azure_incomingmessages_total",
          SERVICE_BUS_TYPE,
          "sb-orders",
          "orders",
        ],
        [
          "azure_incomingmessages_total",
          SERVICE_BUS_TYPE,
          "sb-orders",
          "invoices",
        ],
        [
          "azure_incomingmessages_total",
          EVENT_HUBS_TYPE,
          "eh-clicks",
          "clicks",
        ],
        [
          "azure_activemessages_average",
          SERVICE_BUS_TYPE,
          "sb-orders",
          "orders",
        ],
        [
          "azure_activemessages_average",
          SERVICE_BUS_TYPE,
          "sb-orders",
          "invoices",
        ],
      ].map((parts: Array<string>): string => {
        return getMessagingQueueSeriesKey({
          metricName: parts[0]!,
          type: parts[1]!,
          namespace: parts[2]!,
          entity: parts[3]!,
        });
      }),
    });

    const toWrite: { payload: JSONObject | null; leftOut: number } =
      withoutCollectorQueues({ payload: PAYLOAD, collector: everyQueue });

    // Only the virtual machine is left.
    expect(seriesWritten(toWrite.payload)).toEqual([
      "azure_percentage_cpu_average|vm-web-1|",
      "azure_percentage_cpu_average|vm-web-1|",
    ]);
    expect(toWrite.leftOut).toBe(10);

    const onlyQueues: JSONObject = payloadOf([
      {
        name: "azure_incomingmessages_total",
        unit: "Count",
        datapointSets: [series({ namespace: "sb-orders", entity: "orders" })],
      },
    ]);
    expect(
      withoutCollectorQueues({ payload: onlyQueues, collector: everyQueue }),
    ).toEqual({ payload: null, leftOut: 2, offNamespace: 0 });
  });

  test("with no collector, the payload is written as it is, and never changed", () => {
    const before: string = JSON.stringify(PAYLOAD);

    expect(
      withoutCollectorQueues({
        payload: PAYLOAD,
        collector: NO_COLLECTOR_QUEUES,
      }),
    ).toEqual({ payload: PAYLOAD, leftOut: 0, offNamespace: 0 });
    expect(NO_COLLECTOR_QUEUES.namespaceTotals.size).toBe(0);

    withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({
        wholeNamespaces: [
          getMessagingNamespaceSeriesKey({
            metricName: "azure_incomingmessages_total",
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
          }),
        ],
        namespaceTotals: [
          getMessagingNamespaceSeriesKey({
            metricName: "azure_activemessages_average",
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
          }),
        ],
      }),
    });

    expect(JSON.stringify(PAYLOAD)).toBe(before);
  });

  test("after a stream's filter, a streamed namespace's queues the collector reads are still the collector's", () => {
    const streamed: { payload: JSONObject | null; leftOut: number } =
      withoutStreamedMetrics({
        payload: PAYLOAD,
        streamedKeys: new Set<string>([
          getStreamedMetricKey({
            accountId: SUBSCRIPTION,
            region: "westeurope",
            namespace: SERVICE_BUS_TYPE,
          }),
        ]),
      });
    const toWrite: { payload: JSONObject | null; leftOut: number } =
      withoutCollectorQueues({
        payload: streamed.payload!,
        collector: collector({
          series: [
            getMessagingQueueSeriesKey({
              metricName: "azure_activemessages_average",
              type: SERVICE_BUS_TYPE,
              namespace: "sb-orders",
              entity: "invoices",
            }),
          ],
        }),
      });

    // A stream writes none of a namespace's metrics: the read keeps them all.
    expect(streamed.leftOut).toBe(0);
    expect(streamed.payload).toEqual(PAYLOAD);
    expect(toWrite.leftOut).toBe(2);
    expect(seriesWritten(toWrite.payload)).not.toContain(
      "azure_activemessages_average|sb-orders|invoices",
    );
    expect(seriesWritten(toWrite.payload)).toContain(
      "azure_activemessages_average|sb-orders|orders",
    );
  });
});

describe("a namespace's own total a collector sent", () => {
  const INCOMING_TOTAL: string = getMessagingNamespaceSeriesKey({
    metricName: "azure_incomingmessages_total",
    type: SERVICE_BUS_TYPE,
    namespace: "sb-orders",
  });

  test("keeps the read's queues of that metric off the namespace, still filed on each queue", () => {
    const toWrite: {
      payload: JSONObject | null;
      leftOut: number;
      offNamespace: number;
    } = withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({ namespaceTotals: [INCOMING_TOTAL] }),
    });

    expect(toWrite.leftOut).toBe(0);
    expect(toWrite.offNamespace).toBe(4);
    expect(seriesFiled(toWrite.payload)).toEqual([
      // The collector's total is the namespace's: these count on their queues alone.
      "azure_incomingmessages_total|sb-orders|orders|none",
      "azure_incomingmessages_total|sb-orders|orders|none",
      "azure_incomingmessages_total|sb-orders|invoices|none",
      "azure_incomingmessages_total|sb-orders|invoices|none",
      // Another namespace, another metric, another type: on their resource.
      "azure_incomingmessages_total|eh-clicks|clicks|eh-clicks",
      "azure_incomingmessages_total|eh-clicks|clicks|eh-clicks",
      "azure_activemessages_average|sb-orders|orders|sb-orders",
      "azure_activemessages_average|sb-orders|orders|sb-orders",
      "azure_activemessages_average|sb-orders|invoices|sb-orders",
      "azure_activemessages_average|sb-orders|invoices|sb-orders",
      "azure_percentage_cpu_average|vm-web-1||vm-web-1",
      "azure_percentage_cpu_average|vm-web-1||vm-web-1",
    ]);
  });

  test("only the resource id goes: every other attribute and every value stays", () => {
    const toWrite: { payload: JSONObject | null } = withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({ namespaceTotals: [INCOMING_TOTAL] }),
    });
    const pointsOf: (payload: JSONObject) => Array<JSONObject> = (
      payload: JSONObject,
    ): Array<JSONObject> => {
      const resource: JSONObject = (
        payload["resourceMetrics"] as Array<JSONObject>
      )[0]!;
      const metric: JSONObject = (
        (resource["scopeMetrics"] as Array<JSONObject>)[0]![
          "metrics"
        ] as Array<JSONObject>
      )[0]!;

      return (metric["gauge"] as JSONObject)["dataPoints"] as Array<JSONObject>;
    };
    const before: JSONObject = pointsOf(PAYLOAD)[0]!;
    const after: JSONObject = pointsOf(toWrite.payload!)[0]!;

    expect(after).toEqual({
      ...before,
      attributes: (before["attributes"] as Array<JSONObject>).filter(
        (attribute: JSONObject): boolean => {
          return attribute["key"] !== "azuremonitor.resource_id";
        },
      ),
    });
    expect((after["attributes"] as Array<JSONObject>).length).toBe(
      (before["attributes"] as Array<JSONObject>).length - 1,
    );
  });

  test("a queue a collector delivered is still left out, and the namespace's other queues kept off it", () => {
    const toWrite: {
      payload: JSONObject | null;
      leftOut: number;
      offNamespace: number;
    } = withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({
        series: [
          getMessagingQueueSeriesKey({
            metricName: "azure_incomingmessages_total",
            type: SERVICE_BUS_TYPE,
            namespace: "sb-orders",
            entity: "orders",
          }),
        ],
        namespaceTotals: [INCOMING_TOTAL],
      }),
    });

    expect(toWrite.leftOut).toBe(2);
    expect(toWrite.offNamespace).toBe(2);
    expect(
      seriesFiled(toWrite.payload).filter((entry: string): boolean => {
        return entry.startsWith("azure_incomingmessages_total|sb-orders");
      }),
    ).toEqual([
      "azure_incomingmessages_total|sb-orders|invoices|none",
      "azure_incomingmessages_total|sb-orders|invoices|none",
    ]);
  });

  test("a whole namespace the collector's is left out, not kept off it", () => {
    const toWrite: {
      payload: JSONObject | null;
      leftOut: number;
      offNamespace: number;
    } = withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({
        wholeNamespaces: [INCOMING_TOTAL],
        namespaceTotals: [INCOMING_TOTAL],
      }),
    });

    expect(toWrite.leftOut).toBe(4);
    expect(toWrite.offNamespace).toBe(0);
  });

  test("another namespace's, metric's or type's total changes nothing", () => {
    for (const key of [
      getMessagingNamespaceSeriesKey({
        metricName: "azure_incomingmessages_total",
        type: SERVICE_BUS_TYPE,
        namespace: "sb-billing",
      }),
      getMessagingNamespaceSeriesKey({
        metricName: "azure_outgoingmessages_total",
        type: SERVICE_BUS_TYPE,
        namespace: "sb-orders",
      }),
      getMessagingNamespaceSeriesKey({
        metricName: "azure_incomingmessages_total",
        type: EVENT_HUBS_TYPE,
        namespace: "sb-orders",
      }),
    ]) {
      const toWrite: {
        payload: JSONObject | null;
        leftOut: number;
        offNamespace: number;
      } = withoutCollectorQueues({
        payload: PAYLOAD,
        collector: collector({ namespaceTotals: [key] }),
      });

      expect(toWrite).toEqual({
        payload: PAYLOAD,
        leftOut: 0,
        offNamespace: 0,
      });
    }
  });

  test("the namespace is matched whatever the case of its name and type", () => {
    const toWrite: { offNamespace: number } = withoutCollectorQueues({
      payload: PAYLOAD,
      collector: collector({
        namespaceTotals: [
          getMessagingNamespaceSeriesKey({
            metricName: "AZURE_INCOMINGMESSAGES_TOTAL",
            type: "microsoft.servicebus/NAMESPACES",
            namespace: "SB-Orders",
          }),
        ],
      }),
    });

    expect(toWrite.offNamespace).toBe(4);
  });
});

describe("what a collector delivered, from the stored metrics' grouped rows", () => {
  function row(attributes: JSONObject, name: string): AggregatedModel {
    return {
      timestamp: NOW,
      value: 5,
      name,
      attributes,
    } as AggregatedModel;
  }

  const ROWS: Array<AggregatedModel> = [
    row(
      {
        type: "Microsoft.ServiceBus/Namespaces",
        name: "sb-orders",
        metadata_entityname: "orders",
        metadata_EntityName: "",
      },
      "azure_incomingmessages_total",
    ),
    // The documented spelling.
    row(
      {
        type: SERVICE_BUS_TYPE,
        name: "sb-orders",
        metadata_entityname: "",
        metadata_EntityName: "Invoices",
      },
      "azure_incomingmessages_total",
    ),
    // Unsplit totals: the namespace's own, split by no queue.
    row(
      {
        type: SERVICE_BUS_TYPE,
        name: "sb-orders",
        metadata_entityname: "",
        metadata_EntityName: "",
      },
      "azure_incomingmessages_total",
    ),
    // As ClickHouse answers a key the series does not carry.
    row(
      {
        type: "Microsoft.EventHub/Namespaces",
        name: "eh-clicks",
        metadata_entityname: null,
      },
      "azure_outgoingmessages_total",
    ),
    // Another type, or no namespace: no queue, and no namespace's total.
    row(
      {
        type: "Microsoft.Storage/storageAccounts",
        name: "acme",
        metadata_entityname: "x",
      },
      "azure_incomingmessages_total",
    ),
    row(
      {
        type: "Microsoft.Compute/virtualMachines",
        name: "vm-web-1",
        metadata_entityname: "",
      },
      "azure_incomingmessages_total",
    ),
    row(
      { type: SERVICE_BUS_TYPE, name: "", metadata_entityname: "orders" },
      "azure_incomingmessages_total",
    ),
    row(
      { type: SERVICE_BUS_TYPE, name: "", metadata_entityname: "" },
      "azure_incomingmessages_total",
    ),
    row({ type: SERVICE_BUS_TYPE, name: "sb-orders" }, ""),
    row({}, "azure_incomingmessages_total"),
  ];

  test("a namespace's total a collector sent, split by no queue, is the namespace's key", () => {
    const found: CollectorMessagingQueues = readCollectorQueuesFromRows({
      rows: ROWS,
      isComplete: true,
    });

    expect(Array.from(found.namespaceTotals).sort()).toEqual(
      [
        getMessagingNamespaceSeriesKey({
          metricName: "azure_incomingmessages_total",
          type: SERVICE_BUS_TYPE,
          namespace: "sb-orders",
        }),
        getMessagingNamespaceSeriesKey({
          metricName: "azure_outgoingmessages_total",
          type: EVENT_HUBS_TYPE,
          namespace: "eh-clicks",
        }),
      ].sort(),
    );
    // A total is no queue's: never a queue's key, nor its whole namespace's.
    expect(found.series.size).toBe(2);
    expect(found.wholeNamespaces.size).toBe(0);
  });

  test("each queue's metric a collector sent is its own key", () => {
    const found: CollectorMessagingQueues = readCollectorQueuesFromRows({
      rows: ROWS,
      isComplete: true,
    });

    expect(Array.from(found.series).sort()).toEqual(
      [
        getMessagingQueueSeriesKey({
          metricName: "azure_incomingmessages_total",
          type: SERVICE_BUS_TYPE,
          namespace: "sb-orders",
          entity: "invoices",
        }),
        getMessagingQueueSeriesKey({
          metricName: "azure_incomingmessages_total",
          type: SERVICE_BUS_TYPE,
          namespace: "sb-orders",
          entity: "orders",
        }),
      ].sort(),
    );
    expect(found.wholeNamespaces.size).toBe(0);
  });

  test("rows past the lookup's limit make the whole namespace's metric the collector's", () => {
    const found: CollectorMessagingQueues = readCollectorQueuesFromRows({
      rows: ROWS,
      isComplete: false,
    });

    expect(Array.from(found.wholeNamespaces)).toEqual([
      getMessagingNamespaceSeriesKey({
        metricName: "azure_incomingmessages_total",
        type: SERVICE_BUS_TYPE,
        namespace: "sb-orders",
      }),
    ]);
    expect(COLLECTOR_QUEUE_LOOKUP_LIMIT).toBeGreaterThanOrEqual(1000);
  });

  test("no rows, no collector", () => {
    const found: CollectorMessagingQueues = readCollectorQueuesFromRows({
      rows: [],
      isComplete: true,
    });

    expect(found.series.size).toBe(0);
    expect(found.wholeNamespaces.size).toBe(0);
    expect(found.namespaceTotals.size).toBe(0);
  });
});

describe("looking up what a collector delivered, on a read", () => {
  test("nothing is looked up when the read split nothing", async () => {
    const calls: Array<unknown> = [];

    const found: {
      queues: CollectorMessagingQueues;
      warning: string | null;
    } = await CloudConnectionPullRunner.findCollectorQueues({
      projectId: PROJECT,
      payloads: [
        payloadOf([
          {
            name: "azure_percentage_cpu_average",
            unit: "Percent",
            datapointSets: [
              series({
                namespace: "vm-web-1",
                type: "Microsoft.Compute/virtualMachines",
              }),
            ],
          },
        ]),
      ],
      now: NOW,
      find: async (data: unknown): Promise<CollectorMessagingQueues> => {
        calls.push(data);
        return NO_COLLECTOR_QUEUES;
      },
    });

    expect(calls).toEqual([]);
    expect(found).toEqual({ queues: NO_COLLECTOR_QUEUES, warning: null });
  });

  test("asks for the split metrics, over the last half hour", async () => {
    const calls: Array<JSONObject> = [];
    const answer: CollectorMessagingQueues = collector({ series: ["x"] });

    const found: {
      queues: CollectorMessagingQueues;
      warning: string | null;
    } = await CloudConnectionPullRunner.findCollectorQueues({
      projectId: PROJECT,
      payloads: [PAYLOAD],
      now: NOW,
      find: async (data: JSONObject): Promise<CollectorMessagingQueues> => {
        calls.push(data);
        return answer;
      },
    } as never);

    expect(COLLECTOR_QUEUE_LOOKBACK_MS).toBe(30 * 60 * 1000);
    expect(calls).toEqual([
      {
        projectId: PROJECT,
        metricNames: [
          "azure_activemessages_average",
          "azure_incomingmessages_total",
        ],
        since: new Date(NOW.getTime() - COLLECTOR_QUEUE_LOOKBACK_MS),
        until: NOW,
      },
    ]);
    expect(found).toEqual({ queues: answer, warning: null });
  });

  test("a lookup that fails leaves nothing out, and says so", async () => {
    const found: {
      queues: CollectorMessagingQueues;
      warning: string | null;
    } = await CloudConnectionPullRunner.findCollectorQueues({
      projectId: PROJECT,
      payloads: [PAYLOAD],
      now: NOW,
      find: async (): Promise<CollectorMessagingQueues> => {
        throw new Error("ClickHouse is not answering");
      },
    });

    expect(found.queues).toBe(NO_COLLECTOR_QUEUES);
    expect(found.warning).toBe(COLLECTOR_QUEUES_UNKNOWN_WARNING);
    expect(COLLECTOR_QUEUES_UNKNOWN_WARNING).toBe(
      "Could not tell which queues and topics a collector already reads, so this read wrote all of them.",
    );
  });
});
