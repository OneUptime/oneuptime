import OneUptimeDate from "Common/Types/Date";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { toMaintenanceDate } from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import ScheduledMaintenancePublication, {
  PUBLISH_ON_STATUS_PAGE_AT_COLUMN,
  ScheduledMaintenancePublicationColumns,
} from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ColumnChoiceConfig,
  getColumnChoiceInForm,
} from "../../Utils/Form/ColumnChoice";

/*
 * PUBLISHING A SCHEDULED MAINTENANCE EVENT AT A CHOSEN TIME (#5249).
 *
 * Planned work is often known months before customers should hear of it:
 * an event made on 1 October for 1 December can stay with the team until
 * 24 November, and shows on its status pages as coming up from then - its
 * subscribers are told it is scheduled at that moment, and nobody has to
 * remember to turn it on. (When an event is public is one rule, shared with
 * the server: Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication.)
 *
 * Publishing right away stays what every event does, so on Create
 * Scheduled Maintenance Event the question waits, first, in the folded
 * Subscriber Notifications section after the status pages - publishing is
 * when their subscribers are told the event is scheduled - and the
 * section's line starts with when the event shows: "Shown on its status
 * pages as soon as it is saved." (getEventSubscriberNotificationsSection,
 * in ScheduledMaintenanceForm). Opened, it asks one plain question, Publish
 * on Status Pages: Right away, or At a date and time, which asks for the
 * time. The event's own Edit asks it open, on its Status Pages step, beside
 * the pages and the reminders: that is where it is changed.
 *
 * The answer is kept in a form-only value (ColumnChoice) and written into
 * the one column it stands for, Publish on Status Page At: Right away
 * clears it. The time has to come before the event starts - the point is
 * to tell customers ahead - and a time already past publishes the event as
 * soon as it is saved.
 *
 * React-free, so App's tests can read it; the pages hold the fields.
 */

export enum PublishChoice {
  RightAway = "right-away",
  AtATime = "at-a-time",
}

// The form-only value the answer is kept in: never sent.
export const PUBLISH_CHOICE_KEY: string = "publishOnStatusPagesChoice";

export const PUBLISH_CHOICE_TEST_ID: string =
  "scheduled-maintenance-publish-choice";

export const PublishingCopy: {
  question: string;
  rightAway: string;
  rightAwayDescription: string;
  atATime: string;
  atATimeDescription: string;
  publishAtTitle: string;
  publishAtPlaceholder: string;
} = {
  question: translationKey("Publish on Status Pages"),
  rightAway: translationKey("Right away"),
  rightAwayDescription: translationKey(
    "It shows on its status pages as soon as it is saved.",
  ),
  atATime: translationKey("At a date and time"),
  atATimeDescription: translationKey(
    "Until then it is on no status page, and their subscribers hear nothing of it.",
  ),
  publishAtTitle: translationKey("Publish At"),
  publishAtPlaceholder: translationKey("Pick Date and Time"),
};

/*
 * When the event shows, in a whole sentence each, so a locale translates a
 * sentence rather than words glued together; the time is filled in, in the
 * reader's timezone.
 */
export const PUBLISHING_SUMMARIES: Readonly<{
  rightAway: string;
  from: string;
  since: string;
  atTheTimePicked: string;
}> = {
  rightAway: translationKey(
    "Shown on its status pages as soon as it is saved.",
  ),
  from: translationKey("Shown on its status pages from {{time}}."),
  since: translationKey("Shown on its status pages since {{time}}."),
  atTheTimePicked: translationKey(
    "Shown on its status pages from the time you pick.",
  ),
};

export const PUBLISH_AT_NOT_BEFORE_START_ERROR: string = translationKey(
  "Publish At must be before Starts At.",
);

/*
 * THE EVENT'S OWN PAGE, WHILE IT WAITS.
 *
 * The header of an event kept to the team until its publish time says so
 * plainly, in a band of its own: that it is not on its status pages yet,
 * when it will be - and, when its subscribers are told it is scheduled,
 * that they hear about it then - with one button to publish it now, which
 * asks first, as it tells customers.
 */
