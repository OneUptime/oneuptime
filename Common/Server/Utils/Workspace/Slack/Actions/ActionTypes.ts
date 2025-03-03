enum SlackActionType {
  AcknowledgeIncident = "AcknowledgeIncident",
  ResolveIncident = "ResolveIncident",
  AddIncidentNote = "AddIncidentNote",
  SubmitIncidentNote = "SubmitIncidentNote",
  ChangeIncidentState = "ChangeIncidentState",
  SubmitIncidentState = "SubmitIncidentState",
  ExecuteIncidentOnCallPolicy = "ExecuteIncidentOnCallPolicy",
  SubmitExecuteIncidentOnCallPolicy = "SubmitExecuteIncidentOnCallPolicy",
  ViewIncident = "ViewIncident",
}

export default SlackActionType;
