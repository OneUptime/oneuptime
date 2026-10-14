/*
 * What a list of open records in Slack or Microsoft Teams lists
 * (Server/Utils/Workspace/WorkspaceOpenRecords). A type of its own, with no
 * imports, so the chats' command tables can name a list without loading the
 * services that read it.
 */
enum WorkspaceOpenRecordKind {
  Incidents = "Incidents",
  Alerts = "Alerts",
  UpcomingMaintenance = "UpcomingMaintenance",
  OngoingMaintenance = "OngoingMaintenance",
}

export default WorkspaceOpenRecordKind;
