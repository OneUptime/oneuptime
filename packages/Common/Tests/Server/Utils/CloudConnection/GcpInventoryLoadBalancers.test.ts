import {
  GCP_BACKEND_SERVICE_TYPE,
  GCP_FORWARDING_RULE_TYPE,
  GCP_GLOBAL_FORWARDING_RULE_TYPE,
  GCP_INVENTORY_TYPES,
  GCP_LOOKUP_ASSET_TYPES,
  GCP_REGION_BACKEND_SERVICE_TYPE,
  GCP_URL_MAP_TYPE,
  GcpAsset,
  GcpInventoryContext,
  GcpInventoryType,
  addGcpInventoryEdges,
  buildGcpInventoryContext,
  buildGcpInventoryItem,
  computeTypeOf,
  computeUrlToFullName,
  getGcpInventoryResourceType,
  getGcpListedAssetTypes,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "../../../../Types/Cloud/CloudInventory";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  CloudResourceLink,
  getCloudResourceLinks,
} from "../../../../Types/Cloud/CloudResourceIndex";
import {
  getCloudResourceTypeDescriptor,
  getCloudResourceTypeDisplayName,
  isInventoryOnlyCloudResourceType,
} from "../../../../Types/Cloud/CloudResourceCatalog";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * A Google Cloud project's load balancers, from Cloud Asset Inventory
 * (#9306). A URL map is an Application Load Balancer, filed under the
 * monitored resource its metrics name so the listed one and the measured
 * one are one row; its backend services and its forwarding rules - its
 * addresses - are listed too, and a forwarding rule sends to its URL map
 * through the target proxy between them. The fixtures are the Compute
 * API's resource shapes, as Cloud Asset returns them in `resource.data`.
 */

const PROJECT: string = "shop-prod";
const COMPUTE: string = `https://www.googleapis.com/compute/v1/projects/${PROJECT}`;
const FULL: string = `//compute.googleapis.com/projects/${PROJECT}`;

function asset(
  assetType: string,
  path: string,
  data: Record<string, unknown>,
  location: string = "global",
): GcpAsset {
  return {
    name: `${FULL}/${path}`,
    assetType,
    location,
    data: { name: path.split("/").pop(), ...data } as never,
  };
}

const webService: GcpAsset = asset(
  GCP_BACKEND_SERVICE_TYPE,
  "global/backendServices/web",
  {
    loadBalancingScheme: "EXTERNAL_MANAGED",
    protocol: "HTTP",
    portName: "http",
    timeoutSec: 30,
    healthChecks: [`${COMPUTE}/global/healthChecks/web`],
    backends: [
      {
        group: `${COMPUTE}/zones/europe-west1-b/instanceGroups/web-mig`,
        balancingMode: "UTILIZATION",
      },
    ],
    iap: { oauth2ClientSecret: "s3cret" },
  },
);
const apiService: GcpAsset = asset(
  GCP_BACKEND_SERVICE_TYPE,
  "global/backendServices/api",
  {
    loadBalancingScheme: "EXTERNAL_MANAGED",
    protocol: "HTTPS",
    backends: [
      {
        group: `${COMPUTE}/regions/europe-west1/networkEndpointGroups/api-neg`,
      },
    ],
  },
);
const shopMap: GcpAsset = asset(GCP_URL_MAP_TYPE, "global/urlMaps/shop", {
  defaultService: `${COMPUTE}/global/backendServices/web`,
  hostRules: [
    { hosts: ["shop.example.com", "*.example.com"], pathMatcher: "main" },
  ],
  pathMatchers: [
    {
      name: "main",
      defaultService: `${COMPUTE}/global/backendServices/web`,
      pathRules: [
        { paths: ["/api/*"], service: `${COMPUTE}/global/backendServices/api` },
        {
          paths: ["/static/*"],
          service: `${COMPUTE}/global/backendBuckets/static`,
        },
      ],
    },
  ],
});
const httpsProxy: GcpAsset = asset(
  "compute.googleapis.com/TargetHttpsProxy",
  "global/targetHttpsProxies/shop-https",
  {
    urlMap: `${COMPUTE}/global/urlMaps/shop`,
    sslCertificates: [`${COMPUTE}/global/sslCertificates/shop`],
  },
);
const shopRule: GcpAsset = asset(
  GCP_GLOBAL_FORWARDING_RULE_TYPE,
  "global/forwardingRules/shop-https",
  {
    IPAddress: "34.120.1.2",
    IPProtocol: "TCP",
    portRange: "443-443",
    loadBalancingScheme: "EXTERNAL_MANAGED",
    target: `${COMPUTE}/global/targetHttpsProxies/shop-https`,
    networkTier: "PREMIUM",
  },
);

const internalService: GcpAsset = asset(
  GCP_REGION_BACKEND_SERVICE_TYPE,
  "regions/europe-west1/backendServices/orders",
  {
    region: `${COMPUTE}/regions/europe-west1`,
    loadBalancingScheme: "INTERNAL_MANAGED",
    protocol: "HTTP",
    network: `${COMPUTE}/global/networks/default`,
    backends: [
      {
        group: `${COMPUTE}/zones/europe-west1-c/instanceGroups/orders-mig`,
      },
    ],
  },
  "europe-west1",
);
const internalMap: GcpAsset = asset(
  GCP_URL_MAP_TYPE,
  "regions/europe-west1/urlMaps/orders",
  {
    region: `${COMPUTE}/regions/europe-west1`,
    defaultService: `${COMPUTE}/regions/europe-west1/backendServices/orders`,
  },
  "europe-west1",
);

function contextOf(assets: Array<GcpAsset>): GcpInventoryContext {
  return buildGcpInventoryContext({ projectId: PROJECT, assets });
}

// A project's assets as the connector reads them, edges and all.
function readProject(assets: Array<GcpAsset>): Array<CloudInventoryItem> {
  const context: GcpInventoryContext = contextOf(assets);
  const items: Array<CloudInventoryItem> = [];
  const byItem: Map<CloudInventoryItem, GcpAsset> = new Map();

  for (const entry of assets) {
    const item: CloudInventoryItem | null = buildGcpInventoryItem(
      entry,
      context,
    );

    if (item) {
      items.push(item);
      byItem.set(item, entry);
    }
  }

  addGcpInventoryEdges({ items, assets: byItem, listed: assets });
  return items;
}

function itemAt(
  items: Array<CloudInventoryItem>,
  path: string,
): CloudInventoryItem {
  const found: CloudInventoryItem | undefined = items.find(
    (item: CloudInventoryItem): boolean => {
      return item.resource.providerResourceId === `${FULL}/${path}`;
    },
  );

  if (!found) {
    throw new Error(`Nothing at ${path}`);
  }

  return found;
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
    metricName: "loadbalancing.googleapis.com/https/request_count",
    attributes,
  });
}

