// Microsoft Teams Action Types for OneUptime Integration

// Incident Actions
export enum MicrosoftTeamsIncidentActionType {
  AckIncident = "AcknowledgeIncident",
  ResolveIncident = "ResolveIncident",
  UnresolveIncident = "UnresolveIncident",
  ViewIncident = "ViewIncident",
  IncidentCreated = "IncidentCreated",
  IncidentStateChanged = "IncidentStateChanged",
  ViewAddIncidentNote = "ViewAddIncidentNote",
  SubmitIncidentNote = "SubmitIncidentNote",
  AddIncidentNote = "AddIncidentNote",
  ExecuteIncidentOnCallPolicy = "ExecuteIncidentOnCallPolicy",
  ViewExecuteIncidentOnCallPolicy = "ViewExecuteIncidentOnCallPolicy",
  SubmitExecuteIncidentOnCallPolicy = "SubmitExecuteIncidentOnCallPolicy",
  ViewChangeIncidentState = "ViewChangeIncidentState",
  SubmitChangeIncidentState = "SubmitChangeIncidentState",
  NewIncident = "CreateIncident", 
  SubmitNewIncident = "SubmitNewIncident",
}

// Alert Actions
export enum MicrosoftTeamsAlertActionType {
  AckAlert = "AckAlert",
  ResolveAlert = "ResolveAlert",
  ViewAlert = "ViewAlert",
  AlertCreated = "AlertCreated",
  AlertStateChanged = "AlertStateChanged",
  AddAlertNote = "AddAlertNote",
  ExecuteAlertOnCallPolicy = "ExecuteAlertOnCallPolicy",
  ViewAddAlertNote = "ViewAddAlertNote",
  SubmitAlertNote = "SubmitAlertNote",
  ViewExecuteAlertOnCallPolicy = "ViewExecuteAlertOnCallPolicy",
  SubmitExecuteAlertOnCallPolicy = "SubmitExecuteAlertOnCallPolicy",
  ViewChangeAlertState = "ViewChangeAlertState",
  SubmitChangeAlertState = "SubmitChangeAlertState",
}

// Monitor Actions
export enum MicrosoftTeamsMonitorActionType {
  ViewMonitor = "ViewMonitor",
  EnableMonitor = "EnableMonitor",
  DisableMonitor = "DisableMonitor",
  MonitorStatusChanged = "MonitorStatusChanged",
}

// Scheduled Maintenance Actions
export enum MicrosoftTeamsScheduledMaintenanceActionType {
  ViewScheduledMaintenance = "ViewScheduledMaintenance",
  MarkAsComplete = "MarkAsComplete",
  MarkAsOngoing = "MarkAsOngoing",
  ScheduledMaintenanceCreated = "ScheduledMaintenanceCreated",
  ScheduledMaintenanceStateChanged = "ScheduledMaintenanceStateChanged",
  AddScheduledMaintenanceNote = "AddScheduledMaintenanceNote",
  ViewAddScheduledMaintenanceNote = "ViewAddScheduledMaintenanceNote",
  SubmitScheduledMaintenanceNote = "SubmitScheduledMaintenanceNote",
  ViewChangeScheduledMaintenanceState = "ViewChangeScheduledMaintenanceState",
  SubmitChangeScheduledMaintenanceState = "SubmitChangeScheduledMaintenanceState",
  NewScheduledMaintenance = "CreateMaintenance", 
  SubmitNewScheduledMaintenance = "SubmitNewScheduledMaintenance",
}

// On-Call Duty Actions
export enum MicrosoftTeamsOnCallDutyActionType {
  ViewOnCallDuty = "ViewOnCallDuty",
  EscalateOnCall = "EscalateOnCall",
  OnCallDutyPolicyTriggered = "OnCallDutyPolicyTriggered",
}

// General Actions
export enum MicrosoftTeamsGeneralActionType {
  Help = "Help",
  ViewDashboard = "ViewDashboard",
  ViewProject = "ViewProject",
}

// Activity Types from Microsoft Teams
export enum TeamsActivityType {
  Message = "message",
  Invoke = "invoke",
  InstallationUpdate = "installationUpdate",
  MessageReaction = "messageReaction",
  MembersAdded = "membersAdded",
  MembersRemoved = "membersRemoved",
}

// All action types combined
export type MicrosoftTeamsActionType =
  | MicrosoftTeamsIncidentActionType
  | MicrosoftTeamsAlertActionType
  | MicrosoftTeamsMonitorActionType
  | MicrosoftTeamsScheduledMaintenanceActionType
  | MicrosoftTeamsOnCallDutyActionType
  | MicrosoftTeamsGeneralActionType;

export default MicrosoftTeamsActionType;
