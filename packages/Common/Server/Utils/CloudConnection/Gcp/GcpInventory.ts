import {
  CloudRelationshipKind,
  CloudResourceRelationship,
  boundCloudRelationships,
  normalizeCloudEndpoints,
  normalizeCloudTags,
  pickCloudProperties,
  readCloudPath,
} from "../../../../Types/Cloud/CloudInventory";
import {
  CloudMonitoredResource,
  CloudMonitoringSource,
  GCP_RESOURCE_TYPE_ATTRIBUTE,
  resolveCloudMonitoredResource,
} from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CLOUD_ARMOR_POLICY_ASSET_TYPE } from "../../../../Types/CloudConnection/CloudArmorBlocklist";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudInventoryItem,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";

/*
 * A GOOGLE CLOUD PROJECT'S INVENTORY, from Cloud Asset Inventory:
 *
 *   GET https://cloudasset.googleapis.com/v1/projects/{project}/assets
 *       ?contentType=RESOURCE&assetTypes=...&pageSize=1000&pageToken=
 *   -> { assets: [{ name, assetType, resource: { data, location } }],
 *        nextPageToken }
 *
 * signed in as the connection's service account with the Cloud Asset
 * Viewer role, and the project's name from Resource Manager.
 *
 * Each asset is given the identity its Cloud Monitoring metrics give it -
 * the monitored resource's type and identity labels, run through ingest's
 * resolver - so a listed VM and the VM whose CPU the metrics read are one
 * row. A VPC network, which has no metrics, gets an identity of the same
 * shape from its name.
 *
 * Only the fields each type names are kept: an instance's metadata (its
 * startup script), a function's environment and a database's settings
 * flags never leave Google Cloud.
 */

const PROVIDER_TITLE: string = "Google Cloud Asset Inventory";
export const GCP_CLOUD_PLATFORM_READ_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform.read-only";
const ASSET_BASE_URL: string = "https://cloudasset.googleapis.com/v1";
const RESOURCE_MANAGER_BASE_URL: string =
  "https://cloudresourcemanager.googleapis.com/v3";
const LOGGING_BASE_URL: string = "https://logging.googleapis.com/v2";
const SERVICE_HEALTH_BASE_URL: string =
  "https://servicehealth.googleapis.com/v1";
// Pages of one project's audit log per read at most: 2,500 changes.
export const GCP_CHANGE_MAX_PAGES: number = 5;
const PAGE_SIZE: number = 1000;
const MAX_PAGES: number = 20;

// The type a VPC network, which has no metrics, is kept as.
export const GCP_NETWORK_TYPE: string = "compute.googleapis.com/Network";
// A network's subnets, one per region, and the firewall rules that guard it.
export const GCP_SUBNETWORK_TYPE: string = "compute.googleapis.com/Subnetwork";
export const GCP_FIREWALL_TYPE: string = "compute.googleapis.com/Firewall";
const GCP_INSTANCE_TYPE: string = "compute.googleapis.com/Instance";
/*
 * A load balancer's pieces: its URL map (an Application Load Balancer,
 * whose metrics name it), the backend services it sends to and the
 * forwarding rules - its addresses - that send to it. Cloud Asset lists a
 * regional backend service and a global forwarding rule under types of
 * their own; OneUptime keeps each pair as one type.
 */
export const GCP_URL_MAP_TYPE: string = "compute.googleapis.com/UrlMap";
export const GCP_BACKEND_SERVICE_TYPE: string =
  "compute.googleapis.com/BackendService";
export const GCP_REGION_BACKEND_SERVICE_TYPE: string =
  "compute.googleapis.com/RegionBackendService";
export const GCP_FORWARDING_RULE_TYPE: string =
  "compute.googleapis.com/ForwardingRule";
export const GCP_GLOBAL_FORWARDING_RULE_TYPE: string =
  "compute.googleapis.com/GlobalForwardingRule";
/*
 * A GKE cluster. Its Kubernetes metrics are the Kubernetes product's, so it
 * is listed with no metrics of its own, in its network, with the node VMs
 * that are part of it.
 */
export const GCP_GKE_CLUSTER_TYPE: string = "container.googleapis.com/Cluster";
const GCP_TARGET_HTTP_PROXY_TYPE: string =
  "compute.googleapis.com/TargetHttpProxy";
const GCP_TARGET_HTTPS_PROXY_TYPE: string =
  "compute.googleapis.com/TargetHttpsProxy";

/*
 * Types listed only to draw the edges between others, never kept: a target
 * proxy, which joins a forwarding rule to its URL map or backend service.
 */
export const GCP_LOOKUP_ASSET_TYPES: ReadonlyArray<string> = [
  GCP_TARGET_HTTP_PROXY_TYPE,
  GCP_TARGET_HTTPS_PROXY_TYPE,
  "compute.googleapis.com/TargetSslProxy",
  "compute.googleapis.com/TargetTcpProxy",
];

export interface GcpAsset {
  name: string;
  assetType: string;
  location: string;
  data: JSONObject;
}

export interface GcpInventoryContext {
  projectId: string;
  /*
   * Each URL map's load-balancing scheme, by its full name in lower case:
   * its default backend service's (EXTERNAL, EXTERNAL_MANAGED,
   * INTERNAL_MANAGED), which says which load balancer it is
   * (buildGcpInventoryContext).
   */
  urlMapSchemes?: Map<string, string> | undefined;
}

export interface GcpInventoryType {
  // The Cloud Asset type: "compute.googleapis.com/Instance".
  assetType: string;
  /*
   * For an asset type kept as more than one resource type, whether this
   * one is the asset's: a URL map is the load balancer its scheme and
   * region say. The first type that takes an asset is its type.
   */
  matches?:
    | ((asset: GcpAsset, context: GcpInventoryContext) => boolean)
    | undefined;
  /*
   * The type a resource with no metrics is kept as, when it is not its
   * asset type: a regional backend service is a backend service.
   */
  resourceType?: string | undefined;
  // The Cloud Monitoring monitored-resource type its metrics name.
  monitoredType?: string | undefined;
  // Its identity labels, and the rest the resolver reads (a VM's name).
  labels?:
    | ((
        asset: GcpAsset,
        context: GcpInventoryContext,
      ) => Record<string, string> | null)
    | undefined;
  properties: ReadonlyArray<string>;
  // Where its labels are, when not under `labels`: a GKE cluster's resourceLabels.
  labelsField?: string | undefined;
  /*
   * Properties worked out of the asset's data, read with `properties` as
   * though the data had them: a firewall rule's ports as "tcp:22,443".
   */
  derivedProperties?: ((asset: GcpAsset) => JSONObject) | undefined;
  relationships?:
    | ((asset: GcpAsset) => Array<CloudResourceRelationship>)
    | undefined;
  endpoints?: ((asset: GcpAsset) => Array<unknown>) | undefined;
}

