import { describe, expect, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTotals,
  CloudSavingKind,
  CloudSavingsTotals,
  totalCloudCosts,
  totalCloudSavings,
} from "../../../Types/Cloud/CloudCost";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { CloudStatTile } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatStrip";
import {
  ACCOUNTS_TILE,
  ALL_ACCOUNTS_READING,
  COSTS_NOT_READ_YET,
  NEEDS_ATTENTION_TILE,
  NOTHING_NEEDS_A_LOOK,
  NO_RECOMMENDATIONS,
  RECOMMENDATIONS_NOT_READ_YET,
  RESOURCES_TILE,
  getCloudCostTiles,
  getCloudOverviewTiles,
  getCloudSavingsTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudOverviewTiles";
import {
  PROJECTED_MONTH,
  SAVINGS_AVAILABLE,
  SO_FAR_THIS_MONTH,
  SPEND_THIS_MONTH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostWords";

/*
 * The numbers on top of Cloud's Overview - the accounts and whether they
 * are read, the resources, what needs attention, the month's spend - and on
 * top of Costs and Savings: each tile's value, its line under it, its tone
 * and where it leads.
 */

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const T: Translator = createTranslator(undefined, "en");
const ROUTES: { accounts: Route; resources: Route; costs: Route } = {
  accounts: new Route("/dashboard/p/cloud/accounts"),
  resources: new Route("/dashboard/p/cloud/resources"),
  costs: new Route("/dashboard/p/cloud/costs"),
};

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 4120,
    lastMonth: 6000,
    monthFullDays: 4120,
    lastMonthToDate: 3680,
    projectedMonth: 6300,
    last30Days: 5800,
    topServices: [],
    readAt: NOW.toISOString(),
    ...overrides,
  };
}

function tile(tiles: Array<CloudStatTile>, key: string): CloudStatTile {
  return tiles.find((entry: CloudStatTile): boolean => {
    return entry.key === key;
  })!;
}

const READING: { lastSeenAt: Date; hasConnection: boolean } = {
  lastSeenAt: new Date(NOW.getTime() - 5 * 60 * 1000),
  hasConnection: true,
};
const QUIET: { lastSeenAt: Date; hasConnection: boolean } = {
  lastSeenAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
  hasConnection: true,
};

describe("the Overview's strip", () => {
  test("four tiles: the accounts, the resources, what needs attention, the month's spend", () => {
    const tiles: Array<CloudStatTile> = getCloudOverviewTiles({
      accounts: [READING, READING],
      resources: 1248,
      costs: totalCloudCosts([summary()]),
      attention: { unhealthy: 0, degraded: 0, isMore: false },
      now: NOW,
      translator: T,
      routes: ROUTES,
    });

    expect(
      tiles.map((entry: CloudStatTile) => {
        return [entry.key, entry.title];
      }),
    ).toEqual([
      ["accounts", ACCOUNTS_TILE],
      ["resources", RESOURCES_TILE],
      ["attention", NEEDS_ATTENTION_TILE],
      ["spend", SPEND_THIS_MONTH],
    ]);

    expect(tile(tiles, "accounts")).toMatchObject({
      value: "2",
      sublabel: ALL_ACCOUNTS_READING,
      tone: "neutral",
      to: ROUTES.accounts,
    });
    expect(tile(tiles, "resources")).toMatchObject({
      value: "1,248",
      to: ROUTES.resources,
    });
    expect(tile(tiles, "attention")).toMatchObject({
      value: "0",
      sublabel: NOTHING_NEEDS_A_LOOK,
      tone: "neutral",
      loading: false,
    });
    // $4,120 against $3,680 by the same day of last month: 12% more.
    expect(tile(tiles, "spend")).toMatchObject({
      value: "$4,120",
      sublabel: "12% more than last month by now",
      to: ROUTES.costs,
    });
  });

  test("the month is compared over its full days: the newest day, read in part, is no fall", () => {
    /*
     * $4,000 over the full days against $4,000 last month: the same, though
     * the month so far ($4,120) has the newest day's first hours in it.
     */
    const same: Array<CloudStatTile> = getCloudOverviewTiles({
      accounts: [READING],
      resources: 1,
      costs: totalCloudCosts([
        summary({ monthFullDays: 4000, lastMonthToDate: 4000 }),
      ]),
      attention: { unhealthy: 0, degraded: 0, isMore: false },
      now: NOW,
      translator: T,
      routes: ROUTES,
    });

    expect(tile(same, "spend")).toMatchObject({
      value: "$4,120",
      sublabel: "The same as last month by now",
    });

    // A month's first day: no full day to compare, so no comparison.
    const firstDay: Array<CloudStatTile> = getCloudOverviewTiles({
      accounts: [READING],
      resources: 1,
      costs: totalCloudCosts([
        summary({ monthToDate: 120, monthFullDays: 0, lastMonthToDate: 0 }),
      ]),
      attention: { unhealthy: 0, degraded: 0, isMore: false },
      now: NOW,
      translator: T,
      routes: ROUTES,
    });

    expect(tile(firstDay, "spend")).toMatchObject({
      value: "$120.00",
      sublabel: SO_FAR_THIS_MONTH,
    });

    // The Costs strip says the same.
    expect(
      tile(
        getCloudCostTiles({
          costs: totalCloudCosts([
            summary({ monthFullDays: 4000, lastMonthToDate: 4000 }),
          ]),
          savings: totalCloudSavings({ summaries: [] }),
          translator: T,
        }),
        "spend",
      ),
    ).toMatchObject({ sublabel: "The same as last month by now" });
  });

  test("accounts not read lately, and resources unhealthy or degraded, say how many and are toned", () => {
    const tiles: Array<CloudStatTile> = getCloudOverviewTiles({
      accounts: [READING, QUIET, { lastSeenAt: null, hasConnection: false }],
      resources: 3,
      costs: totalCloudCosts([]),
      attention: { unhealthy: 2, degraded: 5, isMore: false },
      now: NOW,
      translator: T,
      routes: ROUTES,
    });

    expect(tile(tiles, "accounts")).toMatchObject({
      sublabel: "2 not read lately",
      tone: "warning",
    });
    expect(tile(tiles, "attention")).toMatchObject({
      value: "7",
      sublabel: "2 unhealthy",
      tone: "danger",
    });

    expect(
      tile(
        getCloudOverviewTiles({
          accounts: [READING],
          resources: 3,
          costs: totalCloudCosts([]),
          attention: { unhealthy: 0, degraded: 1, isMore: true },
          now: NOW,
          translator: T,
          routes: ROUTES,
        }),
        "attention",
      ),
    ).toMatchObject({ value: "1+", sublabel: "1 degraded", tone: "warning" });
  });

  test("while the resources are read the count is loading; when they could not be, it is not known", () => {
    const loading: CloudStatTile = tile(
      getCloudOverviewTiles({
        accounts: [READING],
        resources: 1,
        costs: totalCloudCosts([]),
        attention: null,
        now: NOW,
        translator: T,
        routes: ROUTES,
      }),
      "attention",
    );
    const failed: CloudStatTile = tile(
      getCloudOverviewTiles({
        accounts: [READING],
        resources: 1,
        costs: totalCloudCosts([]),
        attention: null,
        attentionFailed: true,
        now: NOW,
        translator: T,
        routes: ROUTES,
      }),
      "attention",
    );

    expect(loading.loading).toBe(true);
    expect(failed.loading).toBe(false);
    expect(failed.value).toBe("—");
  });

  test("before any account's costs are read, the spend tile leads to how to read them", () => {
    expect(
      tile(
        getCloudOverviewTiles({
          accounts: [READING],
          resources: 1,
          costs: totalCloudCosts([summary({ state: CloudCostState.NotSetUp })]),
          attention: null,
          now: NOW,
          translator: T,
          routes: ROUTES,
        }),
        "spend",
      ),
    ).toMatchObject({
      value: "—",
      sublabel: COSTS_NOT_READ_YET,
      to: ROUTES.costs,
    });
  });
});

