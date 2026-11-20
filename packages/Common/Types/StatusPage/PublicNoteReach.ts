import { JSONObject } from "../JSON";
import { SubscriberNotificationPreviewNothingSentReason } from "./SubscriberNotificationPreview";

/*
 * WHAT A PUBLIC NOTE POSTED NOW DOES (#9735).
 *
 * The note composer says it beside "Public" and under "Notify status page
 * subscribers", for an incident, an incident episode and a maintenance
 * event alike: whether a status page shows the note, and whether posting
 * it notifies anyone. It said "Visible on your status page" and
 * "Subscribers will be notified" of every event, also of one no status
 * page shows and of one whose status pages send their subscribers nothing.
 *
 * What is true, as the status page and the subscriber jobs work it out:
 *
 *   - A status page shows an event - and with it every published public
 *     note the event has, the ones posted before the page started showing
 *     it too - for as long as it shows the event. It works that out each
 *     time it is opened: an incident through the monitors it lists and the
 *     incident's status page scope, while the incident is Visible on Status
 *     Page and not private; an episode through its incidents, while it is
 *     visible; a maintenance event on the status pages picked on it, once
 *     it is visible and published. A page that hides that kind of event
 *     shows none.
 *   - A note's notification goes out once, when the note is posted, to the
 *     subscribers of the pages that show its event then and send
 *     notifications (Send Notifications to Subscribers). A page that starts
 *     showing the event later shows the note too, and tells nobody about it.
 *
 * So a note posted now is on a status page when one shows its event, and
 * notifies someone when a page that shows it sends notifications.
 * PublicNoteReachBuilder works it out on the server, from every status page
 * the event reaches - one the reader cannot read included - and the answer
 * names no page: it is one reason, or none.
 *
 * Shared by the server, which answers, and the dashboard, which says it, so
 * the two cannot drift apart.
 */

// The events whose public notes the composer writes.
export enum PublicNoteReachEvent {
  Incident = "Incident",
  IncidentEpisode = "IncidentEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

/*
 * Why a note posted now notifies nobody. The first four leave the note on
 * no status page; with NotificationsOff it is on the pages that show the
 * event, and they tell no one.
 *
 * An incident's reasons are its notification preview's, by the same names
 * (SubscriberNotificationPreviewNothingSentReason): one rule decides both.
 */
export enum PublicNoteNothingSentReason {
  // An incident, or an episode's incidents, on no monitor.
  NoMonitors = "NoMonitors",
  // Visible on Status Page is off (or the incident or episode is private).
  HiddenFromStatusPages = "HiddenFromStatusPages",
  // A maintenance event whose Publish on Status Page At is still to come.
  NotPublishedYet = "NotPublishedYet",
  /*
   * No status page shows it: none lists its monitors, the incident's scope
   * leaves them out, no page is picked for the maintenance event, or the
   * pages hide that kind of event.
   */
  NoStatusPages = "NoStatusPages",
  /*
   * A status page shows it, and every page that does sends its subscribers
   * nothing (Send Notifications to Subscribers off).
   */
  NotificationsOff = "NotificationsOff",
}

/*
 * The two reasons the status pages themselves give, whatever the event: no
 * page shows it, or every page that does sends its subscribers nothing
 * (PublicNoteReachBuilder.getStatusPagesReason). An announcement has no
 * other reason (Types/StatusPage/AnnouncementReach).
 */
export type StatusPagesNothingSentReason =
  | PublicNoteNothingSentReason.NoStatusPages
  | PublicNoteNothingSentReason.NotificationsOff;

export interface PublicNoteReachResult {
  // Null when a note posted now notifies a status page's subscribers.
  nothingSentReason: PublicNoteNothingSentReason | null;
}

export default class PublicNoteReach {
  // Each event's route, under its own API: POST /incident/public-note-reach.
  public static readonly routePath: string = "/public-note-reach";

  // Whether a status page shows the event, and so the note, now.
  public static isShownOnAStatusPage(result: PublicNoteReachResult): boolean {
    return (
      result.nothingSentReason === null ||
      result.nothingSentReason === PublicNoteNothingSentReason.NotificationsOff
    );
  }

  // Whether posting the note now notifies a status page's subscribers.
  public static isNotifying(result: PublicNoteReachResult): boolean {
    return result.nothingSentReason === null;
  }

  /*
   * An incident's answer, from its notification preview's reason for a
   * public note. The preview's other two reasons are a declare's, which a
   * note on an incident that exists never has; each is read by what it does
   * to a note all the same: a private incident is on no status page, and
   * with notifying off the pages show it and tell no one.
   */
  public static fromPreviewReason(
    reason: SubscriberNotificationPreviewNothingSentReason | null,
  ): PublicNoteReachResult {
    switch (reason) {
      case null:
        return { nothingSentReason: null };
      case SubscriberNotificationPreviewNothingSentReason.NoMonitors:
        return { nothingSentReason: PublicNoteNothingSentReason.NoMonitors };
      case SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages:
      case SubscriberNotificationPreviewNothingSentReason.PrivateIncident:
        return {
          nothingSentReason: PublicNoteNothingSentReason.HiddenFromStatusPages,
        };
      case SubscriberNotificationPreviewNothingSentReason.NoStatusPages:
        return { nothingSentReason: PublicNoteNothingSentReason.NoStatusPages };
      case SubscriberNotificationPreviewNothingSentReason.NotificationsOff:
      case SubscriberNotificationPreviewNothingSentReason.NotifyOff:
        return {
          nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
        };
    }
  }

  public static toJSON(result: PublicNoteReachResult): JSONObject {
    return {
      nothingSentReason: result.nothingSentReason,
    };
  }

  /*
   * The server's answer as the dashboard receives it, or null when it cannot
   * be read: a missing field, or a reason it does not know. Null says
   * nothing - the composer then promises nothing - where reading it as
   * "notifies" would make the promise this is here to keep honest.
   */
  public static fromJSON(json: unknown): PublicNoteReachResult | null {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }

    const record: JSONObject = json as JSONObject;

    if (!Object.prototype.hasOwnProperty.call(record, "nothingSentReason")) {
      return null;
    }

    const reason: unknown = record["nothingSentReason"];

    if (reason === null) {
      return { nothingSentReason: null };
    }

    const reasons: Array<string> = Object.values(PublicNoteNothingSentReason);

    if (typeof reason !== "string" || !reasons.includes(reason)) {
      return null;
    }

    return { nothingSentReason: reason as PublicNoteNothingSentReason };
  }
}
