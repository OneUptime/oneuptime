import CloudCostRecommendation from "../../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudBudgetService, {
  CLOUD_BUDGET_AMOUNT_ERROR,
  CLOUD_BUDGET_CURRENCY_ERROR,
} from "../../../../Server/Services/CloudBudgetService";
import CloudCostRecommendationService from "../../../../Server/Services/CloudCostRecommendationService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import { CloudSavingRecord } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudSavingsWriter, {
  CLOUD_SAVINGS_MAX_PER_ACCOUNT,
  CloudSavingsWriteResult,
  getSavingResourceKey,
} from "../../../../Server/Utils/CloudConnection/CloudSavingsWriter";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import { CloudSavingKind } from "../../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The ways to spend less, kept in step with each cloud's recommender: a new
 * recommendation is created, one read again is brought up to date, one the
 * recommender no longer makes is removed - for the accounts read only - and
 * each is linked to the resource it is about when OneUptime holds it. And
 * the budget service's guards on what a budget is written with.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const ACCOUNT_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b1",
);
const OTHER_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000b2",
);
const RESOURCE_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000c1",
);
const EXISTING_ROW: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-0000000000d1",
);
const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const ARN: string = "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc";

function saving(overrides: Partial<CloudSavingRecord>): CloudSavingRecord {
  return {
    recommendationId: "rec-1",
    accountId: "123456789012",
    region: "us-east-1",
    resourceId: ARN,
    resourceType: "EC2 instance",
    resourceName: "i-0abc",
    kind: CloudSavingKind.Rightsize,
    action: "Rightsize",
    currentConfiguration: "m5.2xlarge",
    recommendedConfiguration: "m5.xlarge",
    monthlySavings: 61.326,
    monthlyCost: 280.333,
    currency: "USD",
    effort: "Low",
    source: "AWS Cost Optimization Hub",
    ...overrides,
  };
}

