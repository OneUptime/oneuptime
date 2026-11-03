import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CLOUD_SAVINGS_SOURCE_AWS,
  CloudCostState,
  CloudSavingKind,
  toCloudCostDay,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CloudConnectorCallOptions,
  CloudCostRecord,
  CloudReadBudget,
  CloudSavingRecord,
} from "../CloudConnectorTypes";
import {
  AwsCredentials,
  awsErrorCodeOf,
  getAwsPartition,
  sendAwsRequest,
} from "./AwsApi";

/*
 * WHAT AN AWS ACCOUNT COSTS, AND HOW TO SPEND LESS IN IT.
 *
 *   Cost Explorer GetCostAndUsage (AWS JSON 1.1, target
 *   AWSInsightsIndexService.GetCostAndUsage, in us-east-1 - cn-northwest-1
 *   for China):
 *     { TimePeriod: { Start, End }, Granularity: "DAILY",
 *       Metrics: ["UnblendedCost"], GroupBy: [SERVICE, REGION] -
 *       [LINKED_ACCOUNT, SERVICE] from an organization's management account,
 *       one call for every account - Filter: every record type but credits
 *       and refunds, NextPageToken }
 *     -> { ResultsByTime: [{ TimePeriod: { Start }, Groups: [{ Keys,
 *          Metrics: { UnblendedCost: { Amount, Unit } } }] }], NextPageToken }
 *   Cost Explorer charges $0.01 a request, so a read asks for its window
 *   once, a few pages at most, and only twice a day.
 *
 *   Cost Optimization Hub ListRecommendations (AWS JSON 1.0, target
 *   CostOptimizationHubService.ListRecommendations, us-east-1):
 *     { maxResults: 1000, nextToken }
 *     -> { items: [{ recommendationId, accountId, region, resourceId,
 *          resourceArn, currentResourceType, actionType,
 *          currentResourceSummary, recommendedResourceSummary,
 *          estimatedMonthlySavings, estimatedMonthlyCost, currencyCode,
 *          implementationEffort }], nextToken }
 *   It gathers Compute Optimizer's rightsizing and idle findings and the
 *   Savings Plans and Reserved Instance purchases worth making, for every
 *   account of an organization from its management account. Free; an
 *   account turns it on once (update-enrollment-status).
 *
 * GovCloud accounts are billed through a standard account, whose Cost
 * Explorer reads them: there is nothing to read in the GovCloud partition.
 */

const PROVIDER_TITLE: string = "AWS";
const COST_TARGET: string = "AWSInsightsIndexService.GetCostAndUsage";
const SAVINGS_TARGET: string = "CostOptimizationHubService.ListRecommendations";
// Pages of one window at most: each is $0.01.
export const AWS_COST_MAX_PAGES: number = 10;
export const AWS_SAVINGS_MAX_PAGES: number = 10;

/*
 * Credits and refunds are what a promotion or a correction paid, not what
 * the resources cost: left out, as a cost tool's default view does.
 */
const COST_FILTER: JSONObject = {
  Not: {
    Dimensions: {
      Key: "RECORD_TYPE",
      Values: ["Credit", "Refund"],
    },
  },
};

// Where Cost Explorer and Cost Optimization Hub answer for the partition; null for GovCloud.
export function getAwsCostRegion(homeRegion: string): string | null {
  const partition: string = getAwsPartition(homeRegion || "us-east-1");

  if (partition === "aws-us-gov") {
    return null;
  }

  return partition === "aws-cn" ? "cn-northwest-1" : "us-east-1";
}

// Cost Explorer's Regions that are none: a global service, a fee.
function readCostRegion(value: string): string {
  const region: string = value.trim();
  return region === "global" || region === "NoRegion" ? "" : region;
}

/*
 * An amount as AWS writes it: Cost Explorer as text ("120.5"), Cost
 * Optimization Hub as a JSON number (61.32).
 */
function readAmount(value: unknown): number {
  const amount: number =
    typeof value === "number" ? value : Number(readText(value));
  return Number.isFinite(amount) ? amount : 0;
}

/*
 * One window's daily costs: by service and Region for one account, by
 * account and service from an organization's management account.
 */
