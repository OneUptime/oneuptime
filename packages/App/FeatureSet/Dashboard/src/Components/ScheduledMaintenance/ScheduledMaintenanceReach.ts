import Recurring from "Common/Types/Events/Recurring";
import { JSONObject } from "Common/Types/JSON";
import { toMaintenanceDate } from "Common/Types/ScheduledMaintenance/MaintenanceWindow";
import ScheduledMaintenanceSubscriberReach, {
  MaintenanceEventNothingSentReason,
  MaintenanceMomentOwnReason,
  MaintenanceReminderReach,
  MaintenanceStatusPagesReason,
  MaintenanceSubscriberMoment,
  ScheduledMaintenanceSubscriberSettings,
} from "Common/Types/ScheduledMaintenance/ScheduledMaintenanceSubscriberReach";
import { PickedStatusPagesReachResult } from "Common/Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "Common/Types/StatusPage/PublicNoteReach";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";
import {
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  StatusPageVisibilityKind,
} from "../StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import MaintenanceStatusPagesCopy from "./MaintenanceStatusPagesCopy";
import {
  EVENT_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
  SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
  SUBSCRIBER_NOTIFICATIONS_SECTION_TITLE,
  SUBSCRIBER_NOTIFICATION_SUMMARIES,
  SUBSCRIBER_REMINDERS_KEY,
  SUBSCRIBER_REMINDERS_SUMMARY,
  TEMPLATE_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
  readSubscriberNotificationSettings,
} from "./ScheduledMaintenanceForm";
import {
  MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED_TEXT,
  REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT,
  getPublishAtInForm,
  getPublishingSummary,
  isPublishingAtATime,
} from "./ScheduledMaintenancePublishing";

/*
 * WHAT SCHEDULE MAINTENANCE EVENT, AND A MAINTENANCE TEMPLATE, SAY ABOUT
 * THE SUBSCRIBERS (#9920).
 *
 * The folded Subscriber Notifications section said "Shown on its status
 * pages as soon as it is saved. Subscribers of the event's status pages are
 * notified when it is scheduled, when it starts and when it ends."
 * whatever status pages were picked, and the review step repeated it. It
 * was not true when no page was picked, when the pages picked hide
 * maintenance events or send nothing, nor for a moment the event's own
 * settings keep from anyone. What is true is what the notification jobs do
 * (Common/Types/ScheduledMaintenance/ScheduledMaintenanceSubscriberReach),
 * worked out from two things:
 *
 *   - the status pages picked, which the server answers for (the reach
 *     route of the maintenance API, asked by useScheduledMaintenanceReach):
 *     whether one of them shows maintenance events, and whether one that
 *     does notifies - naming no page;
 *   - the event's own settings, which the form holds: Visible on Status
 *     Page (on, unless the form holds it off), when it is published, the
 *     three switches and the reminders - so the line follows them as they
 *     change, without asking again.
 *
 * The line, on the folded header and the review step:
 *
 *   - hidden from its status pages: that, and nobody is told;
 *   - no page picked: it appears on none, and nobody is told;
 *   - none of the pages picked shows maintenance events: that, in place of
 *     when it shows, and nobody is told;
 *   - otherwise when it shows (ScheduledMaintenancePublishing), then:
 *       - nothing asked (every switch off, no reminder): that subscribers
 *         are not notified when it is scheduled, starts or ends - true
 *         whatever the pages;
 *       - the pages that show it send nothing: that;
 *       - not known yet, or not answered: that it depends on the pages,
 *         and no promise;
 *       - a page notifies: the moments that will tell someone - only those
 *         - then the reminders: that they get them, and which are not sent
 *         (due before it is published, or whose time has passed).
 *
 * A template is published nowhere and has no times of its own, so its line
 * says the same of its status pages and its switches, and its reminders
 * all count. The open section says it again where it is asked: under the
 * three boxes why nobody would be told (getMaintenanceNotifyOptionsReason),
 * and under the reminders which are not sent
 * (getMaintenanceRemindersReason).
 *
 * React-free, so App's tests can read it; ScheduledMaintenanceReachLines
 * draws it.
 */

