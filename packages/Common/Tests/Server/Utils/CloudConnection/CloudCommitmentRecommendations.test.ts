import {
  AWS_COMMITMENT_DETAILS_MAX,
  readAwsCommitmentRecommendationDetails,
  readAwsCostOptimizationHub,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsCosts";
import {
  GCP_AMORTIZED_CREDIT_TYPES,
  buildGcpBillingExportQuery,
} from "../../../../Server/Utils/CloudConnection/Gcp/GcpCosts";
import {
  CloudConnectorCallOptions,
  CloudReadBudget,
  CloudSavingRecord,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudSavingKind } from "../../../../Types/Cloud/CloudCost";
import { CloudCommitmentPaymentOption } from "../../../../Types/Cloud/CloudCommitmentInventory";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";
import { describe, expect, test } from "@jest/globals";

/*
 * What a recommended commitment would buy (#11011), from Cost Optimization
 * Hub's GetRecommendation - its term, payment option, hourly commitment or
 * instances, upfront and monthly fees - read for each "commit to use"
 * recommendation with AWS stood in; and Google Cloud's billing export
 * query, which takes each basis's credits off the charge.
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

function bodyOf(request: DataSourceHttpRequest): JSONObject {
  return JSON.parse(String(request.body)) as JSONObject;
}

function targetOf(request: DataSourceHttpRequest): string {
  return (request.headers || {})["X-Amz-Target"] || "";
}

// A Compute Savings Plans purchase, as GetRecommendation answers it.
const SAVINGS_PLANS_DETAILS: JSONObject = {
  recommendationId: "sp-1",
  accountId: "123456789012",
  actionType: "PurchaseSavingsPlans",
  currentResourceType: "ComputeSavingsPlans",
  recommendedResourceType: "ComputeSavingsPlans",
  estimatedMonthlySavings: 318.2,
  estimatedMonthlyCost: 912.5,
  currencyCode: "USD",
  recommendedResourceDetails: {
    computeSavingsPlans: {
      configuration: {
        accountScope: "Payer",
        term: "1 year",
        paymentOption: "AllUpfront",
        hourlyCommitment: "1.25",
      },
      costCalculation: {
        pricing: {
          estimatedMonthlyCommitment: 912.5,
          estimatedOnDemandCost: 1230.7,
          monthlySavingsPlansEligibleCost: 1230.7,
          savingsPercentage: 25.85,
        },
      },
    },
  },
};

// An EC2 Reserved Instances purchase, as GetRecommendation answers it.
const RESERVED_INSTANCES_DETAILS: JSONObject = {
  recommendationId: "ri-1",
  accountId: "123456789012",
  actionType: "PurchaseReservedInstances",
  currentResourceType: "Ec2ReservedInstances",
  estimatedMonthlySavings: 120,
  currencyCode: "USD",
  recommendedResourceDetails: {
    ec2ReservedInstances: {
      configuration: {
        accountScope: "Account",
        instanceFamily: "m5",
        instanceType: "m5.large",
        numberOfInstancesToPurchase: "4",
        paymentOption: "PartialUpfront",
        term: "3 years",
        upfrontCost: "2100.00",
        monthlyRecurringCost: "58.40",
        platform: "Linux/UNIX",
        reservedInstancesRegion: "us-east-1",
      },
      costCalculation: {
        pricing: {
          estimatedMonthlyAmortizedReservationCost: 116.73,
          estimatedOnDemandCost: 236.73,
          savingsPercentage: 50.7,
        },
      },
    },
  },
};

describe("what a recommended commitment would buy", () => {
  test("a Savings Plans purchase: its term, payment, hourly commitment and monthly cost", () => {
    expect(
      readAwsCommitmentRecommendationDetails(SAVINGS_PLANS_DETAILS),
    ).toEqual({
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      hourlyCommitment: 1.25,
      quantity: null,
      configuration: "Compute Savings Plans",
      upfrontCost: null,
      monthlyRecurringCost: null,
      monthlyCost: 912.5,
    });
  });

  test("a Reserved Instances purchase: how many of which type, and its fees", () => {
    expect(
      readAwsCommitmentRecommendationDetails(RESERVED_INSTANCES_DETAILS),
    ).toEqual({
      termMonths: 36,
      paymentOption: CloudCommitmentPaymentOption.PartialUpfront,
      hourlyCommitment: null,
      quantity: 4,
      configuration: "m5.large",
      upfrontCost: 2100,
      monthlyRecurringCost: 58.4,
      monthlyCost: 116.73,
    });
  });

  test("an answer with nothing to buy is no details", () => {
    expect(readAwsCommitmentRecommendationDetails({})).toBeNull();
    expect(
      readAwsCommitmentRecommendationDetails({
        recommendedResourceDetails: { ec2Instance: {} },
      }),
    ).toBeNull();
  });
});

describe("Cost Optimization Hub's commitments, with their details", () => {
  function hub(data: {
    items: Array<JSONObject>;
    details: (recommendationId: string) => FakeResponse;
  }): FakeProviderApi {
    return createFakeProviderApi([
      {
        path: "/",
        host: "cost-optimization-hub.us-east-1.amazonaws.com",
        respond: (request: DataSourceHttpRequest): FakeResponse => {
          if (targetOf(request).endsWith(".GetRecommendation")) {
            return data.details(String(bodyOf(request)["recommendationId"]));
          }

          return json({ items: data.items });
        },
      },
    ]);
  }

  const ITEMS: Array<JSONObject> = [
    {
      recommendationId: "sp-1",
      accountId: "123456789012",
      actionType: "PurchaseSavingsPlans",
      currentResourceType: "ComputeSavingsPlans",
      estimatedMonthlySavings: 318.2,
      estimatedMonthlyCost: 912.5,
      currencyCode: "USD",
    },
    {
      recommendationId: "ri-1",
      accountId: "123456789012",
      actionType: "PurchaseReservedInstances",
      currentResourceType: "Ec2ReservedInstances",
      estimatedMonthlySavings: 120,
      currencyCode: "USD",
    },
    // Not a commitment: no details asked.
    {
      recommendationId: "rs-1",
      accountId: "123456789012",
      actionType: "Rightsize",
      currentResourceType: "Ec2Instance",
      estimatedMonthlySavings: 40,
      currencyCode: "USD",
    },
  ];

  test("each commitment's details are read and kept on it; nothing else is asked", async () => {
    const api: FakeProviderApi = hub({
      items: ITEMS,
      details: (recommendationId: string): FakeResponse => {
        return json(
          recommendationId === "sp-1"
            ? SAVINGS_PLANS_DETAILS
            : RESERVED_INSTANCES_DETAILS,
        );
      },
    });

    const read: {
      recommendations: Array<CloudSavingRecord>;
      complete: boolean;
    } = await readAwsCostOptimizationHub({
      credentials: CREDENTIALS,
      region: "us-east-1",
      options: options(api),
      budget: new CloudReadBudget({ maxRequests: 50, maxDurationMs: 60_000 }),
    });

    const byId: Map<string, CloudSavingRecord> = new Map(
      read.recommendations.map(
        (record: CloudSavingRecord): [string, CloudSavingRecord] => {
          return [record.recommendationId, record];
        },
      ),
    );

    expect(byId.get("sp-1")!.kind).toBe(CloudSavingKind.Commitment);
    expect(byId.get("sp-1")!.commitmentDetails).toMatchObject({
      termMonths: 12,
      hourlyCommitment: 1.25,
    });
    expect(byId.get("ri-1")!.commitmentDetails).toMatchObject({
      termMonths: 36,
      quantity: 4,
    });
    expect(byId.get("rs-1")!.commitmentDetails).toBeUndefined();
    expect(
      api.requests
        .filter((request: DataSourceHttpRequest): boolean => {
          return targetOf(request).endsWith(".GetRecommendation");
        })
        .map((request: DataSourceHttpRequest): unknown => {
          return bodyOf(request)["recommendationId"];
        }),
    ).toEqual(["sp-1", "ri-1"]);
  });

  test("details that cannot be read leave the recommendation its saving", async () => {
    const api: FakeProviderApi = hub({
      items: ITEMS,
      details: (): FakeResponse => {
        return json(
          {
            __type: "AccessDeniedException",
            message:
              "User is not authorized to perform: cost-optimization-hub:GetRecommendation",
          },
          400,
        );
      },
    });

    const read: {
      recommendations: Array<CloudSavingRecord>;
      complete: boolean;
    } = await readAwsCostOptimizationHub({
      credentials: CREDENTIALS,
      region: "us-east-1",
      options: options(api),
      budget: new CloudReadBudget({ maxRequests: 50, maxDurationMs: 60_000 }),
    });

    expect(read.complete).toBe(true);
    expect(read.recommendations).toHaveLength(3);
    expect(
      read.recommendations.every((record: CloudSavingRecord): boolean => {
        return record.commitmentDetails === undefined;
      }),
    ).toBe(true);
  });

  test("a refused credential is thrown, as every read throws it", async () => {
    const api: FakeProviderApi = hub({
      items: ITEMS,
      details: (): FakeResponse => {
        return json(
          {
            __type: "UnrecognizedClientException",
            message: "The security token included in the request is invalid.",
          },
          400,
        );
      },
    });

    await expect(
      readAwsCostOptimizationHub({
        credentials: CREDENTIALS,
        region: "us-east-1",
        options: options(api),
        budget: new CloudReadBudget({
          maxRequests: 50,
          maxDurationMs: 60_000,
        }),
      }),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  test(`no more than ${AWS_COMMITMENT_DETAILS_MAX} commitments' details a read`, async () => {
    const many: Array<JSONObject> = [];

    for (
      let index: number = 0;
      index < AWS_COMMITMENT_DETAILS_MAX + 5;
      index++
    ) {
      many.push({
        recommendationId: `sp-${index}`,
        accountId: "123456789012",
        actionType: "PurchaseSavingsPlans",
        currentResourceType: "ComputeSavingsPlans",
        estimatedMonthlySavings: 10,
        currencyCode: "USD",
      });
    }

    const api: FakeProviderApi = hub({
      items: many,
      details: (): FakeResponse => {
        return json(SAVINGS_PLANS_DETAILS);
      },
    });

    await readAwsCostOptimizationHub({
      credentials: CREDENTIALS,
      region: "us-east-1",
      options: options(api),
      budget: new CloudReadBudget({ maxRequests: 200, maxDurationMs: 60_000 }),
    });

    expect(
      api.requests.filter((request: DataSourceHttpRequest): boolean => {
        return targetOf(request).endsWith(".GetRecommendation");
      }),
    ).toHaveLength(AWS_COMMITMENT_DETAILS_MAX);
  });
});

describe("Google Cloud's billing export, on each basis", () => {
  const TABLE: string =
    "billing-proj.billing.gcp_billing_export_resource_v1_010101_ABCDEF_234567";

  test("amortized takes the commitments' credits off the charge, net every credit", () => {
    const query: string = buildGcpBillingExportQuery(TABLE);

    expect(query).toContain("SUM(cost) AS cost,");
    expect(query).toContain(
      `WHERE credit.type IN (${GCP_AMORTIZED_CREDIT_TYPES.map(
        (type: string): string => {
          return `'${type}'`;
        },
      ).join(", ")})), 0)) AS amortized_cost`,
    );
    expect(query).toContain(
      "SUM(cost + IFNULL((SELECT SUM(credit.amount) FROM UNNEST(credits) AS credit), 0)) AS net_cost",
    );
    // A group whose three figures are all nothing is no row.
    expect(query).toContain(
      "HAVING cost != 0 OR amortized_cost != 0 OR net_cost != 0",
    );
  });

  test("the commitments' credits: committed use discounts, old and new, their fee's offset and a subscription's", () => {
    expect(GCP_AMORTIZED_CREDIT_TYPES).toEqual([
      "COMMITTED_USAGE_DISCOUNT",
      "COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE",
      "FEE_UTILIZATION_OFFSET",
      "SUBSCRIPTION_BENEFIT",
    ]);
    // Promotions, the free tier and negotiated discounts are net's alone.
    for (const credit of [
      "PROMOTION",
      "FREE_TIER",
      "SUSTAINED_USAGE_DISCOUNT",
      "DISCOUNT",
      "RESELLER_MARGIN",
    ]) {
      expect(GCP_AMORTIZED_CREDIT_TYPES).not.toContain(credit);
    }
  });
});
