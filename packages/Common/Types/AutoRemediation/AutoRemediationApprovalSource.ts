import WorkspaceType from "../Workspace/WorkspaceType";

/*
 * WHERE A PERSON APPROVED A FIX ONEUPTIME AI PROPOSED.
 *
 * A fix that waits for approval is approved on the AI card's Approve & Run,
 * or from its message in the incident's or alert's Slack and Microsoft
 * Teams channels (RemediationApproval.approve, which both reach). The
 * suggestion keeps where (AutoRemediationSuggestion.approvedFrom), so the
 * Remediation step says it beside who approved the fix, and AI Insights
 * says where a team approves the fixes OneUptime AI proposes. A fix approved
 * before this was kept says nothing of where.
 */
enum AutoRemediationApprovalSource {
  // The AI card's Approve & Run, in OneUptime (or the same API route).
  Dashboard = "Dashboard",
  Slack = "Slack",
  MicrosoftTeams = "MicrosoftTeams",
}

// Where an approval made from `from` (a chat, or the card when none) was made.
export function getRemediationApprovalSource(
  from: WorkspaceType | undefined,
): AutoRemediationApprovalSource {
  if (from === WorkspaceType.Slack) {
    return AutoRemediationApprovalSource.Slack;
  }

  if (from === WorkspaceType.MicrosoftTeams) {
    return AutoRemediationApprovalSource.MicrosoftTeams;
  }

  return AutoRemediationApprovalSource.Dashboard;
}

// A stored value, when it is one of the sources; undefined for anything else.
export function readRemediationApprovalSource(
  value: unknown,
): AutoRemediationApprovalSource | undefined {
  return Object.values(AutoRemediationApprovalSource).includes(
    value as AutoRemediationApprovalSource,
  )
    ? (value as AutoRemediationApprovalSource)
    : undefined;
}

// Whether a fix was approved from a chat rather than on the AI card.
export function isRemediationApprovedFromChat(
  source: AutoRemediationApprovalSource | undefined,
): boolean {
  return (
    source === AutoRemediationApprovalSource.Slack ||
    source === AutoRemediationApprovalSource.MicrosoftTeams
  );
}

export default AutoRemediationApprovalSource;
