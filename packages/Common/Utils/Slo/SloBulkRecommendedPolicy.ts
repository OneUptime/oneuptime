import { JSONObject, JSONValue } from "../../Types/JSON";
import { getSloBulkResultKey } from "./SloBulkRecommendedBurnRateRules";
import {
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
  SloRecommendedPolicyTierToAdd,
  parseSloRecommendedPolicyTiers,
  sloRecommendedPolicyTierToJSON,
} from "./SloErrorBudgetPolicy";

/*
 * "USE THE RECOMMENDED POLICY" FOR MANY SLOS AT ONCE (#6358).
 *
 * The SLO list's Bulk Actions offer the recommended error budget policy for
 * the SLOs it has selected, through two routes beside the per-SLO ones
 * (Common/Server/API/ServiceLevelObjectiveErrorBudgetPolicyTierAPI):
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy/bulk
 *        { serviceLevelObjectiveIds }  -> { results }
 *        What each SLO would get. Nothing is written.
 *
 *   POST /service-level-objective-error-budget-policy-tier/recommended-policy/bulk/add
 *        { serviceLevelObjectiveIds }  -> { results }
 *        Adds it, one SLO after another, through the per-SLO add, and says
 *        what happened to each.
 *
 * Which SLOs get it is the Error Budget Policy page's rule
 * (getSloRecommendedPolicyStanding): an SLO with no policy gets the whole
 * recommended policy, and one whose tiers are part of it gets the rest. An
 * SLO that has every recommended tier, or a policy of its own, is left as it
 * is. A request names between one and
 * SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS SLOs, as Add recommended
 * rules' does, and is answered in the order it named them, each once.
 */

/*
 * What an add says of an SLO whose add failed for a reason that is not
 * OneUptime's own sentence - the database, the network - which the server
 * logs rather than hands to the caller. The per-SLO add is all or nothing,
 * so nothing was added.
 */
export const SLO_BULK_POLICY_ADD_FAILED_MESSAGE: string =
  "The recommended policy could not be added to this SLO, so nothing was added. Adding it again adds what is missing.";

export enum SloBulkRecommendedPolicyStatus {
  // Asked what it would get: the SLO is missing these recommended tiers.
  Missing = "Missing",
  // Asked to add them: these tiers were added to the SLO.
  Added = "Added",
  // The SLO has every recommended tier: nothing to add.
  NothingMissing = "NothingMissing",
  /*
   * The SLO has an error budget policy of its own - a tier that is none of
   * the recommended ones - and is left as it is.
   */
  OwnPolicy = "OwnPolicy",
  /*
   * The caller may not change the SLO, or cannot read it - one of another
   * project included, which says nothing about itself: nothing was added.
   */
  Refused = "Refused",
  // Something went wrong. The per-SLO add is all or nothing: nothing was added.
  Failed = "Failed",
}

const STATUSES: ReadonlyArray<string> = Object.values(
  SloBulkRecommendedPolicyStatus,
);

export interface SloBulkRecommendedPolicyResult {
  // As the request named it.
  serviceLevelObjectiveId: string;
  status: SloBulkRecommendedPolicyStatus;
  // Missing: what would be added. Added: what was. Otherwise none.
  tiers: Array<SloRecommendedPolicyTierToAdd>;
  // Refused and Failed: why, in the server's words. Otherwise null.
  message: string | null;
}

export type SloBulkRecommendedPolicyResultToJSONFunction = (
  result: SloBulkRecommendedPolicyResult,
) => JSONObject;

export const sloBulkRecommendedPolicyResultToJSON: SloBulkRecommendedPolicyResultToJSONFunction =
  (result: SloBulkRecommendedPolicyResult): JSONObject => {
    return {
      serviceLevelObjectiveId: result.serviceLevelObjectiveId,
      status: result.status,
      tiers: result.tiers.map(sloRecommendedPolicyTierToJSON),
      message: result.message,
    };
  };

export type ParseSloBulkRecommendedPolicyResultsFunction = (
  value: JSONValue | undefined,
) => Array<SloBulkRecommendedPolicyResult>;

/*
 * The results of a response, read defensively: an entry that names no SLO,
 * or a status this Dashboard does not know, is left out rather than guessed
 * at - the SLO it was for then reads as unanswered, never as done - and
 * anything that is not a list reads as none.
 */