function tail(value: string): string {
  const slash: number = value.lastIndexOf("/");
  return slash >= 0 && slash < value.length - 1
    ? value.slice(slash + 1)
    : value;
}

function textAt(data: JSONObject, path: string): string {
  const value: unknown = readCloudPath(data, path);

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

/*
 * A Compute API URL as the full resource name Cloud Asset writes:
 * "https://www.googleapis.com/compute/v1/projects/p/global/networks/n" ->
 * "//compute.googleapis.com/projects/p/global/networks/n".
 */
export function computeUrlToFullName(url: string): string {
  const marker: string = "/compute/v1/";
  const index: number = url.indexOf(marker);

  if (index < 0) {
    if (url.startsWith("projects/")) {
      // The relative form a URL map's routes are sometimes written in.
      return `//compute.googleapis.com/${url}`;
    }

    return url.startsWith("//") ? url : "";
  }

  return `//compute.googleapis.com/${url.slice(index + marker.length)}`;
}

function networkRelationships(
  asset: GcpAsset,
): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];

  for (const raw of readArray(asset.data["networkInterfaces"])) {
    const networkInterface: JSONObject = readObject(raw);
    const network: string = computeUrlToFullName(
      readText(networkInterface["network"]),
    );
    const subnetwork: string = computeUrlToFullName(
      readText(networkInterface["subnetwork"]),
    );

    /*
     * Its subnet first: an account's topology puts a resource under the
     * first thing it runs in that the account holds, and the subnet is in
     * the network.
     */
    if (subnetwork) {
      relationships.push({
        kind: CloudRelationshipKind.RunsIn,
        target: subnetwork,
        targetType: GCP_SUBNETWORK_TYPE,
      });
    }

    if (network) {
      relationships.push({
        kind: CloudRelationshipKind.RunsIn,
        target: network,
        targetType: GCP_NETWORK_TYPE,
      });
    }
  }

  return relationships;
}

function instanceAddresses(asset: GcpAsset): Array<unknown> {
  const addresses: Array<unknown> = [];

  for (const raw of readArray(asset.data["networkInterfaces"])) {
    const networkInterface: JSONObject = readObject(raw);
    addresses.push(networkInterface["networkIP"]);

    for (const access of readArray(networkInterface["accessConfigs"])) {
      addresses.push(readObject(access)["natIP"]);
    }
  }

  return addresses;
}

// "projects/p/locations/us-central1/functions/f" -> "us-central1".
function locationOf(asset: GcpAsset): string {
  const name: string = textAt(asset.data, "name");
  const marker: string = "/locations/";
  const index: number = name.indexOf(marker);

  if (index >= 0) {
    const rest: string = name.slice(index + marker.length);
    const slash: number = rest.indexOf("/");
    return slash >= 0 ? rest.slice(0, slash) : rest;
  }

  return asset.location;
}

// A zone's region ("us-central1-a" -> "us-central1"); a region as it is.
export function gcpZoneRegion(location: string): string {
  const match: RegExpMatchArray | null = location.match(
    /^([a-z]+-[a-z]+\d+)-[a-z]$/,
  );

  return match ? match[1]! : location;
}

/*
 * The region a regional asset is in - a subnet's "europe-west1" - or
 * "global" for one that is in none: a network, a firewall rule.
 */
export function gcpAssetRegion(asset: GcpAsset): string {
  const region: string = tail(textAt(asset.data, "region"));

  if (region) {
    return region.toLowerCase();
  }

  const location: string = asset.location.trim().toLowerCase();

  return location || "global";
}

// A firewall rule's ports as people read them: ["tcp:22,443", "icmp"].
function firewallPorts(data: JSONObject, field: string): Array<string> {
  return readArray(data[field])
    .map((raw: unknown): string => {
      const rule: JSONObject = readObject(raw);
      const protocol: string = readText(rule["IPProtocol"]);
      const ports: Array<string> = readArray(rule["ports"])
        .map((port: unknown): string => {
          return readText(port);
        })
        .filter(Boolean);

      return protocol && ports.length > 0
        ? `${protocol}:${ports.join(",")}`
        : protocol;
    })
    .filter(Boolean);
}

// The network a subnet or a firewall rule is in.
function inNetwork(asset: GcpAsset): Array<CloudResourceRelationship> {
  const network: string = computeUrlToFullName(textAt(asset.data, "network"));

  return network
    ? [
        {
          kind: CloudRelationshipKind.RunsIn,
          target: network,
          targetType: GCP_NETWORK_TYPE,
        },
      ]
    : [];
}

/*
 * The type of a Compute resource its full name names, by the collection in
 * it: ".../backendServices/web" is a backend service. Only the collections
 * a load balancer's pieces point at; anything else names no type.
 */
const COMPUTE_COLLECTION_TYPES: Readonly<Record<string, string>> = {
  backendServices: GCP_BACKEND_SERVICE_TYPE,
  backendBuckets: "compute.googleapis.com/BackendBucket",
  instanceGroups: "compute.googleapis.com/InstanceGroup",
  networkEndpointGroups: "compute.googleapis.com/NetworkEndpointGroup",
  targetPools: "compute.googleapis.com/TargetPool",
  targetInstances: "compute.googleapis.com/TargetInstance",
  urlMaps: GCP_URL_MAP_TYPE,
};

export function computeTypeOf(fullName: string): string | undefined {
  const parts: Array<string> = fullName.split("/");
  const collection: string | undefined = parts[parts.length - 2];

  return collection ? COMPUTE_COLLECTION_TYPES[collection] : undefined;
}

// Every backend a URL map routes to, its default first, each once.
function urlMapServices(data: JSONObject): Array<string> {
  const services: Array<string> = [readText(data["defaultService"])];

  for (const rawMatcher of readArray(data["pathMatchers"])) {
    const matcher: JSONObject = readObject(rawMatcher);
    services.push(readText(matcher["defaultService"]));

    for (const rawRule of readArray(matcher["pathRules"])) {
      services.push(readText(readObject(rawRule)["service"]));
    }

    for (const rawRule of readArray(matcher["routeRules"])) {
      services.push(readText(readObject(rawRule)["service"]));
    }
  }

  return Array.from(
    new Set(
      services
        .map((service: string): string => {
          return computeUrlToFullName(service);
        })
        .filter(Boolean),
    ),
  );
}

