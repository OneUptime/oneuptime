enum NotificationRuleEventType {
  Incident = "Incident",
  Monitor = "Monitor",
  Alert = "Alert",
  AlertEpisode = "Alert Episode",
  IncidentEpisode = "Incident Episode",
  ScheduledMaintenance = "Scheduled Maintenance",
  OnCallDutyPolicy = "On-Call Duty Policy",
  /*
   * A security case: posted to the channels and chats its rules name when the
   * case opens or rises to a higher priority, is assigned, or has a playbook
   * step waiting for approval (SecurityCaseNotifications). A case gets no
   * channel of its own.
   */
  SecurityCase = "Security Case",
}

export default NotificationRuleEventType;
