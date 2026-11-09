import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "Common/Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import OneUptimeDate from "Common/Types/Date";
import type ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  areSloDeploymentsAllowedInTier,
  formatSloPolicyTierThreshold,
  isSameSloPolicyTier,
  readSloDeploymentsFrozenAt,
  readSloPolicyTierThreshold,
} from "Common/Utils/Slo/SloErrorBudgetPolicy";

/*
 * AN SLO'S ERROR BUDGET POLICY, AS ITS PAGES DRAW IT.
 *
 * The tier the SLO is in (its currentErrorBudgetPolicyTier* columns, which
 * the evaluation worker writes) read against the tiers themselves, the way
 * a tier's threshold is said wherever it is shown, whether deployments are
 * frozen (the deploy gate, deploymentsAllowed), and the labelled lines a
 * budget chart draws at each tier's threshold.
 *
 * React-free: the Overview, the Error Budget Policy page and both budget
 * charts read the same answers.
 */

// "Budget left ≤ 25%": a tier's threshold wherever a tier is listed.
export const POLICY_TIER_BUDGET_LEFT_TEMPLATE: string = translationKey(
  "Budget left ≤ {{threshold}}",
);

// "Entered 3 hours ago": when the SLO entered the tier it is in.
export const POLICY_TIER_ENTERED_TEMPLATE: string =
  translationKey("Entered {{time}}");

/*
 * The Overview's badge while the deploy gate is shut: "Deployments frozen
 * since Sep 11 2026, 12:00 UTC", or without the time when it is not known.
 */
export const DEPLOYMENTS_FROZEN_SINCE_TEMPLATE: string = translationKey(
  "Deployments frozen since {{time}}",
);
export const DEPLOYMENTS_FROZEN_TEXT: string =
  translationKey("Deployments frozen");

// A tier's Deployments cell on the Error Budget Policy page.
export const POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT: string =
  translationKey("Frozen");
export const POLICY_TIER_DEPLOYMENTS_ALLOWED_TEXT: string =
  translationKey("Allowed");

export type DescribePolicyTierDeploymentsFunction = (tier: {
  freezesDeployments?: boolean | undefined | null;
}) => string;

/*
 * What deployments do while the SLO is in a tier, as its row says it:
 * Frozen for a tier that freezes them, Allowed for any other.
 */
export const describePolicyTierDeployments: DescribePolicyTierDeploymentsFunction =
  (tier: { freezesDeployments?: boolean | undefined | null }): string => {
    return areSloDeploymentsAllowedInTier(tier)
      ? POLICY_TIER_DEPLOYMENTS_ALLOWED_TEXT
      : POLICY_TIER_DEPLOYMENTS_FROZEN_TEXT;
  };

export interface SloDeploymentFreeze {
  // Since when, when the worker recorded it.
  frozenAt: Date | null;
}

export type GetSloDeploymentFreezeFunction = (
  slo: ServiceLevelObjective | null | undefined,
) => SloDeploymentFreeze | null;

/*
 * The SLO's deploy gate as its pages draw it: the freeze, or null while
 * deployments are allowed. Only an explicit false is a freeze - the column
 * defaults to true, and an SLO read without it was frozen by nothing.
 */
export const getSloDeploymentFreeze: GetSloDeploymentFreezeFunction = (
  slo: ServiceLevelObjective | null | undefined,
): SloDeploymentFreeze | null => {
  if (!slo || slo.deploymentsAllowed !== false) {
    return null;
  }

  return {
    frozenAt: readSloDeploymentsFrozenAt(slo.deploymentsFrozenAt),
  };
};

export interface SloCurrentPolicyTier {
  // The tier's name: the tier's own, or the SLO's copy when the tier is gone.
  name: string;
  // The tier itself, when it is among the tiers read.
  tier: ServiceLevelObjectiveErrorBudgetPolicyTier | null;
  thresholdPercentage: number | null;
  whatWeDo: string;
  enteredAt: Date | null;
}

export type IsSloInPolicyTierFunction = (
  slo: ServiceLevelObjective | null | undefined,
) => boolean;

// Whether the worker has put the SLO in a tier of its policy.
export const isSloInPolicyTier: IsSloInPolicyTierFunction = (
  slo: ServiceLevelObjective | null | undefined,
): boolean => {
  return Boolean(
    slo &&
      (slo.currentErrorBudgetPolicyTierId ||
        slo.currentErrorBudgetPolicyTierName?.trim()),
  );
};

export type GetSloCurrentPolicyTierFunction = (data: {
  slo: ServiceLevelObjective | null | undefined;
  tiers: ReadonlyArray<ServiceLevelObjectiveErrorBudgetPolicyTier>;
}) => SloCurrentPolicyTier | null;

/*
 * The tier the SLO is in, or null when it is in none. The name is the
 * tier's own when the tier is among `tiers` - a rename shows at once - and
 * otherwise the name the worker wrote on the SLO, which stays readable when
 * the tier has since been deleted.
 */
