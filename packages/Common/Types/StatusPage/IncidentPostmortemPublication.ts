import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * Status page subscribers hear about an incident's postmortem once, when it
 * is published: the first time the status page shows it.
 *
 * The status page shows a postmortem when Publish on Status Page
 * (showPostmortemOnStatusPage) is on and its note says something; the
 * attachments are shown with the note, never without it. So the postmortem
 * is published by the update that makes both true, whichever it writes:
 * switching publishing on over a written note, or writing the note of a
 * postmortem that is switched on.
 *
 * What does not tell anyone again:
 * - saving it as it is. The Edit Postmortem form sends every field with
 *   every save, and an API client or a workflow may write the whole incident
 *   back, so a write that carries the note is no news. It used to be: every
 *   save queued the notification again (found in #4422);
 * - editing a published postmortem. The status page shows the new note, and
 *   the incident feed records it, but subscribers were told already.
 *
 * Taking it off the status page (or emptying its note) and publishing it
 * again tells them again: they saw it go, so its return is news.
 *
 * Whether subscribers are notified at all - Notify Subscribers
 * (notifySubscribersOnPostmortemPublished) - is read by the job that sends
 * it, never decided here (see NotifyFlagNeverQueuesOnUpdateGuard): an update
 * queues the notification on what it publishes, and the job skips it, with
 * the reason, when it is not to be sent.
 *
 * Shared by IncidentService, which queues the notification when an update
 * publishes the postmortem, and Incident:SendPostmortemNotificationToSubscribers,
 * which only sends one the status page shows, so the two cannot drift apart.
 */

// A postmortem as stored, or as an update leaves it.
export interface IncidentPostmortemState {
  showPostmortemOnStatusPage?: boolean | undefined | null;
  postmortemNote?: string | undefined | null;
}

// A postmortem as stored, with where its subscriber notification stands.
export interface IncidentPostmortemStoredState extends IncidentPostmortemState {
  subscriberNotificationStatusOnPostmortemPublished?:
    | StatusPageSubscriberNotificationStatus
    | undefined
    | null;
}

// The columns that decide whether the status page shows the postmortem.
export type IncidentPostmortemColumn =
  | "showPostmortemOnStatusPage"
  | "postmortemNote";

export default class IncidentPostmortemPublication {
  public static readonly columns: ReadonlyArray<IncidentPostmortemColumn> = [
    "showPostmortemOnStatusPage",
    "postmortemNote",
  ];

  // What the notification says while it waits for the job.
  public static readonly queuedMessage: string =
    "Postmortem published. Subscribers will be notified shortly.";

  // Why the job skips a postmortem the status page does not show.
  public static readonly noNoteMessage: string =
    "The postmortem has no note, so the status page does not show it. Skipping notifications to subscribers.";

  /*
   * The note as the status page reads it: line endings written as "\n",
   * without the whitespace around it, and "" for no note. Two notes that
   * read the same here are the same postmortem.
   */
  public static normalizeNote(note: unknown): string {
    if (typeof note !== "string") {
      return "";
    }

    return note.replace(/\r\n?/g, "\n").trim();
  }

  // Whether the note says anything at all.
  public static hasNote(note: unknown): boolean {
    return this.normalizeNote(note).length > 0;
  }

  /*
   * Whether the status page shows the postmortem: Publish on Status Page is
   * on and the note says something.
   */
  public static isPublished(
    state: IncidentPostmortemState | undefined | null,
  ): boolean {
    if (!state) {
      return false;
    }

    return (
      state.showPostmortemOnStatusPage === true &&
      this.hasNote(state.postmortemNote)
    );
  }

  /*
   * Whether an update writes the note or the switch. A column left out - or
   * sent as undefined, which writes nothing - is not written; a note sent as
   * null is, and clears it.
   */
  public static isWrittenBy(
    written: Record<string, unknown> | undefined | null,
  ): boolean {
    if (!written) {
      return false;
    }

    return this.columns.some((column: IncidentPostmortemColumn): boolean => {
      return written[column] !== undefined;
    });
  }

  /*
   * The postmortem once the update is written: each column the update
   * writes, the stored one otherwise. `stored` is undefined for an incident
   * the read before the write did not see, which then holds what the update
   * writes and nothing else.
   */
  public static getStateAfterUpdate(data: {
    stored: IncidentPostmortemState | undefined | null;
    written: Record<string, unknown>;
  }): IncidentPostmortemState {
    const writtenSwitch: unknown = data.written["showPostmortemOnStatusPage"];
    const writtenNote: unknown = data.written["postmortemNote"];

    return {
      showPostmortemOnStatusPage:
        writtenSwitch !== undefined
          ? writtenSwitch === true
          : data.stored?.showPostmortemOnStatusPage === true,
      postmortemNote:
        writtenNote !== undefined
          ? typeof writtenNote === "string"
            ? writtenNote
            : null
          : (data.stored?.postmortemNote ?? null),
    };
  }

  /*
   * Whether the update writes a note that reads differently from the stored
   * one (normalizeNote): what the incident feed records as "Postmortem Note
   * updated" or "cleared". Writing back the note the incident holds is not
   * a change. A note written to an incident the read before the write did
   * not see counts as one, so a real change is never missed.
   */
  public static isNoteChanged(data: {
    stored: IncidentPostmortemState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    if (data.written["postmortemNote"] === undefined) {
      return false;
    }

    if (!data.stored) {
      return true;
    }

    return (
      this.normalizeNote(data.written["postmortemNote"]) !==
      this.normalizeNote(data.stored.postmortemNote)
    );
  }

  /*
   * Whether the update publishes the postmortem: the status page does not
   * show it before the update, and does once it is written. An incident the
   * read before the write did not see counts as not shown before.
   */
  public static isPublishedByUpdate(data: {
    stored: IncidentPostmortemState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    return (
      !this.isPublished(data.stored) &&
      this.isPublished(this.getStateAfterUpdate(data))
    );
  }

  /*
   * Whether a notification is on its way already: Pending waits for the
   * job, which reads the incident when it sends it, so it carries what the
   * update wrote; InProgress is being sent. Queueing either again would
   * send it twice.
   */
  public static isOnItsWay(
    status: StatusPageSubscriberNotificationStatus | undefined | null,
  ): boolean {
    return (
      status === StatusPageSubscriberNotificationStatus.Pending ||
      status === StatusPageSubscriberNotificationStatus.InProgress
    );
  }

  /*
   * Whether an update queues the postmortem's subscriber notification:
   *
   * - it publishes the postmortem (isPublishedByUpdate);
   * - it does not set the notification's status itself. Pending is the API's
   *   way of sending it again, and whoever sets another status means it;
   * - the notification is not on its way already (isOnItsWay).
   *
   * Notify Subscribers plays no part: the job reads it when it would send.
   */
  public static shouldQueueNotification(data: {
    stored: IncidentPostmortemStoredState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    if (!this.isPublishedByUpdate(data)) {
      return false;
    }

    if (
      data.written["subscriberNotificationStatusOnPostmortemPublished"] !==
      undefined
    ) {
      return false;
    }

    return !this.isOnItsWay(
      data.stored?.subscriberNotificationStatusOnPostmortemPublished,
    );
  }
}
