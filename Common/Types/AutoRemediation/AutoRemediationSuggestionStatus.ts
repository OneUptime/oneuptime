/*
 * Lifecycle of an auto-remediation suggestion — the approvable action
 * object a matched rule attaches to an incident or alert.
 *
 * Planning:       an AI planning run is choosing the best runbook.
 * Suggested:      a runbook is proposed; waiting for one-click approval.
 * Approved:       a human approved it and the runbook execution started.
 * AutoExecuted:   a FullAuto rule started the runbook with no human in the loop.
 * Dismissed:      a human rejected the proposal.
 * NoneApplicable: the AI judged that no candidate runbook applies.
 */
enum AutoRemediationSuggestionStatus {
  Planning = "Planning",
  Suggested = "Suggested",
  Approved = "Approved",
  AutoExecuted = "AutoExecuted",
  Dismissed = "Dismissed",
  NoneApplicable = "NoneApplicable",
}

export default AutoRemediationSuggestionStatus;

export class AutoRemediationSuggestionStatusHelper {
  // Terminal suggestions never change again; open ones can still be actioned.
  public static isTerminalStatus(
    status: AutoRemediationSuggestionStatus,
  ): boolean {
    return (
      status === AutoRemediationSuggestionStatus.Approved ||
      status === AutoRemediationSuggestionStatus.AutoExecuted ||
      status === AutoRemediationSuggestionStatus.Dismissed ||
      status === AutoRemediationSuggestionStatus.NoneApplicable
    );
  }
}
