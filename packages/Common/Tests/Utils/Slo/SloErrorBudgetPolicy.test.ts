import { describe, expect, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  SLO_POLICY_CAUTION_TIER_NAME,
  SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
  SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE,
  SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloPolicyTierLike,
  SloRecommendedPolicyTier,
  SloRecommendedPolicyTierToAdd,
  computeSloPolicyTier,
  formatSloPolicyTierThreshold,
  getMissingSloRecommendedPolicyTiers,
  getSloPolicyTierExitPercentage,
  getSloPolicyTierForBudget,
  isMoreSevereSloPolicyTier,
  isSameSloPolicyTier,
  parseSloRecommendedPolicyTiers,
  readSloPolicyTierThreshold,
  sloRecommendedPolicyTierToJSON,
  sortSloPolicyTiers,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import {
  SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
  SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
} from "../../../Utils/Slo/SloEvaluation";
import SloUtil from "../../../Utils/Slo/SloUtil";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Which tier of its error budget policy an SLO is in. Pinned here, in the pure
 * module, at the edges the worker's own tests cannot reach exactly: a budget
 * sitting precisely on a threshold, one flapping around it, a jump across
 * several tiers, a tier switched off, a policy with none - and the claim the
 * docs make, that a tier at 0% and one at the At Risk threshold move exactly
 * with the Budget Exhausted and At Risk statuses.
 */

interface Tier extends SloPolicyTierLike {
  id: string;
  name: string;
  thresholdPercentage: number;
}

const CAUTION: Tier = {
  id: "caution",
  name: "Caution",
  thresholdPercentage: 50,
};
const RELIABILITY_FIRST: Tier = {
  id: "reliability-first",
  name: "Reliability first",
  thresholdPercentage: 25,
};
const EXHAUSTED: Tier = {
  id: "exhausted",
  name: "Budget exhausted",
  thresholdPercentage: 0,
};

// In no useful order, as a findBy without a sort returns them.
const POLICY: Array<Tier> = [RELIABILITY_FIRST, EXHAUSTED, CAUTION];

function tierAt(
  budgetRemainingPercentage: number,
  currentTierId: string | null = null,
  tiers: Array<Tier> = POLICY,
): string | null {
  return (
    computeSloPolicyTier({
      budgetRemainingPercentage: budgetRemainingPercentage,
      tiers: tiers,
      currentTierId: currentTierId,
    })?.id || null
  );
}

describe("readSloPolicyTierThreshold", () => {
  test("reads numbers and the strings a decimal column or a form field hands over", () => {
    expect(readSloPolicyTierThreshold(25)).toBe(25);
    expect(readSloPolicyTierThreshold(2.5)).toBe(2.5);
    expect(readSloPolicyTierThreshold("25")).toBe(25);
    expect(readSloPolicyTierThreshold(" 12.75 ")).toBe(12.75);
    expect(readSloPolicyTierThreshold("0")).toBe(0);
    expect(readSloPolicyTierThreshold(0)).toBe(0);
    expect(readSloPolicyTierThreshold(100)).toBe(100);
  });

  test("anything a tier cannot have is null", () => {
    for (const value of [
      -0.01,
      100.01,
      -5,
      101,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "",
      "  ",
      "abc",
      "25%",
      null,
      undefined,
      true,
      {},
      [25],
    ]) {
      expect(readSloPolicyTierThreshold(value)).toBeNull();
    }
  });

  test("the range is the whole error budget", () => {
    expect(SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE).toBe(0);
    expect(SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE).toBe(100);
  });
});

describe("getSloPolicyTierExitPercentage: the status hysteresis", () => {
  test("a tier at 0% is left once 2% of the budget is back, like Budget Exhausted", () => {
    expect(getSloPolicyTierExitPercentage(0)).toBe(
      SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
    );
    expect(SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE).toBe(2);
  });

  test("any other tier once the budget is 5 points above it, like At Risk", () => {
    expect(SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE).toBe(5);
    expect(getSloPolicyTierExitPercentage(25)).toBe(30);
    expect(getSloPolicyTierExitPercentage(50)).toBe(55);
    expect(getSloPolicyTierExitPercentage(0.5)).toBe(5.5);
    expect(getSloPolicyTierExitPercentage(100)).toBe(105);
  });
});

describe("sortSloPolicyTiers", () => {
  test("most severe first: the lowest threshold leads", () => {
    expect(
      sortSloPolicyTiers(POLICY).map((tier: Tier): string => {
        return tier.id;
      }),
    ).toEqual(["exhausted", "reliability-first", "caution"]);
  });

  test("a tier with a threshold no tier can have is left out", () => {
    const broken: Array<SloPolicyTierLike> = [
      { id: "a", thresholdPercentage: "not a number" },
      { id: "b", thresholdPercentage: 150 },
      { id: "c", thresholdPercentage: null },
      { id: "d", thresholdPercentage: "10" },
    ];

    expect(
      sortSloPolicyTiers(broken).map((tier: SloPolicyTierLike): string => {
        return String(tier.id);
      }),
    ).toEqual(["d"]);
  });

  test("a tie is broken by id, so the same tiers always come out the same way", () => {
    const tied: Array<Tier> = [
      { id: "b", name: "B", thresholdPercentage: 10 },
      { id: "a", name: "A", thresholdPercentage: 10 },
    ];

    expect(
      sortSloPolicyTiers(tied).map((tier: Tier): string => {
        return tier.id;
      }),
    ).toEqual(["a", "b"]);
  });

  test("does not reorder what it was given", () => {
    const given: Array<Tier> = [...POLICY];
    sortSloPolicyTiers(given);
    expect(given).toEqual(POLICY);
  });
});

describe("getSloPolicyTierForBudget: the tier without hysteresis", () => {
  test("a budget exactly at a threshold is in that tier", () => {
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 50,
        tiers: POLICY,
      })?.id,
    ).toBe("caution");
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 25,
        tiers: POLICY,
      })?.id,
    ).toBe("reliability-first");
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 0,
        tiers: POLICY,
      })?.id,
    ).toBe("exhausted");
  });

  test("a budget just above a threshold is not", () => {
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 50.0001,
        tiers: POLICY,
      }),
    ).toBeNull();
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 25.0001,
        tiers: POLICY,
      })?.id,
    ).toBe("caution");
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 0.0001,
        tiers: POLICY,
      })?.id,
    ).toBe("reliability-first");
  });

  test("an overspent budget is in the tier at 0%", () => {
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: -340,
        tiers: POLICY,
      })?.id,
    ).toBe("exhausted");
  });

  test("the most severe tier that applies wins, wherever it sits in the list", () => {
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 10,
        tiers: [CAUTION, RELIABILITY_FIRST],
      })?.id,
    ).toBe("reliability-first");
  });

  test("no tiers, a budget above them all, or no budget: no tier", () => {
    expect(
      getSloPolicyTierForBudget({ budgetRemainingPercentage: 10, tiers: [] }),
    ).toBeNull();
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 100,
        tiers: POLICY,
      }),
    ).toBeNull();
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: Number.NaN,
        tiers: POLICY,
      }),
    ).toBeNull();
  });

  test("a tier at 100% applies to every budget", () => {
    expect(
      getSloPolicyTierForBudget({
        budgetRemainingPercentage: 100,
        tiers: [{ id: "always", name: "Always", thresholdPercentage: 100 }],
      })?.id,
    ).toBe("always");
  });
});

