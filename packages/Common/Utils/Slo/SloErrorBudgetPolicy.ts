import { JSONObject, JSONValue } from "../../Types/JSON";
import SloErrorBudgetPolicyChange from "../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import { Translator } from "../../Types/Translator";
import {
  SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE,
  SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE,
} from "./SloEvaluation";
import { formatSloPercent } from "./SloWidgetFormat";

/*
 * AN SLO'S ERROR BUDGET POLICY.
 *
 * The practice of the Google SRE Workbook's "Example Error Budget Policy"
 * (Appendix B): what a team agreed to do as the error budget runs down,
 * written down where it is seen when it matters. A policy is a set of tiers,
 * each a budget-left threshold, a name and the team's agreement ("what we
 * do"). A tier applies while the budget left is at or below its threshold, so
 * 0% is the tier of an exhausted budget, and the SLO is in the most severe
 * tier that applies - the one with the lowest threshold.
 *
 * Tiers are mutually exclusive states, not independent conditions. That is
 * what sets them apart from burn rate rules, which fire side by side: an SLO
 * is in one tier at a time (or in none), entering a more severe tier
 * supersedes the one it was in, and the tier it is in is something people
 * read - on the SLO's Overview, in its feed and through the API. A tier can
 * also freeze deployments: the SLO's deploymentsAllowed - the yes/no a CI/CD
 * pipeline reads - is false while it is in such a tier (the deploy gate,
 * below).
 *
 * Leaving a tier takes the same hysteresis as leaving a status
 * (SloUtil.computeSloStatus), with the same two margins: a tier at 0% is left
 * once 2% of the budget is back, like Budget Exhausted, and any other tier
 * once the budget is 5 points above its threshold, like At Risk. So a tier at
 * 0% and one at the At Risk threshold move exactly with those statuses, and a
 * rolling window hovering at a threshold does not flap the tier, its feed
 * items and the alerts it raises. Entering a tier is immediate.
 *
 * Pure, so the evaluation worker that decides the tier, the server that adds
 * the recommended policy, the Dashboard that draws it and the docs tests all
 * read one source.
 */

// The range a tier's threshold may take: a share of the error budget.
export const SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE: number = 0;
export const SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE: number = 100;

/*
 * "What we do" is the team's agreement, in Markdown. It is shown on the
 * Overview and copied into the feed item of every tier change, so it gets a
 * cap a policy never needs to reach rather than none.
 */
export const SLO_POLICY_TIER_WHAT_WE_DO_MAX_LENGTH: number = 10000;

// What a tier is read by: its id, and its threshold as the column holds it.
export interface SloPolicyTierLike {
  id?: { toString: () => string } | string | undefined | null;
  thresholdPercentage?: number | string | undefined | null;
}

export type ReadSloPolicyTierThresholdFunction = (
  value: unknown,
) => number | null;

/*
 * A threshold as a number, or null when it is not one a tier can have. A
 * decimal column can reach the worker as a string, and the Dashboard's
 * number field hands its value over as one.
 */
export const readSloPolicyTierThreshold: ReadSloPolicyTierThresholdFunction = (
  value: unknown,
): number | null => {
  let threshold: number = Number.NaN;

  if (typeof value === "number") {
    threshold = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    threshold = Number(value.trim());
  }

  if (
    !Number.isFinite(threshold) ||
    threshold < SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE ||
    threshold > SLO_POLICY_TIER_MAX_THRESHOLD_PERCENTAGE
  ) {
    return null;
  }

  return threshold;
};

export type GetSloPolicyTierExitPercentageFunction = (
  thresholdPercentage: number,
) => number;

/*
 * How much budget has to be left before the SLO leaves a tier with this
 * threshold for a less severe one. See the hysteresis above.
 */
export const getSloPolicyTierExitPercentage: GetSloPolicyTierExitPercentageFunction =
  (thresholdPercentage: number): number => {
    if (thresholdPercentage <= SLO_POLICY_TIER_MIN_THRESHOLD_PERCENTAGE) {
      return SLO_BUDGET_EXHAUSTED_RECOVERY_PERCENTAGE;
    }

    return thresholdPercentage + SLO_AT_RISK_RECOVERY_MARGIN_PERCENTAGE;
  };