// Which form asks: an event's, or a template's.
export enum MaintenanceReachRecord {
  Event = "scheduled-maintenance",
  Template = "scheduled-maintenance-template",
}

/*
 * What the server is asked about the pages picked on the form: their ids,
 * and on an Edit the record's own id - or null while none is picked, when
 * there is nothing to ask (the line says it then).
 */
export interface MaintenanceReachQuestion {
  record: MaintenanceReachRecord;
  statusPageIds: Array<string>;
  recordId: string | null;
}

export const MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED: string =
  MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED_TEXT;

export const MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY: string = translationKey(
  "The status pages picked do not send notifications to their subscribers.",
);

export const MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED: string = translationKey(
  "Subscribers are not notified.",
);

// While the pages' answer is not known: no promise either way.
export const MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES: string = translationKey(
  "Whether subscribers are notified depends on the status pages picked.",
);

// A reminder whose time had passed when the event is saved is never sent.
export const REMINDERS_ALREADY_DUE_NOT_SENT: string = translationKey(
  "Reminders whose time has passed are not sent.",
);

const MAINTENANCE_HIDDEN: string =
  STATUS_PAGE_VISIBILITY_KIND_COPY[
    StatusPageVisibilityKind.ScheduledMaintenance
  ].switchOffDescription;

// The summaries' keys for the moments, in their order.
const MOMENT_SUMMARY_KEYS: Record<MaintenanceSubscriberMoment, string> = {
  [MaintenanceSubscriberMoment.Scheduled]: "scheduled",
  [MaintenanceSubscriberMoment.Started]: "started",
  [MaintenanceSubscriberMoment.Ended]: "ended",
};

const readRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

/*
 * The question for the form's values: the pages picked, each once, and the
 * record's own id where the form edits one (its values carry it). Null
 * while no page is picked.
 */
export const getMaintenanceReachQuestion: (data: {
  values: unknown;
  record: MaintenanceReachRecord;
}) => MaintenanceReachQuestion | null = (data: {
  values: unknown;
  record: MaintenanceReachRecord;
}): MaintenanceReachQuestion | null => {
  const record: Record<string, unknown> = readRecord(data.values);
  const statusPageIds: Array<string> = getIdsFromFormValue(
    record["statusPages"],
  );

  if (statusPageIds.length === 0) {
    return null;
  }

  const recordId: unknown = record["_id"];

  return {
    record: data.record,
    statusPageIds: statusPageIds,
    recordId:
      typeof recordId === "string" && recordId.trim()
        ? recordId.trim()
        : recordId && typeof recordId === "object"
          ? recordId.toString()
          : null,
  };
};

// The reminders the form holds, each one it can read.
const readReminders: (value: unknown) => Array<Recurring> = (
  value: unknown,
): Array<Recurring> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const reminders: Array<Recurring> = [];

  for (const item of value) {
    try {
      reminders.push(Recurring.fromJSON(item as JSONObject | Recurring));
    } catch {
      // Not a reminder the form can read: it reminds nobody.
    }
  }

  return reminders;
};

/*
 * What the form's values say about the subscribers, as the rule reads an
 * event (ScheduledMaintenanceSubscriberSettings). A switch the form does
 * not hold is the column's default: on - Visible on Status Page too, which
 * Create does not ask. A template is published nowhere and has no times of
 * its own: each event made from it has its own.
 */
