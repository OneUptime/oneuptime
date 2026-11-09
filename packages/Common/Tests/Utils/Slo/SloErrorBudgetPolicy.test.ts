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
  SloDeploymentGate,
  SloDeploymentGateChange,
  SloDeploymentGateTransition,
  SloPolicyTierLike,
  SloRecommendedPolicyTier,
  SloRecommendedPolicyTierToAdd,
  SloStoredDeploymentGate,
  areSloDeploymentsAllowedInTier,
  computeSloDeploymentGate,
  computeSloPolicyTier,
  formatSloPolicyTierThreshold,
  getMissingSloRecommendedPolicyTiers,
  getSloDeploymentGateChange,
  getSloPolicyTierExitPercentage,
  getSloPolicyTierForBudget,
  isMoreSevereSloPolicyTier,
  isSameSloPolicyTier,
  isSloStoredDeploymentGateAllowed,
  parseSloRecommendedPolicyTiers,
  readSloDeploymentsFrozenAt,
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
      {
        name: "Good",
        thresholdPercentage: 10,
        whatWeDo: "Do it.",
        freezesDeployments: false,
      },
    ]);
  });

  test("a missing agreement reads as empty, and anything that is not a list as none", () => {
    expect(
      parseSloRecommendedPolicyTiers([{ name: "A", thresholdPercentage: 1 }]),
    ).toEqual([
      {
        name: "A",
        thresholdPercentage: 1,
        whatWeDo: "",
        freezesDeployments: false,
      },
    ]);
    expect(parseSloRecommendedPolicyTiers(undefined)).toEqual([]);
    expect(parseSloRecommendedPolicyTiers({} as JSONValue)).toEqual([]);
  });

  test("says which tiers freeze deployments, and reads only true as a freeze", () => {
    const json: Array<JSONObject> = SLO_RECOMMENDED_POLICY_TIERS.map(
      (tier: SloRecommendedPolicyTier): JSONObject => {
        return sloRecommendedPolicyTierToJSON(tier);
      },
    );

    expect(
      json.map((entry: JSONObject): [JSONValue, JSONValue] => {
        return [
          entry["name"] as JSONValue,
          entry["freezesDeployments"] as JSONValue,
        ];
      }),
    ).toEqual([
      ["Caution", false],
      ["Reliability first", false],
      ["Budget exhausted", true],
    ]);

    // Always a boolean on the wire, even from a tier that never said.
    expect(
      sloRecommendedPolicyTierToJSON({
        name: "Mine",
        thresholdPercentage: 5,
        whatWeDo: "Mine.",
      } as SloRecommendedPolicyTier)["freezesDeployments"],
    ).toBe(false);

    expect(
      parseSloRecommendedPolicyTiers([
        { name: "A", thresholdPercentage: 1, freezesDeployments: true },
        { name: "B", thresholdPercentage: 2, freezesDeployments: "true" },
        { name: "C", thresholdPercentage: 3, freezesDeployments: 1 },
        { name: "D", thresholdPercentage: 4, freezesDeployments: null },
        { name: "E", thresholdPercentage: 5 },
      ] as unknown as JSONValue).map(
        (tier: SloRecommendedPolicyTierToAdd): [string, boolean] => {
          return [tier.name, tier.freezesDeployments];
        },
      ),
    ).toEqual([
      ["A", true],
      ["B", false],
      ["C", false],
      ["D", false],
      ["E", false],
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The deploy gate: CI/CD's yes/no on the SLO (deploymentsAllowed), read off
 * the tier the SLO is in.
 * ---------------------------------------------------------------------------
 */

interface FreezingTier extends Tier {
  freezesDeployments?: boolean | null | undefined;
}

const FROZEN_SINCE: Date = new Date("2026-11-01T08:00:00.000Z");
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");

const ALLOWED_GATE: SloStoredDeploymentGate = {
  deploymentsAllowed: true,
  deploymentsFrozenAt: null,
};

const FROZEN_GATE: SloStoredDeploymentGate = {
  deploymentsAllowed: false,
  deploymentsFrozenAt: FROZEN_SINCE,
};

// The recommended policy as its rows hold it: only Budget exhausted freezes.
const FREEZING_POLICY: Array<FreezingTier> = [
  { ...RELIABILITY_FIRST, freezesDeployments: false },
  { ...EXHAUSTED, freezesDeployments: true },
  { ...CAUTION, freezesDeployments: false },
];

describe("the recommended policy freezes deployments in Budget exhausted only", () => {
  test("as its agreement says: Freeze non-critical releases", () => {
    expect(
      SLO_RECOMMENDED_POLICY_TIERS.map(
        (tier: SloRecommendedPolicyTier): [string, boolean] => {
          return [tier.name, tier.freezesDeployments];
        },
      ),
    ).toEqual([
      [SLO_POLICY_CAUTION_TIER_NAME, false],
      [SLO_POLICY_RELIABILITY_FIRST_TIER_NAME, false],
      [SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME, true],
    ]);

    const exhausted: SloRecommendedPolicyTier =
      SLO_RECOMMENDED_POLICY_TIERS.find(
        (tier: SloRecommendedPolicyTier): boolean => {
          return tier.freezesDeployments;
        },
      ) as SloRecommendedPolicyTier;

    expect(exhausted.thresholdPercentage).toBe(0);
    expect(exhausted.whatWeDo).toContain("Freeze non-critical releases");
  });

  test("and the copies the starter adds say so too", () => {
    expect(
      getMissingSloRecommendedPolicyTiers({ existingTiers: [] }).map(
        (tier: SloRecommendedPolicyTier): boolean => {
          return tier.freezesDeployments;
        },
      ),
    ).toEqual([false, false, true]);
  });
});

describe("areSloDeploymentsAllowedInTier", () => {
  test("only a tier that freezes deployments, exactly true, shuts the gate", () => {
    expect(areSloDeploymentsAllowedInTier({ freezesDeployments: true })).toBe(
      false,
    );
  });

  test("no tier, a tier switched off, or one read without the switch: allowed", () => {
    expect(areSloDeploymentsAllowedInTier(null)).toBe(true);
    expect(areSloDeploymentsAllowedInTier(undefined)).toBe(true);
    expect(areSloDeploymentsAllowedInTier({ freezesDeployments: false })).toBe(
      true,
    );
    expect(areSloDeploymentsAllowedInTier({ freezesDeployments: null })).toBe(
      true,
    );
    expect(areSloDeploymentsAllowedInTier({})).toBe(true);
    expect(
      areSloDeploymentsAllowedInTier({
        freezesDeployments: "true" as unknown as boolean,
      }),
    ).toBe(true);
  });
});

describe("the stored gate", () => {
  test("only an explicit false is a freeze: the column defaults to true", () => {
    expect(isSloStoredDeploymentGateAllowed(FROZEN_GATE)).toBe(false);
    expect(isSloStoredDeploymentGateAllowed(ALLOWED_GATE)).toBe(true);
    expect(isSloStoredDeploymentGateAllowed({})).toBe(true);
    expect(isSloStoredDeploymentGateAllowed({ deploymentsAllowed: null })).toBe(
      true,
    );
  });

  test("a freeze time is read from a Date or the string an API answer holds", () => {
    expect(readSloDeploymentsFrozenAt(FROZEN_SINCE)?.getTime()).toBe(
      FROZEN_SINCE.getTime(),
    );
    expect(
      readSloDeploymentsFrozenAt(FROZEN_SINCE.toISOString())?.getTime(),
    ).toBe(FROZEN_SINCE.getTime());
    expect(readSloDeploymentsFrozenAt(null)).toBeNull();
    expect(readSloDeploymentsFrozenAt(undefined)).toBeNull();
    expect(readSloDeploymentsFrozenAt("")).toBeNull();
    expect(readSloDeploymentsFrozenAt("not a date")).toBeNull();
  });
});

describe("computeSloDeploymentGate", () => {
  test("entering a tier that freezes deployments freezes them, since this evaluation", () => {
    expect(
      computeSloDeploymentGate({
        tier: { freezesDeployments: true },
        stored: ALLOWED_GATE,
        now: NOW,
      }),
    ).toEqual({ deploymentsAllowed: false, deploymentsFrozenAt: NOW });
  });

  test("staying frozen keeps the time they were frozen", () => {
    const gate: SloDeploymentGate = computeSloDeploymentGate({
      tier: { freezesDeployments: true },
      stored: FROZEN_GATE,
      now: NOW,
    });

    expect(gate.deploymentsAllowed).toBe(false);
    expect(gate.deploymentsFrozenAt?.getTime()).toBe(FROZEN_SINCE.getTime());
  });

  test("a stored time read back as a string is the same instant", () => {
    expect(
      computeSloDeploymentGate({
        tier: { freezesDeployments: true },
        stored: {
          deploymentsAllowed: false,
          deploymentsFrozenAt: FROZEN_SINCE.toISOString(),
        },
        now: NOW,
      }).deploymentsFrozenAt?.getTime(),
    ).toBe(FROZEN_SINCE.getTime());
  });

  test("a stored freeze whose time was lost is frozen since now", () => {
    expect(
      computeSloDeploymentGate({
        tier: { freezesDeployments: true },
        stored: { deploymentsAllowed: false, deploymentsFrozenAt: null },
        now: NOW,
      }),
    ).toEqual({ deploymentsAllowed: false, deploymentsFrozenAt: NOW });
  });

  test("a time left over on an allowed gate is not where a new freeze starts", () => {
    expect(
      computeSloDeploymentGate({
        tier: { freezesDeployments: true },
        stored: { deploymentsAllowed: true, deploymentsFrozenAt: FROZEN_SINCE },
        now: NOW,
      }).deploymentsFrozenAt,
    ).toEqual(NOW);
  });

  test("a tier that does not freeze, or none, allows deployments and has no freeze time", () => {
    for (const tier of [null, { freezesDeployments: false }, {}]) {
      for (const stored of [ALLOWED_GATE, FROZEN_GATE, {}]) {
        expect({
          tier,
          stored,
          gate: computeSloDeploymentGate({ tier, stored, now: NOW }),
        }).toEqual({
          tier,
          stored,
          gate: { deploymentsAllowed: true, deploymentsFrozenAt: null },
        });
      }
    }
  });
});

describe("getSloDeploymentGateChange: what an evaluation writes", () => {
  test("allowed, and still allowed: nothing is written, nothing is said", () => {
    expect(
      getSloDeploymentGateChange({
        tier: null,
        stored: ALLOWED_GATE,
        now: NOW,
      }),
    ).toEqual({
      gate: { deploymentsAllowed: true, deploymentsFrozenAt: null },
      transition: null,
      columns: {},
    });

    // An SLO never evaluated reads as the column's default: allowed.
    expect(
      getSloDeploymentGateChange({ tier: null, stored: {}, now: NOW }).columns,
    ).toEqual({});
  });

  test("freezing writes both columns, and says Frozen", () => {
    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: { freezesDeployments: true },
      stored: ALLOWED_GATE,
      now: NOW,
    });

    expect(change.transition).toBe(SloDeploymentGateTransition.Frozen);
    expect(change.columns).toEqual({
      deploymentsAllowed: false,
      deploymentsFrozenAt: NOW,
    });
  });

  test("still frozen: nothing is written, nothing is said", () => {
    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: { freezesDeployments: true },
      stored: FROZEN_GATE,
      now: NOW,
    });

    expect(change.transition).toBeNull();
    expect(change.columns).toEqual({});
    expect(change.gate.deploymentsFrozenAt?.getTime()).toBe(
      FROZEN_SINCE.getTime(),
    );
  });

  test("still frozen, the time read back as a string: still nothing to write", () => {
    expect(
      getSloDeploymentGateChange({
        tier: { freezesDeployments: true },
        stored: {
          deploymentsAllowed: false,
          deploymentsFrozenAt: FROZEN_SINCE.toISOString(),
        },
        now: NOW,
      }).columns,
    ).toEqual({});
  });

  test("allowed again writes both columns back, and says Allowed", () => {
    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: { freezesDeployments: false },
      stored: FROZEN_GATE,
      now: NOW,
    });

    expect(change.transition).toBe(SloDeploymentGateTransition.Allowed);
    expect(change.columns).toEqual({
      deploymentsAllowed: true,
      deploymentsFrozenAt: null,
    });
  });

  test("a freeze time left over on an allowed gate is cleared quietly", () => {
    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: null,
      stored: { deploymentsAllowed: true, deploymentsFrozenAt: FROZEN_SINCE },
      now: NOW,
    });

    expect(change.transition).toBeNull();
    expect(change.columns).toEqual({ deploymentsFrozenAt: null });
  });

  test("a frozen gate that lost its time gets one, quietly", () => {
    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: { freezesDeployments: true },
      stored: { deploymentsAllowed: false, deploymentsFrozenAt: null },
      now: NOW,
    });

    expect(change.transition).toBeNull();
    expect(change.columns).toEqual({ deploymentsFrozenAt: NOW });
  });
});

