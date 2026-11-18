import {
  GCP_GKE_CLUSTER_TYPE,
  GCP_INVENTORY_TYPES,
  GcpAsset,
  GcpInventoryType,
  addGcpInventoryEdges,
  buildGcpInventoryItem,
  gcpZoneRegion,
  getGcpListedAssetTypes,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "../../../../Types/Cloud/CloudInventory";
import {
  CloudResourceLink,
  getCloudResourceLinks,
} from "../../../../Types/Cloud/CloudResourceIndex";
import {
  CloudResourceCategory,
  getCloudResourceTypeDescriptor,
  getGcpMonitoredResourceRule,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A Google Cloud project's GKE clusters, from Cloud Asset Inventory
 * (#9306): each listed with its versions, size and node pools, in its
 * subnet and network, with the node VMs that are part of it. Its
 * Kubernetes metrics stay the Kubernetes product's: the cluster is a
 * Cloud Resource with no metrics of its own. The fixture is the GKE API's
 * Cluster, as Cloud Asset returns it in `resource.data`.
 */

const PROJECT: string = "shop-prod";
const COMPUTE: string = `https://www.googleapis.com/compute/v1/projects/${PROJECT}`;
const FULL: string = `//compute.googleapis.com/projects/${PROJECT}`;

function clusterAsset(
  name: string,
  location: string,
  data: Record<string, unknown> = {},
): GcpAsset {
  return {
    name: `//container.googleapis.com/projects/${PROJECT}/locations/${location}/clusters/${name}`,
    assetType: GCP_GKE_CLUSTER_TYPE,
    location,
    data: {
      name,
      location,
      status: "RUNNING",
      currentMasterVersion: "1.30.5-gke.1014001",
      currentNodeVersion: "1.30.5-gke.1014001",
      currentNodeCount: 3,
      releaseChannel: { channel: "REGULAR" },
      endpoint: "34.70.1.1",
      network: "default",
      subnetwork: "default",
      networkConfig: {
        network: `projects/${PROJECT}/global/networks/default`,
        subnetwork: `projects/${PROJECT}/regions/us-central1/subnetworks/default`,
      },
      masterAuth: { clusterCaCertificate: "LS0tLS1CRUdJTi1DQS0tLS0t" },
      nodePools: [
        {
          name: "default-pool",
          config: {
            machineType: "e2-standard-4",
            serviceAccount: "default",
          },
          initialNodeCount: 3,
        },
        { name: "gpu-pool", config: { machineType: "g2-standard-8" } },
      ],
      resourceLabels: { env: "prod" },
      ...data,
    } as never,
  };
}

function nodeAsset(name: string, labels: Record<string, string>): GcpAsset {
  return {
    name: `${FULL}/zones/us-central1-a/instances/${name}`,
    assetType: "compute.googleapis.com/Instance",
    location: "us-central1-a",
    data: {
      id: `9${name.length}${name.charCodeAt(name.length - 1)}`,
      name,
      zone: `${COMPUTE}/zones/us-central1-a`,
      labels,
      networkInterfaces: [
        {
          network: `${COMPUTE}/global/networks/default`,
          subnetwork: `${COMPUTE}/regions/us-central1/subnetworks/default`,
        },
      ],
    } as never,
  };
}

function readProject(assets: Array<GcpAsset>): Array<CloudInventoryItem> {
  const items: Array<CloudInventoryItem> = [];
  const byItem: Map<CloudInventoryItem, GcpAsset> = new Map();

  for (const asset of assets) {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(asset, {
      projectId: PROJECT,
    });

    if (item) {
      items.push(item);
      byItem.set(item, asset);
    }
  }

  addGcpInventoryEdges({ items, assets: byItem, listed: assets });
  return items;
}

function partOf(item: CloudInventoryItem): Array<string> {
  return item.relationships
    .filter((relationship: CloudResourceRelationship): boolean => {
      return relationship.kind === CloudRelationshipKind.PartOf;
    })
    .map((relationship: CloudResourceRelationship): string => {
      return relationship.target;
    });
}

function named(
  items: Array<CloudInventoryItem>,
  name: string,
): CloudInventoryItem {
  return items.find((item: CloudInventoryItem): boolean => {
    return item.displayName === name;
  })!;
}

describe("a GKE cluster", () => {
  test("is listed by project, location and name, in its location's region", () => {
    const regional: CloudInventoryItem | null = buildGcpInventoryItem(
      clusterAsset("shop", "us-central1"),
      { projectId: PROJECT },
    );
    const zonal: CloudInventoryItem | null = buildGcpInventoryItem(
      clusterAsset("shop", "us-central1-a"),
      { projectId: PROJECT },
    );

    expect(regional!.resource).toEqual(
      expect.objectContaining({
        provider: CloudProvider.GCP,
        resourceType: GCP_GKE_CLUSTER_TYPE,
        name: "shop",
        providerResourceId: `//container.googleapis.com/projects/${PROJECT}/locations/us-central1/clusters/shop`,
        accountId: PROJECT,
        region: "us-central1",
        identityKey: `gcp|container.googleapis.com/cluster|${PROJECT}|us-central1|shop`,
        telemetryAttributes: {},
      }),
    );
    // A zonal cluster is in its zone's region, and is another cluster.
    expect(zonal!.resource.region).toBe("us-central1");
    expect(zonal!.resource.identityKey).toBe(
      `gcp|container.googleapis.com/cluster|${PROJECT}|us-central1-a|shop`,
    );
  });

  test("keeps its versions, size and node pools, never its certificate or node config", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      clusterAsset("shop", "us-central1", { autopilot: { enabled: false } }),
      { projectId: PROJECT },
    );

    expect(item!.properties).toEqual({
      status: "RUNNING",
      currentMasterVersion: "1.30.5-gke.1014001",
      currentNodeVersion: "1.30.5-gke.1014001",
      currentNodeCount: 3,
      "autopilot.enabled": false,
      "releaseChannel.channel": "REGULAR",
      nodePools: ["default-pool (e2-standard-4)", "gpu-pool (g2-standard-8)"],
    });
    // Its labels are its resource labels.
    expect(item!.tags).toEqual({ env: "prod" });
    expect(JSON.stringify(item)).not.toContain("LS0tLS1CRUdJTi1DQS0tLS0t");
    expect(item!.endpoints).toEqual(["34.70.1.1"]);
  });

  test("runs in its subnet and its network", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      clusterAsset("shop", "us-central1"),
      { projectId: PROJECT },
    );

    expect(item!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/regions/us-central1/subnetworks/default`,
        targetType: "compute.googleapis.com/Subnetwork",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/global/networks/default`,
        targetType: "compute.googleapis.com/Network",
      },
    ]);
  });

  test("a private cluster answers on its private endpoint too", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      clusterAsset("shop", "us-central1", {
        privateClusterConfig: {
          enablePrivateNodes: true,
          privateEndpoint: "10.0.0.2",
        },
      }),
      { projectId: PROJECT },
    );

    expect(item!.endpoints).toEqual(["34.70.1.1", "10.0.0.2"]);
    expect(item!.properties["privateClusterConfig.enablePrivateNodes"]).toBe(
      true,
    );
  });
});

