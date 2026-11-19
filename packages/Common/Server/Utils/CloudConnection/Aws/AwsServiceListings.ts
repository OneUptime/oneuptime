import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  AwsRestResponse,
  getAwsHost,
  getAwsPartition,
  sendAwsRequest,
  sendAwsRestRequest,
} from "./AwsApi";
import {
  AwsCloudControlListing,
  AwsCloudControlOptions,
  AwsListedResource,
} from "./AwsCloudControl";

/*
 * THE RESOURCES SOME SERVICES LIST THEMSELVES, FOR THE INVENTORY (#9692).
 *
 * A WAF web ACL, a Network Firewall firewall, a Global Accelerator
 * accelerator, a Cognito user pool, an AppSync GraphQL API and a SageMaker
 * endpoint report key metrics (CloudKeyMetrics), and were found only once
 * they did: an ACL that allowed and blocked nothing for three hours, a pool
 * nobody signed in to, an endpoint nobody invoked was not on the account's
 * page at all. The inventory lists them with each service's own list -
 * Cloud Control lists none of them with the name its metrics give it, and
 * AppSync's and SageMaker's not at all - each handed on as Cloud Control
 * would list it: its ARN as the identifier, and what the inventory keeps.
 *
 *   WAF          AWSWAF_20190729.ListWebACLs (JSON 1.1), REGIONAL in each
 *                Region and CLOUDFRONT in US East (N. Virginia), then
 *                GetWebACL for each: its metrics name it by its
 *                VisibilityConfig.MetricName, which ListWebACLs does not
 *                answer and which need not be its name.
 *   Network      NetworkFirewall_20201112.ListFirewalls (JSON 1.0).
 *   Firewall
 *   Global       GlobalAccelerator_V20180706.ListAccelerators (JSON 1.1), in
 *   Accelerator  US West (Oregon) alone, where its API and its metrics are.
 *   Cognito      AWSCognitoIdentityProviderService.ListUserPools (JSON 1.1),
 *                at most 60 a page.
 *   AppSync      GET /v1/apis (REST), at most 25 a page.
 *   SageMaker    SageMaker.ListEndpoints (JSON 1.1), at api.sagemaker.
 *
 * Each is a free read of configuration the connection's role holds from
 * its setup command (CloudConnectionSetupCommands); a role set up before is
 * refused, and the inventory goes on without the type, without a warning
 * (AwsInventoryCatalog's quietWhenRefused): run the setup command again.
 */

// Pages of one type in one Region at most.
export const AWS_SERVICE_LISTING_MAX_PAGES: number = 20;

// The one Region Global Accelerator's API and metrics are in.
export const GLOBAL_ACCELERATOR_REGION: string = "us-west-2";

// The Region a CloudFront distribution's web ACLs are listed and measured in.
export const WAF_CLOUDFRONT_REGION: string = "us-east-1";

const WAF_TARGET_PREFIX: string = "AWSWAF_20190729";
const NETWORK_FIREWALL_TARGET_PREFIX: string = "NetworkFirewall_20201112";
const GLOBAL_ACCELERATOR_TARGET_PREFIX: string = "GlobalAccelerator_V20180706";
const COGNITO_TARGET_PREFIX: string = "AWSCognitoIdentityProviderService";
const SAGEMAKER_TARGET_PREFIX: string = "SageMaker";

// The properties named, those a listing answered, as the inventory keeps them.
function pick(item: JSONObject, names: ReadonlyArray<string>): JSONObject {
  const properties: JSONObject = {};

  for (const name of names) {
    const value: unknown = item[name];

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      properties[name] = value;
    }
  }

  return properties;
}

/*
 * Every page of one JSON-protocol list: `read` takes each answer's items
 * and the token of the next page ("" for the last).
 */
async function listPages(data: {
  options: AwsCloudControlOptions;
  region: string;
  service: string;
  host?: string | undefined;
  target: string;
  jsonVersion: "1.0" | "1.1";
  body: JSONObject;
  tokenField: string;
  step: string;
  providerTitle: string;
  read: (answer: JSONObject) => Array<AwsListedResource>;
}): Promise<AwsCloudControlListing> {
  const resources: Array<AwsListedResource> = [];
  let token: string = "";

  for (let page: number = 0; page < AWS_SERVICE_LISTING_MAX_PAGES; page++) {
    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.options.credentials,
      service: data.service,
      region: data.region,
      host: data.host,
      target: data.target,
      jsonVersion: data.jsonVersion,
      body: { ...data.body, ...(token ? { [data.tokenField]: token } : {}) },
      step: `${data.step} in ${data.region}`,
      providerTitle: data.providerTitle,
      now: data.options.now,
      timeoutInMs: data.options.timeoutInMs,
      sleep: data.options.sleep,
      budget: data.options.budget,
    });

    resources.push(...data.read(answer.json));

    const next: string = readText(answer.json[data.tokenField]);

    if (!next || next === token) {
      return { resources, complete: true };
    }

    token = next;
  }

  return { resources, complete: false };
}

