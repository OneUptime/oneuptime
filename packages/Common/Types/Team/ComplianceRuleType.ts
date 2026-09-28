/*
 * The kinds of rule a team's compliance settings can enforce. The string
 * values are stored in TeamComplianceSetting.ruleType, so existing values must
 * never be renamed - add new ones instead.
 *
 * Two families (see ComplianceRule.ts for the catalog that describes each):
 *
 *  - HasNotification<Channel>Method: the member has a verified notification
 *    method on that channel.
 *  - Has<Incident|Alert>[Episode]OnCallRules: the member has an on-call
 *    notification rule for the chosen severities (all of them when none are
 *    chosen), optionally on one specific channel - "call me for Critical
 *    incidents" is HasIncidentOnCallRules + Call + [Critical].
 */
enum ComplianceRuleType {
  HasNotificationEmailMethod = "HasNotificationEmailMethod",
  HasNotificationSMSMethod = "HasNotificationSMSMethod",
  HasNotificationCallMethod = "HasNotificationCallMethod",
  HasNotificationPushMethod = "HasNotificationPushMethod",
  HasNotificationWhatsAppMethod = "HasNotificationWhatsAppMethod",
  HasNotificationTelegramMethod = "HasNotificationTelegramMethod",
  HasNotificationSlackMethod = "HasNotificationSlackMethod",
  HasNotificationMicrosoftTeamsMethod = "HasNotificationMicrosoftTeamsMethod",
  HasNotificationWebhookMethod = "HasNotificationWebhookMethod",
  HasIncidentOnCallRules = "HasIncidentOnCallRules",
  HasAlertOnCallRules = "HasAlertOnCallRules",
  HasIncidentEpisodeOnCallRules = "HasIncidentEpisodeOnCallRules",
  HasAlertEpisodeOnCallRules = "HasAlertEpisodeOnCallRules",
}

export default ComplianceRuleType;