type TierId = { toString: () => string } | string | undefined | null;

type NormalizeIdFunction = (id: TierId) => string;

// Ids compare case-insensitively: Postgres renders a uuid lower-cased.
const normalizeId: NormalizeIdFunction = (id: TierId): string => {
  return id ? id.toString().trim().toLowerCase() : "";
};

export type IsSameSloPolicyTierFunction = (a: TierId, b: TierId) => boolean;

export const isSameSloPolicyTier: IsSameSloPolicyTierFunction = (
  a: TierId,
  b: TierId,
): boolean => {
  const first: string = normalizeId(a);

  return first !== "" && first === normalizeId(b);
};

/*
 * The tiers a threshold can be read from, most severe (lowest threshold)
 * first. A tier whose threshold is not a valid one is left out: it can apply
 * to no budget. Thresholds are unique per SLO, so the order is total; the id
 * breaks a tie anyway, so the same tiers always come out the same way.
 */
export function sortSloPolicyTiers<T extends SloPolicyTierLike>(
  tiers: ReadonlyArray<T>,
): Array<T> {
  return tiers
    .filter((tier: T): boolean => {
      return readSloPolicyTierThreshold(tier.thresholdPercentage) !== null;
    })
    .sort((a: T, b: T): number => {
      const difference: number =
        (readSloPolicyTierThreshold(a.thresholdPercentage) as number) -
        (readSloPolicyTierThreshold(b.thresholdPercentage) as number);

      if (difference !== 0) {
        return difference;
      }

      return normalizeId(a.id).localeCompare(normalizeId(b.id));
    });
}

/*
 * The tier a budget is in, without hysteresis: the most severe tier whose
 * threshold the budget is at or below, or null when the budget is above every
 * tier. A budget that is not a number is in none.
 */
export function getSloPolicyTierForBudget<T extends SloPolicyTierLike>(data: {
  budgetRemainingPercentage: number;
  tiers: ReadonlyArray<T>;
}): T | null {
  if (!Number.isFinite(data.budgetRemainingPercentage)) {
    return null;
  }

  for (const tier of sortSloPolicyTiers(data.tiers)) {
    if (
      data.budgetRemainingPercentage <=
      (readSloPolicyTierThreshold(tier.thresholdPercentage) as number)
    ) {
      return tier;
    }
  }

  return null;
}

/*
 * The tier the SLO is in after this evaluation.
 *
 * - A tier the budget is at or below that is as severe as the current one,
 *   or more, is entered at once - including a jump across several tiers.
 * - Otherwise the SLO stays in its current tier until the budget clears that
 *   tier's exit percentage, and then moves straight to the tier the budget
 *   is in (or to none).
 * - A current tier that is no longer among `tiers` - deleted, disabled, or
 *   given a threshold no tier can have - holds nothing: the budget alone
 *   decides.
 *
 * A budget that is not a number decides nothing, so the current tier stays.
 */
export function computeSloPolicyTier<T extends SloPolicyTierLike>(data: {
  budgetRemainingPercentage: number;
  tiers: ReadonlyArray<T>;
  currentTierId: TierId;
}): T | null {
  const tiers: Array<T> = sortSloPolicyTiers(data.tiers);

  const currentTier: T | null =
    tiers.find((tier: T): boolean => {
      return isSameSloPolicyTier(tier.id, data.currentTierId);
    }) || null;

  if (!Number.isFinite(data.budgetRemainingPercentage)) {
    return currentTier;
  }

  const tierForBudget: T | null = getSloPolicyTierForBudget({
    budgetRemainingPercentage: data.budgetRemainingPercentage,
    tiers: tiers,
  });

  if (!currentTier) {
    return tierForBudget;
  }

  const currentThreshold: number = readSloPolicyTierThreshold(
    currentTier.thresholdPercentage,
  ) as number;

  if (
    tierForBudget &&
    (readSloPolicyTierThreshold(tierForBudget.thresholdPercentage) as number) <=
      currentThreshold
  ) {
    return tierForBudget;
  }

  if (
    data.budgetRemainingPercentage <
    getSloPolicyTierExitPercentage(currentThreshold)
  ) {
    return currentTier;
  }

  return tierForBudget;
}

