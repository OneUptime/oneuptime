enum MicrosoftTeamsActionType {
  // Incident actions
  AcknowledgeIncident = "acknowledgeIncident", // Changed to camelCase for consistency
  ResolveIncident = "resolveIncident", // Changed to camelCase
  ViewAddIncidentNote = "viewAddIncidentNote", // Changed to camelCase
  SubmitIncidentNote = "submitIncidentNote", // Changed to camelCase
  ViewChangeIncidentState = "viewChangeIncidentState", // Changed to camelCase
  SubmitChangeIncidentState = "submitChangeIncidentState", // Changed to camelCase
  ViewExecuteIncidentOnCallPolicy = "viewExecuteIncidentOnCallPolicy", // Changed to camelCase
  SubmitExecuteIncidentOnCallPolicy = "submitExecuteIncidentOnCallPolicy", // Changed to camelCase
  ViewIncident = "viewIncident", // Changed to camelCase
  NewIncident = "/incident", 
  SubmitNewIncident = "submitNewIncident", // Changed to camelCase

  // Alert Actions just like Incident Actions
  AcknowledgeAlert = "acknowledgeAlert", // Changed to camelCase
  ResolveAlert = "resolveAlert", // Changed to camelCase
  ViewAddAlertNote = "viewAddAlertNote", // Changed to camelCase
  SubmitAlertNote = "submitAlertNote", // Changed to camelCase
  ViewChangeAlertState = "viewChangeAlertState", // Changed to camelCase
  SubmitChangeAlertState = "submitChangeAlertState", // Changed to camelCase
  ViewExecuteAlertOnCallPolicy = "viewExecuteAlertOnCallPolicy", // Changed to camelCase for alerts
  SubmitExecuteAlertOnCallPolicy = "submitExecuteAlertOnCallPolicy", // Changed to camelCase for alerts
  ViewAlert = "viewAlert", // Changed to camelCase

  // Scheduled Maintenance Actions just like Incident Actions.
  MarkScheduledMaintenanceAsComplete = "markScheduledMaintenanceAsComplete", // Changed to camelCase
  MarkScheduledMaintenanceAsOngoing = "markScheduledMaintenanceAsOngoing", // Changed to camelCase
  ViewAddScheduledMaintenanceNote = "viewAddScheduledMaintenanceNote", // Changed to camelCase for SM
  SubmitScheduledMaintenanceNote = "submitScheduledMaintenanceNote", // Changed to camelCase for SM
  ViewChangeScheduledMaintenanceState = "viewChangeScheduledMaintenanceState", // Changed to camelCase for SM
  SubmitChangeScheduledMaintenanceState = "submitChangeScheduledMaintenanceState", // Changed to camelCase for SM
  ViewScheduledMaintenance = "viewScheduledMaintenance", // Changed to camelCase

  NewScheduledMaintenance = "/maintenance", 
  SubmitNewScheduledMaintenance = "submitNewScheduledMaintenance", // Changed to camelCase

  // On Call Duty Policy Actions
  ViewOnCallSchedule = "viewOnCallSchedule", // Added new member
}

export default MicrosoftTeamsActionType;
