// Microsoft Teams Action Types for OneUptime Integration

// Incident Actions
export enum MicrosoftTeamsIncidentActionType {
  AckIncident = "ack-incident",
  ResolveIncident = "resolve-incident",
  UnresolveIncident = "unresolve-incident",
  ViewIncident = "view-incident",
  IncidentCreated = "incident-created",
  IncidentStateChanged = "incident-state-changed",
  AddIncidentNote = "add-incident-note",
  ExecuteIncidentOnCallPolicy = "execute-incident-on-call-policy",
}

// Alert Actions
export enum MicrosoftTeamsAlertActionType {
  AckAlert = "ack-alert",
  ResolveAlert = "resolve-alert",
  ViewAlert = "view-alert",
  AlertCreated = "alert-created",
  AlertStateChanged = "alert-state-changed",
  AddAlertNote = "add-alert-note",
  ExecuteAlertOnCallPolicy = "execute-alert-on-call-policy",
}

// Monitor Actions
export enum MicrosoftTeamsMonitorActionType {
  ViewMonitor = "view-monitor",
  EnableMonitor = "enable-monitor",
  DisableMonitor = "disable-monitor",
  MonitorStatusChanged = "monitor-status-changed",
}

// Scheduled Maintenance Actions
export enum MicrosoftTeamsScheduledMaintenanceActionType {
  ViewScheduledMaintenance = "view-scheduled-maintenance",
  MarkAsComplete = "mark-scheduled-maintenance-complete",
  MarkAsOngoing = "mark-scheduled-maintenance-ongoing",
  ScheduledMaintenanceCreated = "scheduled-maintenance-created",
  ScheduledMaintenanceStateChanged = "scheduled-maintenance-state-changed",
  AddScheduledMaintenanceNote = "add-scheduled-maintenance-note",
}

// On-Call Duty Actions
export enum MicrosoftTeamsOnCallDutyActionType {
  ViewOnCallDuty = "view-on-call-duty",
  EscalateOnCall = "escalate-on-call",
  OnCallDutyPolicyTriggered = "on-call-duty-policy-triggered",
}

// General Actions
export enum MicrosoftTeamsGeneralActionType {
  Help = "help",
  ViewDashboard = "view-dashboard",
  ViewProject = "view-project",
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
