import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudCostState,
  CloudSavingKind,
} from "../../../Types/Cloud/CloudCost";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import {
  CloudAccountRow,
  CloudAccountsTotals,
  fetchCloudAccounts,
  toCloudAccountRow,
  totalCloudAccounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import {
  CloudSavingsSummary,
  fetchCloudSavings,
  summarizeCloudSavings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSavingsReads";

/*
 * The accounts as the Cloud Overview, Costs, Savings and Budgets read them -
 * one list read, the summaries on each - and every account as one: costs in
 * the currency most are billed in, savings in the costs' currency, the
 * resources added up. And the ways to spend less a page lists, the largest
 * first.
 */

const WEB: string = "10000000-0000-4000-8000-0000000000b1";
const DATA: string = "10000000-0000-4000-8000-0000000000b2";
const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const READ_AT: string = "2026-11-20T00:00:00.000Z";

// An account as the API answers it: its stored columns, typed loosely.
function account(data: Record<string, unknown>): CloudAccount {
  const model: CloudAccount = new CloudAccount();
  Object.assign(model, data);
  return model;
}

function costSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 100,
    lastMonth: 300,
    monthFullDays: 100,
    lastMonthToDate: 90,
    projectedMonth: 310,
    last30Days: 290,
    topServices: [{ service: "Amazon EC2", amount: 80 }],
    readAt: READ_AT,
    ...overrides,
  };
}

function savingsSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: CloudCostState.Reading,
    count: 2,
    monthlySavings: 40,
    byKind: { [CloudSavingKind.Idle]: { count: 2, monthlySavings: 40 } },
    currency: "USD",
    readAt: READ_AT,
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an account's row", () => {
  test("its name, how it is read, its resources and its summaries", () => {
    const row: CloudAccountRow | null = toCloudAccountRow(
      account({
        _id: WEB,
        name: "Production",
        provider: "aws",
        accountId: "123456789012",
        lastSeenAt: new Date(READ_AT),
        cloudConnectionId: new ObjectID(DATA),
        resourceCount: "42" as unknown as number,
        costSummary: costSummary(),
        savingsSummary: savingsSummary(),
      }),
    );

    expect(row).toMatchObject({
      name: "Production",
      provider: "aws",
      accountId: "123456789012",
      hasConnection: true,
      resourceCount: 42,
    });
    expect(row!.id.toString()).toBe(WEB);
    expect(row!.lastSeenAt).toEqual(new Date(READ_AT));
    expect(row!.costSummary).toMatchObject({ monthToDate: 100 });
    expect(row!.savingsSummary).toMatchObject({ count: 2 });
  });

  test("named after its cloud's name, or its id, when it has none of its own; a malformed summary is none", () => {
    expect(
      toCloudAccountRow(
        account({
          _id: WEB,
          providerAccountName: "shop-prod",
          accountId: "shop-prod-123",
        }),
      ),
    ).toMatchObject({
      name: "shop-prod",
      hasConnection: false,
      lastSeenAt: null,
      resourceCount: 0,
      costSummary: null,
      savingsSummary: null,
    });
    expect(
      toCloudAccountRow(
        account({
          _id: WEB,
          accountId: "shop-prod-123",
          costSummary: { state: "nonsense" },
          savingsSummary: ["not", "a", "summary"] as unknown as object,
        }),
      ),
    ).toMatchObject({
      name: "shop-prod-123",
      costSummary: null,
      savingsSummary: null,
    });
    // A row with no id is not one.
    expect(toCloudAccountRow(account({ name: "No id" }))).toBeNull();
  });
});

