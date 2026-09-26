enum WorkspaceType {
  Slack = "Slack",
  Discord = "Discord",
  MicrosoftTeams = "MicrosoftTeams",
}

export function getWorkspaceTypeDisplayName(
  workspaceType: WorkspaceType,
): string {
  if (workspaceType === WorkspaceType.MicrosoftTeams) {
    return "Microsoft Teams";
  }

  if (workspaceType === WorkspaceType.Slack) {
    return "Slack";
  }

  if (workspaceType === WorkspaceType.Discord) {
    return "Discord";
  }
  return workspaceType;
}

export default WorkspaceType;