export const readMaintenanceSubscriberSettings: (
  values: unknown,
  record: MaintenanceReachRecord,
) => ScheduledMaintenanceSubscriberSettings = (
  values: unknown,
  record: MaintenanceReachRecord,
): ScheduledMaintenanceSubscriberSettings => {
  const fields: Record<string, unknown> = readRecord(values);
  const switches: ReturnType<typeof readSubscriberNotificationSettings> =
    readSubscriberNotificationSettings(values);
  const isEvent: boolean = record === MaintenanceReachRecord.Event;

  return {
    isVisibleOnStatusPage: isEvent
      ? fields["isVisibleOnStatusPage"] !== false
      : true,
    /*
     * The time the form will save; none for Right away. At a date and time
     * with no time picked yet is published by the time it is picked, which
     * its own check holds before Starts At.
     */
    publishOnStatusPageAt:
      isEvent && isPublishingAtATime(values)
        ? getPublishAtInForm(values)
        : null,
    startsAt: isEvent ? toMaintenanceDate(fields["startsAt"]) : null,
    endsAt: isEvent ? toMaintenanceDate(fields["endsAt"]) : null,
    notifiesWhenScheduled: switches.whenScheduled,
    notifiesWhenStarted: switches.whenStarted,
    notifiesWhenEnded: switches.whenEnded,
    reminders: readReminders(fields[SUBSCRIBER_REMINDERS_KEY]),
  };
};

/*
 * The status pages' reason as the rule reads it: no page picked is no
 * status page; otherwise the server's answer, undefined while it is not
 * known.
 */
const getStatusPagesReason: (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}) => MaintenanceStatusPagesReason = (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}): MaintenanceStatusPagesReason => {
  if (!getMaintenanceReachQuestion(data)) {
    return PublicNoteNothingSentReason.NoStatusPages;
  }

  return data.reach ? data.reach.nothingSentReason : undefined;
};

// Whether the form asks anything of the subscribers: a switch on, or a reminder.
const isAskingAnything: (
  settings: ScheduledMaintenanceSubscriberSettings,
) => boolean = (settings: ScheduledMaintenanceSubscriberSettings): boolean => {
  return (
    settings.notifiesWhenScheduled ||
    settings.notifiesWhenStarted ||
    settings.notifiesWhenEnded ||
    settings.reminders.length > 0
  );
};

// The sentence for the moments that tell someone, in their order.
export const getMomentsSummary: (
  moments: Array<MaintenanceSubscriberMoment>,
) => string = (moments: Array<MaintenanceSubscriberMoment>): string => {
  return SUBSCRIBER_NOTIFICATION_SUMMARIES[
    Object.values(MaintenanceSubscriberMoment)
      .filter((moment: MaintenanceSubscriberMoment): boolean => {
        return moments.includes(moment);
      })
      .map((moment: MaintenanceSubscriberMoment): string => {
        return MOMENT_SUMMARY_KEYS[moment];
      })
      .join(",")
  ]!;
};

/*
 * Which reminders are not sent for their own sake, once the pages notify:
 * due before the event is published, or whose time had passed already.
 */
const getRemindersNotSentSentences: (
  reminders: Array<MaintenanceReminderReach>,
) => Array<string> = (
  reminders: Array<MaintenanceReminderReach>,
): Array<string> => {
  const sentences: Array<string> = [];

  const hasReason: (reason: unknown) => boolean = (
    reason: unknown,
  ): boolean => {
    return reminders.some((reminder: MaintenanceReminderReach): boolean => {
      return reminder.nothingSentReason === reason;
    });
  };

  if (hasReason(PublicNoteNothingSentReason.NotPublishedYet)) {
    sentences.push(REMINDERS_NOT_SENT_BEFORE_PUBLISHING_TEXT);
  }

  if (hasReason(MaintenanceMomentOwnReason.AlreadyDue)) {
    sentences.push(REMINDERS_ALREADY_DUE_NOT_SENT);
  }

  return sentences;
};

/*
 * Once a page that shows the event notifies: the moments that will tell
 * someone, then the reminders - that they get them, and which are not sent.
 */