describe("every account as one", () => {
  function row(overrides: Partial<CloudAccountRow>): CloudAccountRow {
    return {
      id: new ObjectID(WEB),
      name: "",
      provider: "aws",
      accountId: "",
      lastSeenAt: null,
      hasConnection: true,
      resourceCount: 0,
      costSummary: null,
      savingsSummary: null,
      ...overrides,
    };
  }

  test("costs in the currency most accounts are in, savings in the same one, resources added up", () => {
    const rows: Array<CloudAccountRow> = [
      row({
        resourceCount: 10,
        costSummary: toCloudAccountRow(
          account({ _id: WEB, costSummary: costSummary() }),
        )!.costSummary,
        savingsSummary: toCloudAccountRow(
          account({ _id: WEB, savingsSummary: savingsSummary() }),
        )!.savingsSummary,
      }),
      row({
        resourceCount: 5,
        costSummary: toCloudAccountRow(
          account({
            _id: DATA,
            costSummary: costSummary({ monthToDate: 50 }),
          }),
        )!.costSummary,
      }),
      row({
        resourceCount: 7,
        costSummary: toCloudAccountRow(
          account({
            _id: DATA,
            costSummary: costSummary({ currency: "EUR", monthToDate: 999 }),
          }),
        )!.costSummary,
        savingsSummary: toCloudAccountRow(
          account({
            _id: DATA,
            savingsSummary: savingsSummary({
              currency: "EUR",
              monthlySavings: 500,
            }),
          }),
        )!.savingsSummary,
      }),
    ];

    const totals: CloudAccountsTotals = totalCloudAccounts(rows);

    expect(totals.resources).toBe(22);
    expect(totals.costs).toMatchObject({
      currency: "USD",
      monthToDate: 150,
      accountsRead: 2,
      accountsInOtherCurrencies: 1,
    });
    expect(totals.savings).toMatchObject({
      currency: "USD",
      monthlySavings: 40,
      count: 2,
      accountsInOtherCurrencies: 1,
    });
  });

  test("no account read: nothing to add up", () => {
    const totals: CloudAccountsTotals = totalCloudAccounts([]);

    expect(totals.resources).toBe(0);
    expect(totals.costs.accountsRead).toBe(0);
    expect(totals.savings.count).toBe(0);
  });
});

describe("the reads", () => {
  test("the accounts in one list read: every one, or the one of an account's tab", async () => {
    const list: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockResolvedValue({
      data: [
        account({ _id: WEB, name: "Production", provider: "aws" }),
        account({ name: "Not saved yet" }),
      ],
      count: 2,
      skip: 0,
      limit: 2000,
    });

    const rows: Array<CloudAccountRow> = await fetchCloudAccounts();

    expect(
      rows.map((entry: CloudAccountRow) => {
        return entry.name;
      }),
    ).toEqual(["Production"]);

    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = list.mock.calls[0]![0];
    expect(request.modelType).toBe(CloudAccount);
    expect(request.query).toEqual({});
    expect(request.select).toMatchObject({
      costSummary: true,
      savingsSummary: true,
      resourceCount: true,
      cloudConnectionId: true,
    });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });

    await fetchCloudAccounts(new ObjectID(WEB));
    expect(list.mock.calls[1]![0].query).toEqual({ _id: new ObjectID(WEB) });
  });

  test("the ways to spend less: the project's, largest first, the page's few", async () => {
    const list: jest.SpyInstance<any, any> = getJestSpyOn(
      ModelAPI,
      "getList",
    ).mockResolvedValue({ data: [], count: 0, skip: 0, limit: 3 });

    await fetchCloudSavings({
      projectId: PROJECT,
      query: { cloudAccountId: new ObjectID(WEB) },
      limit: 3,
    });

    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    } = list.mock.calls[0]![0];
    expect(request.modelType).toBe(CloudCostRecommendation);
    expect(request.query).toEqual({
      projectId: PROJECT,
      cloudAccountId: new ObjectID(WEB),
    });
    expect(request.sort).toEqual({ monthlySavings: SortOrder.Descending });
    expect(request.limit).toBe(3);

    await fetchCloudSavings({ projectId: PROJECT });
    expect(list.mock.calls[1]![0].limit).toBe(LIMIT_PER_PROJECT);
  });

  test("what they save, by kind, in one currency, the largest kept", () => {
    function recommendation(
      monthlySavings: number,
      kind: CloudSavingKind | undefined,
      currency?: string,
    ): CloudCostRecommendation {
      const model: CloudCostRecommendation = new CloudCostRecommendation();
      model.monthlySavings = monthlySavings;
      if (kind) {
        model.kind = kind;
      }
      if (currency) {
        model.currency = currency;
      }
      return model;
    }

    const summary: CloudSavingsSummary = summarizeCloudSavings({
      recommendations: [
        recommendation(10.111, CloudSavingKind.Idle, "usd"),
        recommendation(90, CloudSavingKind.Rightsize),
        recommendation(5, undefined, "USD"),
        recommendation(700, CloudSavingKind.Rightsize, "EUR"),
      ],
      currency: "USD",
      top: 2,
    });

    expect(summary.count).toBe(3);
    expect(summary.monthlySavings).toBe(105.11);
    expect(summary.byKind.get(CloudSavingKind.Rightsize)).toEqual({
      count: 1,
      monthlySavings: 90,
    });
    // A recommendation of no kind is counted as another way.
    expect(summary.byKind.get(CloudSavingKind.Other)?.count).toBe(1);
    expect(
      summary.top.map((entry: CloudCostRecommendation) => {
        return entry.monthlySavings;
      }),
    ).toEqual([90, 10.111]);
  });
});
