import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COMMITMENT_ALL_COVERED_PERCENT,
  CLOUD_COMMITMENT_ALL_USED_PERCENT,
  CLOUD_COMMITMENT_KINDS,
  CLOUD_COMMITMENT_WINDOW_DAYS,
  CloudCommitmentCoverageLevel,
  CloudCommitmentKind,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
  addCloudCommitmentFigures,
  getCloudCommitmentCoverageLevel,
  getCloudCommitmentCoveragePercent,
  getCloudCommitmentKindLabel,
  getCloudCommitmentUtilizationPercent,
  getCloudCommitmentWindow,
  hasCloudCommitment,
  isCloudCommitmentKind,
  readCloudCommitmentSummary,
  totalCloudCommitments,
} from "../../../Types/Cloud/CloudCommitments";
import {
  CloudCostState,
  readCloudAccountSavingsSummary,
} from "../../../Types/Cloud/CloudCost";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";

/*
 * How much of the spend commitments cover and how much of them is used:
 * the two shares each cloud's billing says them in, the levels the page
 * words them by (nothing to cover, none, some, all), what a stored summary
 * reads back as, and the window they are over.
 */

function figures(
  overrides: Partial<CloudCommitmentKindFigures> = {},
): CloudCommitmentKindFigures {
  return {
    kind: CloudCommitmentKind.SavingsPlans,
    coveredSpend: 0,
    onDemandSpend: 0,
    commitmentSpend: 0,
    unusedSpend: 0,
    ...overrides,
  };
}

function summary(
  overrides: Partial<CloudCommitmentSummary> = {},
): CloudCommitmentSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    days: 30,
    kinds: [],
    readAt: "2026-11-20T06:00:00.000Z",
    ...overrides,
  };
}

describe("coverage: of what a commitment could pay for, the share one did", () => {
  test("covered against covered and on demand together", () => {
    expect(
      getCloudCommitmentCoveragePercent({
        coveredSpend: 7872,
        onDemandSpend: 4428,
      }),
    ).toBeCloseTo(64, 5);
    expect(
      getCloudCommitmentCoveragePercent({ coveredSpend: 0, onDemandSpend: 50 }),
    ).toBe(0);
    expect(
      getCloudCommitmentCoveragePercent({ coveredSpend: 50, onDemandSpend: 0 }),
    ).toBe(100);
  });

  test("nothing to cover is no share at all, never a 0% or a 100%", () => {
    expect(
      getCloudCommitmentCoveragePercent({ coveredSpend: 0, onDemandSpend: 0 }),
    ).toBeNull();
    // A negative figure (a correction) counts as nothing.
    expect(
      getCloudCommitmentCoveragePercent({
        coveredSpend: -5,
        onDemandSpend: -2,
      }),
    ).toBeNull();
  });

  test.each([
    [{ coveredSpend: 0, onDemandSpend: 0 }, "nothing-to-cover"],
    [{ coveredSpend: 0, onDemandSpend: 120 }, "none"],
    [{ coveredSpend: 60, onDemandSpend: 40 }, "some"],
    [{ coveredSpend: 995, onDemandSpend: 5 }, "all"],
    [{ coveredSpend: 994, onDemandSpend: 6 }, "some"],
    [{ coveredSpend: 400, onDemandSpend: 0 }, "all"],
  ])(
    "%j covers %s",
    (spend: { coveredSpend: number; onDemandSpend: number }, level: string) => {
      expect(getCloudCommitmentCoverageLevel(spend)).toBe(level);
    },
  );

  test("all of it is what rounding and a day's late usage leave: 99.5% and up", () => {
    expect(CLOUD_COMMITMENT_ALL_COVERED_PERCENT).toBe(99.5);
    expect(CloudCommitmentCoverageLevel.All).toBe("all");
  });
});

describe("utilisation: of what the commitments cost, the share that paid for usage", () => {
  test("what was used of the commitment", () => {
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: 7000,
        unusedSpend: 210,
      }),
    ).toBeCloseTo(97, 5);
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: 100,
        unusedSpend: 0,
      }),
    ).toBe(100);
    // More unused than bought is all of it unused.
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: 100,
        unusedSpend: 140,
      }),
    ).toBe(0);
  });

  test("not said, or no commitment, is no share", () => {
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: null,
        unusedSpend: null,
      }),
    ).toBeNull();
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: 300,
        unusedSpend: null,
      }),
    ).toBeNull();
    expect(
      getCloudCommitmentUtilizationPercent({
        commitmentSpend: 0,
        unusedSpend: 0,
      }),
    ).toBeNull();
    expect(CLOUD_COMMITMENT_ALL_USED_PERCENT).toBe(99.5);
  });

  test("an account has a commitment of a kind when it paid for usage, or costs", () => {
    expect(hasCloudCommitment(figures({ coveredSpend: 1 }))).toBe(true);
    // Bought and not used at all: still a commitment, and the worst kind.
    expect(
      hasCloudCommitment(figures({ commitmentSpend: 90, unusedSpend: 90 })),
    ).toBe(true);
    // Google Cloud says no fee: covered is what tells.
    expect(
      hasCloudCommitment(
        figures({ coveredSpend: 30, commitmentSpend: null, unusedSpend: null }),
      ),
    ).toBe(true);
    expect(hasCloudCommitment(figures({ onDemandSpend: 900 }))).toBe(false);
  });
});