const getNotifyingSentences: (
  settings: ScheduledMaintenanceSubscriberSettings,
  now: Date | undefined,
) => Array<string> = (
  settings: ScheduledMaintenanceSubscriberSettings,
  now: Date | undefined,
): Array<string> => {
  const sentences: Array<string> = [
    getMomentsSummary(
      ScheduledMaintenanceSubscriberReach.getMomentsThatNotify({
        settings: settings,
        statusPagesReason: null,
      }),
    ),
  ];

  const reminders: Array<MaintenanceReminderReach> =
    ScheduledMaintenanceSubscriberReach.getReminders({
      settings: settings,
      statusPagesReason: null,
      now: now,
    });

  if (
    reminders.some((reminder: MaintenanceReminderReach): boolean => {
      return reminder.nothingSentReason === null;
    })
  ) {
    sentences.push(SUBSCRIBER_REMINDERS_SUMMARY);
  }

  return [...sentences, ...getRemindersNotSentSentences(reminders)];
};

/*
 * After when it shows: who is told, by what the pages answered - or, when
 * the form asks nothing of them, that nobody is, whatever the pages.
 */
const getWhoIsToldSentences: (data: {
  settings: ScheduledMaintenanceSubscriberSettings;
  eventReason: MaintenanceEventNothingSentReason | null | undefined;
  now: Date | undefined;
}) => Array<string> = (data: {
  settings: ScheduledMaintenanceSubscriberSettings;
  eventReason: MaintenanceEventNothingSentReason | null | undefined;
  now: Date | undefined;
}): Array<string> => {
  if (!isAskingAnything(data.settings)) {
    return [getMomentsSummary([])];
  }

  if (data.eventReason === PublicNoteNothingSentReason.NotificationsOff) {
    return [MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY];
  }

  if (data.eventReason === undefined) {
    return [MAINTENANCE_NOTIFICATIONS_DEPEND_ON_PAGES];
  }

  return getNotifyingSentences(data.settings, data.now);
};

/*
 * Schedule Maintenance Event's line (see the file's comment), as of `now`.
 * Sentences without a value are English translation keys, looked up where
 * they are drawn; when it shows from a time is filled in already, in the
 * reader's language.
 */
export const getEventSubscriberNotificationsSummary: (
  values: unknown,
  reach: PickedStatusPagesReachResult | null | undefined,
  now?: Date | undefined,
) => Array<string> = (
  values: unknown,
  reach: PickedStatusPagesReachResult | null | undefined,
  now?: Date | undefined,
): Array<string> => {
  const record: MaintenanceReachRecord = MaintenanceReachRecord.Event;
  const settings: ScheduledMaintenanceSubscriberSettings =
    readMaintenanceSubscriberSettings(values, record);

  const eventReason: MaintenanceEventNothingSentReason | null | undefined =
    ScheduledMaintenanceSubscriberReach.getEventReason({
      settings: settings,
      statusPagesReason: getStatusPagesReason({
        values: values,
        record: record,
        reach: reach,
      }),
    });

  if (eventReason === PublicNoteNothingSentReason.HiddenFromStatusPages) {
    return [MAINTENANCE_HIDDEN];
  }

  if (!getMaintenanceReachQuestion({ values: values, record: record })) {
    return [
      MaintenanceStatusPagesCopy.notShownWarning,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ];
  }

  if (eventReason === PublicNoteNothingSentReason.NoStatusPages) {
    return [
      MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ];
  }

  return [
    getPublishingSummary(values, now),
    ...getWhoIsToldSentences({
      settings: settings,
      eventReason: eventReason,
      now: now,
    }),
  ];
};

/*
 * A maintenance template's line: what an event made from it does on the
 * template's status pages, with its switches and its reminders.
 */
export const getTemplateSubscriberNotificationsSummary: (
  values: unknown,
  reach: PickedStatusPagesReachResult | null | undefined,
) => Array<string> = (
  values: unknown,
  reach: PickedStatusPagesReachResult | null | undefined,
): Array<string> => {
  const record: MaintenanceReachRecord = MaintenanceReachRecord.Template;
  const settings: ScheduledMaintenanceSubscriberSettings =
    readMaintenanceSubscriberSettings(values, record);

  if (!getMaintenanceReachQuestion({ values: values, record: record })) {
    return [
      MaintenanceStatusPagesCopy.templateNotShownWarning,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ];
  }

  const eventReason: MaintenanceEventNothingSentReason | null | undefined =
    ScheduledMaintenanceSubscriberReach.getEventReason({
      settings: settings,
      statusPagesReason: getStatusPagesReason({
        values: values,
        record: record,
        reach: reach,
      }),
    });

  if (eventReason === PublicNoteNothingSentReason.NoStatusPages) {
    return [
      MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
      MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
    ];
  }

  return getWhoIsToldSentences({
    settings: settings,
    eventReason: eventReason,
    now: undefined,
  });
};

