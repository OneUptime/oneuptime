import OneUptimeDate from "../Date";
import Recurring from "../Events/Recurring";
import { JSONObject } from "../JSON";
import {
  PublicNoteNothingSentReason,
  StatusPagesNothingSentReason,
} from "../StatusPage/PublicNoteReach";
import ScheduledMaintenancePublication, {
  ScheduledMaintenancePublicationColumns,
  ScheduledMaintenancePublicationState,
} from "./ScheduledMaintenancePublication";

/*
 * WHAT A MAINTENANCE EVENT TELLS THE SUBSCRIBERS OF ITS STATUS PAGES, AND
 * WHEN (#9920).
 *
 * Schedule Maintenance Event folds its subscriber switches into a
 * Subscriber Notifications section whose line said "Subscribers of the
 * event's status pages are notified when it is scheduled, when it starts
 * and when it ends." whatever the status pages picked do, and whatever the
 * event's own settings mean for each of those moments. What is true is
 * what the notification jobs do, moment by moment:
 *
 *   - when it is scheduled (ScheduledMaintenance:SendNotificationToSubscribers):
 *     only while When the event is scheduled is on; held back until the
 *     event is published (Publish on Status Page At) and sent then; skipped
 *     for an event hidden from its status pages (Visible on Status Page off);
 *   - when it starts, and when it ends (the state change it is moved
 *     through at Starts At and Ends At, and
 *     ScheduledMaintenanceStateTimeline:SendNotificationToSubscribers):
 *     only while When the event starts / ends is on, and only for an event
 *     shown on its status pages at that moment - not hidden, and published
 *     by then;
 *   - each reminder before it starts
 *     (ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled): its
 *     interval before Starts At, scheduled only while that time is still to
 *     come when the event is saved (ScheduledMaintenanceService
 *     .getNextTimeToNotify), and sent only for an event shown on its status
 *     pages when it is due - not hidden, and published by then;
 *
 * and, for every one of them, the status pages picked: the ones that show
 * maintenance events and send their subscribers notifications
 * (PickedStatusPagesReach, which the server answers - an archived page and
 * a blocked project's pages left out). When an event is shown on its
 * status pages is the one rule ScheduledMaintenancePublication.
 *
 * So each moment, and each reminder, notifies someone exactly when no
 * reason here stands in its way. The reasons are a public note's where
 * they are the same (PublicNoteNothingSentReason: hidden, not published
 * yet, no status page, notifications off), plus a moment's own two: its
 * switch is off, or a reminder's time had passed already.
 *
 * Kept free of anything server-side: the dashboard says with it what the
 * form will do, and App/Tests/Workers/Jobs/ScheduledMaintenance
 * /SubscriberNotificationsAsTheFormSays runs it beside the jobs.
 */

// The three moments the event's switches are for.
export enum MaintenanceSubscriberMoment {
  Scheduled = "Scheduled",
  Started = "Started",
  Ended = "Ended",
}

// Why a moment, or a reminder, tells nobody, beyond a public note's reasons.
export enum MaintenanceMomentOwnReason {
  // Its switch (When the event is scheduled, starts or ends) is off.
  SwitchedOff = "SwitchedOff",
  // A reminder whose time had passed when the event was saved: never sent.
  AlreadyDue = "AlreadyDue",
}

export type MaintenanceNothingSentReason =
  | MaintenanceMomentOwnReason
  | PublicNoteNothingSentReason.HiddenFromStatusPages
  | PublicNoteNothingSentReason.NotPublishedYet
  | StatusPagesNothingSentReason;

/*
 * Why the event tells nobody at any moment: hidden from its status pages,
 * or what the status pages picked do.
 */
export type MaintenanceEventNothingSentReason =
  | PublicNoteNothingSentReason.HiddenFromStatusPages
  | StatusPagesNothingSentReason;

// What the event says about its subscribers, as stored or as a form will save it.
export interface ScheduledMaintenanceSubscriberSettings
  extends ScheduledMaintenancePublicationColumns {
  startsAt: Date | null;
  endsAt: Date | null;
  notifiesWhenScheduled: boolean;
  notifiesWhenStarted: boolean;
  notifiesWhenEnded: boolean;
  reminders: Array<Recurring>;
}

export interface MaintenanceReminderReach {
  // When it is due; null while the event's start is not known (a template).
  remindAt: Date | null;
  // Why nobody is reminded; null when someone is, undefined while not known.
  nothingSentReason: MaintenanceNothingSentReason | null | undefined;
}

/*
 * The status pages' answer, as the rule reads it: a reason, null when a
 * page that shows the event notifies, or undefined while it is not known.
 */
export type MaintenanceStatusPagesReason =
  | StatusPagesNothingSentReason
  | null
  | undefined;

export default class ScheduledMaintenanceSubscriberReach {
  /*
   * Why the event tells nobody at any moment, or null when the pages
   * picked show it and one of them notifies - undefined while the pages'
   * answer is not known. Hidden from its status pages comes first: the
   * jobs skip a hidden event before they read a page.
   */
  public static getEventReason(data: {
    settings: ScheduledMaintenanceSubscriberSettings;
    statusPagesReason: MaintenanceStatusPagesReason;
  }): MaintenanceEventNothingSentReason | null | undefined {
    if (
      !ScheduledMaintenancePublication.isVisibilitySwitchedOn(data.settings)
    ) {
      return PublicNoteNothingSentReason.HiddenFromStatusPages;
    }

    return data.statusPagesReason;
  }