function urlMapRoutes(asset: GcpAsset): Array<CloudResourceRelationship> {
  return urlMapServices(asset.data).map(
    (service: string): CloudResourceRelationship => {
      return {
        kind: CloudRelationshipKind.RoutesTo,
        target: service,
        targetType: computeTypeOf(service),
      };
    },
  );
}

// The host names a URL map answers for: its host rules' hosts, but "*".
function urlMapHosts(asset: GcpAsset): Array<string> {
  const hosts: Array<string> = [];

  for (const rawRule of readArray(asset.data["hostRules"])) {
    for (const host of readArray(readObject(rawRule)["hosts"])) {
      const text: string = readText(host);

      if (text && !text.includes("*")) {
        hosts.push(text);
      }
    }
  }

  return hosts;
}

function urlMapScheme(asset: GcpAsset, context: GcpInventoryContext): string {
  return context.urlMapSchemes?.get(asset.name.toLowerCase()) || "";
}

/*
 * Each URL map's load-balancing scheme, from the backend its default
 * route sends to: a backend service's own scheme, or EXTERNAL for a
 * backend bucket, which only an external load balancer serves.
 */
export function buildGcpInventoryContext(data: {
  projectId: string;
  assets: ReadonlyArray<GcpAsset>;
}): GcpInventoryContext {
  const serviceSchemes: Map<string, string> = new Map();

  for (const asset of data.assets) {
    if (
      asset.assetType === GCP_BACKEND_SERVICE_TYPE ||
      asset.assetType === GCP_REGION_BACKEND_SERVICE_TYPE
    ) {
      serviceSchemes.set(
        asset.name.toLowerCase(),
        textAt(asset.data, "loadBalancingScheme").toUpperCase(),
      );
    }
  }

  const urlMapSchemes: Map<string, string> = new Map();

  for (const asset of data.assets) {
    if (asset.assetType !== GCP_URL_MAP_TYPE) {
      continue;
    }

    const service: string | undefined = urlMapServices(asset.data)[0];

    if (!service) {
      continue;
    }

    const scheme: string =
      computeTypeOf(service) === "compute.googleapis.com/BackendBucket"
        ? "EXTERNAL"
        : serviceSchemes.get(service.toLowerCase()) || "";

    if (scheme) {
      urlMapSchemes.set(asset.name.toLowerCase(), scheme);
    }
  }

  return { projectId: data.projectId, urlMapSchemes };
}

const URL_MAP_PROPERTIES: ReadonlyArray<string> = ["hosts", "defaultBackend"];

function urlMapDerived(asset: GcpAsset): JSONObject {
  return {
    hosts: urlMapHosts(asset),
    defaultBackend: tail(urlMapServices(asset.data)[0] || ""),
  };
}

// What a backend service sends to: its instance groups and endpoint groups.
function backendServiceRoutes(
  asset: GcpAsset,
): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];

  for (const raw of readArray(asset.data["backends"])) {
    const group: string = computeUrlToFullName(
      readText(readObject(raw)["group"]),
    );

    if (group) {
      relationships.push({
        kind: CloudRelationshipKind.RoutesTo,
        target: group,
        targetType: computeTypeOf(group),
      });
    }
  }

  return [...relationships, ...inNetwork(asset)];
}

// The network and subnet an internal forwarding rule's address is in.
function forwardingRuleNetwork(
  asset: GcpAsset,
): Array<CloudResourceRelationship> {
  const subnetwork: string = computeUrlToFullName(
    textAt(asset.data, "subnetwork"),
  );

  return [
    ...(subnetwork
      ? [
          {
            kind: CloudRelationshipKind.RunsIn,
            target: subnetwork,
            targetType: GCP_SUBNETWORK_TYPE,
          },
        ]
      : []),
    ...inNetwork(asset),
  ];
}

const BACKEND_SERVICE_PROPERTIES: ReadonlyArray<string> = [
  "loadBalancingScheme",
  "protocol",
  "port",
  "portName",
  "timeoutSec",
  "sessionAffinity",
  "localityLbPolicy",
  "enableCDN",
];

const FORWARDING_RULE_PROPERTIES: ReadonlyArray<string> = [
  "IPAddress",
  "IPProtocol",
  "portRange",
  "ports",
  "allPorts",
  "loadBalancingScheme",
  "networkTier",
];

