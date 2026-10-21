import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import {
  isMaintenanceWindowInOrder,
  toMaintenanceDate,
} from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  CreateFromRecordKind,
  CreatedRecordKind,
  getCreateFromRecordDefinition,
  getCreateFromRecordQuery,
  readCreateFromRecordId,
} from "../CreateFromRecord/CreateFromRecord";

export { readRecordIds } from "../CreateFromRecord/CreateFromRecord";

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
 * maintenance has had since #4291 (Components/Announcement/
 * AnnouncementFormFields holds the fields):
 *
 *   1. Announcement - what it says: Title and Description, with
 *      Attachments folded under Advanced.
 *   2. Status Pages - where it shows: the status pages, the monitors it is
 *      about (optional), and Schedule & Notifications folded to the one
 *      line that says what happens ("Shows now and stays until you end it.
 *      Subscribers are notified when it starts showing.").
 *
 * and the review step after them. From a status page that page is already
 * picked (?statusPageId=, ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM), so a title
 * and a description are all it takes, and Create goes back to that page's
 * Announcements tab. The page is carried, looked up and picked as every
 * create page opened from a record's tab carries its record
 * (Components/CreateFromRecord): first among the announcement's status
 * pages, ahead of those its template names. The description is required on
 * every announcement form, as the server requires it (the forms used to
 * call it optional, and the request then failed at the end).
 *
 * The announcement's own Edit walks the same steps. Subscribers hear about
 * an announcement once, when it starts showing, so the notify switch takes
 * no updates and is not on the Edit; "Notify subscribers about this
 * update" sits under the description it is about instead, and the folded
 * section there holds only the Schedule. A template adds its name and
 * description in front, and has no schedule, so its one notification
 * switch is drawn open on its Status Pages step - folding a single field
 * behind a header would only add a click.
 *
 * React-free, so App's tests can read it.
 */

/*
 * The query parameters the create page reads: the status page whose
 * Announcements tab it was opened from (CreateFromRecord's, for a status
 * page), and the template picked in "Create from Template".
 */
export const ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM: string =
  getCreateFromRecordDefinition(CreateFromRecordKind.StatusPage).queryParam;

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
 * An ID read off the address (a status page's, a template's): a real UUID,
 * or null. Anything else - a half-copied link, a value someone typed - is
 * ignored rather than handed to the form, which would send it to the server.
 * The one reader every create page uses.
 */
export const readAnnouncementQueryId: (
  value: string | null | undefined,
) => string | null = readCreateFromRecordId;

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
  const query: Dictionary<string> = getCreateFromRecordQuery(
    CreatedRecordKind.Announcement,
    params.statusPageId
      ? { kind: CreateFromRecordKind.StatusPage, id: params.statusPageId }
      : null,
  );

  const announcementTemplateId: string | null = readAnnouncementQueryId(
    params.announcementTemplateId?.toString(),
  );

  if (announcementTemplateId) {
    query[ANNOUNCEMENT_TEMPLATE_QUERY_PARAM] = announcementTemplateId;
  }

  return query;
};

/*
 * Where Create goes once the announcement is made: back to the
 * Announcements tab of the status page it was opened from - but only while
 * that page is still one it shows on. Unpicked on the way, the tab would
 * not list it, and the announcement would look lost; the project's list
 * (null) shows it.
 */
export const getStatusPageToReturnTo: (data: {
  fromStatusPageId: string | null;
  createdStatusPageIds: Array<string>;
}) => string | null = (data: {
  fromStatusPageId: string | null;
  createdStatusPageIds: Array<string>;
}): string | null => {
  if (!data.fromStatusPageId) {
    return null;
  }

  return data.createdStatusPageIds.includes(data.fromStatusPageId)
    ? data.fromStatusPageId
    : null;
};

/*
 * THE SCHEDULE, FOLDED.
 *
 * Start Showing Announcement At (now), End Showing Announcement At (none:
 * it stays until someone ends it) and, on Create, Notify Status Page
 * Subscribers (on) are what nearly every announcement wants, so they are
 * folded into one section whose line says what will happen. On Create it
 * is Schedule & Notifications; on Edit, where the notify switch cannot
 * change, it is Schedule.
 */
