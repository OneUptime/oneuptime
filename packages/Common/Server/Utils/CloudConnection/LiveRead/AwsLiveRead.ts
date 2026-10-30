import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  CLOUD_DEFAULT_EVENT_HOURS,
  CLOUD_DEFAULT_LOG_MINUTES,
  CLOUD_DEFAULT_ROW_LIMIT,
  CloudParamValue,
  CloudResourceKindSpec,
  ParsedCloudResource,
  getCloudIntegerFlag,
  getCloudResourceKind,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "../../SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import {
  AwsCredentials,
  awsErrorCodeOf,
  classifyAwsError,
  getAwsHost,
  sendAwsRequest,
} from "../Aws/AwsApi";
import { awsOperationOf, isAwsChangeNoise } from "../Aws/AwsChanges";
import {
  AwsMetricQuery,
  AwsMetricResult,
  getMetricData,
  readAwsTimestamp,
} from "../Aws/AwsCloudWatch";
import { CloudReadBudgetSpent } from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";
import {
  AwsXmlElement,
  AwsXmlError,
  parseAwsXml,
  xmlFind,
  xmlList,
  xmlText,
} from "./AwsXml";
import {
  CloudLiveReadContext,
  CloudLiveReadError,
  CloudLiveReadTarget,
  callCloud,
  readOptionalPart,
} from "./CloudLiveReadTypes";
import {
  LIVE_READ_MAX_LOG_LINE_LENGTH,
  LiveReadText,
  formatNumber,
  liveEntries,
  liveHeader,
  liveText,
  liveTime,
  liveUsage,
} from "./LiveReadFormat";

/*
 * THE LIVE READS OF AN AWS ACCOUNT, through the connection's read-only role
 * (or access key), each signed with Signature Version 4 like every other
 * AWS call of a connection:
 *
 *   describe       ECS DescribeServices; EC2 DescribeInstances and
 *                  DescribeInstanceStatus; RDS DescribeDBInstances or
 *                  DescribeDBClusters; Auto Scaling DescribeAutoScalingGroups;
 *                  Lambda GetFunctionConfiguration, GetFunctionConcurrency
 *                  and GetAlias (REST: GET, signed here); SQS
 *                  GetQueueAttributes (AWS JSON 1.0); ELB DescribeTargetGroups
 *                  or DescribeLoadBalancers. Any other resource: OneUptime's
 *                  stored copy, said to be not live.
 *   recent-events  ECS service events; RDS DescribeEvents; Auto Scaling
 *                  DescribeScalingActivities; for anything else CloudTrail
 *                  LookupEvents of the resource's ARN, then its name. Of a
 *                  CloudTrail event only the call, the caller, the time and
 *                  its error code are read - never its request, which can
 *                  carry anything (as AwsChanges reads them).
 *   target-health  ELB DescribeTargetHealth of the target group, or of each
 *                  target group of the load balancer.
 *   quota-usage    Service Quotas ListServiceQuotas for the resource's
 *                  service in its Region, with each quota's usage metric
 *                  from CloudWatch GetMetricData (its Maximum over the last
 *                  hour), highest usage first.
 *   read-logs      CloudWatch Logs FilterLogEvents on the resource's log
 *                  groups: a Lambda function's, the awslogs group of an ECS
 *                  service's containers (DescribeTaskDefinition), an RDS
 *                  database's exported logs (DescribeLogGroups), or a log
 *                  group named by its ARN. Newest lines first (see
 *                  readNewestLogEvents).
 *
 * EC2, RDS, Auto Scaling and ELB answer in XML (AwsXml); the others in
 * JSON. Every call names the IAM action it needs, so a refusal says which
 * one the role is missing. A task definition's environment, a function's
 * environment and a queue's policy are never read into the answer.
 */

const PROVIDER_TITLE: string = "AWS";
export const AWS_LIVE_READ_SETUP_HINT: string =
  "Run the AWS connection's setup command again: it adds the read permissions OneUptime AI's live reads use.";
const ECS_TARGET_PREFIX: string = "AmazonEC2ContainerServiceV20141113";
const CLOUDTRAIL_LOOKUP_TARGET: string =
  "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents";
const SERVICE_QUOTAS_TARGET: string =
  "ServiceQuotasV20190624.ListServiceQuotas";
const LOGS_TARGET_PREFIX: string = "Logs_20140328";
const SQS_GET_ATTRIBUTES_TARGET: string = "AmazonSQS.GetQueueAttributes";
const EC2_VERSION: string = "2016-11-15";
const RDS_VERSION: string = "2014-10-31";
const AUTOSCALING_VERSION: string = "2011-01-01";
const ELB_VERSION: string = "2015-12-01";
const HOUR_MS: number = 60 * 60 * 1000;

// What lists are cut to in a describe (which takes no --limit).
const DESCRIBE_MAX_EVENTS: number = 5;
const DESCRIBE_MAX_ITEMS: number = 20;
const DESCRIBE_MAX_INSTANCES: number = 50;
const MAX_TAGS: number = 20;
const MAX_TARGETS_PER_GROUP: number = 100;
const MAX_TARGET_GROUPS: number = 10;
// Pages of one listing a read asks for at most.
const MAX_EVENT_PAGES: number = 3;
const MAX_TRAIL_PAGES: number = 4;
const MAX_QUOTA_PAGES: number = 3;
// The most log groups one read-logs reads (an RDS database exports several).
const MAX_LOG_GROUPS: number = 5;
// FilterLogEvents' own largest page.
const LOG_PAGE_EVENTS: number = 10000;
// The narrowest stretch of a log the newest lines are looked for in.
const MIN_LOG_WINDOW_MS: number = 1000;
// The longest CloudTrailEvent document read for its error code.
const MAX_TRAIL_EVENT_LENGTH: number = 256 * 1024;

// The live describes, by kind, for the stored copy's note.
const LIVE_DESCRIBE_KINDS: string =
  "ECS services, EC2 instances, RDS instances and Aurora clusters, Auto Scaling groups, Lambda functions and aliases, SQS queues, target groups and load balancers";

const AWS_REGION_REGEX: RegExp =
  /^[a-z]{2}(?:-gov|-iso|-isob)?-[a-z]{2,12}-[0-9]{1,2}$/;
