import { describe, expect, test } from "@jest/globals";
import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
} from "../../../Types/Cloud/CloudAddedMetrics";
import {
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
  CloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricQuery,
} from "../../../Utils/Metrics/RetiredCloudMetricMoves";
import {
  COSMOS_DB_ACCOUNT_TYPE,
  COSMOS_SERVER_SIDE_LATENCY_AGGREGATION,
  COSMOS_SERVER_SIDE_LATENCY_GRAIN,
  COSMOS_SERVER_SIDE_LATENCY_NAME,
  COSMOS_SERVER_SIDE_LATENCY_READ_NAME,
  PUBSUB_PUBLISH_OPERATIONS_ALIGNER,
  PUBSUB_PUBLISH_OPERATIONS_UNIT,
  PUBSUB_TOPIC_TYPE,
  getRetiredCloudMetricRead,
  getRetiredCloudMetricReads,
} from "../../../Utils/Metrics/RetiredCloudMetricReads";

/*
 * What keeps a deprecated metric read for what still reads it (#9739's
 * gap): a monitor or a chart left on Cosmos DB's ServerSideLatency or
 * Pub/Sub's send_message_operation_count is handed to its connection as an
 * added metric of the one resource its filter names - or of every resource
 * of the type, when it names none - read as the connection read it before
 * #9954 stopped: the latency's primary aggregation a minute at a time, the
 * publish operations as a rate a second.
 */

const COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/orders-db";
const OTHER_COSMOS_ID: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.DocumentDB/databaseAccounts/carts-db";
const TOPIC_ATTRIBUTES: Record<string, string> = {
  "resource.gcp.resource_type": "pubsub_topic",
  "resource.project_id": "shop-prod",
  "resource.topic_id": "orders",
};

function cosmos(data: {
  metricName?: string;
  attributes?: unknown;
}): RetiredCloudMetricQuery {
  return {
    metric: RetiredCloudMetric.CosmosServerSideLatency,
    metricVariable: "a",
    metricName: data.metricName || COSMOS_SERVER_SIDE_LATENCY_READ_NAME,
    attributes: data.attributes,
  };
}

function pubSub(attributes?: unknown): RetiredCloudMetricQuery {
  return {
    metric: RetiredCloudMetric.PubSubPublishOperations,
    metricVariable: "a",
    metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
    attributes,
  };
}

function identifierOf(attributes: Record<string, string>): string {
  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    { metricName: "x", attributes },
  );

  expect(resource).not.toBeNull();

  return buildCloudMonitoredResourceIdentifier(resource!);
}

describe("a Cosmos DB account's ServerSideLatency, still read for a query of it", () => {
  test("of the account its filter names: in the account's own metrics call, as the read stored it", () => {
    const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
      cosmos({ attributes: { "azuremonitor.resource_id": COSMOS_ID } }),
    );

    expect(read).toEqual({
      key: getCloudAddedMetricKey({
        scope: CloudAddedMetricScope.Resource,
        resourceType: COSMOS_DB_ACCOUNT_TYPE,
        cloudResourceId: identifierOf({
          "azuremonitor.resource_id": COSMOS_ID,
        }),
        name: COSMOS_SERVER_SIDE_LATENCY_NAME,
      }),
      provider: CloudProvider.Azure,
      scope: CloudAddedMetricScope.Resource,
      resourceType: COSMOS_DB_ACCOUNT_TYPE,
      name: "ServerSideLatency",
      aggregation: "Average",
      grain: "PT1M",
      unit: "MilliSeconds",
      addedAt: expect.any(String),
      cloudResourceId: identifierOf({ "azuremonitor.resource_id": COSMOS_ID }),
      azureResourceId: COSMOS_ID,
    });
    expect(COSMOS_SERVER_SIDE_LATENCY_AGGREGATION).toBe("Average");
    expect(COSMOS_SERVER_SIDE_LATENCY_GRAIN).toBe("PT1M");
  });

  test("of every account, for a query of every account or of a filter that names none", () => {
    for (const attributes of [
      undefined,
      null,
      {},
      { "resource.azuremonitor.subscription_id": "3f2b8c1e" },
      { "azuremonitor.resource_id": { operator: "!=", value: COSMOS_ID } },
      { "azuremonitor.resource_id": "not an id" },
    ]) {
      const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
        cosmos({ attributes }),
      );

      expect(read?.scope).toBe(CloudAddedMetricScope.Type);
      expect(read?.resourceType).toBe(COSMOS_DB_ACCOUNT_TYPE);
      expect(read?.azureResourceId).toBeUndefined();
      expect(read?.cloudResourceId).toBeUndefined();
    }
  });

  test("a filter that names a resource of another type is no account's: every account's is read", () => {
    const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
      cosmos({
        attributes: {
          "azuremonitor.resource_id":
            "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Web/sites/shop",
        },
      }),
    );

    expect(read?.scope).toBe(CloudAddedMetricScope.Type);
  });

  test("a query of another aggregation read what a collector wrote, never the connection: nothing is read for it", () => {
    for (const aggregation of ["maximum", "minimum", "total", "count"]) {
      expect(
        getRetiredCloudMetricRead(
          cosmos({
            metricName: `azure_serversidelatency_${aggregation}`,
            attributes: { "azuremonitor.resource_id": COSMOS_ID },
          }),
        ),
      ).toBeNull();
    }

    expect(
      getRetiredCloudMetricRead(
        cosmos({
          metricName: " Azure_ServerSideLatency_Average ",
          attributes: { "azuremonitor.resource_id": COSMOS_ID },
        }),
      )?.name,
    ).toBe("ServerSideLatency");
  });
});

