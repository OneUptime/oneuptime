import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  CloudChange,
  CloudConnectorCallOptions,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import { AwsCredentials, awsErrorCodeOf, sendAwsRequest } from "./AwsApi";

/*
 * WHAT CHANGED IN AN AWS ACCOUNT, AND WHAT AWS SAYS ABOUT ITS HEALTH.
 *
 *   CloudTrail LookupEvents (AWS JSON 1.1, target
 *   com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents):
 *     { LookupAttributes: [{ AttributeKey: "ReadOnly", AttributeValue:
 *       "false" }], StartTime, EndTime, MaxResults: 50, NextToken }
 *     -> { Events: [{ EventId, EventName, EventSource, EventTime, Username,
 *          Resources: [{ ResourceType, ResourceName }], CloudTrailEvent }],
 *          NextToken }
 *   The account's management events of the last 90 days, per Region, free.
 *   Only events that change something are asked for, and the ones that are
 *   machinery rather than a change - signing in, assuming a role, an ECS
 *   agent reporting a task's state - are left out (isAwsChangeNoise). Of
 *   CloudTrailEvent only the error code and the caller's type are read:
 *   its request parameters can carry anything, and are never kept.
 *
 *   AWS Health DescribeEvents (AWS JSON 1.1, target
 *   AWSHealth_20160804.DescribeEvents, in the partition's home Region), and
 *   DescribeEventDetails for each event's own words. It answers only an
 *   account on a Business, Enterprise On-Ramp or Enterprise Support plan;
 *   any other answers SubscriptionRequiredException, and the connection
 *   asks again a day later.
 */

const PROVIDER_TITLE: string = "AWS";
const CLOUDTRAIL_TARGET: string =
  "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents";
const HEALTH_EVENTS_TARGET: string = "AWSHealth_20160804.DescribeEvents";
const HEALTH_DETAILS_TARGET: string = "AWSHealth_20160804.DescribeEventDetails";
// Pages of one Region's events per read at most: 250 changes.
export const AWS_CHANGE_MAX_PAGES: number = 5;
const HEALTH_MAX_PAGES: number = 3;

/*
 * Events that are machinery, not a change worth naming next to an
 * incident: by service, or by service and operation.
 */
const NOISY_SOURCES: ReadonlyArray<string> = [
  "sts.amazonaws.com",
  "signin.amazonaws.com",
  "sso.amazonaws.com",
  "kms.amazonaws.com",
  "notifications.amazonaws.com",
  "health.amazonaws.com",
  "cloudshell.amazonaws.com",
];

const NOISY_OPERATIONS: ReadonlyArray<string> = [
  "ecs:SubmitTaskStateChange",
  "ecs:SubmitContainerStateChange",
  "ecs:SubmitAttachmentStateChanges",
  "ecs:RegisterContainerInstance",
  "ssm:UpdateInstanceInformation",
  "ssm:UpdateInstanceAssociationStatus",
  "logs:CreateLogStream",
  "logs:CreateLogGroup",
  "logs:PutRetentionPolicy",
  "ec2:CreateNetworkInterface",
  "ec2:DeleteNetworkInterface",
  "ec2:AttachNetworkInterface",
  "ec2:DetachNetworkInterface",
  "ec2:CreateTags",
  "ec2:DeleteTags",
  "cloudtrail:LookupEvents",
];

// "ec2.amazonaws.com" + "RunInstances" -> "ec2:RunInstances".
export function awsOperationOf(eventSource: string, eventName: string): string {
  const service: string = eventSource.split(".")[0] || eventSource;
  return `${service}:${eventName}`;
}

export function isAwsChangeNoise(
  eventSource: string,
  eventName: string,
): boolean {
  return (
    NOISY_SOURCES.includes(eventSource.toLowerCase()) ||
    NOISY_OPERATIONS.includes(awsOperationOf(eventSource, eventName))
  );
}

