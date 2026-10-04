import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import {
  isMaintenanceWindowInOrder,
  toMaintenanceDate,
} from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATING AN ANNOUNCEMENT IN TWO STEPS.
 *
 * The maintainer, closing the feedback document: "make software as simple
 * as possible to use and reduce decision paralysis".
 *
 * Create Announcement walked four steps and a review - Basic Information,
 * Status Pages (one field), Resources Affected (one optional field) and
 * Schedule & Settings, whose three answers ("now", "until I end it",
 * "tell the subscribers") were right for nearly every announcement. And
 * from a status page's own Announcements tab, Create sent people to the
 * project-wide form, where they picked the page they had just been on, and
 * then dropped them on the project-wide list.
 *
 * It now walks two steps, each one a question, in the shape scheduled
 * maintenance has had since #4291:
 *
 *   1. Announcement - what it says: Title and Description, with
 *      Attachments folded under Advanced.
 *   2. Status Pages - where it shows: the status pages, the monitors it is
 *      about (optional), and Schedule & Notifications folded to the one
 *      line that says what happens ("Shows now and stays until you end it.
 *      Subscribers are notified when it starts showing.").
 *
 * and the review step after them. From a status page that page is already
 * picked (?statusPageId=, ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM), so typing
 * a title is all it takes, and Create goes back to that page's
 * Announcements tab.
 *
 * The announcement's own Edit and the announcement template forms put the
 * fields they hold on the same steps: a template adds its name and
 * description in front, and has no schedule, so its one notification
 * switch is drawn open on its Status Pages step - folding a single field
 * behind a header would only add a click.
 *
 * React-free, so App's tests can read it; the pages hold the fields.
 */

/*
 * The query parameters the create page reads: the status page whose
 * Announcements tab it was opened from, and the template picked in
 * "Create from Template".
 */
export const ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM: string = "statusPageId";

export const ANNOUNCEMENT_TEMPLATE_QUERY_PARAM: string =
  "announcementTemplateId";

/*
 * What the create page is opened with. Both are optional: the project-wide
 * Announcements list opens it with neither.
 */
export interface AnnouncementCreateParams {
  statusPageId?: ObjectID | string | null | undefined;
  announcementTemplateId?: ObjectID | string | null | undefined;
}

/*
 * The query string of the create page's address, for the buttons that open
 * it (Components/Announcement/AnnouncementsTable): the status page first,
 * so the page knows where it was opened from, then the template.
 */
export const getAnnouncementCreateQueryParams: (
  params: AnnouncementCreateParams,
) => Dictionary<string> = (
  params: AnnouncementCreateParams,
): Dictionary<string> => {
  const query: Dictionary<string> = {};

  const statusPageId: string | null = readAnnouncementQueryId(
    params.statusPageId?.toString(),
  );

  if (statusPageId) {
    query[ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM] = statusPageId;
  }

  const announcementTemplateId: string | null = readAnnouncementQueryId(
    params.announcementTemplateId?.toString(),
  );

  if (announcementTemplateId) {
    query[ANNOUNCEMENT_TEMPLATE_QUERY_PARAM] = announcementTemplateId;
  }

  return query;
};

/*
 * An ID read off the address (a status page's, a template's): a real UUID,
 * or null. Anything else - a half-copied link, a value someone typed - is
 * ignored rather than handed to the form, which would send it to the server.
 */
export const readAnnouncementQueryId: (
  value: string | null | undefined,
) => string | null = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed: string = value.trim();

  return ObjectID.isValidUUID(trimmed) ? trimmed : null;
};

/*
 * The status pages a new announcement starts with: the page it was created
 * from first, then those its template names, each once. Created from a
 * status page's tab, the announcement always shows there - that is where
 * the person was, and where they land again after creating it.
 */
