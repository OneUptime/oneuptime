import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import { AwsCredentials, sendAwsRequest } from "./AwsApi";

/*
 * The AWS Cloud Control API's ListResources, over AWS JSON 1.0 (target
 * CloudApiService.ListResources), signed for the service "cloudcontrolapi":
 * every resource of one CloudFormation type in one Region, each with the
 * properties CloudFormation describes it by - the one call that lists an EC2
 * instance, an RDS database and an SQS queue alike, where each service's own
 * API speaks a protocol of its own.
 *
 *   { TypeName: "AWS::EC2::Instance", MaxResults: 100, NextToken,
 *     ResourceModel? }
 *   -> { ResourceDescriptions: [{ Identifier, Properties }], NextToken }
 *
 * `Properties` is a JSON document in a string. A type listed inside a parent
 * (an ECS service inside its cluster) names the parent in `ResourceModel`,
 * itself a JSON document in a string.
 *
 * Cloud Control calls the service's own List and Describe actions as the
 * caller, so the role needs those (CloudConnectionSetupCommands lists them)
 * besides cloudformation:ListResources. Free: only the services' own calls
 * count, and those are free reads.
 */

const CLOUD_CONTROL_SERVICE: string = "cloudcontrolapi";
const TARGET: string = "CloudApiService.ListResources";
const PROVIDER_TITLE: string = "AWS Cloud Control";
const PAGE_SIZE: number = 100;
// Pages of one type in one Region at most: 2,000 resources.
export const AWS_CLOUD_CONTROL_MAX_PAGES: number = 20;

export interface AwsCloudControlOptions {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

export interface AwsListedResource {
  // The type's primary identifier: an instance id, an ARN, a queue URL.
  identifier: string;
  // What CloudFormation describes the resource by; {} when unreadable.
  properties: JSONObject;
}

export interface AwsCloudControlListing {
  resources: Array<AwsListedResource>;
  // False when the listing stopped at AWS_CLOUD_CONTROL_MAX_PAGES.
  complete: boolean;
}

/*
 * A JSON document in a string, as Cloud Control writes Properties: {} when
 * it is not one, so one malformed resource never stops a listing.
 */
export function parseCloudControlProperties(value: unknown): JSONObject {
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : {};
  } catch {
    return {};
  }
}

// Every resource of a type in a Region, page by page.
export async function listCloudControlResources(
  options: AwsCloudControlOptions,
  data: {
    typeName: string;
    // The parent, for a type listed inside one: { Cluster: "arn:..." }.
    resourceModel?: JSONObject | undefined;
  },
): Promise<AwsCloudControlListing> {
  const resources: Array<AwsListedResource> = [];
  let token: string = "";

  for (let page: number = 0; page < AWS_CLOUD_CONTROL_MAX_PAGES; page++) {
    const payload: JSONObject = {
      TypeName: data.typeName,
      MaxResults: PAGE_SIZE,
    };

    if (data.resourceModel) {
      payload["ResourceModel"] = JSON.stringify(data.resourceModel);
    }

    if (token) {
      payload["NextToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: CLOUD_CONTROL_SERVICE,
      region: options.region,
      target: TARGET,
      jsonVersion: "1.0",
      body: payload,
      step: `${data.typeName} listing in ${options.region}`,
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });

    for (const raw of readArray(answer.json["ResourceDescriptions"])) {
      const description: JSONObject = readObject(raw);
      const identifier: string = readText(description["Identifier"]);

      if (identifier) {
        resources.push({
          identifier,
          properties: parseCloudControlProperties(description["Properties"]),
        });
      }
    }

    const next: string = readText(answer.json["NextToken"]);

    if (!next || next === token) {
      return { resources, complete: true };
    }

    token = next;
  }

  return { resources, complete: false };
}