describe("computeSloPolicyTier: entering a tier", () => {
  test("from none, the SLO enters the tier its budget is in", () => {
    expect(tierAt(100)).toBeNull();
    expect(tierAt(50)).toBe("caution");
    expect(tierAt(30)).toBe("caution");
    expect(tierAt(25)).toBe("reliability-first");
    expect(tierAt(0)).toBe("exhausted");
  });

  test("entering a more severe tier is immediate", () => {
    expect(tierAt(24.99, "caution")).toBe("reliability-first");
    expect(tierAt(0, "reliability-first")).toBe("exhausted");
  });

  test("a jump across several tiers lands in the most severe one", () => {
    expect(tierAt(-12, "caution")).toBe("exhausted");
    expect(tierAt(-12, null)).toBe("exhausted");
    expect(tierAt(10, null)).toBe("reliability-first");
  });
});

describe("computeSloPolicyTier: leaving a tier", () => {
  test("the SLO stays in a tier until the budget clears its exit percentage", () => {
    expect(tierAt(26, "reliability-first")).toBe("reliability-first");
    expect(tierAt(29.999, "reliability-first")).toBe("reliability-first");
    expect(tierAt(30, "reliability-first")).toBe("caution");

    expect(tierAt(51, "caution")).toBe("caution");
    expect(tierAt(54.999, "caution")).toBe("caution");
    expect(tierAt(55, "caution")).toBeNull();
  });

  test("the tier at 0% is left once 2% is back", () => {
    expect(tierAt(1.999, "exhausted")).toBe("exhausted");
    expect(tierAt(2, "exhausted")).toBe("reliability-first");
  });

  test("leaving goes straight to the tier the budget is in, or none", () => {
    expect(tierAt(60, "exhausted")).toBeNull();
    expect(tierAt(40, "exhausted")).toBe("caution");
    // A calendar month rolls over: the whole budget is back at once.
    expect(tierAt(100, "reliability-first")).toBeNull();
  });

  test("an exit above the next tier's threshold holds the more severe tier", () => {
    const close: Array<Tier> = [
      { id: "ten", name: "Ten", thresholdPercentage: 10 },
      { id: "twelve", name: "Twelve", thresholdPercentage: 12 },
    ];

    // 13% is above both thresholds, but below Ten's exit at 15%.
    expect(tierAt(13, "ten", close)).toBe("ten");
    expect(tierAt(11, "ten", close)).toBe("ten");
    expect(tierAt(15, "ten", close)).toBeNull();
    expect(tierAt(9, "twelve", close)).toBe("ten");
  });
});

