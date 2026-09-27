/*
 * Every piece of text the dashboard shows about sending a status page
 * subscriber notification again: the Resend and Retry buttons, and the
 * confirmation that says what either one will do and to whom, for an
 * incident's public notes and for the notification that an incident was
 * created.
 *
 * Kept in one React-free module so the components render these exact
 * strings, and App/Tests can check that every one of them has an entry in all
 * seventeen Dashboard locale files - the dashboard translates a string by
 * looking up its English text, so a string with no entry silently stays
 * English.
 *
 * What the two kinds of notification reach differs, and the confirmations say
 * so: a note (like a state change) is sent to every status page again, while
 * Retry of the incident-created notification resumes after the pages it
 * already reached (see SubscriberNotificationResend in Common).
 */

export const SubscriberNotificationResendCopy: {
  // The buttons.
  resendButton: string;
  retryButton: string;
  resendToAllStatusPagesButton: string;
  resendNoteNotificationButton: string;
  retryNoteNotificationButton: string;
  cancelButton: string;

  // The confirmation.
  resendConfirmTitle: string;
  retryConfirmTitle: string;
  noteResendDescription: string;
  noteRetryDescription: string;
  incidentCreatedResendDescription: string;
  incidentCreatedRetryDescription: string;
  incidentCreatedRetryToAllStatusPagesLabel: string;
  incidentCreatedResendToAllStatusPagesDescription: string;

  // Errors.
  queueError: string;
} = {
  resendButton: "Resend",
  retryButton: "Retry",
  resendToAllStatusPagesButton: "Resend to all pages",
  resendNoteNotificationButton: "Resend notification",
  retryNoteNotificationButton: "Retry notification",
  cancelButton: "Cancel",

  resendConfirmTitle: "Send this notification again?",
  retryConfirmTitle: "Retry this notification?",
  noteResendDescription:
    "This note is sent again to the subscribers of every status page this incident reaches now, including the pages that were sent it before. Notes and state changes are always sent to every page again; only a retry of the incident-created notification resumes where it stopped. If the status pages this incident is limited to have changed since the note was posted, it goes to the pages it is limited to now.",
  noteRetryDescription:
    "Retry sends this note again to the subscribers of every status page this incident reaches now, including the pages that were sent it before: notes and state changes do not resume where they stopped, only the incident-created notification does. If the status pages this incident is limited to have changed since the note was posted, it goes to the pages it is limited to now.",
  incidentCreatedResendDescription:
    "The notification that this incident was created is sent again to the subscribers of every status page this incident reaches now, including the pages that were already sent it. If the status pages this incident is limited to have changed since it went out, it goes to the pages it is limited to now.",
  incidentCreatedRetryDescription:
    "Retry resumes after the status pages that were already reached: only the pages of this incident's current scope that were not sent the notification in full are sent it now, including pages added since. Unlike notes and state changes, which are sent to every page again, the pages already reached are not sent it twice.",
  incidentCreatedRetryToAllStatusPagesLabel:
    "Send it to every status page again, including the pages already reached",
  incidentCreatedResendToAllStatusPagesDescription:
    "The notification that this incident was created is sent again to the subscribers of every status page this incident reaches now, including the pages the failed send already reached.",

  queueError: "Could not queue the notification again.",
};

export default SubscriberNotificationResendCopy;