/*
 * A Region's web ACLs, and in US East (N. Virginia) a CloudFront
 * distribution's too, each with the metric name its metrics carry.
 */
export async function listWafWebAcls(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  const scopes: Array<"REGIONAL" | "CLOUDFRONT"> = [
    "REGIONAL",
    // CloudFront's web ACLs are the commercial partition's, in US East (N. Virginia).
    ...(options.region === WAF_CLOUDFRONT_REGION &&
    getAwsPartition(options.region) === "aws"
      ? (["CLOUDFRONT"] as Array<"CLOUDFRONT">)
      : []),
  ];
  const resources: Array<AwsListedResource> = [];
  let complete: boolean = true;

  for (const scope of scopes) {
    const listed: AwsCloudControlListing = await listPages({
      options,
      region: options.region,
      service: "wafv2",
      target: `${WAF_TARGET_PREFIX}.ListWebACLs`,
      jsonVersion: "1.1",
      body: { Scope: scope, Limit: 100 },
      tokenField: "NextMarker",
      step: `WAF web ACLs request (${scope})`,
      providerTitle: "AWS WAF",
      read: (answer: JSONObject): Array<AwsListedResource> => {
        return readArray(answer["WebACLs"])
          .map((raw: unknown): AwsListedResource | null => {
            const acl: JSONObject = readObject(raw);
            const arn: string = readText(acl["ARN"]);

            return arn
              ? {
                  identifier: arn,
                  properties: {
                    ...pick(acl, ["Name", "Id", "ARN", "Description"]),
                    Scope: scope,
                  },
                }
              : null;
          })
          .filter((listed: AwsListedResource | null): boolean => {
            return listed !== null;
          }) as Array<AwsListedResource>;
      },
    });

    complete = complete && listed.complete;

    for (const acl of listed.resources) {
      const name: string = readText(acl.properties["Name"]);
      const id: string = readText(acl.properties["Id"]);

      if (!name || !id) {
        continue;
      }

      // Its metric name: what its metrics call it, which need not be its name.
      const answer: { json: JSONObject } = await sendAwsRequest({
        transport: options.transport,
        credentials: options.credentials,
        service: "wafv2",
        region: options.region,
        target: `${WAF_TARGET_PREFIX}.GetWebACL`,
        jsonVersion: "1.1",
        body: { Name: name, Scope: scope, Id: id },
        step: `WAF web ACL request in ${options.region}`,
        providerTitle: "AWS WAF",
        now: options.now,
        timeoutInMs: options.timeoutInMs,
        sleep: options.sleep,
        budget: options.budget,
      });
      const webAcl: JSONObject = readObject(answer.json["WebACL"]);
      const metricName: string = readText(
        readObject(webAcl["VisibilityConfig"])["MetricName"],
      );

      resources.push({
        identifier: acl.identifier,
        properties: {
          ...acl.properties,
          ...(metricName ? { MetricName: metricName } : {}),
          ...pick(webAcl, ["Capacity", "ManagedByFirewallManager"]),
        },
      });
    }
  }

  return { resources, complete };
}

export async function listNetworkFirewalls(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  return await listPages({
    options,
    region: options.region,
    service: "network-firewall",
    target: `${NETWORK_FIREWALL_TARGET_PREFIX}.ListFirewalls`,
    jsonVersion: "1.0",
    body: { MaxResults: 100 },
    tokenField: "NextToken",
    step: "Network Firewall firewalls request",
    providerTitle: "AWS Network Firewall",
    read: (answer: JSONObject): Array<AwsListedResource> => {
      return readArray(answer["Firewalls"])
        .map((raw: unknown): AwsListedResource | null => {
          const firewall: JSONObject = readObject(raw);
          const arn: string = readText(firewall["FirewallArn"]);

          return arn && readText(firewall["FirewallName"])
            ? {
                identifier: arn,
                properties: pick(firewall, [
                  "FirewallName",
                  "FirewallArn",
                  "TransitGatewayAttachmentId",
                ]),
              }
            : null;
        })
        .filter((listed: AwsListedResource | null): boolean => {
          return listed !== null;
        }) as Array<AwsListedResource>;
    },
  });
}

/*
 * Every accelerator of the account, from US West (Oregon) - whatever Region
 * the inventory lists it from: its API and its metrics are there alone.
 */