/*
 * Under the three boxes, while anything is asked of the subscribers: why
 * nobody would be told - hidden, no page picked, none of the pages picked
 * shows maintenance events, or the ones that do send nothing. Null
 * otherwise: a page notifies, or that is not known yet.
 */
export const getMaintenanceNotifyOptionsReason: (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}) => string | null = (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}): string | null => {
  const settings: ScheduledMaintenanceSubscriberSettings =
    readMaintenanceSubscriberSettings(data.values, data.record);

  if (!isAskingAnything(settings)) {
    return null;
  }

  const eventReason: MaintenanceEventNothingSentReason | null | undefined =
    ScheduledMaintenanceSubscriberReach.getEventReason({
      settings: settings,
      statusPagesReason: getStatusPagesReason(data),
    });

  if (eventReason === PublicNoteNothingSentReason.HiddenFromStatusPages) {
    return MAINTENANCE_HIDDEN;
  }

  if (!getMaintenanceReachQuestion(data)) {
    return data.record === MaintenanceReachRecord.Template
      ? MaintenanceStatusPagesCopy.templateNotShownWarning
      : MaintenanceStatusPagesCopy.notShownWarning;
  }

  if (eventReason === PublicNoteNothingSentReason.NoStatusPages) {
    return MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED;
  }

  if (eventReason === PublicNoteNothingSentReason.NotificationsOff) {
    return MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY;
  }

  return null;
};

/*
 * Under the status page picker on an event's Edit, which has no Subscriber
 * Notifications section (#9974): what the pages picked will do with the
 * event when that is nothing - it shows on none of them, or it shows and
 * tells nobody - and why:
 *
 *   - hidden from its status pages: that;
 *   - no page picked: it appears on none;
 *   - none of the pages picked shows maintenance events (or they are
 *     archived): that - whatever the event asks of its subscribers, since
 *     it shows nowhere - and, when it asks anything, that nobody is told;
 *   - the pages that show it send nothing: that, when it asks anything.
 *
 * Empty while the pages' answer is not known - nothing is promised either
 * way - and when a page shows the event and one notifies.
 */
export const getMaintenanceStatusPagesReason: (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}) => Array<string> = (data: {
  values: unknown;
  record: MaintenanceReachRecord;
  reach: PickedStatusPagesReachResult | null | undefined;
}): Array<string> => {
  const settings: ScheduledMaintenanceSubscriberSettings =
    readMaintenanceSubscriberSettings(data.values, data.record);
  const isAsking: boolean = isAskingAnything(settings);

  const eventReason: MaintenanceEventNothingSentReason | null | undefined =
    ScheduledMaintenanceSubscriberReach.getEventReason({
      settings: settings,
      statusPagesReason: getStatusPagesReason(data),
    });

  if (eventReason === PublicNoteNothingSentReason.HiddenFromStatusPages) {
    return [MAINTENANCE_HIDDEN];
  }

  if (!getMaintenanceReachQuestion(data)) {
    return [
      data.record === MaintenanceReachRecord.Template
        ? MaintenanceStatusPagesCopy.templateNotShownWarning
        : MaintenanceStatusPagesCopy.notShownWarning,
    ];
  }

  if (eventReason === PublicNoteNothingSentReason.NoStatusPages) {
    return isAsking
      ? [
          MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED,
          MAINTENANCE_SUBSCRIBERS_NOT_NOTIFIED,
        ]
      : [MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED];
  }

  if (
    eventReason === PublicNoteNothingSentReason.NotificationsOff &&
    isAsking
  ) {
    return [MAINTENANCE_PAGES_PICKED_DO_NOT_NOTIFY];
  }

  return [];
};

