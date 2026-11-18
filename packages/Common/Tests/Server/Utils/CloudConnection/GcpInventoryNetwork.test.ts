import {
  GCP_FIREWALL_TYPE,
  GCP_INVENTORY_TYPES,
  GCP_NETWORK_TYPE,
  GCP_SUBNETWORK_TYPE,
  GcpAsset,
  GcpInventoryType,
  addGcpInventoryEdges,
  buildGcpInventoryItem,
  gcpAssetRegion,
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
  getCloudResourceTypeDescriptor,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../../Types/ObjectID";
import {
  getInventoryFingerprint,
  isGoneFromListing,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import { describe, expect, test } from "@jest/globals";

/*
 * A Google Cloud project's network, from Cloud Asset Inventory (#9306): its
 * VPC networks, their subnets - one per region, often all called "default"
 * - and the firewall rules that guard them, each a Cloud Resource; an
 * instance in its subnet in its network, and guarded by the rules that
 * target it. The fixtures are the Compute API's own resource shapes, as
 * Cloud Asset returns them in `resource.data`.
 */

const PROJECT: string = "shop-prod";
const COMPUTE: string = `https://www.googleapis.com/compute/v1/projects/${PROJECT}`;
const FULL: string = `//compute.googleapis.com/projects/${PROJECT}`;

function networkAsset(name: string): GcpAsset {
  return {
    name: `${FULL}/global/networks/${name}`,
    assetType: GCP_NETWORK_TYPE,
    location: "global",
    data: {
      name,
      autoCreateSubnetworks: true,
      routingConfig: { routingMode: "REGIONAL" },
    },
  };
}

function subnetAsset(region: string, name: string = "default"): GcpAsset {
  return {
    name: `${FULL}/regions/${region}/subnetworks/${name}`,
    assetType: GCP_SUBNETWORK_TYPE,
    location: region,
    data: {
      name,
      network: `${COMPUTE}/global/networks/default`,
      region: `${COMPUTE}/regions/${region}`,
      ipCidrRange: "10.132.0.0/20",
      gatewayAddress: "10.132.0.1",
      purpose: "PRIVATE",
      stackType: "IPV4_ONLY",
      privateIpGoogleAccess: false,
      fingerprint: "abc=",
    },
  };
}

function firewallAsset(
  name: string,
  data: Record<string, unknown> = {},
  network: string = "default",
): GcpAsset {
  return {
    name: `${FULL}/global/firewalls/${name}`,
    assetType: GCP_FIREWALL_TYPE,
    location: "global",
    data: {
      name,
      network: `${COMPUTE}/global/networks/${network}`,
      direction: "INGRESS",
      priority: 1000,
      sourceRanges: ["0.0.0.0/0"],
      allowed: [{ IPProtocol: "tcp", ports: ["22"] }],
      ...data,
    } as never,
  };
}

function instanceAsset(
  name: string,
  data: Record<string, unknown> = {},
  network: string = "default",
): GcpAsset {
  return {
    name: `${FULL}/zones/europe-west1-b/instances/${name}`,
    assetType: "compute.googleapis.com/Instance",
    location: "europe-west1-b",
    data: {
      id: `${name.length}00${name.charCodeAt(0)}`,
      name,
      zone: `${COMPUTE}/zones/europe-west1-b`,
      networkInterfaces: [
        {
          network: `${COMPUTE}/global/networks/${network}`,
          subnetwork: `${COMPUTE}/regions/europe-west1/subnetworks/default`,
          networkIP: "10.132.0.2",
        },
      ],
      ...data,
    } as never,
  };
}

// A project's assets as the connector reads them, edges and all.
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

  addGcpInventoryEdges({ items, assets: byItem });
  return items;
}

function itemNamed(
  items: Array<CloudInventoryItem>,
  type: string,
  name: string,
): CloudInventoryItem {
  const found: CloudInventoryItem | undefined = items.find(
    (item: CloudInventoryItem): boolean => {
      return (
        item.resource.resourceType === type &&
        (item.displayName === name || item.resource.name === name)
      );
    },
  );

  if (!found) {
    throw new Error(`No ${type} called ${name}`);
  }

  return found;
}

function guards(item: CloudInventoryItem): Array<string> {
  return item.relationships
    .filter((relationship: CloudResourceRelationship): boolean => {
      return relationship.kind === CloudRelationshipKind.ProtectedBy;
    })
    .map((relationship: CloudResourceRelationship): string => {
      return relationship.target;
    });
}

describe("subnets", () => {
  test("are listed, named, and kept in their region, so every region's 'default' is its own resource", () => {
    const west: CloudInventoryItem | null = buildGcpInventoryItem(
      subnetAsset("europe-west1"),
      { projectId: PROJECT },
    );
    const east: CloudInventoryItem | null = buildGcpInventoryItem(
      subnetAsset("us-east1"),
      { projectId: PROJECT },
    );

    expect(west!.resource).toEqual(
      expect.objectContaining({
        provider: CloudProvider.GCP,
        resourceType: GCP_SUBNETWORK_TYPE,
        name: "default",
        providerResourceId: `${FULL}/regions/europe-west1/subnetworks/default`,
        accountId: PROJECT,
        region: "europe-west1",
        identityKey: `gcp|compute.googleapis.com/subnetwork|${PROJECT}|europe-west1|default`,
      }),
    );
    expect(east!.resource.identityKey).not.toBe(west!.resource.identityKey);
    expect(east!.resource.region).toBe("us-east1");
  });

  test("keep their range and gateway, never anything else, and run in their network", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      subnetAsset("europe-west1"),
      { projectId: PROJECT },
    );

    expect(item!.properties).toEqual({
      ipCidrRange: "10.132.0.0/20",
      gatewayAddress: "10.132.0.1",
      purpose: "PRIVATE",
      stackType: "IPV4_ONLY",
      privateIpGoogleAccess: false,
    });
    expect(item!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/global/networks/default`,
        targetType: GCP_NETWORK_TYPE,
      },
    ]);
  });

  test("a region comes from the asset's own region first, then its location", () => {
    expect(gcpAssetRegion(subnetAsset("asia-south1"))).toBe("asia-south1");
    expect(
      gcpAssetRegion({
        name: "x",
        assetType: GCP_SUBNETWORK_TYPE,
        location: "Europe-North1",
        data: { name: "x" },
      }),
    ).toBe("europe-north1");
    expect(gcpAssetRegion(networkAsset("default"))).toBe("global");
    expect(
      gcpAssetRegion({
        name: "x",
        assetType: GCP_FIREWALL_TYPE,
        location: "",
        data: { name: "x" },
      }),
    ).toBe("global");
  });
});

describe("firewall rules", () => {
  test("are listed as global resources of the project, kept in their network", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      firewallAsset("allow-ssh"),
      { projectId: PROJECT },
    );

    expect(item!.resource).toEqual(
      expect.objectContaining({
        resourceType: GCP_FIREWALL_TYPE,
        name: "allow-ssh",
        region: "global",
        // A global asset's identity is its project and name, as a network's.
        identityKey: `gcp|compute.googleapis.com/firewall|${PROJECT}|allow-ssh`,
      }),
    );
    expect(item!.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/global/networks/default`,
        targetType: GCP_NETWORK_TYPE,
      },
    ]);
  });

  test("keep what they let in or keep out, with their ports as people read them", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      firewallAsset("web", {
        priority: 900,
        allowed: [
          { IPProtocol: "tcp", ports: ["80", "443"] },
          { IPProtocol: "icmp" },
        ],
        denied: [{ IPProtocol: "udp", ports: ["53"] }],
        targetTags: ["http-server"],
        sourceRanges: ["0.0.0.0/0", "::/0"],
        logConfig: { enable: true },
      }),
      { projectId: PROJECT },
    );

    expect(item!.properties).toEqual({
      direction: "INGRESS",
      priority: 900,
      allowed: ["tcp:80,443", "icmp"],
      denied: ["udp:53"],
      sourceRanges: ["0.0.0.0/0", "::/0"],
      targetTags: ["http-server"],
    });
  });

  test("a disabled rule says so", () => {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      firewallAsset("old", { disabled: true }),
      { projectId: PROJECT },
    );

    expect(item!.properties["disabled"]).toBe(true);
  });
});