export const GCP_INVENTORY_TYPES: ReadonlyArray<GcpInventoryType> = [
  {
    assetType: "compute.googleapis.com/Instance",
    monitoredType: "gce_instance",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const id: string = textAt(asset.data, "id");
      const zone: string = tail(textAt(asset.data, "zone")) || asset.location;
      return id && zone
        ? {
            project_id: context.projectId,
            zone,
            instance_id: id,
            name: textAt(asset.data, "name"),
          }
        : null;
    },
    /*
     * Its machine type first - kept as its URL, its last part its name - so
     * OneUptime can size it (Types/Cloud/CloudRightSizing).
     */
    properties: [
      "machineType",
      "status",
      "cpuPlatform",
      "scheduling.preemptible",
      "deletionProtection",
    ],
    relationships: networkRelationships,
    endpoints: instanceAddresses,
  },
  {
    assetType: "sqladmin.googleapis.com/Instance",
    monitoredType: "cloudsql_database",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = textAt(asset.data, "name");
      return name
        ? {
            project_id: context.projectId,
            database_id: `${context.projectId}:${name}`,
            region: textAt(asset.data, "region") || asset.location,
          }
        : null;
    },
    properties: [
      "databaseVersion",
      "state",
      "settings.tier",
      "settings.availabilityType",
      "settings.dataDiskSizeGb",
      "settings.dataDiskType",
    ],
    endpoints: (asset: GcpAsset) => {
      return [
        asset.data["dnsName"],
        ...readArray(asset.data["ipAddresses"]).map((raw: unknown) => {
          return readObject(raw)["ipAddress"];
        }),
      ];
    },
  },
  {
    assetType: "storage.googleapis.com/Bucket",
    monitoredType: "gcs_bucket",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = textAt(asset.data, "name");
      return name
        ? {
            project_id: context.projectId,
            bucket_name: name,
            location: (
              textAt(asset.data, "location") || asset.location
            ).toLowerCase(),
          }
        : null;
    },
    properties: ["storageClass", "location", "locationType"],
  },
  {
    assetType: "run.googleapis.com/Service",
    monitoredType: "cloud_run_revision",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string =
        textAt(asset.data, "metadata.name") || tail(textAt(asset.data, "name"));
      const location: string = locationOf(asset);
      return name && location
        ? { project_id: context.projectId, location, service_name: name }
        : null;
    },
    properties: ["ingress", "launchStage"],
    endpoints: (asset: GcpAsset) => {
      return [
        readCloudPath(asset.data, "status.url"),
        asset.data["uri"],
        ...readArray(asset.data["urls"]),
      ];
    },
  },
  {
    assetType: "cloudfunctions.googleapis.com/CloudFunction",
    monitoredType: "cloud_function",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      const region: string = locationOf(asset);
      return name && region
        ? { project_id: context.projectId, region, function_name: name }
        : null;
    },
    properties: ["runtime", "status", "availableMemoryMb", "timeout"],
    endpoints: (asset: GcpAsset) => {
      return [readCloudPath(asset.data, "httpsTrigger.url")];
    },
  },
  {
    assetType: "cloudfunctions.googleapis.com/Function",
    monitoredType: "cloud_function",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      const region: string = locationOf(asset);
      return name && region
        ? { project_id: context.projectId, region, function_name: name }
        : null;
    },
    properties: [
      "state",
      "environment",
      "buildConfig.runtime",
      "serviceConfig.availableMemory",
      "serviceConfig.timeoutSeconds",
    ],
    endpoints: (asset: GcpAsset) => {
      return [
        readCloudPath(asset.data, "serviceConfig.uri"),
        asset.data["url"],
      ];
    },
  },
  {
    assetType: "redis.googleapis.com/Instance",
    monitoredType: "redis_instance",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      const region: string = locationOf(asset);
      return name && region
        ? { project_id: context.projectId, region, instance_id: name }
        : null;
    },
    properties: ["tier", "memorySizeGb", "redisVersion", "state"],
    endpoints: (asset: GcpAsset) => {
      return [asset.data["host"]];
    },
  },
  {
    assetType: "spanner.googleapis.com/Instance",
    monitoredType: "spanner_instance",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      return name ? { project_id: context.projectId, instance_id: name } : null;
    },
    properties: ["config", "nodeCount", "processingUnits", "state"],
  },
  {
    assetType: "pubsub.googleapis.com/Topic",
    monitoredType: "pubsub_topic",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      return name ? { project_id: context.projectId, topic_id: name } : null;
    },
    properties: ["messageRetentionDuration"],
  },
  {
    assetType: "pubsub.googleapis.com/Subscription",
    monitoredType: "pubsub_subscription",
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = tail(textAt(asset.data, "name"));
      return name
        ? { project_id: context.projectId, subscription_id: name }
        : null;
    },
    properties: [
      "ackDeadlineSeconds",
      "messageRetentionDuration",
      "enableMessageOrdering",
    ],
    relationships: (asset: GcpAsset) => {
      const deadLetter: string = textAt(
        asset.data,
        "deadLetterPolicy.deadLetterTopic",
      );

      return deadLetter
        ? [
            {
              kind: CloudRelationshipKind.DeadLettersTo,
              target: `//pubsub.googleapis.com/${deadLetter}`,
              targetType: "pubsub_topic",
            },
          ]
        : [];
    },
  },
  {
    assetType: GCP_NETWORK_TYPE,
    properties: ["autoCreateSubnetworks", "routingConfig.routingMode", "mtu"],
  },
  {
    assetType: GCP_SUBNETWORK_TYPE,
    properties: [
      "ipCidrRange",
      "gatewayAddress",
      "purpose",
      "stackType",
      "privateIpGoogleAccess",
    ],
    relationships: inNetwork,
  },
  {
    /*
     * A firewall rule guards the instances of its network it targets
     * (addGcpFirewallEdges); it is kept in its network, like a subnet.
     */
    assetType: GCP_FIREWALL_TYPE,
    properties: [
      "direction",
      "priority",
      "disabled",
      "allowed",
      "denied",
      "sourceRanges",
      "destinationRanges",
      "sourceTags",
      "targetTags",
      "targetServiceAccounts",
    ],
    derivedProperties: (asset: GcpAsset): JSONObject => {
      return {
        allowed: firewallPorts(asset.data, "allowed"),
        denied: firewallPorts(asset.data, "denied"),
      };
    },
    relationships: inNetwork,
  },
  /*
   * A Cloud Armor security policy (#10349): what the project's blocklist
   * can be enforced in. Its type says what it guards - a backend service
   * (CLOUD_ARMOR), the edge in front of one (CLOUD_ARMOR_EDGE), a network
   * load balancer (CLOUD_ARMOR_NETWORK) - and never its rules, which the
   * blocklist reads from the policy itself.
   */
  {
    assetType: CLOUD_ARMOR_POLICY_ASSET_TYPE,
    properties: ["type", "description"],
  },
  /*
   * A URL map is an Application Load Balancer, filed under the monitored
   * resource its metrics name: a global one an external load balancer
   * (https_lb_rule), a regional internal one an internal load balancer
   * (internal_http_lb_rule). One whose metrics OneUptime does not read yet
   * - a regional external or a cross-region internal load balancer - is
   * still listed, as a URL map.
   */
  {
    assetType: GCP_URL_MAP_TYPE,
    monitoredType: "https_lb_rule",
    matches: (asset: GcpAsset, context: GcpInventoryContext): boolean => {
      return (
        gcpAssetRegion(asset) === "global" &&
        urlMapScheme(asset, context) !== "INTERNAL_MANAGED"
      );
    },
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = textAt(asset.data, "name");
      return name
        ? { project_id: context.projectId, url_map_name: name }
        : null;
    },
    properties: URL_MAP_PROPERTIES,
    derivedProperties: urlMapDerived,
    relationships: urlMapRoutes,
    endpoints: urlMapHosts,
  },
  {
    assetType: GCP_URL_MAP_TYPE,
    monitoredType: "internal_http_lb_rule",
    matches: (asset: GcpAsset, context: GcpInventoryContext): boolean => {
      const scheme: string = urlMapScheme(asset, context);
      return (
        gcpAssetRegion(asset) !== "global" &&
        (scheme === "" || scheme === "INTERNAL_MANAGED")
      );
    },
    labels: (asset: GcpAsset, context: GcpInventoryContext) => {
      const name: string = textAt(asset.data, "name");
      const region: string = gcpAssetRegion(asset);
      return name
        ? { project_id: context.projectId, region, url_map_name: name }
        : null;
    },
    properties: URL_MAP_PROPERTIES,
    derivedProperties: urlMapDerived,
    relationships: urlMapRoutes,
    endpoints: urlMapHosts,
  },
  {
    assetType: GCP_URL_MAP_TYPE,
    properties: URL_MAP_PROPERTIES,
    derivedProperties: urlMapDerived,
    relationships: urlMapRoutes,
    endpoints: urlMapHosts,
  },
  {
    assetType: GCP_BACKEND_SERVICE_TYPE,
    properties: BACKEND_SERVICE_PROPERTIES,
    relationships: backendServiceRoutes,
  },
  {
    assetType: GCP_REGION_BACKEND_SERVICE_TYPE,
    resourceType: GCP_BACKEND_SERVICE_TYPE,
    properties: BACKEND_SERVICE_PROPERTIES,
    relationships: backendServiceRoutes,
  },
  /*
   * A forwarding rule is a load balancer's address. What it sends to - a
   * URL map through its target proxy, a backend service, a target pool -
   * is drawn once the project is read (addGcpLoadBalancerEdges).
   */
  {
    assetType: GCP_FORWARDING_RULE_TYPE,
    properties: FORWARDING_RULE_PROPERTIES,
    relationships: forwardingRuleNetwork,
    endpoints: (asset: GcpAsset) => {
      return [asset.data["IPAddress"]];
    },
  },
  {
    assetType: GCP_GLOBAL_FORWARDING_RULE_TYPE,
    resourceType: GCP_FORWARDING_RULE_TYPE,
    properties: FORWARDING_RULE_PROPERTIES,
    relationships: forwardingRuleNetwork,
    endpoints: (asset: GcpAsset) => {
      return [asset.data["IPAddress"]];
    },
  },
  {
    assetType: GCP_GKE_CLUSTER_TYPE,
    labelsField: "resourceLabels",
    properties: [
      "status",
      "currentMasterVersion",
      "currentNodeVersion",
      "currentNodeCount",
      "autopilot.enabled",
      "releaseChannel.channel",
      "nodePools",
      "privateClusterConfig.enablePrivateNodes",
    ],
    // Its node pools as people read them: "default-pool (e2-standard-4)".
    derivedProperties: (asset: GcpAsset): JSONObject => {
      return {
        nodePools: readArray(asset.data["nodePools"])
          .map((raw: unknown): string => {
            const pool: JSONObject = readObject(raw);
            const name: string = readText(pool["name"]);
            const machineType: string = readText(
              readObject(pool["config"])["machineType"],
            );

            return name && machineType ? `${name} (${machineType})` : name;
          })
          .filter(Boolean),
      };
    },
    relationships: (asset: GcpAsset): Array<CloudResourceRelationship> => {
      const relationships: Array<CloudResourceRelationship> = [];
      // "projects/p/regions/r/subnetworks/s", or a URL on older clusters.
      const subnetwork: string = computeUrlToFullName(
        textAt(asset.data, "networkConfig.subnetwork"),
      );
      const network: string = computeUrlToFullName(
        textAt(asset.data, "networkConfig.network"),
      );

      if (subnetwork) {
        relationships.push({
          kind: CloudRelationshipKind.RunsIn,
          target: subnetwork,
          targetType: GCP_SUBNETWORK_TYPE,
        });
      }

      if (network) {
        relationships.push({
          kind: CloudRelationshipKind.RunsIn,
          target: network,
          targetType: GCP_NETWORK_TYPE,
        });
      }

      return relationships;
    },
    endpoints: (asset: GcpAsset) => {
      return [
        asset.data["endpoint"],
        readCloudPath(asset.data, "privateClusterConfig.privateEndpoint"),
      ];
    },
  },
];

