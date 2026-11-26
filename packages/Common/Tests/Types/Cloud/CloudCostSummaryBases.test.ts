import {
  CloudAccountCostSummary,
  CloudCostState,
  CloudCostTotals,
  getCloudAccountCostSummaryInBasis,
  hasCloudCostBasisFigures,
  readCloudAccountCostSummary,
  toCloudCostBasisFigures,
  totalCloudCostsInBasis,
} from "../../../Types/Cloud/CloudCost";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import { describe, expect, test } from "@jest/globals";

/*
 * An account's summary on each basis (#11007): its billed figures at the
 * top, its amortized and net ones beside them - and every page and budget
 * reading the basis it shows, the billed figures standing in until the
 * account's costs are read with the bases.
 */

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 9000,
    lastMonth: 3000,
    monthFullDays: 8800,
    lastMonthToDate: 2500,
    projectedMonth: 11000,
    last30Days: 9500,
    topServices: [
      { service: "Savings Plans for AWS Compute usage", amount: 8760 },
    ],
    latestDay: "2026-11-19",
    anomalies: [{ day: "2026-11-03", service: "", amount: 8790, usual: 30 }],
    readAt: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

// A Savings Plan bought all upfront on Nov 3: billed spikes, amortized does not.
const AMORTIZED: CloudAccountCostSummary = summary({
  monthToDate: 1200,
  lastMonth: 3000,
  monthFullDays: 1140,
  lastMonthToDate: 2500,
  projectedMonth: 1800,
  last30Days: 1700,
  topServices: [{ service: "Amazon EC2", amount: 1100 }],
  anomalies: undefined,
});

const NET: CloudAccountCostSummary = summary({
  monthToDate: 1000,
  lastMonth: 2800,
  monthFullDays: 950,
  lastMonthToDate: 2300,
  projectedMonth: 1550,
  last30Days: 1450,
  topServices: [{ service: "Amazon EC2", amount: 950 }],
  anomalies: undefined,
});

const WITH_BASES: CloudAccountCostSummary = summary({
  bases: {
    amortized: toCloudCostBasisFigures(AMORTIZED),
    net: toCloudCostBasisFigures(NET),
  },
});

describe("a summary on a basis", () => {
  test("billed is the summary itself", () => {
    expect(
      getCloudAccountCostSummaryInBasis(WITH_BASES, CloudCostBasis.Billed),
    ).toBe(WITH_BASES);
  });

  test("amortized swaps in its figures, unusual days and services, and keeps the rest", () => {
    const amortized: CloudAccountCostSummary =
      getCloudAccountCostSummaryInBasis(WITH_BASES, CloudCostBasis.Amortized);

    expect(amortized.monthToDate).toBe(1200);
    expect(amortized.projectedMonth).toBe(1800);
    expect(amortized.lastMonth).toBe(3000);
    expect(amortized.last30Days).toBe(1700);
    expect(amortized.monthFullDays).toBe(1140);
    expect(amortized.lastMonthToDate).toBe(2500);
    expect(amortized.topServices).toEqual([
      { service: "Amazon EC2", amount: 1100 },
    ]);
    // The upfront purchase is an unusual day billed, and an ordinary one amortized.
    expect(amortized.anomalies).toBeUndefined();
    expect(amortized.state).toBe(CloudCostState.Reading);
    expect(amortized.currency).toBe("USD");
    expect(amortized.readAt).toBe(WITH_BASES.readAt);
  });

  test("net swaps in its own", () => {
    const net: CloudAccountCostSummary = getCloudAccountCostSummaryInBasis(
      WITH_BASES,
      CloudCostBasis.Net,
    );

    expect(net.monthToDate).toBe(1000);
    expect(net.projectedMonth).toBe(1550);
  });

  test("a summary written before the bases reads its billed figures on every basis", () => {
    const old: CloudAccountCostSummary = summary();

    expect(
      getCloudAccountCostSummaryInBasis(old, CloudCostBasis.Amortized),
    ).toBe(old);
    expect(getCloudAccountCostSummaryInBasis(old, CloudCostBasis.Net)).toBe(
      old,
    );
    expect(hasCloudCostBasisFigures(old, CloudCostBasis.Billed)).toBe(true);
    expect(hasCloudCostBasisFigures(old, CloudCostBasis.Amortized)).toBe(false);
    expect(hasCloudCostBasisFigures(WITH_BASES, CloudCostBasis.Net)).toBe(true);
    expect(hasCloudCostBasisFigures(null, CloudCostBasis.Billed)).toBe(false);
  });

  test("a basis's latest day stands in for the summary's only when it has one", () => {
    const figures: CloudAccountCostSummary = summary({
      bases: {
        amortized: {
          ...toCloudCostBasisFigures(AMORTIZED),
          latestDay: undefined,
        },
      },
    });

    expect(
      getCloudAccountCostSummaryInBasis(figures, CloudCostBasis.Amortized)
        .latestDay,
    ).toBe("2026-11-19");
  });
});

describe("a summary stored and read back", () => {
  test("keeps its amortized and net figures", () => {
    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary(
      JSON.parse(JSON.stringify(WITH_BASES)),
    );

    expect(read).not.toBeNull();
    expect(read!.bases?.amortized?.monthToDate).toBe(1200);
    expect(read!.bases?.net?.projectedMonth).toBe(1550);
    expect(read!.bases?.amortized?.topServices).toEqual([
      { service: "Amazon EC2", amount: 1100 },
    ]);
    expect(read!.monthToDate).toBe(9000);
    expect(read!.anomalies).toHaveLength(1);
  });

  test("leaves out what is not a basis or not figures, and a billed entry", () => {
    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary({
      ...JSON.parse(JSON.stringify(summary())),
      bases: {
        billed: { monthToDate: 1 },
        gross: { monthToDate: 2 },
        net: "nonsense",
        amortized: { monthToDate: "12.5", topServices: "no" },
      },
    });

    expect(Object.keys(read!.bases || {})).toEqual(["amortized"]);
    expect(read!.bases!.amortized!.monthToDate).toBe(12.5);
    expect(read!.bases!.amortized!.topServices).toEqual([]);
  });

  test("a summary with no bases reads none", () => {
    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary(
      JSON.parse(JSON.stringify(summary())),
    );

    expect(read!.bases).toBeUndefined();
    expect(
      readCloudAccountCostSummary({ ...summary(), bases: {} })!.bases,
    ).toBeUndefined();
  });
});

describe("several accounts on a basis", () => {
  test("add up each account's figures on the basis, the billed ones where it has none yet", () => {
    const totals: CloudCostTotals = totalCloudCostsInBasis(
      [WITH_BASES, summary(), null],
      CloudCostBasis.Amortized,
    );

    // 1200 amortized + 9000 billed, from an account not yet read on the bases.
    expect(totals.monthToDate).toBe(10200);
    expect(totals.accountsRead).toBe(2);
  });

  test("billed adds the billed figures", () => {
    expect(
      totalCloudCostsInBasis([WITH_BASES], CloudCostBasis.Billed).monthToDate,
    ).toBe(9000);
  });
});