// What a CloudWatch Logs group's name may hold (AWS's own rule).
const LOG_GROUP_NAME_REGEX: RegExp = /^[A-Za-z0-9_./#-]{1,512}$/;
// Property paths of a stored copy never shown: an environment, a secret, a key.
const HIDDEN_PROPERTY_REGEX: RegExp =
  /environment|secret|passw|token|credential|privatekey|private_key|apikey|api_key|userdata|user_data/i;
// What a --filter may hold (the catalog's SearchText), kept as a second guard.
const SEARCH_TEXT_CHARACTERS: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _.:/@=,+#()-";

/*
 * The Service Quotas service codes a resource's service is counted under:
 * an Auto Scaling group's instances are EC2's, an ECS service's tasks are
 * ECS's and Fargate's. Any other service is asked by its own code.
 */
const QUOTA_SERVICE_CODES: Readonly<Record<string, ReadonlyArray<string>>> = {
  ec2: ["ec2"],
  autoscaling: ["ec2"],
  ecs: ["ecs", "fargate"],
  lambda: ["lambda"],
  rds: ["rds"],
  elasticloadbalancing: ["elasticloadbalancing"],
  sqs: ["sqs"],
};

// AWS's error codes that mean "no such resource", beyond a 404 and the *NotFound* family.
const NOT_FOUND_CODES: ReadonlyArray<string> = [
  "ResourceNotFoundException",
  "NoSuchResourceException",
  "QueueDoesNotExist",
  "AWS.SimpleQueueService.NonExistentQueue",
];

export interface AwsLiveReadInput {
  target: CloudLiveReadTarget;
  context: CloudLiveReadContext;
  credentials: AwsCredentials;
}

interface AwsLogEvent {
  timeMs: number;
  group: string;
  stream: string;
  message: string;
  id: string;
}

interface AwsLogGroup {
  name: string;
  region: string;
}

interface AwsQuota {
  serviceCode: string;
  code: string;
  name: string;
  value: number;
  unit: string;
  usage: number | null;
  metric: AwsMetricQuery | null;
}

// A number off AWS's JSON or XML text; null when it is none.
function readNumber(value: unknown): number | null {
  const numeric: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(numeric) ? numeric : null;
}

function isNotFoundCode(code: string): boolean {
  return (
    code.endsWith("NotFound") ||
    code.endsWith("NotFoundFault") ||
    code.endsWith("NotFoundException") ||
    code.endsWith(".NotFound") ||
    NOT_FOUND_CODES.includes(code)
  );
}

/*
 * A failure that says the resource is not there, as the sentence to say
 * ("AWS has no ECS cluster prod in us-east-1 ..."); null for any other.
 */
function notFoundIn(what: string): (error: LlmProviderError) => string | null {
  return (error: LlmProviderError): string | null => {
    const code: string = awsErrorCodeOf(error.responseBody || "");

    if (error.statusCode !== 404 && !isNotFoundCode(code)) {
      return null;
    }

    return `AWS has no ${what}${
      code ? ` (${liveText(code, 100)})` : ""
    }: it may have been deleted or renamed since OneUptime listed it.`;
  };
}

// The last segment of an ARN or path: "web:42" of ".../task-definition/web:42".
function lastSegment(value: string): string {
  const slash: number = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

// A JSON document AWS returns as a string (a queue's redrive policy), or {}.
function parseJsonText(value: unknown, maxLength: number = 10000): JSONObject {
  if (typeof value !== "string" || value.length > maxLength) {
    return {};
  }

  const trimmed: string = value.trim();

  if (!trimmed.startsWith("{")) {
    return {};
  }

  try {
    return readObject(JSON.parse(trimmed));
  } catch {
    return {};
  }
}

/*
 * A --filter as a CloudWatch Logs filter pattern: one quoted term, holding
 * only the characters the catalog lets the text hold (a second guard: the
 * catalog already refused anything else).
 */
export function toAwsFilterPattern(text: string): string {
  const kept: Array<string> = [];

  for (const char of text) {
    if (SEARCH_TEXT_CHARACTERS.includes(char)) {
      kept.push(char);
    }
  }

  return `"${kept.join("").trim()}"`;
}

// An answer's XML, read; "XML OneUptime could not read" when the reader refused it.
function readXmlAnswer(text: string, action: string): AwsXmlElement {
  try {
    return parseAwsXml(text);
  } catch (error) {
    if (error instanceof AwsXmlError) {
      throw new LlmProviderError({
        message: `AWS ${action} answered with XML OneUptime could not read: ${error.message}`,
        kind: CloudConnectionFailureKind.Other,
      });
    }

    throw error;
  }
}

export default class AwsLiveRead {
  private target: CloudLiveReadTarget;
  private context: CloudLiveReadContext;
  private credentials: AwsCredentials;
  private resource: ParsedCloudResource;
  private at: Date;
  private notes: Array<string> = [];

  private constructor(input: AwsLiveReadInput) {
    this.target = input.target;
    this.context = input.context;
    this.credentials = input.credentials;
    this.resource = input.target.resource;
    this.at = input.context.now();
  }

  // One read of the command's resource: the text the model reads.
  public static async read(input: AwsLiveReadInput): Promise<string> {
    return await new AwsLiveRead(input).run();
  }

  private async run(): Promise<string> {
    switch (this.target.command.operation.name) {
      case "describe":
        return await this.describe();
      case "recent-events":
        return await this.recentEvents();
      case "target-health":
        return await this.targetHealth();
      case "quota-usage":
        return await this.quotaUsage();
      case "read-logs":
        return await this.readLogs();
      default:
        throw new CloudLiveReadError({
          reason: "refused",
          message: `cloud ${this.target.command.operation.name} is not one of the reads OneUptime makes on AWS.`,
        });
    }
  }

  // ---- Calls ---------------------------------------------------------------

  private get id(): string {
    return this.resource.id;
  }

  private part(name: string): string {
    return this.resource.parts[name] || "";
  }

  // How the answer names the resource: "ECS service", "log group", "resource".
  private kindName(): string {
    const known: CloudResourceKindSpec | null = getCloudResourceKind(
      "aws",
      this.resource.kind,
    );

    if (known) {
      return known.displayName;
    }

    if (this.part("service") === "lambda" && this.part("functionName")) {
      return "Lambda function version";
    }

    if (this.logGroupOfArn()) {
      return "log group";
    }

    return "resource";
  }

  // The Region the resource is in, or null for a global one.
  private regionOrNull(): string | null {
    const region: string =
      this.resource.region || this.target.inventory?.region || "";

    return AWS_REGION_REGEX.test(region) ? region : null;
  }

  private requireRegion(): string {
    const region: string | null = this.regionOrNull();

    if (!region) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `${liveText(this.id, 200)} names no AWS Region, and cloud ${this.target.command.operation.name} reads one Region.`,
      });
    }

    return region;
  }

  private integerFlag(name: string, fallback: number): number {
    const value: number | null = getCloudIntegerFlag(this.target.command, name);
    return value === null ? fallback : value;
  }

  private textFlag(name: string): string {
    const value: CloudParamValue | undefined = this.target.command.flags[name];

    return typeof value === "string" ? value : "";
  }

  private secretValues(): Array<string> {
    return [
      this.credentials.secretAccessKey,
      ...(this.credentials.sessionToken ? [this.credentials.sessionToken] : []),
    ];
  }

  // A Query protocol call (EC2, RDS, Auto Scaling, ELB): its XML answer.
  private async query(data: {
    service: string;
    action: string;
    version: string;
    region: string;
    fields: Dictionary<string>;
    notFound?: ((error: LlmProviderError) => string | null) | undefined;
  }): Promise<AwsXmlElement> {
    const answer: { text: string } = await callCloud(
      {
        permission: `${data.service}:${data.action}`,
        notFound: data.notFound,
      },
      async (): Promise<{ text: string }> => {
        return await sendAwsRequest({
          transport: this.context.transport,
          credentials: this.credentials,
          service: data.service,
          region: data.region,
          body: {
            Action: data.action,
            Version: data.version,
            ...data.fields,
          },
          step: `${data.action} request in ${data.region}`,
          providerTitle: PROVIDER_TITLE,
          now: this.context.now,
          timeoutInMs: this.context.requestTimeoutInMs,
          sleep: this.context.sleep,
          budget: this.context.budget,
        });
      },
    );

    return readXmlAnswer(answer.text, data.action);
  }

  // A JSON protocol call (ECS, SQS, CloudTrail, Service Quotas, CloudWatch Logs).
  private async json(data: {
    service: string;
    region: string;
    target: string;
    jsonVersion: "1.0" | "1.1";
    body: JSONObject;
    permission: string;
    notFound?: ((error: LlmProviderError) => string | null) | undefined;
  }): Promise<JSONObject> {
    const answer: { json: JSONObject } = await callCloud(
      { permission: data.permission, notFound: data.notFound },
      async (): Promise<{ json: JSONObject }> => {
        return await sendAwsRequest({
          transport: this.context.transport,
          credentials: this.credentials,
          service: data.service,
          region: data.region,
          target: data.target,
          jsonVersion: data.jsonVersion,
          body: data.body,
          step: `${data.target.split(".").pop() || data.target} request in ${data.region}`,
          providerTitle: PROVIDER_TITLE,
          now: this.context.now,
          timeoutInMs: this.context.requestTimeoutInMs,
          sleep: this.context.sleep,
          budget: this.context.budget,
        });
      },
    );

    return answer.json;
  }

  /*
   * A REST call (Lambda): GET, signed here with the same Signature Version
   * 4 signer, the query in the signature, asked again when throttled.
   */
  private async restGet(data: {
    service: string;
    region: string;
    path: string;
    query?: Dictionary<string> | undefined;
    permission: string;
    step: string;
    notFound?: ((error: LlmProviderError) => string | null) | undefined;
  }): Promise<JSONObject> {
    const host: string = getAwsHost(data.service, data.region);
    const query: Dictionary<string> = data.query || {};
    const queryString: string = Object.keys(query)
      .sort()
      .map((name: string): string => {
        return `${AwsSecurityHubClient.uriEncode(name)}=${AwsSecurityHubClient.uriEncode(
          query[name] || "",
        )}`;
      })
      .join("&");
    const secrets: Array<string> = this.secretValues();

    return await callCloud(
      { permission: data.permission, notFound: data.notFound },
      async (): Promise<JSONObject> => {
        return await withCloudRetries({
          sleep: this.context.sleep,
          call: async (): Promise<JSONObject> => {
            if (!this.context.budget.take()) {
              throw new CloudReadBudgetSpent();
            }

            const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest(
              {
                method: "GET",
                host,
                path: data.path,
                query,
                headers: { Accept: "application/json" },
                body: "",
                accessKeyId: this.credentials.accessKeyId.trim(),
                secretAccessKey: this.credentials.secretAccessKey,
                sessionToken: this.credentials.sessionToken,
                region: data.region,
                service: data.service,
                date: this.context.now(),
              },
            );

            try {
              const response: DataSourceHttpResponse =
                await LlmProviderHttp.send({
                  transport: this.context.transport,
                  method: "GET",
                  url: `https://${host}${data.path}${queryString ? `?${queryString}` : ""}`,
                  headers: signed.headers,
                  timeoutInMs: this.context.requestTimeoutInMs,
                  step: data.step,
                  providerTitle: PROVIDER_TITLE,
                  secretValues: secrets,
                });

              return readObject(response.bodyJson);
            } catch (error) {
              throw classifyAwsError({
                error,
                step: data.step,
                providerTitle: PROVIDER_TITLE,
                secretValues: secrets,
              });
            }
          },
        });
      },
    );
  }

  private header(calls: Array<string>, subject: string): LiveReadText {
    return new LiveReadText(
      liveHeader({ cloud: "AWS", at: this.at, calls, subject }),
    );
  }

  private finish(text: LiveReadText): string {
    for (const note of this.notes) {
      text.note(note);
    }

    return text.toString();
  }

  // ---- describe -----------------------------------------------------------

  private async describe(): Promise<string> {
    switch (this.resource.kind) {
      case "ecs-service":
        return await this.describeEcsService();
      case "ec2-instance":
        return await this.describeEc2Instance();
      case "rds-instance":
        return await this.describeRdsInstance();
      case "rds-cluster":
        return await this.describeRdsCluster();
      case "autoscaling-group":
        return await this.describeAutoScalingGroup();
      case "lambda-function":
      case "lambda-alias":
        return await this.describeLambda();
      case "sqs-queue":
        return await this.describeSqsQueue();
      case "elb-target-group":
        return await this.describeTargetGroup();
      case "elb-load-balancer":
        return await this.describeLoadBalancer();
      default:
        // A Lambda function's version ARN (function:name:3) is read like its function.
        if (this.part("service") === "lambda" && this.part("functionName")) {
          return await this.describeLambda();
        }

        return this.describeStoredCopy();
    }
  }

  private async readEcsService(region: string): Promise<JSONObject> {
    const cluster: string = this.part("cluster");
    const name: string = this.part("name");
    const answer: JSONObject = await this.json({
      service: "ecs",
      region,
      target: `${ECS_TARGET_PREFIX}.DescribeServices`,
      jsonVersion: "1.1",
      body: { cluster, services: [name] },
      permission: "ecs:DescribeServices",
      notFound: notFoundIn(`ECS cluster ${cluster} in ${region}`),
    });

    const service: JSONObject | undefined = readArray(answer["services"])
      .map((raw: unknown): JSONObject => {
        return readObject(raw);
      })
      .find((candidate: JSONObject): boolean => {
        return readText(candidate["serviceName"]) === name;
      });

    if (!service) {
      const reason: string = readText(
        readObject(readArray(answer["failures"])[0])["reason"],
      );

      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no ECS service ${name} in cluster ${cluster} (${region})${
          reason ? ` (${liveText(reason, 100)})` : ""
        }: it may have been deleted or renamed since OneUptime listed it.`,
      });
    }

    return service;
  }

  private static ecsEvents(service: JSONObject): Array<{
    timeMs: number;
    message: string;
  }> {
    return readArray(service["events"])
      .map((raw: unknown): { timeMs: number; message: string } => {
        const event: JSONObject = readObject(raw);

        return {
          timeMs: readAwsTimestamp(event["createdAt"]),
          message: readText(event["message"]),
        };
      })
      .filter((event: { timeMs: number; message: string }): boolean => {
        return Number.isFinite(event.timeMs) && event.message.length > 0;
      })
      .sort((a: { timeMs: number }, b: { timeMs: number }): number => {
        return b.timeMs - a.timeMs;
      });
  }

  // "PRIMARY ecs-svc/1: task definition web:42, desired 4, running 3, ...".
  private static ecsDeployment(raw: unknown): string {
    const deployment: JSONObject = readObject(raw);
    const parts: Array<string> = [
      `task definition ${lastSegment(readText(deployment["taskDefinition"]))}`,
      `desired ${formatNumber(readNumber(deployment["desiredCount"]) ?? 0)}`,
      `running ${formatNumber(readNumber(deployment["runningCount"]) ?? 0)}`,
      `pending ${formatNumber(readNumber(deployment["pendingCount"]) ?? 0)}`,
    ];
    const failed: number | null = readNumber(deployment["failedTasks"]);
    const rollout: string = readText(deployment["rolloutState"]);
    const rolloutReason: string = readText(deployment["rolloutStateReason"]);
    const created: string = liveTime(readAwsTimestamp(deployment["createdAt"]));
    const updated: string = liveTime(readAwsTimestamp(deployment["updatedAt"]));

    if (failed) {
      parts.push(`failed tasks ${formatNumber(failed)}`);
    }

    if (rollout) {
      parts.push(
        `rollout ${rollout}${rolloutReason ? ` (${liveText(rolloutReason, 300)})` : ""}`,
      );
    }

    if (created) {
      parts.push(`created ${created}`);
    }

    if (updated) {
      parts.push(`updated ${updated}`);
    }

    return `${readText(deployment["status"]) || "deployment"} ${readText(
      deployment["id"],
    )}: ${parts.join(", ")}`;
  }

  private async describeEcsService(): Promise<string> {
    const region: string = this.requireRegion();
    const service: JSONObject = await this.readEcsService(region);
    const text: LiveReadText = this.header(
      ["ECS DescribeServices"],
      `ECS service ${this.id}`,
    );

    text.fact("status", service["status"]);
    text.fact(
      "tasks",
      `desired ${formatNumber(readNumber(service["desiredCount"]) ?? 0)}, running ${formatNumber(
        readNumber(service["runningCount"]) ?? 0,
      )}, pending ${formatNumber(readNumber(service["pendingCount"]) ?? 0)}`,
    );
    text.fact("task definition", service["taskDefinition"]);
    text.fact(
      "launch type",
      readText(service["launchType"]) ||
        readArray(service["capacityProviderStrategy"])
          .map((raw: unknown): string => {
            const strategy: JSONObject = readObject(raw);
            return `${readText(strategy["capacityProvider"])} weight ${formatNumber(
              readNumber(strategy["weight"]) ?? 0,
            )}`;
          })
          .join(", "),
    );
    text.fact("platform version", service["platformVersion"]);
    text.fact("scheduling", service["schedulingStrategy"]);

    const breaker: JSONObject = readObject(
      readObject(service["deploymentConfiguration"])[
        "deploymentCircuitBreaker"
      ],
    );

    if (typeof breaker["enable"] === "boolean") {
      text.fact(
        "deployment circuit breaker",
        breaker["enable"]
          ? `on${breaker["rollback"] === true ? ", rolls back a failed deployment" : ""}`
          : "off",
      );
    }

    const grace: number | null = readNumber(
      service["healthCheckGracePeriodSeconds"],
    );

    if (grace !== null) {
      text.fact("health check grace period", `${formatNumber(grace)}s`);
    }

    const loadBalancers: Array<unknown> = readArray(service["loadBalancers"]);
    text.list(
      "load balancers",
      loadBalancers.slice(0, DESCRIBE_MAX_ITEMS).map((raw: unknown): string => {
        const balancer: JSONObject = readObject(raw);
        return `${
          readText(balancer["targetGroupArn"]) ||
          readText(balancer["loadBalancerName"])
        } to container ${readText(balancer["containerName"])}:${formatNumber(
          readNumber(balancer["containerPort"]) ?? 0,
        )}`;
      }),
      { total: loadBalancers.length },
    );

    const deployments: Array<unknown> = readArray(service["deployments"]);
    text.list(
      "deployments",
      deployments.slice(0, DESCRIBE_MAX_ITEMS).map((raw: unknown): string => {
        return AwsLiveRead.ecsDeployment(raw);
      }),
      { total: deployments.length },
    );

    const events: Array<{ timeMs: number; message: string }> =
      AwsLiveRead.ecsEvents(service);
    text.list(
      "newest events",
      events
        .slice(0, DESCRIBE_MAX_EVENTS)
        .map((event: { timeMs: number; message: string }): string => {
          return `${liveTime(event.timeMs)} ${event.message}`;
        }),
      { total: events.length },
    );

    return this.finish(text);
  }

  private async describeEc2Instance(): Promise<string> {
    const region: string = this.requireRegion();
    const instanceId: string = this.part("instanceId");
    const root: AwsXmlElement = await this.query({
      service: "ec2",
      action: "DescribeInstances",
      version: EC2_VERSION,
      region,
      fields: { "InstanceId.1": instanceId },
      notFound: notFoundIn(`EC2 instance ${instanceId} in ${region}`),
    });

    let instance: AwsXmlElement | null = null;

    for (const reservation of xmlFind(root, "reservationSet")?.children || []) {
      for (const candidate of xmlList(reservation, "instancesSet")) {
        if (xmlText(candidate, "instanceId") === instanceId) {
          instance = candidate;
        }
      }
    }

    if (!instance) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no EC2 instance ${instanceId} in ${region}: it may have been terminated since OneUptime listed it.`,
      });
    }

    const status: AwsXmlElement | null = await readOptionalPart({
      what: "Status checks",
      notes: this.notes,
      setupHint: AWS_LIVE_READ_SETUP_HINT,
      call: async (): Promise<AwsXmlElement | null> => {
        const answer: AwsXmlElement = await this.query({
          service: "ec2",
          action: "DescribeInstanceStatus",
          version: EC2_VERSION,
          region,
          fields: { "InstanceId.1": instanceId, IncludeAllInstances: "true" },
        });

        return (
          xmlList(answer, "instanceStatusSet").find(
            (item: AwsXmlElement): boolean => {
              return xmlText(item, "instanceId") === instanceId;
            },
          ) || null
        );
      },
    });

    const tags: Dictionary<string> = {};

    for (const tag of xmlList(instance, "tagSet")) {
      const key: string = xmlText(tag, "key");

      if (key) {
        tags[key] = xmlText(tag, "value");
      }
    }

    const text: LiveReadText = this.header(
      status
        ? ["EC2 DescribeInstances", "DescribeInstanceStatus"]
        : ["EC2 DescribeInstances"],
      `EC2 instance ${this.id}`,
    );

    text.fact("name", tags["Name"]);
    text.fact(
      "state",
      `${xmlText(instance, "instanceState/name")}${
        xmlText(instance, "stateReason/message")
          ? ` (${xmlText(instance, "stateReason/message")})`
          : ""
      }`,
    );
    text.fact("state changed", xmlText(instance, "reason"));
    text.fact("instance type", xmlText(instance, "instanceType"));
    text.fact(
      "availability zone",
      xmlText(instance, "placement/availabilityZone"),
    );
    text.fact("launched", liveTime(xmlText(instance, "launchTime")));
    text.fact("lifecycle", xmlText(instance, "instanceLifecycle"));
    text.fact("private IP", xmlText(instance, "privateIpAddress"));
    text.fact("public IP", xmlText(instance, "ipAddress"));
    text.fact("image", xmlText(instance, "imageId"));
    text.fact("platform", xmlText(instance, "platformDetails"));
    text.fact("architecture", xmlText(instance, "architecture"));
    text.fact("VPC", xmlText(instance, "vpcId"));
    text.fact("subnet", xmlText(instance, "subnetId"));
    text.fact("detailed monitoring", xmlText(instance, "monitoring/state"));

    if (status) {
      const check: (path: string) => string = (path: string): string => {
        const failing: Array<string> = xmlList(status, `${path}/details`)
          .filter((detail: AwsXmlElement): boolean => {
            return xmlText(detail, "status") !== "passed";
          })
          .map((detail: AwsXmlElement): string => {
            const since: string = liveTime(xmlText(detail, "impairedSince"));
            return `${xmlText(detail, "name")} ${xmlText(detail, "status")}${
              since ? ` since ${since}` : ""
            }`;
          });

        return `${xmlText(status, `${path}/status`) || "unknown"}${
          failing.length > 0 ? ` (${failing.join(", ")})` : ""
        }`;
      };

      text.fact(
        "status checks",
        `system ${check("systemStatus")}, instance ${check("instanceStatus")}${
          xmlText(status, "attachedEbsStatus/status")
            ? `, attached EBS ${check("attachedEbsStatus")}`
            : ""
        }`,
      );
      text.list(
        "scheduled events",
        xmlList(status, "eventsSet").map((event: AwsXmlElement): string => {
          return `${xmlText(event, "code")}: ${xmlText(event, "description")}${
            xmlText(event, "notBefore")
              ? `, not before ${liveTime(xmlText(event, "notBefore"))}`
              : ""
          }`;
        }),
      );
    }

    text.list("tags", liveEntries(tags, MAX_TAGS), {
      total: Object.keys(tags).length,
    });

    return this.finish(text);
  }

  // The leaf values of an element as "name: value" items (pending modified values).
  private static leafValues(element: AwsXmlElement | null): Array<string> {
    return (element?.children || [])
      .filter((child: AwsXmlElement): boolean => {
        return child.children.length === 0 && child.text.length > 0;
      })
      .map((child: AwsXmlElement): string => {
        return `${child.name}: ${child.text}`;
      });
  }

  private async describeRdsInstance(): Promise<string> {
    const region: string = this.requireRegion();
    const name: string = this.part("name");
    const root: AwsXmlElement = await this.query({
      service: "rds",
      action: "DescribeDBInstances",
      version: RDS_VERSION,
      region,
      fields: { DBInstanceIdentifier: name },
      notFound: notFoundIn(`RDS instance ${name} in ${region}`),
    });
    const instance: AwsXmlElement | undefined = (xmlFind(root, "DBInstances")
      ?.children || [])[0];

    if (!instance) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no RDS instance ${name} in ${region}: it may have been deleted since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["RDS DescribeDBInstances"],
      `RDS instance ${this.id}`,
    );

    text.fact("status", xmlText(instance, "DBInstanceStatus"));
    text.fact("class", xmlText(instance, "DBInstanceClass"));
    text.fact(
      "engine",
      `${xmlText(instance, "Engine")} ${xmlText(instance, "EngineVersion")}`,
    );
    text.fact("Multi-AZ", xmlText(instance, "MultiAZ"));
    text.fact("availability zone", xmlText(instance, "AvailabilityZone"));
    text.fact(
      "standby availability zone",
      xmlText(instance, "SecondaryAvailabilityZone"),
    );
    text.fact(
      "endpoint",
      xmlText(instance, "Endpoint/Address")
        ? `${xmlText(instance, "Endpoint/Address")}:${xmlText(instance, "Endpoint/Port")}`
        : "",
    );
    text.fact(
      "storage",
      xmlText(instance, "AllocatedStorage")
        ? `${xmlText(instance, "StorageType")} ${xmlText(instance, "AllocatedStorage")} GiB${
            xmlText(instance, "Iops")
              ? `, ${xmlText(instance, "Iops")} IOPS`
              : ""
          }${
            xmlText(instance, "MaxAllocatedStorage")
              ? `, grows to ${xmlText(instance, "MaxAllocatedStorage")} GiB`
              : ""
          }`
        : "",
    );
    text.fact("cluster", xmlText(instance, "DBClusterIdentifier"));
    text.fact(
      "replica of",
      xmlText(instance, "ReadReplicaSourceDBInstanceIdentifier"),
    );
    text.list(
      "read replicas",
      xmlList(instance, "ReadReplicaDBInstanceIdentifiers").map(
        (replica: AwsXmlElement): string => {
          return replica.text;
        },
      ),
    );
    text.list(
      "status details",
      xmlList(instance, "StatusInfos").map((info: AwsXmlElement): string => {
        return `${xmlText(info, "StatusType")}: ${xmlText(info, "Status")}${
          xmlText(info, "Normal") === "false" ? " (not normal)" : ""
        }${xmlText(info, "Message") ? ` - ${xmlText(info, "Message")}` : ""}`;
      }),
    );
    text.list(
      "pending changes",
      AwsLiveRead.leafValues(xmlFind(instance, "PendingModifiedValues")),
    );
    text.fact("created", liveTime(xmlText(instance, "InstanceCreateTime")));
    text.fact(
      "latest restorable time",
      liveTime(xmlText(instance, "LatestRestorableTime")),
    );
    text.fact(
      "maintenance window",
      xmlText(instance, "PreferredMaintenanceWindow"),
    );
    text.fact("deletion protection", xmlText(instance, "DeletionProtection"));

    return this.finish(text);
  }

  private async describeRdsCluster(): Promise<string> {
    const region: string = this.requireRegion();
    const name: string = this.part("name");
    const root: AwsXmlElement = await this.query({
      service: "rds",
      action: "DescribeDBClusters",
      version: RDS_VERSION,
      region,
      fields: { DBClusterIdentifier: name },
      notFound: notFoundIn(`Aurora cluster ${name} in ${region}`),
    });
    const cluster: AwsXmlElement | undefined = (xmlFind(root, "DBClusters")
      ?.children || [])[0];

    if (!cluster) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no Aurora cluster ${name} in ${region}: it may have been deleted since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["RDS DescribeDBClusters"],
      `Aurora cluster ${this.id}`,
    );

    text.fact("status", xmlText(cluster, "Status"));
    text.fact(
      "engine",
      `${xmlText(cluster, "Engine")} ${xmlText(cluster, "EngineVersion")}${
        xmlText(cluster, "EngineMode")
          ? ` (${xmlText(cluster, "EngineMode")})`
          : ""
      }`,
    );
    text.fact("Multi-AZ", xmlText(cluster, "MultiAZ"));
    text.fact("writer endpoint", xmlText(cluster, "Endpoint"));
    text.fact("reader endpoint", xmlText(cluster, "ReaderEndpoint"));
    text.fact("port", xmlText(cluster, "Port"));

    const members: Array<AwsXmlElement> = xmlList(cluster, "DBClusterMembers");
    text.list(
      "members",
      members.map((member: AwsXmlElement): string => {
        return `${xmlText(member, "DBInstanceIdentifier")}: ${
          xmlText(member, "IsClusterWriter") === "true" ? "writer" : "reader"
        }${
          xmlText(member, "PromotionTier")
            ? `, promotion tier ${xmlText(member, "PromotionTier")}`
            : ""
        }`;
      }),
    );

    const scaling: string = xmlText(
      cluster,
      "ServerlessV2ScalingConfiguration/MinCapacity",
    );

    if (scaling) {
      text.fact(
        "Serverless v2 capacity",
        `${scaling} to ${xmlText(cluster, "ServerlessV2ScalingConfiguration/MaxCapacity")} ACUs`,
      );
    }

    text.fact("capacity", xmlText(cluster, "Capacity"));
    text.list(
      "availability zones",
      xmlList(cluster, "AvailabilityZones").map(
        (zone: AwsXmlElement): string => {
          return zone.text;
        },
      ),
    );
    text.list(
      "pending changes",
      AwsLiveRead.leafValues(xmlFind(cluster, "PendingModifiedValues")),
    );
    text.fact("created", liveTime(xmlText(cluster, "ClusterCreateTime")));
    text.fact(
      "latest restorable time",
      liveTime(xmlText(cluster, "LatestRestorableTime")),
    );

    return this.finish(text);
  }

  private async describeAutoScalingGroup(): Promise<string> {
    const region: string = this.requireRegion();
    const name: string = this.part("name");
    const root: AwsXmlElement = await this.query({
      service: "autoscaling",
      action: "DescribeAutoScalingGroups",
      version: AUTOSCALING_VERSION,
      region,
      fields: { "AutoScalingGroupNames.member.1": name },
    });
    const group: AwsXmlElement | undefined = (
      xmlFind(root, "AutoScalingGroups")?.children || []
    ).find((candidate: AwsXmlElement): boolean => {
      return xmlText(candidate, "AutoScalingGroupName") === name;
    });

    if (!group) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no Auto Scaling group ${name} in ${region}: it may have been deleted since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["Auto Scaling DescribeAutoScalingGroups"],
      `Auto Scaling group ${this.id}`,
    );

    text.fact(
      "capacity",
      `desired ${xmlText(group, "DesiredCapacity")}, minimum ${xmlText(
        group,
        "MinSize",
      )}, maximum ${xmlText(group, "MaxSize")}`,
    );
    text.fact("status", xmlText(group, "Status"));
    text.fact(
      "health check",
      xmlText(group, "HealthCheckType")
        ? `${xmlText(group, "HealthCheckType")}, grace period ${xmlText(
            group,
            "HealthCheckGracePeriod",
          )}s`
        : "",
    );
    text.fact(
      "launch template",
      xmlText(group, "LaunchTemplate/LaunchTemplateName")
        ? `${xmlText(group, "LaunchTemplate/LaunchTemplateName")} version ${xmlText(
            group,
            "LaunchTemplate/Version",
          )}`
        : xmlText(
            group,
            "MixedInstancesPolicy/LaunchTemplate/LaunchTemplateSpecification/LaunchTemplateName",
          ),
    );
    text.fact(
      "launch configuration",
      xmlText(group, "LaunchConfigurationName"),
    );
    text.list(
      "availability zones",
      xmlList(group, "AvailabilityZones").map((zone: AwsXmlElement): string => {
        return zone.text;
      }),
    );

    const targetGroups: Array<AwsXmlElement> = xmlList(
      group,
      "TargetGroupARNs",
    );
    text.list(
      "target groups",
      targetGroups
        .slice(0, DESCRIBE_MAX_ITEMS)
        .map((arn: AwsXmlElement): string => {
          return arn.text;
        }),
      { total: targetGroups.length },
    );

    const instances: Array<AwsXmlElement> = xmlList(group, "Instances");
    text.list(
      "instances",
      instances
        .slice(0, DESCRIBE_MAX_INSTANCES)
        .map((instance: AwsXmlElement): string => {
          return `${xmlText(instance, "InstanceId")} (${xmlText(
            instance,
            "AvailabilityZone",
          )}): ${xmlText(instance, "LifecycleState")}, ${xmlText(
            instance,
            "HealthStatus",
          )}${
            xmlText(instance, "ProtectedFromScaleIn") === "true"
              ? ", protected from scale-in"
              : ""
          }`;
        }),
      { total: instances.length },
    );
    text.list(
      "suspended processes",
      xmlList(group, "SuspendedProcesses").map(
        (process: AwsXmlElement): string => {
          return `${xmlText(process, "ProcessName")}${
            xmlText(process, "SuspensionReason")
              ? ` (${xmlText(process, "SuspensionReason")})`
              : ""
          }`;
        },
      ),
    );
    text.fact("created", liveTime(xmlText(group, "CreatedTime")));

    return this.finish(text);
  }

  // The version or alias a Lambda ARN names after the function, or "".
  private lambdaQualifier(): string {
    if (this.part("alias")) {
      return this.part("alias");
    }

    const marker: string = `:function:${this.part("functionName")}:`;
    const index: number = this.id.indexOf(marker);

    return index >= 0 ? this.id.slice(index + marker.length) : "";
  }

  private async readLambdaConfiguration(region: string): Promise<JSONObject> {
    const functionName: string = this.part("functionName");
    const qualifier: string = this.lambdaQualifier();

    return await this.restGet({
      service: "lambda",
      region,
      path: `/2015-03-31/functions/${functionName}/configuration`,
      query: qualifier ? { Qualifier: qualifier } : undefined,
      permission: "lambda:GetFunctionConfiguration",
      step: "GetFunctionConfiguration request",
      notFound: notFoundIn(
        `Lambda function ${functionName}${qualifier ? `:${qualifier}` : ""} in ${region}`,
      ),
    });
  }

  private async describeLambda(): Promise<string> {
    const region: string = this.requireRegion();
    const functionName: string = this.part("functionName");
    const alias: string = this.part("alias");
    const configuration: JSONObject =
      await this.readLambdaConfiguration(region);
    const calls: Array<string> = ["Lambda GetFunctionConfiguration"];

    const aliasAnswer: JSONObject | null = alias
      ? await this.restGet({
          service: "lambda",
          region,
          path: `/2015-03-31/functions/${functionName}/aliases/${alias}`,
          permission: "lambda:GetAlias",
          step: "GetAlias request",
          notFound: notFoundIn(
            `Lambda alias ${alias} of ${functionName} in ${region}`,
          ),
        })
      : null;

    if (aliasAnswer) {
      calls.push("GetAlias");
    }

    const concurrency: JSONObject | null = await readOptionalPart({
      what: "Reserved concurrency",
      notes: this.notes,
      setupHint: AWS_LIVE_READ_SETUP_HINT,
      call: async (): Promise<JSONObject> => {
        return await this.restGet({
          service: "lambda",
          region,
          path: `/2019-09-30/functions/${functionName}/concurrency`,
          permission: "lambda:GetFunctionConcurrency",
          step: "GetFunctionConcurrency request",
        });
      },
    });

    if (concurrency) {
      calls.push("GetFunctionConcurrency");
    }

    const text: LiveReadText = this.header(
      calls,
      `${alias ? "Lambda alias" : "Lambda function"} ${this.id}`,
    );

    if (aliasAnswer) {
      const weights: JSONObject = readObject(
        readObject(aliasAnswer["RoutingConfig"])["AdditionalVersionWeights"],
      );

      text.fact("alias points to version", aliasAnswer["FunctionVersion"]);
      text.fact(
        "alias also routes",
        Object.keys(weights)
          .slice(0, DESCRIBE_MAX_ITEMS)
          .map((version: string): string => {
            return `${Math.round((readNumber(weights[version]) ?? 0) * 1000) / 10}% to version ${version}`;
          })
          .join(", "),
      );
      text.fact("alias description", aliasAnswer["Description"]);
    }

    text.fact(
      "state",
      `${readText(configuration["State"])}${
        readText(configuration["StateReason"])
          ? ` (${readText(configuration["StateReasonCode"]) || "reason"}: ${readText(configuration["StateReason"])})`
          : ""
      }`,
    );
    text.fact(
      "last update",
      `${readText(configuration["LastUpdateStatus"])}${
        readText(configuration["LastUpdateStatusReason"])
          ? ` (${readText(configuration["LastUpdateStatusReason"])})`
          : ""
      }`,
    );
    text.fact(
      "runtime",
      readText(configuration["Runtime"]) ||
        (readText(configuration["PackageType"]) === "Image"
          ? "container image"
          : ""),
    );
    text.fact("handler", configuration["Handler"]);
    text.fact("version", configuration["Version"]);
    text.fact(
      "last modified",
      liveTime(readText(configuration["LastModified"])),
    );

    const memory: number | null = readNumber(configuration["MemorySize"]);
    const timeout: number | null = readNumber(configuration["Timeout"]);
    const storage: number | null = readNumber(
      readObject(configuration["EphemeralStorage"])["Size"],
    );

    text.fact("memory", memory !== null ? `${formatNumber(memory)} MB` : "");
    text.fact("timeout", timeout !== null ? `${formatNumber(timeout)}s` : "");
    text.fact(
      "ephemeral storage",
      storage !== null ? `${formatNumber(storage)} MB` : "",
    );
    text.fact(
      "architectures",
      readArray(configuration["Architectures"])
        .map((architecture: unknown): string => {
          return readText(architecture);
        })
        .join(", "),
    );
    text.fact(
      "code size",
      readNumber(configuration["CodeSize"]) !== null
        ? `${formatNumber(readNumber(configuration["CodeSize"]) ?? 0)} bytes`
        : "",
    );

    const layers: number = readArray(configuration["Layers"]).length;

    if (layers > 0) {
      text.fact("layers", String(layers));
    }

    const logging: JSONObject = readObject(configuration["LoggingConfig"]);
    text.fact(
      "log group",
      readText(logging["LogGroup"])
        ? `${readText(logging["LogGroup"])}${
            readText(logging["LogFormat"])
              ? ` (${readText(logging["LogFormat"])})`
              : ""
          }`
        : "",
    );

    const vpc: JSONObject = readObject(configuration["VpcConfig"]);
    text.fact(
      "VPC",
      readText(vpc["VpcId"])
        ? `${readText(vpc["VpcId"])}, ${readArray(vpc["SubnetIds"]).length} subnets`
        : "",
    );
    text.fact(
      "dead-letter target",
      readObject(configuration["DeadLetterConfig"])["TargetArn"],
    );
    text.fact("tracing", readObject(configuration["TracingConfig"])["Mode"]);

    if (concurrency) {
      const reserved: number | null = readNumber(
        concurrency["ReservedConcurrentExecutions"],
      );

      text.fact(
        "reserved concurrency",
        reserved !== null
          ? formatNumber(reserved)
          : "none (it runs on the account's unreserved concurrency)",
      );
    }

    return this.finish(text);
  }

  private async describeSqsQueue(): Promise<string> {
    const region: string = this.requireRegion();
    const queueName: string = this.part("queueName");
    const accountId: string = this.resource.accountId || this.target.accountId;
    const answer: JSONObject = await this.json({
      service: "sqs",
      region,
      target: SQS_GET_ATTRIBUTES_TARGET,
      jsonVersion: "1.0",
      body: {
        QueueUrl: `https://${getAwsHost("sqs", region)}/${accountId}/${queueName}`,
        AttributeNames: ["All"],
      },
      permission: "sqs:GetQueueAttributes",
      notFound: notFoundIn(`SQS queue ${queueName} in ${region}`),
    });
    const attributes: JSONObject = readObject(answer["Attributes"]);
    const seconds: (key: string) => string = (key: string): string => {
      const value: number | null = readNumber(attributes[key]);
      return value !== null ? `${formatNumber(value)}s` : "";
    };
    const timestamp: (key: string) => string = (key: string): string => {
      const value: number | null = readNumber(attributes[key]);
      return value !== null ? liveTime(value * 1000) : "";
    };

    const text: LiveReadText = this.header(
      ["SQS GetQueueAttributes"],
      `SQS queue ${this.id}`,
    );

    text.fact(
      "messages",
      `visible ${readText(attributes["ApproximateNumberOfMessages"]) || "0"}, in flight ${
        readText(attributes["ApproximateNumberOfMessagesNotVisible"]) || "0"
      }, delayed ${readText(attributes["ApproximateNumberOfMessagesDelayed"]) || "0"}`,
    );
    text.fact("visibility timeout", seconds("VisibilityTimeout"));
    text.fact("retention", seconds("MessageRetentionPeriod"));
    text.fact("delivery delay", seconds("DelaySeconds"));
    text.fact("receive wait", seconds("ReceiveMessageWaitTimeSeconds"));
    text.fact(
      "largest message",
      readText(attributes["MaximumMessageSize"])
        ? `${readText(attributes["MaximumMessageSize"])} bytes`
        : "",
    );

    if (readText(attributes["FifoQueue"]) === "true") {
      text.fact(
        "FIFO",
        `yes${
          readText(attributes["ContentBasedDeduplication"]) === "true"
            ? ", content-based deduplication"
            : ""
        }`,
      );
    }

    const redrive: JSONObject = parseJsonText(attributes["RedrivePolicy"]);
    text.fact(
      "dead-letter queue",
      readText(redrive["deadLetterTargetArn"])
        ? `${readText(redrive["deadLetterTargetArn"])} after ${formatNumber(
            readNumber(redrive["maxReceiveCount"]) ?? 0,
          )} receives`
        : "",
    );

    const allow: JSONObject = parseJsonText(attributes["RedriveAllowPolicy"]);
    text.fact(
      "may be a dead-letter queue for",
      readText(allow["redrivePermission"])
        ? `${readText(allow["redrivePermission"])}${
            readArray(allow["sourceQueueArns"]).length > 0
              ? ` (${readArray(allow["sourceQueueArns"]).length} queues)`
              : ""
          }`
        : "",
    );
    text.fact(
      "encryption",
      readText(attributes["KmsMasterKeyId"])
        ? "a KMS key"
        : readText(attributes["SqsManagedSseEnabled"]) === "true"
          ? "SQS-managed"
          : "",
    );
    text.fact("created", timestamp("CreatedTimestamp"));
    text.fact("last changed", timestamp("LastModifiedTimestamp"));

    return this.finish(text);
  }

  private async readTargetGroups(
    region: string,
    fields: Dictionary<string>,
    what: string,
  ): Promise<Array<AwsXmlElement>> {
    const root: AwsXmlElement = await this.query({
      service: "elasticloadbalancing",
      action: "DescribeTargetGroups",
      version: ELB_VERSION,
      region,
      fields,
      notFound: notFoundIn(what),
    });

    return xmlFind(root, "TargetGroups")?.children || [];
  }

  private async describeTargetGroup(): Promise<string> {
    const region: string = this.requireRegion();
    const group: AwsXmlElement | undefined = (
      await this.readTargetGroups(
        region,
        { "TargetGroupArns.member.1": this.id },
        `target group ${this.part("name")} in ${region}`,
      )
    )[0];

    if (!group) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no target group ${this.part("name")} in ${region}: it may have been deleted since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["ELB DescribeTargetGroups"],
      `target group ${this.id}`,
    );

    text.fact("name", xmlText(group, "TargetGroupName"));
    text.fact(
      "protocol",
      `${xmlText(group, "Protocol")} ${xmlText(group, "Port")}${
        xmlText(group, "ProtocolVersion")
          ? ` (${xmlText(group, "ProtocolVersion")})`
          : ""
      }`,
    );
    text.fact("target type", xmlText(group, "TargetType"));
    text.fact("VPC", xmlText(group, "VpcId"));
    text.fact(
      "health check",
      `${xmlText(group, "HealthCheckEnabled") === "false" ? "off; " : ""}${xmlText(
        group,
        "HealthCheckProtocol",
      )} port ${xmlText(group, "HealthCheckPort")}${
        xmlText(group, "HealthCheckPath")
          ? ` ${xmlText(group, "HealthCheckPath")}`
          : ""
      } every ${xmlText(group, "HealthCheckIntervalSeconds")}s, timeout ${xmlText(
        group,
        "HealthCheckTimeoutSeconds",
      )}s, healthy after ${xmlText(group, "HealthyThresholdCount")}, unhealthy after ${xmlText(
        group,
        "UnhealthyThresholdCount",
      )}${
        xmlText(group, "Matcher/HttpCode")
          ? `, expects ${xmlText(group, "Matcher/HttpCode")}`
          : xmlText(group, "Matcher/GrpcCode")
            ? `, expects gRPC ${xmlText(group, "Matcher/GrpcCode")}`
            : ""
      }`,
    );
    text.list(
      "load balancers",
      xmlList(group, "LoadBalancerArns").map((arn: AwsXmlElement): string => {
        return arn.text;
      }),
    );

    return this.finish(text);
  }

  private async describeLoadBalancer(): Promise<string> {
    const region: string = this.requireRegion();
    const root: AwsXmlElement = await this.query({
      service: "elasticloadbalancing",
      action: "DescribeLoadBalancers",
      version: ELB_VERSION,
      region,
      fields: { "LoadBalancerArns.member.1": this.id },
      notFound: notFoundIn(`load balancer ${this.part("name")} in ${region}`),
    });
    const balancer: AwsXmlElement | undefined = (xmlFind(root, "LoadBalancers")
      ?.children || [])[0];

    if (!balancer) {
      throw new CloudLiveReadError({
        reason: "not-found",
        message: `AWS has no load balancer ${this.part("name")} in ${region}: it may have been deleted since OneUptime listed it.`,
      });
    }

    const text: LiveReadText = this.header(
      ["ELB DescribeLoadBalancers"],
      `load balancer ${this.id}`,
    );

    text.fact("name", xmlText(balancer, "LoadBalancerName"));
    text.fact("type", xmlText(balancer, "Type"));
    text.fact("scheme", xmlText(balancer, "Scheme"));
    text.fact(
      "state",
      `${xmlText(balancer, "State/Code")}${
        xmlText(balancer, "State/Reason")
          ? ` (${xmlText(balancer, "State/Reason")})`
          : ""
      }`,
    );
    text.fact("DNS name", xmlText(balancer, "DNSName"));
    text.fact("VPC", xmlText(balancer, "VpcId"));
    text.fact("IP address type", xmlText(balancer, "IpAddressType"));
    text.list(
      "availability zones",
      xmlList(balancer, "AvailabilityZones").map(
        (zone: AwsXmlElement): string => {
          return `${xmlText(zone, "ZoneName")}${
            xmlText(zone, "SubnetId") ? ` (${xmlText(zone, "SubnetId")})` : ""
          }`;
        },
      ),
    );
    text.fact("created", liveTime(xmlText(balancer, "CreatedTime")));

    return this.finish(text);
  }

  // Not live: what the account's inventory last listed of the resource.
  private describeStoredCopy(): string {
    const inventory: CloudLiveReadTarget["inventory"] = this.target.inventory;

    if (!inventory) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `cloud describe reads ${LIVE_DESCRIBE_KINDS} live on AWS, and OneUptime holds no stored copy of ${liveText(
          this.id,
          200,
        )} either: the account's inventory does not list it.`,
      });
    }

    const listedAt: string = liveTime(inventory.inventoriedAt);
    const text: LiveReadText = new LiveReadText(
      `NOT LIVE: OneUptime's stored copy of ${liveText(this.id, 1000)}${
        inventory.resourceType
          ? ` (${liveText(inventory.resourceType, 200)})`
          : ""
      }, as the account's inventory ${
        listedAt
          ? `listed it at ${listedAt}`
          : "holds it (it has not been listed)"
      }. cloud describe reads only ${LIVE_DESCRIBE_KINDS} live on AWS.`,
    );

    /*
     * The inventory keeps no property that can hold a secret; a path that
     * names an environment, a secret or a key is left out here as well, so
     * the copy never depends on that alone.
     */
    const properties: JSONObject = {};

    for (const path of Object.keys(inventory.properties || {})) {
      if (!HIDDEN_PROPERTY_REGEX.test(path)) {
        properties[path] = inventory.properties[path] ?? null;
      }
    }

    text.fact("name", inventory.name);
    text.fact("region", inventory.region);
    text.list("properties", liveEntries(properties, 50), {
      total: Object.keys(properties).length,
    });
    text.list("tags", liveEntries(inventory.tags, MAX_TAGS), {
      total: Object.keys(inventory.tags || {}).length,
    });

    return text.toString();
  }

  // ---- recent-events ------------------------------------------------------

  private async recentEvents(): Promise<string> {
    const hours: number = this.integerFlag("hours", CLOUD_DEFAULT_EVENT_HOURS);
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const start: Date = new Date(this.at.getTime() - hours * HOUR_MS);
    const span: string = `in the last ${hours} hour${hours === 1 ? "" : "s"}`;

    switch (this.resource.kind) {
      case "ecs-service":
        return await this.ecsServiceEvents({ start, limit, span });
      case "rds-instance":
      case "rds-cluster":
        return await this.rdsEvents({ start, limit, span });
      case "autoscaling-group":
        return await this.scalingActivities({ start, limit, span });
      default:
        return await this.trailEvents({ start, limit, span });
    }
  }

  private async ecsServiceEvents(data: {
    start: Date;
    limit: number;
    span: string;
  }): Promise<string> {
    const region: string = this.requireRegion();
    const service: JSONObject = await this.readEcsService(region);
    const events: Array<{ timeMs: number; message: string }> =
      AwsLiveRead.ecsEvents(service).filter(
        (event: { timeMs: number }): boolean => {
          return event.timeMs >= data.start.getTime();
        },
      );
    const text: LiveReadText = this.header(
      ["ECS DescribeServices"],
      `what ECS did to ECS service ${this.id} ${data.span}, newest first`,
    );

    text.list(
      "events",
      events
        .slice(0, data.limit)
        .map((event: { timeMs: number; message: string }): string => {
          return `${liveTime(event.timeMs)} ${event.message}`;
        }),
      { total: events.length, empty: `none ${data.span}` },
    );
    text.list(
      "deployments now",
      readArray(service["deployments"])
        .slice(0, DESCRIBE_MAX_ITEMS)
        .map((raw: unknown): string => {
          return AwsLiveRead.ecsDeployment(raw);
        }),
    );

    return this.finish(text);
  }

  private async rdsEvents(data: {
    start: Date;
    limit: number;
    span: string;
  }): Promise<string> {
    const region: string = this.requireRegion();
    const name: string = this.part("name");
    const isCluster: boolean = this.resource.kind === "rds-cluster";
    const events: Array<{ timeMs: number; text: string }> = [];
    let marker: string = "";

    for (let page: number = 0; page < MAX_EVENT_PAGES; page++) {
      const fields: Dictionary<string> = {
        SourceIdentifier: name,
        SourceType: isCluster ? "db-cluster" : "db-instance",
        StartTime: data.start.toISOString(),
        EndTime: this.at.toISOString(),
        MaxRecords: "100",
      };

      if (marker) {
        fields["Marker"] = marker;
      }

      const root: AwsXmlElement = await this.query({
        service: "rds",
        action: "DescribeEvents",
        version: RDS_VERSION,
        region,
        fields,
      });

      for (const event of xmlFind(root, "Events")?.children || []) {
        const timeMs: number = Date.parse(xmlText(event, "Date"));
        const categories: string = xmlList(event, "EventCategories")
          .map((category: AwsXmlElement): string => {
            return category.text;
          })
          .join(", ");

        if (Number.isFinite(timeMs)) {
          events.push({
            timeMs,
            text: `${liveTime(timeMs)}${categories ? ` [${categories}]` : ""} ${xmlText(
              event,
              "Message",
            )}`,
          });
        }
      }

      const next: string = xmlText(
        xmlFind(root, "DescribeEventsResult"),
        "Marker",
      );

      if (!next || next === marker) {
        break;
      }

      marker = next;
    }

    events.sort((a: { timeMs: number }, b: { timeMs: number }): number => {
      return b.timeMs - a.timeMs;
    });

    const text: LiveReadText = this.header(
      ["RDS DescribeEvents"],
      `RDS events of ${isCluster ? "Aurora cluster" : "RDS instance"} ${this.id} ${data.span}, newest first`,
    );

    text.list(
      "events",
      events.slice(0, data.limit).map((event: { text: string }): string => {
        return event.text;
      }),
      { total: events.length, empty: `none ${data.span}` },
    );

    return this.finish(text);
  }

  private async scalingActivities(data: {
    start: Date;
    limit: number;
    span: string;
  }): Promise<string> {
    const region: string = this.requireRegion();
    const activities: Array<string> = [];
    let token: string = "";
    let reachedStart: boolean = false;

    for (
      let page: number = 0;
      page < MAX_EVENT_PAGES && activities.length < data.limit && !reachedStart;
      page++
    ) {
      const fields: Dictionary<string> = {
        AutoScalingGroupName: this.part("name"),
        MaxRecords: String(Math.min(100, data.limit)),
      };

      if (token) {
        fields["NextToken"] = token;
      }

      const root: AwsXmlElement = await this.query({
        service: "autoscaling",
        action: "DescribeScalingActivities",
        version: AUTOSCALING_VERSION,
        region,
        fields,
      });

      // Newest first, as Auto Scaling lists them.
      for (const activity of xmlFind(root, "Activities")?.children || []) {
        const startedMs: number = Date.parse(xmlText(activity, "StartTime"));

        if (Number.isFinite(startedMs) && startedMs < data.start.getTime()) {
          reachedStart = true;
          break;
        }

        if (activities.length >= data.limit) {
          break;
        }

        activities.push(
          `${liveTime(startedMs)} ${xmlText(activity, "StatusCode")}: ${xmlText(
            activity,
            "Description",
          )}${
            xmlText(activity, "StatusMessage")
              ? ` (${xmlText(activity, "StatusMessage")})`
              : ""
          }${xmlText(activity, "Cause") ? `. Cause: ${xmlText(activity, "Cause")}` : ""}`,
        );
      }

      const next: string = xmlText(
        xmlFind(root, "DescribeScalingActivitiesResult"),
        "NextToken",
      );

      if (!next || next === token) {
        break;
      }

      token = next;
    }

    const text: LiveReadText = this.header(
      ["Auto Scaling DescribeScalingActivities"],
      `scaling activities of Auto Scaling group ${this.id} ${data.span}, newest first`,
    );

    text.list("activities", activities, { empty: `none ${data.span}` });

    return this.finish(text);
  }

  // The names a resource's CloudTrail events may give it: its ARN, then its short name.
  private trailNames(): Array<string> {
    const short: string =
      this.part("instanceId") ||
      this.part("functionName") ||
      this.part("queueName") ||
      this.part("name") ||
      this.target.inventory?.name ||
      lastSegment(this.id.split(":").pop() || "");

    return short && short !== this.id ? [this.id, short] : [this.id];
  }

  private async trailEvents(data: {
    start: Date;
    limit: number;
    span: string;
  }): Promise<string> {
    // A global resource's events are recorded in us-east-1.
    const region: string = this.regionOrNull() || "us-east-1";
    const kept: Array<string> = [];
    const seen: Set<string> = new Set<string>();
    let lookedUpBy: string = "";

    for (const name of this.trailNames()) {
      lookedUpBy = name;
      let token: string = "";

      for (
        let page: number = 0;
        page < MAX_TRAIL_PAGES && kept.length < data.limit;
        page++
      ) {
        const body: JSONObject = {
          LookupAttributes: [
            { AttributeKey: "ResourceName", AttributeValue: name },
          ],
          StartTime: Math.floor(data.start.getTime() / 1000),
          EndTime: Math.ceil(this.at.getTime() / 1000),
          MaxResults: 50,
        };

        if (token) {
          body["NextToken"] = token;
        }

        const answer: JSONObject = await this.json({
          service: "cloudtrail",
          region,
          target: CLOUDTRAIL_LOOKUP_TARGET,
          jsonVersion: "1.1",
          body,
          permission: "cloudtrail:LookupEvents",
        });

        for (const raw of readArray(answer["Events"])) {
          const line: string | null = AwsLiveRead.trailEvent(
            readObject(raw),
            seen,
          );

          if (line && kept.length < data.limit) {
            kept.push(line);
          }
        }

        const next: string = readText(answer["NextToken"]);

        if (!next || next === token) {
          break;
        }

        token = next;
      }

      if (kept.length > 0) {
        break;
      }
    }

    const text: LiveReadText = this.header(
      ["CloudTrail LookupEvents"],
      `what was done to ${this.id} ${data.span} (CloudTrail management events naming ${liveText(
        lookedUpBy,
        300,
      )}), newest first`,
    );

    text.list("events", kept, { empty: `none ${data.span}` });

    return this.finish(text);
  }

  /*
   * One CloudTrail event as a line, or null for a read (Describe, Get,
   * List) or machinery. Of its document only readOnly and the error code
   * are read.
   */
  private static trailEvent(
    event: JSONObject,
    seen: Set<string>,
  ): string | null {
    const id: string = readText(event["EventId"]);
    const name: string = readText(event["EventName"]);
    const source: string = readText(event["EventSource"]);

    if (!name || (id && seen.has(id)) || isAwsChangeNoise(source, name)) {
      return null;
    }

    if (id) {
      seen.add(id);
    }

    const document: JSONObject = parseJsonText(
      event["CloudTrailEvent"],
      MAX_TRAIL_EVENT_LENGTH,
    );

    if (document["readOnly"] === true) {
      return null;
    }

    const errorCode: string = readText(document["errorCode"]);
    const user: string = readText(event["Username"]);

    return `${liveTime(readAwsTimestamp(event["EventTime"]))} ${awsOperationOf(
      source,
      name,
    )}${user ? ` by ${user}` : ""}${errorCode ? `, failed: ${errorCode}` : ""}`;
  }

  // ---- target-health ------------------------------------------------------

  private async readTargetHealth(
    region: string,
    targetGroupArn: string,
  ): Promise<{ lines: Array<string>; total: number; summary: string }> {
    const root: AwsXmlElement = await this.query({
      service: "elasticloadbalancing",
      action: "DescribeTargetHealth",
      version: ELB_VERSION,
      region,
      fields: { TargetGroupArn: targetGroupArn },
      notFound: notFoundIn(
        `target group ${lastSegment(targetGroupArn)} in ${region}`,
      ),
    });
    const descriptions: Array<AwsXmlElement> =
      xmlFind(root, "TargetHealthDescriptions")?.children || [];
    const counts: Map<string, number> = new Map<string, number>();

    for (const description of descriptions) {
      const state: string =
        xmlText(description, "TargetHealth/State") || "unknown";
      counts.set(state, (counts.get(state) || 0) + 1);
    }

    return {
      total: descriptions.length,
      summary: Array.from(counts.entries())
        .sort((a: [string, number], b: [string, number]): number => {
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        })
        .map(([state, count]: [string, number]): string => {
          return `${state} ${count}`;
        })
        .join(", "),
      lines: descriptions
        .slice(0, MAX_TARGETS_PER_GROUP)
        .map((description: AwsXmlElement): string => {
          const port: string = xmlText(description, "Target/Port");
          const zone: string = xmlText(description, "Target/AvailabilityZone");
          const reason: string = xmlText(description, "TargetHealth/Reason");
          const why: string = xmlText(description, "TargetHealth/Description");

          return `${xmlText(description, "Target/Id")}${port ? `:${port}` : ""}${
            zone ? ` (${zone})` : ""
          }: ${xmlText(description, "TargetHealth/State") || "unknown"}${
            reason ? ` - ${reason}` : ""
          }${why ? `: ${why}` : ""}`;
        }),
    };
  }

  private async targetHealth(): Promise<string> {
    const region: string = this.requireRegion();

    if (this.resource.kind === "elb-target-group") {
      const health: { lines: Array<string>; total: number; summary: string } =
        await this.readTargetHealth(region, this.id);
      const text: LiveReadText = this.header(
        ["ELB DescribeTargetHealth"],
        `target health of target group ${this.id}`,
      );

      text.fact(
        "summary",
        health.total > 0 ? `${health.total} targets: ${health.summary}` : "",
      );
      text.list("targets", health.lines, {
        total: health.total,
        empty: "none registered",
      });

      return this.finish(text);
    }

    const groups: Array<AwsXmlElement> = await this.readTargetGroups(
      region,
      { LoadBalancerArn: this.id },
      `load balancer ${this.part("name")} in ${region}`,
    );
    const text: LiveReadText = this.header(
      ["ELB DescribeTargetGroups", "DescribeTargetHealth"],
      `target health of load balancer ${this.id}`,
    );

    if (groups.length === 0) {
      text.line(
        "target groups: none (the load balancer forwards to no target group)",
      );
    }

    for (const group of groups.slice(0, MAX_TARGET_GROUPS)) {
      const arn: string = xmlText(group, "TargetGroupArn");
      const health: { lines: Array<string>; total: number; summary: string } =
        await this.readTargetHealth(region, arn);

      text.list(
        `target group ${liveText(xmlText(group, "TargetGroupName"), 100)} (${liveText(
          `${xmlText(group, "Protocol")} ${xmlText(group, "Port")}`,
          50,
        )}${health.total > 0 ? `; ${liveText(health.summary, 200)}` : ""})`,
        health.lines,
        { total: health.total, empty: "no targets registered" },
      );
    }

    if (groups.length > MAX_TARGET_GROUPS) {
      this.notes.push(
        `The load balancer has ${groups.length} target groups; the first ${MAX_TARGET_GROUPS} were read.`,
      );
    }

    return this.finish(text);
  }

  // ---- quota-usage ----------------------------------------------------------

  private async listQuotas(
    region: string,
    serviceCode: string,
  ): Promise<Array<AwsQuota>> {
    const quotas: Array<AwsQuota> = [];
    let token: string = "";

    for (let page: number = 0; page < MAX_QUOTA_PAGES; page++) {
      const body: JSONObject = { ServiceCode: serviceCode, MaxResults: 100 };

      if (token) {
        body["NextToken"] = token;
      }

      const answer: JSONObject = await this.json({
        service: "servicequotas",
        region,
        target: SERVICE_QUOTAS_TARGET,
        jsonVersion: "1.1",
        body,
        permission: "servicequotas:ListServiceQuotas",
        notFound: (error: LlmProviderError): string | null => {
          return awsErrorCodeOf(error.responseBody || "") ===
            "NoSuchResourceException"
            ? `Service Quotas has no quotas for the service ${serviceCode} in ${region}.`
            : null;
        },
      });

      for (const raw of readArray(answer["Quotas"])) {
        const quota: JSONObject = readObject(raw);
        const value: number | null = readNumber(quota["Value"]);
        const metric: JSONObject = readObject(quota["UsageMetric"]);
        const dimensions: JSONObject = readObject(metric["MetricDimensions"]);

        if (value === null) {
          continue;
        }

        quotas.push({
          serviceCode: readText(quota["ServiceCode"]) || serviceCode,
          code: readText(quota["QuotaCode"]),
          name: readText(quota["QuotaName"]),
          value,
          unit: readText(quota["Unit"]),
          usage: null,
          metric:
            readText(metric["MetricNamespace"]) &&
            readText(metric["MetricName"])
              ? {
                  // Numbered across every service code once all are listed.
                  id: "",
                  namespace: readText(metric["MetricNamespace"]),
                  metricName: readText(metric["MetricName"]),
                  dimensions: Object.keys(dimensions)
                    .sort()
                    .map((name: string): { name: string; value: string } => {
                      return { name, value: readText(dimensions[name]) };
                    }),
                  statistic: "Maximum",
                  periodSeconds: 300,
                }
              : null,
        });
      }

      const next: string = readText(answer["NextToken"]);

      if (!next || next === token) {
        break;
      }

      token = next;
    }

    return quotas;
  }

  private async quotaUsage(): Promise<string> {
    const region: string = this.requireRegion();
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const service: string = this.part("service");
    const codes: ReadonlyArray<string> = QUOTA_SERVICE_CODES[service] || [
      service,
    ];
    const quotas: Array<AwsQuota> = [];

    for (const code of codes) {
      for (const quota of await this.listQuotas(region, code)) {
        if (quota.metric) {
          quota.metric.id = `q${quotas.length}`;
        }

        quotas.push(quota);
      }
    }

    const queries: Array<AwsMetricQuery> = quotas
      .map((quota: AwsQuota): AwsMetricQuery | null => {
        return quota.metric;
      })
      .filter((query: AwsMetricQuery | null): query is AwsMetricQuery => {
        return query !== null;
      });
    const calls: Array<string> = ["Service Quotas ListServiceQuotas"];

    if (queries.length > 0) {
      const results: Array<AwsMetricResult> | null = await readOptionalPart({
        what: "Quota usage",
        notes: this.notes,
        setupHint: AWS_LIVE_READ_SETUP_HINT,
        call: async (): Promise<Array<AwsMetricResult>> => {
          return await callCloud(
            { permission: "cloudwatch:GetMetricData" },
            async (): Promise<Array<AwsMetricResult>> => {
              return await getMetricData(
                {
                  transport: this.context.transport,
                  credentials: this.credentials,
                  region,
                  now: this.context.now,
                  timeoutInMs: this.context.requestTimeoutInMs,
                  sleep: this.context.sleep,
                  budget: this.context.budget,
                },
                {
                  queries,
                  startTime: new Date(this.at.getTime() - HOUR_MS),
                  endTime: this.at,
                },
              );
            },
          );
        },
      });

      if (results) {
        calls.push("CloudWatch GetMetricData");
        const byId: Map<string, number> = new Map<string, number>();

        for (const result of results) {
          byId.set(result.id, Math.max(...result.values));
        }

        for (const quota of quotas) {
          const used: number | undefined = quota.metric
            ? byId.get(quota.metric.id)
            : undefined;

          if (used !== undefined && Number.isFinite(used)) {
            quota.usage = used;
          }
        }
      }
    }

    const ratio: (quota: AwsQuota) => number = (quota: AwsQuota): number => {
      return quota.usage !== null && quota.value > 0
        ? quota.usage / quota.value
        : -1;
    };

    quotas.sort((a: AwsQuota, b: AwsQuota): number => {
      const difference: number = ratio(b) - ratio(a);

      if (difference !== 0) {
        return difference;
      }

      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    const text: LiveReadText = this.header(
      calls,
      `the ${codes.join(" and ")} service quotas in ${region}, for ${this.kindName()} ${this.id}, highest usage first`,
    );

    text.list(
      "quotas",
      quotas.slice(0, limit).map((quota: AwsQuota): string => {
        const label: string = `${quota.name} (${quota.serviceCode} ${quota.code})`;

        return quota.usage !== null
          ? `${label}: ${liveUsage(quota.usage, quota.value, quota.unit)}`
          : `${label}: limit ${formatNumber(quota.value)}${
              quota.unit && quota.unit !== "None" ? ` ${quota.unit}` : ""
            }${quota.metric ? ", no usage in the last hour" : ", usage not reported"}`;
      }),
      {
        total: quotas.length,
        empty: `none: Service Quotas lists no applied quotas for ${codes.join(" or ")} in ${region}`,
      },
    );

    return this.finish(text);
  }

  // ---- read-logs ------------------------------------------------------------

  private async lambdaLogGroups(): Promise<Array<AwsLogGroup>> {
    const region: string = this.requireRegion();
    const fallback: string = `/aws/lambda/${this.part("functionName")}`;
    const configuration: JSONObject | null = await readOptionalPart({
      what: "The function's own log group setting",
      notes: this.notes,
      setupHint: AWS_LIVE_READ_SETUP_HINT,
      call: async (): Promise<JSONObject> => {
        return await this.readLambdaConfiguration(region);
      },
    });
    const configured: string = readText(
      readObject(configuration?.["LoggingConfig"])["LogGroup"],
    );

    return [
      {
        name: LOG_GROUP_NAME_REGEX.test(configured) ? configured : fallback,
        region,
      },
    ];
  }

  private async ecsLogGroups(): Promise<Array<AwsLogGroup>> {
    const region: string = this.requireRegion();
    const service: JSONObject = await this.readEcsService(region);
    const taskDefinition: string = readText(service["taskDefinition"]);

    if (!taskDefinition) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `ECS service ${this.part("name")} names no task definition, so it has no log groups to read.`,
      });
    }

    const answer: JSONObject = await this.json({
      service: "ecs",
      region,
      target: `${ECS_TARGET_PREFIX}.DescribeTaskDefinition`,
      jsonVersion: "1.1",
      body: { taskDefinition },
      permission: "ecs:DescribeTaskDefinition",
      notFound: notFoundIn(
        `task definition ${lastSegment(taskDefinition)} in ${region}`,
      ),
    });
    const groups: Array<AwsLogGroup> = [];

    // Only each container's log configuration is read: never its environment or secrets.
    for (const raw of readArray(
      readObject(answer["taskDefinition"])["containerDefinitions"],
    )) {
      const logging: JSONObject = readObject(
        readObject(raw)["logConfiguration"],
      );
      const options: JSONObject = readObject(logging["options"]);
      const name: string = readText(options["awslogs-group"]);
      const groupRegion: string = readText(options["awslogs-region"]) || region;

      if (
        readText(logging["logDriver"]) !== "awslogs" ||
        !LOG_GROUP_NAME_REGEX.test(name) ||
        !AWS_REGION_REGEX.test(groupRegion)
      ) {
        continue;
      }

      if (
        !groups.some((group: AwsLogGroup): boolean => {
          return group.name === name && group.region === groupRegion;
        })
      ) {
        groups.push({ name, region: groupRegion });
      }
    }

    if (groups.length === 0) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `ECS service ${this.part("name")}'s task definition ${lastSegment(
          taskDefinition,
        )} sends no container's logs to CloudWatch Logs (the awslogs log driver), so there are no log lines to read here.`,
      });
    }

    return groups;
  }

  private async rdsLogGroups(): Promise<Array<AwsLogGroup>> {
    const region: string = this.requireRegion();
    const isCluster: boolean = this.resource.kind === "rds-cluster";
    const prefix: string = `/aws/rds/${isCluster ? "cluster" : "instance"}/${this.part("name")}/`;
    const answer: JSONObject = await this.json({
      service: "logs",
      region,
      target: `${LOGS_TARGET_PREFIX}.DescribeLogGroups`,
      jsonVersion: "1.1",
      body: { logGroupNamePrefix: prefix, limit: 50 },
      permission: "logs:DescribeLogGroups",
    });
    const names: Array<string> = readArray(answer["logGroups"])
      .map((raw: unknown): string => {
        return readText(readObject(raw)["logGroupName"]);
      })
      .filter((name: string): boolean => {
        return name.startsWith(prefix) && LOG_GROUP_NAME_REGEX.test(name);
      })
      // The error logs first: they say what broke.
      .sort((a: string, b: string): number => {
        const weight: (name: string) => number = (name: string): number => {
          return name.endsWith("/error") || name.endsWith("/postgresql")
            ? 0
            : 1;
        };

        return weight(a) - weight(b) || (a < b ? -1 : a > b ? 1 : 0);
      });

    if (names.length === 0) {
      throw new CloudLiveReadError({
        reason: "refused",
        message: `The ${isCluster ? "Aurora cluster" : "RDS instance"} ${this.part(
          "name",
        )} exports no logs to CloudWatch Logs (no log group starts with ${prefix}), so there are no log lines to read here. Turn on its log exports to read them.`,
      });
    }

    if (names.length > MAX_LOG_GROUPS) {
      this.notes.push(
        `The database exports ${names.length} logs; the first ${MAX_LOG_GROUPS} were read: ${names
          .slice(0, MAX_LOG_GROUPS)
          .join(", ")}.`,
      );
    }

    return names.slice(0, MAX_LOG_GROUPS).map((name: string): AwsLogGroup => {
      return { name, region };
    });
  }

  // The log group a CloudWatch Logs ARN names (arn:aws:logs:...:log-group:NAME[:*]), or "".
  private logGroupOfArn(): string {
    if (this.part("service") !== "logs") {
      return "";
    }

    const marker: string = ":log-group:";
    const index: number = this.id.indexOf(marker);

    if (index < 0) {
      return "";
    }

    let name: string = this.id.slice(index + marker.length);

    if (name.endsWith(":*")) {
      name = name.slice(0, -2);
    }

    return LOG_GROUP_NAME_REGEX.test(name) ? name : "";
  }

  private async logGroups(): Promise<Array<AwsLogGroup>> {
    const groupOfArn: string = this.logGroupOfArn();

    if (groupOfArn) {
      return [{ name: groupOfArn, region: this.requireRegion() }];
    }

    if (
      this.resource.kind === "lambda-function" ||
      this.resource.kind === "lambda-alias" ||
      (this.part("service") === "lambda" && this.part("functionName"))
    ) {
      return await this.lambdaLogGroups();
    }

    if (this.resource.kind === "ecs-service") {
      return await this.ecsLogGroups();
    }

    if (
      this.resource.kind === "rds-instance" ||
      this.resource.kind === "rds-cluster"
    ) {
      return await this.rdsLogGroups();
    }

    throw new CloudLiveReadError({
      reason: "refused",
      message: `cloud read-logs reads the CloudWatch Logs of a Lambda function, an ECS service, an RDS instance or Aurora cluster, or a log group named by its ARN (arn:aws:logs:REGION:ACCOUNT:log-group:NAME) on AWS; ${liveText(
        this.id,
        200,
      )} is none of those.`,
    });
  }

  // One FilterLogEvents page of a group in [startMs, endMs], oldest first.
  private async filterLogPage(data: {
    group: AwsLogGroup;
    startMs: number;
    endMs: number;
    pattern: string;
  }): Promise<{ events: Array<AwsLogEvent>; more: boolean }> {
    const body: JSONObject = {
      logGroupName: data.group.name,
      startTime: Math.floor(data.startMs),
      endTime: Math.ceil(data.endMs),
      limit: LOG_PAGE_EVENTS,
    };

    if (data.pattern) {
      body["filterPattern"] = data.pattern;
    }

    const answer: JSONObject = await this.json({
      service: "logs",
      region: data.group.region,
      target: `${LOGS_TARGET_PREFIX}.FilterLogEvents`,
      jsonVersion: "1.1",
      body,
      permission: "logs:FilterLogEvents",
      notFound: notFoundIn(
        `log group ${data.group.name} in ${data.group.region}`,
      ),
    });

    const events: Array<AwsLogEvent> = readArray(answer["events"])
      .map((raw: unknown): AwsLogEvent => {
        const event: JSONObject = readObject(raw);

        return {
          timeMs: readNumber(event["timestamp"]) ?? NaN,
          group: data.group.name,
          stream: readText(event["logStreamName"]),
          // Cut here: a CloudWatch event can be 256 KB, and only its start is shown.
          message:
            typeof event["message"] === "string"
              ? (event["message"] as string).slice(
                  0,
                  LIVE_READ_MAX_LOG_LINE_LENGTH * 2,
                )
              : "",
          id: readText(event["eventId"]),
        };
      })
      .filter((event: AwsLogEvent): boolean => {
        return Number.isFinite(event.timeMs);
      })
      .sort((a: AwsLogEvent, b: AwsLogEvent): number => {
        return a.timeMs - b.timeMs;
      });

    return { events, more: Boolean(readText(answer["nextToken"])) };
  }

  /*
   * The newest `limit` lines of one group in [startMs, endMs].
   * FilterLogEvents lists a stretch oldest first, a page at a time, so the
   * stretch is read once whole; when it holds more than a page, it is read
   * again from its end, in windows sized by how dense the first page was
   * (narrowed when one still holds more than a page, widened as they come
   * back short), until `limit` lines are found or the first page's end is
   * reached. `complete` is false when the request budget stopped the read,
   * or a one-second window held more than a page.
   */
  private async readNewestLogEvents(data: {
    group: AwsLogGroup;
    startMs: number;
    endMs: number;
    pattern: string;
    limit: number;
  }): Promise<{ events: Array<AwsLogEvent>; complete: boolean }> {
    const found: Array<AwsLogEvent> = [];
    let complete: boolean = true;

    try {
      const first: { events: Array<AwsLogEvent>; more: boolean } =
        await this.filterLogPage({
          group: data.group,
          startMs: data.startMs,
          endMs: data.endMs,
          pattern: data.pattern,
        });

      found.push(...first.events);

      if (first.more) {
        const lastEvent: AwsLogEvent | undefined =
          first.events[first.events.length - 1];
        const coveredUntil: number = lastEvent
          ? lastEvent.timeMs
          : data.startMs;
        const density: number =
          first.events.length / Math.max(1, coveredUntil - data.startMs);
        let width: number = Math.max(
          MIN_LOG_WINDOW_MS,
          Math.min(
            data.endMs - coveredUntil,
            density > 0
              ? Math.ceil((2 * data.limit) / density)
              : data.endMs - coveredUntil,
          ),
        );
        let windowEnd: number = data.endMs;
        let newer: number = 0;

        while (windowEnd > coveredUntil && newer < data.limit) {
          const windowStart: number = Math.max(coveredUntil, windowEnd - width);
          const page: { events: Array<AwsLogEvent>; more: boolean } =
            await this.filterLogPage({
              group: data.group,
              startMs: windowStart,
              endMs: windowEnd,
              pattern: data.pattern,
            });

          if (page.more && windowEnd - windowStart > MIN_LOG_WINDOW_MS) {
            width = Math.max(
              MIN_LOG_WINDOW_MS,
              Math.floor((windowEnd - windowStart) / 4),
            );
            continue;
          }

          if (page.more) {
            complete = false;
          }

          found.push(...page.events);
          newer += page.events.length;
          windowEnd = windowStart;
          width = width * 2;
        }
      }
    } catch (error) {
      if (!(error instanceof CloudReadBudgetSpent)) {
        throw error;
      }

      complete = false;
    }

    return { events: AwsLiveRead.newest(found, data.limit), complete };
  }

  // The newest `limit` of some events, newest first, each once.
  private static newest(
    events: Array<AwsLogEvent>,
    limit: number,
  ): Array<AwsLogEvent> {
    const seen: Set<string> = new Set<string>();

    return events
      .slice()
      .sort((a: AwsLogEvent, b: AwsLogEvent): number => {
        return b.timeMs - a.timeMs;
      })
      .filter((event: AwsLogEvent): boolean => {
        const key: string =
          event.id ||
          `${event.group}|${event.stream}|${event.timeMs}|${event.message}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  private async readLogs(): Promise<string> {
    const minutes: number = this.integerFlag(
      "minutes",
      CLOUD_DEFAULT_LOG_MINUTES,
    );
    const limit: number = this.integerFlag("limit", CLOUD_DEFAULT_ROW_LIMIT);
    const filter: string = this.textFlag("filter");
    const groups: Array<AwsLogGroup> = await this.logGroups();
    const endMs: number = this.at.getTime();
    const startMs: number = endMs - minutes * 60 * 1000;
    const pattern: string = filter ? toAwsFilterPattern(filter) : "";
    const events: Array<AwsLogEvent> = [];
    let complete: boolean = true;

    for (const group of groups) {
      const read: { events: Array<AwsLogEvent>; complete: boolean } =
        await this.readNewestLogEvents({
          group,
          startMs,
          endMs,
          pattern,
          limit,
        });

      events.push(...read.events);
      complete = complete && read.complete;
    }

    const newest: Array<AwsLogEvent> = AwsLiveRead.newest(events, limit);
    const span: string = `the last ${minutes} minute${minutes === 1 ? "" : "s"}`;
    const text: LiveReadText = this.header(
      ["CloudWatch Logs FilterLogEvents"],
      `log lines of ${this.kindName()} ${this.id} from ${groups
        .map((group: AwsLogGroup): string => {
          return group.name;
        })
        .join(
          ", ",
        )}, ${span}${filter ? `, containing "${filter}"` : ""}, newest first`,
    );

    text.list(
      "lines",
      newest.map((event: AwsLogEvent): string => {
        const where: string = [
          groups.length > 1 ? event.group : "",
          liveText(event.stream, 80),
        ]
          .filter((part: string): boolean => {
            return part.length > 0;
          })
          .join(" ");

        return `${liveTime(event.timeMs, { milliseconds: true })}${
          where ? ` [${where}]` : ""
        } ${liveText(event.message, LIVE_READ_MAX_LOG_LINE_LENGTH, { keepLineBreaks: true })}`;
      }),
      {
        empty: `none in ${span}${filter ? ` containing "${filter}"` : ""}`,
        maxItemLength: LIVE_READ_MAX_LOG_LINE_LENGTH + 200,
      },
    );

    if (!complete) {
      this.notes.push(
        "The read stopped at its request limit, or a second of the log held more lines than one page: lines may be missing between the ones shown. Narrow --minutes or add --filter to read fewer.",
      );
    }

    return this.finish(text);
  }
}
