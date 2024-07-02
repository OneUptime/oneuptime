enum NotificationSettingEventType {
  // Incident
  SEND_INCIDENT_CREATED_OWNER_NOTIFICATION = "Send incident created notification when I am the owner of the incident",
  SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION = "Send incident note posted notification when I am the owner of the incident",
  SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION = "Send incident state changed notification when I am the owner of the incident",
  SEND_INCIDENT_OWNER_ADDED_NOTIFICATION = "Send notification when I am added as a owner to the incident",

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
}

export default NotificationSettingEventType;
