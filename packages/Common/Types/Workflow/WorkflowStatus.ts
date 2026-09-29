enum WorkflowStatus {
  Scheduled = "Scheduled",
  Running = "Running",
  Waiting = "Waiting",
  Success = "Success",
  Error = "Error",
  Timeout = "Timeout",
  WorkflowCountExceeded = "Workflow Count Exceeded",
}

export default WorkflowStatus;