describe("its nodes", () => {
  test("a VM GKE labels with a cluster's name and location is part of it", () => {
    const items: Array<CloudInventoryItem> = readProject([
      clusterAsset("shop", "us-central1"),
      clusterAsset("shop", "europe-west1"),
      nodeAsset("gke-shop-default-pool-1", {
        "goog-k8s-cluster-name": "shop",
        "goog-k8s-cluster-location": "us-central1",
        "goog-k8s-node-pool-name": "default-pool",
      }),
      nodeAsset("web-1", { team: "storefront" }),
    ]);

    expect(partOf(named(items, "gke-shop-default-pool-1"))).toEqual([
      `//container.googleapis.com/projects/${PROJECT}/locations/us-central1/clusters/shop`,
    ]);
    expect(partOf(named(items, "web-1"))).toEqual([]);
  });

  test("a name two clusters answer to, with no location to tell them apart, links to neither", () => {
    const items: Array<CloudInventoryItem> = readProject([
      clusterAsset("shop", "us-central1"),
      clusterAsset("shop", "europe-west1"),
      nodeAsset("gke-shop-x", { "goog-k8s-cluster-name": "shop" }),
    ]);

    expect(partOf(named(items, "gke-shop-x"))).toEqual([]);
  });

  test("the node, the cluster, the subnet and the network link up", () => {
    const items: Array<CloudInventoryItem> = readProject([
      {
        name: `${FULL}/global/networks/default`,
        assetType: "compute.googleapis.com/Network",
        location: "global",
        data: { name: "default" },
      },
      {
        name: `${FULL}/regions/us-central1/subnetworks/default`,
        assetType: "compute.googleapis.com/Subnetwork",
        location: "us-central1",
        data: {
          name: "default",
          region: `${COMPUTE}/regions/us-central1`,
          network: `${COMPUTE}/global/networks/default`,
        },
      },
      clusterAsset("shop", "us-central1"),
      nodeAsset("gke-shop-default-pool-1", {
        "goog-k8s-cluster-name": "shop",
        "goog-k8s-cluster-location": "us-central1",
      }),
    ]);
    const ids: Map<CloudInventoryItem, ObjectID> = new Map(
      items.map((item: CloudInventoryItem): [CloudInventoryItem, ObjectID] => {
        return [item, ObjectID.generate()];
      }),
    );
    const nameOf: Map<string, string> = new Map(
      items.map((item: CloudInventoryItem): [string, string] => {
        return [
          ids.get(item)!.toString(),
          `${item.resource.resourceType}:${item.resource.name}`,
        ];
      }),
    );
    const links: Array<CloudResourceLink> = getCloudResourceLinks(
      items.map((item: CloudInventoryItem) => {
        return {
          id: ids.get(item)!,
          name: item.resource.name,
          providerResourceId: item.resource.providerResourceId,
          type: item.resource.resourceType,
          relationships: item.relationships,
        };
      }),
    );

    expect(
      links
        .map((link: CloudResourceLink): string => {
          return `${nameOf.get(link.fromId)} ${link.kind} ${nameOf.get(link.toId)}`;
        })
        .sort(),
    ).toEqual(
      [
        "compute.googleapis.com/Subnetwork:default runs-in compute.googleapis.com/Network:default",
        `${GCP_GKE_CLUSTER_TYPE}:shop runs-in compute.googleapis.com/Subnetwork:default`,
        `${GCP_GKE_CLUSTER_TYPE}:shop runs-in compute.googleapis.com/Network:default`,
        "gce_instance:gke-shop-default-pool-1 runs-in compute.googleapis.com/Subnetwork:default",
        "gce_instance:gke-shop-default-pool-1 runs-in compute.googleapis.com/Network:default",
        `gce_instance:gke-shop-default-pool-1 part-of ${GCP_GKE_CLUSTER_TYPE}:shop`,
      ].sort(),
    );
  });
});

