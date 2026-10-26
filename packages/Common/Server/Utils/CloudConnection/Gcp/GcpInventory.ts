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
const PAGE_SIZE: number = 1000;
const MAX_PAGES: number = 20;

// The type a VPC network, which has no metrics, is kept as.
export const GCP_NETWORK_TYPE: string = "compute.googleapis.com/Network";

export interface GcpAsset {
  name: string;
  assetType: string;
  location: string;
  data: JSONObject;
}

export interface GcpInventoryContext {
  projectId: string;
}

export interface GcpInventoryType {
  // The Cloud Asset type: "compute.googleapis.com/Instance".
  assetType: string;
  // The Cloud Monitoring monitored-resource type its metrics name.
  monitoredType?: string | undefined;
  // Its identity labels, and the rest the resolver reads (a VM's name).
  labels?:
    | ((asset: GcpAsset, context: GcpInventoryContext) => Record<string, string> | null)
    | undefined;
  properties: ReadonlyArray<string>;
  relationships?:
    | ((asset: GcpAsset) => Array<CloudResourceRelationship>)
    | undefined;
  endpoints?: ((asset: GcpAsset) => Array<unknown>) | undefined;
}

function tail(value: string): string {
  const slash: number = value.lastIndexOf("/");
  return slash >= 0 && slash < value.length - 1 ? value.slice(slash + 1) : value;
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
    return url.startsWith("//") ? url : "";
  }

  return `//compute.googleapis.com/${url.slice(index + marker.length)}`;
}

function networkRelationships(asset: GcpAsset): Array<CloudResourceRelationship> {
  const relationships: Array<CloudResourceRelationship> = [];

  for (const raw of readArray(asset.data["networkInterfaces"])) {
    const networkInterface: JSONObject = readObject(raw);
    const network: string = computeUrlToFullName(
      readText(networkInterface["network"]),
    );
    const subnetwork: string = computeUrlToFullName(
      readText(networkInterface["subnetwork"]),
    );

    if (network) {
      relationships.push({
        kind: CloudRelationshipKind.RunsIn,
        target: network,
        targetType: GCP_NETWORK_TYPE,
      });
    }

    if (subnetwork) {
      relationships.push({
        kind: CloudRelationshipKind.RunsIn,
        target: subnetwork,
        targetType: "compute.googleapis.com/Subnetwork",
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
    properties: ["status", "cpuPlatform", "scheduling.preemptible", "deletionProtection"],
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
            location: (textAt(asset.data, "location") || asset.location).toLowerCase(),
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
      return [readCloudPath(asset.data, "serviceConfig.uri"), asset.data["url"]];
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
];

export function getGcpInventoryType(assetType: string): GcpInventoryType | null {
  return (
    GCP_INVENTORY_TYPES.find((type: GcpInventoryType): boolean => {
      return type.assetType === assetType;
    }) || null
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

  return {
    provider: CloudProvider.GCP,
    source: CloudMonitoringSource.GoogleCloudMonitoring,
    resourceType: type.assetType,
    name,
    providerResourceId: asset.name,
    accountId: context.projectId,
    region: "global",
    resourceGroup: "",
    identityKey: [CloudProvider.GCP, type.assetType, context.projectId, name]
      .join("|")
      .toLowerCase(),
    telemetryAttributes: {},
  };
}

export function buildGcpInventoryItem(
  asset: GcpAsset,
  context: GcpInventoryContext,
): CloudInventoryItem | null {
  const type: GcpInventoryType | null = getGcpInventoryType(asset.assetType);

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
    tags: normalizeCloudTags(asset.data["labels"]),
    properties: pickCloudProperties(asset.data, type.properties),
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

  public constructor(options: {
    serviceAccountJson: string;
    transport: CloudConnectorTransport;
    requestTimeoutInMs?: number | undefined;
    budget?: CloudReadBudget | undefined;
  }) {
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
    this.budget = options.budget;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GCP_CLOUD_PLATFORM_READ_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  private async get(url: string, step: string): Promise<JSONObject> {
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
      throw GcpInventoryClient.classify(error);
    }
  }

  public static classify(error: unknown): LlmProviderError {
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
        message: `${failure.message} Turn on the Cloud Asset API for the project: gcloud services enable cloudasset.googleapis.com`,
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

  // Every asset of the inventory's types in one project, page by page.
  public async listAssets(projectId: string): Promise<GcpAssetListing> {
    const assets: Array<GcpAsset> = [];
    let pageToken: string = "";

    for (let page: number = 0; page < MAX_PAGES; page++) {
      const query: string = buildQueryString([
        ["contentType", "RESOURCE"],
        ...GCP_INVENTORY_TYPES.map(
          (type: GcpInventoryType): [string, string] => {
            return ["assetTypes", type.assetType];
          },
        ),
        ["pageSize", PAGE_SIZE],
        ["pageToken", pageToken],
      ]);

      const response: JSONObject = await this.get(
        `${ASSET_BASE_URL}/projects/${encodeURIComponent(projectId)}/assets?${query}`,
        "assets request",
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
