import GcpInventoryClient, {
  GCP_INVENTORY_TYPES,
  GCP_NETWORK_TYPE,
  GcpAsset,
  GcpAssetListing,
  GcpInventoryType,
  addGcpTopicEdges,
  buildGcpInventoryItem,
  computeUrlToFullName,
  getGcpInventoryType,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudRelationshipKind } from "../../../../Types/Cloud/CloudInventory";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  GCP_MONITORED_RESOURCE_RULES,
  getCloudResourceTypeDescriptor,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";

/*
 * A Google Cloud project's inventory, from Cloud Asset Inventory: each
 * asset is the resource its Cloud Monitoring metrics name, keeps only the
 * fields its type names (never an instance's metadata), and says what it
 * runs in, where it answers, and what a topic sends to.
 */

const PROJECT: string = "shop-prod";

// A real key: the client checks it is a readable PEM before anything else.
const PRIVATE_KEY: string = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

function asset(
  assetType: string,
  data: Record<string, unknown>,
  location: string = "",
): GcpAsset {
  return {
    name: `//${assetType.split("/")[0]}/projects/${PROJECT}/x/${String(data["name"] || "")}`,
    assetType,
    location,
    data: data as never,
  };
}

// What ingest's resolver gives a metric of this monitored resource.
function fromMetrics(
  monitoredType: string,
  labels: Record<string, string>,
): CloudMonitoredResource | null {
  const attributes: Record<string, string> = {
    "resource.gcp.resource_type": monitoredType,
  };

  for (const key of Object.keys(labels)) {
    attributes[`resource.${key}`] = labels[key]!;
  }

  return resolveCloudMonitoredResource({
    metricName: "compute.googleapis.com/instance/cpu/utilization",
    attributes,
  });
}

