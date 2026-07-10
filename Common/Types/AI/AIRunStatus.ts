enum AIRunStatus {
  /*
   * Durable intent: the run has been recorded but no worker has claimed it
   * yet. Queued runs survive pod restarts — the enqueueing pod tries to
   * process immediately, and the queue poller picks up whatever is left
   * (claims are CAS-guarded, so double-processing is impossible). Not
   * terminal, not consuming compute; the queue's own TTL expires runs that
   * sit here too long to still be useful.
   */
  Queued = "Queued",
  Running = "Running",
  /*
   * The run paused mid-turn to wait for the user to approve pending tool
   * actions (see AIChatPermissionMode.AskForApproval). It is not terminal — it
   * resumes when the user responds — but it is also not actively consuming
   * compute, so the stale-run sweeper (which only touches Running runs) leaves
   * it alone.
   */
  WaitingForApproval = "WaitingForApproval",
  Completed = "Completed",
  Error = "Error",
  Cancelled = "Cancelled",
  Stale = "Stale",
}

export default AIRunStatus;

export class AIRunStatusHelper {
  public static isTerminalStatus(status: AIRunStatus): boolean {
    return (
      status === AIRunStatus.Completed ||
      status === AIRunStatus.Error ||
      status === AIRunStatus.Cancelled ||
      status === AIRunStatus.Stale
    );
  }
}