export const SCHEDULE_AND_NOTIFICATIONS_SECTION_ID: string =
  "schedule-and-notifications";

export const SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE: string = translationKey(
  "Schedule & Notifications",
);

export const SCHEDULE_SECTION_ID: string = "schedule";

export const SCHEDULE_SECTION_TITLE: string = translationKey("Schedule");

// The fields the section holds, by the columns they write.
export const ANNOUNCEMENT_STARTS_AT_KEY: string = "showAnnouncementAt";

export const ANNOUNCEMENT_ENDS_AT_KEY: string = "endAnnouncementAt";

export const ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY: string =
  "shouldStatusPageSubscribersBeNotified";

// Which form the fields are for.
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
 * The sentence about who is told, on Create. A switch nobody has set is
 * on: that is the column's default, and what the server stores for it.
 */
export const getAnnouncementNotificationSummary: (values: unknown) => string = (
  values: unknown,
): string => {
  return readRecord(values)[ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY] === false
    ? ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY
    : ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY;
};

/*
 * The line the folded section shows, and the review step reviews it by:
 * when it shows, then (on Create) who is told. Sentences without a value
 * are English translation keys, looked up where they are drawn; those with
 * a time are filled in already, in the reader's language.
 */
export const getAnnouncementScheduleSectionSummary: (
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

  if (kind === AnnouncementFormKind.Create) {
    sentences.push(getAnnouncementNotificationSummary(values));
  }

  return sentences;
};

/*
 * The section the schedule (and, on Create, the notify switch) is folded
 * into. It always starts folded: its line says what is set, so nothing is
 * hidden, and it opens by itself when a field in it fails its check.
 */
export const getAnnouncementScheduleSection: <TEntity>(
  kind: AnnouncementFormKind,
) => FormFieldCollapsibleSection<TEntity> = <TEntity>(
  kind: AnnouncementFormKind,
): FormFieldCollapsibleSection<TEntity> => {
  const isCreate: boolean = kind === AnnouncementFormKind.Create;

  return {
    id: isCreate ? SCHEDULE_AND_NOTIFICATIONS_SECTION_ID : SCHEDULE_SECTION_ID,
    title: isCreate
      ? SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE
      : SCHEDULE_SECTION_TITLE,
    description: isCreate
      ? "When the announcement shows on its status pages, and whether their subscribers hear about it."
      : "When the announcement shows on its status pages.",
    openWhenConfigured: false,
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getAnnouncementScheduleSectionSummary(values, kind);
    },
  };
};

export const ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR: string = translationKey(
  "End Showing Announcement At must be after Start Showing Announcement At.",
);

export const ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR: string = translationKey(
  "End Showing Announcement At must be in the future.",
);

/*
 * End Showing Announcement At's own check. An announcement that ends before
 * it starts never shows. A new one that has already ended would never show
 * either, while its subscribers were still told about it - so Create asks
 * for an end still to come. An Edit may set an end that has passed: that
 * is how an announcement is taken down. Folded, the section opens by itself
 * to say what is wrong.
 */
export const getAnnouncementEndsAtError: (
  values: unknown,
  kind: AnnouncementFormKind,
) => string | null = (
  values: unknown,
  kind: AnnouncementFormKind,
): string | null => {
  const record: Record<string, unknown> = readRecord(values);

  if (
    !isMaintenanceWindowInOrder({
      startsAt: record[ANNOUNCEMENT_STARTS_AT_KEY],
      endsAt: record[ANNOUNCEMENT_ENDS_AT_KEY],
    })
  ) {
    return translateValidationMessage(ANNOUNCEMENT_ENDS_BEFORE_IT_STARTS_ERROR);
  }

  const endsAt: Date | null = toMaintenanceDate(
    record[ANNOUNCEMENT_ENDS_AT_KEY],
  );

  if (
    kind === AnnouncementFormKind.Create &&
    endsAt &&
    endsAt.getTime() <= OneUptimeDate.getCurrentDate().getTime()
  ) {
    return translateValidationMessage(ANNOUNCEMENT_ENDS_IN_THE_PAST_ERROR);
  }

  return null;
};
