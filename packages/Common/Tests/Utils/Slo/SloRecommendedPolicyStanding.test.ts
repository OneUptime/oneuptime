import {
  SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  SLO_POLICY_CAUTION_TIER_NAME,
  SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloExistingPolicyTier,
  SloRecommendedPolicyStanding,
  SloRecommendedPolicyState,
  SloRecommendedPolicyTier,
  getSloRecommendedPolicyStanding,
  isSloRecommendedPolicyOffered,
  isSloRecommendedPolicyTier,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE AN SLO'S POLICY STANDS AGAINST THE RECOMMENDED ONE (#7351, #6358).
 *
 * One rule decides whether the recommended policy - or the rest of it - is
 * offered: on the Error Budget Policy page (the table's empty state for an
 * SLO with no tier, a banner above the tiers for one with part of the
 * recommended policy) and in the SLO list's bulk action. A policy the team
 * built is never nagged.
 */

function standing(
  existingTiers: Array<SloExistingPolicyTier>,
): SloRecommendedPolicyStanding {
  return getSloRecommendedPolicyStanding({ existingTiers });
}

function namesOf(tiers: Array<SloRecommendedPolicyTier>): Array<string> {
  return tiers.map((tier: SloRecommendedPolicyTier): string => {
    return tier.name;
  });
}

const CAUTION: SloExistingPolicyTier = {
  name: SLO_POLICY_CAUTION_TIER_NAME,
  thresholdPercentage: 50,
};
const RELIABILITY_FIRST: SloExistingPolicyTier = {
  name: SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
  thresholdPercentage: 25,
};
const BUDGET_EXHAUSTED: SloExistingPolicyTier = {
  name: SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  thresholdPercentage: 0,
};

describe("a tier that stands for a recommended one", () => {
  test.each([
    ["a recommended tier as it was added", CAUTION],
    [
      "one with its name, moved off its threshold",
      { name: "Caution", thresholdPercentage: 60 },
    ],
    [
      "one with its name in another case and with spaces",
      { name: "  caution ", thresholdPercentage: 70 },
    ],
    [
      "one at its threshold, reworded",
      { name: "Slow down", thresholdPercentage: 25 },
    ],
    ["a 0% tier stored as text", { name: "Freeze", thresholdPercentage: "0" }],
  ])("%s", (_label: string, tier: SloExistingPolicyTier) => {
    expect(isSloRecommendedPolicyTier(tier)).toBe(true);
  });

  test.each([
    ["a tier of the team's own", { name: "Red", thresholdPercentage: 10 }],
    [
      "one with no name at a threshold of its own",
      { name: "", thresholdPercentage: 75 },
    ],
    ["one with neither", {}],
  ])("is not %s", (_label: string, tier: SloExistingPolicyTier) => {
    expect(isSloRecommendedPolicyTier(tier)).toBe(false);
  });
});

describe("where an SLO's policy stands", () => {
  test("no tier: None, offered the whole recommended policy", () => {
    const result: SloRecommendedPolicyStanding = standing([]);

    expect(result.state).toBe(SloRecommendedPolicyState.None);
    expect(namesOf(result.missingTiers)).toEqual(
      namesOf([...SLO_RECOMMENDED_POLICY_TIERS]),
    );
  });

  /*
   * The half policy "Use the recommended policy" left before #6978 was
   * fixed: Caution and Reliability first, without Budget exhausted, the
   * tier that freezes deployments.
   */
  test("the half policy #6978 left: Partial, offered Budget exhausted", () => {
    const result: SloRecommendedPolicyStanding = standing([
      CAUTION,
      RELIABILITY_FIRST,
    ]);

    expect(result.state).toBe(SloRecommendedPolicyState.Partial);
    expect(namesOf(result.missingTiers)).toEqual([
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    ]);
    expect(result.missingTiers[0]!.freezesDeployments).toBe(true);
  });

  test("one recommended tier, reworded and moved: Partial, offered the other two", () => {
    const result: SloRecommendedPolicyStanding = standing([
      { name: "Last call", thresholdPercentage: 0 },
    ]);

    expect(result.state).toBe(SloRecommendedPolicyState.Partial);
    expect(namesOf(result.missingTiers)).toEqual([
      SLO_POLICY_CAUTION_TIER_NAME,
      SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
    ]);
  });

  test("every recommended tier: Complete, with nothing missing", () => {
    expect(standing([CAUTION, RELIABILITY_FIRST, BUDGET_EXHAUSTED])).toEqual({
      state: SloRecommendedPolicyState.Complete,
      missingTiers: [],
    });
  });

  test("every recommended tier and one of the team's own: still Complete", () => {
    expect(
      standing([
        CAUTION,
        RELIABILITY_FIRST,
        { name: "Red", thresholdPercentage: 10 },
        BUDGET_EXHAUSTED,
      ]).state,
    ).toBe(SloRecommendedPolicyState.Complete);
  });

  test("a tier of the team's own with recommended ones missing: OwnPolicy, never nagged", () => {
    const result: SloRecommendedPolicyStanding = standing([
      CAUTION,
      { name: "Red", thresholdPercentage: 10 },
    ]);

    expect(result.state).toBe(SloRecommendedPolicyState.OwnPolicy);
    // What is missing is still said, for a caller that adds it anyway (the API).
    expect(namesOf(result.missingTiers)).toEqual([
      SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    ]);
  });

  test("a policy made only of the team's own tiers: OwnPolicy", () => {
    expect(
      standing([
        { name: "Yellow", thresholdPercentage: 40 },
        { name: "Red", thresholdPercentage: 10 },
      ]).state,
    ).toBe(SloRecommendedPolicyState.OwnPolicy);
  });

  test("hands out copies, never the recommended tiers themselves", () => {
    const result: SloRecommendedPolicyStanding = standing([]);

    result.missingTiers[0]!.name = "Changed";

    expect(SLO_RECOMMENDED_POLICY_TIERS[0]!.name).toBe(
      SLO_POLICY_CAUTION_TIER_NAME,
    );
  });
});

describe("whether the recommended policy is offered", () => {
  test.each([
    [SloRecommendedPolicyState.None, true],
    [SloRecommendedPolicyState.Partial, true],
    [SloRecommendedPolicyState.Complete, false],
    [SloRecommendedPolicyState.OwnPolicy, false],
  ])("%s: %s", (state: SloRecommendedPolicyState, offered: boolean) => {
    expect(isSloRecommendedPolicyOffered(state)).toBe(offered);
  });
});
