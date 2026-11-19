import { JSONObject } from "../JSON";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  StatusPagesNothingSentReason,
} from "./PublicNoteReach";

/*
 * WHAT AN ANNOUNCEMENT ON THE STATUS PAGES PICKED DOES (#9775).
 *
 * Create Announcement sums its folded Schedule & Notifications section up
 * in one line, and the review step repeats it. It said "Subscribers are
 * notified when it starts showing." whatever status pages were picked, and
 * "Shows now and stays until you end it." of pages that show no
 * announcements at all.
 *
 * What is true, as the status page and the announcement job work it out:
 *
 *   - A status page shows an announcement only while Show Announcements is
 *     on (showAnnouncementsOnStatusPage, StatusPageAPI). An archived page,
 *     and a page of a project a master admin blocked, show nothing.
 *   - The announcement job (Workers/Jobs/Announcement/
 *     SendNotificationToSubscribers) tells subscribers once, when the
 *     announcement starts showing, and an edit when its editor asks: it
 *     loads the pages picked as every subscriber notification does
 *     (StatusPageSubscriberService.getStatusPagesToSendNotification, which
 *     leaves those out), then passes over a page that does not send
 *     notifications to its subscribers (Send Notifications to Subscribers)
 *     and one that hides announcements.
 *
 * So an announcement on the pages picked shows when one of them shows
 * announcements, and notifies someone when one that does sends
 * notifications. The server works it out (AnnouncementReachBuilder) by the
 * same rule a public note's composer is answered by
 * (PublicNoteReachBuilder.getStatusPagesReason, #9735), with the reasons by
 * the same names. Every page picked that is the project's counts, whether
 * the reader may read it or not, and the answer names none: it is one
 * reason, or none.
 *
 * Shared by the server, which answers, and the dashboard, which says it.
 */

// Why an announcement on the pages picked notifies nobody: the pages' own reasons.
export type AnnouncementNothingSentReason = StatusPagesNothingSentReason;

export interface AnnouncementReachResult {
  /*
   * NoStatusPages: none of the pages picked shows announcements, so it
   * shows nowhere. NotificationsOff: the ones that show it send their
   * subscribers nothing. Null when a page that shows it notifies.
   */
  nothingSentReason: AnnouncementNothingSentReason | null;
}

export default class AnnouncementReach {
  // Under the announcement's API: POST /status-page-announcement/reach.
  public static readonly routePath: string = "/reach";

  // How many status pages one request may name.
  public static readonly maxStatusPagesPerRequest: number = 1000;

  // Whether a status page picked shows the announcement.
  public static isShownOnAStatusPage(result: AnnouncementReachResult): boolean {
    return PublicNoteReach.isShownOnAStatusPage(result);
  }

  // Whether a status page picked tells its subscribers about it.
  public static isNotifying(result: AnnouncementReachResult): boolean {
    return PublicNoteReach.isNotifying(result);
  }

  public static toJSON(result: AnnouncementReachResult): JSONObject {
    return PublicNoteReach.toJSON(result);
  }

  /*
   * The server's answer as the dashboard receives it, or null when it cannot
   * be read - a missing field, or a reason an announcement never has. Null
   * says nothing: the form then promises nothing, where reading it as
   * "notifies" would make the promise this is here to keep honest.
   */
  public static fromJSON(json: unknown): AnnouncementReachResult | null {
    const read: ReturnType<typeof PublicNoteReach.fromJSON> =
      PublicNoteReach.fromJSON(json);

    if (!read) {
      return null;
    }

    const reason: PublicNoteNothingSentReason | null = read.nothingSentReason;

    if (
      reason !== null &&
      reason !== PublicNoteNothingSentReason.NoStatusPages &&
      reason !== PublicNoteNothingSentReason.NotificationsOff
    ) {
      return null;
    }

    return { nothingSentReason: reason };
  }
}
