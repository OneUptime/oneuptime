enum ComplianceRuleType {
  HasNotificationEmail = "Has at least one email for notifications",
  HasNotificationSMS = "Has at least one phone number for SMS notifications",
  HasNotificationCall = "Has at least one phone number for call notifications",
  HasNotificationPush = "Has at least one push notification device",
  HasIncidentOnCallRules = "Has incident on-call rules set",
  HasAlertOnCallRules = "Has alert on-call rules set",
}

export default ComplianceRuleType;