import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  SloBulkRecommendedPolicyResult,
  SloBulkRecommendedPolicyStatus,
  SloBulkRecommendedPolicySummary,
  SloRecommendedPolicyTierCount,
  parseSloBulkRecommendedPolicyResults,
  sloBulkRecommendedPolicyResultToJSON,
  summarizeSloBulkRecommendedPolicy,
} from "../../../Utils/Slo/SloBulkRecommendedPolicy";
import {
  SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  SLO_POLICY_CAUTION_TIER_NAME,
  SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { describe, expect, test } from "@jest/globals";

/*
 * What the bulk routes of Use the recommended policy answer, and what the
 * SLO list's confirmation counts from it (#6358): each SLO once, each tier
 * once - the tiers do not scale with an SLO's window - in the recommended
 * order.
 */

const [CAUTION, RELIABILITY_FIRST, BUDGET_EXHAUSTED] =
  SLO_RECOMMENDED_POLICY_TIERS as Array<SloRecommendedPolicyTier>;

function result(
  id: string,
  status: SloBulkRecommendedPolicyStatus,
  tiers: Array<SloRecommendedPolicyTier> = [],
  message: string | null = null,
): SloBulkRecommendedPolicyResult {
  return {
    serviceLevelObjectiveId: id,
    status: status,
    tiers: tiers.map(
      (tier: SloRecommendedPolicyTier): SloRecommendedPolicyTier => {
        return { ...tier };
      },
    ),
    message: message,
  };
}

describe("a result, through JSON", () => {
  test("reads back as it was written, an added tier's id included", () => {
    const written: SloBulkRecommendedPolicyResult = {
      serviceLevelObjectiveId: "slo-1",
      status: SloBulkRecommendedPolicyStatus.Added,
      tiers: [{ ...BUDGET_EXHAUSTED!, id: "tier-1" }],
      message: null,
    };

    const json: JSONObject = sloBulkRecommendedPolicyResultToJSON(written);

    expect(json).toEqual({
      serviceLevelObjectiveId: "slo-1",
      status: "Added",
      tiers: [
        {
          name: SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
          thresholdPercentage: 0,
          whatWeDo: BUDGET_EXHAUSTED!.whatWeDo,
          freezesDeployments: true,
          id: "tier-1",
        },
      ],
      message: null,
    });
    expect(parseSloBulkRecommendedPolicyResults([json])).toEqual([written]);
  });

  test("leaves out what it cannot read, rather than guessing", () => {
    const value: JSONValue = [
      null,
      "Added",
      [],
      { status: "Added" },
      { serviceLevelObjectiveId: "  ", status: "Added" },
      { serviceLevelObjectiveId: "slo-1", status: "Applied" },
      { serviceLevelObjectiveId: " slo-2 ", status: "OwnPolicy", message: "" },
    ];

    expect(parseSloBulkRecommendedPolicyResults(value)).toEqual([
      {
        serviceLevelObjectiveId: "slo-2",
        status: SloBulkRecommendedPolicyStatus.OwnPolicy,
        tiers: [],
        message: null,
      },
    ]);
    expect(parseSloBulkRecommendedPolicyResults(undefined)).toEqual([]);
    expect(parseSloBulkRecommendedPolicyResults({})).toEqual([]);
  });
});

describe("what the confirmation counts", () => {
  test("each recommended tier once, in the recommended order, with how many SLOs get it", () => {
    const summary: SloBulkRecommendedPolicySummary =
      summarizeSloBulkRecommendedPolicy([
        // The half policy #6978 left: Budget exhausted only.
        result("half", SloBulkRecommendedPolicyStatus.Missing, [
          BUDGET_EXHAUSTED!,
        ]),
        result("empty", SloBulkRecommendedPolicyStatus.Missing, [
          CAUTION!,
          RELIABILITY_FIRST!,
          BUDGET_EXHAUSTED!,
        ]),
        result("complete", SloBulkRecommendedPolicyStatus.NothingMissing),
        result("own", SloBulkRecommendedPolicyStatus.OwnPolicy),
        result(
          "unread",
          SloBulkRecommendedPolicyStatus.Refused,
          [],
          "Service Level Objective not found.",
        ),
      ]);

    expect(summary.withTiersSloCount).toBe(2);
    expect(summary.nothingMissingSloCount).toBe(1);
    expect(summary.ownPolicySloCount).toBe(1);
    expect(summary.refusedSloCount).toBe(1);
    expect(summary.failedSloCount).toBe(0);
    expect(
      summary.tiers.map((count: SloRecommendedPolicyTierCount): string => {
        return `${count.tier.name}: ${count.sloCount}`;
      }),
    ).toEqual([
      `${SLO_POLICY_CAUTION_TIER_NAME}: 1`,
      `${SLO_POLICY_RELIABILITY_FIRST_TIER_NAME}: 1`,
      `${SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME}: 2`,
    ]);
  });

  test("counts an SLO once, by its first result, and a tier once per SLO", () => {
    const summary: SloBulkRecommendedPolicySummary =
      summarizeSloBulkRecommendedPolicy([
        result("slo-1", SloBulkRecommendedPolicyStatus.Added, [
          BUDGET_EXHAUSTED!,
          BUDGET_EXHAUSTED!,
        ]),
        result("SLO-1", SloBulkRecommendedPolicyStatus.Failed),
      ]);

    expect(summary.withTiersSloCount).toBe(1);
    expect(summary.failedSloCount).toBe(0);
    expect(summary.tiers).toEqual([
      { tier: { ...BUDGET_EXHAUSTED! }, sloCount: 1 },
    ]);
  });

  test("lists a tier as OneUptime defines it, whatever an answer says of it", () => {
    const summary: SloBulkRecommendedPolicySummary =
      summarizeSloBulkRecommendedPolicy([
        result("slo-1", SloBulkRecommendedPolicyStatus.Missing, [
          { ...CAUTION!, thresholdPercentage: 90, name: " caution " },
          {
            name: "Made up",
            thresholdPercentage: 5,
            whatWeDo: "",
            freezesDeployments: true,
          },
        ]),
      ]);

    expect(summary.tiers).toEqual([{ tier: { ...CAUTION! }, sloCount: 1 }]);
  });

  test("counts no tiers for SLOs that get none, so there is nothing to add", () => {
    const summary: SloBulkRecommendedPolicySummary =
      summarizeSloBulkRecommendedPolicy([
        result("complete", SloBulkRecommendedPolicyStatus.NothingMissing),
        result("own", SloBulkRecommendedPolicyStatus.OwnPolicy),
        // A refusal or a failure lists no tiers, even if an answer gave some.
        result("failed", SloBulkRecommendedPolicyStatus.Failed, [CAUTION!]),
      ]);

    expect(summary.tiers).toEqual([]);
    expect(summary.withTiersSloCount).toBe(0);
    expect(summary.failedSloCount).toBe(1);
  });
});