describe("computeSloPolicyTier: a budget hovering at a threshold", () => {
  test("a budget flapping around 25% enters Reliability first once and stays", () => {
    const budgets: Array<number> = [
      26, 24.9, 25.1, 24.8, 26, 25.2, 27, 24.5, 28.9, 25, 29.99, 24,
    ];

    let currentTierId: string | null = "caution";
    const changes: Array<string | null> = [];

    for (const budget of budgets) {
      const next: string | null = tierAt(budget, currentTierId);

      if (next !== currentTierId) {
        changes.push(next);
        currentTierId = next;
      }
    }

    expect(changes).toEqual(["reliability-first"]);
  });

  test("and leaves once, when the budget clears 30%", () => {
    const budgets: Array<number> = [24, 29, 31, 29, 26, 31.5];

    let currentTierId: string | null = "reliability-first";
    const changes: Array<string | null> = [];

    for (const budget of budgets) {
      const next: string | null = tierAt(budget, currentTierId);

      if (next !== currentTierId) {
        changes.push(next);
        currentTierId = next;
      }
    }

    // Out at 31, and 29 and 26 are inside Caution, not back in Reliability first.
    expect(changes).toEqual(["caution"]);
  });
});

describe("computeSloPolicyTier: what the policy is made of", () => {
  test("a current tier that is no longer among the tiers holds nothing", () => {
    // Caution deleted (or disabled - the worker passes enabled tiers only).
    expect(tierAt(52, "caution", [RELIABILITY_FIRST, EXHAUSTED])).toBeNull();
    expect(tierAt(20, "caution", [RELIABILITY_FIRST, EXHAUSTED])).toBe(
      "reliability-first",
    );
    expect(tierAt(27, "a-tier-that-is-gone")).toBe("caution");
  });

  test("an edited threshold is read as it is now", () => {
    const moved: Tier = { ...RELIABILITY_FIRST, thresholdPercentage: 20 };

    // At 23%: below the old 25% but above the new 20% - held by the exit at 25%.
    expect(tierAt(23, "reliability-first", [moved, CAUTION])).toBe(
      "reliability-first",
    );
    expect(tierAt(25, "reliability-first", [moved, CAUTION])).toBe("caution");
  });

  test("no tiers: no tier, whatever was stored", () => {
    expect(tierAt(-50, null, [])).toBeNull();
    expect(tierAt(-50, "caution", [])).toBeNull();
  });

  test("a budget that is not a number decides nothing: the tier stays", () => {
    expect(tierAt(Number.NaN, "reliability-first")).toBe("reliability-first");
    expect(tierAt(Number.NaN, null)).toBeNull();
  });

  test("ids compare whatever their case or type", () => {
    const tiers: Array<SloPolicyTierLike> = [
      { id: new ObjectID("AB12-tier"), thresholdPercentage: 25 },
    ];

    expect(
      computeSloPolicyTier({
        budgetRemainingPercentage: 27,
        tiers: tiers,
        currentTierId: "ab12-TIER",
      }),
    ).toBe(tiers[0]);
  });

  test("thresholds read as strings work like numbers", () => {
    const tiers: Array<SloPolicyTierLike> = [
      { id: "s", thresholdPercentage: "25" },
    ];

    expect(
      computeSloPolicyTier({
        budgetRemainingPercentage: 25,
        tiers: tiers,
        currentTierId: null,
      }),
    ).toBe(tiers[0]);
  });
});