describe("what a firewall rule guards", () => {
  const items: Array<CloudInventoryItem> = readProject([
    networkAsset("default"),
    networkAsset("other"),
    subnetAsset("europe-west1"),
    // Every instance of the network.
    firewallAsset("allow-internal", { sourceRanges: ["10.128.0.0/9"] }),
    // Only those tagged http-server.
    firewallAsset("allow-http", {
      allowed: [{ IPProtocol: "tcp", ports: ["80"] }],
      targetTags: ["http-server"],
    }),
    // Only those running as the backend's service account.
    firewallAsset("allow-backend", {
      targetServiceAccounts: [`Backend@${PROJECT}.iam.gserviceaccount.com`],
    }),
    // Turned off: guards nothing.
    firewallAsset("allow-all-old", { disabled: true }),
    // Another network's: guards nothing here.
    firewallAsset("other-ssh", {}, "other"),
    instanceAsset("web-1", {
      tags: { items: ["http-server"] },
      serviceAccounts: [{ email: `web@${PROJECT}.iam.gserviceaccount.com` }],
    }),
    instanceAsset("api-1", {
      serviceAccounts: [
        { email: `backend@${PROJECT}.iam.gserviceaccount.com` },
      ],
    }),
    instanceAsset("batch-1"),
  ]);

  test("a rule with no targets guards every instance of its network", () => {
    for (const name of ["web-1", "api-1", "batch-1"]) {
      expect(guards(itemNamed(items, "gce_instance", name))).toContain(
        `${FULL}/global/firewalls/allow-internal`,
      );
    }
  });

  test("a rule with target tags guards the instances tagged with one", () => {
    expect(guards(itemNamed(items, "gce_instance", "web-1"))).toEqual([
      `${FULL}/global/firewalls/allow-internal`,
      `${FULL}/global/firewalls/allow-http`,
    ]);
  });

  test("a rule with target service accounts guards the instances running as one, in any case", () => {
    expect(guards(itemNamed(items, "gce_instance", "api-1"))).toEqual([
      `${FULL}/global/firewalls/allow-internal`,
      `${FULL}/global/firewalls/allow-backend`,
    ]);
    expect(guards(itemNamed(items, "gce_instance", "batch-1"))).toEqual([
      `${FULL}/global/firewalls/allow-internal`,
    ]);
  });

  test("an instance of another network is guarded by that network's rules alone", () => {
    const elsewhere: Array<CloudInventoryItem> = readProject([
      firewallAsset("allow-internal"),
      firewallAsset("other-ssh", {}, "other"),
      instanceAsset("lone-1", {}, "other"),
    ]);

    expect(guards(itemNamed(elsewhere, "gce_instance", "lone-1"))).toEqual([
      `${FULL}/global/firewalls/other-ssh`,
    ]);
  });

  test("the edges name the firewall rule's type, so they are never matched to another resource", () => {
    const relationship: CloudResourceRelationship | undefined = itemNamed(
      items,
      "gce_instance",
      "web-1",
    ).relationships.find((entry: CloudResourceRelationship): boolean => {
      return entry.kind === CloudRelationshipKind.ProtectedBy;
    });

    expect(relationship!.targetType).toBe(GCP_FIREWALL_TYPE);
  });
});