export type IsMoreSevereSloPolicyTierFunction = (
  tier: SloPolicyTierLike | null | undefined,
  than: SloPolicyTierLike | null | undefined,
) => boolean;

/*
 * Whether `tier` is more severe than `than`: a lower threshold, or any tier
 * at all against none. Reads "is the SLO escalating" when `tier` is the new
 * tier and `than` the old one.
 */
export const isMoreSevereSloPolicyTier: IsMoreSevereSloPolicyTierFunction = (
  tier: SloPolicyTierLike | null | undefined,
  than: SloPolicyTierLike | null | undefined,
): boolean => {
  const threshold: number | null = tier
    ? readSloPolicyTierThreshold(tier.thresholdPercentage)
    : null;

  if (threshold === null) {
    return false;
  }

  const thanThreshold: number | null = than
    ? readSloPolicyTierThreshold(than.thresholdPercentage)
    : null;

  return thanThreshold === null || threshold < thanThreshold;
};

export type FormatSloPolicyTierThresholdFunction = (
  thresholdPercentage: number | string | undefined | null,
  translator?: Translator | undefined,
) => string;

/*
 * "25%", the way every surface writes a tier's threshold: two decimals at
 * most, and none on a whole number. A threshold that is not a valid one
 * reads as an empty string. A page passes the reader's Translator for the
 * figure in their language ("25 %" in German, "۲۵٪" in Persian); the
 * worker, the server and the API's texts pass none and read as before.
 */
export const formatSloPolicyTierThreshold: FormatSloPolicyTierThresholdFunction =
  (
    thresholdPercentage: number | string | undefined | null,
    translator?: Translator | undefined,
  ): string => {
    const threshold: number | null =
      readSloPolicyTierThreshold(thresholdPercentage);

    if (threshold === null) {
      return "";
    }

    if (translator) {
      return formatSloPercent(threshold, 2, translator) || "";
    }

    return `${String(Math.round(threshold * 100) / 100)}%`;
  };

/*
 * ---------------------------------------------------------------------------
 * The deploy gate
 * ---------------------------------------------------------------------------
 *
 * CI/CD's yes/no, as the SLO's deploymentsAllowed answers it: false while the
 * SLO is in a tier that freezes deployments, true otherwise - with no policy,
 * above every tier, or in a tier that does not freeze them. It is read off
 * the tier computeSloPolicyTier put the SLO in, so it is frozen and allowed
 * again with that tier's hysteresis, and a tier that is disabled or deleted,
 * which holds the SLO no longer, freezes nothing. The evaluation worker
 * writes it in the same state write as the tier columns, and only while it
 * measures the SLO: a Paused or Misconfigured SLO keeps its tier, and so
 * keeps its answer.
 *
 * deploymentsFrozenAt says since when: the evaluation that froze them. It is
 * kept while the SLO moves from one tier that freezes to another, so "frozen
 * since" does not reset while deployments stay frozen.
 */

// What the gate reads a tier by: whether it freezes deployments.
export interface SloDeploymentFreezingTier {
  freezesDeployments?: boolean | null | undefined;
}

export type AreSloDeploymentsAllowedInTierFunction = (
  tier: SloDeploymentFreezingTier | null | undefined,
) => boolean;

/*
 * Whether deployments are allowed while the SLO is in this tier, or in none
 * (null). `=== true`: the column defaults to false, so a tier read without it
 * freezes nothing.
 */
export const areSloDeploymentsAllowedInTier: AreSloDeploymentsAllowedInTierFunction =
  (tier: SloDeploymentFreezingTier | null | undefined): boolean => {
    return !(tier && tier.freezesDeployments === true);
  };

// The gate, as the SLO's two columns hold it.
export interface SloDeploymentGate {
  deploymentsAllowed: boolean;
  // When deployments were frozen; null while they are allowed.
  deploymentsFrozenAt: Date | null;
}

// The gate an SLO had, as a row or an API answer carries it.
export interface SloStoredDeploymentGate {
  deploymentsAllowed?: boolean | null | undefined;
  deploymentsFrozenAt?: Date | string | null | undefined;
}

