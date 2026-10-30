enum ComponentID {
  Webhook = "webhook",
  IncomingEmail = "incoming-email",
  // Huntress incident reports, as signed webhooks (Components/Huntress).
  HuntressIncidentReport = "huntress-incident-report",
  Log = "log",
  SlackSendMessageToChannel = "slack-send-message-to-channel",
  MicrosoftTeamsSendMessageToChannel = "microsoft-teams-send-message-to-channel",
  DiscordSendMessageToChannel = "discord-send-message-to-channel",
  TelegramSendMessageToChat = "telegram-send-message-to-chat",
  IRCSendMessageToChannel = "irc-send-message-to-channel",
  MattermostSendMessageToChannel = "mattermost-send-message-to-channel",
  Schedule = "schedule",
  JavaScriptCode = "javascript",
  // Run Custom JavaScript and an If / Else on what it returned, in one step.
  JavaScriptCheck = "javascript-check",
  Manual = "manual",
  JsonToText = "json-to-text",
  TextToJson = "text-to-json",
  MergeJson = "merge-json",
  ApiGet = "api-get",
  // One item by an ID from an earlier step, placed in the address safely.
  ApiGetById = "api-get-by-id",
  ApiPut = "api-put",
  ApiPost = "api-post",
  ApiDelete = "api-delete",
  ApiPatch = "api-patch",
  SendEmail = "send-email",
  IfElse = "if-else",
  Switch = "switch",
  WorkflowRun = "workflow-run",
  Sleep = "sleep",
  AIGenerateText = "ai-generate-text",
  /*
   * Open, acknowledge or resolve an incident or an alert for a problem in
   * another tool, or note on it, by that tool's ID (Components/FromAnotherTool).
   */
  IncidentFromAnotherTool = "incident-from-another-tool",
  AlertFromAnotherTool = "alert-from-another-tool",
  // Acknowledge, close or message a Zabbix problem (Components/Zabbix).
  ZabbixUpdateProblem = "zabbix-update-problem",
  // The Page steps (Components/OnCall).
  PageUsers = "page-users",
  PageTeam = "page-team",
  PageOnCall = "page-on-call",
  PageOnCallPolicy = "page-on-call-policy",
}

export default ComponentID;