describe("tiers move exactly with the statuses they mirror", () => {
  /*
   * The docs promise that a tier at 0% moves with Budget Exhausted and a tier
   * at the At Risk threshold with At Risk. Walk a seeded random budget through
   * both machines and hold them to it at every step.
   */
  const AT_RISK_THRESHOLD: number = 20;

  const MIRROR_POLICY: Array<Tier> = [
    { id: "exhausted", name: "Exhausted", thresholdPercentage: 0 },
    { id: "at-risk", name: "At risk", thresholdPercentage: AT_RISK_THRESHOLD },
  ];

  function statusOfTier(tierId: string | null): SloStatus {
    if (tierId === "exhausted") {
      return SloStatus.BudgetExhausted;
    }

    if (tierId === "at-risk") {
      return SloStatus.AtRisk;
    }

    return SloStatus.Healthy;
  }

  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "seed %i: every step of a random walk agrees",
    (seed: number) => {
      const random: SeededRandom = seededRandom(seed);

      let budget: number = 60;
      let status: SloStatus = SloStatus.Healthy;
      let tierId: string | null = null;

      for (let step: number = 0; step < 2000; step++) {
        // Steps of up to 4 points either way, in hundredths, kept in range.
        budget = Math.max(
          -40,
          Math.min(100, budget + (random(801) - 400) / 100),
        );

        status = SloUtil.computeSloStatus({
          budgetRemainingPercentage: budget,
          currentStatus: status,
          atRiskThresholdPercentage: AT_RISK_THRESHOLD,
        });

        tierId = tierAt(budget, tierId, MIRROR_POLICY);

        expect(statusOfTier(tierId)).toBe(status);
      }
    },
  );
});

describe("isMoreSevereSloPolicyTier", () => {
  test("a lower threshold is more severe, and any tier more severe than none", () => {
    expect(isMoreSevereSloPolicyTier(EXHAUSTED, CAUTION)).toBe(true);
    expect(isMoreSevereSloPolicyTier(CAUTION, EXHAUSTED)).toBe(false);
    expect(isMoreSevereSloPolicyTier(CAUTION, CAUTION)).toBe(false);
    expect(isMoreSevereSloPolicyTier(CAUTION, null)).toBe(true);
    expect(isMoreSevereSloPolicyTier(null, CAUTION)).toBe(false);
    expect(isMoreSevereSloPolicyTier(null, null)).toBe(false);
  });

  test("a tier with no valid threshold is never more severe", () => {
    expect(
      isMoreSevereSloPolicyTier({ thresholdPercentage: "x" }, CAUTION),
    ).toBe(false);
    expect(
      isMoreSevereSloPolicyTier(CAUTION, { thresholdPercentage: "x" }),
    ).toBe(true);
  });
});

describe("isSameSloPolicyTier", () => {
  test("by id, case-insensitively; an empty id is never the same", () => {
    expect(isSameSloPolicyTier("Abc", "aBC")).toBe(true);
    expect(isSameSloPolicyTier(new ObjectID("abc"), "abc")).toBe(true);
    expect(isSameSloPolicyTier("abc", "abd")).toBe(false);
    expect(isSameSloPolicyTier("", "")).toBe(false);
    expect(isSameSloPolicyTier(null, null)).toBe(false);
    expect(isSameSloPolicyTier(undefined, "abc")).toBe(false);
  });
});

describe("formatSloPolicyTierThreshold", () => {
  test("two decimals at most, none on a whole number", () => {
    expect(formatSloPolicyTierThreshold(25)).toBe("25%");
    expect(formatSloPolicyTierThreshold(0)).toBe("0%");
    expect(formatSloPolicyTierThreshold(2.5)).toBe("2.5%");
    expect(formatSloPolicyTierThreshold(12.345)).toBe("12.35%");
    expect(formatSloPolicyTierThreshold("50")).toBe("50%");
  });

  test("a threshold no tier can have reads as nothing", () => {
    expect(formatSloPolicyTierThreshold(undefined)).toBe("");
    expect(formatSloPolicyTierThreshold(null)).toBe("");
    expect(formatSloPolicyTierThreshold(-1)).toBe("");
    expect(formatSloPolicyTierThreshold("x")).toBe("");
  });
});

