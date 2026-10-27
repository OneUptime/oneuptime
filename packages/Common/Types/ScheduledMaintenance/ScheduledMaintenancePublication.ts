import { toStoredBoolean } from "../Database/BooleanColumnValue";
import OneUptimeDate from "../Date";
import { toMaintenanceDate } from "./MaintenanceWindow";

/*
 * WHEN A SCHEDULED MAINTENANCE EVENT IS PUBLIC.
 *
 * A status page shows an event - and its subscribers hear about it - only
 * while both of these hold:
 *
 *   - Visible on Status Page is on (isVisibleOnStatusPage), and
 *   - the event is published: it has no Publish on Status Page At
 *     (publishOnStatusPageAt) - it is public from the moment it is created,
 *     as every event created before the column was - or that time has come.
 *
 * Planned work is often known months before customers should hear of it
 * (GitHub issue #5249): an event made on 1 October for 1 December can be
 * kept to the team until 24 November, and on 24 November it shows on its
 * status pages as coming up, and their subscribers are told it is
 * scheduled - nobody has to remember to turn it on.
 *
 * ONE RULE, read by everything that puts an event in front of the public:
 *
 *   - in SQL, every status page read of scheduled maintenance
 *     (StatusPageVisibilityQuery.shownScheduledMaintenance): the overview,
 *     the Scheduled Maintenance page and an event by its id, the uptime
 *     history, the attachments of its notes - and through them the page's
 *     RSS and Atom feeds, its maintenance calendar (.ics), its JSON API and
 *     the public MCP tools;
 *   - in code, every subscriber notification job about an event: the
 *     'scheduled' notification, the reminders before the event, state
 *     changes and public notes (isShown, getState).
 *
 * PUBLISHED WHEN READ, NEVER WRITTEN. No job turns an event on at its time:
 * whether it is published is worked out from the time each time it is read.
 * So a publish time moved, cleared (published at once) or set again takes
 * effect the moment it is saved, the event shows exactly at its time, and
 * nothing can leave an event half published. The one thing that happens AT
 * the time is the 'scheduled' notification, which the job that sends it
 * every minute holds back until the event is published - so it is sent
 * once, at publication, rather than when the event was created.
 *
 * Kept free of anything server-side: the dashboard says with it whether an
 * event is public yet, and when it will be.
 */

export const PUBLISH_ON_STATUS_PAGE_AT_COLUMN: string = "publishOnStatusPageAt";

export const VISIBLE_ON_STATUS_PAGE_COLUMN: string = "isVisibleOnStatusPage";

// What decides whether an event is public: its switch and its publish time.
export interface ScheduledMaintenancePublicationColumns {
  isVisibleOnStatusPage?: unknown;
  publishOnStatusPageAt?: unknown;
}

/*
 * Why a notification about an event that is not published yet is not sent:
 * a state change or a public note of an event kept to the team until its
 * publish time. Subscribers hear of the event when it is published, and see
 * its notes and its state on the page from then on.
 */
export const NOT_PUBLISHED_YET_SKIPPED_MESSAGE: string =
  "Notifications skipped as scheduled maintenance is not published on status pages yet.";

/*
 * Why a reminder before the event is not sent: the event is hidden from its
 * status pages, or not published on them yet. The feed says so instead of
 * that the reminder went out.
 */
export const REMINDER_NOT_SENT_HIDDEN_MESSAGE: string =
  "This scheduled maintenance is hidden from its status pages, so their subscribers were not reminded.";

export const REMINDER_NOT_SENT_NOT_PUBLISHED_YET_MESSAGE: string =
  "This scheduled maintenance is not published on its status pages yet, so their subscribers were not reminded.";

// Where an event stands with its status pages.
export enum ScheduledMaintenancePublicationState {
  // Visible on Status Page is off: shown nowhere public, whatever the time.
  Hidden = "Hidden",
  // On, with a publish time still to come: shown nowhere public until then.
  Scheduled = "Scheduled",
  // On, and published: shown on its status pages.
  Published = "Published",
}

export default class ScheduledMaintenancePublication {
  // The columns a reader must read to apply the rule: both, always.
  public static readonly columns: ReadonlyArray<string> = [
    VISIBLE_ON_STATUS_PAGE_COLUMN,
    PUBLISH_ON_STATUS_PAGE_AT_COLUMN,
  ];

  /*
   * Whether an event has a publish time at all. None - never set (null),
   * or cleared ("" from a cleared date input) - is published from the
   * start.
   */
  public static hasPublishTime(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
  ): boolean {
    if (!record) {
      return false;
    }

    const value: unknown = record.publishOnStatusPageAt;

    return value !== undefined && value !== null && value !== "";
  }

  /*
   * The event's publish time, or null when it has none. A value that is
   * there but is not a time is no time it can be published at: see
   * isPublished.
   */
  public static getPublishAt(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
  ): Date | null {
    if (!this.hasPublishTime(record)) {
      return null;
    }

    return toMaintenanceDate(record!.publishOnStatusPageAt);
  }

  /*
   * Whether the event is published by `now` (the current time when not
   * given): it has no publish time, or that time is not after now. A value
   * that is there but is not a time keeps it unpublished - an odd value
   * hides the event rather than showing it early.
   */
  public static isPublished(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
    now?: Date | undefined,
  ): boolean {
    if (!this.hasPublishTime(record)) {
      return true;
    }

    const publishAt: Date | null = this.getPublishAt(record);

    if (!publishAt) {
      return false;
    }

    return (
      publishAt.getTime() <= (now || OneUptimeDate.getCurrentDate()).getTime()
    );
  }

  /*
   * Whether its Visible on Status Page switch is on. A switch never set
   * (null), or not read, is off, as the database queries read it.
   */
  public static isVisibilitySwitchedOn(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
  ): boolean {
    if (!record) {
      return false;
    }

    return toStoredBoolean(record.isVisibleOnStatusPage) === true;
  }

  // The rule: Visible on Status Page on, and published by `now`.
  public static isShown(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
    now?: Date | undefined,
  ): boolean {
    return (
      this.isVisibilitySwitchedOn(record) && this.isPublished(record, now)
    );
  }

  /*
   * Where the event stands by `now`: hidden (its switch is off, whatever
   * its time), waiting for its publish time, or published.
   */
  public static getState(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
    now?: Date | undefined,
  ): ScheduledMaintenancePublicationState {
    if (!this.isVisibilitySwitchedOn(record)) {
      return ScheduledMaintenancePublicationState.Hidden;
    }

    if (!this.isPublished(record, now)) {
      return ScheduledMaintenancePublicationState.Scheduled;
    }

    return ScheduledMaintenancePublicationState.Published;
  }

  /*
   * Whether the event is waiting to be published: its switch is on and its
   * publish time is still to come. What the dashboard says "Not on status
   * pages yet" for.
   */
  public static isWaitingToPublish(
    record: ScheduledMaintenancePublicationColumns | undefined | null,
    now?: Date | undefined,
  ): boolean {
    return (
      this.getState(record, now) ===
      ScheduledMaintenancePublicationState.Scheduled
    );
  }
}