/*
 * The gate read off the tier the policy puts the SLO in, evaluation after
 * evaluation, as the worker chains them: the tier stored by one evaluation
 * and the gate it wrote are what the next one starts from.
 */
interface Evaluation {
  tierId: string | null;
  gate: SloDeploymentGate;
  transition: SloDeploymentGateTransition | null;
}

function evaluateGate(data: {
  budgets: Array<number>;
  tiers?: Array<FreezingTier>;
  // Tiers per evaluation, when the policy changes along the way.
  tiersAt?: (step: number) => Array<FreezingTier>;
  startTierId?: string | null;
  startGate?: SloStoredDeploymentGate;
}): Array<Evaluation> {
  let tierId: string | null = data.startTierId ?? null;
  let stored: SloStoredDeploymentGate = data.startGate || ALLOWED_GATE;
  const evaluations: Array<Evaluation> = [];

  data.budgets.forEach((budget: number, step: number) => {
    const tiers: Array<FreezingTier> = data.tiersAt
      ? data.tiersAt(step)
      : data.tiers || FREEZING_POLICY;
    const now: Date = new Date(NOW.getTime() + step * 60 * 1000);

    const tier: FreezingTier | null = computeSloPolicyTier({
      budgetRemainingPercentage: budget,
      tiers: tiers,
      currentTierId: tierId,
    });

    const change: SloDeploymentGateChange = getSloDeploymentGateChange({
      tier: tier,
      stored: stored,
      now: now,
    });

    tierId = tier?.id || null;
    stored = change.gate;

    evaluations.push({
      tierId: tierId,
      gate: change.gate,
      transition: change.transition,
    });
  });

  return evaluations;
}

