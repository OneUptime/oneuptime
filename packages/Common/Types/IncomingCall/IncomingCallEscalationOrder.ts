import ObjectID from "../ObjectID";
import {
  OnCallPolicyLevel,
  getOnCallRunLaterLevels,
} from "../OnCallDutyPolicy/OnCallRunLevel";

/*
 * WHICH ESCALATION RULE OF AN INCOMING CALL POLICY IS DIALLED NEXT (issue
 * #9609).
 *
 * A policy's rules are dialled in their order, lowest first. The order is a
 * drag-ordered list's (@ListOrderColumn): a write of a rule's number places
 * that rule and moves no other, so rules written through the API - by
 * Terraform, whose writes land in no set order - may start anywhere, leave
 * gaps, or share a number. So "next" is the first rule after the one being
 * dialled in the policy's order, never "the first numbered higher": two
 * rules at one number come in the order of their ids, as the database reads
 * them, and the second is dialled after the first, never skipped. A rule
 * numbered 0 or below is dialled too.
 *
 * Where the call is comes from the rule being dialled (the call log item
 * names it) and the number it had (the call log keeps it): a rule deleted
 * while its phone rang is placed by that number, and the rules at it and
 * later come next - the same rule an on-call run follows for its levels
 * (Types/OnCallDutyPolicy/OnCallRunLevel), which this reads.
 */

// The rule a call is dialling now, by its id, and the number it had.
export interface IncomingCallRuleDialled {
  ruleId?: ObjectID | string | null | undefined;
  ruleOrder?: number | null | undefined;
}

/*
 * The rules to try next, first to last: the ones after the rule being
 * dialled in the policy's order - or every rule, in order, for a call that
 * dials none yet (a new call, or a pass of the policy starting again).
 */
export function getIncomingCallRulesToTry<
  TRule extends OnCallPolicyLevel,
>(data: {
  rules: ReadonlyArray<TRule>;
  dialled: IncomingCallRuleDialled | null;
}): Array<TRule> {
  return getOnCallRunLaterLevels({
    run: {
      lastExecutedEscalationRuleId: data.dialled?.ruleId || null,
      lastExecutedEscalationRuleOrder: data.dialled?.ruleOrder ?? null,
    },
    levels: data.rules,
  });
}
