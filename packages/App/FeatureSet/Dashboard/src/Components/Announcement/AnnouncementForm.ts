import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import {
  isMaintenanceWindowInOrder,
  toMaintenanceDate,
} from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import AnnouncementReach, {
  AnnouncementNothingSentReason,
  AnnouncementReachResult,
} from "Common/Types/StatusPage/AnnouncementReach";
import { PublicNoteNothingSentReason } from "Common/Types/StatusPage/PublicNoteReach";
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
  readRecordIds,
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
 *      Subscribers are notified when it starts showing.") - what is true
 *      for the status pages picked (see THE STATUS PAGES PICKED below).
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

/*
 * THE STATUS PAGES PICKED (#9775).
 *
 * Whether the announcement shows, and whether anyone is told, is not the
 * schedule's or the switch's alone: a status page shows announcements only
 * while Show Announcements is on, and the announcement job tells a page's
 * subscribers only while Send Notifications to Subscribers is on
 * (Common/Types/StatusPage/AnnouncementReach, worked out by the server from
 * the pages picked). The line said "Shows now and stays until you end it.
 * Subscribers are notified when it starts showing." whatever pages were
 * picked. Now, once the server has said what is true for them:
 *
 *   - a page picked shows announcements and sends notifications: the
 *     schedule, then "Subscribers are notified when it starts showing.";
 *   - the pages that show announcements send nothing: the schedule, then
 *     why nobody is told (ANNOUNCEMENT_STATUS_PAGES_DO_NOT_NOTIFY);
 *   - none of them shows announcements: why it shows nowhere
 *     (ANNOUNCEMENT_NOT_SHOWN), in place of a schedule that would never
 *     show it, then that nobody is told;
 *   - no page picked yet, or not known yet, or not answered: the schedule,
 *     and no promise that anyone is told.
 *
 * Switched off, "Subscribers are not notified." is true whatever the pages,
 * and is said. The sentences say what a public note's composer says of an
 * event's pages (#9735), of the pages picked here: "picked", since these
 * are pages someone chose on the form.
 */
export const ANNOUNCEMENT_NOT_SHOWN: string = translationKey(
  "None of the status pages picked shows announcements.",
);

export const ANNOUNCEMENT_STATUS_PAGES_DO_NOT_NOTIFY: string = translationKey(
  "The status pages picked do not send notifications to their subscribers.",
);

// Why nobody is told about the announcement, for the server's reason.
export const ANNOUNCEMENT_NOTHING_SENT: Record<
  AnnouncementNothingSentReason,
  string
> = {
  [PublicNoteNothingSentReason.NoStatusPages]: ANNOUNCEMENT_NOT_SHOWN,
  [PublicNoteNothingSentReason.NotificationsOff]:
    ANNOUNCEMENT_STATUS_PAGES_DO_NOT_NOTIFY,
};

/*
 * What the server is asked about the pages picked on the form: their ids,
 * and on the announcement's Edit its own id - or null while none is picked,
 * when there is nothing to ask (the picker itself asks for one).
 */
export interface AnnouncementReachQuestion {
  statusPageIds: Array<string>;
  announcementId: string | null;
}

export const getAnnouncementReachQuestion: (data: {
  values: unknown;
  announcementId?: ObjectID | string | null | undefined;
}) => AnnouncementReachQuestion | null = (data: {
  values: unknown;
  announcementId?: ObjectID | string | null | undefined;
}): AnnouncementReachQuestion | null => {
  const statusPageIds: Array<string> = readRecordIds(
    readRecord(data.values)["statusPages"],
  );

  if (statusPageIds.length === 0) {
    return null;
  }

  return {
    statusPageIds: statusPageIds,
    announcementId: data.announcementId ? data.announcementId.toString() : null,
  };
};

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
 * Whether the server has said that none of the status pages picked shows
 * announcements - so the announcement shows nowhere. Not while none is
 * picked: the picker asks for one, and nothing has been asked.
 */
