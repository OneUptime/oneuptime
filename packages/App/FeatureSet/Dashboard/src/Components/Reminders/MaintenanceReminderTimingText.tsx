import {
  MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE,
  MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT,
  MAINTENANCE_REMINDER_TIMING_COPY,
  MaintenanceReminderTiming,
  getMaintenanceReminderTiming,
} from "./MaintenanceReminderTiming";
import { Yellow } from "Common/Types/BrandColors";
import ExplainedPill from "Common/UI/Components/Pill/ExplainedPill";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rule: ScheduledMaintenanceReminderRule;
}

export const MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID: string =
  "maintenance-reminder-never-reminds-pill";

// The pill's own button, inside MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID.
export const MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID: string =
  "maintenance-reminder-never-reminds-button";

/*
 * A maintenance reminder rule's "Remind Owners" answer in the rules list -
 * "While it is in progress" - read off its two columns the way the form
 * reads them. A rule stored with the pair that never reminds is marked
 * "Never reminds", in amber - as a label rule that adds nothing is marked
 * "Adds nothing" - so a rule that quietly does nothing stands out in the
 * list, on a phone's cards too, where an empty value's dash left the line
 * out altogether. Why, and what to do, is said on hover, on a tap, on
 * keyboard focus and to a screen reader (ExplainedPill).
 */
const MaintenanceReminderTimingText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const timing: MaintenanceReminderTiming | null = getMaintenanceReminderTiming(
    {
      remindWhileScheduled: props.rule.remindWhileScheduled,
      stopRemindersOnState: props.rule.stopRemindersOnState,
    },
  );

  if (timing === null) {
    return (
      <span data-testid={MAINTENANCE_REMINDER_NEVER_REMINDS_TEST_ID}>
        <ExplainedPill
          color={Yellow}
          text={MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT}
          explanation={MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE}
          dataTestId={MAINTENANCE_REMINDER_NEVER_REMINDS_BUTTON_TEST_ID}
        />
      </span>
    );
  }

  const title: string = MAINTENANCE_REMINDER_TIMING_COPY[timing].title;

  return <span>{translator.translateText(title) || title}</span>;
};

export default MaintenanceReminderTimingText;
