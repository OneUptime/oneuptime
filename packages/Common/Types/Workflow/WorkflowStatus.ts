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
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here
 * so this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * A run's status in the words the dashboard shows it in. Two of them read
 * differently from their stored value: a run that worked is "Executed", and a
 * run the plan did not allow is "Execution Exceeded Current Plan". The status
 * pill, the runs' Status filter and a downloaded run all read from here, so a
 * log someone downloads says what the list they downloaded it from said. Each
 * is a key of the Dashboard's locales (its extractor reads this file as a
 * "keys" root): the pill and the filter look it up in the reader's language,
 * while a downloaded run keeps the English.
 */
const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  [WorkflowStatus.Scheduled]: translationKey("Scheduled"),
  [WorkflowStatus.Running]: translationKey("Running"),
  [WorkflowStatus.Waiting]: translationKey("Waiting"),
  [WorkflowStatus.Success]: translationKey("Executed"),
  [WorkflowStatus.Error]: translationKey("Error"),
  [WorkflowStatus.Timeout]: translationKey("Timeout"),
  [WorkflowStatus.WorkflowCountExceeded]: translationKey(
    "Execution Exceeded Current Plan",
  ),
};

export const UNKNOWN_WORKFLOW_STATUS_LABEL: string = translationKey("Unknown");

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
