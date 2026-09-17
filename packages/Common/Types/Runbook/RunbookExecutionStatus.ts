enum RunbookExecutionStatus {
  Scheduled = "Scheduled",
  Running = "Running",
  WaitingForManualStep = "WaitingForManualStep",
  Completed = "Completed",
  Failed = "Failed",
  Cancelled = "Cancelled",
}

export default RunbookExecutionStatus;
