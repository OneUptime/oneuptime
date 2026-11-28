import { describe, expect, test } from "@jest/globals";
import {
  GCP_FORWARDING_RULE_TYPE,
  GCP_GLOBAL_FORWARDING_RULE_TYPE,
  GCP_REGION_BACKEND_SERVICE_TYPE,
  GCP_SUBNETWORK_TYPE,
  GCP_URL_MAP_TYPE,
  GcpAsset,
  GcpInventoryContext,
  addGcpInventoryEdges,
  buildGcpInventoryContext,
  buildGcpInventoryItem,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpInventory";
import { CloudInventoryItem } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { GOOGLE_FRONT_END_RANGES } from "../../../../Utils/SecurityEvent/OwnLoadBalancers";
import {
  GoogleProxyOnlyReading,
  PassOnLoadBalancerKind,
  PassOnReason,
  PassOnRecord,
  readGoogleFrontEndPassOnLoadBalancer,
  readGoogleManagedProxyRule,
  readGoogleProxyOnlySubnet,
  readGoogleProxyOnlySubnetUses,
} from "../../../../Utils/SecurityEvent/PassOnLoadBalancers";

/*
 * #11389: A GOOGLE CLOUD PROJECT'S PROXY-ONLY SUBNETS, AND THE LOAD
 * BALANCERS THAT CONNECT FROM THEM, as Cloud Asset Inventory lists them and
 * the inventory stores them.
 *
 * Every Envoy-based load balancer of a region and VPC network - regional
 * external and internal Application Load Balancers and proxy Network Load
 * Balancers alike - reaches its backends from the region's proxy-only
 * subnet. An Application Load Balancer adds the client it forwards to
 * X-Forwarded-For; a proxy Network Load Balancer passes on what the client
 * wrote. So the subnet is trusted only while Application Load Balancers
 * alone use it, and never while a proxy one does. These read recorded
 * assets - the Compute API's resource shapes, as Cloud Asset returns them in
 * `resource.data` - through the inventory, and hold the readers to the
 * records it keeps.
 */

const PROJECT: string = "shop-prod";
const COMPUTE: string = `https://www.googleapis.com/compute/v1/projects/${PROJECT}`;
const FULL: string = `//compute.googleapis.com/projects/${PROJECT}`;
const REGION: string = "us-central1";

function asset(
  assetType: string,
  path: string,
  data: Record<string, unknown>,
  location: string = REGION,
): GcpAsset {
  return {
    name: `${FULL}/${path}`,
    assetType,
    location,
    data: { name: path.split("/").pop(), ...data } as never,
  };
}

// The region's proxy-only subnet, as gcloud compute networks subnets create --purpose=REGIONAL_MANAGED_PROXY makes it.
const proxyOnlySubnet: GcpAsset = asset(
  GCP_SUBNETWORK_TYPE,
  `regions/${REGION}/subnetworks/proxy-only`,
  {
    network: `${COMPUTE}/global/networks/default`,
    region: `${COMPUTE}/regions/${REGION}`,
    ipCidrRange: "10.129.0.0/23",
    gatewayAddress: "10.129.0.1",
    purpose: "REGIONAL_MANAGED_PROXY",
    role: "ACTIVE",
    stackType: "IPV4_ONLY",
    privateIpGoogleAccess: false,
    fingerprint: "PZg5xI0VZwI=",
  },
);

// The region's ordinary subnet, which the internal load balancers' addresses are in.
const defaultSubnet: GcpAsset = asset(
  GCP_SUBNETWORK_TYPE,
  `regions/${REGION}/subnetworks/default`,
  {
    network: `${COMPUTE}/global/networks/default`,
    region: `${COMPUTE}/regions/${REGION}`,
    ipCidrRange: "10.128.0.0/20",
    gatewayAddress: "10.128.0.1",
    purpose: "PRIVATE",
    stackType: "IPV4_ONLY",
    privateIpGoogleAccess: true,
  },
);

// A regional internal Application Load Balancer: its backend service, URL map, target HTTPS proxy and forwarding rule.
const ordersService: GcpAsset = asset(
  GCP_REGION_BACKEND_SERVICE_TYPE,
  `regions/${REGION}/backendServices/orders`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    loadBalancingScheme: "INTERNAL_MANAGED",
    protocol: "HTTP",
    network: `${COMPUTE}/global/networks/default`,
    backends: [
      { group: `${COMPUTE}/zones/${REGION}-a/instanceGroups/orders-mig` },
    ],
  },
);
const ordersMap: GcpAsset = asset(
  GCP_URL_MAP_TYPE,
  `regions/${REGION}/urlMaps/orders`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    defaultService: `${COMPUTE}/regions/${REGION}/backendServices/orders`,
  },
);
const ordersProxy: GcpAsset = asset(
  "compute.googleapis.com/TargetHttpsProxy",
  `regions/${REGION}/targetHttpsProxies/orders-https`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    urlMap: `${COMPUTE}/regions/${REGION}/urlMaps/orders`,
  },
);
const ordersRule: GcpAsset = asset(
  GCP_FORWARDING_RULE_TYPE,
  `regions/${REGION}/forwardingRules/orders`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    IPAddress: "10.128.0.9",
    IPProtocol: "TCP",
    portRange: "443-443",
    loadBalancingScheme: "INTERNAL_MANAGED",
    target: `${COMPUTE}/regions/${REGION}/targetHttpsProxies/orders-https`,
    network: `${COMPUTE}/global/networks/default`,
    subnetwork: `${COMPUTE}/regions/${REGION}/subnetworks/default`,
    networkTier: "PREMIUM",
  },
);

