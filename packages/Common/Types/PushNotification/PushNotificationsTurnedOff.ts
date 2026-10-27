/*
 * PUSH NOTIFICATIONS TURNED OFF FOR THE WHOLE SERVER.
 *
 * A master admin can turn off push notifications for the server (Admin
 * Dashboard > Settings > Push Notifications, GlobalConfig.
 * disablePushNotifications): for an installation whose rules let nothing
 * leave through Expo, the push relay or a browser's push service, which
 * reaches people through a custom channel - often its own app - instead.
 *
 * Then nothing is pushed, no device can be registered, and everything that
 * would have been says so in these words: the push sender on a person's
 * on-call log, the device routes when they refuse, readiness, and the
 * dashboards. A server admin turns it back on, so that is who each one names.
 *
 * Pure, with no Node or browser APIs.
 */

// What a person reads about it, wherever push would have been.
export const PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE: string =
  "Push notifications are turned off on this server. Your administrator can turn them on in the Admin Dashboard, under Settings > Push Notifications.";

/*
 * What a push that was not sent says on the on-call log, as the senders word
 * a message they deliberately did not send (BlockedProjectNotifications).
 */
export const PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON: string = `Push notification not sent: ${PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE}`;

/*
 * What readiness says of a responder whose every verified method is a push
 * device, while push is off: who can turn it back on, as the project
 * switches' sentences say who can turn on theirs.
 */
export const PUSH_TURNED_OFF_READINESS_CLAUSE: string =
  "push notifications are turned off on this server - a server admin can turn them on in the Admin Dashboard, under Settings > Push Notifications";