export const getInitialAnnouncementStatusPageIds: (data: {
  statusPageId?: string | null | undefined;
  templateStatusPageIds?: Array<string> | undefined;
}) => Array<string> = (data: {
  statusPageId?: string | null | undefined;
  templateStatusPageIds?: Array<string> | undefined;
}): Array<string> => {
  const ids: Array<string> = [];

  for (const id of [data.statusPageId, ...(data.templateStatusPageIds || [])]) {
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

/*
 * THE SCHEDULE AND THE NOTIFICATIONS, FOLDED.
 *
 * Start Showing Announcement At (now), End Showing Announcement At (none:
 * it stays until someone ends it) and Notify Status Page Subscribers (on)
 * are what nearly every announcement wants, so they are folded into one
 * section whose line says what will happen. The announcement's Edit folds
 * its "Notify subscribers about this update" box there as well: the
 * notify switch itself cannot be changed after the announcement is created
 * (the column takes no updates).
 */
export const SCHEDULE_AND_NOTIFICATIONS_SECTION_ID: string =
  "schedule-and-notifications";

export const SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE: string = translationKey(
  "Schedule & Notifications",
);

// The fields the section holds, by the columns (or the misc key) they write.
export const ANNOUNCEMENT_STARTS_AT_KEY: string = "showAnnouncementAt";

export const ANNOUNCEMENT_ENDS_AT_KEY: string = "endAnnouncementAt";

export const ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY: string =
  "shouldStatusPageSubscribersBeNotified";

/*
 * Which form the section is in: on Create it reports the notify switch, on
 * Edit the "about this update" box.
 */
export enum AnnouncementFormKind {
  Create = "create",
  Edit = "edit",
}

/*
 * When the announcement shows. Whole sentences, so a locale translates a
 * sentence rather than words glued together; the times are filled in, in
 * the reader's timezone.
 */
export const ANNOUNCEMENT_SCHEDULE_SUMMARIES: Readonly<{
  nowUntilEnded: string;
  nowUntil: string;
  fromUntilEnded: string;
  fromUntil: string;
  ended: string;
}> = {
  nowUntilEnded: translationKey("Shows now and stays until you end it."),
  nowUntil: translationKey("Shows now and stays until {{endsAt}}."),
  fromUntilEnded: translationKey(
    "Shows from {{startsAt}} and stays until you end it.",
  ),
  fromUntil: translationKey("Shows from {{startsAt}} until {{endsAt}}."),
  ended: translationKey("Stopped showing at {{endsAt}}."),
};

// Who hears about it: the notify switch, on Create.
export const ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY: string = translationKey(
  "Subscribers are notified when it starts showing.",
);

export const ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY: string =
  translationKey("Subscribers are not notified.");

// Who hears about this edit: the "about this update" box, on Edit.
export const ANNOUNCEMENT_UPDATE_NOTIFIED_SUMMARY: string = translationKey(
  "Subscribers are notified about this edit.",
);

export const ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY: string = translationKey(
  "Subscribers are not notified about this edit.",
);

const readRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

const formatTime: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
};

/*
 * The sentence about when the announcement shows, or null while the window
 * cannot be read: the start is cleared (the field asks for it), or the end
 * is not after the start (the end's own check says so).
 */
export const getAnnouncementScheduleSummary: (
  values: unknown,
) => string | null = (values: unknown): string | null => {
  const record: Record<string, unknown> = readRecord(values);
  const startsAt: Date | null = toMaintenanceDate(
    record[ANNOUNCEMENT_STARTS_AT_KEY],
  );
  const endsAt: Date | null = toMaintenanceDate(
    record[ANNOUNCEMENT_ENDS_AT_KEY],
  );

  if (!startsAt) {
    return null;
  }

  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return null;
  }

  const now: number = OneUptimeDate.getCurrentDate().getTime();
  const showsNow: boolean = startsAt.getTime() <= now;

  if (endsAt && endsAt.getTime() <= now) {
    return translateTemplate(ANNOUNCEMENT_SCHEDULE_SUMMARIES.ended, {
      endsAt: formatTime(endsAt),
    });
  }

  if (showsNow) {
    return endsAt
      ? translateTemplate(ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntil, {
          endsAt: formatTime(endsAt),
        })
      : ANNOUNCEMENT_SCHEDULE_SUMMARIES.nowUntilEnded;
  }

  return endsAt
    ? translateTemplate(ANNOUNCEMENT_SCHEDULE_SUMMARIES.fromUntil, {
        startsAt: formatTime(startsAt),
        endsAt: formatTime(endsAt),
      })
    : translateTemplate(ANNOUNCEMENT_SCHEDULE_SUMMARIES.fromUntilEnded, {
        startsAt: formatTime(startsAt),
      });
};

/*
 * The sentence about who is told. On Create, a switch nobody has set is
 * on: that is the column's default, and what the server stores for it. On
 * Edit only a ticked box tells anyone.
 */
export const getAnnouncementNotificationSummary: (
  values: unknown,
  kind: AnnouncementFormKind,
) => string = (values: unknown, kind: AnnouncementFormKind): string => {
  const record: Record<string, unknown> = readRecord(values);

  if (kind === AnnouncementFormKind.Edit) {
    return record[SubscriberUpdateNotification.miscDataKey] === true
      ? ANNOUNCEMENT_UPDATE_NOTIFIED_SUMMARY
      : ANNOUNCEMENT_UPDATE_NOT_NOTIFIED_SUMMARY;
  }

  return record[ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY] === false
    ? ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY
    : ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY;
};

/*
 * The line the folded section shows, and the review step reviews it by:
 * when it shows, then who is told. Sentences without a value are English
 * translation keys, looked up where they are drawn; those with a time are
 * filled in already, in the reader's language.
 */
export const getScheduleAndNotificationsSummary: (
  values: unknown,
  kind: AnnouncementFormKind,
) => Array<string> = (
  values: unknown,
  kind: AnnouncementFormKind,
): Array<string> => {
  const sentences: Array<string> = [];
  const schedule: string | null = getAnnouncementScheduleSummary(values);

  if (schedule) {
    sentences.push(schedule);
  }

  sentences.push(getAnnouncementNotificationSummary(values, kind));

  return sentences;
};

/*
 * The section the schedule and the notification answer are folded into. It
 * always starts folded, on Create and on Edit: its line says what is set,
 * so nothing is hidden, and it opens by itself when a field in it fails
 * its check.
 */
export const getScheduleAndNotificationsSection: <TEntity>(
  kind: AnnouncementFormKind,
) => FormFieldCollapsibleSection<TEntity> = <TEntity>(
  kind: AnnouncementFormKind,
): FormFieldCollapsibleSection<TEntity> => {
  return {
    id: SCHEDULE_AND_NOTIFICATIONS_SECTION_ID,
    title: SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
    description:
      "When the announcement shows on its status pages, and whether their subscribers hear about it.",
    openWhenConfigured: false,
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getScheduleAndNotificationsSummary(values, kind);
    },
  };
};

export const ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR: string = translationKey(
  "End Showing Announcement At must be after Start Showing Announcement At.",
);

/*
 * End Showing Announcement At's own check: an announcement that ends
 * before it starts never shows. Folded, the section opens by itself to say
 * so.
 */
export const getAnnouncementEndsAtError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const record: Record<string, unknown> = readRecord(values);

  if (
    isMaintenanceWindowInOrder({
      startsAt: record[ANNOUNCEMENT_STARTS_AT_KEY],
      endsAt: record[ANNOUNCEMENT_ENDS_AT_KEY],
    })
  ) {
    return null;
  }

  return translateValidationMessage(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR);
};