// A regional external proxy Network Load Balancer: its backend service, target TCP proxy and forwarding rule.
const dbService: GcpAsset = asset(
  GCP_REGION_BACKEND_SERVICE_TYPE,
  `regions/${REGION}/backendServices/db`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    loadBalancingScheme: "EXTERNAL_MANAGED",
    protocol: "TCP",
    network: `${COMPUTE}/global/networks/default`,
    backends: [
      { group: `${COMPUTE}/zones/${REGION}-b/networkEndpointGroups/db-neg` },
    ],
  },
);
const dbProxy: GcpAsset = asset(
  "compute.googleapis.com/TargetTcpProxy",
  `regions/${REGION}/targetTcpProxies/db-tcp`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    service: `${COMPUTE}/regions/${REGION}/backendServices/db`,
    proxyHeader: "NONE",
  },
);
const dbRule: GcpAsset = asset(
  GCP_FORWARDING_RULE_TYPE,
  `regions/${REGION}/forwardingRules/db-tcp`,
  {
    region: `${COMPUTE}/regions/${REGION}`,
    IPAddress: "34.41.10.20",
    IPProtocol: "TCP",
    portRange: "5432-5432",
    loadBalancingScheme: "EXTERNAL_MANAGED",
    target: `${COMPUTE}/regions/${REGION}/targetTcpProxies/db-tcp`,
    network: `${COMPUTE}/global/networks/default`,
    networkTier: "STANDARD",
  },
);

// A global external proxy Network Load Balancer, which connects from Google's front ends.
const mailProxy: GcpAsset = asset(
  "compute.googleapis.com/TargetSslProxy",
  "global/targetSslProxies/mail-ssl",
  { service: `${COMPUTE}/global/backendServices/mail` },
  "global",
);
const mailRule: GcpAsset = asset(
  GCP_GLOBAL_FORWARDING_RULE_TYPE,
  "global/forwardingRules/mail-ssl",
  {
    IPAddress: "34.120.9.9",
    IPProtocol: "TCP",
    portRange: "993-993",
    loadBalancingScheme: "EXTERNAL",
    target: `${COMPUTE}/global/targetSslProxies/mail-ssl`,
    networkTier: "PREMIUM",
  },
  "global",
);

