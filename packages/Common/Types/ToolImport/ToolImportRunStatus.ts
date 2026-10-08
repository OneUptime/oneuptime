/*
 * Where an import from another tool is. The value is stored on
 * ToolImportRun.status.
 *
 *   Reading        a worker reads the other tool with the key, then forgets
 *                  the key;
 *   ReadyToReview  the preview is ready: nothing has been created yet;
 *   Importing      a worker creates what the person ticked;
 *   Completed      done, with a report of what was created and skipped;
 *   Failed         the read or the import stopped (the reason is kept);
 *   Cancelled      the person discarded the preview;
 *   Expired        the preview was never started, and is too old to trust.
 */
enum ToolImportRunStatus {
  Reading = "Reading",
  ReadyToReview = "ReadyToReview",
  Importing = "Importing",
  Completed = "Completed",
  Failed = "Failed",
  Cancelled = "Cancelled",
  Expired = "Expired",
}

export default ToolImportRunStatus;

// A worker is on it: the page keeps polling, and no second one may start.
export const ActiveToolImportRunStatuses: Array<ToolImportRunStatus> = [
  ToolImportRunStatus.Reading,
  ToolImportRunStatus.Importing,
];

// Nothing more will happen to the run.
export const FinishedToolImportRunStatuses: Array<ToolImportRunStatus> = [
  ToolImportRunStatus.Completed,
  ToolImportRunStatus.Failed,
  ToolImportRunStatus.Cancelled,
  ToolImportRunStatus.Expired,
];

export function isToolImportRunStatus(
  value: unknown,
): value is ToolImportRunStatus {
  return (
    typeof value === "string" &&
    (Object.values(ToolImportRunStatus) as Array<string>).includes(value)
  );
}

export function isActiveToolImportRunStatus(
  status: ToolImportRunStatus | undefined | null,
): boolean {
  return Boolean(status && ActiveToolImportRunStatuses.includes(status));
}
