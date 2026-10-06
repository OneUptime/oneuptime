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
 * The status page shows an incident's postmortem only while it shows the
 * incident. A postmortem published while its incident is hidden from status
 * pages reaches nobody: the job skips its notification, saying it waits for
 * the incident (hiddenIncidentMessage). Making the incident visible is then
 * the moment the status page first shows it, so that update queues the
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
   * Read only for an update that switches Visible on Status Page on
   * (isIncidentShownBy): why the notification was settled, and whether the
   * incident was shown on status pages before the update.
   */
  subscriberNotificationStatusMessageOnPostmortemPublished?:
    | string
    | undefined
    | null;
  isVisibleOnStatusPage?: boolean | undefined | null;
}

// Where the postmortem's subscriber notification stands, and why.
export interface IncidentPostmortemNotificationState {
  status: StatusPageSubscriberNotificationStatus | undefined | null;
  message: string | undefined | null;
}

/*
 * An incident as its Settings form loads it: whether turning Visible on
 * Status Page on would send its postmortem (isWaitingForIncidentToShow).
 */
export interface IncidentPostmortemWaitingState
  extends IncidentPostmortemState {
  isVisibleOnStatusPage?: boolean | undefined | null;
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
   * made visible (isShownByUpdate).
   */
  public static readonly hiddenIncidentMessage: string =
    "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.";

  /*
   * The same skip as the job worded it before a hidden incident's postmortem
   * was sent once the incident is shown. Incidents it skipped then still
   * hold it, and showing them sends their postmortem too.
   */
  public static readonly earlierHiddenIncidentMessage: string =
    "Incident is not visible on status page. Skipping notifications to subscribers.";

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
   * Whether a written Publish on Status Page value switches it on. The API
   * passes a boolean through as it is sent, and Postgres stores the string
   * "true" as true, so a hand-written request's "true" switches it on too:
   * the status page would show it.
   */
  public static isSwitchedOn(value: unknown): boolean {
    return (
      value === true ||
      (typeof value === "string" && value.trim().toLowerCase() === "true")
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
   * Whether an update switches Visible on Status Page on: true, or a
   * hand-written "true" (isSwitchedOn). Only such an update can show a
   * postmortem that waits for its incident, so only it reads the incident's
   * visibility before the write. An update that makes the incident private
   * hides it instead: IncidentService switches it off before this is asked.
   */
  public static isIncidentShownBy(
    written: Record<string, unknown> | undefined | null,
  ): boolean {
    if (!written) {
      return false;
    }

    return this.isSwitchedOn(written["isVisibleOnStatusPage"]);
  }

  /*
   * Whether the update shows the incident on status pages: it switches
   * Visible on Status Page on for an incident that was hidden - switched
   * off, or never set, which the status page and the send job read as
   * hidden too. Writing it back on an incident already shown is no change.
   * An incident the read before the write did not see counts as hidden
   * before, so a real change is never missed.
   */
  public static isShownByUpdate(data: {
    stored: IncidentPostmortemStoredState | undefined | null;
    written: Record<string, unknown>;
  }): boolean {
    return (
      this.isIncidentShownBy(data.written) &&
      data.stored?.isVisibleOnStatusPage !== true
    );
  }

  /*
   * Whether the notification stands skipped only because the incident was
   * hidden from status pages - in the job's words now, or as it put them
   * before (earlierHiddenIncidentMessage). A skip for any other reason, and
   * any other status, is not.
   */
  public static isHiddenIncidentSkip(
    notification: IncidentPostmortemNotificationState | undefined | null,
  ): boolean {
    if (!notification) {
      return false;
    }

    return (
      notification.status === StatusPageSubscriberNotificationStatus.Skipped &&
      (notification.message === this.hiddenIncidentMessage ||
        notification.message === this.earlierHiddenIncidentMessage)
    );
  }

  /*
   * Whether showing the incident would send its postmortem now: the
   * incident is hidden, its postmortem is published with Notify Subscribers
   * on, and its notification was skipped only because the incident was
   * hidden. What the incident's Settings form says under Visible on Status
   * Page (sendsOnShowDescription), and what the postmortem's notification
   * status is labelled (hiddenIncidentLabel). An incident shown since - one
   * an earlier release showed without sending it - is not waiting: showing
   * it again is no change.
   */
  public static isWaitingForIncidentToShow(
    incident: IncidentPostmortemWaitingState | undefined | null,
  ): boolean {
    if (!incident) {
      return false;
    }

    return (
      incident.isVisibleOnStatusPage !== true &&
      incident.notifySubscribersOnPostmortemPublished === true &&
      this.isPublished(incident) &&
      this.isHiddenIncidentSkip({
        status: incident.subscriberNotificationStatusOnPostmortemPublished,
        message: incident.subscriberNotificationStatusMessageOnPostmortemPublished,
      })
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
   * - for an update that shows the incident (isShownByUpdate) whose
   *   postmortem is published once it is written:
   *   - QueueIfSkippedAsHidden: the notification was skipped because the
   *     incident was hidden, or was on its way - and a run holding it may
   *     skip it so, from a read made before the update. Once the update is
   *     written, it is queued if it stands skipped for that reason then,
   *     and only while it still does. A notification that was sent, failed
   *     or skipped for another reason stays as it is: showing the incident
   *     is no reason to send it (again);
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
      this.isPublished(this.getStateAfterUpdate(data)) &&
      (this.isOnItsWay(storedStatus) ||
        this.isHiddenIncidentSkip({
          status: storedStatus,
          message:
            data.stored?.subscriberNotificationStatusMessageOnPostmortemPublished,
        }))
    ) {
      return PostmortemNotificationAction.QueueIfSkippedAsHidden;
    }

    return PostmortemNotificationAction.None;
  }
}
