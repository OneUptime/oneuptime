/*
 * THE EIGHT NOTIFICATION LOGS: the kinds of log every message OneUptime
 * sends is written to - an email, an SMS, a call, a push notification, a
 * WhatsApp or a Telegram message, a webhook, a workspace's message.
 *
 * What each log's statuses mean is read in one place
 * (NotificationLogStatus), and Who Was Told reads a record's notifications
 * by the same kinds (WhoWasTold, which names them WhoWasToldLogKind). Kept
 * in a file of its own so both can import it.
 */
enum NotificationLogKind {
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
  Push = "Push",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  Webhook = "Webhook",
  Workspace = "Workspace",
}

export default NotificationLogKind;