describe("a Pub/Sub topic's publish operations, still read for a query of them", () => {
  test("of the topic its filter names: narrowed to the topic's own series, a rate a second", () => {
    const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
      pubSub(TOPIC_ATTRIBUTES),
    );

    expect(read).toEqual({
      key: getCloudAddedMetricKey({
        scope: CloudAddedMetricScope.Resource,
        resourceType: PUBSUB_TOPIC_TYPE,
        cloudResourceId: identifierOf(TOPIC_ATTRIBUTES),
        name: PUBSUB_PUBLISH_OPERATIONS_METRIC,
      }),
      provider: CloudProvider.GCP,
      scope: CloudAddedMetricScope.Resource,
      resourceType: "pubsub_topic",
      name: "pubsub.googleapis.com/topic/send_message_operation_count",
      aggregation: "ALIGN_RATE",
      unit: "1/s",
      addedAt: expect.any(String),
      cloudResourceId: identifierOf(TOPIC_ATTRIBUTES),
      accountId: "shop-prod",
      resourceLabels: { project_id: "shop-prod", topic_id: "orders" },
    });
    expect(PUBSUB_PUBLISH_OPERATIONS_ALIGNER).toBe("ALIGN_RATE");
    expect(PUBSUB_PUBLISH_OPERATIONS_UNIT).toBe("1/s");
  });

  test("of every topic, for a query of every topic or of one it cannot name by its labels", () => {
    for (const attributes of [
      undefined,
      {},
      { "resource.topic_id": "orders" },
      { ...TOPIC_ATTRIBUTES, "resource.topic_id": { operator: "=~" } },
      { response_code: "success" },
    ]) {
      const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
        pubSub(attributes),
      );

      expect(read?.scope).toBe(CloudAddedMetricScope.Type);
      expect(read?.resourceType).toBe("pubsub_topic");
      expect(read?.resourceLabels).toBeUndefined();
      expect(read?.accountId).toBeUndefined();
    }
  });

  test("a topic's query split by response code keeps every response code's series: the call names none", () => {
    const read: CloudAddedMetric | null = getRetiredCloudMetricRead(
      pubSub({ ...TOPIC_ATTRIBUTES, response_code: "success" }),
    );

    expect(read?.scope).toBe(CloudAddedMetricScope.Resource);
    expect(read?.resourceLabels).toEqual({
      project_id: "shop-prod",
      topic_id: "orders",
    });
  });
});

describe("what keeps every query read, each once", () => {
  test("two queries of one resource are one read; two resources, two", () => {
    const reads: Array<CloudAddedMetric> = getRetiredCloudMetricReads([
      cosmos({ attributes: { "azuremonitor.resource_id": COSMOS_ID } }),
      cosmos({ attributes: { "azuremonitor.resource_id": COSMOS_ID } }),
      cosmos({ attributes: { "azuremonitor.resource_id": OTHER_COSMOS_ID } }),
      pubSub(TOPIC_ATTRIBUTES),
      pubSub(TOPIC_ATTRIBUTES),
    ]);

    expect(
      reads.map((read: CloudAddedMetric): string => {
        return `${read.provider}|${read.scope}|${read.azureResourceId || read.resourceLabels?.["topic_id"]}`;
      }),
    ).toEqual([
      `azure|resource|${COSMOS_ID}`,
      `azure|resource|${OTHER_COSMOS_ID}`,
      "gcp|resource|orders",
    ]);
  });

  test("a type's read covers its resources' own: those are left out, so nothing is asked twice", () => {
    const reads: Array<CloudAddedMetric> = getRetiredCloudMetricReads([
      pubSub(TOPIC_ATTRIBUTES),
      cosmos({ attributes: { "azuremonitor.resource_id": COSMOS_ID } }),
      pubSub({}),
    ]);

    expect(
      reads.map((read: CloudAddedMetric): string => {
        return `${read.provider}|${read.scope}`;
      }),
    ).toEqual(["azure|resource", "gcp|type"]);
  });

  test("nothing, for no query, or only queries nothing was read for", () => {
    expect(getRetiredCloudMetricReads([])).toEqual([]);
    expect(
      getRetiredCloudMetricReads([
        cosmos({ metricName: "azure_serversidelatency_maximum" }),
      ]),
    ).toEqual([]);
  });

  test("the same queries make the same reads, keys and all: a connection's definitions are not read again for nothing", () => {
    const queries: Array<RetiredCloudMetricQuery> = [
      cosmos({}),
      pubSub(TOPIC_ATTRIBUTES),
    ];

    expect(getRetiredCloudMetricReads(queries)).toEqual(
      getRetiredCloudMetricReads(queries),
    );
  });
});