// A CloudTrailEvent document, for its error code; {} when unreadable.
function parseTrailEvent(value: unknown): JSONObject {
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

// One CloudTrail event as a change, or null for machinery.
export function readAwsTrailEvent(data: {
  event: JSONObject;
  accountId: string;
  region: string;
}): CloudChange | null {
  const eventId: string = readText(data.event["EventId"]);
  const eventName: string = readText(data.event["EventName"]);
  const eventSource: string = readText(data.event["EventSource"]);
  const seconds: unknown = data.event["EventTime"];
  const time: Date =
    typeof seconds === "number"
      ? new Date(seconds * 1000)
      : new Date(readText(seconds));

  if (
    !eventId ||
    !eventName ||
    Number.isNaN(time.getTime()) ||
    isAwsChangeNoise(eventSource, eventName)
  ) {
    return null;
  }

  const trail: JSONObject = parseTrailEvent(data.event["CloudTrailEvent"]);

  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: data.accountId,
    region: readText(trail["awsRegion"]) || data.region,
    time,
    eventId,
    operation: awsOperationOf(eventSource, eventName),
    actor: readText(data.event["Username"]),
    resources: readArray(data.event["Resources"])
      .map((raw: unknown) => {
        const resource: JSONObject = readObject(raw);
        return {
          id: readText(resource["ResourceName"]),
          type: readText(resource["ResourceType"]) || undefined,
        };
      })
      .filter((resource: { id: string }): boolean => {
        return resource.id.length > 0;
      }),
    failed: Boolean(readText(trail["errorCode"])),
  };
}

