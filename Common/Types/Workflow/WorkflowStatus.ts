enum WorkflowStatus {
  Scheduled = "Scheduled",
  Running = "Running",
  Success = "Success",
  Error = "Error",
  Timeout = "Timeout",
  Waiting = "Waiting",
  WorkflowCountExceeded = "Workflow Count Exceeded",
}

export default WorkflowStatus;
