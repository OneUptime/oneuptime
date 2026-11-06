enum WorkspaceType {
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
  Mattermost = "Mattermost",
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

  if (workspaceType === WorkspaceType.Mattermost) {
    return "Mattermost";
  }

  return workspaceType;
}

export default WorkspaceType;
