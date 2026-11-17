/*
 * WHAT A PROJECT'S PRIVACY RULES DO TO ONE INCIDENT OR ALERT, before
 * anything is written (#7213).
 *
 * An incident or alert privacy rule makes what it matches private. The
 * engine's plan says which rules match a record held in memory, and which
 * could not be checked in full: their patterns needed more work than one
 * evaluation may take (Utils/LinearRegExp/PatternWork.ts), so they count as
 * matching - a record is never shown to the whole project because a pattern
 * was not read to the end.
 *
 * The create carries the plan out (applyRulesToIncident, applyRulesToAlert),
 * and "When this goes down" (WhoIsToldService) reads the same plan of the
 * incident or alert a monitor's criteria would open: so the card and a real
 * record never disagree about which are private.
 */
export interface PrivacyRulePlan<TRule> {
  // The rules whose conditions match, in the order they are read.
  matchedRules: Array<TRule>;
  // The rules that could not be checked in full, which count as matching.
  uncheckedRules: Array<TRule>;
  // Some rule matched, or could not be checked in full: the record is made private.
  makesPrivate: boolean;
}

export function makePrivacyRulePlan<TRule>(data: {
  matchedRules: Array<TRule>;
  uncheckedRules: Array<TRule>;
}): PrivacyRulePlan<TRule> {
  return {
    matchedRules: data.matchedRules,
    uncheckedRules: data.uncheckedRules,
    makesPrivate:
      data.matchedRules.length > 0 || data.uncheckedRules.length > 0,
  };
}

/*
 * The rules a plan says make the record private, as its feed entry names
 * them: the ones that matched, or, when none did, the ones that could not
 * be checked in full and so counted as matching.
 */
export function getPrivacyRulesThatApply<TRule>(
  plan: PrivacyRulePlan<TRule>,
): Array<TRule> {
  return plan.matchedRules.length > 0 ? plan.matchedRules : plan.uncheckedRules;
}