describe("relationships, matched to the resources a project holds", () => {
  test("an instance is in its subnet, the subnet in its network, and a firewall rule guards the instance", () => {
    const items: Array<CloudInventoryItem> = readProject([
      networkAsset("default"),
      subnetAsset("europe-west1"),
      subnetAsset("us-east1"),
      firewallAsset("allow-ssh"),
      instanceAsset("web-1"),
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
          `${item.resource.resourceType}:${item.resource.region}:${item.resource.name}`,
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
        `compute.googleapis.com/Subnetwork:europe-west1:default runs-in compute.googleapis.com/Network:global:default`,
        `compute.googleapis.com/Subnetwork:us-east1:default runs-in compute.googleapis.com/Network:global:default`,
        `compute.googleapis.com/Firewall:global:allow-ssh runs-in compute.googleapis.com/Network:global:default`,
        // The instance's own subnet, never the other region's "default".
        `gce_instance:europe-west1:web-1 runs-in compute.googleapis.com/Subnetwork:europe-west1:default`,
        `gce_instance:europe-west1:web-1 runs-in compute.googleapis.com/Network:global:default`,
        `gce_instance:europe-west1:web-1 protected-by compute.googleapis.com/Firewall:global:allow-ssh`,
      ].sort(),
    );
  });
});

