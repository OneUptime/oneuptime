import OneUptimeDate from "Common/Types/Date";
import {
  getDefaultMaintenanceEnd,
  getMaintenanceEndAfterStartMoved,
  getNextFullHour,
  isMaintenanceWindowInOrder,
  toMaintenanceDate,
} from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * SCHEDULING MAINTENANCE IN THREE SHORT STEPS.
 *
 * The maintainer, closing the feedback document: "reduce decision / choice
 * paralysis as much as possible: show people as few options as possible
 * (and hide those other 'advanced' options), and have sane defaults."
 *
 * Create Scheduled Maintenance Event walked seven steps - Event Info, Event
 * Time, Resources Affected, Status Pages, Owners, Subscribers, Labels - with
 * both times empty and required, and four subscriber controls that already
 * did the right thing. It now walks three, each one a question:
 *
 *   1. Event - what is happening, and when: Title, Description, Starts At
 *      (the next full hour) and Ends At (an hour later, moving along with
 *      the start, and never before it).
 *   2. Resources Affected - the resources picker, with Change Monitor
 *      Status to folded under Advanced.
 *   3. Notify & more - Show event on these status pages, then Subscriber
 *      Notifications folded to the one line that says what happens ("...
 *      notified when it is scheduled, when it starts and when it ends"),
 *      then Owners and Labels folded under Advanced.
 *
 * and the review step after them. Only the title has to be typed: every
 * other step is optional, so the form can be finished from the first one
 * (Forms/Utils/FinishFromAnyStep).
 *
 * The scheduled maintenance template forms and the event's own edit card
 * use the same steps, in the same order, for the fields they hold - a
 * template adds its name and description in front and its recurring
 * schedule at the end; the event's page edits its resources, description
 * and owners in cards of their own.
 *
 * React-free, so App's tests can read it; the pages hold the fields.
 */

/*
 * The event's subscriber switches: whether the subscribers of its status
 * pages are told when it is scheduled (created), when it starts (moves to
 * an ongoing state) and when it ends. Every one defaults to on, on the
 * model and on the forms.
 */
export const SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY: string =
  "shouldStatusPageSubscribersBeNotifiedOnEventCreated";

export const SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY: string =
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing";

export const SUBSCRIBER_NOTIFIED_WHEN_ENDED_KEY: string =
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded";

// The reminders sent before the event starts (a list of intervals).
export const SUBSCRIBER_REMINDERS_KEY: string =
  "sendSubscriberNotificationsOnBeforeTheEvent";

export const SUBSCRIBER_NOTIFICATIONS_SECTION_ID: string =
  "subscriber-notifications";

export interface SubscriberNotificationSettings {
  whenScheduled: boolean;
  whenStarted: boolean;
  whenEnded: boolean;
  hasReminders: boolean;
}

/*
 * What a form's values say about the subscribers. A switch nobody has set
 * is on: that is the column's default, and what the server stores for it.
 */
export const readSubscriberNotificationSettings: (
  values: unknown,
) => SubscriberNotificationSettings = (
  values: unknown,
): SubscriberNotificationSettings => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  const isOn: (key: string) => boolean = (key: string): boolean => {
    return record[key] !== false;
  };

  const reminders: unknown = record[SUBSCRIBER_REMINDERS_KEY];

  return {
    whenScheduled: isOn(SUBSCRIBER_NOTIFIED_WHEN_SCHEDULED_KEY),
    whenStarted: isOn(SUBSCRIBER_NOTIFIED_WHEN_STARTED_KEY),
    whenEnded: isOn(SUBSCRIBER_NOTIFIED_WHEN_ENDED_KEY),
    hasReminders: Array.isArray(reminders) && reminders.length > 0,
  };
};

/*
 * One whole sentence for each combination of the three switches, so a
 * locale translates a sentence rather than words glued together. Keyed by
 * which of scheduled / started / ended are on, in that order.
 */
export const SUBSCRIBER_NOTIFICATION_SUMMARIES: Readonly<
  Record<string, string>
> = {
  "scheduled,started,ended": translationKey(
    "Subscribers of the event's status pages are notified when it is scheduled, when it starts and when it ends.",
  ),
  "scheduled,started": translationKey(
    "Subscribers of the event's status pages are notified when it is scheduled and when it starts.",
  ),
  "scheduled,ended": translationKey(
    "Subscribers of the event's status pages are notified when it is scheduled and when it ends.",
  ),
  "started,ended": translationKey(
    "Subscribers of the event's status pages are notified when it starts and when it ends.",
  ),
  scheduled: translationKey(
    "Subscribers of the event's status pages are notified when it is scheduled.",
  ),
  started: translationKey(
    "Subscribers of the event's status pages are notified when it starts.",
  ),
  ended: translationKey(
    "Subscribers of the event's status pages are notified when it ends.",
  ),
  "": translationKey(
    "Subscribers of the event's status pages are not notified when it is scheduled, starts or ends.",
  ),
};

