import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * 'Resend to all pages' for the notification that an incident was created.
 *
 * That notification keeps a record of the status pages it was sent to in
 * full (Incident.statusPagesNotifiedOnCreation), and the job skips them. Two
 * ways of sending it again already existed, and both stay as they are:
 *
 * - setting subscriberNotificationStatusOnIncidentCreated back to Pending
 *   (the API route, and the dashboard's Retry): IncidentService empties the
 *   record in the same write, so it reaches every page again - except after
 *   a failure, where Retry resumes after the pages the failed send finished,
 *   so they are not sent it twice (see
 *   IncidentService.clearCreatedNotificationRecordOnResend);
 * - adding pages to the scope, or publishing a hidden incident, with their
 *   checkboxes (IncidentScopeAddedPagesNotification, IncidentCreatedRenotify),
 *   which tell only the pages the record does not list.
 *
 * What was missing is sending it to every page on purpose: after a failure,
 * to start over rather than resume (a template or an SMTP setting was fixed
 * since, and the pages that "went through" should get the corrected email
 * too), and after a success, without relying on an implied rule. This misc
 * data prop asks for exactly that. IncidentService turns it into a Pending
 * status and an empty record, in the caller's own update, so the column
 * check that runs after the hook decides whether the caller may.
 *
 * Like the other notification requests (SubscriberUpdateNotification,
 * IncidentCreatedRenotify, IncidentScopeAddedPagesNotification) it is a misc
 * data prop, not a column: a stored "resend" flag would either stick or have
 * to be reset behind the caller's back.
 *
 * It is only accepted for a notification that went out - Success, or Failed
 * part-way. A skipped one was never sent to anyone, and one that is Pending
 * or being sent is on its way; see getRefusalReason.
 */
export default class IncidentCreatedResend {
  // The misc data prop an update request carries to ask for the resend.
  public static readonly miscDataKey: string =
    "resendIncidentCreatedToAllStatusPages";

  // The status message of a notification queued by this request.
  public static readonly queuedMessage: string =
    "Queued to be sent again to every status page this incident reaches, including the pages that were already sent it.";

  /*
   * The status message the dashboard's Retry writes: it resumes after the
   * pages already reached.
   */
  public static readonly retryQueuedMessage: string =
    "Queued to be sent again to the status pages that were not sent it in full. The pages already reached are not sent it again.";

  public static readonly skippedRefusalMessage: string =
    "Subscribers were never sent the notification that this incident was created (it was skipped), so there is nothing to send again.";

  public static readonly inFlightRefusalMessage: string =
    "The notification that this incident was created is queued or being sent right now. Wait until it has finished, then send it again.";

  public static readonly conflictingStatusMessage: string =
    "A request to send the incident-created notification to every status page again cannot also set its status. Leave the status out.";

  public static readonly noPermissionMessage: string =
    "You do not have permission to send the incident-created notification again. It needs the permission to edit incidents.";

  /*
   * Only a real yes counts. The flag arrives over JSON, so accept the string
   * form a hand-written API request might send, and nothing looser: a stray
   * "false" or 1 must never email every subscriber of every status page.
   */
  public static isRequested(
    miscDataProps: JSONObject | undefined | null,
  ): boolean {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return false;
    }

    const value: unknown = miscDataProps[this.miscDataKey];

    return value === true || value === "true";
  }

  public static getMiscDataProps(): JSONObject {
    return {
      [this.miscDataKey]: true,
    };
  }

  /*
   * Why a notification in `status` cannot be sent to every page again, or
   * null when it can (it went out: Success, or Failed part-way).
   */
  public static getRefusalReason(
    status: StatusPageSubscriberNotificationStatus | undefined | null,
  ): string | null {
    switch (status) {
      case StatusPageSubscriberNotificationStatus.Success:
      case StatusPageSubscriberNotificationStatus.Failed:
        return null;
      case StatusPageSubscriberNotificationStatus.Pending:
      case StatusPageSubscriberNotificationStatus.InProgress:
        return this.inFlightRefusalMessage;
      default:
        // Skipped, and a missing status, which the column's default rules out.
        return this.skippedRefusalMessage;
    }
  }
}
