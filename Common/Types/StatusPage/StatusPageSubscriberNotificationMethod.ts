/*
 * Notification methods for Status Page Subscribers
 * Different methods require different template formats
 */

enum StatusPageSubscriberNotificationMethod {
  Email = "Email",
  SMS = "SMS",
  Slack = "Slack",
  MicrosoftTeams = "Microsoft Teams",
  Webhook = "Webhook",
}

export default StatusPageSubscriberNotificationMethod;
