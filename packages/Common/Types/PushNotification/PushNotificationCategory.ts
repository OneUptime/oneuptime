/*
 * THE ACTIONS A PHONE DRAWS UNDER A PUSH.
 *
 * A push can name a category, and the OneUptime On-Call app (its first
 * release after 1.6.0, and later) registers what each one carries: the
 * buttons under the notification, on the lock screen and in the
 * notification shade. Every
 * push of an on-call page - an incident, an alert or an episode, a first
 * page, a person's page or a page again (UserNotificationRuleService) -
 * names ON_CALL_PAGE_PUSH_CATEGORY, whose actions are Acknowledge and
 * Escalate. Either opens the app on the record, after the phone is
 * unlocked, and the record's screen does what was asked, signed in as the
 * person, as its own buttons would.
 *
 * An app older than the category does not know it, and shows the push with
 * no buttons, as before; so does a push that names no category. The app
 * keeps its own copy of the id (MobileApp/src/notifications/categories.ts,
 * built without Common's code), held to this one by
 * PushNotificationCategoryMobileParity.
 *
 * Expo carries the category to both platforms (`categoryId`); a browser's
 * web push has no categories and never reads it.
 */

export const ON_CALL_PAGE_PUSH_CATEGORY: string = "ON_CALL_PAGE";

/*
 * Every category a push may name. The push relay forwards only these: what
 * it passes on goes to Expo under its deployment's access token.
 */
export const PUSH_NOTIFICATION_CATEGORIES: ReadonlyArray<string> = [
  ON_CALL_PAGE_PUSH_CATEGORY,
];

export function isPushNotificationCategory(value: unknown): value is string {
  return (
    typeof value === "string" && PUSH_NOTIFICATION_CATEGORIES.includes(value)
  );
}