const isShownNowhere: (
  values: unknown,
  reach: AnnouncementReachResult | null | undefined,
) => boolean = (
  values: unknown,
  reach: AnnouncementReachResult | null | undefined,
): boolean => {
  return Boolean(
    reach &&
      getAnnouncementReachQuestion({ values: values }) &&
      !AnnouncementReach.isShownOnAStatusPage(reach),
  );
};

/*
 * The sentence about who is told, on Create, or null for none. A switch
 * nobody has set is on: that is the column's default, and what the server
 * stores for it. Switched on, it promises only what the server has said of
 * the pages picked (`reach`, the answer for them; null while it is not
 * known): told, or why not - and nothing while no page is picked or
 * nothing is known.
 */
export const getAnnouncementNotificationSummary: (
  values: unknown,
  reach?: AnnouncementReachResult | null | undefined,
) => string | null = (
  values: unknown,
  reach?: AnnouncementReachResult | null | undefined,
): string | null => {
  if (readRecord(values)[ANNOUNCEMENT_NOTIFY_SUBSCRIBERS_KEY] === false) {
    return ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY;
  }

  if (!reach || !getAnnouncementReachQuestion({ values: values })) {
    return null;
  }

  if (!reach.nothingSentReason) {
    return ANNOUNCEMENT_SUBSCRIBERS_NOTIFIED_SUMMARY;
  }

  // Shown nowhere, the line says why first: nobody is told.
  if (!AnnouncementReach.isShownOnAStatusPage(reach)) {
    return ANNOUNCEMENT_SUBSCRIBERS_NOT_NOTIFIED_SUMMARY;
  }

  return ANNOUNCEMENT_NOTHING_SENT[reach.nothingSentReason];
};

/*
 * The line the folded section shows, and the review step reviews it by:
 * when it shows, then (on Create) who is told - or, when the server has
 * said that none of the pages picked shows announcements, that in place of
 * when (see THE STATUS PAGES PICKED). Sentences without a value are English
 * translation keys, looked up where they are drawn; those with a time are
 * filled in already, in the reader's language.
 */
export const getAnnouncementScheduleSectionSummary: (
  values: unknown,
  kind: AnnouncementFormKind,
  reach?: AnnouncementReachResult | null | undefined,
) => Array<string> = (
  values: unknown,
  kind: AnnouncementFormKind,
  reach?: AnnouncementReachResult | null | undefined,
): Array<string> => {
  const sentences: Array<string> = [];

  if (isShownNowhere(values, reach)) {
    sentences.push(ANNOUNCEMENT_NOT_SHOWN);
  } else {
    const schedule: string | null = getAnnouncementScheduleSummary(values);

    if (schedule) {
      sentences.push(schedule);
    }
  }

  if (kind === AnnouncementFormKind.Create) {
    const notification: string | null = getAnnouncementNotificationSummary(
      values,
      reach,
    );

    if (notification) {
      sentences.push(notification);
    }
  }

  return sentences;
};

/*
 * What a notify box says under it, beside its own description, while it
 * is ticked and the server has said nobody would be told: why - the pages
 * picked show no announcements, or send nothing. Null otherwise: ticked
 * with a page that tells its subscribers, unticked, or not known. Create's
 * Notify Status Page Subscribers and the Edit's Notify subscribers about
 * this update say it alike: the job sends both to the same pages.
 */
export const getAnnouncementNotifyBoxReason: (data: {
  values: unknown;
  // The box's own value in the form: its column, or the Edit's misc key.
  fieldKey: string;
  // A box nobody has set: on (Create's column) or off (an Edit's box).
  isTickedByDefault: boolean;
  reach: AnnouncementReachResult | null | undefined;
}) => string | null = (data: {
  values: unknown;
  fieldKey: string;
  isTickedByDefault: boolean;
  reach: AnnouncementReachResult | null | undefined;
}): string | null => {
  const value: unknown = readRecord(data.values)[data.fieldKey];
  const isTicked: boolean =
    value === true || (value !== false && data.isTickedByDefault);

  if (
    !isTicked ||
    !data.reach?.nothingSentReason ||
    !getAnnouncementReachQuestion({ values: data.values })
  ) {
    return null;
  }

  return ANNOUNCEMENT_NOTHING_SENT[data.reach.nothingSentReason];
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
