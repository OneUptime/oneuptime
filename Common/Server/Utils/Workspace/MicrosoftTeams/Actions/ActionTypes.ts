enum MicrosoftTeamsActionType {
  // Incident actions
  ACKNOWLEDGE_INCIDENT = "acknowledge_incident",
  RESOLVE_INCIDENT = "resolve_incident",
  CREATE_INCIDENT_NOTE = "create_incident_note",
  CREATE_INCIDENT_PUBLIC_NOTE = "create_incident_public_note",
  VIEW_INCIDENT = "view_incident",
  VIEW_CHANGE_INCIDENT_STATE = "view_change_incident_state",
  EXECUTE_INCIDENT_ON_CALL_POLICY = "execute_incident_on_call_policy",

  // Alert actions
  ACKNOWLEDGE_ALERT = "acknowledge_alert",
  RESOLVE_ALERT = "resolve_alert",
  CREATE_ALERT_NOTE = "create_alert_note",
  CREATE_ALERT_PUBLIC_NOTE = "create_alert_public_note",
  VIEW_ALERT = "view_alert",
  VIEW_CHANGE_ALERT_STATE = "view_change_alert_state",
  EXECUTE_ALERT_ON_CALL_POLICY = "execute_alert_on_call_policy",

  // Monitor actions
  RUN_MONITOR = "run_monitor",
  VIEW_MONITOR = "view_monitor",

  // On Call Duty Policy actions
  UPDATE_ON_CALL_DUTY_POLICY = "update_on_call_duty_policy",
  VIEW_ON_CALL_DUTY_POLICY = "view_on_call_duty_policy",

  // Scheduled Maintenance actions
  RESOLVE_SCHEDULED_MAINTENANCE = "resolve_scheduled_maintenance",
  CREATE_SCHEDULED_MAINTENANCE_NOTE = "create_scheduled_maintenance_note",
  CREATE_SCHEDULED_MAINTENANCE_PUBLIC_NOTE = "create_scheduled_maintenance_public_note",
  VIEW_SCHEDULED_MAINTENANCE = "view_scheduled_maintenance",
  VIEW_CHANGE_SCHEDULED_MAINTENANCE_STATE = "view_change_scheduled_maintenance_state",
  MARK_SCHEDULED_MAINTENANCE_AS_ONGOING = "mark_scheduled_maintenance_as_ongoing",
}

export default MicrosoftTeamsActionType;