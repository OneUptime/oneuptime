import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import { CloudConnectorTransport, CloudReadBudget } from "../CloudConnectorTypes";
import { AwsCredentials, sendAwsRequest } from "./AwsApi";

/*
 * The AWS Resource Groups Tagging API's GetResources (AWS JSON 1.1, target
 * ResourceGroupsTaggingAPI_20170126), for one thing only: the Name tag of
 * the resources CloudWatch knows by an id - an EC2 instance is
 * "i-0abc123def" in its metrics and "web-prod-1" to the people running it.
 *
 *   { ResourceTypeFilters: ["ec2:instance", ...], TagFilters: [{ Key: "Name" }],
 *     ResourcesPerPage: 100, PaginationToken }
 *   -> { ResourceTagMappingList: [{ ResourceARN, Tags: [{ Key, Value }] }],
 *        PaginationToken }
 */

const TAGGING_SERVICE: string = "tagging";
const TARGET: string = "ResourceGroupsTaggingAPI_20170126.GetResources";
const PROVIDER_TITLE: string = "AWS";
const MAX_PAGES: number = 50;

/*
 * The resource types read for names: the ones whose metrics name them by
 * an id nobody recognises.
 */
export const AWS_NAME_TAG_RESOURCE_TYPES: Array<string> = [
  "ec2:instance",
  "ec2:volume",
  "ec2:natgateway",
  "ec2:vpn-connection",
  "ec2:transit-gateway",
  "elasticfilesystem:file-system",
];

// ARN -> its Name tag, for the resources of one Region that have one.
export async function getNameTags(options: {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  region: string;
  now?: (() => Date) | undefined;
  timeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}): Promise<Map<string, string>> {
  const names: Map<string, string> = new Map();
  let token: string = "";

  for (let page: number = 0; page < MAX_PAGES; page++) {
    const payload: JSONObject = {
      ResourceTypeFilters: AWS_NAME_TAG_RESOURCE_TYPES,
      TagFilters: [{ Key: "Name" }],
      ResourcesPerPage: 100,
    };

    if (token) {
      payload["PaginationToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: options.transport,
      credentials: options.credentials,
      service: TAGGING_SERVICE,
      region: options.region,
      target: TARGET,
      jsonVersion: "1.1",
      body: payload,
      step: `resource names request in ${options.region}`,
      providerTitle: PROVIDER_TITLE,
      now: options.now,
      timeoutInMs: options.timeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });

    for (const raw of readArray(answer.json["ResourceTagMappingList"])) {
      const mapping: JSONObject = readObject(raw);
      const arn: string = readText(mapping["ResourceARN"]);

      for (const rawTag of readArray(mapping["Tags"])) {
        const tag: JSONObject = readObject(rawTag);

        if (readText(tag["Key"]) === "Name") {
          const value: string = readText(tag["Value"]);

          if (arn && value) {
            names.set(arn.toLowerCase(), value);
          }
        }
      }
    }

    const next: string = readText(answer.json["PaginationToken"]);

    if (!next || next === token) {
      break;
    }

    token = next;
  }

  return names;
}