  /*
   * Why a moment tells nobody, in the order its job checks: its switch,
   * then whether the event is shown on its status pages at that moment,
   * then the status pages. Null when it tells someone; undefined while the
   * pages' answer is all that is left and it is not known.
   */
  public static getMomentReason(data: {
    moment: MaintenanceSubscriberMoment;
    settings: ScheduledMaintenanceSubscriberSettings;
    statusPagesReason: MaintenanceStatusPagesReason;
  }): MaintenanceNothingSentReason | null | undefined {
    const settings: ScheduledMaintenanceSubscriberSettings = data.settings;

    switch (data.moment) {
      case MaintenanceSubscriberMoment.Scheduled: {
        if (!settings.notifiesWhenScheduled) {
          return MaintenanceMomentOwnReason.SwitchedOff;
        }

        /*
         * Held back until the event is published, and sent then: it is
         * never too early. A publish time that is there but is no time is
         * never reached, so it is never sent.
         */
        if (
          ScheduledMaintenancePublication.hasPublishTime(settings) &&
          !ScheduledMaintenancePublication.getPublishAt(settings)
        ) {
          return PublicNoteNothingSentReason.NotPublishedYet;
        }

        return this.getEventReason({
          settings: settings,
          statusPagesReason: data.statusPagesReason,
        });
      }
      case MaintenanceSubscriberMoment.Started:
        return this.getReasonAt({
          isSwitchedOn: settings.notifiesWhenStarted,
          at: settings.startsAt,
          settings: settings,
          statusPagesReason: data.statusPagesReason,
        });
      case MaintenanceSubscriberMoment.Ended:
        return this.getReasonAt({
          isSwitchedOn: settings.notifiesWhenEnded,
          at: settings.endsAt,
          settings: settings,
          statusPagesReason: data.statusPagesReason,
        });
    }
  }

  // The moments that tell someone, in order; while the pages' answer is not known, none.
  public static getMomentsThatNotify(data: {
    settings: ScheduledMaintenanceSubscriberSettings;
    statusPagesReason: MaintenanceStatusPagesReason;
  }): Array<MaintenanceSubscriberMoment> {
    return Object.values(MaintenanceSubscriberMoment).filter(
      (moment: MaintenanceSubscriberMoment): boolean => {
        return (
          this.getMomentReason({
            moment: moment,
            settings: data.settings,
            statusPagesReason: data.statusPagesReason,
          }) === null
        );
      },
    );
  }

  /*
   * Each reminder before the event: when it is due, and why it reminds
   * nobody - its time had passed when the event was saved (`now`), so it
   * is never scheduled; the event is hidden from its status pages, or not
   * published yet, when it is due; or the status pages.
   */
  public static getReminders(data: {
    settings: ScheduledMaintenanceSubscriberSettings;
    statusPagesReason: MaintenanceStatusPagesReason;
    now?: Date | undefined;
  }): Array<MaintenanceReminderReach> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    return data.settings.reminders.map(
      (reminder: Recurring): MaintenanceReminderReach => {
        const remindAt: Date | null = data.settings.startsAt
          ? this.getRemindAt(data.settings.startsAt, reminder)
          : null;

        if (remindAt && remindAt.getTime() <= now.getTime()) {
          return {
            remindAt: remindAt,
            nothingSentReason: MaintenanceMomentOwnReason.AlreadyDue,
          };
        }

        return {
          remindAt: remindAt,
          nothingSentReason: this.getReasonAt({
            isSwitchedOn: true,
            at: remindAt,
            settings: data.settings,
            statusPagesReason: data.statusPagesReason,
          }),
        };
      },
    );
  }

  /*
   * When a reminder is due: its interval before the event starts, as its
   * job schedules it (Recurring.getNextDateInterval, back from Starts At).
   * Null for a reminder that cannot be read.
   */
  public static getRemindAt(
    startsAt: Date,
    reminder: Recurring | JSONObject,
  ): Date | null {
    try {
      return Recurring.getNextDateInterval(
        startsAt,
        Recurring.fromJSON(reminder),
        true,
      );
    } catch {
      return null;
    }
  }

  /*
   * A moment of a state change or a reminder: its switch, then whether the
   * event is shown on its status pages at that time (`at`; now when it is
   * not known), then the pages.
   */
  private static getReasonAt(data: {
    isSwitchedOn: boolean;
    at: Date | null;
    settings: ScheduledMaintenanceSubscriberSettings;
    statusPagesReason: MaintenanceStatusPagesReason;
  }): MaintenanceNothingSentReason | null | undefined {
    if (!data.isSwitchedOn) {
      return MaintenanceMomentOwnReason.SwitchedOff;
    }

    const state: ScheduledMaintenancePublicationState =
      ScheduledMaintenancePublication.getState(
        data.settings,
        data.at || undefined,
      );

    if (state === ScheduledMaintenancePublicationState.Hidden) {
      return PublicNoteNothingSentReason.HiddenFromStatusPages;
    }

    if (state === ScheduledMaintenancePublicationState.Scheduled) {
      return PublicNoteNothingSentReason.NotPublishedYet;
    }

    return data.statusPagesReason;
  }
}
