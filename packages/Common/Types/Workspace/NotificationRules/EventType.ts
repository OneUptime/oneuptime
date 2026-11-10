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
  /*
   * A hunt's finds: posted to the channels and chats its rules name each
   * time a scheduled run of the hunt finds security events
   * (SecurityHuntNotifications). A hunt gets no channel of its own.
   */
  SecurityHunt = "Security Hunt",
  /*
   * An SLO's error budget policy: posted to the channels and chats its rules
   * name each time the evaluation moves the SLO into a tier, to a less
   * severe one or out of every tier, or freezes its deployments or allows
   * them again (SloWorkspaceNotifications). An SLO gets no channel of its
   * own.
   */
  ServiceLevelObjective = "Service Level Objective",
}

export default NotificationRuleEventType;
