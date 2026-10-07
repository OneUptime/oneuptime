enum WorkspaceNotificationActionType {
  SendMessage = "SendMessage",
  CreateChannel = "CreateChannel",
  InviteUser = "InviteUser",
  ButtonPressed = "ButtonPressed",
  // An incident or alert video call started (or failed to start) by a rule.
  StartVideoCall = "StartVideoCall",
}

export default WorkspaceNotificationActionType;