export const getSloCurrentPolicyTier: GetSloCurrentPolicyTierFunction = (data: {
  slo: ServiceLevelObjective | null | undefined;
  tiers: ReadonlyArray<ServiceLevelObjectiveErrorBudgetPolicyTier>;
}): SloCurrentPolicyTier | null => {
  const slo: ServiceLevelObjective | null | undefined = data.slo;

  if (!slo || !isSloInPolicyTier(slo)) {
    return null;
  }

  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier | null =
    data.tiers.find(
      (candidate: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
        return isSameSloPolicyTier(
          candidate._id || candidate.id,
          slo.currentErrorBudgetPolicyTierId,
        );
      },
    ) || null;

  const name: string =
    tier?.name?.trim() || slo.currentErrorBudgetPolicyTierName?.trim() || "";

  return {
    name: name,
    tier: tier,
    thresholdPercentage: tier
      ? readSloPolicyTierThreshold(tier.thresholdPercentage)
      : null,
    whatWeDo: tier?.whatWeDo || "",
    enteredAt: slo.currentErrorBudgetPolicyTierEnteredAt
      ? OneUptimeDate.fromString(slo.currentErrorBudgetPolicyTierEnteredAt)
      : null,
  };
};

// The lines a tier's threshold is drawn with, apart from the status lines.
export const POLICY_TIER_LINE_COLOR: string = "#8b5cf6";
export const POLICY_TIER_LINE_DASH: string = "2 3";

export type GetSloPolicyTierLineLabelFunction = (tier: {
  name?: string | undefined | null;
  thresholdPercentage?: number | string | undefined | null;
}) => string;

// "Caution 50%": the tier's name and its threshold, as a rule's line says "Fast burn 14.4×".
export const getSloPolicyTierLineLabel: GetSloPolicyTierLineLabelFunction =
  (tier: {
    name?: string | undefined | null;
    thresholdPercentage?: number | string | undefined | null;
  }): string => {
    return [
      tier.name?.trim() || "",
      formatSloPolicyTierThreshold(tier.thresholdPercentage),
    ]
      .filter(Boolean)
      .join(" ");
  };

export type GetSloPolicyTierReferenceLinesFunction = (data: {
  // The lines the chart already draws: the exhausted and at-risk lines.
  lines: ReadonlyArray<ChartReferenceLineProps>;
  tiers: ReadonlyArray<{
    name?: string | undefined | null;
    thresholdPercentage?: number | string | undefined | null;
    isEnabled?: boolean | undefined | null;
  }>;
}) => Array<ChartReferenceLineProps>;

/*
 * The chart's lines with a labelled line at every enabled tier's threshold,
 * highest first - the order the budget reaches them. A disabled tier is no
 * part of the policy, so it draws nothing.
 *
 * A tier at a value a line is already drawn at - the recommended policy's
 * tier at 0%, a tier at the SLO's at-risk threshold - is said on that line
 * rather than drawn over it: two labels at one height would be drawn one on
 * top of the other. The line keeps its colour, and its label names the tier
 * too, once ("Budget exhausted 0%" for a tier named like the line).
 */
export const getSloPolicyTierReferenceLines: GetSloPolicyTierReferenceLinesFunction =
  (data: {
    lines: ReadonlyArray<ChartReferenceLineProps>;
    tiers: ReadonlyArray<{
      name?: string | undefined | null;
      thresholdPercentage?: number | string | undefined | null;
      isEnabled?: boolean | undefined | null;
    }>;
  }): Array<ChartReferenceLineProps> => {
    const lines: Array<ChartReferenceLineProps> = data.lines.map(
      (line: ChartReferenceLineProps): ChartReferenceLineProps => {
        return { ...line };
      },
    );

    const tiers: Array<{ label: string; name: string; value: number }> = [];

    for (const tier of data.tiers) {
      const value: number | null = readSloPolicyTierThreshold(
        tier.thresholdPercentage,
      );

      if (tier.isEnabled !== true || value === null) {
        continue;
      }

      tiers.push({
        label: getSloPolicyTierLineLabel(tier),
        name: tier.name?.trim() || "",
        value: value,
      });
    }

    tiers.sort(
      (
        a: { label: string; name: string; value: number },
        b: { label: string; name: string; value: number },
      ): number => {
        return b.value - a.value;
      },
    );

    const tierLines: Array<ChartReferenceLineProps> = [];

    for (const tier of tiers) {
      const existing: ChartReferenceLineProps | undefined = lines.find(
        (line: ChartReferenceLineProps): boolean => {
          return line.value === tier.value;
        },
      );

      if (!existing) {
        tierLines.push({
          value: tier.value,
          label: tier.label,
          color: POLICY_TIER_LINE_COLOR,
          strokeDasharray: POLICY_TIER_LINE_DASH,
        });
        continue;
      }

      const existingLabel: string = existing.label?.trim() || "";

      existing.label =
        existingLabel && existingLabel.toLowerCase() !== tier.name.toLowerCase()
          ? `${existingLabel} · ${tier.label}`
          : tier.label;
    }

    return [...lines, ...tierLines];
  };
