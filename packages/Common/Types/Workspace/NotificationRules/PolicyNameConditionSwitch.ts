import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import { isArchivedValue } from "../../../Utils/ArchivableValues";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "./NotificationRuleCondition";
import { doesConditionMatch } from "./NotificationRuleConditionMatch";

/*
 * FROM A POLICY'S NAME TO THE POLICY ITSELF, IN ONE STEP (#7806).
 *
 * An on-call rule written before policies could be picked matches by name:
 * "On-Call Policy Name contains Primary". A renamed policy stops matching,
 * so the Conditions step says to use On-Call Policy, which stores the
 * policies themselves. Doing that by hand meant deleting the condition,
 * adding another, and picking the policies the words matched without being
 * shown which ones those were.
 *
 * Here is what the words name today, by the server's own comparison
 * (doesConditionMatch, letter case included), and the On-Call Policy
 * condition that keeps matching exactly those policies:
 *
 *   contains, equals, starts with, ends with   -> is any of   the matches
 *   does not contain, does not equal          -> is none of  the policies
 *                                                             the words name
 *
 * Archived policies are left out, as the picker leaves them out of a new
 * pick (#7582), and so are words that name none: there is nothing to pick.
 * A name condition that compares any other way (is empty) has no switch.
 */

// The ways of comparing a name whose matches the switch picks.
const MATCHING_CONDITION_TYPES: ReadonlyArray<ConditionType> = [
  ConditionType.EqualTo,
  ConditionType.Contains,
  ConditionType.StartsWith,
  ConditionType.EndsWith,
];

// The ways of comparing a name that leave its matches out.
const LEAVING_OUT_CONDITION_TYPES: ReadonlyArray<ConditionType> = [
  ConditionType.NotEqualTo,
  ConditionType.NotContains,
];

export interface PolicyNameConditionMatch {
  /*
   * The words leave policies out ("does not contain Primary"): the On-Call
   * Policy condition is none of them.
   */
  isLeavingOut: boolean;
  /*
   * The policies the words name now - those they match, or those they leave
   * out - in the order they were handed in, archived ones left out.
   */
  policies: Array<OnCallDutyPolicy>;
}

export default class PolicyNameConditionSwitch {
  /*
   * What an On-Call Policy Name condition's words name now, among
   * `policies` (the project's). Null when there is nothing to say: another
   * field, a way of comparing with no picker to switch to, no words yet, or
   * policies that could not be read.
   */
  public static getMatch(data: {
    condition: NotificationRuleCondition | undefined | null;
    policies: Array<OnCallDutyPolicy> | undefined;
  }): PolicyNameConditionMatch | null {
    const condition: NotificationRuleCondition | undefined | null =
      data.condition;

    if (
      !condition ||
      condition.checkOn !==
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName ||
      !condition.conditionType ||
      !data.policies
    ) {
      return null;
    }

    const isLeavingOut: boolean = LEAVING_OUT_CONDITION_TYPES.includes(
      condition.conditionType,
    );

    if (
      !isLeavingOut &&
      !MATCHING_CONDITION_TYPES.includes(condition.conditionType)
    ) {
      return null;
    }

    const words: unknown = condition.value;

    if (typeof words !== "string" || words.trim().length === 0) {
      return null;
    }

    const seen: Set<string> = new Set();
    const named: Array<OnCallDutyPolicy> = [];

    for (const policy of data.policies) {
      const id: string = (policy._id?.toString() || "").toLowerCase();

      if (!id || seen.has(id) || isArchivedValue(policy)) {
        continue;
      }

      // The comparison the server makes, with the name it reads.
      const isMatched: boolean = doesConditionMatch({
        value: policy.name || "",
        condition: condition.conditionType,
        filterValue: words,
      });

      // Left out by "does not contain": the policy the words name.
      if (isMatched !== isLeavingOut) {
        seen.add(id);
        named.push(policy);
      }
    }

    return { isLeavingOut: isLeavingOut, policies: named };
  }

  /*
   * The On-Call Policy condition a match switches to - is any of the
   * policies the words match, or is none of those they leave out - or null
   * when the words name no policy, which leaves nothing to pick.
   */
  public static toPolicyCondition(
    match: PolicyNameConditionMatch,
  ): NotificationRuleCondition | null {
    if (match.policies.length === 0) {
      return null;
    }

    return {
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      conditionType: match.isLeavingOut
        ? ConditionType.NotContains
        : ConditionType.ContainsAny,
      value: match.policies.map((policy: OnCallDutyPolicy): string => {
        return policy._id!.toString();
      }),
    };
  }
}