describe("the catalog and the listing", () => {
  test("a cluster is a container resource with no metrics of its own; Kubernetes metrics stay the Kubernetes product's", () => {
    expect(
      getCloudResourceTypeDescriptor(CloudProvider.GCP, GCP_GKE_CLUSTER_TYPE),
    ).toEqual(
      expect.objectContaining({
        label: "GKE Cluster",
        category: CloudResourceCategory.Containers,
      }),
    );
    expect(
      isInventoryOnlyCloudResourceType(CloudProvider.GCP, GCP_GKE_CLUSTER_TYPE),
    ).toBe(true);
    expect(getGcpMonitoredResourceRule("k8s_cluster")).toBeNull();
    expect(
      GCP_INVENTORY_TYPES.find((type: GcpInventoryType): boolean => {
        return type.assetType === GCP_GKE_CLUSTER_TYPE;
      })!.monitoredType,
    ).toBeUndefined();
    expect(getGcpListedAssetTypes()).toContain(GCP_GKE_CLUSTER_TYPE);
  });

  test("a zone's region is the zone without its letter; a region is itself", () => {
    expect(gcpZoneRegion("us-central1-a")).toBe("us-central1");
    expect(gcpZoneRegion("europe-west4-c")).toBe("europe-west4");
    expect(gcpZoneRegion("us-central1")).toBe("us-central1");
    expect(gcpZoneRegion("global")).toBe("global");
    expect(gcpZoneRegion("us")).toBe("us");
  });
});