describe("the recommended policy", () => {
  test("is the SRE Workbook's three levels: half the budget, a quarter, none", () => {
    expect(
      SLO_RECOMMENDED_POLICY_TIERS.map(
        (tier: SloRecommendedPolicyTier): [string, number] => {
          return [tier.name, tier.thresholdPercentage];
        },
      ),
    ).toEqual([
      [SLO_POLICY_CAUTION_TIER_NAME, 50],
      [SLO_POLICY_RELIABILITY_FIRST_TIER_NAME, 25],
      [SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME, 0],
    ]);
    expect(SLO_POLICY_CAUTION_TIER_NAME).toBe("Caution");
    expect(SLO_POLICY_RELIABILITY_FIRST_TIER_NAME).toBe("Reliability first");
    expect(SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME).toBe("Budget exhausted");
  });

  test("every tier is one the service accepts: a valid, unique threshold and an agreement", () => {
    const thresholds: Set<number> = new Set<number>();

    for (const tier of SLO_RECOMMENDED_POLICY_TIERS) {
      expect(readSloPolicyTierThreshold(tier.thresholdPercentage)).toBe(
        tier.thresholdPercentage,
      );
      expect(tier.name.trim()).toBe(tier.name);
      expect(tier.whatWeDo.trim().length).toBeGreaterThan(20);
      expect(tier.whatWeDo.length).toBeLessThanOrEqual(
        SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH,
      );
      thresholds.add(tier.thresholdPercentage);
    }

    expect(thresholds.size).toBe(SLO_RECOMMENDED_POLICY_TIERS.length);
  });

  test("an SLO with no tiers is missing all three, as copies", () => {
    const missing: Array<SloRecommendedPolicyTier> =
      getMissingSloRecommendedPolicyTiers({ existingTiers: [] });

    expect(missing).toEqual([...SLO_RECOMMENDED_POLICY_TIERS]);

    missing[0]!.name = "Changed";
    expect(SLO_RECOMMENDED_POLICY_TIERS[0]!.name).toBe("Caution");
  });

  test("a tier with a recommended name counts, whatever its threshold or case", () => {
    expect(
      getMissingSloRecommendedPolicyTiers({
        existingTiers: [{ name: "  caution ", thresholdPercentage: 60 }],
      }).map((tier: SloRecommendedPolicyTier): string => {
        return tier.name;
      }),
    ).toEqual(["Reliability first", "Budget exhausted"]);
  });

  test("a tier at a recommended threshold counts, whatever its name - even read as a string", () => {
    expect(
      getMissingSloRecommendedPolicyTiers({
        existingTiers: [
          { name: "Freeze", thresholdPercentage: "0" },
          { name: "Yellow", thresholdPercentage: 50 },
        ],
      }).map((tier: SloRecommendedPolicyTier): string => {
        return tier.name;
      }),
    ).toEqual(["Reliability first"]);
  });

  test("the whole policy present: nothing is missing", () => {
    expect(
      getMissingSloRecommendedPolicyTiers({
        existingTiers: SLO_RECOMMENDED_POLICY_TIERS,
      }),
    ).toEqual([]);
  });

  test("a tier with no name and no threshold counts for nothing", () => {
    expect(
      getMissingSloRecommendedPolicyTiers({
        existingTiers: [{ name: null, thresholdPercentage: null }],
      }),
    ).toHaveLength(3);
  });
});

describe("the recommended policy over the API", () => {
  test("goes out and comes back the same", () => {
    const tiers: Array<SloRecommendedPolicyTierToAdd> = [
      { ...SLO_RECOMMENDED_POLICY_TIERS[0]! },
      { ...SLO_RECOMMENDED_POLICY_TIERS[1]!, id: "tier-2" },
    ];

    const json: JSONValue = tiers.map(
      (tier: SloRecommendedPolicyTierToAdd): JSONObject => {
        return sloRecommendedPolicyTierToJSON(tier);
      },
    );

    expect(parseSloRecommendedPolicyTiers(json)).toEqual(tiers);
    expect(sloRecommendedPolicyTierToJSON(tiers[0]!)).not.toHaveProperty("id");
  });

  test("an entry without a name or a valid threshold is left out", () => {
    const parsed: Array<SloRecommendedPolicyTierToAdd> =
      parseSloRecommendedPolicyTiers([
        { name: "Good", thresholdPercentage: 10, whatWeDo: "Do it." },
        { name: "", thresholdPercentage: 10 },
        { name: "No threshold" },
        { name: "Text threshold", thresholdPercentage: "10" },
        { name: "Out of range", thresholdPercentage: 101 },
        null,
        "a string",
        [1, 2],
      ] as unknown as JSONValue);

    expect(parsed).toEqual([
      { name: "Good", thresholdPercentage: 10, whatWeDo: "Do it." },
    ]);
  });

  test("a missing agreement reads as empty, and anything that is not a list as none", () => {
    expect(
      parseSloRecommendedPolicyTiers([{ name: "A", thresholdPercentage: 1 }]),
    ).toEqual([{ name: "A", thresholdPercentage: 1, whatWeDo: "" }]);
    expect(parseSloRecommendedPolicyTiers(undefined)).toEqual([]);
    expect(parseSloRecommendedPolicyTiers({} as JSONValue)).toEqual([]);
  });
});
