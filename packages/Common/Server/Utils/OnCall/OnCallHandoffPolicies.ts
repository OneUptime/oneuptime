import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import { joinOnCallPassOnNames } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import Timezone from "../../../Types/Timezone";

/*
 * THE POLICIES A SCHEDULE'S HAND-OFF TELLS ITS PEOPLE ABOUT (issue #7969).
 *
 * An on-call policy can page one schedule from several of its escalation
 * rules - Level 1 and Level 3. Whoever is on call in the schedule is on
 * call for the policy, so a hand-off tells each of them once for it: one
 * "You are now on-call for Payments" - one email, one text, one call, one
 * push, one WhatsApp message - and the same for "You are no longer on-call"
 * and "You are next on-call". They used to be told once for each rule:
 * twice over, each email naming one of the rules.
 *
 * Each policy that pages the schedule still tells them: every policy is a
 * reason of its own to be on call. A rule that pages the next person in the
 * rotation (pageNextInRotation) does not page whoever is on call in it, so
 * a hand-off tells nobody for it, as before.
 *
 * Each rule keeps its own on-call time logs (OnCallDutyPolicyTimeLog): the
 * timesheets read them by rule. So a policy is kept with its rules - each
 * once, in their order - and its email names all of them: "Escalation
 * Rules: First line and Escalate", "Escalation Orders: 1 and 2".
 */

// An escalation rule of a policy that pages whoever is on call in the schedule.
export interface OnCallHandoffRule {
  id: ObjectID;
  name: string;
  order: number | null;
}

// A policy that pages the schedule, with every rule of it that does.
export interface OnCallHandoffPolicy {
  projectId: ObjectID;
  policyId: ObjectID;
  policyName: string;
  scheduleName: string;
  scheduleTimezone: Timezone | null;
  // In the policy's order, each rule once. Never empty.
  rules: Array<OnCallHandoffRule>;
}

// What the hand-off emails say of a policy's rules (Templates/User*OnCallRoster.hbs).
export interface OnCallHandoffRuleVars extends Dictionary<string> {
  escalationRuleName: string;
  escalationRuleOrder: string;
}

// What a rule with no name or no order is called, as the emails always said.
export const ON_CALL_HANDOFF_RULE_WITHOUT_NAME: string = "No name provided";
export const ON_CALL_HANDOFF_RULE_WITHOUT_ORDER: string = "-";

export default class OnCallHandoffPolicies {
  /*
   * The policies a hand-off tells people about, from the rows that attach
   * the schedule to escalation rules: one for each policy, in the order the
   * rows name them first, each with its rules in their order. A row that
   * pages the next person in the rotation, or that misses its policy, rule
   * or schedule, is left out - and so is a policy left with no rule.
   */
  public static group(
    attachments: Array<OnCallDutyPolicyEscalationRuleSchedule>,
  ): Array<OnCallHandoffPolicy> {
    const byPolicy: Map<string, OnCallHandoffPolicy> = new Map<
      string,
      OnCallHandoffPolicy
    >();

    for (const attachment of attachments) {
      if (attachment.pageNextInRotation) {
        continue;
      }

      const policy: OnCallDutyPolicy | undefined = attachment.onCallDutyPolicy;
      const rule: OnCallDutyPolicyEscalationRule | undefined =
        attachment.onCallDutyPolicyEscalationRule;
      const schedule: OnCallDutyPolicySchedule | undefined =
        attachment.onCallDutyPolicySchedule;

      if (!attachment.projectId || !policy?.id || !rule?.id || !schedule) {
        continue;
      }

      const policyKey: string = policy.id.toString();
      let entry: OnCallHandoffPolicy | undefined = byPolicy.get(policyKey);

      if (!entry) {
        entry = {
          projectId: attachment.projectId,
          policyId: policy.id,
          policyName: policy.name || "",
          scheduleName: schedule.name || "",
          scheduleTimezone: schedule.timezone || null,
          rules: [],
        };

        byPolicy.set(policyKey, entry);
      }

      // The same rule attached twice is still one rule.
      const ruleId: ObjectID = rule.id;

      if (
        entry.rules.some((kept: OnCallHandoffRule): boolean => {
          return kept.id.toString() === ruleId.toString();
        })
      ) {
        continue;
      }

      entry.rules.push({
        id: ruleId,
        name: rule.name || "",
        order: typeof rule.order === "number" ? rule.order : null,
      });
    }

    for (const entry of byPolicy.values()) {
      entry.rules = OnCallHandoffPolicies.inOrder(entry.rules);
    }

    return [...byPolicy.values()];
  }

  /*
   * The rule a policy's messages are logged against (the notification
   * logs' escalation rule): its first. Its time logs are kept for each.
   */
  public static getFirstRule(policy: OnCallHandoffPolicy): OnCallHandoffRule {
    return policy.rules[0]!;
  }

  /*
   * What the hand-off emails say of the rules: their names and orders,
   * "First line and Escalate", "1 and 2" - one rule's as they always were -
   * and, for more than one, hasSeveralEscalationRules, which titles the rows
   * "Escalation Rules" and "Escalation Orders".
   */
  public static getRuleVars(
    rules: Array<OnCallHandoffRule>,
  ): OnCallHandoffRuleVars {
    const ruleVars: OnCallHandoffRuleVars = {
      escalationRuleName: joinOnCallPassOnNames(
        rules.map((rule: OnCallHandoffRule): string => {
          return rule.name.trim() || ON_CALL_HANDOFF_RULE_WITHOUT_NAME;
        }),
      ),
      escalationRuleOrder: joinOnCallPassOnNames(
        rules.map((rule: OnCallHandoffRule): string => {
          return rule.order === null
            ? ON_CALL_HANDOFF_RULE_WITHOUT_ORDER
            : rule.order.toString();
        }),
      ),
    };

    if (rules.length > 1) {
      ruleVars["hasSeveralEscalationRules"] = "true";
    }

    return ruleVars;
  }

  /*
   * Lowest order first; a rule with no order after the rest, as it came.
   * How every on-call message lists a policy's rules: a hand-off's, and
   * joining's and leaving's (OnCallJoinNotices, OnCallLeaveNotices).
   */
  public static inOrder(
    rules: Array<OnCallHandoffRule>,
  ): Array<OnCallHandoffRule> {
    return rules
      .map((rule: OnCallHandoffRule, index: number) => {
        return { rule, index };
      })
      .sort(
        (
          a: { rule: OnCallHandoffRule; index: number },
          b: { rule: OnCallHandoffRule; index: number },
        ): number => {
          const aOrder: number =
            a.rule.order === null ? Number.POSITIVE_INFINITY : a.rule.order;
          const bOrder: number =
            b.rule.order === null ? Number.POSITIVE_INFINITY : b.rule.order;

          if (aOrder !== bOrder) {
            return aOrder < bOrder ? -1 : 1;
          }

          return a.index - b.index;
        },
      )
      .map((entry: { rule: OnCallHandoffRule }): OnCallHandoffRule => {
        return entry.rule;
      });
  }
}