/*
 * The type an asset is kept as: the first of its asset type's that takes
 * it, or - asked by asset type alone - the first of them.
 */
export function getGcpInventoryType(
  assetType: string,
  asset?: GcpAsset | undefined,
  context?: GcpInventoryContext | undefined,
): GcpInventoryType | null {
  return (
    GCP_INVENTORY_TYPES.find((type: GcpInventoryType): boolean => {
      return (
        type.assetType === assetType &&
        (!asset ||
          !type.matches ||
          type.matches(asset, context || { projectId: "" }))
      );
    }) || null
  );
}

// The type a type's resources are kept as: what a full listing lists.
export function getGcpInventoryResourceType(type: GcpInventoryType): string {
  return type.monitoredType || type.resourceType || type.assetType;
}

// Every type a project's listing asks Cloud Asset for, once each.
export function getGcpListedAssetTypes(): Array<string> {
  return Array.from(
    new Set([
      ...GCP_INVENTORY_TYPES.map((type: GcpInventoryType): string => {
        return type.assetType;
      }),
      ...GCP_LOOKUP_ASSET_TYPES,
    ]),
  );
}

// The identity of an asset: its metrics' own, or a network's of the same shape.
export function getGcpInventoryIdentity(
  type: GcpInventoryType,
  asset: GcpAsset,
  context: GcpInventoryContext,
): CloudMonitoredResource | null {
  if (type.monitoredType && type.labels) {
    const labels: Record<string, string> | null = type.labels(asset, context);

    if (!labels) {
      return null;
    }

    const attributes: Record<string, string> = {
      [GCP_RESOURCE_TYPE_ATTRIBUTE]: type.monitoredType,
    };

    for (const key of Object.keys(labels)) {
      if (labels[key]) {
        attributes[`resource.${key}`] = labels[key]!;
      }
    }

    return resolveCloudMonitoredResource({
      metricName: "gcp_inventory",
      attributes,
    });
  }

  const name: string = tail(textAt(asset.data, "name"));

  if (!name) {
    return null;
  }

  /*
   * A regional asset's region is part of its identity: every region of an
   * auto mode network has a subnet called "default". A global one's
   * identity is its project and name alone, as a network's always was.
   */
  const place: string = gcpAssetRegion(asset);
  const resourceType: string = getGcpInventoryResourceType(type);

  return {
    provider: CloudProvider.GCP,
    source: CloudMonitoringSource.GoogleCloudMonitoring,
    resourceType,
    name,
    providerResourceId: asset.name,
    accountId: context.projectId,
    // A zonal cluster is in its zone's region, as a VM is.
    region: gcpZoneRegion(place),
    resourceGroup: "",
    identityKey: [
      CloudProvider.GCP,
      resourceType,
      context.projectId,
      ...(place === "global" ? [] : [place]),
      name,
    ]
      .join("|")
      .toLowerCase(),
    telemetryAttributes: {},
  };
}

