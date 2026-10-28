/*
 * A notification channel an on-call compliance rule can insist on
 * (TeamComplianceSetting.notificationChannels, every one of which a member
 * must be notified on). No channels on a setting means "any channel". The
 * string values are stored, so they must never be renamed.
 *
 * Every channel a UserNotificationRule can point at is here, because a
 * compliance rule that could only ask about some of them would report a
 * member whose pager is Telegram as unreachable when they are not.
 *
 * Nine of them are a method each member owns (a phone, a push device, a
 * webhook...). CustomChannel is different: a custom channel
 * (CustomNotificationChannel, #5332) is the installation's, added by its
 * admin, and a member's rule simply names it - there is nothing per person to
 * add or verify, so no "has a verified ..." rule exists for it (see
 * ComplianceRule.ts, where its definition has no method).
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
  // Any custom channel (CustomNotificationChannel) that is on.
  CustomChannel = "CustomChannel",
}

export default ComplianceNotificationChannel;
