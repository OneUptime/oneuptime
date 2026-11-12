import BadDataException from "../../../Types/Exception/BadDataException";
import {
  REMINDER_INTERVAL_COLUMN,
  getReminderIntervalRefusal,
  readReminderIntervalInMinutes,
} from "../../../Types/Reminder/ReminderInterval";

/*
 * What an incident's, an alert's or a scheduled maintenance event's
 * reminder rule may be saved with as its interval
 * (Types/Reminder/ReminderInterval): a whole number of minutes from 1 to a
 * year. Anything else is refused with the rule's own words, before
 * anything the rule names is looked up - the value alone decides - and one
 * sent as text is written as the number it spells. A write that leaves the
 * interval out is not checked: an update keeps the rule's own, and a create
 * without one is refused by the required-column check.
 */
export default class ReminderIntervalCheck {
  public static check(data: unknown): void {
    if (!data || typeof data !== "object") {
      return;
    }

    const values: Record<string, unknown> = data as Record<string, unknown>;
    const value: unknown = values[REMINDER_INTERVAL_COLUMN];

    if (value === undefined) {
      return;
    }

    const refusal: string | null = getReminderIntervalRefusal(value);

    if (refusal) {
      throw new BadDataException(refusal);
    }

    values[REMINDER_INTERVAL_COLUMN] = readReminderIntervalInMinutes(value);
  }
}
