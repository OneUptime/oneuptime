import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * Sending a status page subscriber notification again: an incident public
 * note's, or the notification that an incident was created.
 *
 * A notification is sent again by putting its status back to Pending; the
 * job that sends it picks up Pending rows. What that reaches differs:
 *
 * - a public note (and a state change) is sent to every status page the
 *   incident reaches now, including the pages that were sent it before;
 * - the incident-created notification keeps a record of the pages it was
 *   sent to in full (Incident.statusPagesNotifiedOnCreation). Retry after a
 *   failure resumes after them; Resend after a success, and 'Resend to all
 *   pages' after a failure (IncidentCreatedResend), empty the record so every
 *   page is sent it again.
 *
 * Which of the two a settled notification offers is decided here, so the
 * dashboard's buttons and the server's checks cannot drift apart:
 *
 * - Success offers Resend: it went out, and someone wants it to go out again
 *   (a list that was fixed, a page added after a scope change);
 * - Failed offers Retry: not everyone was sent it;
 * - Skipped offers nothing. A note posted with notify off keeps
 *   shouldStatusPageSubscribersBeNotifiedOnNoteCreated false - a column no
 *   one may update - and the job only sends notes with it true, so a skipped
 *   note put back to Pending would sit there forever. Other skips (a hidden
 *   incident, no monitors) would only be skipped again; publishing a hidden
 *   incident offers its own 'notify' checkbox (IncidentCreatedRenotify);
 * - Pending and InProgress offer nothing: the notification is on its way.
 */
export enum SubscriberNotificationResendAction {
  // After a failure: send it again to whoever was not sent it.
  Retry = "Retry",
  // After a success: send it again to everyone it reaches now.
  Resend = "Resend",
}

export default class SubscriberNotificationResend {
  /*
   * Why the server refuses to send a public note's notification again,
   * shown to whoever asked.
   */
  public static readonly notePostedWithoutNotifyingMessage: string =
    "This note was posted without notifying subscribers, so there is nothing to resend. Post a new note with Notify Status Page Subscribers ticked to tell them.";

  public static readonly beingSentMessage: string =
    "This notification is being sent right now. Wait until it has finished, then send it again.";

  public static readonly noPermissionToResendNoteMessage: string =
    "You do not have permission to send this note's notification again. Sending it again needs the permission to post public notes that notify subscribers, as well as the permission to edit public notes.";

  public static readonly noPermissionToNotifyAboutEditMessage: string =
    "You do not have permission to notify subscribers about this edit. Notifying them needs the permission to post public notes that notify subscribers, as well as the permission to edit public notes. Save the edit without notifying subscribers, or ask someone who can post notifying notes.";

  public static readonly updateBeingSentMessage: string =
    "This note's update notification is being sent right now. Wait until it has finished, then save your edit with Notify subscribers about this update ticked again - or save it without notifying subscribers.";

  /*
   * What a notification in `status` offers: Retry after a failure, and
   * Resend after a success where the caller supports resending one
   * (`isResendAfterSuccessOffered`). Null for anything else.
   *
   * A caller that leaves `isResendAfterSuccessOffered` off keeps the old
   * behaviour: only a failed notification can be sent again.
   */
  public static getAction(data: {
    status: StatusPageSubscriberNotificationStatus | undefined | null;
    isResendAfterSuccessOffered: boolean;
  }): SubscriberNotificationResendAction | null {
    if (data.status === StatusPageSubscriberNotificationStatus.Failed) {
      return SubscriberNotificationResendAction.Retry;
    }

    if (
      data.status === StatusPageSubscriberNotificationStatus.Success &&
      data.isResendAfterSuccessOffered
    ) {
      return SubscriberNotificationResendAction.Resend;
    }

    return null;
  }

  /*
   * Why a public note's notification may not be put back to Pending by a
   * user or an API key, or null when it may:
   *
   * - a note posted with notify off: the job never sends it (see the header),
   *   so the note would sit in Pending forever;
   * - a notification being sent right now: the send settles its own status
   *   when it finishes and would overwrite the Pending, so the request would
   *   be lost without a word.
   *
   * Success and Failed are the cases the dashboard offers. Pending is
   * allowed and changes nothing. A skipped notification of a note that does
   * notify (the incident was hidden, or had no monitors, when it went out)
   * is allowed too: the job looks at it afresh, so it goes out if what
   * skipped it has changed. The dashboard does not offer that one.
   */
  public static getPublicNoteResendRefusal(data: {
    status: StatusPageSubscriberNotificationStatus | undefined | null;
    shouldStatusPageSubscribersBeNotifiedOnNoteCreated:
      | boolean
      | undefined
      | null;
  }): string | null {
    if (data.shouldStatusPageSubscribersBeNotifiedOnNoteCreated === false) {
      return this.notePostedWithoutNotifyingMessage;
    }

    if (data.status === StatusPageSubscriberNotificationStatus.InProgress) {
      return this.beingSentMessage;
    }

    return null;
  }

  /*
   * Whether an update asks for a public note's notification to be sent
   * again: it writes Pending into the note's 'posted' status column. The
   * workers write that column too, but as root, which is never checked.
   */
  public static isPublicNoteResendRequested(
    data: { subscriberNotificationStatusOnNoteCreated?: unknown } | undefined,
  ): boolean {
    return (
      data?.subscriberNotificationStatusOnNoteCreated ===
      StatusPageSubscriberNotificationStatus.Pending
    );
  }
}