describe("the Costs and Savings strips", () => {
  const costs: CloudCostTotals = totalCloudCosts([summary()]);
  const savings: CloudSavingsTotals = totalCloudSavings({
    summaries: [
      {
        state: CloudCostState.Reading,
        count: 3,
        monthlySavings: 310,
        byKind: {
          [CloudSavingKind.Rightsize]: { count: 2, monthlySavings: 260 },
          [CloudSavingKind.Commitment]: { count: 1, monthlySavings: 50 },
        },
        currency: "USD",
        readAt: NOW.toISOString(),
      },
    ],
    currency: "USD",
  });

  test("the month so far, where it is heading, last month, and what could be saved", () => {
    const tiles: Array<CloudStatTile> = getCloudCostTiles({
      costs,
      savings,
      translator: T,
      savingsRoute: new Route("/dashboard/p/cloud/savings"),
    });

    expect(
      tiles.map((entry: CloudStatTile) => {
        return [entry.title, entry.value];
      }),
    ).toEqual([
      [SPEND_THIS_MONTH, "$4,120"],
      [PROJECTED_MONTH, "$6,300"],
      ["Last month", "$6,000"],
      [SAVINGS_AVAILABLE, "$310.00"],
    ]);
    expect(tile(tiles, "last-month").sublabel).toBe(
      "$5,800 in the last 30 days",
    );
    expect(tile(tiles, "savings")).toMatchObject({
      sublabel: "3 recommendations",
      tone: "positive",
    });
  });

  test("no account's recommendations read is not nothing to save; one read with none is", () => {
    const notRead: CloudStatTile = tile(
      getCloudCostTiles({
        costs,
        savings: totalCloudSavings({ summaries: [null], currency: "USD" }),
        translator: T,
      }),
      "savings",
    );
    const noneFound: CloudStatTile = tile(
      getCloudCostTiles({
        costs,
        savings: totalCloudSavings({
          summaries: [
            {
              state: CloudCostState.Reading,
              count: 0,
              monthlySavings: 0,
              byKind: {},
              currency: "USD",
              readAt: NOW.toISOString(),
            },
          ],
          currency: "USD",
        }),
        translator: T,
      }),
      "savings",
    );

    expect(notRead).toMatchObject({
      value: "—",
      sublabel: RECOMMENDATIONS_NOT_READ_YET,
      tone: "neutral",
    });
    expect(noneFound).toMatchObject({
      value: "$0.00",
      sublabel: NO_RECOMMENDATIONS,
      tone: "neutral",
    });
  });

  test("the Savings strip: in all, then by the three ways most of it comes from", () => {
    const tiles: Array<CloudStatTile> = getCloudSavingsTiles({
      savings,
      translator: T,
    });

    expect(
      tiles.map((entry: CloudStatTile) => {
        return [entry.key, entry.value, entry.sublabel];
      }),
    ).toEqual([
      ["savings", "$310.00", "3 recommendations"],
      [CloudSavingKind.Rightsize, "$260.00", "2 recommendations"],
      [CloudSavingKind.Idle, "$0.00", NO_RECOMMENDATIONS],
      [CloudSavingKind.Commitment, "$50.00", "1 recommendation"],
    ]);
    expect(tile(tiles, CloudSavingKind.Idle).tone).toBe("neutral");
  });
});
