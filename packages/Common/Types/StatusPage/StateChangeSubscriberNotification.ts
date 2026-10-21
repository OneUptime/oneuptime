import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * A state change on an incident or a scheduled maintenance event tells status
 * page subscribers once.
 *
 * The state change dialogs, the Change State bulk action and the API can post
 * a public note with the change. The note is not a column: it travels with
 * the create as `miscDataProps.publicNote`, and the state timeline service
 * turns it into a public note on the event. When the change notifies
 * subscribers, so does its note, and subscribers would get two messages about
 * one change. They get one, the note: it is what the person changing the
 * state wrote for them. The change itself is recorded as sent by the note and
 * never queued.
 *
 * IncidentStateTimelineService and ScheduledMaintenanceStateTimelineService
 * both decide here, once. The scheduled maintenance one used to mark the
 * change as sent by the note and then queue it anyway a few lines further
 * down, so its subscribers got both messages. StateChangePublicNoteGuard
 * (Common Tests) keeps every service that posts such a note on this.
 */

// The columns of a state timeline row that say whether, and how, it notifies.
export interface StateChangeNotificationColumns {
  shouldStatusPageSubscribersBeNotified?: boolean | undefined;
  subscriberNotificationStatus?:
    | StatusPageSubscriberNotificationStatus
    | undefined;
  subscriberNotificationStatusMessage?: string | undefined;
}

export interface StateChangeSubscriberNotificationDecision {
  status: StatusPageSubscriberNotificationStatus;
  // Left as it is when undefined.
  message?: string | undefined;
}

export default class StateChangeSubscriberNotification {
  // The misc data prop the note travels under (Dashboard Utils/BulkStateChange).
  public static readonly publicNoteKey: string = "publicNote";

  public static readonly sentByPublicNoteMessage: string =
    "Subscribers are notified by the public note posted with this state change, so they get one message instead of two.";

  /*
   * The public note posted with a state change, as it was written, or
   * undefined when there is none. A note with no text in it - spaces and line
   * breaks only - is none: it would post an empty note on the status page
   * and, as the one message subscribers get, tell them nothing. So is
   * anything that is not text.
   */
  public static getPublicNote(
    miscDataProps: JSONObject | undefined | null,
  ): string | undefined {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return undefined;
    }

    const note: unknown = miscDataProps[this.publicNoteKey];

    if (typeof note !== "string" || note.trim().length === 0) {
      return undefined;
    }

    return note;
  }

  /*
   * The state change's own subscriber notification:
   *
   *  - not to notify subscribers: skipped, saying why (skippedMessage);
   *  - to notify them, with a public note: already sent - the note is the
   *    message, and it is queued with the note;
   *  - to notify them, without a note: queued for the state change job;
   *  - not said: null, and the row keeps what it has (the columns default
   *    to notifying, queued).
   */
  public static getDecision(data: {
    shouldStatusPageSubscribersBeNotified: boolean | undefined | null;
    hasPublicNote: boolean;
    skippedMessage: string;
  }): StateChangeSubscriberNotificationDecision | null {
    if (data.shouldStatusPageSubscribersBeNotified === false) {
      return {
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: data.skippedMessage,
      };
    }

    if (data.shouldStatusPageSubscribersBeNotified !== true) {
      return null;
    }

    if (data.hasPublicNote) {
      return {
        status: StatusPageSubscriberNotificationStatus.Success,
        message: this.sentByPublicNoteMessage,
      };
    }

    return {
      status: StatusPageSubscriberNotificationStatus.Pending,
    };
  }

  // Writes getDecision's answer onto the state change about to be created.
  public static applyToStateChange(data: {
    stateChange: StateChangeNotificationColumns;
    hasPublicNote: boolean;
    skippedMessage: string;
  }): void {
    const decision: StateChangeSubscriberNotificationDecision | null =
      this.getDecision({
        shouldStatusPageSubscribersBeNotified:
          data.stateChange.shouldStatusPageSubscribersBeNotified,
        hasPublicNote: data.hasPublicNote,
        skippedMessage: data.skippedMessage,
      });

    if (!decision) {
      return;
    }

    data.stateChange.subscriberNotificationStatus = decision.status;

    if (decision.message !== undefined) {
      data.stateChange.subscriberNotificationStatusMessage = decision.message;
    }
  }
}
