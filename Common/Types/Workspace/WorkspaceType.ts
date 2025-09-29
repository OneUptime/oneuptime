enum WorkspaceType {
  Slack = "Slack",
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
  return workspaceType;
}

export default WorkspaceType;