function routes(item: CloudInventoryItem): Array<string> {
  return item.relationships
    .filter((relationship: CloudResourceRelationship): boolean => {
      return relationship.kind === CloudRelationshipKind.RoutesTo;
    })
    .map((relationship: CloudResourceRelationship): string => {
      return `${relationship.target} (${relationship.targetType})`;
    });
}

describe("a URL map is the load balancer its metrics name", () => {
  test("a global one is an external Application Load Balancer, the row its https_lb_rule metrics file under", () => {
    const items: Array<CloudInventoryItem> = readProject([webService, shopMap]);
    const balancer: CloudInventoryItem = itemAt(items, "global/urlMaps/shop");
    const metric: CloudMonitoredResource | null = fromMetrics("https_lb_rule", {
      project_id: PROJECT,
      url_map_name: "shop",
      forwarding_rule_name: "shop-https",
      backend_name: "web",
    });

    expect(balancer.resource.resourceType).toBe("https_lb_rule");
    expect(balancer.resource.identityKey).toBe(metric!.identityKey);
    expect(balancer.resource.providerResourceId).toBe(
      metric!.providerResourceId,
    );
  });

  test("a regional internal one is an internal Application Load Balancer, by project, region and name", () => {
    const items: Array<CloudInventoryItem> = readProject([
      internalService,
      internalMap,
    ]);
    const balancer: CloudInventoryItem = itemAt(
      items,
      "regions/europe-west1/urlMaps/orders",
    );
    const metric: CloudMonitoredResource | null = fromMetrics(
      "internal_http_lb_rule",
      { project_id: PROJECT, region: "europe-west1", url_map_name: "orders" },
    );

    expect(balancer.resource.resourceType).toBe("internal_http_lb_rule");
    expect(balancer.resource.identityKey).toBe(metric!.identityKey);
    expect(balancer.resource.providerResourceId).toBe(
      metric!.providerResourceId,
    );
  });

  test("one OneUptime reads no metrics of - regional external, cross-region internal - is still listed, as a URL map", () => {
    const regionalExternal: Array<CloudInventoryItem> = readProject([
      {
        ...internalService,
        data: {
          ...internalService.data,
          loadBalancingScheme: "EXTERNAL_MANAGED",
        },
      },
      internalMap,
    ]);
    const crossRegionInternal: Array<CloudInventoryItem> = readProject([
      {
        ...webService,
        data: { ...webService.data, loadBalancingScheme: "INTERNAL_MANAGED" },
      },
      shopMap,
    ]);

    const regional: CloudInventoryItem = itemAt(
      regionalExternal,
      "regions/europe-west1/urlMaps/orders",
    );
    expect(regional.resource.resourceType).toBe(GCP_URL_MAP_TYPE);
    expect(regional.resource.region).toBe("europe-west1");
    expect(regional.resource.identityKey).toBe(
      `gcp|compute.googleapis.com/urlmap|${PROJECT}|europe-west1|orders`,
    );
    expect(
      itemAt(crossRegionInternal, "global/urlMaps/shop").resource.resourceType,
    ).toBe(GCP_URL_MAP_TYPE);
  });

  test("a URL map whose backend is a bucket is external; one with no known backend goes by its region", () => {
    const bucketOnly: GcpAsset = asset(GCP_URL_MAP_TYPE, "global/urlMaps/cdn", {
      defaultService: `${COMPUTE}/global/backendBuckets/static`,
    });

    expect(
      contextOf([bucketOnly]).urlMapSchemes!.get(bucketOnly.name.toLowerCase()),
    ).toBe("EXTERNAL");
    expect(
      buildGcpInventoryItem(bucketOnly, contextOf([bucketOnly]))!.resource
        .resourceType,
    ).toBe("https_lb_rule");
    // Its backend service not listed: global is external, regional internal.
    expect(
      buildGcpInventoryItem(shopMap, { projectId: PROJECT })!.resource
        .resourceType,
    ).toBe("https_lb_rule");
    expect(
      buildGcpInventoryItem(internalMap, { projectId: PROJECT })!.resource
        .resourceType,
    ).toBe("internal_http_lb_rule");
  });

  test("keeps the hosts it answers for as its endpoints, and sends to every backend its routes name, once each", () => {
    const balancer: CloudInventoryItem = itemAt(
      readProject([webService, apiService, shopMap]),
      "global/urlMaps/shop",
    );

    expect(balancer.properties).toEqual({
      hosts: ["shop.example.com"],
      defaultBackend: "web",
    });
    // A wildcard host names no one host.
    expect(balancer.endpoints).toEqual(["shop.example.com"]);
    expect(routes(balancer)).toEqual([
      `${FULL}/global/backendServices/web (${GCP_BACKEND_SERVICE_TYPE})`,
      `${FULL}/global/backendServices/api (${GCP_BACKEND_SERVICE_TYPE})`,
      `${FULL}/global/backendBuckets/static (compute.googleapis.com/BackendBucket)`,
    ]);
  });
});

