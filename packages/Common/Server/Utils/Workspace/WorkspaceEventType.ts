/*
 * The records Slack and Microsoft Teams buttons act on.
 *
 * In a file of its own that imports nothing, and that is load-bearing. It
 * was declared in WorkspaceMemberActions, which imports the incident,
 * alert, maintenance and on-call services, and through them the chats'
 * cards. Some of those modules read it while they load: the chats' record
 * titles (WorkspaceActionAnswers), the presses OneUptime finishes
 * (MicrosoftTeamsConnectPrompt), the approval a held note waits for
 * (WorkspaceHeldPublicNote). Loaded while WorkspaceMemberActions was still
 * loading them, they read it as undefined and threw ("Cannot read
 * properties of undefined (reading 'Incident')"), so whether they loaded at
 * all depended on which file a caller imported first. Read from here, it is
 * whole in any load order (WorkspaceEnumsLoadOrder). WorkspaceMemberActions
 * still exports it, taken from here before anything else it imports.
 */
export enum WorkspaceEventType {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
  IncidentEpisode = "IncidentEpisode",
  AlertEpisode = "AlertEpisode",
}