describe("the catalog", () => {
  test("lists subnets and firewall rules as resources with no metrics of their own", () => {
    for (const type of [GCP_SUBNETWORK_TYPE, GCP_FIREWALL_TYPE]) {
      expect(
        GCP_INVENTORY_TYPES.some((entry: GcpInventoryType): boolean => {
          return entry.assetType === type && !entry.monitoredType;
        }),
      ).toBe(true);
      expect(
        getCloudResourceTypeDescriptor(CloudProvider.GCP, type),
      ).not.toBeNull();
      expect(isInventoryOnlyCloudResourceType(CloudProvider.GCP, type)).toBe(
        true,
      );
    }
  });
});

describe("the next listing", () => {
  test("tells a changed firewall rule from an unchanged subnet, and a deleted rule is gone", () => {
    const before: Array<CloudInventoryItem> = readProject([
      networkAsset("default"),
      subnetAsset("europe-west1"),
      firewallAsset("allow-ssh"),
      firewallAsset("allow-old"),
    ]);
    const after: Array<CloudInventoryItem> = readProject([
      networkAsset("default"),
      subnetAsset("europe-west1"),
      firewallAsset("allow-ssh", {
        allowed: [{ IPProtocol: "tcp", ports: ["22", "3389"] }],
      }),
    ]);
    const fingerprint: (
      items: Array<CloudInventoryItem>,
      type: string,
      name: string,
    ) => string = (
      items: Array<CloudInventoryItem>,
      type: string,
      name: string,
    ): string => {
      return getInventoryFingerprint(itemNamed(items, type, name));
    };

    expect(fingerprint(after, GCP_SUBNETWORK_TYPE, "default")).toBe(
      fingerprint(before, GCP_SUBNETWORK_TYPE, "default"),
    );
    expect(fingerprint(after, GCP_FIREWALL_TYPE, "allow-ssh")).not.toBe(
      fingerprint(before, GCP_FIREWALL_TYPE, "allow-ssh"),
    );

    // A project listed in full lists every type of the inventory.
    const listedInFull: Array<{
      accountId: string;
      resourceTypes: Array<string>;
    }> = [
      {
        accountId: PROJECT,
        resourceTypes: GCP_INVENTORY_TYPES.map(
          (type: GcpInventoryType): string => {
            return type.monitoredType || type.assetType;
          },
        ),
      },
    ];
    const old: CloudInventoryItem = itemNamed(
      before,
      GCP_FIREWALL_TYPE,
      "allow-old",
    );

    expect(
      after.some((item: CloudInventoryItem): boolean => {
        return item.resource.identityKey === old.resource.identityKey;
      }),
    ).toBe(false);
    expect(
      isGoneFromListing({
        row: {
          cloudAccountId: old.resource.accountId,
          cloudResourceType: old.resource.resourceType,
          cloudRegion: old.resource.region,
        },
        completelyListed: listedInFull,
      }),
    ).toBe(true);
  });
});
