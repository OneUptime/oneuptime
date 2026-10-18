import {
  REMINDER_STOP_STATE_TITLES,
  readStopState,
} from "../../Utils/Form/EventRuleForm";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // An incident or alert reminder rule's stopRemindersOnState, as stored.
  value: unknown;
}

/*
 * An incident's or an alert's reminder rule's "Stop Reminders When" in the
 * rules list: the answer the form gives it - "Resolved" or "Acknowledged" -
 * in the reader's language. The list used to print the stored value as it
 * is, in English beside a form that offers the same answers translated.
 */
const ReminderStopStateText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const title: string = REMINDER_STOP_STATE_TITLES[readStopState(props.value)];

  return <span>{translator.translateText(title) || title}</span>;
};

export default ReminderStopStateText;