export const PublishingNoticeCopy: {
  title: string;
  showsFrom: string;
  showsFromAndTold: string;
  publishNow: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmDescriptionAndTold: string;
  noPermission: string;
} = {
  title: translationKey("Not on status pages yet"),
  showsFrom: translationKey("It shows on its status pages from {{time}}."),
  showsFromAndTold: translationKey(
    "It shows on its status pages from {{time}}, when their subscribers are told it is scheduled.",
  ),
  publishNow: translationKey("Publish Now"),
  confirmTitle: translationKey("Publish this event now?"),
  confirmDescription: translationKey("It shows on its status pages at once."),
  confirmDescriptionAndTold: translationKey(
    "It shows on its status pages at once, and their subscribers are told it is scheduled.",
  ),
  noPermission: translationKey(
    "You do not have permission to publish this event.",
  ),
};

/*
 * THE MAINTENANCE DETAILS CARD: when the event shows, as its Edit asks it -
 * Right away, or the time picked.
 */
export const PublishingDetailCopy: {
  title: string;
  rightAway: string;
} = {
  title: PublishingCopy.question,
  rightAway: PublishingCopy.rightAway,
};

/*
 * THE LIST OF EVENTS: an event kept to the team names the pages it will be
 * shown on under Shown on Status Page - and, under them, from when.
 */
export const SHOWS_FROM_TEXT: string = translationKey("Shows from {{time}}");

/*
 * Its Subscriber Notifications, while the 'scheduled' notification waits
 * for the publish time: sent then, not "Sending Soon".
 */
export const SENT_WHEN_PUBLISHED_TEXT: string = translationKey(
  "Sent when it is published",
);

// What the page reads of an event to say where it stands.
export interface PublishingEvent
  extends ScheduledMaintenancePublicationColumns {
  shouldStatusPageSubscribersBeNotifiedOnEventCreated?: unknown;
  subscriberNotificationStatusOnEventScheduled?: unknown;
  statusPages?: Array<unknown> | undefined;
}

/*
 * When the header's band says the event is not on its status pages yet:
 * Visible on Status Page on, its publish time still to come, and some page
 * to show it on - an event on no page is on none whatever its time. Null
 * otherwise.
 */
export const getWaitingPublishAt: (
  event: PublishingEvent | undefined | null,
  now?: Date | undefined,
) => Date | null = (
  event: PublishingEvent | undefined | null,
  now?: Date | undefined,
): Date | null => {
  if (
    !event ||
    !ScheduledMaintenancePublication.isWaitingToPublish(event, now) ||
    (event.statusPages || []).length === 0
  ) {
    return null;
  }

  return ScheduledMaintenancePublication.getPublishAt(event);
};

/*
 * Whether the event's subscribers hear it is scheduled when it is
 * published: the 'scheduled' notification is on (a switch never set is on,
 * as on the model) and not skipped already.
 */
export const areSubscribersToldWhenPublished: (
  event: PublishingEvent | undefined | null,
) => boolean = (event: PublishingEvent | undefined | null): boolean => {
  if (!event) {
    return false;
  }

  return (
    event.shouldStatusPageSubscribersBeNotifiedOnEventCreated !== false &&
    event.subscriberNotificationStatusOnEventScheduled !==
      StatusPageSubscriberNotificationStatus.Skipped
  );
};

/*
 * Whether the 'scheduled' notification is queued and waiting for the
 * publish time, rather than about to go: Pending, on an event whose publish
 * time - Visible on Status Page on or not - is still to come.
 */
export const isScheduledNotificationWaitingToPublish: (
  event: PublishingEvent | undefined | null,
  now?: Date | undefined,
) => boolean = (
  event: PublishingEvent | undefined | null,
  now?: Date | undefined,
): boolean => {
  if (!event) {
    return false;
  }

  return (
    event.subscriberNotificationStatusOnEventScheduled ===
      StatusPageSubscriberNotificationStatus.Pending &&
    !ScheduledMaintenancePublication.isPublished(event, now)
  );
};

const readRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

/*
 * The question, as a ColumnChoice: the answer the stored column makes - a
 * publish time is At a date and time, none is Right away - and what each
 * answer writes. Right away clears the time; At a date and time keeps the
 * one the form holds, so switching back and forth loses nothing typed, and
 * a form that held none asks for one.
 */
export const PUBLISH_CHOICE: ColumnChoiceConfig<PublishChoice> = {
  key: PUBLISH_CHOICE_KEY,
  title: PublishingCopy.question,
  options: [
    {
      value: PublishChoice.RightAway,
      title: PublishingCopy.rightAway,
      description: PublishingCopy.rightAwayDescription,
    },
    {
      value: PublishChoice.AtATime,
      title: PublishingCopy.atATime,
      description: PublishingCopy.atATimeDescription,
    },
  ],
  readChoice: (values: Record<string, unknown>): PublishChoice => {
    return ScheduledMaintenancePublication.hasPublishTime(
      values as ScheduledMaintenancePublicationColumns,
    )
      ? PublishChoice.AtATime
      : PublishChoice.RightAway;
  },
  getColumns: (choice: PublishChoice): Record<string, unknown> => {
    if (choice === PublishChoice.RightAway) {
      return { [PUBLISH_ON_STATUS_PAGE_AT_COLUMN]: null };
    }

    return {};
  },
  dataTestId: PUBLISH_CHOICE_TEST_ID,
};

// Whether the form's answer is At a date and time.
export const isPublishingAtATime: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    getColumnChoiceInForm(PUBLISH_CHOICE, readRecord(values)) ===
    PublishChoice.AtATime
  );
};

// The publish time the form holds, when its answer is At a date and time.
export const getPublishAtInForm: (values: unknown) => Date | null = (
  values: unknown,
): Date | null => {
  if (!isPublishingAtATime(values)) {
    return null;
  }

  return toMaintenanceDate(
    readRecord(values)[PUBLISH_ON_STATUS_PAGE_AT_COLUMN],
  );
};

const formatTime: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

/*
 * The sentence about when the event shows, as of `now`: right away, from a
 * time still to come, since a time that has passed (an event published at
 * its time already), or - At a date and time picked, no time yet - from the
 * time still to be picked. Sentences without a value are English
 * translation keys, looked up where they are drawn; those with a time are
 * filled in already, in the reader's language.
 */
export const getPublishingSummary: (
  values: unknown,
  now?: Date | undefined,
) => string = (values: unknown, now?: Date | undefined): string => {
  if (!isPublishingAtATime(values)) {
    return PUBLISHING_SUMMARIES.rightAway;
  }

  const publishAt: Date | null = getPublishAtInForm(values);

  if (!publishAt) {
    return PUBLISHING_SUMMARIES.atTheTimePicked;
  }

  const isPast: boolean =
    publishAt.getTime() <= (now || OneUptimeDate.getCurrentDate()).getTime();

  return translateTemplate(
    isPast ? PUBLISHING_SUMMARIES.since : PUBLISHING_SUMMARIES.from,
    { time: formatTime(publishAt) },
  );
};

/*
 * Publish At's own check: the event has to be published before it starts.
 * Telling customers ahead of the work is the reason to pick a time, and one
 * after the start would keep an event in progress off its status pages.
 */
export const getPublishAtError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const publishAt: Date | null = getPublishAtInForm(values);
  const startsAt: Date | null = toMaintenanceDate(
    readRecord(values)["startsAt"],
  );

  if (!publishAt || !startsAt) {
    return null;
  }

  if (publishAt.getTime() < startsAt.getTime()) {
    return null;
  }

  return translateValidationMessage(PUBLISH_AT_NOT_BEFORE_START_ERROR);
};
