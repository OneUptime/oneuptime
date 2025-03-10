enum SlackActionType {
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
    NewIncident = "/incident", // new incident slash command
    SubmitNewIncident = "SubmitNewIncident",
  
    // Alert Actions just like Incident Actions
    AcknowledgeAlert = "AcknowledgeAlert",
    ResolveAlert = "ResolveAlert",
    ViewAddAlertNote = "ViewAddAlertNote",
    SubmitAlertNote = "SubmitAlertNote",
    ViewChangeAlertState = "ViewChangeAlertState",
    SubmitChangeAlertState = "SubmitChangeAlertState",
    ViewExecuteAlertOnCallPolicy = "ViewExecuteAlertOnCallPolicy",
    SubmitExecuteAlertOnCallPolicy = "SubmitExecuteAlertOnCallPolicy",
    ViewAlert = "ViewAlert",
  
  
    // Scheduled Maintenance Actions.
  }
  
  export default SlackActionType;
  