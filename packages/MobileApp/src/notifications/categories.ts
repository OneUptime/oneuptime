import type { NotificationAction } from "expo-notifications";
import type { PushPageActionKind } from "../oncall/pushPageAction";
import { PASS_ON_TEXT } from "../oncall/passOn";

/*
 * THE ACTIONS UNDER A PAGE'S PUSH.
 *
 * Every push of an on-call page - an incident, an alert or an episode, a
 * first page or a page again - names this category, and the phone draws its
 * actions under the notification, on the lock screen and in the notification
 * shade: Acknowledge, and Escalate for when the reader cannot take it. The
 * server's id is Common/Types/PushNotification/PushNotificationCategory.ts;
 * the app keeps its own copy, since it is built without Common's code, and
 * Common's PushNotificationCategoryMobileParity test holds the two together.
 * A server older than the category names none, and a build older than it
 * knows none: either way the push has no actions, as before.
 *
 * Both actions open the app on the record (oncall/pushPageAction.ts), after
 * the phone is unlocked - on iOS the action asks for it - and after the app's
 * own biometric lock. Nothing is done unseen from the lock screen.
 */

export const ON_CALL_PAGE_CATEGORY: string = "ON_CALL_PAGE";

export const ACKNOWLEDGE_PAGE_ACTION: string = "ACKNOWLEDGE_PAGE";
export const ESCALATE_PAGE_ACTION: string = "ESCALATE_PAGE";

/*
 * The categories earlier builds registered and no server ever named. Taken
 * off the phone, so only the one the server names is left.
 */
export const RETIRED_CATEGORIES: ReadonlyArray<string> = [
  "INCIDENT_ACTIONS",
  "ALERT_ACTIONS",
];

export const ON_CALL_PAGE_ACTIONS: ReadonlyArray<NotificationAction> = [
  {
    identifier: ACKNOWLEDGE_PAGE_ACTION,
    buttonTitle: "Acknowledge",
    options: { opensAppToForeground: true, isAuthenticationRequired: true },
  },
  {
    identifier: ESCALATE_PAGE_ACTION,
    buttonTitle: PASS_ON_TEXT.button,
    options: { opensAppToForeground: true, isAuthenticationRequired: true },
  },
];

/**
 * What an action under a page's push asks the record's screen to do, or null
 * for a tap on the notification itself (and any action this build does not
 * know), which opens the record as it always has.
 */
export function getPushPageActionKind(
  actionIdentifier: string | null | undefined,
): PushPageActionKind | null {
  if (actionIdentifier === ACKNOWLEDGE_PAGE_ACTION) {
    return "acknowledge";
  }
  if (actionIdentifier === ESCALATE_PAGE_ACTION) {
    return "escalate";
  }
  return null;
}
