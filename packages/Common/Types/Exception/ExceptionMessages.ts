enum ExceptionMessages {
  MonitorNotFound = "Monitor not found.",
  MonitorDisabled = "Monitor is disabled. Please enable it to start monitoring again.",
  MonitorArchived = "Monitor is archived. Unarchive it to start monitoring again.",
  MonitorDisabledBecauseOfManualIncident = "Monitor is disabled because an incident which is created manually is not resolved. Please resolve the incident to start monitoring again.",
  MonitorDisabledBecauseOfScheduledMaintenanceEvent = "Monitor is disabled because one of the maintenance events this monitor is attached to has not ended. Please end that maintenance event to start monitoring again.",
  ProbeNotAssignedToMonitor = "Probe is not assigned to this monitor",
  UserBlocked = "Your account has been blocked. Please contact your administrator.",
  ProjectBlocked = "This project has been blocked. Please contact your administrator.",
}

export default ExceptionMessages;
