enum AIRemediationActionStatus {
  /*
   * Drafted by the remediation proposer and waiting for a decision. Not
   * terminal, not consuming anything. Proposals that sit here past their
   * expiresAt are swept to Expired — an hours-old remediation for a live
   * incident is stale advice, and acting on it would be worse than doing
   * nothing.
   */
  Proposed = "Proposed",
  /*
   * A human approved it (or the policy gate auto-approved a runbook action on
   * a non-production agent) but execution has not started yet. Transient:
   * the executor moves it to Executing in the same breath unless a budget
   * refusal parks it here with an errorMessage explaining why.
   */
  Approved = "Approved",
  // A human explicitly declined it. Terminal.
  Rejected = "Rejected",
  // Dispatched to the runbook substrate; a RunbookExecution is in flight.
  Executing = "Executing",
  // The linked RunbookExecution completed. Terminal.
  Succeeded = "Succeeded",
  // The linked RunbookExecution failed or was cancelled. Terminal.
  Failed = "Failed",
  /*
   * Nobody decided within the proposal TTL. Terminal. Kept distinct from
   * Rejected so "the team declined this" and "this went stale" never blur
   * in the precision measurements.
   */
  Expired = "Expired",
}

export default AIRemediationActionStatus;

export class AIRemediationActionStatusHelper {
  public static isTerminalStatus(status: AIRemediationActionStatus): boolean {
    return (
      status === AIRemediationActionStatus.Rejected ||
      status === AIRemediationActionStatus.Succeeded ||
      status === AIRemediationActionStatus.Failed ||
      status === AIRemediationActionStatus.Expired
    );
  }
}
