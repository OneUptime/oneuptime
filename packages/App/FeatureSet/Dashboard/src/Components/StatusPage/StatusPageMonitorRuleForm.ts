import {
  RULE_NAME_MAX_LENGTH,
  RuleNameFollowFunction,
  followPicksWithRuleName,
} from "../../Utils/Form/ResourceRuleForm";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE A STATUS PAGE MONITOR RULE: WHAT IT MATCHES, THEN WHERE THE
 * MONITORS GO.
 *
 * Status Pages -> a page -> Resources -> Monitor Rules. The form used to
 * start with "Basic Info" - a name and a description, asked before anyone
 * had said what the rule was for - then the conditions, then the group. The
 * other rule forms of the product (label, owner, on-call, privacy, SLA and
 * reminder rules) start with what the rule matches, then what it does, and
 * fill the name in from that (Utils/Form/ResourceRuleForm,
 * Utils/Form/EventRuleForm). This one now asks the same way:
 *
 *   - Match (step id "match-criteria"): the conditions a monitor must meet,
 *     drawn as one conditions builder. A status page rule needs at least one
 *     (the server refuses an empty list: a rule that matched every monitor
 *     by mistake would put private monitors on a public page).
 *   - Group: the group the matched monitors go into (empty: the top of the
 *     page), then the rule's Name - filled in from the group ("Add monitors
 *     to Website") and following it until somebody types a name of their
 *     own - its Enabled switch on the Edit form only (a new rule starts on),
 *     and More fields, folded: how each monitor it adds is shown, and the
 *     Description.
 *
 * Nothing stored changes: every field is still the column it was, and a
 * rule saved through the API or Terraform is the rule it was.
 *
 * The page writes its steps and fields out as literals, as the form step
 * guards read them (Common/Tests/Helpers/FormStepsScan.ts); the words and
 * the name are here, React-free, so tests read the exact strings.
 */

export const StatusPageMonitorRuleCopy: {
  // The table names its rows "Monitor Rule": Create Monitor Rule.
  singularName: string;
  pluralName: string;
  /*
   * The phrases the table builds from that name - its button, its dialog's
   * title - kept whole, so a language words each as one phrase.
   */
  createButton: string;
  createDialogTitle: string;
  groupFieldTitle: string;
  groupFieldDescription: string;
  groupPlaceholder: string;
  nameDescription: string;
  namePlaceholder: string;
  enabledDescription: string;
} = {
  singularName: translationKey("Monitor Rule"),
  pluralName: translationKey("Monitor Rules"),
  createButton: translationKey("Create Monitor Rule"),
  createDialogTitle: translationKey("Create New Monitor Rule"),
  groupFieldTitle: translationKey("Add Monitors To"),
  groupFieldDescription: translationKey(
    "The group the monitors it matches go into. Leave it empty to put them at the top of the page.",
  ),
  groupPlaceholder: translationKey("Top of page"),
  nameDescription: translationKey(
    "Named after where it adds monitors until you type a name of your own.",
  ),
  namePlaceholder: translationKey("e.g., Add monitors to Website"),
  enabledDescription: translationKey(
    "Turning a rule off removes the monitors it added to this status page. Monitors you added by hand are left alone.",
  ),
};

/*
 * A new rule's name, after the group its monitors go into - in the reader's
 * language, as the rest of the form.
 */
export const STATUS_PAGE_MONITOR_RULE_NAMES: {
  toGroup: string;
  toTopOfPage: string;
} = {
  toGroup: translationKey("Add monitors to {{group}}"),
  toTopOfPage: translationKey("Add monitors to the top of the page"),
};

/**
 * "Add monitors to Website": the name a rule gets after the group it adds
 * monitors to - the group as its picker names it, a nested group with the
 * groups above it - or, with no group, after the top of the page. It
 * always fits the rule's Name column.
 */
export const getStatusPageMonitorRuleName: (
  groupNames: Array<string>,
) => string = (groupNames: Array<string>): string => {
  const groupName: string = (groupNames[0] || "").trim();

  const name: string = groupName
    ? translateTemplate(STATUS_PAGE_MONITOR_RULE_NAMES.toGroup, {
        group: groupName,
      })
    : translateTemplate(STATUS_PAGE_MONITOR_RULE_NAMES.toTopOfPage);

  return name.slice(0, RULE_NAME_MAX_LENGTH);
};

/**
 * The group field's onChange: the rule's name follows the group picked, as
 * the dropdown names it, while the name is still the form's own - the one
 * it started with, or the one it filled in last. A name somebody typed is
 * kept.
 */
export const followGroupWithRuleName: <
  TEntity,
>() => RuleNameFollowFunction<TEntity> = <
  TEntity,
>(): RuleNameFollowFunction<TEntity> => {
  return followPicksWithRuleName<TEntity>(getStatusPageMonitorRuleName);
};

export default StatusPageMonitorRuleCopy;
