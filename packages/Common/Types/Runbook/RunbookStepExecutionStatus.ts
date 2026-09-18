enum RunbookStepExecutionStatus {
  Pending = "Pending",
  Running = "Running",
  WaitingForUser = "WaitingForUser",
  Completed = "Completed",
  Skipped = "Skipped",
  Failed = "Failed",
  Cancelled = "Cancelled",
}

export default RunbookStepExecutionStatus;