export type IsSloStoredDeploymentGateAllowedFunction = (
  stored: SloStoredDeploymentGate,
) => boolean;

/*
 * Whether a stored gate allows deployments. Only an explicit false is a
 * freeze: the column defaults to true, and an SLO never evaluated - or read
 * without the column - was frozen by nothing.
 */
export const isSloStoredDeploymentGateAllowed: IsSloStoredDeploymentGateAllowedFunction =
  (stored: SloStoredDeploymentGate): boolean => {
    return stored.deploymentsAllowed !== false;
  };

export type ReadSloDeploymentsFrozenAtFunction = (
  value: Date | string | null | undefined,
) => Date | null;

// A stored freeze time as a Date, or null when there is none to read.
export const readSloDeploymentsFrozenAt: ReadSloDeploymentsFrozenAtFunction = (
  value: Date | string | null | undefined,
): Date | null => {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
};

/*
 * The gate after an evaluation put the SLO in `tier` (null for none), against
 * the gate it had: allowed, with no freeze time; or frozen - since the time
 * stored when it was frozen already, and since `now` when it freezes on this
 * evaluation (or its stored time was lost).
 */
export function computeSloDeploymentGate(data: {
  tier: SloDeploymentFreezingTier | null | undefined;
  stored: SloStoredDeploymentGate;
  now: Date;
}): SloDeploymentGate {
  if (areSloDeploymentsAllowedInTier(data.tier)) {
    return { deploymentsAllowed: true, deploymentsFrozenAt: null };
  }

  const frozenAt: Date | null = isSloStoredDeploymentGateAllowed(data.stored)
    ? null
    : readSloDeploymentsFrozenAt(data.stored.deploymentsFrozenAt);

  return {
    deploymentsAllowed: false,
    deploymentsFrozenAt: frozenAt || data.now,
  };
}

// How an evaluation moved the gate, when it did.
export enum SloDeploymentGateTransition {
  // Deployments were allowed, and are frozen now.
  Frozen = "Frozen",
  // Deployments were frozen, and are allowed again.
  Allowed = "Allowed",
}

export interface SloDeploymentGateColumns {
  deploymentsAllowed?: boolean;
  deploymentsFrozenAt?: Date | null;
}

export interface SloDeploymentGateChange {
  // The gate after the evaluation.
  gate: SloDeploymentGate;
  // Set when deploymentsAllowed flips - the feed says so; null otherwise.
  transition: SloDeploymentGateTransition | null;
  // The columns that change, and only those: none when the gate holds.
  columns: SloDeploymentGateColumns;
}

/*
 * What an evaluation writes for the gate: computeSloDeploymentGate's answer
 * against the stored one. A column is written only when its value changes,
 * so an evaluation that leaves the gate as it was writes nothing for it, and
 * a freeze time left over from a gate that is not frozen is cleared quietly.
 */
export function getSloDeploymentGateChange(data: {
  tier: SloDeploymentFreezingTier | null | undefined;
  stored: SloStoredDeploymentGate;
  now: Date;
}): SloDeploymentGateChange {
  const gate: SloDeploymentGate = computeSloDeploymentGate(data);
  const wasAllowed: boolean = isSloStoredDeploymentGateAllowed(data.stored);
  const storedFrozenAt: Date | null = readSloDeploymentsFrozenAt(
    data.stored.deploymentsFrozenAt,
  );

  const columns: SloDeploymentGateColumns = {};

  if (gate.deploymentsAllowed !== wasAllowed) {
    columns.deploymentsAllowed = gate.deploymentsAllowed;
  }

  if (
    (gate.deploymentsFrozenAt ? gate.deploymentsFrozenAt.getTime() : null) !==
    (storedFrozenAt ? storedFrozenAt.getTime() : null)
  ) {
    columns.deploymentsFrozenAt = gate.deploymentsFrozenAt;
  }

  let transition: SloDeploymentGateTransition | null = null;

  if (wasAllowed && !gate.deploymentsAllowed) {
    transition = SloDeploymentGateTransition.Frozen;
  } else if (!wasAllowed && gate.deploymentsAllowed) {
    transition = SloDeploymentGateTransition.Allowed;
  }

  return { gate, transition, columns };
}

