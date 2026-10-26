import {
  PrivateNoteReactionNames,
  PublicNoteReactionNames,
} from "../../../../../Types/Workspace/WorkspaceNoteReaction";

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
  /*
   * Opens the New Incident form: `/oneuptime incident [title]`, the Create
   * New Incident shortcut (whose callback id this is), and the /incident
   * command apps created from an older manifest still have
   * (SlackCommandParser).
   */
  NewIncident = "/incident",
  SubmitNewIncident = "SubmitNewIncident",

  /*
   * The incident's menu (⋯) - the actions fewer people need on every press
   * (WorkspaceIncidentActions) - each a form and its submission. Microsoft
   * Teams' card of the same message presses them by the same ids.
   */
  ViewChangeIncidentSeverity = "ViewChangeIncidentSeverity",
  SubmitChangeIncidentSeverity = "SubmitChangeIncidentSeverity",
  ViewAssignIncidentRole = "ViewAssignIncidentRole",
  SubmitAssignIncidentRole = "SubmitAssignIncidentRole",
  ViewPageAboutIncident = "ViewPageAboutIncident",
  SubmitPageAboutIncident = "SubmitPageAboutIncident",
  ViewEditIncidentCustomFields = "ViewEditIncidentCustomFields",
  SubmitEditIncidentCustomFields = "SubmitEditIncidentCustomFields",

  /*
   * `/oneuptime incident 42` (or #42, INC-42): the incident of that number,
   * with its buttons and menu, only to the person who ran it. Its value is
   * the number as typed.
   */
  ShowIncident = "ShowIncident",

  // Emoji Reaction Actions
  EmojiReactionAdded = "EmojiReactionAdded",

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

  // Alert Episode Actions
  AcknowledgeAlertEpisode = "AcknowledgeAlertEpisode",
  ResolveAlertEpisode = "ResolveAlertEpisode",
  ViewAddAlertEpisodeNote = "ViewAddAlertEpisodeNote",
  SubmitAlertEpisodeNote = "SubmitAlertEpisodeNote",
  ViewChangeAlertEpisodeState = "ViewChangeAlertEpisodeState",
  SubmitChangeAlertEpisodeState = "SubmitChangeAlertEpisodeState",
  ViewExecuteAlertEpisodeOnCallPolicy = "ViewExecuteAlertEpisodeOnCallPolicy",
  SubmitExecuteAlertEpisodeOnCallPolicy = "SubmitExecuteAlertEpisodeOnCallPolicy",
  ViewAlertEpisode = "ViewAlertEpisode",

  // Incident Episode Actions
  AcknowledgeIncidentEpisode = "AcknowledgeIncidentEpisode",
  ResolveIncidentEpisode = "ResolveIncidentEpisode",
  ViewAddIncidentEpisodeNote = "ViewAddIncidentEpisodeNote",
  SubmitIncidentEpisodeNote = "SubmitIncidentEpisodeNote",
  ViewChangeIncidentEpisodeState = "ViewChangeIncidentEpisodeState",
  SubmitChangeIncidentEpisodeState = "SubmitChangeIncidentEpisodeState",
  ViewExecuteIncidentEpisodeOnCallPolicy = "ViewExecuteIncidentEpisodeOnCallPolicy",
  SubmitExecuteIncidentEpisodeOnCallPolicy = "SubmitExecuteIncidentEpisodeOnCallPolicy",
  ViewIncidentEpisode = "ViewIncidentEpisode",

  // Scheduled Maintenance Actions just like Incident Actions.
  MarkScheduledMaintenanceAsComplete = "MarkScheduledMaintenanceAsComplete",
  MarkScheduledMaintenanceAsOngoing = "MarkScheduledMaintenanceAsOngoing",
  ViewAddScheduledMaintenanceNote = "ViewAddScheduledMaintenanceNote",
  SubmitScheduledMaintenanceNote = "SubmitScheduledMaintenanceNote",
  ViewChangeScheduledMaintenanceState = "ViewChangeScheduledMaintenanceState",
  SubmitChangeScheduledMaintenanceState = "SubmitChangeScheduledMaintenanceState",
  ViewScheduledMaintenance = "ViewScheduledMaintenance",
  /*
   * Opens the New Scheduled Maintenance form: `/oneuptime maintenance
   * [title]`, the Create Scheduled Event shortcut (whose callback id this
   * is), and an older app's /maintenance.
   */
  NewScheduledMaintenance = "/maintenance",
  SubmitNewScheduledMaintenance = "SubmitNewScheduledMaintenance",

  // Monitor Actions
  ViewMonitor = "ViewMonitor",

  // View on call policy.
  ViewOnCallPolicy = "ViewOnCallPolicy",

  // `/oneuptime oncall`: who is on call right now (SlackCommandActions).
  ShowOnCall = "ShowOnCall",

  /*
   * `/oneuptime page [who] [message]`: pages the people @mentioned at
   * once, or opens the Page someone form with what was typed filled in
   * (SlackPageActions). Its value is the command's text as Slack sent it,
   * people's ids and all.
   */
  PageSomeone = "PageSomeone",
  // The Page someone form, submitted.
  SubmitPageSomeone = "SubmitPageSomeone",

  /*
   * The Join call button of an incident or alert video call. It is a link
   * button - Slack opens the meeting itself - but Slack still reports the
   * click, which only has to be acknowledged.
   */
  JoinVideoCall = "JoinVideoCall",

  /*
   * The Connect button of an answer to somebody whose Slack account is not
   * connected yet (SlackConnectPrompt). A link button too: it opens their
   * settings page to connect, and the click Slack reports is acknowledged.
   */
  ConnectSlackAccount = "ConnectSlackAccount",

  /*
   * A link button to a page in OneUptime - the welcome's Set up
   * notifications. Slack opens the link and reports the click, which only
   * has to be acknowledged.
   */
  OpenInOneUptime = "OpenInOneUptime",

  /*
   * A project chosen for a request that could be about more than one of the
   * projects the workspace is connected to (SlackProjectChoice): the request
   * is made again in it. Each button's action id is this, a colon and its
   * place among the buttons, since Slack takes one action id once in a
   * block; its value names the project and the recorded request.
   */
  ChooseProject = "ChooseProject",
}

// Emoji names that trigger saving a message as a Private Note (Internal Note)
export const PrivateNoteEmojis: string[] = PrivateNoteReactionNames;

// Emoji names that trigger saving a message as a Public Note
export const PublicNoteEmojis: string[] = PublicNoteReactionNames;

export default SlackActionType;