describe("keeping the ways to spend less in step", () => {
  let created: Array<CloudCostRecommendation> = [];
  let updated: Array<{ id: string; data: Partial<CloudCostRecommendation> }> =
    [];
  let removed: Array<unknown> = [];
  let existing: Array<CloudCostRecommendation> = [];

  beforeEach(() => {
    created = [];
    updated = [];
    removed = [];
    existing = [];

    jest
      .spyOn(CloudResourceService, "findBy")
      .mockImplementation(async (): Promise<Array<CloudResource>> => {
        const resource: CloudResource = new CloudResource();
        resource.id = RESOURCE_ROW;
        // Matched in any case.
        resource.providerResourceId = ARN.toUpperCase();
        return [resource];
      });
    jest
      .spyOn(CloudCostRecommendationService, "findBy")
      .mockImplementation(
        async (): Promise<Array<CloudCostRecommendation>> => {
          return existing;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "updateOneById")
      .mockImplementation(
        async (input: { id: ObjectID; data: unknown }): Promise<number> => {
          updated.push({
            id: input.id.toString(),
            data: input.data as Partial<CloudCostRecommendation>,
          });
          return 1;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "create")
      .mockImplementation(
        async (input: {
          data: CloudCostRecommendation;
        }): Promise<CloudCostRecommendation> => {
          created.push(input.data);
          return input.data;
        },
      );
    jest
      .spyOn(CloudCostRecommendationService, "hardDeleteBy")
      .mockImplementation(async (input: unknown): Promise<number> => {
        removed.push(input);
        return 3;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a new recommendation is created, linked to its resource; one read again is brought up to date", async () => {
    const row: CloudCostRecommendation = new CloudCostRecommendation();
    row.id = EXISTING_ROW;
    row.recommendationId = "rec-2";
    existing = [row];

    const result: CloudSavingsWriteResult = await CloudSavingsWriter.write({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      accountRows: new Map([
        ["123456789012", ACCOUNT_ROW],
        ["210987654321", OTHER_ROW],
      ]),
      accountsRead: new Set(["123456789012"]),
      recommendations: [
        saving({}),
        saving({
          recommendationId: "rec-2",
          resourceId: "",
          kind: CloudSavingKind.Commitment,
          action: "",
          monthlySavings: 10,
          monthlyCost: null,
        }),
        // An account that could not be read is left alone.
        saving({ recommendationId: "rec-3", accountId: "210987654321" }),
      ],
      now: NOW,
    });

    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.removed).toBe(3);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      recommendationId: "rec-1",
      provider: CloudProvider.AWS,
      kind: CloudSavingKind.Rightsize,
      action: "Rightsize",
      monthlySavings: 61.33,
      monthlyCost: 280.33,
      currency: "USD",
      lastSeenAt: NOW,
    });
    expect(created[0]!.projectId?.toString()).toBe(PROJECT.toString());
    expect(created[0]!.cloudAccountId?.toString()).toBe(ACCOUNT_ROW.toString());
    expect(created[0]!.cloudResourceId?.toString()).toBe(
      RESOURCE_ROW.toString(),
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]!.id).toBe(EXISTING_ROW.toString());
    // A recommendation with no action of its own is to be reviewed.
    expect(updated[0]!.data.action).toBe("Review");
    expect(updated[0]!.data.cloudResourceId).toBeUndefined();

    // Each account read's recommendations, for its summary.
    expect(result.savingsByAccount.get("123456789012")).toEqual([
      { monthlySavings: 61.33, currency: "USD", kind: CloudSavingKind.Rightsize },
      { monthlySavings: 10, currency: "USD", kind: CloudSavingKind.Commitment },
    ]);
    expect(result.savingsByAccount.has("210987654321")).toBe(false);

    // What the recommender no longer makes, of the accounts read only.
    const query: Record<string, unknown> = (
      removed[0] as { query: Record<string, unknown> }
    ).query;
    expect(query["projectId"]).toEqual(PROJECT);
    expect(query["lastSeenAt"]).toEqual(new LessThan<Date>(NOW));
    expect(JSON.stringify(query["cloudAccountId"])).toContain(
      ACCOUNT_ROW.toString(),
    );
    expect(JSON.stringify(query["cloudAccountId"])).not.toContain(
      OTHER_ROW.toString(),
    );
  });

  test("an account keeps its largest recommendations, at most its cap", async () => {
    const many: Array<CloudSavingRecord> = [];

    for (let index: number = 0; index < CLOUD_SAVINGS_MAX_PER_ACCOUNT + 5; index++) {
      many.push(
        saving({
          recommendationId: `rec-${index}`,
          resourceId: "",
          monthlySavings: index + 1,
        }),
      );
    }

    const result: CloudSavingsWriteResult = await CloudSavingsWriter.write({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
      accountsRead: new Set(["123456789012"]),
      recommendations: many,
      now: NOW,
    });

    expect(result.created).toBe(CLOUD_SAVINGS_MAX_PER_ACCOUNT);
    // The five smallest are the ones left out.
    expect(
      created.some((row: CloudCostRecommendation): boolean => {
        return row.recommendationId === "rec-0";
      }),
    ).toBe(false);
  });

  test("no account read touches nothing", async () => {
    const result: CloudSavingsWriteResult = await CloudSavingsWriter.write({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
      accountsRead: new Set(),
      recommendations: [saving({})],
      now: NOW,
    });

    expect(result).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(removed).toHaveLength(0);
  });

  test("a recommendation that could not be kept is logged, and the others are", async () => {
    let calls: number = 0;
    (CloudCostRecommendationService.create as jest.Mock).mockImplementation(
      async (input: unknown): Promise<CloudCostRecommendation> => {
        calls++;
        if (calls === 1) {
          throw new Error("duplicate key");
        }
        const data: CloudCostRecommendation = (
          input as { data: CloudCostRecommendation }
        ).data;
        created.push(data);
        return data;
      },
    );

    const result: CloudSavingsWriteResult = await CloudSavingsWriter.write({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      accountRows: new Map([["123456789012", ACCOUNT_ROW]]),
      accountsRead: new Set(["123456789012"]),
      recommendations: [
        saving({ recommendationId: "a", monthlySavings: 5 }),
        saving({ recommendationId: "b", monthlySavings: 4 }),
      ],
      now: NOW,
    });

    expect(result.created).toBe(1);
    expect(result.savingsByAccount.get("123456789012")).toHaveLength(1);
  });

  test("a resource is matched by its id in its cloud, in any case", () => {
    expect(getSavingResourceKey(" ARN:AWS:EC2:X ")).toBe("arn:aws:ec2:x");
    expect(getSavingResourceKey("")).toBe("");
  });
});

describe("what a budget is written with", () => {
  test("an amount above zero, from a number or a form's text", () => {
    expect(CloudBudgetService.normalizeAmount(5000)).toBe(5000);
    expect(CloudBudgetService.normalizeAmount(" 12.5 ")).toBe(12.5);

    for (const value of [0, -1, "", "abc", null, undefined, Number.NaN]) {
      expect(() => {
        return CloudBudgetService.normalizeAmount(value);
      }).toThrow(CLOUD_BUDGET_AMOUNT_ERROR);
    }
  });

  test("a currency as three letters, in capitals", () => {
    expect(CloudBudgetService.normalizeCurrency(" eur ")).toBe("EUR");

    for (const value of ["", "EURO", "€", 12, null]) {
      expect(() => {
        return CloudBudgetService.normalizeCurrency(value);
      }).toThrow(CLOUD_BUDGET_CURRENCY_ERROR);
    }
  });

  test("thresholds as whole percents, lowest first", () => {
    expect(CloudBudgetService.normalizeThresholds("100, 50,80")).toBe(
      "50,80,100",
    );
    expect(CloudBudgetService.normalizeThresholds("nonsense")).toBe("80,100");
  });
});