export const parseSloBulkRecommendedPolicyResults: ParseSloBulkRecommendedPolicyResultsFunction =
  (value: JSONValue | undefined): Array<SloBulkRecommendedPolicyResult> => {
    if (!Array.isArray(value)) {
      return [];
    }

    const results: Array<SloBulkRecommendedPolicyResult> = [];

    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const json: JSONObject = entry as JSONObject;
      const id: JSONValue | undefined = json["serviceLevelObjectiveId"];
      const status: JSONValue | undefined = json["status"];
      const message: JSONValue | undefined = json["message"];

      if (
        typeof id !== "string" ||
        !id.trim() ||
        typeof status !== "string" ||
        !STATUSES.includes(status)
      ) {
        continue;
      }

      results.push({
        serviceLevelObjectiveId: id.trim(),
        status: status as SloBulkRecommendedPolicyStatus,
        tiers: parseSloRecommendedPolicyTiers(json["tiers"]),
        message: typeof message === "string" && message.trim() ? message : null,
      });
    }

    return results;
  };

/*
 * ---------------------------------------------------------------------------
 * What the confirmation counts
 * ---------------------------------------------------------------------------
 */

// One recommended tier, and how many SLOs get it.
export interface SloRecommendedPolicyTierCount {
  tier: SloRecommendedPolicyTier;
  sloCount: number;
}

export interface SloBulkRecommendedPolicySummary {
  // SLOs that get - or got - at least one tier.
  withTiersSloCount: number;
  nothingMissingSloCount: number;
  ownPolicySloCount: number;
  refusedSloCount: number;
  failedSloCount: number;
  /*
   * Each recommended tier some SLO gets, in the order they are recommended:
   * the tiers do not scale with an SLO's window, so each is listed once.
   */
  tiers: Array<SloRecommendedPolicyTierCount>;
}

type NormalizeTierNameFunction = (name: string) => string;

const normalizeTierName: NormalizeTierNameFunction = (name: string): string => {
  return name.trim().toLowerCase();
};

export type SummarizeSloBulkRecommendedPolicyFunction = (
  results: ReadonlyArray<SloBulkRecommendedPolicyResult>,
) => SloBulkRecommendedPolicySummary;

/*
 * How many SLOs get which recommended tiers: what the bulk confirmation says
 * before anything is added (results of the preview), and what the result
 * says was added (results of the add). Each SLO is counted once, by the
 * result given for it first, and each tier once per SLO. A tier is the
 * recommended one of its name, as OneUptime defines it: an answer cannot
 * make it say something else.
 */
export const summarizeSloBulkRecommendedPolicy: SummarizeSloBulkRecommendedPolicyFunction =
  (
    results: ReadonlyArray<SloBulkRecommendedPolicyResult>,
  ): SloBulkRecommendedPolicySummary => {
    const summary: SloBulkRecommendedPolicySummary = {
      withTiersSloCount: 0,
      nothingMissingSloCount: 0,
      ownPolicySloCount: 0,
      refusedSloCount: 0,
      failedSloCount: 0,
      tiers: [],
    };

    const seen: Set<string> = new Set<string>();
    const countByName: Map<string, number> = new Map<string, number>();

    for (const result of results) {
      const key: string = getSloBulkResultKey(result.serviceLevelObjectiveId);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (result.status === SloBulkRecommendedPolicyStatus.NothingMissing) {
        summary.nothingMissingSloCount += 1;
      } else if (result.status === SloBulkRecommendedPolicyStatus.OwnPolicy) {
        summary.ownPolicySloCount += 1;
      } else if (result.status === SloBulkRecommendedPolicyStatus.Refused) {
        summary.refusedSloCount += 1;
      } else if (result.status === SloBulkRecommendedPolicyStatus.Failed) {
        summary.failedSloCount += 1;
      }

      if (
        result.status !== SloBulkRecommendedPolicyStatus.Missing &&
        result.status !== SloBulkRecommendedPolicyStatus.Added
      ) {
        continue;
      }

      const namesOfThisSlo: Set<string> = new Set<string>();

      for (const tier of result.tiers) {
        const name: string = normalizeTierName(tier.name);

        if (namesOfThisSlo.has(name)) {
          continue;
        }

        namesOfThisSlo.add(name);
        countByName.set(name, (countByName.get(name) || 0) + 1);
      }

      if (namesOfThisSlo.size > 0) {
        summary.withTiersSloCount += 1;
      }
    }

    for (const recommended of SLO_RECOMMENDED_POLICY_TIERS) {
      const sloCount: number =
        countByName.get(normalizeTierName(recommended.name)) || 0;

      if (sloCount > 0) {
        summary.tiers.push({ tier: { ...recommended }, sloCount: sloCount });
      }
    }

    return summary;
  };
