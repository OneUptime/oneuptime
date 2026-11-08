import { JSONObject, JSONValue } from "../../Types/JSON";
import {
  SloRecommendedBurnRateRuleToAdd,
  getSloRecommendedBurnRateRules,
  parseSloRecommendedBurnRateRules,
  sloRecommendedBurnRateRuleToJSON,
} from "./SloRecommendedBurnRateRules";

/*
 * "ADD RECOMMENDED RULES" FOR MANY SLOS AT ONCE.
 *
 * The SLO list's Bulk Actions offer Add recommended rules for the SLOs it
 * has selected, through two routes beside the per-SLO ones
 * (Common/Server/API/ServiceLevelObjectiveBurnRateRuleAPI):
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk
 *        { serviceLevelObjectiveIds }  -> { results }
 *        What each SLO is missing, scaled to its window. Nothing is written.
 *
 *   POST /service-level-objective-burn-rate-rule/recommended-rules/bulk/add
 *        { serviceLevelObjectiveIds }  -> { results }
 *        Adds what each SLO is missing, one SLO after another, through the
 *        same path the per-SLO action takes, and says what happened to each.
 *
 * One result per SLO asked about, in the order asked. What the two routes
 * answer, and what the Dashboard reads from them, is written once here.
 */

/*
 * The most SLOs one request names. Adding takes each SLO's lock and creates
 * up to three rules, each with its feed item and audit log, one SLO after
 * another: a hundred keeps a request to seconds. The Dashboard sends fewer
 * at a time, so its progress moves and Stop is heard between them.
 */
export const SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS: number = 100;

// A request that names no SLO, or names one with something that is not an id.
export const SLO_BULK_NO_IDS_MESSAGE: string =
  "serviceLevelObjectiveIds must be a list of Service Level Objective IDs.";

export const SLO_BULK_TOO_MANY_MESSAGE: string = `serviceLevelObjectiveIds can name at most ${SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS} SLOs. Send the rest in another request.`;

/*
 * What an add says of an SLO whose add failed for a reason that is not
 * OneUptime's own sentence - the database, the network - which the server
 * logs rather than hands to the caller, as the API's error handler does.
 */
export const SLO_BULK_ADD_FAILED_MESSAGE: string =
  "The recommended rules could not all be added to this SLO. Adding them again adds only what is still missing.";

export enum SloBulkRecommendedRulesStatus {
  // Asked what is missing: the SLO is missing these recommended rules.
  Missing = "Missing",
  // Asked to add them: these rules were added to the SLO.
  Added = "Added",
  // The SLO has every recommended rule: nothing to add.
  NothingMissing = "NothingMissing",
  /*
   * The caller may not change the SLO, or cannot read it - one of another
   * project included, which says nothing about itself: nothing was added.
   */
  Refused = "Refused",
  /*
   * Something went wrong part of the way. The rules added before it stay,
   * listed with the result, and asking again adds only what is still missing.
   */
  Failed = "Failed",
}

const STATUSES: ReadonlyArray<string> = Object.values(
  SloBulkRecommendedRulesStatus,
);

export interface SloBulkRecommendedRulesResult {
  // As the request named it.
  serviceLevelObjectiveId: string;
  status: SloBulkRecommendedRulesStatus;
  /*
   * Missing: what would be added. Added: what was. Failed: what was added
   * before it failed. Otherwise none.
   */
  rules: Array<SloRecommendedBurnRateRuleToAdd>;
  // Refused and Failed: why, in the server's words. Otherwise null.
  message: string | null;
}

export type SloBulkRecommendedRulesResultToJSONFunction = (
  result: SloBulkRecommendedRulesResult,
) => JSONObject;

export const sloBulkRecommendedRulesResultToJSON: SloBulkRecommendedRulesResultToJSONFunction =
  (result: SloBulkRecommendedRulesResult): JSONObject => {
    return {
      serviceLevelObjectiveId: result.serviceLevelObjectiveId,
      status: result.status,
      rules: result.rules.map(sloRecommendedBurnRateRuleToJSON),
      message: result.message,
    };
  };

export type ParseSloBulkRecommendedRulesResultsFunction = (
  value: JSONValue | undefined,
) => Array<SloBulkRecommendedRulesResult>;

/*
 * The results of a response, read defensively: an entry that names no SLO,
 * or a status this Dashboard does not know, is left out rather than guessed
 * at - the SLO it was for then reads as unanswered, never as done - and
 * anything that is not a list reads as none.
 */
export const parseSloBulkRecommendedRulesResults: ParseSloBulkRecommendedRulesResultsFunction =
  (value: JSONValue | undefined): Array<SloBulkRecommendedRulesResult> => {
    if (!Array.isArray(value)) {
      return [];
    }

    const results: Array<SloBulkRecommendedRulesResult> = [];

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
        status: status as SloBulkRecommendedRulesStatus,
        rules: parseSloRecommendedBurnRateRules(json["rules"]),
        message: typeof message === "string" && message.trim() ? message : null,
      });
    }

    return results;
  };

/*
 * An SLO's id as results are matched by: ids are compared whatever their
 * letters' case, as Postgres compares them.
 */
export const getSloBulkResultKey: (id: string) => string = (
  id: string,
): string => {
  return id.trim().toLowerCase();
};

/*
 * ---------------------------------------------------------------------------
 * What the confirmation counts
 * ---------------------------------------------------------------------------
 */

/*
 * One shape a recommended rule takes once it is scaled to a window, and the
 * SLOs that get it in that shape: on a 30-day window Slow leak is 1x over
 * three days, on a 7-day window 1x over 16.8 hours.
 */
