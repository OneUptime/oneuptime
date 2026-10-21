enum WorkflowStatus {
  Scheduled = "Scheduled",
  Running = "Running",
  Waiting = "Waiting",
  Success = "Success",
  Error = "Error",
  Timeout = "Timeout",
  WorkflowCountExceeded = "Workflow Count Exceeded",
}

/*
 * A run's status in the words the dashboard shows it in. Two of them read
 * differently from their stored value: a run that worked is "Executed", and a
 * run the plan did not allow is "Execution Exceeded Current Plan". The status
 * pill and a downloaded run both read from here, so a log someone downloads
 * says what the list they downloaded it from said.
 */
const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  [WorkflowStatus.Scheduled]: "Scheduled",
  [WorkflowStatus.Running]: "Running",
  [WorkflowStatus.Waiting]: "Waiting",
  [WorkflowStatus.Success]: "Executed",
  [WorkflowStatus.Error]: "Error",
  [WorkflowStatus.Timeout]: "Timeout",
  [WorkflowStatus.WorkflowCountExceeded]: "Execution Exceeded Current Plan",
};

export const UNKNOWN_WORKFLOW_STATUS_LABEL: string = "Unknown";

export type GetWorkflowStatusLabelFunction = (
  status: WorkflowStatus | string | null | undefined,
) => string;

export const getWorkflowStatusLabel: GetWorkflowStatusLabelFunction = (
  status: WorkflowStatus | string | null | undefined,
): string => {
  if (!status) {
    return UNKNOWN_WORKFLOW_STATUS_LABEL;
  }

  return (
    WORKFLOW_STATUS_LABELS[status as WorkflowStatus] ||
    UNKNOWN_WORKFLOW_STATUS_LABEL
  );
};

export default WorkflowStatus;