// A project's assets as the connector reads them, edges and all.
function readProject(assets: Array<GcpAsset>): Array<CloudInventoryItem> {
  const context: GcpInventoryContext = buildGcpInventoryContext({
    projectId: PROJECT,
    assets,
  });
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

// Each item as the inventory stores it (CloudConnectionResourceSync), as Security Events reads it back.
function stored(items: Array<CloudInventoryItem>): Array<PassOnRecord> {
  return items.map((item: CloudInventoryItem): PassOnRecord => {
    return {
      cloudResourceType: item.resource.resourceType,
      providerResourceId: item.resource.providerResourceId,
      name: item.displayName || item.resource.name,
      cloudProperties: item.properties,
      cloudEndpoints: item.endpoints,
      cloudRelationships: item.relationships,
      where: "Google Cloud shop",
    };
  });
}

function recordAt(records: Array<PassOnRecord>, path: string): PassOnRecord {
  const found: PassOnRecord | undefined = records.find(
    (record: PassOnRecord): boolean => {
      return record.providerResourceId === `${FULL}/${path}`;
    },
  );

  if (!found) {
    throw new Error(`Nothing at ${path}`);
  }

  return found;
}

const APPLICATION_LOAD_BALANCER: Array<GcpAsset> = [
  ordersService,
  ordersMap,
  ordersProxy,
  ordersRule,
];
const PROXY_NETWORK_LOAD_BALANCER: Array<GcpAsset> = [
  dbService,
  dbProxy,
  dbRule,
];

describe("as the inventory stores them", () => {
  test("a proxy-only subnet keeps its purpose and its range, in its region and network", () => {
    const records: Array<PassOnRecord> = stored(
      readProject([proxyOnlySubnet, defaultSubnet]),
    );

    expect(
      readGoogleProxyOnlySubnet(
        recordAt(records, `regions/${REGION}/subnetworks/proxy-only`),
      ),
    ).toEqual({
      name: "proxy-only",
      where: "Google Cloud shop",
      region: REGION,
      network: `${FULL}/global/networks/default`.toLowerCase(),
      isGlobal: false,
      ranges: ["10.129.0.0/23"],
    });
    // The ordinary subnet is no proxy's.
    expect(
      readGoogleProxyOnlySubnet(
        recordAt(records, `regions/${REGION}/subnetworks/default`),
      ),
    ).toBeNull();
  });

  test("an internal Application Load Balancer's rule forwards its clients, through its URL map", () => {
    const records: Array<PassOnRecord> = stored(
      readProject(APPLICATION_LOAD_BALANCER),
    );

    expect(
      readGoogleManagedProxyRule(
        recordAt(records, `regions/${REGION}/forwardingRules/orders`),
      ),
    ).toEqual({
      name: "orders",
      where: "Google Cloud shop",
      region: REGION,
      network: `${FULL}/global/networks/default`.toLowerCase(),
      isGlobal: false,
      passesOn: false,
    });
  });

  test("a regional proxy Network Load Balancer's rule passes on, through its target TCP proxy to its backend service", () => {
    const records: Array<PassOnRecord> = stored(
      readProject(PROXY_NETWORK_LOAD_BALANCER),
    );

    expect(
      readGoogleManagedProxyRule(
        recordAt(records, `regions/${REGION}/forwardingRules/db-tcp`),
      )?.passesOn,
    ).toBe(true);
  });

  test("one whose target proxy the listing did not hold passes on all the same: it names a TCP proxy", () => {
    const records: Array<PassOnRecord> = stored(
      readProject([dbService, dbRule]),
    );

    expect(
      readGoogleManagedProxyRule(
        recordAt(records, `regions/${REGION}/forwardingRules/db-tcp`),
      )?.passesOn,
    ).toBe(true);
  });
});

describe("which proxy-only subnets pass on what a client wrote", () => {
  test("with only an Application Load Balancer, the subnet is theirs, and nothing passes on", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: stored(
        readProject([
          proxyOnlySubnet,
          defaultSubnet,
          ...APPLICATION_LOAD_BALANCER,
        ]),
      ),
    });

    expect(reading.passOn).toEqual([]);
    expect(reading.uses).toHaveLength(1);
    expect(reading.uses[0]).toEqual(
      expect.objectContaining({ passedOnBy: [], forwardedBy: ["orders"] }),
    );
    expect(reading.uses[0]?.subnet.ranges).toEqual(["10.129.0.0/23"]);
  });

  test("with a proxy Network Load Balancer beside it, the subnet passes on, and is never theirs", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: stored(
        readProject([
          proxyOnlySubnet,
          defaultSubnet,
          ...APPLICATION_LOAD_BALANCER,
          ...PROXY_NETWORK_LOAD_BALANCER,
        ]),
      ),
    });

    expect(reading.uses[0]).toEqual(
      expect.objectContaining({
        passedOnBy: ["db-tcp"],
        forwardedBy: ["orders"],
      }),
    );
    expect(reading.passOn).toEqual([
      {
        kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
        name: "db-tcp",
        where: "Google Cloud shop",
        reasons: [PassOnReason.ProxyOnlySubnet],
        targetGroups: [],
        ranges: ["10.129.0.0/23"],
        areRangesIncomplete: false,
      },
    ]);
  });

  test("with its proxy-only subnet in a project not connected, the proxy one says its ranges could not be read", () => {
    const reading: GoogleProxyOnlyReading = readGoogleProxyOnlySubnetUses({
      records: stored(readProject(PROXY_NETWORK_LOAD_BALANCER)),
    });

    expect(reading.passOn).toEqual([
      expect.objectContaining({
        name: "db-tcp",
        ranges: [],
        areRangesIncomplete: true,
      }),
    ]);
  });
});

describe("a global TCP or SSL proxy load balancer", () => {
  test("connects from Google's front ends, and passes on what the client wrote", () => {
    const records: Array<PassOnRecord> = stored(
      readProject([mailProxy, mailRule]),
    );

    expect(
      readGoogleFrontEndPassOnLoadBalancer(
        recordAt(records, "global/forwardingRules/mail-ssl"),
      ),
    ).toEqual({
      kind: PassOnLoadBalancerKind.GoogleCloudProxyNetworkLoadBalancer,
      name: "mail-ssl",
      where: "Google Cloud shop",
      reasons: [PassOnReason.GoogleFrontEnds],
      targetGroups: [],
      ranges: [...GOOGLE_FRONT_END_RANGES],
      areRangesIncomplete: false,
    });
    // It uses no proxy-only subnet.
    expect(
      readGoogleManagedProxyRule(
        recordAt(records, "global/forwardingRules/mail-ssl"),
      ),
    ).toBeNull();
  });

  test("a regional proxy one does not: its proxy-only subnet is what it connects from", () => {
    const records: Array<PassOnRecord> = stored(
      readProject(PROXY_NETWORK_LOAD_BALANCER),
    );

    expect(
      readGoogleFrontEndPassOnLoadBalancer(
        recordAt(records, `regions/${REGION}/forwardingRules/db-tcp`),
      ),
    ).toBeNull();
  });
});