export function buildGcpInventoryItem(
  asset: GcpAsset,
  context: GcpInventoryContext,
): CloudInventoryItem | null {
  const type: GcpInventoryType | null = getGcpInventoryType(
    asset.assetType,
    asset,
    context,
  );

  if (!type) {
    return null;
  }

  const resource: CloudMonitoredResource | null = getGcpInventoryIdentity(
    type,
    asset,
    context,
  );

  if (!resource) {
    return null;
  }

  return {
    resource,
    // "projects/p/locations/l/services/checkout" and "checkout" alike.
    displayName: tail(textAt(asset.data, "name")) || undefined,
    tags: normalizeCloudTags(asset.data[type.labelsField || "labels"]),
    properties: pickCloudProperties(
      type.derivedProperties
        ? { ...asset.data, ...type.derivedProperties(asset) }
        : asset.data,
      type.properties,
    ),
    relationships: boundCloudRelationships(
      type.relationships ? type.relationships(asset) : [],
    ),
    endpoints: normalizeCloudEndpoints(
      type.endpoints ? type.endpoints(asset) : [],
    ),
  };
}

/*
 * A topic sends to its subscriptions: the edges are written on the topic,
 * from what each subscription says it reads.
 */
export function addGcpTopicEdges(data: {
  items: Array<CloudInventoryItem>;
  assets: Map<CloudInventoryItem, GcpAsset>;
}): void {
  const topics: Map<string, CloudInventoryItem> = new Map();

  for (const item of data.items) {
    if (item.resource.resourceType === "pubsub_topic") {
      const asset: GcpAsset | undefined = data.assets.get(item);

      if (asset) {
        topics.set(textAt(asset.data, "name").toLowerCase(), item);
      }
    }
  }

  for (const item of data.items) {
    if (item.resource.resourceType !== "pubsub_subscription") {
      continue;
    }

    const asset: GcpAsset | undefined = data.assets.get(item);
    const topic: CloudInventoryItem | undefined = asset
      ? topics.get(textAt(asset.data, "topic").toLowerCase())
      : undefined;

    if (topic) {
      topic.relationships = boundCloudRelationships([
        ...topic.relationships,
        {
          kind: CloudRelationshipKind.RoutesTo,
          target: item.resource.providerResourceId,
          targetType: "pubsub_subscription",
        },
      ]);
    }
  }
}

/*
 * A firewall rule guards the instances of its network it targets: those
 * with one of its target tags, those running as one of its target service
 * accounts, or - with neither - every instance of the network. A disabled
 * rule guards none. The edge is written on the instance, as an AWS
 * instance names its security groups.
 */
export function addGcpFirewallEdges(data: {
  items: Array<CloudInventoryItem>;
  assets: Map<CloudInventoryItem, GcpAsset>;
}): void {
  interface Firewall {
    item: CloudInventoryItem;
    network: string;
    tags: Array<string>;
    serviceAccounts: Array<string>;
  }

  const firewalls: Array<Firewall> = [];

  for (const item of data.items) {
    const asset: GcpAsset | undefined = data.assets.get(item);

    if (
      !asset ||
      asset.assetType !== GCP_FIREWALL_TYPE ||
      asset.data["disabled"] === true
    ) {
      continue;
    }

    const network: string = computeUrlToFullName(
      textAt(asset.data, "network"),
    ).toLowerCase();

    if (!network) {
      continue;
    }

    firewalls.push({
      item,
      network,
      tags: readArray(asset.data["targetTags"])
        .map((value: unknown): string => {
          return readText(value);
        })
        .filter(Boolean),
      serviceAccounts: readArray(asset.data["targetServiceAccounts"])
        .map((value: unknown): string => {
          return readText(value).toLowerCase();
        })
        .filter(Boolean),
    });
  }

  if (firewalls.length === 0) {
    return;
  }

  for (const item of data.items) {
    const asset: GcpAsset | undefined = data.assets.get(item);

    if (!asset || asset.assetType !== GCP_INSTANCE_TYPE) {
      continue;
    }

    const networks: Set<string> = new Set();

    for (const raw of readArray(asset.data["networkInterfaces"])) {
      const network: string = computeUrlToFullName(
        readText(readObject(raw)["network"]),
      ).toLowerCase();

      if (network) {
        networks.add(network);
      }
    }

    const tags: Set<string> = new Set(
      readArray(readObject(asset.data["tags"])["items"])
        .map((value: unknown): string => {
          return readText(value);
        })
        .filter(Boolean),
    );
    const serviceAccounts: Set<string> = new Set(
      readArray(asset.data["serviceAccounts"])
        .map((raw: unknown): string => {
          return readText(readObject(raw)["email"]).toLowerCase();
        })
        .filter(Boolean),
    );
    const guards: Array<CloudResourceRelationship> = [];

    for (const firewall of firewalls) {
      if (!networks.has(firewall.network)) {
        continue;
      }

      const targetsIt: boolean =
        (firewall.tags.length === 0 && firewall.serviceAccounts.length === 0) ||
        firewall.tags.some((tag: string): boolean => {
          return tags.has(tag);
        }) ||
        firewall.serviceAccounts.some((account: string): boolean => {
          return serviceAccounts.has(account);
        });

      if (targetsIt) {
        guards.push({
          kind: CloudRelationshipKind.ProtectedBy,
          target: firewall.item.resource.providerResourceId,
          targetType: GCP_FIREWALL_TYPE,
        });
      }
    }

    if (guards.length > 0) {
      item.relationships = boundCloudRelationships([
        ...item.relationships,
        ...guards,
      ]);
    }
  }
}

/*
 * A GKE node is a VM that GKE labels with its cluster's name and location
 * (goog-k8s-cluster-name, goog-k8s-cluster-location): it is part of that
 * cluster. A name two clusters of the project answer to, in no location
 * the label narrows to one, links to neither.
 */