/*
 * ---------------------------------------------------------------------------
 * What an evaluation changed
 * ---------------------------------------------------------------------------
 *
 * The changes one evaluation committed, as the Slack, Microsoft Teams and
 * Mattermost rules for SLOs match them (SloErrorBudgetPolicyChange): the
 * tier change first - entered a more severe tier, recovered to a less
 * severe one, or left every tier - then how the deploy gate moved, when it
 * did. A tier change that froze deployments is both. Nothing when neither
 * moved: a renamed tier refreshes its name quietly, and an SLO that holds
 * its tier under the hysteresis changed nothing.
 */
export function getSloErrorBudgetPolicyChanges(data: {
  // The SLO moved to another tier, or out of every tier.
  isTierChange: boolean;
  // It is in a tier after the evaluation.
  isInTier: boolean;
  // That tier is more severe than the one it left, or it was in none.
  isEscalation: boolean;
  deploymentGateTransition: SloDeploymentGateTransition | null;
}): Array<SloErrorBudgetPolicyChange> {
  const changes: Array<SloErrorBudgetPolicyChange> = [];

  if (data.isTierChange) {
    if (!data.isInTier) {
      changes.push(SloErrorBudgetPolicyChange.LeftEveryTier);
    } else if (data.isEscalation) {
      changes.push(SloErrorBudgetPolicyChange.EnteredMoreSevereTier);
    } else {
      changes.push(SloErrorBudgetPolicyChange.RecoveredToLessSevereTier);
    }
  }

  if (data.deploymentGateTransition === SloDeploymentGateTransition.Frozen) {
    changes.push(SloErrorBudgetPolicyChange.DeploymentsFrozen);
  } else if (
    data.deploymentGateTransition === SloDeploymentGateTransition.Allowed
  ) {
    changes.push(SloErrorBudgetPolicyChange.DeploymentsAllowed);
  }

  return changes;
}

/*
 * ---------------------------------------------------------------------------
 * The recommended policy
 * ---------------------------------------------------------------------------
 *
 * What "Use the recommended policy" adds to an SLO that has no policy yet:
 * three tiers after the SRE Workbook's example, at half the budget, a quarter
 * and none. The wording is a starting point the team edits into its own
 * agreement. Every tier only records and shows the agreement: none raises an
 * alert or declares an incident until someone switches that on. The last one
 * freezes deployments, as its agreement says - "Freeze non-critical
 * releases" is what the deploy gate tells a pipeline.
 *
 * The one definition every surface reads: the per-SLO starter and its
 * confirmation, the API's answer, the AI tool and the docs tests.
 */

export const SLO_POLICY_CAUTION_TIER_NAME: string = "Caution";
export const SLO_POLICY_RELIABILITY_FIRST_TIER_NAME: string =
  "Reliability first";
export const SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME: string = "Budget exhausted";

export interface SloRecommendedPolicyTier {
  name: string;
  thresholdPercentage: number;
  whatWeDo: string;
  // Whether the tier freezes deployments while the SLO is in it.
  freezesDeployments: boolean;
}

export const SLO_RECOMMENDED_POLICY_TIERS: ReadonlyArray<SloRecommendedPolicyTier> =
  [
    {
      name: SLO_POLICY_CAUTION_TIER_NAME,
      thresholdPercentage: 50,
      whatWeDo:
        "Half of the error budget is spent. Review risky changes before they ship, and find out what has been spending the budget.",
      freezesDeployments: false,
    },
    {
      name: SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
      thresholdPercentage: 25,
      whatWeDo:
        "Reliability comes first. Only reliability improvements and critical fixes ship until the budget recovers.",
      freezesDeployments: false,
    },
    {
      name: SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      thresholdPercentage: 0,
      whatWeDo:
        "The error budget is spent. Freeze non-critical releases: only fixes for this SLO's reliability and security fixes ship until the budget is back.",
      freezesDeployments: true,
    },
  ];

// What an existing tier is compared by.
export interface SloExistingPolicyTier {
  name?: string | undefined | null;
  thresholdPercentage?: number | string | undefined | null;
}

