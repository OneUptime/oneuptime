import { translationKey } from "../../Utils/TranslateTemplate";
import { RuleActionColumns } from "../../../Utils/Rules/RuleAction";

/*
 * WHAT A LABEL OR OWNER RULE ADDS, AS ITS TABLE AND ITS FORM SHOW IT.
 *
 * A label rule adds the labels it lists; an owner rule adds the people and
 * teams it lists; an incident, alert or scheduled maintenance rule can also
 * inherit them with six switches. Which columns those are, and whether a
 * rule adds anything, is one rule the server and the label rule import read
 * too (Common/Utils/Rules/RuleAction), re-exported here for the Dashboard.
 *
 * A NEW rule must add something - the form asks for it (Dashboard Utils/
 * Form/ResourceRuleForm), and the server refuses one that does not, however
 * it is made. A rule saved before they asked, or emptied on its Edit form,
 * may add nothing at all: it matches and does nothing. Editing such a rule
 * does not insist on labels or owners, so it can still be renamed, switched
 * off or deleted; its table marks it "Adds nothing" beside its status
 * instead (RuleTable), so it can be found and fixed.
 *
 * React-free: the Dashboard's rule form reads the switch columns too.
 */

export {
  doesRuleAddNothing,
  getRuleActionColumns,
  INHERITED_LABEL_COLUMNS,
  INHERITED_OWNER_COLUMNS,
  isAnyColumnSwitchedOn,
  LABEL_RULE_LIST_COLUMNS,
  OWNER_RULE_LIST_COLUMNS,
} from "../../../Utils/Rules/RuleAction";

export type { RuleActionColumns } from "../../../Utils/Rules/RuleAction";

// Beside a rule's status in its table, for a rule that adds nothing.
export const RULE_ADDS_NOTHING_TEXT: string = translationKey("Adds nothing");

export const RULE_ADDS_NOTHING_TOOLTIP: string = translationKey(
  "This rule adds nothing when it matches. Edit it to choose what it adds, or delete it.",
);

/*
 * What a table selects to tell whether a rule adds anything: the lists by
 * id - nothing more is read of them - and the switches.
 */
export const getRuleActionSelect: (
  action: RuleActionColumns,
) => Record<string, unknown> = (
  action: RuleActionColumns,
): Record<string, unknown> => {
  const select: Record<string, unknown> = {};

  for (const column of action.listColumns) {
    select[column] = { _id: true };
  }

  for (const column of action.switchColumns) {
    select[column] = true;
  }

  return select;
};
