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
  /*
   * The run did its job and concluded there was nothing to change — the agent
   * read the code and found no fix worth proposing, so it opened no pull
   * request. A negative result, NOT a failure: nothing broke, and retrying the
   * same run unchanged would likely reach the same conclusion. Kept distinct
   * from Error so a quiet "no fix" never lands in an error rate, an alert, or
   * a red pill. Contrast with Error, which means the run could not finish
   * (clone failed, LLM errored, no repository resolved).
   */
  NoFixFound = "NoFixFound",
  Error = "Error",
  Cancelled = "Cancelled",
  Stale = "Stale",
}

export default AIRunStatus;

export class AIRunStatusHelper {
  /*
   * The single source of truth for "this run is over". Database guards that
   * look for a still-live run spell the same set as
   * QueryHelper.notIn(terminalStatuses()) — hand-copied lists drift, and a
   * missing status here silently turns a finished run into a permanent
   * dedupe block.
   */
  public static terminalStatuses(): Array<AIRunStatus> {
    return [
      AIRunStatus.Completed,
      AIRunStatus.NoFixFound,
      AIRunStatus.Error,
      AIRunStatus.Cancelled,
      AIRunStatus.Stale,
    ];
  }

  public static isTerminalStatus(status: AIRunStatus): boolean {
    return AIRunStatusHelper.terminalStatuses().includes(status);
  }
}
