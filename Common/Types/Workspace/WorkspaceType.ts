enum WorkspaceType {
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
}

export const getWorkspaceTypeDisplayName = (
  workspaceType: WorkspaceType,
): string => {
  if (workspaceType === WorkspaceType.MicrosoftTeams) {
    return "Microsoft Teams";
  }

  if (workspaceType === WorkspaceType.Slack) {
    return "Slack";
  }
  return workspaceType;
};

export default WorkspaceType;
