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

  // Alert Actions

  // Scheduled Maintenance Actions.
}

export default SlackActionType;