describe("the kinds, as each cloud names them", () => {
  test("AWS's Savings Plans and Reserved Instances, Azure's savings plans and reservations, Google Cloud's committed use discounts", () => {
    expect(
      getCloudCommitmentKindLabel({
        provider: CloudProvider.AWS,
        kind: CloudCommitmentKind.SavingsPlans,
      }),
    ).toBe("Savings Plans");
    expect(
      getCloudCommitmentKindLabel({
        provider: CloudProvider.AWS,
        kind: CloudCommitmentKind.Reservations,
      }),
    ).toBe("Reserved Instances");
    expect(
      getCloudCommitmentKindLabel({
        provider: CloudProvider.Azure,
        kind: CloudCommitmentKind.SavingsPlans,
      }),
    ).toBe("Savings plans");
    expect(
      getCloudCommitmentKindLabel({
        provider: CloudProvider.Azure,
        kind: CloudCommitmentKind.Reservations,
      }),
    ).toBe("Reservations");
    expect(
      getCloudCommitmentKindLabel({
        provider: CloudProvider.GCP,
        kind: CloudCommitmentKind.CommittedUseDiscounts,
      }),
    ).toBe("Committed use discounts");
    // A cloud this build does not know: the closest name there is.
    expect(
      getCloudCommitmentKindLabel({
        provider: "oracle",
        kind: CloudCommitmentKind.CommittedUseDiscounts,
      }),
    ).toBe("Committed use discounts");
  });

  test("each cloud's kinds in the order its figures are listed", () => {
    expect(CLOUD_COMMITMENT_KINDS[CloudProvider.AWS]).toEqual([
      CloudCommitmentKind.SavingsPlans,
      CloudCommitmentKind.Reservations,
    ]);
    expect(CLOUD_COMMITMENT_KINDS[CloudProvider.Azure]).toEqual([
      CloudCommitmentKind.SavingsPlans,
      CloudCommitmentKind.Reservations,
    ]);
    expect(CLOUD_COMMITMENT_KINDS[CloudProvider.GCP]).toEqual([
      CloudCommitmentKind.CommittedUseDiscounts,
    ]);
    expect(isCloudCommitmentKind("reservations")).toBe(true);
    expect(isCloudCommitmentKind("spot")).toBe(false);
  });
});

