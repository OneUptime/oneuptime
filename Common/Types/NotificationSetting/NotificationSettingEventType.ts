enum NotificationSettingEventType {
  // Incident
  SEND_INCIDENT_CREATED_OWNER_NOTIFICATION = "Send incident created notification when I am the owner of the incident",
  SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION = "Send incident note posted notification when I am the owner of the incident",
  SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION = "Send incident state changed notification when I am the owner of the incident",
  SEND_INCIDENT_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the incident",

  // Alerts

  SEND_ALERT_CREATED_OWNER_NOTIFICATION = "Send alert created notification when I am the owner of the alert",
  SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION = "Send alert note posted notification when I am the owner of the alert",
  SEND_ALERT_STATE_CHANGED_OWNER_NOTIFICATION = "Send alert state changed notification when I am the owner of the alert",
  SEND_ALERT_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the alert",

  // Alert Episodes

  SEND_ALERT_EPISODE_CREATED_OWNER_NOTIFICATION = "Send alert episode created notification when I am the owner of the alert episode",
  SEND_ALERT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION = "Send alert episode note posted notification when I am the owner of the alert episode",
  SEND_ALERT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION = "Send alert episode state changed notification when I am the owner of the alert episode",
  SEND_ALERT_EPISODE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the alert episode",

  // Incident Episodes

  SEND_INCIDENT_EPISODE_CREATED_OWNER_NOTIFICATION = "Send incident episode created notification when I am the owner of the incident episode",
  SEND_INCIDENT_EPISODE_NOTE_POSTED_OWNER_NOTIFICATION = "Send incident episode note posted notification when I am the owner of the incident episode",
  SEND_INCIDENT_EPISODE_STATE_CHANGED_OWNER_NOTIFICATION = "Send incident episode state changed notification when I am the owner of the incident episode",
  SEND_INCIDENT_EPISODE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the incident episode",

  // Monitors
  SEND_MONITOR_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the monitor",
  SEND_MONITOR_CREATED_OWNER_NOTIFICATION = "Send monitor created notification when I am the owner of the monitor",
  SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION = "Send monitor status changed notification when I am the owner of the monitor",
  SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES = "Send monitor notification when probe status changes",
  SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR = "Send monitor notification when no probes are monitoring the monitor",

  // Scheduled Maintenance
  SEND_SCHEDULED_MAINTENANCE_CREATED_OWNER_NOTIFICATION = "Send event created notification when I am the owner of the event",
  SEND_SCHEDULED_MAINTENANCE_NOTE_POSTED_OWNER_NOTIFICATION = "Send event note posted notification when I am the owner of the event",
  SEND_SCHEDULED_MAINTENANCE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the event",
  SEND_SCHEDULED_MAINTENANCE_STATE_CHANGED_OWNER_NOTIFICATION = "Send event state changed notification when I am the owner of the event",

  // Status Page
  SEND_STATUS_PAGE_ANNOUNCEMENT_CREATED_OWNER_NOTIFICATION = "Send status page announcement created notification when I am the owner of the status page",
  SEND_STATUS_PAGE_CREATED_OWNER_NOTIFICATION = "Send status page created notification when I am the owner of the status page",
  SEND_STATUS_PAGE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the status page",

  // Probe Status change Notification
  SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION = "Send probe status changed notification when I am the owner of the probe",
  SEND_PROBE_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the probe",

  // AI Agent Status change Notification
  SEND_AI_AGENT_STATUS_CHANGED_OWNER_NOTIFICATION = "Send AI agent status changed notification when I am the owner of the AI agent",
  SEND_AI_AGENT_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the AI agent",

  // On Call Notifications
  SEND_WHEN_USER_IS_ON_CALL_ROSTER = "When user is on-call roster",
  SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER = "When user is next on-call roster",
  SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY = "When user is added to on-call policy",
  SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY = "When user is removed from on-call policy",
  SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER = "When user is no longer active on on-call roster",
}

export default NotificationSettingEventType;