// Added after the sentence above when the event has any reminder.
export const SUBSCRIBER_REMINDERS_SUMMARY: string = translationKey(
  "They get reminders before it starts.",
);

/*
 * The line a folded Subscriber Notifications section shows: who is told,
 * and when. English sentences, each a translation key.
 */
export const getSubscriberNotificationSummary: (
  values: unknown,
) => Array<string> = (values: unknown): Array<string> => {
  const settings: SubscriberNotificationSettings =
    readSubscriberNotificationSettings(values);

  const moments: Array<string> = [];

  if (settings.whenScheduled) {
    moments.push("scheduled");
  }

  if (settings.whenStarted) {
    moments.push("started");
  }

  if (settings.whenEnded) {
    moments.push("ended");
  }

  const sentences: Array<string> = [
    SUBSCRIBER_NOTIFICATION_SUMMARIES[moments.join(",")]!,
  ];

  if (settings.hasReminders) {
    sentences.push(SUBSCRIBER_REMINDERS_SUMMARY);
  }

  return sentences;
};

/*
 * The section the three switches and the reminders are folded into. It is
 * not an Advanced section: it opens by itself when what it holds is not the
 * default (an event made from a template that keeps subscribers quiet, a
 * template with reminders), so nothing set away from the default is hidden.
 * Folded, it says in a line what will happen.
 */
export const getSubscriberNotificationsSection: <
  TEntity,
>() => FormFieldCollapsibleSection<TEntity> = <
  TEntity,
>(): FormFieldCollapsibleSection<TEntity> => {
  return {
    id: SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
    title: "Subscriber Notifications",
    description:
      "When the subscribers of the event's status pages hear about it.",
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getSubscriberNotificationSummary(values);
    },
  };
};

/*
 * THE MAINTENANCE WINDOW: when a new event starts and ends before anyone
 * says (Common/Types/ScheduledMaintenance/MaintenanceWindow).
 */

const getReaderTimezone: () => string = (): string => {
  return OneUptimeDate.getCurrentTimezone().toString();
};

/*
 * Starts At on a new event: the next full hour on the reader's clock, held
 * the way the date input holds what is typed into it (an ISO string).
 */
export const getDefaultMaintenanceStartsAt: () => string = (): string => {
  return OneUptimeDate.toString(
    getNextFullHour(OneUptimeDate.getCurrentDate(), getReaderTimezone()),
  );
};

// Ends At on a new event: an hour after it starts.
export const getDefaultMaintenanceEndsAt: (values: unknown) => string = (
  values: unknown,
): string => {
  const startsAt: Date | null = toMaintenanceDate(
    values && typeof values === "object"
      ? (values as Record<string, unknown>)["startsAt"]
      : undefined,
  );

  return OneUptimeDate.toString(
    getDefaultMaintenanceEnd(
      startsAt ||
        getNextFullHour(OneUptimeDate.getCurrentDate(), getReaderTimezone()),
    ),
  );
};

export const MAINTENANCE_ENDS_BEFORE_IT_STARTS_ERROR: string = translationKey(
  "Ends At must be after Starts At.",
);

// Ends At's own check: the event has to end after it starts.
export const getMaintenanceEndsAtError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  if (
    isMaintenanceWindowInOrder({
      startsAt: record["startsAt"],
      endsAt: record["endsAt"],
    })
  ) {
    return null;
  }

  return translateValidationMessage(MAINTENANCE_ENDS_BEFORE_IT_STARTS_ERROR);
};

/*
 * Starts At's onChange: the end moves with the start, so the window keeps
 * its length - push the event to tomorrow and it ends tomorrow too. The
 * form writes the new start itself right after calling this, so both are
 * written once it has; written now, the start would be written again over
 * them.
 */
export const moveMaintenanceEndWithStart: <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
): void => {
  const record: Record<string, unknown> = (currentValues || {}) as Record<
    string,
    unknown
  >;

  const endsAt: Date | null = getMaintenanceEndAfterStartMoved({
    previousStartsAt: record["startsAt"],
    previousEndsAt: record["endsAt"],
    nextStartsAt: value,
  });

  if (!endsAt) {
    return;
  }

  const nextValues: FormValues<TEntity> = {
    ...record,
    startsAt: value,
    endsAt: OneUptimeDate.toString(endsAt),
  } as FormValues<TEntity>;

  queueMicrotask(() => {
    setNewFormValues(nextValues);
  });
};
