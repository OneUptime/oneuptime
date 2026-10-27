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
  /*
   * The incident card's menu (…), pressed by Slack's ids: the card is drawn
   * from the Slack message's blocks (WorkspaceIncidentActions).
   */
  ViewChangeIncidentSeverity = "ViewChangeIncidentSeverity",
  SubmitChangeIncidentSeverity = "SubmitChangeIncidentSeverity",
  ViewAssignIncidentRole = "ViewAssignIncidentRole",
  SubmitAssignIncidentRole = "SubmitAssignIncidentRole",
  ViewPageAboutIncident = "ViewPageAboutIncident",
  SubmitPageAboutIncident = "SubmitPageAboutIncident",
  ViewEditIncidentCustomFields = "ViewEditIncidentCustomFields",
  SubmitEditIncidentCustomFields = "SubmitEditIncidentCustomFields",
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

// Alert Episode Actions
export enum MicrosoftTeamsAlertEpisodeActionType {
  AckAlertEpisode = "AckAlertEpisode",
  ResolveAlertEpisode = "ResolveAlertEpisode",
  ViewAlertEpisode = "ViewAlertEpisode",
  AlertEpisodeCreated = "AlertEpisodeCreated",
  AlertEpisodeStateChanged = "AlertEpisodeStateChanged",
  AddAlertEpisodeNote = "AddAlertEpisodeNote",
  ExecuteAlertEpisodeOnCallPolicy = "ExecuteAlertEpisodeOnCallPolicy",
  ViewAddAlertEpisodeNote = "ViewAddAlertEpisodeNote",
  SubmitAlertEpisodeNote = "SubmitAlertEpisodeNote",
  ViewExecuteAlertEpisodeOnCallPolicy = "ViewExecuteAlertEpisodeOnCallPolicy",
  SubmitExecuteAlertEpisodeOnCallPolicy = "SubmitExecuteAlertEpisodeOnCallPolicy",
  ViewChangeAlertEpisodeState = "ViewChangeAlertEpisodeState",
  SubmitChangeAlertEpisodeState = "SubmitChangeAlertEpisodeState",
}

// Incident Episode Actions
export enum MicrosoftTeamsIncidentEpisodeActionType {
  AckIncidentEpisode = "AckIncidentEpisode",
  ResolveIncidentEpisode = "ResolveIncidentEpisode",
  ViewIncidentEpisode = "ViewIncidentEpisode",
  IncidentEpisodeCreated = "IncidentEpisodeCreated",
  IncidentEpisodeStateChanged = "IncidentEpisodeStateChanged",
  AddIncidentEpisodeNote = "AddIncidentEpisodeNote",
  ExecuteIncidentEpisodeOnCallPolicy = "ExecuteIncidentEpisodeOnCallPolicy",
  ViewAddIncidentEpisodeNote = "ViewAddIncidentEpisodeNote",
  SubmitIncidentEpisodeNote = "SubmitIncidentEpisodeNote",
  ViewExecuteIncidentEpisodeOnCallPolicy = "ViewExecuteIncidentEpisodeOnCallPolicy",
  SubmitExecuteIncidentEpisodeOnCallPolicy = "SubmitExecuteIncidentEpisodeOnCallPolicy",
  ViewChangeIncidentEpisodeState = "ViewChangeIncidentEpisodeState",
  SubmitChangeIncidentEpisodeState = "SubmitChangeIncidentEpisodeState",
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

/*
 * "page [who] [message]" typed to the bot opens the Page someone card when
 * it cannot page at once (MicrosoftTeamsPage); this is the card, submitted.
 */
export enum MicrosoftTeamsPageActionType {
  SubmitPageSomeone = "SubmitPageSomeone",
}

/*
 * Which project a request is for, in a Microsoft 365 organization connected
 * to more than one: a button for each project the person is in, which
 * makes the request again there (MicrosoftTeamsProjectChoice).
 */
export enum MicrosoftTeamsProjectChoiceActionType {
  ChooseProject = "choose-project",
}

// General Actions
export enum MicrosoftTeamsGeneralActionType {
  Help = "Help",
  ViewDashboard = "ViewDashboard",
  ViewProject = "ViewProject",
}

/*
 * The words typed to the bot - "incident [title]", "oncall", "help" - are
 * Slack's words after /oneuptime too: WorkspaceCommands reads them for both,
 * and MicrosoftTeamsCommands has the lists only Teams has.
 */

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
  | MicrosoftTeamsAlertEpisodeActionType
  | MicrosoftTeamsIncidentEpisodeActionType
  | MicrosoftTeamsMonitorActionType
  | MicrosoftTeamsScheduledMaintenanceActionType
  | MicrosoftTeamsOnCallDutyActionType
  | MicrosoftTeamsPageActionType
  | MicrosoftTeamsProjectChoiceActionType
  | MicrosoftTeamsGeneralActionType;

/*
 * The buttons of the cards OneUptime posts to Microsoft Teams are built from
 * the same blocks as its Slack messages (WorkspaceMessages), so they carry
 * Slack's action ids. Most are the Microsoft Teams ids too. These five are
 * not, and no Teams handler took them: Acknowledge on an alert or an
 * episode, and Mark as Ongoing and Mark as Completed on a scheduled
 * maintenance event, were pressed and nothing happened. Each is read as the
 * Teams action it is.
 */
const SLACK_BUTTON_ACTION_TYPES: ReadonlyMap<string, MicrosoftTeamsActionType> =
  new Map<string, MicrosoftTeamsActionType>([
    ["AcknowledgeAlert", MicrosoftTeamsAlertActionType.AckAlert],
    [
      "AcknowledgeAlertEpisode",
      MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode,
    ],
    [
      "AcknowledgeIncidentEpisode",
      MicrosoftTeamsIncidentEpisodeActionType.AckIncidentEpisode,
    ],
    [
      "MarkScheduledMaintenanceAsOngoing",
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
    ],
    [
      "MarkScheduledMaintenanceAsComplete",
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsComplete,
    ],
  ]);

// The Microsoft Teams action a card's button names, Slack's id or Teams'.
export const getMicrosoftTeamsActionType: (
  actionType: string,
) => MicrosoftTeamsActionType = (
  actionType: string,
): MicrosoftTeamsActionType => {
  return (
    SLACK_BUTTON_ACTION_TYPES.get(actionType) ||
    (actionType as MicrosoftTeamsActionType)
  );
};

export default MicrosoftTeamsActionType;
