import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";
import StatusPageVisibility from "./StatusPageVisibility";
import { toStoredBoolean } from "../Database/BooleanColumnValue";

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
 * The status page shows an incident's postmortem only while it shows the
 * incident: Visible on Status Page on, and the incident not private (a
 * private incident is hidden from every status page; isIncidentShown). A
 * postmortem published while its incident is hidden reaches nobody: the job
 * skips its notification, saying it waits for the incident
 * (hiddenIncidentMessage). Showing the incident is then the moment the status
 * page first shows the postmortem, so the update that shows it queues the
 * notification (isShownByUpdate) - once: only a notification skipped because
 * the incident was hidden goes back in the queue, never one that was sent,
 * failed or skipped for another reason, and hiding the incident and showing
 * it again tells nobody twice. (Found in #4429: it used to stay skipped, so
 * nobody was ever told.)
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
  /*
   * Read only for an update that may show the incident (mayShowIncident):
   * why the notification was settled, and whether the incident was shown on
   * status pages before the update.
   */
  subscriberNotificationStatusMessageOnPostmortemPublished?:
    | string
    | undefined
    | null;
  isVisibleOnStatusPage?: boolean | undefined | null;
  isPrivate?: boolean | undefined | null;
}

// Whether the status page shows an incident: its two switches.
export interface IncidentVisibilityState {
  isVisibleOnStatusPage?: boolean | undefined | null;
  isPrivate?: boolean | undefined | null;
}

// Where the postmortem's subscriber notification stands, and why.
export interface IncidentPostmortemNotificationState {
  status: StatusPageSubscriberNotificationStatus | undefined | null;
  message: string | undefined | null;
}

/*
 * An incident with its postmortem and where the postmortem's notification
 * stands, as a page loads it or the server reads it again: whether the
 * postmortem waits for the incident to be shown (isWaitingForIncidentToShow),
 * or is due now that it is (isDueOnceShown). A note left unread is not known
 * to be empty.
 */
export interface IncidentPostmortemWaitingState
  extends IncidentPostmortemState,
    IncidentVisibilityState {
  notifySubscribersOnPostmortemPublished?: boolean | undefined | null;
  subscriberNotificationStatusOnPostmortemPublished?:
    | StatusPageSubscriberNotificationStatus
    | undefined
    | null;
  subscriberNotificationStatusMessageOnPostmortemPublished?:
    | string
    | undefined
    | null;
}

// The columns that decide whether the status page shows the postmortem.
export type IncidentPostmortemColumn =
  | "showPostmortemOnStatusPage"
  | "postmortemNote";

// What an update does to the postmortem's notification (getNotificationAction).
export enum PostmortemNotificationAction {
  None = "None",
  Queue = "Queue",
  QueueIfSkippedMeanwhile = "QueueIfSkippedMeanwhile",
  QueueIfSkippedAsHidden = "QueueIfSkippedAsHidden",
}

export default class IncidentPostmortemPublication {
  public static readonly columns: ReadonlyArray<IncidentPostmortemColumn> = [
    "showPostmortemOnStatusPage",
    "postmortemNote",
  ];

  // What the notification says while it waits for the job.
  public static readonly queuedMessage: string =
    "Postmortem published. Subscribers will be notified shortly.";

  // Why the job skips a postmortem the status page does not show: switched off...
  public static readonly notShownMessage: string =
    "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.";

  // ...or switched on without a note.
  public static readonly noNoteMessage: string =
    "The postmortem has no note, so the status page does not show it. Skipping notifications to subscribers.";

  /*
   * Why the job skips a published postmortem of an incident hidden from
   * status pages, and what happens next: it is sent when the incident is
   * made visible (isShownByUpdate). The skip is recognised by these words
   * (isHiddenIncidentSkip). The job said "Incident is not visible on status
   * page. Skipping notifications to subscribers." before; a data migration
   * (MarkPostmortemsWaitingForHiddenIncidents) gave incidents that are still
   * hidden these words, and left the others - shown since, their postmortem
   * on the status page for a while - as they were, so showing them again
   * never sends an old postmortem out of the blue.
   */
  public static readonly hiddenIncidentMessage: string =
    "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.";

  // What the notification says while it waits for the job, once the incident is shown.
  public static readonly shownQueuedMessage: string =
    "Incident made visible on status pages. Subscribers will be sent its postmortem shortly.";

  /*
   * How the dashboard labels a postmortem that waits for its hidden incident
   * to be shown (see isWaitingForIncidentToShow), in place of "Notifications
   * skipped.": it is not sent yet, rather than not to be sent.
   */
  public static readonly hiddenIncidentLabel: string =
    "Not sent yet: incident hidden from status pages";

