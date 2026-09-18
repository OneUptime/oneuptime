enum NotificationRuleType {
  ON_CALL_EXECUTED_INCIDENT = "When incident on-call policy is executed",
  ON_CALL_EXECUTED_ALERT = "When alert on-call policy is executed",
  ON_CALL_EXECUTED_ALERT_EPISODE = "When alert episode on-call policy is executed",
  ON_CALL_EXECUTED_INCIDENT_EPISODE = "When incident episode on-call policy is executed",
  WHEN_USER_GOES_ON_CALL = "When user goes on call",
  WHEN_USER_GOES_OFF_CALL = "When user goes off call",
}

export default NotificationRuleType;