export function addGcpClusterNodeEdges(data: {
  items: Array<CloudInventoryItem>;
  assets: Map<CloudInventoryItem, GcpAsset>;
}): void {
  const clusters: Array<{ item: CloudInventoryItem; asset: GcpAsset }> = [];

  for (const item of data.items) {
    const asset: GcpAsset | undefined = data.assets.get(item);

    if (asset?.assetType === GCP_GKE_CLUSTER_TYPE) {
      clusters.push({ item, asset });
    }
  }

  if (clusters.length === 0) {
    return;
  }

  for (const item of data.items) {
    if (data.assets.get(item)?.assetType !== GCP_INSTANCE_TYPE) {
      continue;
    }

    const name: string = (item.tags["goog-k8s-cluster-name"] || "").trim();
    const location: string = (
      item.tags["goog-k8s-cluster-location"] || ""
    ).trim();

    if (!name) {
      continue;
    }

    const matching: Array<{ item: CloudInventoryItem; asset: GcpAsset }> =
      clusters.filter(
        (cluster: { item: CloudInventoryItem; asset: GcpAsset }): boolean => {
          return (
            textAt(cluster.asset.data, "name") === name &&
            (!location ||
              (
                textAt(cluster.asset.data, "location") || cluster.asset.location
              ).toLowerCase() === location.toLowerCase())
          );
        },
      );

    if (matching.length !== 1) {
      continue;
    }

    item.relationships = boundCloudRelationships([
      ...item.relationships,
      {
        kind: CloudRelationshipKind.PartOf,
        target: matching[0]!.item.resource.providerResourceId,
        targetType: GCP_GKE_CLUSTER_TYPE,
      },
    ]);
  }
}

/*
 * Every edge that takes more than one asset to draw, written once all of a
 * project's assets are read: a topic's subscriptions, the firewall rules
 * guarding each instance, what a load balancer's addresses send to, the
 * GKE cluster each node VM is part of.
 */
/*
 * What a load balancer's forwarding rules send to. A rule names a target
 * proxy, which names the URL map (an Application Load Balancer) or the
 * backend service (a proxy Network Load Balancer); or it names a backend
 * service or a target pool itself. A rule that sends to a URL map the
 * project holds gives the URL map its address too, so a website monitor of
 * that address is linked to the load balancer whose metrics say how it is
 * doing, and not to the rule.
 */
export function addGcpLoadBalancerEdges(data: {
  items: Array<CloudInventoryItem>;
  assets: Map<CloudInventoryItem, GcpAsset>;
  listed: ReadonlyArray<GcpAsset>;
}): void {
  // A target proxy's full name -> what it sends to.
  const proxies: Map<string, string> = new Map();

  for (const asset of data.listed) {
    if (!GCP_LOOKUP_ASSET_TYPES.includes(asset.assetType)) {
      continue;
    }

    const target: string = computeUrlToFullName(
      textAt(asset.data, "urlMap") || textAt(asset.data, "service"),
    );

    if (target) {
      proxies.set(asset.name.toLowerCase(), target);
    }
  }

  const byId: Map<string, CloudInventoryItem> = new Map();

  for (const item of data.items) {
    byId.set(item.resource.providerResourceId.toLowerCase(), item);
  }

  for (const item of data.items) {
    const asset: GcpAsset | undefined = data.assets.get(item);

    if (
      !asset ||
      (asset.assetType !== GCP_FORWARDING_RULE_TYPE &&
        asset.assetType !== GCP_GLOBAL_FORWARDING_RULE_TYPE)
    ) {
      continue;
    }

    const named: string = computeUrlToFullName(
      textAt(asset.data, "target") || textAt(asset.data, "backendService"),
    );

    if (!named) {
      continue;
    }

    const target: string = proxies.get(named.toLowerCase()) || named;
    const held: CloudInventoryItem | undefined = byId.get(target.toLowerCase());

    item.relationships = boundCloudRelationships([
      ...item.relationships,
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: held ? held.resource.providerResourceId : target,
        targetType: held ? held.resource.resourceType : computeTypeOf(target),
      },
    ]);

    if (held && data.assets.get(held)?.assetType === GCP_URL_MAP_TYPE) {
      held.endpoints = normalizeCloudEndpoints([
        ...held.endpoints,
        ...item.endpoints,
      ]);
      item.endpoints = [];
    }
  }
}

export function addGcpInventoryEdges(data: {
  items: Array<CloudInventoryItem>;
  assets: Map<CloudInventoryItem, GcpAsset>;
  // Every asset the listing returned, the lookup-only ones too.
  listed?: ReadonlyArray<GcpAsset> | undefined;
}): void {
  addGcpTopicEdges(data);
  addGcpFirewallEdges(data);
  addGcpLoadBalancerEdges({
    items: data.items,
    assets: data.assets,
    listed: data.listed || Array.from(data.assets.values()),
  });
  addGcpClusterNodeEdges(data);
}

export interface GcpAssetListing {
  assets: Array<GcpAsset>;
  complete: boolean;
}

/*
 * Cloud Asset Inventory and Resource Manager, for one service account. A
 * project whose Cloud Asset API is off answers with a 403 that says so: that
 * is a setting to turn on, said with the command that does.
 */
export default class GcpInventoryClient {
  private token: GoogleServiceAccountToken;
  private transport: CloudConnectorTransport;
  private requestTimeoutInMs: number | undefined;
  private budget: CloudReadBudget | undefined;
  private sleep: ((milliseconds: number) => Promise<void>) | undefined;

