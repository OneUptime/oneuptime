import { JSONObject } from "../../../../Types/JSON";
import { AwsRestResponse, sendAwsRestRequest } from "./AwsApi";
import {
  AwsCloudControlListing,
  AwsCloudControlOptions,
  AwsListedResource,
} from "./AwsCloudControl";

/*
 * ONE REGION'S EKS CLUSTERS, for the inventory (#9375).
 *
 * EKS's own REST API, which answers what a cluster runs in - its VPC, its
 * subnets and security groups - where Cloud Control's list names a cluster
 * only:
 *
 *   GET /clusters?maxResults=100[&nextToken]  -> { clusters: [name], nextToken }
 *   GET /clusters/<name>                      -> { cluster: { name, arn,
 *        version, status, endpoint, platformVersion, resourcesVpcConfig:
 *        { vpcId, subnetIds, securityGroupIds, clusterSecurityGroupId,
 *        endpointPublicAccess, endpointPrivateAccess },
 *        kubernetesNetworkConfig: { serviceIpv4Cidr, ipFamily }, tags } }
 *
 * Each cluster is handed on as Cloud Control would list it: its name as the
 * identifier, and only the properties below, in CloudFormation's names -
 * never its certificate authority, its OIDC issuer or its access entries.
 * Read with eks:ListClusters and eks:DescribeCluster: a role set up before
 * EKS clusters were listed is refused, and the inventory goes on without
 * them (AwsInventoryCatalog).
 */

const SERVICE: string = "eks";
const PROVIDER_TITLE: string = "Amazon EKS";
const PAGE_SIZE: string = "100";
// Pages of names of one Region at most.
export const AWS_EKS_MAX_PAGES: number = 5;
// Clusters described in one Region at most; past it the listing is not complete.
export const AWS_EKS_MAX_CLUSTERS_PER_REGION: number = 100;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function texts(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : [])
    .map((item: unknown): string => {
      return text(item);
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

function objectAt(source: JSONObject, key: string): JSONObject {
  const value: unknown = source[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function parseJson(body: string): JSONObject {
  try {
    const parsed: unknown = JSON.parse(body);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : {};
  } catch {
    return {};
  }
}

// DescribeCluster's `cluster`, as a listed resource; null without its name.
export function readEksCluster(cluster: JSONObject): AwsListedResource | null {
  const name: string = text(cluster["name"]);

  if (!name) {
    return null;
  }

  const vpc: JSONObject = objectAt(cluster, "resourcesVpcConfig");
  const network: JSONObject = objectAt(cluster, "kubernetesNetworkConfig");
  const properties: JSONObject = { Name: name };

  for (const [from, to] of [
    ["arn", "Arn"],
    ["version", "Version"],
    ["status", "Status"],
    ["endpoint", "Endpoint"],
    ["platformVersion", "PlatformVersion"],
  ] as Array<[string, string]>) {
    const value: string = text(cluster[from]);

    if (value) {
      properties[to] = value;
    }
  }

  const vpcConfig: JSONObject = {
    SubnetIds: texts(vpc["subnetIds"]),
    SecurityGroupIds: texts(vpc["securityGroupIds"]),
  };

  for (const [from, to] of [
    ["vpcId", "VpcId"],
    ["clusterSecurityGroupId", "ClusterSecurityGroupId"],
  ] as Array<[string, string]>) {
    const value: string = text(vpc[from]);

    if (value) {
      vpcConfig[to] = value;
    }
  }

  for (const [from, to] of [
    ["endpointPublicAccess", "EndpointPublicAccess"],
    ["endpointPrivateAccess", "EndpointPrivateAccess"],
  ] as Array<[string, string]>) {
    if (typeof vpc[from] === "boolean") {
      vpcConfig[to] = vpc[from] as boolean;
    }
  }

  properties["ResourcesVpcConfig"] = vpcConfig;

  const networkConfig: JSONObject = {};

  for (const [from, to] of [
    ["serviceIpv4Cidr", "ServiceIpv4Cidr"],
    ["ipFamily", "IpFamily"],
  ] as Array<[string, string]>) {
    const value: string = text(network[from]);

    if (value) {
      networkConfig[to] = value;
    }
  }

  if (Object.keys(networkConfig).length > 0) {
    properties["KubernetesNetworkConfig"] = networkConfig;
  }

  const tags: JSONObject = objectAt(cluster, "tags");

  if (Object.keys(tags).length > 0) {
    properties["Tags"] = tags;
  }

  return { identifier: name, properties };
}

export async function listEksClusters(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  const send: (
    path: string,
    query: Record<string, string>,
    step: string,
  ) => Promise<JSONObject> = async (
    path: string,
    query: Record<string, string>,
    step: string,
  ): Promise<JSONObject> => {
    const answer: AwsRestResponse = await sendAwsRestRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: SERVICE,
      region: options.region,
      path,
      query,
      step,
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });

    return parseJson(answer.text);
  };

  const names: Array<string> = [];
  let token: string = "";
  let complete: boolean = false;

  for (let page: number = 0; page < AWS_EKS_MAX_PAGES; page++) {
    const answer: JSONObject = await send(
      "/clusters",
      token
        ? { maxResults: PAGE_SIZE, nextToken: token }
        : { maxResults: PAGE_SIZE },
      `EKS clusters request in ${options.region}`,
    );

    for (const name of texts(answer["clusters"])) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }

    const next: string = text(answer["nextToken"]);

    if (!next || next === token) {
      complete = true;
      break;
    }

    token = next;
  }

  if (names.length > AWS_EKS_MAX_CLUSTERS_PER_REGION) {
    complete = false;
  }

  const resources: Array<AwsListedResource> = [];

  for (const name of names.slice(0, AWS_EKS_MAX_CLUSTERS_PER_REGION)) {
    const answer: JSONObject = await send(
      `/clusters/${name}`,
      {},
      `EKS cluster ${name} request in ${options.region}`,
    );
    const listed: AwsListedResource | null = readEksCluster(
      objectAt(answer, "cluster"),
    );

    if (listed) {
      resources.push(listed);
    }
  }

  return { resources, complete };
}
