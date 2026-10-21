import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  OnCallRuleRecord,
  WorkingHoursOfRule,
  getWorkingHoursRowSummary,
  getWorkingHoursSummary,
} from "./WorkingHoursText";

/*
 * What an on-call rule set to "Only during working hours" does, said where
 * it is set and where it is listed (WorkingHoursText): under the choice on
 * its form, and under its name in the rules table. A rule that pages right
 * away shows neither.
 */

export const WORKING_HOURS_SUMMARY_TEST_ID: string =
  "on-call-rule-working-hours-summary";
export const WORKING_HOURS_ROW_SUMMARY_TEST_ID: string =
  "on-call-rule-row-working-hours";

export interface ComponentProps {
  rule: WorkingHoursOfRule;
  record: OnCallRuleRecord;
}

// Under the choice: the sentence, in the box the form's previews use.
const WorkingHoursSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: string | null = getWorkingHoursSummary(
    props.rule,
    props.record,
    {
      translator: translator,
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    },
  );

  if (!summary) {
    return <></>;
  }

  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5"
      data-testid={WORKING_HOURS_SUMMARY_TEST_ID}
      aria-live="polite"
    >
      <Icon
        icon={IconProp.Clock}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
      />
      <p className="min-w-0 text-sm text-gray-800">{summary}</p>
    </div>
  );
};

export interface RowComponentProps {
  name: string;
  rule: WorkingHoursOfRule;
}

/*
 * A rule's name in the rules table, with "Pages only Mon–Fri 09:00–17:00
 * (Europe/London)" under it when it waits for working hours. The name keeps
 * the table's one line; the hours wrap rather than being cut short.
 */
export const OnCallRuleNameCell: FunctionComponent<RowComponentProps> = (
  props: RowComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const summary: string | null = getWorkingHoursRowSummary(props.rule, {
    translator: translator,
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });

  if (!summary) {
    return <>{props.name}</>;
  }

  return (
    <div className="min-w-0">
      <div className="truncate">{props.name}</div>
      <div
        className="mt-0.5 flex items-start gap-1 whitespace-normal text-xs font-normal text-gray-500"
        data-testid={WORKING_HOURS_ROW_SUMMARY_TEST_ID}
      >
        <Icon
          icon={IconProp.Clock}
          className="mt-px h-3.5 w-3.5 flex-shrink-0 text-gray-400"
        />
        <span className="min-w-0">{summary}</span>
      </div>
    </div>
  );
};

export default WorkingHoursSummary;