describe("the window", () => {
  test("the 30 full UTC days before today, whatever the hour", () => {
    for (const now of [
      "2026-11-20T00:00:00.000Z",
      "2026-11-20T13:45:10.000Z",
      "2026-11-20T23:59:59.999Z",
    ]) {
      const window: { start: Date; end: Date } = getCloudCommitmentWindow(
        new Date(now),
      );

      expect(window.end.toISOString()).toBe("2026-11-20T00:00:00.000Z");
      expect(window.start.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    }

    expect(CLOUD_COMMITMENT_WINDOW_DAYS).toBe(30);
  });
});

describe("a stored summary, read back", () => {
  test("its figures, as written", () => {
    const read: CloudCommitmentSummary | null = readCloudCommitmentSummary({
      state: "reading",
      currency: "eur",
      days: 30,
      isOrganization: true,
      kinds: [
        {
          kind: "savings-plans",
          coveredSpend: "7870.5",
          onDemandSpend: 4430,
          commitmentSpend: 7000,
          unusedSpend: 210,
        },
        {
          kind: "committed-use-discounts",
          coveredSpend: 30,
          onDemandSpend: 70,
          commitmentSpend: null,
          unusedSpend: null,
        },
      ],
      readAt: "2026-11-20T06:00:00.000Z",
    });

    expect(read).toEqual({
      state: "reading",
      message: undefined,
      currency: "EUR",
      days: 30,
      isOrganization: true,
      kinds: [
        {
          kind: CloudCommitmentKind.SavingsPlans,
          coveredSpend: 7870.5,
          onDemandSpend: 4430,
          commitmentSpend: 7000,
          unusedSpend: 210,
        },
        {
          kind: CloudCommitmentKind.CommittedUseDiscounts,
          coveredSpend: 30,
          onDemandSpend: 70,
          commitmentSpend: null,
          unusedSpend: null,
        },
      ],
      readAt: "2026-11-20T06:00:00.000Z",
    });
  });

  test("a malformed one is none; a malformed kind is left out; amounts below nothing are nothing", () => {
    expect(readCloudCommitmentSummary(null)).toBeNull();
    expect(readCloudCommitmentSummary([])).toBeNull();
    expect(readCloudCommitmentSummary({ kinds: [] })).toBeNull();

    const read: CloudCommitmentSummary | null = readCloudCommitmentSummary({
      state: "not-allowed",
      message: "The role may not read Savings Plans.",
      kinds: [
        { kind: "spot", coveredSpend: 1 },
        "reservations",
        { kind: "reservations", coveredSpend: -4, onDemandSpend: "x" },
      ],
    });

    expect(read!.state).toBe("not-allowed");
    expect(read!.message).toBe("The role may not read Savings Plans.");
    expect(read!.currency).toBe("USD");
    expect(read!.days).toBe(30);
    expect(read!.isOrganization).toBeUndefined();
    expect(read!.kinds).toEqual([
      {
        kind: CloudCommitmentKind.Reservations,
        coveredSpend: 0,
        onDemandSpend: 0,
        commitmentSpend: null,
        unusedSpend: null,
      },
    ]);
  });

  test("on a savings summary, only in one of the cost states", () => {
    const base: Record<string, unknown> = {
      state: "reading",
      count: 2,
      monthlySavings: 120,
      byKind: {},
      currency: "USD",
      readAt: "2026-11-20T06:00:00.000Z",
    };

    expect(
      readCloudAccountSavingsSummary({
        ...base,
        commitments: summary({
          kinds: [figures({ coveredSpend: 10, onDemandSpend: 5 })],
        }),
      })!.commitments!.kinds,
    ).toHaveLength(1);
    expect(
      readCloudAccountSavingsSummary({
        ...base,
        commitments: { ...summary(), state: "half-read" },
      })!.commitments,
    ).toBeUndefined();
    // A summary written before commitments were read has none.
    expect(readCloudAccountSavingsSummary(base)!.commitments).toBeUndefined();
  });
});

describe("several accounts' commitments as one", () => {
  test("added up in the currency, the others counted apart; utilisation only where it is said", () => {
    const totals: ReturnType<typeof totalCloudCommitments> =
      totalCloudCommitments({
        currency: "usd",
        readingState: CloudCostState.Reading,
        summaries: [
          summary({
            kinds: [
              figures({
                coveredSpend: 600,
                onDemandSpend: 400,
                commitmentSpend: 500,
                unusedSpend: 50,
              }),
            ],
          }),
          summary({
            kinds: [
              figures({
                kind: CloudCommitmentKind.CommittedUseDiscounts,
                coveredSpend: 100,
                onDemandSpend: 100,
                commitmentSpend: null,
                unusedSpend: null,
              }),
            ],
          }),
          summary({ currency: "EUR", kinds: [figures({ coveredSpend: 9 })] }),
          summary({ state: CloudCostState.Failed }),
          summary({ kinds: [figures({ onDemandSpend: 300 })] }),
          null,
        ],
      });

    expect(totals).toEqual({
      currency: "USD",
      coveredSpend: 700,
      onDemandSpend: 800,
      commitmentSpend: 500,
      unusedSpend: 50,
      accountsRead: 3,
      accountsWithCommitments: 2,
      accountsInOtherCurrencies: 1,
    });
  });

  test("one kind's figures added to another's; nothing said stays nothing said", () => {
    expect(
      addCloudCommitmentFigures(
        figures({
          coveredSpend: 1,
          onDemandSpend: 2,
          commitmentSpend: null,
          unusedSpend: null,
        }),
        figures({
          coveredSpend: 3,
          onDemandSpend: 4,
          commitmentSpend: null,
          unusedSpend: null,
        }),
      ),
    ).toEqual(
      figures({
        coveredSpend: 4,
        onDemandSpend: 6,
        commitmentSpend: null,
        unusedSpend: null,
      }),
    );
    expect(
      addCloudCommitmentFigures(
        figures({ commitmentSpend: 10, unusedSpend: 1 }),
        figures({ commitmentSpend: null, unusedSpend: null }),
      ),
    ).toEqual(figures({ commitmentSpend: 10, unusedSpend: 1 }));
  });
});