describe("backend services", () => {
  test("global and regional alike are backend services, a regional one kept in its region", () => {
    const items: Array<CloudInventoryItem> = readProject([
      webService,
      internalService,
    ]);
    const global: CloudInventoryItem = itemAt(
      items,
      "global/backendServices/web",
    );
    const regional: CloudInventoryItem = itemAt(
      items,
      "regions/europe-west1/backendServices/orders",
    );

    expect(global.resource.resourceType).toBe(GCP_BACKEND_SERVICE_TYPE);
    expect(global.resource.identityKey).toBe(
      `gcp|compute.googleapis.com/backendservice|${PROJECT}|web`,
    );
    expect(regional.resource.resourceType).toBe(GCP_BACKEND_SERVICE_TYPE);
    expect(regional.resource.region).toBe("europe-west1");
    expect(regional.resource.identityKey).toBe(
      `gcp|compute.googleapis.com/backendservice|${PROJECT}|europe-west1|orders`,
    );
  });

  test("keep how they balance, never their secrets, and send to their instance groups and endpoint groups", () => {
    const items: Array<CloudInventoryItem> = readProject([
      webService,
      apiService,
      internalService,
    ]);
    const web: CloudInventoryItem = itemAt(items, "global/backendServices/web");

    expect(web.properties).toEqual({
      loadBalancingScheme: "EXTERNAL_MANAGED",
      protocol: "HTTP",
      portName: "http",
      timeoutSec: 30,
    });
    expect(JSON.stringify(web)).not.toContain("s3cret");
    expect(routes(web)).toEqual([
      `${FULL}/zones/europe-west1-b/instanceGroups/web-mig (compute.googleapis.com/InstanceGroup)`,
    ]);
    expect(routes(itemAt(items, "global/backendServices/api"))).toEqual([
      `${FULL}/regions/europe-west1/networkEndpointGroups/api-neg (compute.googleapis.com/NetworkEndpointGroup)`,
    ]);
    // An internal one runs in its network.
    expect(
      itemAt(items, "regions/europe-west1/backendServices/orders")
        .relationships,
    ).toContainEqual({
      kind: CloudRelationshipKind.RunsIn,
      target: `${FULL}/global/networks/default`,
      targetType: "compute.googleapis.com/Network",
    });
  });
});