export async function readAwsCostAndUsage(data: {
  credentials: AwsCredentials;
  region: string;
  // The account the costs are of, when they are not grouped by account.
  accountId: string;
  groupByAccount: boolean;
  start: Date;
  end: Date;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<{ records: Array<CloudCostRecord>; complete: boolean }> {
  const records: Array<CloudCostRecord> = [];
  let token: string = "";
  let complete: boolean = false;

  for (let page: number = 0; page < AWS_COST_MAX_PAGES; page++) {
    const body: JSONObject = {
      TimePeriod: {
        Start: toCloudCostDay(data.start),
        End: toCloudCostDay(data.end),
      },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      GroupBy: data.groupByAccount
        ? [
            { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
            { Type: "DIMENSION", Key: "SERVICE" },
          ]
        : [
            { Type: "DIMENSION", Key: "SERVICE" },
            { Type: "DIMENSION", Key: "REGION" },
          ],
      Filter: COST_FILTER,
    };

    if (token) {
      body["NextPageToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.credentials,
      service: "ce",
      region: data.region,
      target: COST_TARGET,
      jsonVersion: "1.1",
      body,
      step: "cost request",
      providerTitle: PROVIDER_TITLE,
      now: data.options.now,
      timeoutInMs: data.options.requestTimeoutInMs,
      sleep: data.options.sleep,
      budget: data.budget,
    });

    for (const rawPeriod of readArray(answer.json["ResultsByTime"])) {
      const period: JSONObject = readObject(rawPeriod);
      const day: string = readText(readObject(period["TimePeriod"])["Start"]);

      if (!day) {
        continue;
      }

      for (const rawGroup of readArray(period["Groups"])) {
        const group: JSONObject = readObject(rawGroup);
        const keys: Array<string> = readArray(group["Keys"]).map(
          (key: unknown): string => {
            return readText(key);
          },
        );
        const metric: JSONObject = readObject(
          readObject(group["Metrics"])["UnblendedCost"],
        );
        const amount: number = readAmount(metric["Amount"]);

        if (amount === 0) {
          continue;
        }

        records.push({
          accountId: data.groupByAccount ? keys[0] || "" : data.accountId,
          day,
          service: (data.groupByAccount ? keys[1] : keys[0]) || "",
          region: data.groupByAccount ? "" : readCostRegion(keys[1] || ""),
          resourceId: "",
          currency: readText(metric["Unit"]) || CLOUD_COST_DEFAULT_CURRENCY,
          amount,
        });
      }
    }

    const next: string = readText(answer.json["NextPageToken"]);

    if (!next || next === token) {
      complete = true;
      break;
    }

    token = next;
  }

  return { records, complete };
}

// What a Cost Optimization Hub action asks, as one of OneUptime's kinds.
export function getAwsSavingKind(actionType: string): CloudSavingKind {
  switch (actionType.trim()) {
    case "Rightsize":
    case "ScaleIn":
      return CloudSavingKind.Rightsize;
    case "Stop":
    case "Delete":
      return CloudSavingKind.Idle;
    case "Upgrade":
    case "MigrateToGraviton":
      return CloudSavingKind.Upgrade;
    case "PurchaseSavingsPlans":
    case "PurchaseReservedInstances":
      return CloudSavingKind.Commitment;
    default:
      return CloudSavingKind.Other;
  }
}

// An action as people say it: "MigrateToGraviton" -> "Migrate to Graviton".
const AWS_SAVING_ACTIONS: Record<string, string> = {
  Rightsize: "Rightsize",
  ScaleIn: "Scale in",
  Stop: "Stop",
  Delete: "Delete",
  Upgrade: "Upgrade",
  MigrateToGraviton: "Migrate to Graviton",
  PurchaseSavingsPlans: "Purchase Savings Plans",
  PurchaseReservedInstances: "Purchase Reserved Instances",
};

export function describeAwsSavingAction(actionType: string): string {
  const action: string = actionType.trim();
  return AWS_SAVING_ACTIONS[action] || action;
}

// A resource type as Cost Optimization Hub names it: "Ec2Instance" -> "EC2 instance".
export function describeAwsSavingResourceType(type: string): string {
  const known: Record<string, string> = {
    Ec2Instance: "EC2 instance",
    Ec2AutoScalingGroup: "EC2 Auto Scaling group",
    EbsVolume: "EBS volume",
    LambdaFunction: "Lambda function",
    EcsService: "ECS service",
    RdsDbInstance: "RDS DB instance",
    RdsDbInstanceStorage: "RDS DB instance storage",
    AuroraDbClusterStorage: "Aurora DB cluster storage",
    DynamoDbReservedCapacity: "DynamoDB reserved capacity",
    Ec2InstanceSavingsPlans: "EC2 Instance Savings Plans",
    ComputeSavingsPlans: "Compute Savings Plans",
    SageMakerSavingsPlans: "SageMaker Savings Plans",
    Ec2ReservedInstances: "EC2 Reserved Instances",
    RdsReservedInstances: "RDS Reserved Instances",
    OpenSearchReservedInstances: "OpenSearch Reserved Instances",
    RedshiftReservedInstances: "Redshift Reserved Instances",
    ElastiCacheReservedInstances: "ElastiCache Reserved Instances",
    MemoryDbReservedInstances: "MemoryDB Reserved Instances",
  };

  return known[type.trim()] || type.trim();
}

/*
 * Every recommendation Cost Optimization Hub has for the accounts the
 * credential reaches: one account's, or an organization's from its
 * management account.
 */
export async function readAwsCostOptimizationHub(data: {
  credentials: AwsCredentials;
  region: string;
  options: CloudConnectorCallOptions;
  budget: CloudReadBudget;
}): Promise<{ recommendations: Array<CloudSavingRecord>; complete: boolean }> {
  const recommendations: Array<CloudSavingRecord> = [];
  let token: string = "";
  let complete: boolean = false;

  for (let page: number = 0; page < AWS_SAVINGS_MAX_PAGES; page++) {
    const body: JSONObject = { maxResults: 1000 };

    if (token) {
      body["nextToken"] = token;
    }

    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: data.options.transport,
      credentials: data.credentials,
      service: "cost-optimization-hub",
      region: data.region,
      target: SAVINGS_TARGET,
      jsonVersion: "1.0",
      body,
      step: "recommendations request",
      providerTitle: PROVIDER_TITLE,
      now: data.options.now,
      timeoutInMs: data.options.requestTimeoutInMs,
      sleep: data.options.sleep,
      budget: data.budget,
    });

    for (const rawItem of readArray(answer.json["items"])) {
      const item: JSONObject = readObject(rawItem);
      const recommendationId: string = readText(item["recommendationId"]);
      const accountId: string = readText(item["accountId"]);
      const savings: number = readAmount(item["estimatedMonthlySavings"]);

      if (!recommendationId || !accountId || savings <= 0) {
        continue;
      }

      const actionType: string = readText(item["actionType"]);
      const cost: number = readAmount(item["estimatedMonthlyCost"]);

      recommendations.push({
        recommendationId,
        accountId,
        region: readText(item["region"]),
        resourceId:
          readText(item["resourceArn"]) || readText(item["resourceId"]),
        resourceType: describeAwsSavingResourceType(
          readText(item["currentResourceType"]),
        ),
        resourceName: readText(item["resourceId"]),
        kind: getAwsSavingKind(actionType),
        action: describeAwsSavingAction(actionType) || "Review",
        currentConfiguration: readText(item["currentResourceSummary"]),
        recommendedConfiguration: readText(item["recommendedResourceSummary"]),
        monthlySavings: savings,
        monthlyCost: cost > 0 ? cost : null,
        currency: readText(item["currencyCode"]) || CLOUD_COST_DEFAULT_CURRENCY,
        effort: readText(item["implementationEffort"]),
        source: CLOUD_SAVINGS_SOURCE_AWS,
      });
    }

    const next: string = readText(answer.json["nextToken"]);

    if (!next || next === token) {
      complete = true;
      break;
    }

    token = next;
  }

  return { recommendations, complete };
}

/*
 * Why costs or savings could not be read, in words the person can act on:
 * a refusal is fixed by running the setup command again; a service that is
 * not turned on is turned on once; anything else is tried again.
 */
export function describeAwsCostFailure(data: {
  error: unknown;
  what: "costs" | "savings";
}): { state: CloudCostState; message: string } {
  const body: string =
    data.error instanceof LlmProviderError
      ? data.error.responseBody || data.error.message
      : data.error instanceof Error
        ? data.error.message
        : String(data.error);
  const code: string = awsErrorCodeOf(body);
  const lower: string = body.toLowerCase();

  if (data.what === "costs") {
    if (
      code === "DataUnavailableException" ||
      lower.includes("not enabled for cost explorer")
    ) {
      return {
        state: CloudCostState.NotSetUp,
        message:
          "Cost Explorer is not turned on for this account yet. Open Cost Explorer once in the AWS Billing and Cost Management console; its data arrives within a day.",
      };
    }

    if (
      data.error instanceof LlmProviderError &&
      data.error.kind === CloudConnectionFailureKind.Permission
    ) {
      return {
        state: CloudCostState.NotAllowed,
        message:
          "The role may not read Cost Explorer (ce:GetCostAndUsage). Run the setup command again to allow it.",
      };
    }
  } else {
    if (
      lower.includes("enroll") ||
      lower.includes("opt in") ||
      lower.includes("opted in")
    ) {
      return {
        state: CloudCostState.NotSetUp,
        message:
          "Cost Optimization Hub is not turned on for this account. Turn it on once, free: aws cost-optimization-hub update-enrollment-status --status Active --region us-east-1 (add --include-member-accounts in an organization's management account).",
      };
    }

    if (
      data.error instanceof LlmProviderError &&
      data.error.kind === CloudConnectionFailureKind.Permission
    ) {
      return {
        state: CloudCostState.NotAllowed,
        message:
          "The role may not read Cost Optimization Hub (cost-optimization-hub:ListRecommendations). Run the setup command again to allow it.",
      };
    }
  }

  return {
    state: CloudCostState.Failed,
    message: (data.error instanceof Error
      ? data.error.message
      : String(data.error)
    ).slice(0, 500),
  };
}