type NormalizeNameFunction = (name: string | undefined | null) => string;

const normalizeName: NormalizeNameFunction = (
  name: string | undefined | null,
): string => {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
};

export type GetMissingSloRecommendedPolicyTiersFunction = (data: {
  existingTiers: ReadonlyArray<SloExistingPolicyTier>;
}) => Array<SloRecommendedPolicyTier>;

/*
 * The recommended tiers the SLO does not have yet. A recommended tier is
 * there when a tier has its threshold - thresholds are unique per SLO, so it
 * could not be added beside it anyway - or its name, whatever its threshold:
 * a "Caution" moved to 60% is the team's own Caution, not a reason to add a
 * second one. Enabled or not: a tier somebody switched off was switched off
 * on purpose.
 */
export const getMissingSloRecommendedPolicyTiers: GetMissingSloRecommendedPolicyTiersFunction =
  (data: {
    existingTiers: ReadonlyArray<SloExistingPolicyTier>;
  }): Array<SloRecommendedPolicyTier> => {
    return SLO_RECOMMENDED_POLICY_TIERS.filter(
      (recommended: SloRecommendedPolicyTier): boolean => {
        return !data.existingTiers.some(
          (existing: SloExistingPolicyTier): boolean => {
            if (
              normalizeName(existing.name) === normalizeName(recommended.name)
            ) {
              return true;
            }

            return (
              readSloPolicyTierThreshold(existing.thresholdPercentage) ===
              recommended.thresholdPercentage
            );
          },
        );
      },
    ).map((recommended: SloRecommendedPolicyTier): SloRecommendedPolicyTier => {
      return { ...recommended };
    });
  };

// A recommended tier as the API answers with it.
export interface SloRecommendedPolicyTierToAdd
  extends SloRecommendedPolicyTier {
  // Set on a tier the request just created.
  id?: string | undefined;
}

export type SloRecommendedPolicyTierToJSONFunction = (
  tier: SloRecommendedPolicyTierToAdd,
) => JSONObject;

export const sloRecommendedPolicyTierToJSON: SloRecommendedPolicyTierToJSONFunction =
  (tier: SloRecommendedPolicyTierToAdd): JSONObject => {
    const json: JSONObject = {
      name: tier.name,
      thresholdPercentage: tier.thresholdPercentage,
      whatWeDo: tier.whatWeDo,
      freezesDeployments: tier.freezesDeployments === true,
    };

    if (tier.id) {
      json["id"] = tier.id;
    }

    return json;
  };

export type ParseSloRecommendedPolicyTiersFunction = (
  value: JSONValue | undefined,
) => Array<SloRecommendedPolicyTierToAdd>;

/*
 * The tiers of a response, read defensively: an entry without a name or a
 * valid threshold is left out rather than drawn as a tier that says nothing,
 * and anything that is not a list reads as none. A tier freezes deployments
 * only when the answer says exactly true, as the column is read.
 */
export const parseSloRecommendedPolicyTiers: ParseSloRecommendedPolicyTiersFunction =
  (value: JSONValue | undefined): Array<SloRecommendedPolicyTierToAdd> => {
    if (!Array.isArray(value)) {
      return [];
    }

    const tiers: Array<SloRecommendedPolicyTierToAdd> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const json: JSONObject = entry as JSONObject;
      const name: JSONValue | undefined = json["name"];
      const thresholdPercentage: number | null =
        typeof json["thresholdPercentage"] === "number"
          ? readSloPolicyTierThreshold(json["thresholdPercentage"])
          : null;

      if (
        typeof name !== "string" ||
        !name.trim() ||
        thresholdPercentage === null
      ) {
        continue;
      }

      const whatWeDo: JSONValue | undefined = json["whatWeDo"];
      const id: JSONValue | undefined = json["id"];

      const tier: SloRecommendedPolicyTierToAdd = {
        name: name,
        thresholdPercentage: thresholdPercentage,
        whatWeDo: typeof whatWeDo === "string" ? whatWeDo : "",
        freezesDeployments: json["freezesDeployments"] === true,
      };

      if (typeof id === "string" && id) {
        tier.id = id;
      }

      tiers.push(tier);
    }

    return tiers;
  };
