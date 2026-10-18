import {
  MAINTENANCE_REMINDER_TIMING_COPY,
  MaintenanceReminderTiming,
  getMaintenanceReminderTiming,
} from "./MaintenanceReminderTiming";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  rule: ScheduledMaintenanceReminderRule;
}

/*
 * A maintenance reminder rule's "Remind Owners" answer in the rules list -
 * "While it is in progress" - read off its two columns the way the form
 * reads them. A rule stored with the pair that never reminds shows a dash,
 * as an empty value does: its form says why.
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
    return <TableEmptyValue />;
  }

  const title: string = MAINTENANCE_REMINDER_TIMING_COPY[timing].title;

  return <span>{translator.translateText(title) || title}</span>;
};

export default MaintenanceReminderTimingText;