export async function listGlobalAccelerators(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  return await listPages({
    options,
    region: GLOBAL_ACCELERATOR_REGION,
    service: "globalaccelerator",
    target: `${GLOBAL_ACCELERATOR_TARGET_PREFIX}.ListAccelerators`,
    jsonVersion: "1.1",
    body: { MaxResults: 100 },
    tokenField: "NextToken",
    step: "Global Accelerator accelerators request",
    providerTitle: "AWS Global Accelerator",
    read: (answer: JSONObject): Array<AwsListedResource> => {
      return readArray(answer["Accelerators"])
        .map((raw: unknown): AwsListedResource | null => {
          const accelerator: JSONObject = readObject(raw);
          const arn: string = readText(accelerator["AcceleratorArn"]);

          return arn
            ? {
                identifier: arn,
                properties: pick(accelerator, [
                  "AcceleratorArn",
                  "Name",
                  "Status",
                  "Enabled",
                  "IpAddressType",
                  "DnsName",
                  "DualStackDnsName",
                ]),
              }
            : null;
        })
        .filter((listed: AwsListedResource | null): boolean => {
          return listed !== null;
        }) as Array<AwsListedResource>;
    },
  });
}

export async function listCognitoUserPools(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  return await listPages({
    options,
    region: options.region,
    service: "cognito-idp",
    target: `${COGNITO_TARGET_PREFIX}.ListUserPools`,
    jsonVersion: "1.1",
    // MaxResults is required, and at most 60.
    body: { MaxResults: 60 },
    tokenField: "NextToken",
    step: "Cognito user pools request",
    providerTitle: "Amazon Cognito",
    read: (answer: JSONObject): Array<AwsListedResource> => {
      return readArray(answer["UserPools"])
        .map((raw: unknown): AwsListedResource | null => {
          const pool: JSONObject = readObject(raw);
          const id: string = readText(pool["Id"]);

          return id
            ? {
                identifier: id,
                properties: pick(pool, ["Id", "Name", "Status"]),
              }
            : null;
        })
        .filter((listed: AwsListedResource | null): boolean => {
          return listed !== null;
        }) as Array<AwsListedResource>;
    },
  });
}

export async function listAppSyncApis(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  const resources: Array<AwsListedResource> = [];
  let token: string = "";

  for (let page: number = 0; page < AWS_SERVICE_LISTING_MAX_PAGES; page++) {
    const answer: AwsRestResponse = await sendAwsRestRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: "appsync",
      region: options.region,
      path: "/v1/apis",
      query: { maxResults: "25", ...(token ? { nextToken: token } : {}) },
      headers: { Accept: "application/json" },
      step: `AppSync GraphQL APIs request in ${options.region}`,
      providerTitle: "AWS AppSync",
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });
    const json: JSONObject = answer.json || {};

    for (const raw of readArray(json["graphqlApis"])) {
      const api: JSONObject = readObject(raw);
      const arn: string = readText(api["arn"]);
      const apiId: string = readText(api["apiId"]);

      if (!arn || !apiId) {
        continue;
      }

      const graphQlUrl: string = readText(readObject(api["uris"])["GRAPHQL"]);

      resources.push({
        identifier: arn,
        properties: {
          ...pick(api, ["name", "apiId", "arn", "apiType", "visibility"]),
          ...(graphQlUrl ? { GraphQLUrl: graphQlUrl } : {}),
        },
      });
    }

    const next: string = readText(json["nextToken"]);

    if (!next || next === token) {
      return { resources, complete: true };
    }

    token = next;
  }

  return { resources, complete: false };
}

export async function listSageMakerEndpoints(
  options: AwsCloudControlOptions,
): Promise<AwsCloudControlListing> {
  return await listPages({
    options,
    region: options.region,
    service: "sagemaker",
    // SageMaker's API answers at api.sagemaker, its runtime at runtime.sagemaker.
    host: `api.${getAwsHost("sagemaker", options.region)}`,
    target: `${SAGEMAKER_TARGET_PREFIX}.ListEndpoints`,
    jsonVersion: "1.1",
    body: { MaxResults: 100 },
    tokenField: "NextToken",
    step: "SageMaker endpoints request",
    providerTitle: "Amazon SageMaker",
    read: (answer: JSONObject): Array<AwsListedResource> => {
      return readArray(answer["Endpoints"])
        .map((raw: unknown): AwsListedResource | null => {
          const endpoint: JSONObject = readObject(raw);
          const arn: string = readText(endpoint["EndpointArn"]);

          return arn && readText(endpoint["EndpointName"])
            ? {
                identifier: arn,
                properties: pick(endpoint, [
                  "EndpointName",
                  "EndpointArn",
                  "EndpointStatus",
                ]),
              }
            : null;
        })
        .filter((listed: AwsListedResource | null): boolean => {
          return listed !== null;
        }) as Array<AwsListedResource>;
    },
  });
}