describe("identity", () => {
  test("a VM is the resource its metrics name - by project, zone and instance id", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      asset(
        "compute.googleapis.com/Instance",
        {
          id: "8123456789012345678",
          name: "web-1",
          zone: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/europe-west1-b`,
          status: "RUNNING",
        },
        "europe-west1-b",
      ),
      { projectId: PROJECT },
    );
    const metric: CloudMonitoredResource | null = fromMetrics("gce_instance", {
      project_id: PROJECT,
      zone: "europe-west1-b",
      instance_id: "8123456789012345678",
      name: "web-1",
    });

    expect(item!.resource.identityKey).toBe(metric!.identityKey);
    expect(item!.resource.providerResourceId).toBe(
      metric!.providerResourceId,
    );
    expect(item!.resource.region).toBe("europe-west1");
    expect(item!.displayName).toBe("web-1");
  });

  test("a Cloud SQL instance, a bucket, a Cloud Run service and a function are their metrics' resources", () => {
    const cases: Array<{
      asset: GcpAsset;
      monitoredType: string;
      labels: Record<string, string>;
    }> = [
      {
        asset: asset("sqladmin.googleapis.com/Instance", {
          name: "orders",
          region: "europe-west1",
        }),
        monitoredType: "cloudsql_database",
        labels: {
          project_id: PROJECT,
          database_id: `${PROJECT}:orders`,
          region: "europe-west1",
        },
      },
      {
        asset: asset("storage.googleapis.com/Bucket", {
          name: "shop-assets",
          location: "EU",
        }),
        monitoredType: "gcs_bucket",
        labels: {
          project_id: PROJECT,
          bucket_name: "shop-assets",
          location: "eu",
        },
      },
      {
        asset: asset(
          "run.googleapis.com/Service",
          {
            name: `projects/${PROJECT}/locations/europe-west1/services/checkout`,
            uri: "https://checkout-abc-ew.a.run.app",
          },
          "europe-west1",
        ),
        monitoredType: "cloud_run_revision",
        labels: {
          project_id: PROJECT,
          location: "europe-west1",
          service_name: "checkout",
        },
      },
      {
        asset: asset(
          "cloudfunctions.googleapis.com/Function",
          {
            name: `projects/${PROJECT}/locations/europe-west1/functions/resize`,
          },
          "europe-west1",
        ),
        monitoredType: "cloud_function",
        labels: {
          project_id: PROJECT,
          region: "europe-west1",
          function_name: "resize",
        },
      },
    ];

    for (const entry of cases) {
      const item: CloudInventoryItem | null = buildGcpInventoryItem(
        entry.asset,
        { projectId: PROJECT },
      );
      const metric: CloudMonitoredResource | null = fromMetrics(
        entry.monitoredType,
        entry.labels,
      );

      expect(item).not.toBeNull();
      expect(metric).not.toBeNull();
      expect(item!.resource.identityKey).toBe(metric!.identityKey);
    }
  });

  test("every listed monitored type has a Cloud Monitoring rule, and a network has a descriptor of its own", () => {
    for (const type of GCP_INVENTORY_TYPES) {
      if (type.monitoredType) {
        expect(
          GCP_MONITORED_RESOURCE_RULES.some((rule: { type: string }) => {
            return rule.type === type.monitoredType;
          }),
        ).toBe(true);
      }
    }

    expect(
      getCloudResourceTypeDescriptor(CloudProvider.GCP, GCP_NETWORK_TYPE),
    ).not.toBeNull();
  });

  test("a VPC network, which has no metrics, is identified by project and name", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      {
        name: `//compute.googleapis.com/projects/${PROJECT}/global/networks/default`,
        assetType: GCP_NETWORK_TYPE,
        location: "global",
        data: { name: "default", autoCreateSubnetworks: true } as never,
      },
      { projectId: PROJECT },
    );

    expect(item!.resource).toEqual(
      expect.objectContaining({
        resourceType: GCP_NETWORK_TYPE,
        providerResourceId: `//compute.googleapis.com/projects/${PROJECT}/global/networks/default`,
        accountId: PROJECT,
        identityKey: `gcp|compute.googleapis.com/network|${PROJECT}|default`,
        telemetryAttributes: {},
      }),
    );
    expect(item!.properties).toEqual({ autoCreateSubnetworks: true });
  });

  test("an asset of a type the inventory does not list, or that names nothing, is skipped", () => {
    expect(
      buildGcpInventoryItem(
        asset("iam.googleapis.com/ServiceAccount", { name: "sa" }),
        { projectId: PROJECT },
      ),
    ).toBeNull();
    expect(
      buildGcpInventoryItem(asset("compute.googleapis.com/Instance", {}), {
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(getGcpInventoryType("compute.googleapis.com/Disk")).toBeNull();
  });
});

describe("what an asset keeps", () => {
  test("a VM keeps its status and labels, runs in its network and subnet, answers on its addresses - and never keeps its metadata", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      asset(
        "compute.googleapis.com/Instance",
        {
          id: "1",
          name: "web-1",
          zone: "europe-west1-b",
          status: "RUNNING",
          labels: { team: "storefront" },
          metadata: {
            items: [{ key: "startup-script", value: "export TOKEN=s3cret" }],
          },
          networkInterfaces: [
            {
              network: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/global/networks/default`,
              subnetwork: `https://www.googleapis.com/compute/v1/projects/${PROJECT}/regions/europe-west1/subnetworks/default`,
              networkIP: "10.132.0.2",
              accessConfigs: [{ natIP: "34.1.2.3" }],
            },
          ],
        },
        "europe-west1-b",
      ),
      { projectId: PROJECT },
    );

    expect(item!.tags).toEqual({ team: "storefront" });
    expect(item!.properties).toEqual({ status: "RUNNING" });
    expect(JSON.stringify(item)).not.toContain("s3cret");
    expect(item!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `//compute.googleapis.com/projects/${PROJECT}/global/networks/default`,
        targetType: GCP_NETWORK_TYPE,
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `//compute.googleapis.com/projects/${PROJECT}/regions/europe-west1/subnetworks/default`,
        targetType: "compute.googleapis.com/Subnetwork",
      },
    ]);
    expect(item!.endpoints).toEqual(["10.132.0.2", "34.1.2.3"]);
  });

  test("a topic sends to its subscriptions, and a subscription names its dead-letter topic", () => {
    const topicAsset: GcpAsset = asset("pubsub.googleapis.com/Topic", {
      name: `projects/${PROJECT}/topics/orders`,
    });
    const subscriptionAsset: GcpAsset = asset(
      "pubsub.googleapis.com/Subscription",
      {
        name: `projects/${PROJECT}/subscriptions/orders-worker`,
        topic: `projects/${PROJECT}/topics/orders`,
        deadLetterPolicy: {
          deadLetterTopic: `projects/${PROJECT}/topics/orders-dead`,
        },
      },
    );
    const topic: CloudInventoryItem = buildGcpInventoryItem(topicAsset, {
      projectId: PROJECT,
    })!;
    const subscription: CloudInventoryItem = buildGcpInventoryItem(
      subscriptionAsset,
      { projectId: PROJECT },
    )!;

    addGcpTopicEdges({
      items: [topic, subscription],
      assets: new Map([
        [topic, topicAsset],
        [subscription, subscriptionAsset],
      ]),
    });

    expect(topic.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: subscription.resource.providerResourceId,
        targetType: "pubsub_subscription",
      },
    ]);
    expect(subscription.relationships).toEqual([
      {
        kind: CloudRelationshipKind.DeadLettersTo,
        target: `//pubsub.googleapis.com/projects/${PROJECT}/topics/orders-dead`,
        targetType: "pubsub_topic",
      },
    ]);
  });

  test("a Cloud Run service answers on its URL", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      asset(
        "run.googleapis.com/Service",
        {
          name: `projects/${PROJECT}/locations/europe-west1/services/checkout`,
          uri: "https://checkout-abc-ew.a.run.app",
        },
        "europe-west1",
      ),
      { projectId: PROJECT },
    );

    expect(item!.endpoints).toEqual(["checkout-abc-ew.a.run.app"]);
  });

  test("a Compute URL becomes the full resource name Cloud Asset writes", () => {
    expect(
      computeUrlToFullName(
        "https://www.googleapis.com/compute/v1/projects/p/global/networks/n",
      ),
    ).toBe("//compute.googleapis.com/projects/p/global/networks/n");
    expect(computeUrlToFullName("//compute.googleapis.com/x")).toBe(
      "//compute.googleapis.com/x",
    );
    expect(computeUrlToFullName("nonsense")).toBe("");
  });
});

