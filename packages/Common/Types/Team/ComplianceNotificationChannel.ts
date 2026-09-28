/*
 * The notification channel an on-call compliance rule can insist on
 * (TeamComplianceSetting.notificationChannel). NULL on a setting means "any
 * channel". The string values are stored, so they must never be renamed.
 *
 * Every channel a UserNotificationRule can point at is here, because a
 * compliance rule that could only ask about four of the nine would report a
 * member whose pager is Telegram as unreachable when they are not.
 */
enum ComplianceNotificationChannel {
  Call = "Call",
  SMS = "SMS",
  Push = "Push",
  Email = "Email",
  WhatsApp = "WhatsApp",
  Telegram = "Telegram",
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
  Webhook = "Webhook",
}

export default ComplianceNotificationChannel;
