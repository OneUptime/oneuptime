import { JSONObject } from "../JSON";
import StatusPageSubscriberNotificationStatus from "./StatusPageSubscriberNotificationStatus";

/*
 * Status page subscribers hear about an announcement or a public note once,
 * when it is posted. Editing it afterwards used to change what the status page
 * showed without telling anyone, so a corrected maintenance window or a
 * revised customer update reached only the people who happened to reload the
 * page.
 *
 * Whether an edit is worth a notification is the editor's call - a typo fix is
 * not, a new date is - so it is asked per edit rather than stored as a setting
 * on the item. The choice travels with the update request as a misc data prop
 * (it is not a column: a stored "notify on the next edit" flag would either
 * stick and notify on every later typo fix, or have to be reset behind the
 * caller's back). The service turns it into a Pending update notification
 * status, and a worker job sends it.
 *
 * Everything here is shared by the dashboard, which sets the flag, and the
 * server, which reads it, so the two cannot drift apart.
 */
export default class SubscriberUpdateNotification {
  // The misc data prop an update request carries to ask for a notification.
  public static readonly miscDataKey: string = "notifySubscribersOfUpdate";

  public static readonly queuedMessage: string =
    "Subscribers will be notified about this update shortly.";

  public static readonly resendQueuedMessage: string =
    "Update notification queued for resending.";

  public static readonly sentMessage: string =
    "Update notifications sent successfully to all subscribers.";

  public static readonly notYetNotifiedMessage: string =
    "Subscribers have not been notified about the original post yet. That notification will carry the latest content, so no separate update notification was sent.";

  public static readonly formFieldTitle: string =
    "Notify subscribers about this update";

  /*
   * Only a real yes counts. The flag arrives over JSON, so accept the string
   * form a hand-written API request might send, and nothing looser: a stray
   * "false" or 1 must never page every subscriber of a status page.
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
   * Returns why an update notification should not be sent given where the
   * original ("posted") notification is, or null when it may go out.
   *
   * While the original is still Pending or InProgress, subscribers have not
   * heard of the item at all. The original notification reads the item when it
   * is sent, so it already carries this edit - a second "updated" message
   * about something they were never told about would only confuse them.
   *
   * Every settled state lets the update through: Success is the normal case,
   * and Skipped or Failed mean subscribers were not told originally, which the
   * editor is now explicitly asking to do.
   */
  public static getSkipReasonForOriginalNotificationStatus(
    originalStatus: StatusPageSubscriberNotificationStatus | undefined | null,
  ): string | null {
    if (
      originalStatus === StatusPageSubscriberNotificationStatus.Pending ||
      originalStatus === StatusPageSubscriberNotificationStatus.InProgress
    ) {
      return this.notYetNotifiedMessage;
    }

    return null;
  }
}