export interface SloRecommendedRuleVariantCount {
  // The rule as these SLOs get it.
  rule: SloRecommendedBurnRateRuleToAdd;
  // The SLOs that get it, in the order they were asked about.
  serviceLevelObjectiveIds: Array<string>;
}

export interface SloRecommendedRuleCount {
  name: string;
  // How many SLOs get it, in any shape.
  sloCount: number;
  // Its shapes, the most common first.
  variants: Array<SloRecommendedRuleVariantCount>;
}

export interface SloBulkRecommendedRulesSummary {
  // SLOs that get - or got - at least one rule.
  withRulesSloCount: number;
  nothingMissingSloCount: number;
  refusedSloCount: number;
  failedSloCount: number;
  // Every recommended rule some SLO gets, in the order they are recommended.
  rules: Array<SloRecommendedRuleCount>;
}

// What tells one scaled shape of a rule from another.
const getVariantKey: (rule: SloRecommendedBurnRateRuleToAdd) => string = (
  rule: SloRecommendedBurnRateRuleToAdd,
): string => {
  return JSON.stringify([
    rule.name,
    rule.burnRateThreshold,
    rule.longWindowInMinutes,
    rule.shortWindowInMinutes,
    rule.refireSuppressionMinutes,
    rule.alertSeverity,
    rule.alertSeverityName,
  ]);
};

// The recommended rules' names, fastest burn first, as they are created.
const RECOMMENDED_ORDER: Array<string> = getSloRecommendedBurnRateRules({}).map(
  (rule: { name: string }): string => {
    return rule.name;
  },
);

export type SummarizeSloBulkRecommendedRulesFunction = (
  results: ReadonlyArray<SloBulkRecommendedRulesResult>,
) => SloBulkRecommendedRulesSummary;

/*
 * How many SLOs get which recommended rules, in which shapes: what the bulk
 * confirmation says before anything is added (results of the preview) and
 * what the result says was added (results of the add, a failed SLO's
 * partial rules included).
 *
 * Each SLO is counted once, by the result given for it first. Rules are in
 * the order they are recommended (Fast burn, Slow burn, Slow leak), a rule
 * of another name after them; a rule's shapes are the most common first,
 * ties in the order they came up.
 */
export const summarizeSloBulkRecommendedRules: SummarizeSloBulkRecommendedRulesFunction =
  (
    results: ReadonlyArray<SloBulkRecommendedRulesResult>,
  ): SloBulkRecommendedRulesSummary => {
    const summary: SloBulkRecommendedRulesSummary = {
      withRulesSloCount: 0,
      nothingMissingSloCount: 0,
      refusedSloCount: 0,
      failedSloCount: 0,
      rules: [],
    };

    const seen: Set<string> = new Set<string>();
    const rulesByName: Map<string, SloRecommendedRuleCount> = new Map();
    const variantsByKey: Map<string, SloRecommendedRuleVariantCount> =
      new Map();

    for (const result of results) {
      const key: string = getSloBulkResultKey(result.serviceLevelObjectiveId);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      if (result.status === SloBulkRecommendedRulesStatus.NothingMissing) {
        summary.nothingMissingSloCount += 1;
      } else if (result.status === SloBulkRecommendedRulesStatus.Refused) {
        summary.refusedSloCount += 1;
      } else if (result.status === SloBulkRecommendedRulesStatus.Failed) {
        summary.failedSloCount += 1;
      }

      // Each rule once per SLO, whatever a response repeated.
      const namesOfThisSlo: Set<string> = new Set<string>();

      for (const rule of result.rules) {
        if (namesOfThisSlo.has(rule.name)) {
          continue;
        }

        namesOfThisSlo.add(rule.name);

        let ruleCount: SloRecommendedRuleCount | undefined = rulesByName.get(
          rule.name,
        );

        if (!ruleCount) {
          ruleCount = { name: rule.name, sloCount: 0, variants: [] };
          rulesByName.set(rule.name, ruleCount);
        }

        ruleCount.sloCount += 1;

        const variantKey: string = getVariantKey(rule);
        let variant: SloRecommendedRuleVariantCount | undefined =
          variantsByKey.get(variantKey);

        if (!variant) {
          variant = { rule: rule, serviceLevelObjectiveIds: [] };
          variantsByKey.set(variantKey, variant);
          ruleCount.variants.push(variant);
        }

        variant.serviceLevelObjectiveIds.push(result.serviceLevelObjectiveId);
      }

      if (namesOfThisSlo.size > 0) {
        summary.withRulesSloCount += 1;
      }
    }

    const orderOf: (name: string) => number = (name: string): number => {
      const index: number = RECOMMENDED_ORDER.indexOf(name);

      return index < 0 ? RECOMMENDED_ORDER.length : index;
    };

    // Array.prototype.sort is stable: ties keep the order they came up in.
    summary.rules = Array.from(rulesByName.values()).sort(
      (a: SloRecommendedRuleCount, b: SloRecommendedRuleCount): number => {
        return orderOf(a.name) - orderOf(b.name);
      },
    );

    for (const ruleCount of summary.rules) {
      ruleCount.variants.sort(
        (
          a: SloRecommendedRuleVariantCount,
          b: SloRecommendedRuleVariantCount,
        ): number => {
          return (
            b.serviceLevelObjectiveIds.length -
            a.serviceLevelObjectiveIds.length
          );
        },
      );
    }

    return summary;
  };
