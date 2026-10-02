import {
  GroupingRuleKind,
  GroupingRuleSummary as GroupingRuleSummaryData,
  GroupingRuleTranslateFunction,
  GroupingRuleValues,
  getGroupingRuleSummary,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rule: GroupingRuleValues;
  kind: GroupingRuleKind;
}

/*
 * The list's Grouping column: what a rule does, in words. It replaced the
 * Description, Time Window (min) and Inactivity Timeout (min) columns - the
 * last two showed their stored minutes even for a rule that had the setting
 * switched off, so "60" sat beside rules that had no time window at all.
 */
const GroupingRuleSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();

  const summary: GroupingRuleSummaryData = getGroupingRuleSummary({
    rule: props.rule,
    kind: props.kind,
    translate,
  });

  return (
    <div className="space-y-1 text-sm" data-testid="grouping-rule-summary">
      <p
        className="font-medium text-gray-900"
        data-testid="grouping-rule-summary-grouping"
      >
        {summary.grouping}
      </p>
      <p className="text-gray-600" data-testid="grouping-rule-summary-timing">
        {summary.timing}
      </p>
      {summary.details.length > 0 ? (
        <ul
          className="flex flex-wrap gap-1.5 pt-1"
          data-testid="grouping-rule-summary-details"
        >
          {summary.details.map((detail: string): ReactElement => {
            return (
              <li
                key={detail}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
              >
                {detail}
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
    </div>
  );
};

export default GroupingRuleSummary;
