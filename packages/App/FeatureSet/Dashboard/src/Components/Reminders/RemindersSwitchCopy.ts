import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import ReminderRuleScope from "./ReminderRuleScope";

/*
 * Whether an incident's, an alert's or a scheduled maintenance event's
 * owners are reminded about it, in one place.
 *
 * It used to be a "Reminders" card on the record's Settings page whose Edit
 * Reminders dialog held one switch, "Enable Reminders": Edit, flip, Save for
 * one yes or no. Now the card is the switch, "Send reminders", which saves
 * the moment it is flipped (RemindersCard, on the shared ModelSwitchCard),
 * with when the next reminder goes out and how many were sent as read-only
 * lines under it.
 *
 * How often the reminders go out is not set here: the project's reminder
 * rules decide that, and the first rule that matches the record wins.
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

export interface RemindersSwitchScopeCopy {
  // The line under the card's title: what the card is for.
  cardDescription: string;
  // Under the switch while reminders are sent.
  switchOnDescription: string;
  // Under the switch while they are not.
  switchOffDescription: string;
}

export const RemindersSwitchCopy: {
  cardTitle: string;
  switchTitle: string;
  // The read-only lines under the switch.
  nextReminderTitle: string;
  remindersSentTitle: string;
} = {
  cardTitle: translationKey("Reminders"),
  switchTitle: translationKey("Send reminders"),
  nextReminderTitle: translationKey("Next Reminder In"),
  remindersSentTitle: translationKey("Reminders Sent"),
};

/*
 * While reminders are on, the matching rule decides how often and until
 * when: an incident's or an alert's rule stops at Resolved or at
 * Acknowledged, and a maintenance rule reminds before the event starts,
 * while it is in progress, or both. So the line under the switch says the
 * rules decide both, and names no stop of its own - "until the incident is
 * resolved" was wrong for every rule that stops at Acknowledged.
 */
export const REMINDERS_SWITCH_SCOPE_COPY: Record<
  ReminderRuleScope,
  RemindersSwitchScopeCopy
> = {
  [ReminderRuleScope.Incident]: {
    cardDescription: translationKey(
      "Remind this incident's owners while it is still open.",
    ),
    switchOnDescription: translationKey(
      "Reminders go to the incident's owners as often, and for as long, as the project's reminder rules say.",
    ),
    switchOffDescription: translationKey(
      "No reminders go out for this incident, whatever the project's reminder rules say.",
    ),
  },
  [ReminderRuleScope.Alert]: {
    cardDescription: translationKey(
      "Remind this alert's owners while it is still open.",
    ),
    switchOnDescription: translationKey(
      "Reminders go to the alert's owners as often, and for as long, as the project's reminder rules say.",
    ),
    switchOffDescription: translationKey(
      "No reminders go out for this alert, whatever the project's reminder rules say.",
    ),
  },
  [ReminderRuleScope.ScheduledMaintenance]: {
    // The answers a maintenance reminder rule offers (Remind Owners).
    cardDescription: translationKey(
      "Remind this event's owners before it starts or while it is in progress.",
    ),
    switchOnDescription: translationKey(
      "Reminders go to the event's owners as often, and for as long, as the project's reminder rules say.",
    ),
    switchOffDescription: translationKey(
      "No reminders go out for this event, whatever the project's reminder rules say.",
    ),
  },
};

export const getRemindersSwitchDescription: (data: {
  scope: ReminderRuleScope;
  isOn: boolean;
}) => string = (data: { scope: ReminderRuleScope; isOn: boolean }): string => {
  const copy: RemindersSwitchScopeCopy =
    REMINDERS_SWITCH_SCOPE_COPY[data.scope];

  return data.isOn ? copy.switchOnDescription : copy.switchOffDescription;
};

// The column the switch writes, on Incident, Alert and ScheduledMaintenance.
export type RemindersSwitchColumn = "enableReminders";

export const REMINDERS_SWITCH_COLUMN: RemindersSwitchColumn = "enableReminders";

// The data-testid of the "Send reminders" switch; one per Settings page.
export const REMINDERS_SWITCH_TEST_ID: string = "reminders-switch";

// The id of the read-only lines under it (the next reminder, reminders sent).
export const REMINDERS_DETAILS_ID: string = "reminders-details";

export default RemindersSwitchCopy;
