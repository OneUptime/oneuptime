import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { CloudReadBudgetSpent } from "../CloudConnectorTypes";
import { sendAwsRequest } from "./AwsApi";
import { AwsCloudControlOptions, AwsListedResource } from "./AwsCloudControl";
import {
  AwsXmlElement,
  parseAwsXml,
  xmlFind,
  xmlList,
  xmlText,
} from "../LiveRead/AwsXml";

/*
 * WHETHER A NETWORK LOAD BALANCER'S TARGET GROUPS KEEP THE CLIENT'S ADDRESS
 * (#11389), for the inventory.
 *
 * Cloud Control lists a target group with DescribeTargetGroups alone (its
 * list handler's one permission), so the listing holds no attributes. A
 * Network Load Balancer whose target group has client IP preservation off
 * connects to its targets from its own private addresses and passes on the
 * X-Forwarded-For a client wrote, so the inventory asks Elastic Load
 * Balancing for the attributes of each target group where that can be so -
 * one of a Network Load Balancer, sending TCP or TLS to instances or IP
 * addresses - with DescribeTargetGroupAttributes (the Query protocol,
 * version 2015-12-01), which the connection's role holds
 * (elasticloadbalancing:Describe*):
 *
 *   Action=DescribeTargetGroupAttributes&TargetGroupArn=arn:...
 *   -> <DescribeTargetGroupAttributesResult><Attributes><member><Key/>
 *        <Value/></member>...</Attributes></DescribeTargetGroupAttributesResult>
 *
 * The answer is kept on the listed target group as Cloud Control's model
 * would hold it (TargetGroupAttributes: [{ Key, Value }]), so
 * AwsInventoryCatalog reads one shape. A target group not asked about - past
 * the most one Region's read asks, the read's budget spent, or refused -
 * is left without them, and its load balancer is said not to be known to
 * keep the client's address: never trusted for it.
 */

export const ELASTIC_LOAD_BALANCING_V2_API_VERSION: string = "2015-12-01";

const SERVICE: string = "elasticloadbalancing";
const PROVIDER_TITLE: string = "AWS Elastic Load Balancing";

// The most target groups one Region's read asks about.
export const AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION: number = 100;

// The attribute that says whether a target group keeps the client's address.
export const AWS_PRESERVE_CLIENT_IP_ATTRIBUTE: string =
  "preserve_client_ip.enabled";

// The protocols whose client IP preservation can be off: the others always keep it.
const PRESERVATION_PROTOCOLS: ReadonlyArray<string> = ["TCP", "TLS"];

// The target types whose client IP preservation can be off: an alb target always keeps it.
const PRESERVATION_TARGET_TYPES: ReadonlyArray<string> = ["instance", "ip"];

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTexts(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): string => {
      return readText(item);
    })
    .filter(Boolean);
}

/*
 * Whether a listed target group is one whose client IP preservation can be
 * off, and so must be asked about: a Network Load Balancer's ("...:
 * loadbalancer/net/..." among its load balancers), over TCP or TLS, to
 * instances or IP addresses (instances when it does not say).
 */
export function canTargetGroupDropClientIp(group: AwsListedResource): boolean {
  const properties: JSONObject = group.properties;
  const protocol: string = readText(properties["Protocol"]).toUpperCase();
  const targetType: string =
    readText(properties["TargetType"]).toLowerCase() || "instance";

  if (
    !PRESERVATION_PROTOCOLS.includes(protocol) ||
    !PRESERVATION_TARGET_TYPES.includes(targetType)
  ) {
    return false;
  }

  return readTexts(properties["LoadBalancerArns"]).some(
    (arn: string): boolean => {
      return arn.toLowerCase().includes(":loadbalancer/net/");
    },
  );
}

// The attributes of one answer, as Cloud Control's model names them.
export function readTargetGroupAttributesAnswer(
  text: string,
): Array<{ Key: string; Value: string }> {
  const root: AwsXmlElement = parseAwsXml(text);
  const attributes: Array<{ Key: string; Value: string }> = [];

  for (const member of xmlList(xmlFind(root, "Attributes"), "")) {
    const key: string = xmlText(member, "Key").trim();

    if (key) {
      attributes.push({ Key: key, Value: xmlText(member, "Value").trim() });
    }
  }

  return attributes;
}

// One target group's attributes, as Elastic Load Balancing answers them.
export async function describeTargetGroupAttributes(
  options: AwsCloudControlOptions,
  targetGroupArn: string,
): Promise<Array<{ Key: string; Value: string }>> {
  const body: Dictionary<string> = {
    Action: "DescribeTargetGroupAttributes",
    Version: ELASTIC_LOAD_BALANCING_V2_API_VERSION,
    TargetGroupArn: targetGroupArn,
  };

  const answer: { text: string } = await sendAwsRequest({
    transport: options.transport,
    credentials: options.credentials,
    service: SERVICE,
    region: options.region,
    body,
    step: `target group attributes request in ${options.region}`,
    providerTitle: PROVIDER_TITLE,
    now: options.now,
    timeoutInMs: options.timeoutInMs,
    sleep: options.sleep,
    budget: options.budget,
  });

  return readTargetGroupAttributesAnswer(answer.text);
}

/*
 * The attributes of each of the Region's target groups that can drop the
 * client's address, written onto it (TargetGroupAttributes), up to
 * AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION of them. One that could not
 * be read is left without them. Throws only what stops the whole listing:
 * a credential AWS no longer takes. Says whether the read's budget ran out.
 */
export async function addTargetGroupAttributes(data: {
  options: AwsCloudControlOptions;
  targetGroups: ReadonlyArray<AwsListedResource>;
}): Promise<{ budgetSpent: boolean }> {
  let asked: number = 0;

  for (const group of data.targetGroups) {
    if (!canTargetGroupDropClientIp(group)) {
      continue;
    }

    if (asked >= AWS_TARGET_GROUP_ATTRIBUTES_READ_PER_REGION) {
      break;
    }

    const arn: string =
      readText(group.properties["TargetGroupArn"]) || group.identifier.trim();

    if (!arn) {
      continue;
    }

    asked++;

    try {
      group.properties["TargetGroupAttributes"] =
        (await describeTargetGroupAttributes(
          data.options,
          arn,
        )) as unknown as JSONValue;
    } catch (error) {
      if (error instanceof CloudReadBudgetSpent) {
        return { budgetSpent: true };
      }

      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      // Left without them: its load balancer is not known to keep the client's address.
    }
  }

  return { budgetSpent: false };
}