  public constructor(options: {
    serviceAccountJson: string;
    transport: CloudConnectorTransport;
    requestTimeoutInMs?: number | undefined;
    budget?: CloudReadBudget | undefined;
    // Waits before asking a throttled request again (CloudRetry).
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  }) {
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
    this.budget = options.budget;
    this.sleep = options.sleep;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GCP_CLOUD_PLATFORM_READ_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  private async get(
    url: string,
    step: string,
    api: string,
  ): Promise<JSONObject> {
    // A quota answers a burst with 429: each try is a request of the budget.
    return await withCloudRetries({
      sleep: this.sleep,
      call: async (): Promise<JSONObject> => {
        if (this.budget && !this.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const accessToken: string = await this.token.getAccessToken();

        try {
          return await LlmProviderHttp.requestJson({
            transport: this.transport,
            method: "GET",
            url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
            },
            timeoutInMs: this.requestTimeoutInMs,
            step,
            providerTitle: PROVIDER_TITLE,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpInventoryClient.classify(error, api);
        }
      },
    });
  }

  /*
   * A 403 that says the API is off is a setting to turn on, said with the
   * command that turns that API on; any other 403 is a missing role.
   */
  public static classify(error: unknown, api: string): LlmProviderError {
    const failure: LlmProviderError =
      error instanceof LlmProviderError
        ? error
        : LlmProviderError.from({
            error,
            step: "request",
            providerTitle: PROVIDER_TITLE,
          });
    const body: string = (failure.responseBody || "").toLowerCase();

    if (
      failure.statusCode === 403 &&
      (body.includes("has not been used") || body.includes("is disabled"))
    ) {
      return new LlmProviderError({
        message: `${failure.message} Turn it on for the project: gcloud services enable ${api}`,
        kind: CloudConnectionFailureKind.Settings,
        statusCode: failure.statusCode,
        responseBody: failure.responseBody,
      });
    }

    if (failure.statusCode === 403) {
      return new LlmProviderError({
        message: failure.message,
        kind: CloudConnectionFailureKind.Permission,
        statusCode: failure.statusCode,
        responseBody: failure.responseBody,
      });
    }

    return failure;
  }

  private async post(
    url: string,
    body: JSONObject,
    step: string,
    api: string,
  ): Promise<JSONObject> {
    return await withCloudRetries({
      sleep: this.sleep,
      call: async (): Promise<JSONObject> => {
        if (this.budget && !this.budget.take()) {
          throw new CloudReadBudgetSpent();
        }

        const accessToken: string = await this.token.getAccessToken();

        try {
          return await LlmProviderHttp.requestJson({
            transport: this.transport,
            method: "POST",
            url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            timeoutInMs: this.requestTimeoutInMs,
            step,
            providerTitle: PROVIDER_TITLE,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpInventoryClient.classify(error, api);
        }
      },
    });
  }

  /*
   * A project's Admin Activity audit log entries in [start, end), oldest
   * first: every change to the project's resources and their access.
   * `complete` is false when it stopped at GCP_CHANGE_MAX_PAGES.
   */
  public async listAuditEntries(data: {
    projectId: string;
    start: Date;
    end: Date;
  }): Promise<{ entries: Array<JSONObject>; complete: boolean }> {
    const entries: Array<JSONObject> = [];
    let pageToken: string = "";
    const logName: string = `projects/${data.projectId}/logs/cloudaudit.googleapis.com%2Factivity`;

    for (let page: number = 0; page < GCP_CHANGE_MAX_PAGES; page++) {
      const body: JSONObject = {
        resourceNames: [`projects/${data.projectId}`],
        filter: `logName="${logName}" AND timestamp>="${data.start.toISOString()}" AND timestamp<"${data.end.toISOString()}"`,
        orderBy: "timestamp asc",
        pageSize: 500,
      };

      if (pageToken) {
        body["pageToken"] = pageToken;
      }

      const response: JSONObject = await this.post(
        `${LOGGING_BASE_URL}/entries:list`,
        body,
        "audit log request",
        "logging.googleapis.com",
      );

      for (const raw of readArray(response["entries"])) {
        entries.push(readObject(raw));
      }

      const next: string = readText(response["nextPageToken"]);

      if (!next || next === pageToken) {
        return { entries, complete: true };
      }

      pageToken = next;
    }

    return { entries, complete: false };
  }

  // A project's Service Health events updated since `start`.
  public async listServiceHealthEvents(data: {
    projectId: string;
    start: Date;
  }): Promise<Array<JSONObject>> {
    const response: JSONObject = await this.get(
      `${SERVICE_HEALTH_BASE_URL}/projects/${encodeURIComponent(
        data.projectId,
      )}/locations/global/events?${buildQueryString([
        // The documented form: the time unquoted (update_time>=2026-10-21T11:30:00Z).
        ["filter", `update_time>=${data.start.toISOString()}`],
        ["pageSize", 100],
      ])}`,
      "service health request",
      "servicehealth.googleapis.com",
    );

    return readArray(response["events"]).map((raw: unknown): JSONObject => {
      return readObject(raw);
    });
  }

  // Every asset of the inventory's types in one project, page by page.
  public async listAssets(projectId: string): Promise<GcpAssetListing> {
    const assets: Array<GcpAsset> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const query: string = buildQueryString([
        ["contentType", "RESOURCE"],
        ...getGcpListedAssetTypes().map(
          (assetType: string): [string, string] => {
            return ["assetTypes", assetType];
          },
        ),
        ["pageSize", PAGE_SIZE],
        ["pageToken", pageToken],
      ]);

      const response: JSONObject = await this.get(
        `${ASSET_BASE_URL}/projects/${encodeURIComponent(projectId)}/assets?${query}`,
        "assets request",
        "cloudasset.googleapis.com",
      );

      for (const raw of readArray(response["assets"])) {
        const asset: JSONObject = readObject(raw);
        const resource: JSONObject = readObject(asset["resource"]);

        assets.push({
          name: readText(asset["name"]),
          assetType: readText(asset["assetType"]),
          location: readText(resource["location"]),
          data: readObject(resource["data"]),
        });
      }

      const next: string = readText(response["nextPageToken"]);

      if (!next || next === pageToken) {
        return { assets, complete: true };
      }

      pageToken = next;
    }

    return { assets, complete: false };
  }

  /*
   * Every active project the service account may see: for a connection that
   * reads a whole organization, whose roles were granted on it.
   */
  public async searchProjects(): Promise<
    Array<{ projectId: string; displayName: string }>
  > {
    const projects: Array<{ projectId: string; displayName: string }> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const response: JSONObject = await this.get(
        `${RESOURCE_MANAGER_BASE_URL}/projects:search?${buildQueryString([
          ["query", "state:ACTIVE"],
          ["pageSize", 500],
          ["pageToken", pageToken],
        ])}`,
        "projects request",
        "cloudresourcemanager.googleapis.com",
      );

      for (const raw of readArray(response["projects"])) {
        const project: JSONObject = readObject(raw);
        const projectId: string = readText(project["projectId"]);

        if (projectId) {
          projects.push({
            projectId,
            displayName: readText(project["displayName"]),
          });
        }
      }

      const next: string = readText(response["nextPageToken"]);

      if (!next || next === pageToken) {
        break;
      }

      pageToken = next;
    }

    return projects;
  }

  // What the project is called, or "" when Resource Manager does not say.
  public async getProjectName(projectId: string): Promise<string> {
    try {
      const response: JSONObject = await this.get(
        `${RESOURCE_MANAGER_BASE_URL}/projects/${encodeURIComponent(projectId)}`,
        "project request",
        "cloudresourcemanager.googleapis.com",
      );

      return readText(response["displayName"]);
    } catch (error) {
      if (error instanceof CloudReadBudgetSpent) {
        throw error;
      }

      return "";
    }
  }
}
