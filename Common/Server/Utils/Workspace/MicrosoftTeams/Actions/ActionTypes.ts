// Microsoft Teams Action Types for OneUptime Integration

// Incident Actions
export enum MicrosoftTeamsIncidentActionType {
  AckIncident = "AcknowledgeIncident",
  ResolveIncident = "ResolveIncident",
  UnresolveIncident = "unresolve-incident",
  ViewIncident = "view-incident",
  IncidentCreated = "incident-created",
  IncidentStateChanged = "incident-state-changed",
  AddIncidentNote = "add-incident-note",
  ExecuteIncidentOnCallPolicy = "execute-incident-on-call-policy",
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
