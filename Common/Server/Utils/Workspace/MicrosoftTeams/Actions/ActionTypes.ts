enum MicrosoftTeamsActionType {
  // Incident actions
  AcknowledgeIncident = "AcknowledgeIncident",
  ResolveIncident = "ResolveIncident",
  ViewAddIncidentNote = "ViewAddIncidentNote",
  SubmitIncidentNote = "SubmitIncidentNote",
  ViewChangeIncidentState = "ViewChangeIncidentState",
  SubmitChangeIncidentState = "SubmitChangeIncidentState",
  ViewExecuteIncidentOnCallPolicy = "ViewExecuteIncidentOnCallPolicy",
  SubmitExecuteIncidentOnCallPolicy = "SubmitExecuteIncidentOnCallPolicy",
  ViewIncident = "ViewIncident",
  NewIncident = "/incident", // new incident command
  SubmitNewIncident = "SubmitNewIncident",

  // Alert Actions
  AcknowledgeAlert = "AcknowledgeAlert",
  ResolveAlert = "ResolveAlert",
  ViewAddAlertNote = "ViewAddAlertNote",
  SubmitAlertNote = "SubmitAlertNote",
  ViewChangeAlertState = "ViewChangeAlertState",
  SubmitChangeAlertState = "SubmitChangeAlertState",
  ViewExecuteAlertOnCallPolicy = "ViewExecuteAlertOnCallPolicy",
  SubmitExecuteAlertOnCallPolicy = "SubmitExecuteAlertOnCallPolicy",
  ViewAlert = "ViewAlert",

  // Scheduled Maintenance Actions
  MarkScheduledMaintenanceAsComplete = "MarkScheduledMaintenanceAsComplete",
  MarkScheduledMaintenanceAsOngoing = "MarkScheduledMaintenanceAsOngoing",
  ViewAddScheduledMaintenanceNote = "ViewAddScheduledMaintenanceNote",
  SubmitScheduledMaintenanceNote = "SubmitScheduledMaintenanceNote",
  ViewChangeScheduledMaintenanceState = "ViewChangeScheduledMaintenanceState",
  SubmitChangeScheduledMaintenanceState = "SubmitChangeScheduledMaintenanceState",
  ViewScheduledMaintenance = "ViewScheduledMaintenance",
  NewScheduledMaintenance = "/maintenance", // new scheduled maintenance command
  SubmitNewScheduledMaintenance = "SubmitNewScheduledMaintenance",

  // Monitor Actions
  ViewMonitor = "ViewMonitor",

  // On-call policy Actions
  ViewOnCallPolicy = "ViewOnCallPolicy",
}

export default MicrosoftTeamsActionType;
