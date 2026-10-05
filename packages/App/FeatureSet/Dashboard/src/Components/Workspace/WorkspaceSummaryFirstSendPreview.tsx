import OneUptimeDate from "Common/Types/Date";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleColumns,
} from "Common/Utils/Workspace/WorkspaceSummarySchedule";
import React, { FunctionComponent, ReactElement } from "react";

export const WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID: string =
  "workspace-summary-first-send";

export const WORKSPACE_SUMMARY_FIRST_SEND_TEMPLATE: string = translationKey(
  "The first summary goes out {{date}}.",
);

export interface ComponentProps {
  // As the form holds them: a Recurring or its JSON, a Date or its text.
  recurringInterval?: unknown;
  sendFirstReportAt?: unknown;
  // Now, unless given: for tests.
  now?: Date | undefined;
}

/*
 * When a summary being created goes out first: the date picked, or - left
 * empty - 09:00 in the creator's time zone at the start of the next week,
 * day or month; a date already past moves on to the schedule's next
 * occurrence. Worked out the way the server works it out on save
 * (WorkspaceSummaryScheduleUtil.getCreateWrite), so leaving the date empty
 * says what it means.
 */
const WorkspaceSummaryFirstSendPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const timezone: string = OneUptimeDate.getCurrentTimezone();

  const firstSendAt: Date | undefined =
    WorkspaceSummaryScheduleUtil.getCreateWrite({
      write: {
        recurringInterval:
          props.recurringInterval as WorkspaceSummaryScheduleColumns["recurringInterval"],
        sendFirstReportAt:
          props.sendFirstReportAt as WorkspaceSummaryScheduleColumns["sendFirstReportAt"],
      },
      now: props.now,
      timezone: timezone,
    }).nextSendAt;

  if (!firstSendAt) {
    return <></>;
  }

  return (
    <p
      className="mt-2 text-sm text-gray-700"
      data-testid={WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID}
    >
      {translator.translateTemplate(WORKSPACE_SUMMARY_FIRST_SEND_TEMPLATE, {
        date: OneUptimeDate.getDateAsFormattedStringInTimezone({
          date: firstSendAt,
          timezone: timezone,
          showWeekday: true,
        }),
      })}
    </p>
  );
};

export default WorkspaceSummaryFirstSendPreview;