// One Region's write events in [start, end), newest first as AWS lists them.
export async function lookupAwsChanges(data: {
  credentials: AwsCredentials;
  accountId: string;
  region: string;
  start: Date;
  end: Date;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<{ changes: Array<CloudChange>; complete: boolean }> {
  const changes: Array<CloudChange> = [];
  let token: string = "";

  for (let page: number = 0; page < AWS_CHANGE_MAX_PAGES; page++) {
    const body: JSONObject = {
      LookupAttributes: [{ AttributeKey: "ReadOnly", AttributeValue: "false" }],
      StartTime: Math.floor(data.start.getTime() / 1000),
      EndTime: Math.ceil(data.end.getTime() / 1000),
      MaxResults: 50,
    };

    if (token) {
      body["NextToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.credentials,
      service: "cloudtrail",
      region: data.region,
      target: CLOUDTRAIL_TARGET,
      jsonVersion: "1.1",
      body,
      step: `activity request in ${data.region}`,
      providerTitle: PROVIDER_TITLE,
      now: data.options.now,
      timeoutInMs: data.options.requestTimeoutInMs,
      sleep: data.options.sleep,
      budget: data.budget,
    });

    for (const raw of readArray(answer.json["Events"])) {
      const change: CloudChange | null = readAwsTrailEvent({
        event: readObject(raw),
        accountId: data.accountId,
        region: data.region,
      });

      if (change) {
        changes.push(change);
      }
    }

    const next: string = readText(answer.json["NextToken"]);

    if (!next || next === token) {
      return { changes, complete: true };
    }

    token = next;
  }

  return { changes, complete: false };
}

// AWS Health's event codes read as words: "AWS_EC2_OPERATIONAL_ISSUE" -> "EC2 operational issue".
export function describeAwsHealthEventType(code: string): string {
  const words: Array<string> = code
    .split("_")
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  if (words[0] === "AWS") {
    words.shift();
  }

  if (words.length === 0) {
    return code;
  }

  const service: string = words.shift()!;

  return [
    service,
    ...words.map((word: string): string => {
      return word.toLowerCase();
    }),
  ].join(" ");
}

/*
 * The account's health events updated since `start`: issues, scheduled
 * changes and investigations - not the billing and account notices AWS
 * sends the same way. Each status an event reaches is a change of its own.
 * Null when the account's support plan does not include the Health API.
 */
export async function readAwsHealthEvents(data: {
  credentials: AwsCredentials;
  accountId: string;
  // The partition's home Region, where AWS Health answers: us-east-1 when absent.
  region?: string | undefined;
  start: Date;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<Array<CloudChange> | null> {
  const healthRegion: string = data.region || "us-east-1";
  const events: Array<JSONObject> = [];
  let token: string = "";

  try {
    for (let page: number = 0; page < HEALTH_MAX_PAGES; page++) {
      const body: JSONObject = {
        filter: {
          lastUpdatedTimes: [{ from: Math.floor(data.start.getTime() / 1000) }],
          eventTypeCategories: ["issue", "scheduledChange", "investigation"],
        },
        maxResults: 100,
      };

      if (token) {
        body["nextToken"] = token;
      }

      const answer: { json: JSONObject } = await sendAwsRequest({
        transport: data.options.transport,
        credentials: data.credentials,
        service: "health",
        region: healthRegion,
        target: HEALTH_EVENTS_TARGET,
        jsonVersion: "1.1",
        body,
        step: "health events request",
        providerTitle: PROVIDER_TITLE,
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      });

      for (const raw of readArray(answer.json["events"])) {
        events.push(readObject(raw));
      }

      const next: string = readText(answer.json["nextToken"]);

      if (!next || next === token) {
        break;
      }

      token = next;
    }
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      awsErrorCodeOf(error.responseBody || "") ===
        "SubscriptionRequiredException"
    ) {
      return null;
    }

    throw error;
  }

  // Each event's own words, ten at a time.
  const descriptions: Map<string, string> = new Map();

  for (let start: number = 0; start < events.length; start += 10) {
    const arns: Array<string> = events
      .slice(start, start + 10)
      .map((event: JSONObject): string => {
        return readText(event["arn"]);
      })
      .filter((arn: string): boolean => {
        return arn.length > 0;
      });

    if (arns.length === 0 || data.budget.isSpent()) {
      continue;
    }

    try {
      const answer: { json: JSONObject } = await sendAwsRequest({
        transport: data.options.transport,
        credentials: data.credentials,
        service: "health",
        region: healthRegion,
        target: HEALTH_DETAILS_TARGET,
        jsonVersion: "1.1",
        body: { eventArns: arns },
        step: "health event details request",
        providerTitle: PROVIDER_TITLE,
        now: data.options.now,
        timeoutInMs: data.options.requestTimeoutInMs,
        sleep: data.options.sleep,
        budget: data.budget,
      });

      for (const raw of readArray(answer.json["successfulSet"])) {
        const detail: JSONObject = readObject(raw);
        const arn: string = readText(readObject(detail["event"])["arn"]);
        const description: string = readText(
          readObject(detail["eventDescription"])["latestDescription"],
        );

        if (arn && description) {
          descriptions.set(arn, description);
        }
      }
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }
    }
  }

  return events
    .map((event: JSONObject): CloudChange | null => {
      const arn: string = readText(event["arn"]);
      const status: string = readText(event["statusCode"]);
      const updated: unknown = event["lastUpdatedTime"];
      const time: Date =
        typeof updated === "number"
          ? new Date(updated * 1000)
          : new Date(readText(updated));
      const code: string = readText(event["eventTypeCode"]);

      if (!arn || Number.isNaN(time.getTime())) {
        return null;
      }

      return {
        kind: "health",
        provider: CloudProvider.AWS,
        accountId: data.accountId,
        region:
          readText(event["region"]) === "global"
            ? ""
            : readText(event["region"]),
        time,
        eventId: `${arn}|${status}|${time.toISOString()}`,
        operation: code,
        actor: "",
        resources: [],
        failed: false,
        title: `AWS Health: ${describeAwsHealthEventType(code)}${
          status ? ` (${status})` : ""
        }`,
        description: descriptions.get(arn),
      };
    })
    .filter((change: CloudChange | null): boolean => {
      return change !== null;
    }) as Array<CloudChange>;
}
