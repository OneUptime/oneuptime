import SortOrder from "../BaseDatabase/SortOrder";
import ObjectID from "../ObjectID";
import {
  compareListOrderItems,
  ListOrderItem,
  toListOrderNumber,
} from "../../Utils/ListOrder";

/*
 * WHICH ESCALATION RULE OF AN INCOMING CALL POLICY IS DIALLED NEXT.
 *
 * A policy's rules are dialled in their order, lowest number first. They are
 * a drag-ordered list (@ListOrderColumn): a write of a rule's number places
 * that rule and moves no other (issue #9609), so rules written through the
 * API - by Terraform, whose writes land in no set order - may start at 0,
 * leave gaps, or share a number. So "next" is the first rule after the one
 * being dialled in the policy's order, the order the policy's page lists the
 * rules in (Common/Utils/ListOrder: by number, then the older rule first,
 * then by id) - never "the first rule numbered higher", which skipped the
 * second of two rules at one number and never dialled a rule numbered 0.
 *
 * Where the call is comes from the rule being dialled (the call log item
 * names it) and the number it had (the call log keeps it). A rule deleted
 * while its phone rang has its reference cleared: it is placed by that
 * number, and the rules at it and after it come next, as an on-call run
 * places a deleted level (Types/OnCallDutyPolicy/OnCallRunLevel).
 */

// A rule as the dialler reads it: its id, its number, when it was created.
export interface IncomingCallRuleInOrder {
  id?: ObjectID | string | null | undefined;
  _id?: ObjectID | string | null | undefined;
  order?: number | null | undefined;
  createdAt?: Date | string | null | undefined;
}

// The rule a call is dialling now, by its id, and the number it had.
export interface IncomingCallRuleDialled {
  ruleId?: ObjectID | string | null | undefined;
  ruleOrder?: number | null | undefined;
}

const idOf: (value: ObjectID | string | null | undefined) => string = (
  value: ObjectID | string | null | undefined,
): string => {
  return value ? value.toString().toLowerCase() : "";
};

const ruleIdOf: (rule: IncomingCallRuleInOrder) => string = (
  rule: IncomingCallRuleInOrder,
): string => {
  return idOf(rule.id) || idOf(rule._id);
};

const toListOrderItem: (rule: IncomingCallRuleInOrder) => ListOrderItem = (
  rule: IncomingCallRuleInOrder,
): ListOrderItem => {
  return {
    id: ruleIdOf(rule),
    value: rule.order,
    createdAt: rule.createdAt,
  };
};

/*
 * A policy's rules in the order they are dialled: by number, the older of
 * two rules at one number first, then by id. A rule without a number comes
 * last, as the policy's page lists it. Returns a new list.
 */
export function sortIncomingCallRules<TRule extends IncomingCallRuleInOrder>(
  rules: ReadonlyArray<TRule>,
): Array<TRule> {
  return [...rules].sort((a: TRule, b: TRule): number => {
    return compareListOrderItems(
      toListOrderItem(a),
      toListOrderItem(b),
      SortOrder.Ascending,
    );
  });
}

/*
 * The rules to try next, first to last: the ones after the rule being
 * dialled in the policy's order - or every rule, in order, for a call that
 * dials none yet (a new call, or a pass of the policy starting again).
 */
export function getIncomingCallRulesToTry<
  TRule extends IncomingCallRuleInOrder,
>(data: {
  rules: ReadonlyArray<TRule>;
  dialled: IncomingCallRuleDialled | null;
}): Array<TRule> {
  const sorted: Array<TRule> = sortIncomingCallRules(data.rules);
  const dialledId: string = idOf(data.dialled?.ruleId);

  if (dialledId) {
    const index: number = sorted.findIndex((rule: TRule): boolean => {
      return ruleIdOf(rule) === dialledId;
    });

    if (index >= 0) {
      return sorted.slice(index + 1);
    }
  }

  const recorded: number | null = toListOrderNumber(data.dialled?.ruleOrder);

  // The rule dialled is gone: the rules at its number and after it.
  if (recorded !== null) {
    return sorted.filter((rule: TRule): boolean => {
      const order: number | null = toListOrderNumber(rule.order);
      return order !== null && order >= recorded;
    });
  }

  return sorted;
}
