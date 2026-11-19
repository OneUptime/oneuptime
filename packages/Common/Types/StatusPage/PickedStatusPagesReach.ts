import { JSONObject } from "../JSON";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  StatusPagesNothingSentReason,
} from "./PublicNoteReach";

/*
 * WHAT A RECORD ON THE STATUS PAGES PICKED ON ITS FORM DOES.
 *
 * An announcement (#9775), a maintenance event and a maintenance template
 * (#9920) show on, and tell the subscribers of, exactly the status pages
 * picked on their forms. Whether those pages do either is theirs to say:
 *
 *   - a status page shows that kind of record only while its switch for it
 *     is on (Show Announcements, Show Maintenance Events), and an archived
 *     page, or one of a project a master admin blocked, shows nothing;
 *   - the notification jobs load the pages picked as every subscriber
 *     notification does (StatusPageSubscriberService
 *     .getStatusPagesToSendNotification, which leaves those out), then pass
 *     over a page that does not send notifications to its subscribers (Send
 *     Notifications to Subscribers) and one that hides that kind of record.
 *
 * So the record shows when one of the pages picked shows its kind, and
 * notifies someone when one that does sends notifications. The server works
 * it out (Server/Utils/StatusPage/PickedStatusPagesReachBuilder) by the one
 * rule a public note's composer is answered by
 * (PublicNoteReachBuilder.getStatusPagesReason, #9735), with the reasons by
 * the same names. Every page picked that is the project's counts, whether
 * the reader may read it or not, and the answer names none: it is one
 * reason, or none.
 *
 * Shared by the server, which answers, and the dashboard, which says it.
 * An announcement's answer adds what an Edit needs on top
 * (AnnouncementReach); a maintenance event's and a template's are this one.
 */

export interface PickedStatusPagesReachResult {
  /*
   * NoStatusPages: none of the pages picked shows the record, so it shows
   * nowhere. NotificationsOff: the ones that show it send their subscribers
   * nothing. Null when a page that shows it notifies.
   */
  nothingSentReason: StatusPagesNothingSentReason | null;
}

export default class PickedStatusPagesReach {
  // Under the record's own API: POST /scheduled-maintenance/reach.
  public static readonly routePath: string = "/reach";

  // How many status pages one request may name.
  public static readonly maxStatusPagesPerRequest: number = 1000;

  // Whether a status page picked shows the record.
  public static isShownOnAStatusPage(
    result: PickedStatusPagesReachResult,
  ): boolean {
    return PublicNoteReach.isShownOnAStatusPage(result);
  }

  // Whether a status page picked tells its subscribers about it.
  public static isNotifying(result: PickedStatusPagesReachResult): boolean {
    return PublicNoteReach.isNotifying(result);
  }

  public static toJSON(result: PickedStatusPagesReachResult): JSONObject {
    return PublicNoteReach.toJSON(result);
  }

  /*
   * The server's answer as the dashboard receives it, or null when it cannot
   * be read - a missing field, or a reason the status pages never give. Null
   * says nothing: the form then promises nothing, where reading it as
   * "notifies" would make the promise this is here to keep honest.
   */
  public static fromJSON(json: unknown): PickedStatusPagesReachResult | null {
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