function allowedAlong(evaluations: Array<Evaluation>): Array<boolean> {
  return evaluations.map((evaluation: Evaluation): boolean => {
    return evaluation.gate.deploymentsAllowed;
  });
}

describe("the deploy gate follows the tier, with the tier's hysteresis", () => {
  test("enter: frozen on the first evaluation that finds the budget spent", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [30, 10, 0.5, -3],
    });

    expect(
      evaluations.map((evaluation: Evaluation): string | null => {
        return evaluation.tierId;
      }),
    ).toEqual([
      "caution",
      "reliability-first",
      "reliability-first",
      "exhausted",
    ]);
    expect(allowedAlong(evaluations)).toEqual([true, true, true, false]);
    expect(evaluations[3]!.transition).toBe(SloDeploymentGateTransition.Frozen);
    expect(evaluations[3]!.gate.deploymentsFrozenAt?.getTime()).toBe(
      NOW.getTime() + 3 * 60 * 1000,
    );
  });

  test("a budget at exactly 0% is in the tier, and frozen", () => {
    expect(allowedAlong(evaluateGate({ budgets: [0] }))).toEqual([false]);
  });

  test("stay: frozen until the budget clears the tier's 2% exit, the time unchanged", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [-3, 0.5, 1.9, 1.99],
    });

    expect(allowedAlong(evaluations)).toEqual([false, false, false, false]);
    expect(
      evaluations.map((evaluation: Evaluation): number | undefined => {
        return evaluation.gate.deploymentsFrozenAt?.getTime();
      }),
    ).toEqual([NOW.getTime(), NOW.getTime(), NOW.getTime(), NOW.getTime()]);
    expect(
      evaluations.slice(1).map((evaluation: Evaluation) => {
        return evaluation.transition;
      }),
    ).toEqual([null, null, null]);
  });

  test("leave: allowed again on the first evaluation at the 2% exit", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [-3, 1.9, 2],
    });

    expect(allowedAlong(evaluations)).toEqual([false, false, true]);
    expect(evaluations[2]!.tierId).toBe("reliability-first");
    expect(evaluations[2]!.transition).toBe(
      SloDeploymentGateTransition.Allowed,
    );
    expect(evaluations[2]!.gate.deploymentsFrozenAt).toBeNull();
  });

  test("a budget flapping around 0% freezes once and stays frozen", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [0.4, -0.2, 0.3, -0.1, 1.5, 0.1],
    });

    expect(
      evaluations.filter((evaluation: Evaluation): boolean => {
        return evaluation.transition !== null;
      }),
    ).toHaveLength(1);
    expect(allowedAlong(evaluations).slice(1)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("between two tiers that both freeze: frozen all along, since the first", () => {
    const bothFreeze: Array<FreezingTier> = [
      { ...CAUTION, freezesDeployments: false },
      { ...RELIABILITY_FIRST, freezesDeployments: true },
      { ...EXHAUSTED, freezesDeployments: true },
    ];

    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [20, -2, 3, 20],
      tiers: bothFreeze,
    });

    expect(
      evaluations.map((evaluation: Evaluation): string | null => {
        return evaluation.tierId;
      }),
    ).toEqual([
      "reliability-first",
      "exhausted",
      "reliability-first",
      "reliability-first",
    ]);
    expect(allowedAlong(evaluations)).toEqual([false, false, false, false]);
    expect(
      evaluations.map((evaluation: Evaluation): number | undefined => {
        return evaluation.gate.deploymentsFrozenAt?.getTime();
      }),
    ).toEqual([NOW.getTime(), NOW.getTime(), NOW.getTime(), NOW.getTime()]);
  });

  test("a freezing tier switched off - left out of the tiers - allows deployments on the next evaluation", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [-3, -3, -3],
      // Disabled tiers are not among the tiers the worker hands over.
      tiersAt: (step: number): Array<FreezingTier> => {
        return step < 1
          ? FREEZING_POLICY
          : FREEZING_POLICY.filter((tier: FreezingTier): boolean => {
              return tier.id !== "exhausted";
            });
      },
    });

    expect(allowedAlong(evaluations)).toEqual([false, true, true]);
    expect(evaluations[1]!.tierId).toBe("reliability-first");
    expect(evaluations[1]!.transition).toBe(
      SloDeploymentGateTransition.Allowed,
    );
  });

  test("a deleted freezing tier the SLO was in: the budget alone decides, and the gate opens", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [1.5],
      tiers: [
        { ...CAUTION, freezesDeployments: false },
        { ...RELIABILITY_FIRST, freezesDeployments: false },
      ],
      startTierId: "deleted-tier",
      startGate: FROZEN_GATE,
    });

    expect(evaluations[0]!.tierId).toBe("reliability-first");
    expect(evaluations[0]!.gate).toEqual({
      deploymentsAllowed: true,
      deploymentsFrozenAt: null,
    });
    expect(evaluations[0]!.transition).toBe(
      SloDeploymentGateTransition.Allowed,
    );
  });

  test("the switch turned on for the tier the SLO is in freezes on the next evaluation, off allows again", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [-3, -3, -3, -3],
      tiersAt: (step: number): Array<FreezingTier> => {
        return FREEZING_POLICY.map((tier: FreezingTier): FreezingTier => {
          return tier.id === "exhausted"
            ? { ...tier, freezesDeployments: step === 1 || step === 2 }
            : tier;
        });
      },
    });

    expect(
      evaluations.map((evaluation: Evaluation): string | null => {
        return evaluation.tierId;
      }),
    ).toEqual(["exhausted", "exhausted", "exhausted", "exhausted"]);
    expect(allowedAlong(evaluations)).toEqual([true, false, false, true]);
    expect(
      evaluations.map((evaluation: Evaluation) => {
        return evaluation.transition;
      }),
    ).toEqual([
      null,
      SloDeploymentGateTransition.Frozen,
      null,
      SloDeploymentGateTransition.Allowed,
    ]);
  });

  test("an SLO with no policy is always allowed, whatever its budget", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [100, 50, 0, -50, -500, 10],
      tiers: [],
    });

    expect(allowedAlong(evaluations)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      evaluations.every((evaluation: Evaluation): boolean => {
        return (
          evaluation.transition === null &&
          evaluation.gate.deploymentsFrozenAt === null
        );
      }),
    ).toBe(true);
  });

  test("a budget that is not a number keeps the tier, and so the answer", () => {
    const evaluations: Array<Evaluation> = evaluateGate({
      budgets: [-3, Number.NaN, Number.POSITIVE_INFINITY],
    });

    expect(allowedAlong(evaluations)).toEqual([false, false, false]);
    expect(
      evaluations.map((evaluation: Evaluation) => {
        return evaluation.gate.deploymentsFrozenAt?.getTime();
      }),
    ).toEqual([NOW.getTime(), NOW.getTime(), NOW.getTime()]);
  });

  test.each([1, 2, 3, 4, 5, 6])(
    "seed %i: along a random walk the gate is shut exactly while the tier freezes, and its time never moves while it stays shut",
    (seed: number) => {
      const random: SeededRandom = seededRandom(seed);
      const budgets: Array<number> = [];
      let budget: number = 40;

      for (let step: number = 0; step < 1500; step++) {
        budget = Math.max(
          -30,
          Math.min(100, budget + (random(601) - 300) / 100),
        );
        budgets.push(budget);
      }

      // Reliability first freezes too, so the gate also holds across tiers.
      const policy: Array<FreezingTier> = [
        { ...CAUTION, freezesDeployments: false },
        { ...RELIABILITY_FIRST, freezesDeployments: random(2) === 1 },
        { ...EXHAUSTED, freezesDeployments: true },
      ];
      const freezing: Set<string> = new Set<string>(
        policy
          .filter((tier: FreezingTier): boolean => {
            return tier.freezesDeployments === true;
          })
          .map((tier: FreezingTier): string => {
            return tier.id;
          }),
      );

      const evaluations: Array<Evaluation> = evaluateGate({
        budgets: budgets,
        tiers: policy,
      });

      let previous: Evaluation | null = null;

      for (const evaluation of evaluations) {
        const isFrozen: boolean = Boolean(
          evaluation.tierId && freezing.has(evaluation.tierId),
        );

        expect(evaluation.gate.deploymentsAllowed).toBe(!isFrozen);
        expect(evaluation.gate.deploymentsFrozenAt === null).toBe(!isFrozen);

        const wasFrozen: boolean = previous
          ? !previous.gate.deploymentsAllowed
          : false;

        expect(evaluation.transition).toBe(
          wasFrozen === isFrozen
            ? null
            : isFrozen
              ? SloDeploymentGateTransition.Frozen
              : SloDeploymentGateTransition.Allowed,
        );

        if (wasFrozen && isFrozen) {
          expect(evaluation.gate.deploymentsFrozenAt?.getTime()).toBe(
            previous!.gate.deploymentsFrozenAt?.getTime(),
          );
        }

        previous = evaluation;
      }
    },
  );
});
