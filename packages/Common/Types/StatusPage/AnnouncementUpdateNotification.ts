import OneUptimeDate from "../Date";
import { toMaintenanceDate } from "../ScheduledMaintenance/MaintenanceWindow";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "./SubscriberUpdateNotification";

/*
 * WHEN AN ANNOUNCEMENT'S UPDATE IS NOT SENT FOR THE ANNOUNCEMENT'S OWN
 * STATE (#9921).
 *
 * Ticking "Notify subscribers about this update" on an announcement's Edit
 * queues an update notification, and the update job
 * (Workers/Jobs/Announcement/SendNotificationToSubscribers,
 * Announcement:SendUpdateNotificationToSubscribers) decides whether it goes
 * out. Before it looks at a single status page, it looks at the
 * announcement itself, in this order:
 *
 *   1. its own notification is being sent right now: the update waits, and
 *      goes out once that has settled (SubscriberUpdateNotification
 *      .isOriginalNotificationBeingSent) - not a reason it is skipped;
 *   2. its own notification has not gone out yet (Pending): that
 *      notification reads the announcement when it is sent and carries the
 *      edit, so the update is skipped (SubscriberUpdateNotification
 *      .getSkipReasonForOriginalNotificationStatus);
 *   3. Start Showing Announcement At is still to come: it is on no status
 *      page yet, so there is nothing for an "updated" message to point at,
 *      and the update is skipped.
 *
 * Every other state lets it through - Success, and Skipped or Failed,
 * which mean subscribers were not all told, as the editor now asks. So is
 * an announcement that has ended: it stays on its status page at its own
 * link, and in the page's history while its window holds it.
 *
 * One rule, read by the job when it decides and by the Edit's box when it
 * says what will happen, so the two cannot drift apart.
 */

export enum AnnouncementUpdateNotSentReason {
  // The announcement's own notification has not gone out yet.
  OriginalNotSentYet = "OriginalNotSentYet",
  // Start Showing Announcement At is still to come.
  NotShownYet = "NotShownYet",
}

// What the job records for an update it skips because it is not shown yet.
export const ANNOUNCEMENT_NOT_SHOWN_YET_SKIPPED_MESSAGE: string =
  "This announcement is not shown on status pages yet, so subscribers were not notified about this update.";

export default class AnnouncementUpdateNotification {
  /*
   * Whether the announcement is on no status page yet: its start is still
   * to come - after `now`, or, when no time is given, in the future as the
   * job reads it (OneUptimeDate.isInTheFuture). No start, or one that cannot
   * be read, is no start to wait for.
   */
  public static isNotShownYet(
    showAnnouncementAt: unknown,
    now?: Date | undefined,
  ): boolean {
    const startsAt: Date | null = toMaintenanceDate(showAnnouncementAt);

    if (!startsAt) {
      return false;
    }

    if (now) {
      return startsAt.getTime() > now.getTime();
    }

    return OneUptimeDate.isInTheFuture(startsAt);
  }

  /*
   * Why an update of the announcement is skipped for its own state, in the
   * job's order, or null when that lets it through: its own notification
   * still to go out, then its start still to come. While its notification
   * is being sent the update waits rather than being skipped - the job asks
   * that first (SubscriberUpdateNotification.isOriginalNotificationBeingSent).
   */
  public static getNotSentReason(data: {
    // The announcement's own notification (subscriberNotificationStatus).
    originalStatus: StatusPageSubscriberNotificationStatus | null | undefined;
    // Start Showing Announcement At, as stored or as the Edit will save it.
    showAnnouncementAt: unknown;
    now?: Date | undefined;
  }): AnnouncementUpdateNotSentReason | null {
    if (
      SubscriberUpdateNotification.getSkipReasonForOriginalNotificationStatus(
        data.originalStatus,
      )
    ) {
      return AnnouncementUpdateNotSentReason.OriginalNotSentYet;
    }

    if (this.isNotShownYet(data.showAnnouncementAt, data.now)) {
      return AnnouncementUpdateNotSentReason.NotShownYet;
    }

    return null;
  }

  // What the job records as it skips the update.
  public static getSkippedMessage(
    reason: AnnouncementUpdateNotSentReason,
  ): string {
    switch (reason) {
      case AnnouncementUpdateNotSentReason.OriginalNotSentYet:
        return SubscriberUpdateNotification.notYetNotifiedMessage;
      case AnnouncementUpdateNotSentReason.NotShownYet:
        return ANNOUNCEMENT_NOT_SHOWN_YET_SKIPPED_MESSAGE;
    }
  }
}