  /*
   * What the incident's Visible on Status Page switch says while turning it
   * on would send the postmortem (isWaitingForIncidentToShow).
   */
  public static readonly sendsOnShowDescription: string =
    "This incident's postmortem was published while the incident was hidden, so subscribers have not been sent it. Turning this on sends it to them.";

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
   * Whether a written switch value switches it on, as the database stores it
   * (toStoredBoolean): Postgres stores "true", "yes", "on" or 1 as true, and
   * DatabaseService turns a write's switches into those booleans before any
   * hook reads them, so a hand-written request's switches it on too: the
   * status page would show it.
   */
  public static isSwitchedOn(value: unknown): boolean {
    return toStoredBoolean(value) === true;
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
          ? this.isSwitchedOn(writtenSwitch)
          : data.stored?.showPostmortemOnStatusPage === true,
      postmortemNote:
        writtenNote !== undefined
          ? typeof writtenNote === "string"
            ? writtenNote
            : null
          : data.stored?.postmortemNote ?? null,
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
   * job, InProgress is being sent. Queueing either again would send it
   * twice.
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
   * Whether the update sets the notification's status itself: Pending is
   * the API's way of sending it again, and whoever sets another status
   * means it. The status written back as it is stored - a client writing
   * the whole incident back - is no such choice. For an incident the read
   * before the write did not see, any status written counts.
   */
  public static isStatusSetByUpdate(data: {
    stored: IncidentPostmortemStoredState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    const writtenStatus: unknown =
      data.written["subscriberNotificationStatusOnPostmortemPublished"];

    if (writtenStatus === undefined) {
      return false;
    }

    if (!data.stored) {
      return true;
    }

    return (
      writtenStatus !==
      data.stored.subscriberNotificationStatusOnPostmortemPublished
    );
  }

  /*
   * Whether the status page shows the incident: Visible on Status Page on
   * (a switch never set reads as off, as the status page and the send job
   * read it), and the incident not private - a private incident is hidden
   * from every status page, whatever its switch says. The one rule every
   * status page read, subscriber job and write goes by
   * (StatusPageVisibility.isShown).
   */
  public static isIncidentShown(
    incident: IncidentVisibilityState | undefined | null,
  ): boolean {
    return StatusPageVisibility.isShown(incident);
  }

  /*
   * Whether an update may show the incident, and so has the incident's
   * visibility read before the write: it switches Visible on Status Page on
   * (as the database stores the value written; isSwitchedOn), or writes Private
   * Incident as off. An update that writes Visible on Status Page as off
   * leaves the incident hidden, whatever else it writes - the incident's
   * Settings form sends both switches with every save, so saving a hidden
   * incident reads nothing for this. An update that makes the incident
   * private hides it too: IncidentService switches Visible on Status Page
   * off with it.
   */
  public static mayShowIncident(
    written: Record<string, unknown> | undefined | null,
  ): boolean {
    if (!written) {
      return false;
    }

    const writtenVisibility: unknown = written["isVisibleOnStatusPage"];

    if (writtenVisibility !== undefined) {
      return this.isSwitchedOn(writtenVisibility);
    }

    return (
      written["isPrivate"] !== undefined &&
      !this.isSwitchedOn(written["isPrivate"])
    );
  }

  /*
   * Whether an update has the postmortem compared with what was stored
   * before it (IncidentService reads it, and acts on it once the update is
   * written): it writes the postmortem (isWrittenBy), or may show the
   * incident (mayShowIncident).
   */
  public static isComparedBy(
    written: Record<string, unknown> | undefined | null,
  ): boolean {
    return this.isWrittenBy(written) || this.mayShowIncident(written);
  }

  /*
   * Whether the update shows the incident on status pages: the status page
   * did not show it before (hidden, or private), and does once the update is
   * written - each switch as the update writes it, or as stored. Writing a
   * switch back as the incident holds it is no change. An incident the read
   * before the write did not see counts as hidden before, so a real change
   * is never missed.
   */
  public static isShownByUpdate(data: {
    stored: IncidentPostmortemStoredState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    const writtenVisibility: unknown = data.written["isVisibleOnStatusPage"];

    const isShownAfterUpdate: boolean = this.isIncidentShown({
      isVisibleOnStatusPage:
        writtenVisibility !== undefined
          ? this.isSwitchedOn(writtenVisibility)
          : data.stored?.isVisibleOnStatusPage === true,
      // Private as the update leaves it, by the one rule (StatusPageVisibility).
      isPrivate: StatusPageVisibility.isPrivateAfterWrite({
        written: data.written,
        stored: data.stored,
      }),
    });

    return isShownAfterUpdate && !this.isIncidentShown(data.stored);
  }

  /*
   * Whether the notification stands skipped only because the incident was
   * hidden from status pages (hiddenIncidentMessage). A skip for any other
   * reason, and any other status, is not.
   */
  public static isHiddenIncidentSkip(
    notification: IncidentPostmortemNotificationState | undefined | null,
  ): boolean {
    if (!notification) {
      return false;
    }

    return (
      notification.status === StatusPageSubscriberNotificationStatus.Skipped &&
      notification.message === this.hiddenIncidentMessage
    );
  }

  /*
   * Whether the postmortem waits for its incident to be shown: its
   * notification was skipped because the incident was hidden, the incident
   * is hidden still, and the postmortem is switched on with Notify
   * Subscribers on and - when its note was read - a note that says
   * something. What the Postmortem page labels its notification
   * (hiddenIncidentLabel) instead of "Notifications skipped.". An incident an
   * earlier release showed without sending its postmortem holds the earlier
   * words, so it is not waiting.
   */
  public static isWaitingForIncidentToShow(
    incident: IncidentPostmortemWaitingState | undefined | null,
  ): boolean {
    if (!incident) {
      return false;
    }

    return (
      !this.isIncidentShown(incident) &&
      incident.notifySubscribersOnPostmortemPublished === true &&
      incident.showPostmortemOnStatusPage === true &&
      (incident.postmortemNote === undefined ||
        this.hasNote(incident.postmortemNote)) &&
      this.isHiddenIncidentSkip({
        status: incident.subscriberNotificationStatusOnPostmortemPublished,
        message:
          incident.subscriberNotificationStatusMessageOnPostmortemPublished,
      })
    );
  }

  /*
   * Whether switching Visible on Status Page on, alone, sends the postmortem:
   * it waits for the incident, and the incident is not private (a private
   * incident stays hidden however its switch is set). What the switch on the
   * incident's Settings page says while it is so (sendsOnShowDescription).
   */
  public static isSentBySwitchingVisibilityOn(
    incident: IncidentPostmortemWaitingState | undefined | null,
  ): boolean {
    return (
      this.isWaitingForIncidentToShow(incident) &&
      !StatusPageVisibility.isPrivate(incident)
    );
  }

  /*
   * Whether a postmortem that waited for its incident is due now: its
   * notification stands skipped because the incident was hidden, and the
   * status page shows the incident and the postmortem - read once the update
   * that showed the incident is written, so a postmortem taken off, or an
   * incident hidden again, in the meantime is not sent.
   */
  public static isDueOnceShown(
    incident: IncidentPostmortemWaitingState | undefined | null,
  ): boolean {
    if (!incident) {
      return false;
    }

    return (
      this.isHiddenIncidentSkip({
        status: incident.subscriberNotificationStatusOnPostmortemPublished,
        message:
          incident.subscriberNotificationStatusMessageOnPostmortemPublished,
      }) &&
      this.isIncidentShown(incident) &&
      this.isPublished(incident)
    );
  }

  /*
   * What an update does to the postmortem's subscriber notification:
   *
   * - nothing when it sets the status itself (isStatusSetByUpdate);
   * - for an update that publishes the postmortem (isPublishedByUpdate):
   *   - Queue: put it back to Pending, from where it stood before the
   *     update;
   *   - QueueIfSkippedMeanwhile: it was on its way (isOnItsWay) when the
   *     update read it. A Pending one is read afresh by the job, so it
   *     carries the publish. But a run may already hold it, having read the
   *     postmortem before the update published it, and skip it from that
   *     read; so once the update is written, it is queued again if it was
   *     skipped in the meantime. (The job looks again after such a skip
   *     too, for a skip settled after that.)
   * - for an update that shows the incident (isShownByUpdate):
   *   - QueueIfSkippedAsHidden: the notification was skipped because the
   *     incident was hidden, or was on its way - and a run holding it may
   *     skip it so, from a read made before the update - or the read before
   *     the write did not see the incident. Once the update is written, the
   *     incident is read again, and the notification is queued if it is due
   *     then (isDueOnceShown: skipped for that reason, with the incident and
   *     its postmortem on the status page), and only while it still stands
   *     so. A notification that was sent, failed or skipped for another
   *     reason stays as it is: showing the incident is no reason to send it
   *     (again);
   * - nothing otherwise.
   *
   * Notify Subscribers plays no part: the job reads it when it would send.
   */
  public static getNotificationAction(data: {
    stored: IncidentPostmortemStoredState | undefined | null;
    written: Record<string, unknown>;
  }): PostmortemNotificationAction {
    if (this.isStatusSetByUpdate(data)) {
      return PostmortemNotificationAction.None;
    }

    const storedStatus:
      | StatusPageSubscriberNotificationStatus
      | undefined
      | null = data.stored?.subscriberNotificationStatusOnPostmortemPublished;

    if (this.isPublishedByUpdate(data)) {
      if (this.isOnItsWay(storedStatus)) {
        return PostmortemNotificationAction.QueueIfSkippedMeanwhile;
      }

      return PostmortemNotificationAction.Queue;
    }

    if (
      this.isShownByUpdate(data) &&
      (!data.stored ||
        this.isOnItsWay(storedStatus) ||
        this.isHiddenIncidentSkip({
          status: storedStatus,
          message:
            data.stored
              .subscriberNotificationStatusMessageOnPostmortemPublished,
        }))
    ) {
      return PostmortemNotificationAction.QueueIfSkippedAsHidden;
    }

    return PostmortemNotificationAction.None;
  }
}
