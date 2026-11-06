import {
  AWS_COST_MAX_PAGES,
  describeAwsCostFailure,
  describeAwsSavingAction,
  describeAwsSavingResourceType,
  getAwsCostRegion,
  getAwsSavingKind,
  readAwsCostAndUsage,
  readAwsCostOptimizationHub,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCosts";
import {
  CloudConnectorCallOptions,
  CloudCostRecord,
  CloudReadBudget,
  CloudSavingRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  CLOUD_SAVINGS_SOURCE_AWS,
  CloudCostState,
  CloudSavingKind,
} from "../../../../Types/Cloud/CloudCost";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * What an AWS account costs, read from Cost Explorer, and the ways to spend
 * less in it, from Cost Optimization Hub - with AWS stood in, answering
 * the JSON protocols the way they answer: the action in X-Amz-Target, a
 * page token until the last page, and the errors an account that has not
 * turned a service on, or a role that may not call it, gets.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const CREDENTIALS: { accessKeyId: string; secretAccessKey: string } = {
  accessKeyId: "AKIAEXAMPLEEXAMPLE00",
  secretAccessKey: "secret-example-secret-example-secret0000",
};

function options(api: FakeProviderApi): CloudConnectorCallOptions {
  return {
    transport: api.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function budget(maxRequests: number = 50): CloudReadBudget {
  return new CloudReadBudget({ maxRequests, maxDurationMs: 60_000 });
}

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

function targetOf(request: DataSourceHttpRequest): string {
  return (request.headers || {})["X-Amz-Target"] || "";
}

// One day's groups as Cost Explorer answers them.
function period(
  day: string,
  groups: Array<[Array<string>, string, string?]>,
): JSONObject {
  return {
    TimePeriod: { Start: day, End: day },
    Groups: groups.map(
      ([keys, amount, unit]: [Array<string>, string, string?]): JSONObject => {
        return {
          Keys: keys,
          Metrics: { UnblendedCost: { Amount: amount, Unit: unit || "USD" } },
        };
      },
    ),
  };
}

// Cost Explorer: each request answered by the next page.
function costExplorer(pages: Array<FakeResponse>): FakeProviderApi {
  let index: number = 0;

  return createFakeProviderApi([
    {
      path: "/",
      host: "ce.us-east-1.amazonaws.com",
      respond: (): FakeResponse => {
        const page: FakeResponse = pages[Math.min(index, pages.length - 1)]!;
        index++;
        return page;
      },
    },
  ]);
}

describe("where AWS answers for costs", () => {
  test("us-east-1 for every commercial Region, cn-northwest-1 for China, none for GovCloud", () => {
    expect(getAwsCostRegion("us-east-1")).toBe("us-east-1");
    expect(getAwsCostRegion("eu-west-1")).toBe("us-east-1");
    expect(getAwsCostRegion("")).toBe("us-east-1");
    expect(getAwsCostRegion("cn-north-1")).toBe("cn-northwest-1");
    expect(getAwsCostRegion("us-gov-west-1")).toBeNull();
  });
});

describe("an account's daily costs from Cost Explorer", () => {
  test("asks for the window by day, service and Region, without credits and refunds, page by page", async () => {
    const api: FakeProviderApi = costExplorer([
      json({
        ResultsByTime: [
          period("2026-11-18", [
            [["Amazon Elastic Compute Cloud - Compute", "us-east-1"], "120.5"],
            [["Amazon Simple Storage Service", "global"], "3.25"],
            // A service that cost nothing that day is no record.
            [["AWS Lambda", "us-east-1"], "0"],
          ]),
        ],
        NextPageToken: "page-2",
      }),
      json({
        ResultsByTime: [
          period("2026-11-19", [
            [["Tax", "NoRegion"], "1.10"],
            [["Amazon Elastic Compute Cloud - Compute", "eu-west-1"], "7"],
          ]),
        ],
      }),
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(true);
    expect(read.records).toEqual([
      {
        accountId: "123456789012",
        day: "2026-11-18",
        service: "Amazon Elastic Compute Cloud - Compute",
        region: "us-east-1",
        resourceId: "",
        currency: "USD",
        amount: 120.5,
      },
      {
        accountId: "123456789012",
        day: "2026-11-18",
        service: "Amazon Simple Storage Service",
        // A global service, or a fee, has no Region.
        region: "",
        resourceId: "",
        currency: "USD",
        amount: 3.25,
      },
      {
        accountId: "123456789012",
        day: "2026-11-19",
        service: "Tax",
        region: "",
        resourceId: "",
        currency: "USD",
        amount: 1.1,
      },
      {
        accountId: "123456789012",
        day: "2026-11-19",
        service: "Amazon Elastic Compute Cloud - Compute",
        region: "eu-west-1",
        resourceId: "",
        currency: "USD",
        amount: 7,
      },
    ]);

    expect(api.requests).toHaveLength(2);
    expect(targetOf(api.requests[0]!)).toBe(
      "AWSInsightsIndexService.GetCostAndUsage",
    );
    expect((api.requests[0]!.headers || {})["Content-Type"]).toBe(
      "application/x-amz-json-1.1",
    );

    const first: JSONObject = bodyOf(api.requests[0]!);
    expect(first).toMatchObject({
      TimePeriod: { Start: "2026-11-13", End: "2026-11-21" },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      GroupBy: [
        { Type: "DIMENSION", Key: "SERVICE" },
        { Type: "DIMENSION", Key: "REGION" },
      ],
      Filter: {
        Not: {
          Dimensions: { Key: "RECORD_TYPE", Values: ["Credit", "Refund"] },
        },
      },
    });
    expect(first["NextPageToken"]).toBeUndefined();
    expect(bodyOf(api.requests[1]!)["NextPageToken"]).toBe("page-2");
  });

  test("an organization's management account is asked for every account at once, by account and service", async () => {
    const api: FakeProviderApi = costExplorer([
      json({
        ResultsByTime: [
          period("2026-11-19", [
            [["111111111111", "Amazon Relational Database Service"], "40"],
            [["222222222222", "AWS Lambda"], "2.5", "USD"],
          ]),
        ],
      }),
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "999999999999",
        groupByAccount: true,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(
      read.records.map((entry: CloudCostRecord) => {
        return [entry.accountId, entry.service, entry.region, entry.amount];
      }),
    ).toEqual([
      ["111111111111", "Amazon Relational Database Service", "", 40],
      ["222222222222", "AWS Lambda", "", 2.5],
    ]);
    expect(bodyOf(api.requests[0]!)["GroupBy"]).toEqual([
      { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
      { Type: "DIMENSION", Key: "SERVICE" },
    ]);
  });

  test("a window never runs past its pages: each costs a cent", async () => {
    const api: FakeProviderApi = costExplorer([
      json({ ResultsByTime: [], NextPageToken: "again-and-again-1" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-2" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-3" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-4" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-5" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-6" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-7" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-8" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-9" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-10" }),
      json({ ResultsByTime: [], NextPageToken: "again-and-again-11" }),
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(false);
    expect(api.requests).toHaveLength(AWS_COST_MAX_PAGES);
  });

  test("a token the answer repeats ends the read", async () => {
    const api: FakeProviderApi = costExplorer([
      json({ ResultsByTime: [], NextPageToken: "same" }),
      json({ ResultsByTime: [], NextPageToken: "same" }),
    ]);

    const read: { records: Array<CloudCostRecord>; complete: boolean } =
      await readAwsCostAndUsage({
        credentials: CREDENTIALS,
        region: "us-east-1",
        accountId: "123456789012",
        groupByAccount: false,
        start: new Date("2026-11-13T00:00:00.000Z"),
        end: new Date("2026-11-21T00:00:00.000Z"),
        options: options(api),
        budget: budget(),
      });

    expect(read.complete).toBe(true);
    expect(api.requests).toHaveLength(2);
  });
});

describe("the ways to spend less, from Cost Optimization Hub", () => {
  test("every recommendation of every account the credential reaches, in OneUptime's kinds", async () => {
    let calls: number = 0;
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/",
        host: "cost-optimization-hub.us-east-1.amazonaws.com",
        respond: (): FakeResponse => {
          calls++;

          if (calls === 1) {
            return json({
              items: [
                {
                  recommendationId: "rec-1",
                  accountId: "123456789012",
                  region: "us-east-1",
                  resourceId: "i-0abc",
                  resourceArn:
                    "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
                  currentResourceType: "Ec2Instance",
                  actionType: "Rightsize",
                  currentResourceSummary: "m5.2xlarge",
                  recommendedResourceSummary: "m5.xlarge",
                  estimatedMonthlySavings: 61.32,
                  estimatedMonthlyCost: 280.32,
                  currencyCode: "USD",
                  implementationEffort: "Low",
                },
                // Nothing to save is no recommendation.
                {
                  recommendationId: "rec-0",
                  accountId: "123456789012",
                  actionType: "Stop",
                  estimatedMonthlySavings: 0,
                },
                // Nor is one with no id.
                {
                  accountId: "123456789012",
                  actionType: "Delete",
                  estimatedMonthlySavings: 9,
                },
              ],
              nextToken: "next",
            });
          }

          return json({
            items: [
              {
                recommendationId: "rec-2",
                accountId: "210987654321",
                region: "us-east-1",
                resourceId: "vol-0abc",
                currentResourceType: "EbsVolume",
                actionType: "Delete",
                estimatedMonthlySavings: 8,
              },
              {
                recommendationId: "rec-3",
                accountId: "123456789012",
                currentResourceType: "ComputeSavingsPlans",
                actionType: "PurchaseSavingsPlans",
                estimatedMonthlySavings: 145,
              },
            ],
          });
        },
      },
    ]);

    const read: {
      recommendations: Array<CloudSavingRecord>;
      complete: boolean;
    } = await readAwsCostOptimizationHub({
      credentials: CREDENTIALS,
      region: "us-east-1",
      options: options(api),
      budget: budget(),
    });

    expect(read.complete).toBe(true);
    expect(read.recommendations).toHaveLength(3);
    expect(read.recommendations[0]).toEqual({
      recommendationId: "rec-1",
      accountId: "123456789012",
      region: "us-east-1",
      resourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
      resourceType: "EC2 instance",
      resourceName: "i-0abc",
      kind: CloudSavingKind.Rightsize,
      action: "Rightsize",
      currentConfiguration: "m5.2xlarge",
      recommendedConfiguration: "m5.xlarge",
      monthlySavings: 61.32,
      monthlyCost: 280.32,
      currency: "USD",
      effort: "Low",
      source: CLOUD_SAVINGS_SOURCE_AWS,
    });
    expect(
      read.recommendations.slice(1).map((entry: CloudSavingRecord) => {
        return [
          entry.recommendationId,
          entry.kind,
          entry.action,
          entry.resourceId,
        ];
      }),
    ).toEqual([
      ["rec-2", CloudSavingKind.Idle, "Delete", "vol-0abc"],
      ["rec-3", CloudSavingKind.Commitment, "Purchase Savings Plans", ""],
    ]);
    expect(targetOf(api.requests[0]!)).toBe(
      "CostOptimizationHubService.ListRecommendations",
    );
    expect(bodyOf(api.requests[0]!)).toEqual({ maxResults: 1000 });
    expect(bodyOf(api.requests[1]!)).toEqual({
      maxResults: 1000,
      nextToken: "next",
    });
  });

  test("each action as people say it, in the kind it is", () => {
    expect(getAwsSavingKind("ScaleIn")).toBe(CloudSavingKind.Rightsize);
    expect(getAwsSavingKind("Stop")).toBe(CloudSavingKind.Idle);
    expect(getAwsSavingKind("MigrateToGraviton")).toBe(CloudSavingKind.Upgrade);
    expect(getAwsSavingKind("PurchaseReservedInstances")).toBe(
      CloudSavingKind.Commitment,
    );
    expect(getAwsSavingKind("SomethingNew")).toBe(CloudSavingKind.Other);
    expect(describeAwsSavingAction("MigrateToGraviton")).toBe(
      "Migrate to Graviton",
    );
    expect(describeAwsSavingAction("SomethingNew")).toBe("SomethingNew");
    expect(describeAwsSavingResourceType("RdsDbInstance")).toBe(
      "RDS DB instance",
    );
    expect(describeAwsSavingResourceType("NewType")).toBe("NewType");
  });
});

describe("why costs or savings could not be read", () => {
  function refused(body: string): LlmProviderError {
    return new LlmProviderError({
      message: `AWS cost request failed: ${body}`,
      kind: CloudConnectionFailureKind.Permission,
      statusCode: 400,
      responseBody: body,
    });
  }

  test("Cost Explorer not turned on is a step to take once, not a failure", () => {
    expect(
      describeAwsCostFailure({
        error: new LlmProviderError({
          message: "AWS cost request failed",
          kind: CloudConnectionFailureKind.Other,
          statusCode: 400,
          responseBody:
            '{"__type":"DataUnavailableException","message":"Data is not available."}',
        }),
        what: "costs",
      }),
    ).toEqual({
      state: CloudCostState.NotSetUp,
      message: expect.stringContaining("Open Cost Explorer once"),
    });
  });

  test("a role that may not read them is told to run the setup command again", () => {
    expect(
      describeAwsCostFailure({
        error: refused(
          '{"__type":"AccessDeniedException","message":"not authorized to perform: ce:GetCostAndUsage"}',
        ),
        what: "costs",
      }),
    ).toEqual({
      state: CloudCostState.NotAllowed,
      message: expect.stringContaining("ce:GetCostAndUsage"),
    });
    expect(
      describeAwsCostFailure({
        error: refused('{"__type":"AccessDeniedException"}'),
        what: "savings",
      }).state,
    ).toBe(CloudCostState.NotAllowed);
  });

  test("Cost Optimization Hub not opted in to says the command that turns it on", () => {
    const outcome: { state: CloudCostState; message: string } =
      describeAwsCostFailure({
        error: new Error(
          "AccessDeniedException: The account is not enrolled in Cost Optimization Hub.",
        ),
        what: "savings",
      });

    expect(outcome.state).toBe(CloudCostState.NotSetUp);
    expect(outcome.message).toContain(
      "aws cost-optimization-hub update-enrollment-status --status Active",
    );
  });

  test("anything else is a failure, tried again, in the cloud's words, cut short", () => {
    const outcome: { state: CloudCostState; message: string } =
      describeAwsCostFailure({
        error: new Error("x".repeat(900)),
        what: "costs",
      });

    expect(outcome.state).toBe(CloudCostState.Failed);
    expect(outcome.message).toHaveLength(500);
  });
});