/*
 * Under the status pages an event's details list (#9974): that none of
 * them shows it, once the server has said so - none of them shows
 * maintenance events, or they are archived. Null otherwise, and while that
 * is not known: the list is the pages the event was put on, which is true.
 */
export const getStatusPagesListedReason: (
  reach: PickedStatusPagesReachResult | null | undefined,
) => string | null = (
  reach: PickedStatusPagesReachResult | null | undefined,
): string | null => {
  return reach?.nothingSentReason === PublicNoteNothingSentReason.NoStatusPages
    ? MAINTENANCE_NOT_SHOWN_ON_PAGES_PICKED
    : null;
};

/*
 * Under an event's reminders: which of them are not sent for their own
 * sake - due before the event is published, or whose time has passed - as
 * of `now`. Empty while the event tells nobody anyway (the note above the
 * reminders says why), or every reminder is sent. True whatever the pages
 * answer, so it is said while that is not known too.
 */
export const getMaintenanceRemindersReason: (data: {
  values: unknown;
  reach: PickedStatusPagesReachResult | null | undefined;
  now?: Date | undefined;
}) => Array<string> = (data: {
  values: unknown;
  reach: PickedStatusPagesReachResult | null | undefined;
  now?: Date | undefined;
}): Array<string> => {
  const record: MaintenanceReachRecord = MaintenanceReachRecord.Event;
  const settings: ScheduledMaintenanceSubscriberSettings =
    readMaintenanceSubscriberSettings(data.values, record);

  if (settings.reminders.length === 0) {
    return [];
  }

  const eventReason: MaintenanceEventNothingSentReason | null | undefined =
    ScheduledMaintenanceSubscriberReach.getEventReason({
      settings: settings,
      statusPagesReason: getStatusPagesReason({
        values: data.values,
        record: record,
        reach: data.reach,
      }),
    });

  if (eventReason) {
    return [];
  }

  return getRemindersNotSentSentences(
    ScheduledMaintenanceSubscriberReach.getReminders({
      settings: settings,
      statusPagesReason: null,
      now: data.now,
    }),
  );
};

/*
 * The folded section's shape, React-free: its sentences from the answer
 * `getReach` hands it (the one kept for the form's pages; null while there
 * is none). ScheduledMaintenanceReachLines adds the line a component draws.
 */
export const getEventSubscriberNotificationsFold: <TEntity>(
  getReach?: (values: unknown) => PickedStatusPagesReachResult | null,
) => FormFieldCollapsibleSection<TEntity> = <TEntity>(
  getReach?: (values: unknown) => PickedStatusPagesReachResult | null,
): FormFieldCollapsibleSection<TEntity> => {
  return {
    id: SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
    title: SUBSCRIBER_NOTIFICATIONS_SECTION_TITLE,
    description: EVENT_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getEventSubscriberNotificationsSummary(
        values,
        getReach ? getReach(values) : null,
      );
    },
  };
};

export const getTemplateSubscriberNotificationsFold: <TEntity>(
  getReach?: (values: unknown) => PickedStatusPagesReachResult | null,
) => FormFieldCollapsibleSection<TEntity> = <TEntity>(
  getReach?: (values: unknown) => PickedStatusPagesReachResult | null,
): FormFieldCollapsibleSection<TEntity> => {
  return {
    id: SUBSCRIBER_NOTIFICATIONS_SECTION_ID,
    title: SUBSCRIBER_NOTIFICATIONS_SECTION_TITLE,
    description: TEMPLATE_SUBSCRIBER_NOTIFICATIONS_DESCRIPTION,
    getSummary: (values: FormValues<TEntity>): Array<string> => {
      return getTemplateSubscriberNotificationsSummary(
        values,
        getReach ? getReach(values) : null,
      );
    },
  };
};