describe("the client", () => {
  test("a project whose Cloud Asset API is off is a setting to turn on, said with the command", () => {
    const failure: LlmProviderError = GcpInventoryClient.classify(
      new LlmProviderError({
        message: "Google Cloud Asset Inventory assets request failed.",
        kind: CloudConnectionFailureKind.Other,
        statusCode: 403,
        responseBody:
          "Cloud Asset API has not been used in project 123 before or it is disabled.",
      }),
    );

    expect(failure.kind).toBe(CloudConnectionFailureKind.Settings);
    expect(failure.message).toContain(
      "gcloud services enable cloudasset.googleapis.com",
    );
  });

  test("any other 403 is a missing role", () => {
    expect(
      GcpInventoryClient.classify(
        new LlmProviderError({
          message: "denied",
          kind: CloudConnectionFailureKind.Other,
          statusCode: 403,
          responseBody: "PERMISSION_DENIED: cloudasset.assets.listResource",
        }),
      ).kind,
    ).toBe(CloudConnectionFailureKind.Permission);
  });

  test("lists every type of the inventory, page by page, keeping each asset's data and location", async () => {
    const requested: Array<string> = [];
    const pages: Array<Record<string, unknown>> = [
      {
        assets: [
          {
            name: "//compute.googleapis.com/projects/p/zones/z/instances/a",
            assetType: "compute.googleapis.com/Instance",
            resource: { data: { name: "a", id: "1" }, location: "z" },
          },
        ],
        nextPageToken: "page-2",
      },
      {
        assets: [
          {
            name: "//storage.googleapis.com/b",
            assetType: "storage.googleapis.com/Bucket",
            resource: { data: { name: "b" }, location: "EU" },
          },
        ],
      },
    ];
    const client: GcpInventoryClient = new GcpInventoryClient({
      // Read for its shape only: the token is stubbed below.
      serviceAccountJson: JSON.stringify({
        type: "service_account",
        client_email: "reader@p.iam.gserviceaccount.com",
        private_key: PRIVATE_KEY,
      }),
      transport: (async (request: { url: string }) => {
        requested.push(request.url);
        const body: Record<string, unknown> = pages[requested.length - 1]!;
        return {
          statusCode: 200,
          bodyText: JSON.stringify(body),
          bodyJson: body,
          headers: {},
        };
      }) as never,
    });
    (client as unknown as { token: { getAccessToken: () => Promise<string> } }).token =
      {
        getAccessToken: async () => {
          return "token";
        },
      };

    const listing: GcpAssetListing = await client.listAssets("p");

    expect(listing.complete).toBe(true);
    expect(listing.assets.map((entry: GcpAsset) => {
      return [entry.assetType, entry.location];
    })).toEqual([
      ["compute.googleapis.com/Instance", "z"],
      ["storage.googleapis.com/Bucket", "EU"],
    ]);
    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("contentType=RESOURCE");

    for (const type of GCP_INVENTORY_TYPES) {
      expect(requested[0]).toContain(
        `assetTypes=${encodeURIComponent((type as GcpInventoryType).assetType)}`,
      );
    }

    expect(requested[1]).toContain("pageToken=page-2");
  });
});
