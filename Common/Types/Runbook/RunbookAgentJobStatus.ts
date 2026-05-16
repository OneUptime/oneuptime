enum RunbookAgentJobStatus {
  // Inserted by the Worker. No agent has claimed it yet.
  Pending = "Pending",
  // An agent has atomically claimed the job and is preparing to execute it.
  Claimed = "Claimed",
  // The agent has started executing the script.
  Running = "Running",
  // The script finished with exit code 0.
  Succeeded = "Succeeded",
  // The script finished with a non-zero exit code, or the agent reported an error.
  Failed = "Failed",
  /*
   * The Worker waited longer than claimTimeoutMs and no agent picked it up,
   * or the agent's lease lapsed mid-execution.
   */
  TimedOut = "TimedOut",
  // The owning runbook execution was cancelled before the agent finished.
  Cancelled = "Cancelled",
}

export default RunbookAgentJobStatus;