describe("forwarding rules", () => {
  test("a rule sends to its URL map through its target proxy, and gives the load balancer its address", () => {
    const items: Array<CloudInventoryItem> = readProject([
      webService,
      shopMap,
      httpsProxy,
      shopRule,
    ]);
    const rule: CloudInventoryItem = itemAt(
      items,
      "global/forwardingRules/shop-https",
    );
    const balancer: CloudInventoryItem = itemAt(items, "global/urlMaps/shop");

    // A global forwarding rule is a forwarding rule.
    expect(rule.resource.resourceType).toBe(GCP_FORWARDING_RULE_TYPE);
    expect(rule.properties).toEqual({
      IPAddress: "34.120.1.2",
      IPProtocol: "TCP",
      portRange: "443-443",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      networkTier: "PREMIUM",
    });
    expect(routes(rule)).toEqual([
      `${FULL}/global/urlMaps/shop (https_lb_rule)`,
    ]);
    // The address is the load balancer's: a monitor of it links to the one with metrics.
    expect(balancer.endpoints).toEqual(["shop.example.com", "34.120.1.2"]);
    expect(rule.endpoints).toEqual([]);
    // The proxy itself is never kept.
    expect(
      items.some((item: CloudInventoryItem): boolean => {
        return item.resource.providerResourceId.includes("targetHttpsProxies");
      }),
    ).toBe(false);
  });

  test("an internal passthrough rule sends to its backend service, keeps its address, and runs in its subnet", () => {
    const passthrough: GcpAsset = asset(
      GCP_FORWARDING_RULE_TYPE,
      "regions/europe-west1/forwardingRules/orders-ilb",
      {
        region: `${COMPUTE}/regions/europe-west1`,
        IPAddress: "10.132.0.50",
        IPProtocol: "TCP",
        ports: ["8080"],
        loadBalancingScheme: "INTERNAL",
        backendService: `${COMPUTE}/regions/europe-west1/backendServices/orders`,
        network: `${COMPUTE}/global/networks/default`,
        subnetwork: `${COMPUTE}/regions/europe-west1/subnetworks/default`,
      },
      "europe-west1",
    );
    const items: Array<CloudInventoryItem> = readProject([
      internalService,
      passthrough,
    ]);
    const rule: CloudInventoryItem = itemAt(
      items,
      "regions/europe-west1/forwardingRules/orders-ilb",
    );

    expect(rule.resource.region).toBe("europe-west1");
    expect(rule.endpoints).toEqual(["10.132.0.50"]);
    expect(rule.relationships).toEqual([
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/regions/europe-west1/subnetworks/default`,
        targetType: "compute.googleapis.com/Subnetwork",
      },
      {
        kind: CloudRelationshipKind.RunsIn,
        target: `${FULL}/global/networks/default`,
        targetType: "compute.googleapis.com/Network",
      },
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: `${FULL}/regions/europe-west1/backendServices/orders`,
        targetType: GCP_BACKEND_SERVICE_TYPE,
      },
    ]);
  });

  test("a rule to a target pool, or through a TCP proxy to a backend service, says so", () => {
    const poolRule: GcpAsset = asset(
      GCP_FORWARDING_RULE_TYPE,
      "regions/us-east1/forwardingRules/legacy",
      {
        IPAddress: "35.1.1.1",
        target: `${COMPUTE}/regions/us-east1/targetPools/legacy-pool`,
      },
      "us-east1",
    );
    const tcpProxy: GcpAsset = asset(
      "compute.googleapis.com/TargetTcpProxy",
      "global/targetTcpProxies/db",
      { service: `${COMPUTE}/global/backendServices/web` },
    );
    const tcpRule: GcpAsset = asset(
      GCP_GLOBAL_FORWARDING_RULE_TYPE,
      "global/forwardingRules/db",
      {
        IPAddress: "34.1.1.9",
        target: `${COMPUTE}/global/targetTcpProxies/db`,
      },
    );
    const items: Array<CloudInventoryItem> = readProject([
      webService,
      poolRule,
      tcpProxy,
      tcpRule,
    ]);

    expect(
      routes(itemAt(items, "regions/us-east1/forwardingRules/legacy")),
    ).toEqual([
      `${FULL}/regions/us-east1/targetPools/legacy-pool (compute.googleapis.com/TargetPool)`,
    ]);
    const proxied: CloudInventoryItem = itemAt(
      items,
      "global/forwardingRules/db",
    );
    expect(routes(proxied)).toEqual([
      `${FULL}/global/backendServices/web (${GCP_BACKEND_SERVICE_TYPE})`,
    ]);
    // Not a URL map: the address stays the rule's.
    expect(proxied.endpoints).toEqual(["34.1.1.9"]);
  });

  test("a rule whose proxy the listing did not return still names the proxy", () => {
    const items: Array<CloudInventoryItem> = readProject([shopRule]);

    expect(
      itemAt(items, "global/forwardingRules/shop-https").relationships,
    ).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: `${FULL}/global/targetHttpsProxies/shop-https`,
      },
    ]);
  });
});

describe("relationships, matched to the resources a project holds", () => {
  test("address -> load balancer -> backend services, each a link between two resources", () => {
    const items: Array<CloudInventoryItem> = readProject([
      webService,
      apiService,
      shopMap,
      httpsProxy,
      shopRule,
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
        `${GCP_FORWARDING_RULE_TYPE}:shop-https routes-to https_lb_rule:shop`,
        `https_lb_rule:shop routes-to ${GCP_BACKEND_SERVICE_TYPE}:web`,
        `https_lb_rule:shop routes-to ${GCP_BACKEND_SERVICE_TYPE}:api`,
      ].sort(),
    );
  });
});

describe("the listing", () => {
  test("asks Cloud Asset for every type once, the target proxies too", () => {
    const listed: Array<string> = getGcpListedAssetTypes();

    expect(new Set(listed).size).toBe(listed.length);

    for (const type of [
      ...GCP_LOOKUP_ASSET_TYPES,
      GCP_URL_MAP_TYPE,
      GCP_BACKEND_SERVICE_TYPE,
      GCP_REGION_BACKEND_SERVICE_TYPE,
      GCP_FORWARDING_RULE_TYPE,
      GCP_GLOBAL_FORWARDING_RULE_TYPE,
    ]) {
      expect(listed).toContain(type);
    }
  });

  test("a full listing lists both load balancers' types and the URL maps, backend services and forwarding rules, never a proxy", () => {
    const kept: Array<string> = GCP_INVENTORY_TYPES.map(
      getGcpInventoryResourceType,
    );

    for (const type of [
      "https_lb_rule",
      "internal_http_lb_rule",
      GCP_URL_MAP_TYPE,
      GCP_BACKEND_SERVICE_TYPE,
      GCP_FORWARDING_RULE_TYPE,
    ]) {
      expect(kept).toContain(type);
    }

    for (const type of [
      ...GCP_LOOKUP_ASSET_TYPES,
      GCP_REGION_BACKEND_SERVICE_TYPE,
      GCP_GLOBAL_FORWARDING_RULE_TYPE,
    ]) {
      expect(kept).not.toContain(type);
    }
  });

  test("every type kept without metrics has a catalog entry of its own", () => {
    for (const type of GCP_INVENTORY_TYPES) {
      if (!type.monitoredType) {
        const kept: string = getGcpInventoryResourceType(
          type as GcpInventoryType,
        );

        expect({
          kept,
          listed: getCloudResourceTypeDescriptor(CloudProvider.GCP, kept)
            ? isInventoryOnlyCloudResourceType(CloudProvider.GCP, kept)
            : false,
        }).toEqual({ kept, listed: true });
      }
    }
  });

  test("what a load balancer points at but OneUptime does not list reads as a name", () => {
    expect(
      getCloudResourceTypeDisplayName(
        CloudProvider.GCP,
        "compute.googleapis.com/NetworkEndpointGroup",
      ),
    ).toBe("Network Endpoint Group");
    expect(
      getCloudResourceTypeDisplayName(
        CloudProvider.GCP,
        "compute.googleapis.com/BackendBucket",
      ),
    ).toBe("Backend Bucket");
    expect(
      getCloudResourceTypeDisplayName(
        CloudProvider.GCP,
        "compute.googleapis.com/TargetPool",
      ),
    ).toBe("Target Pool");
  });
});

describe("Compute names", () => {
  test("a relative name is a full one too, and a collection names its type", () => {
    expect(
      computeUrlToFullName(`projects/${PROJECT}/global/backendServices/web`),
    ).toBe(`${FULL}/global/backendServices/web`);
    expect(computeTypeOf(`${FULL}/global/backendServices/web`)).toBe(
      GCP_BACKEND_SERVICE_TYPE,
    );
    expect(computeTypeOf(`${FULL}/global/healthChecks/web`)).toBeUndefined();
  });
});
