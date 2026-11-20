import { JSONObject } from "../JSON";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "./PickedStatusPagesReach";
import { StatusPagesNothingSentReason } from "./PublicNoteReach";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

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
 * notifications - the answer every form that picks status pages is given
 * (PickedStatusPagesReach), worked out by the same rule a public note's
 * composer is answered by (PublicNoteReachBuilder.getStatusPagesReason,
 * #9735), with the reasons by the same names. Every page picked that is
 * the project's counts, whether the reader may read it or not, and the
 * answer names none: it is one reason, or none.
 *
 * On the announcement's Edit the answer says one thing more: where the
 * announcement's own notification stands (#9921). The update job skips an
 * update while that notification has not gone out
 * (AnnouncementUpdateNotification), so "Notify subscribers about this
 * update" says so. It is the announcement's own, which the editor may read.
 *
 * Shared by the server, which answers, and the dashboard, which says it.
 */

// Why an announcement on the pages picked notifies nobody: the pages' own reasons.
export type AnnouncementNothingSentReason = StatusPagesNothingSentReason;

export interface AnnouncementReachResult extends PickedStatusPagesReachResult {
  /*
   * On an Edit, the announcement's own notification
   * (subscriberNotificationStatus): Pending until it goes out. Left out on
   * Create, and when it cannot be read.
   */
  originalNotificationStatus?:
    | StatusPageSubscriberNotificationStatus
    | null
    | undefined;
}

const ORIGINAL_NOTIFICATION_STATUS_KEY: string = "originalNotificationStatus";

export default class AnnouncementReach {
  // Under the announcement's API: POST /status-page-announcement/reach.
  public static readonly routePath: string = PickedStatusPagesReach.routePath;

  // How many status pages one request may name.
  public static readonly maxStatusPagesPerRequest: number =
    PickedStatusPagesReach.maxStatusPagesPerRequest;

  // Whether a status page picked shows the announcement.
  public static isShownOnAStatusPage(result: AnnouncementReachResult): boolean {
    return PickedStatusPagesReach.isShownOnAStatusPage(result);
  }

  // Whether a status page picked tells its subscribers about it.
  public static isNotifying(result: AnnouncementReachResult): boolean {
    return PickedStatusPagesReach.isNotifying(result);
  }

  public static toJSON(result: AnnouncementReachResult): JSONObject {
    const json: JSONObject = PickedStatusPagesReach.toJSON(result);

    // Only an Edit's answer carries it.
    if (result.originalNotificationStatus !== undefined) {
      json[ORIGINAL_NOTIFICATION_STATUS_KEY] =
        result.originalNotificationStatus;
    }

    return json;
  }

  /*
   * The server's answer as the dashboard receives it, or null when it cannot
   * be read - a missing field, or a reason an announcement never has. Null
   * says nothing: the form then promises nothing, where reading it as
   * "notifies" would make the promise this is here to keep honest. A status
   * the form does not know is left out: the pages' answer still stands, and
   * the update box then says only what it knows.
   */
  public static fromJSON(json: unknown): AnnouncementReachResult | null {
    const read: PickedStatusPagesReachResult | null =
      PickedStatusPagesReach.fromJSON(json);

    if (!read) {
      return null;
    }

    const record: JSONObject = json as JSONObject;

    if (
      !Object.prototype.hasOwnProperty.call(
        record,
        ORIGINAL_NOTIFICATION_STATUS_KEY,
      )
    ) {
      return read;
    }

    const status: unknown = record[ORIGINAL_NOTIFICATION_STATUS_KEY];

    if (status === null) {
      return { ...read, originalNotificationStatus: null };
    }

    const statuses: Array<string> = Object.values(
      StatusPageSubscriberNotificationStatus,
    );

    if (typeof status !== "string" || !statuses.includes(status)) {
      return read;
    }

    return {
      ...read,
      originalNotificationStatus:
        status as StatusPageSubscriberNotificationStatus,
    };
  }
}
