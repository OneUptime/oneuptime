/*
 * WHERE AN ISSUE STANDS.
 *
 *  - Open: its check fails on the store now.
 *  - Resolved: its check passed on a later run. A person marking it
 *    resolved asks for that run; it opens again if the check still fails.
 *  - Accepted: a person accepted the risk, with a reason and an expiry
 *    date, after which it is Open again if the check still fails.
 *  - Not an issue: the finding was wrong. It stays closed, and the data
 *    type or check it came from is tuned for the project.
 */
enum DataSecurityIssueStatus {
  Open = "Open",
  Resolved = "Resolved",
  Accepted = "Accepted",
  NotAnIssue = "Not an issue",
}

export default DataSecurityIssueStatus;

export const ALL_DATA_SECURITY_ISSUE_STATUSES: ReadonlyArray<DataSecurityIssueStatus> =
  [
    DataSecurityIssueStatus.Open,
    DataSecurityIssueStatus.Accepted,
    DataSecurityIssueStatus.Resolved,
    DataSecurityIssueStatus.NotAnIssue,
  ];

// Statuses that count as needing attention.
export function isActiveIssueStatus(status: string | undefined): boolean {
  return status === DataSecurityIssueStatus.Open;
}

export function isDataSecurityIssueStatus(
  value: unknown,
): value is DataSecurityIssueStatus {
  return (
    typeof value === "string" &&
    (ALL_DATA_SECURITY_ISSUE_STATUSES as ReadonlyArray<string>).includes(value)
  );
}
