import Color from "../Color";
import { Blue, Gray500, Green, Red, Yellow } from "../BrandColors";

/*
 * Where a security case is in its life. Four steps, in order:
 *
 *  - New: nobody has looked at it yet. Every case starts here.
 *  - Investigating: someone is working out what happened.
 *  - Contained: the threat can no longer do harm, but the work is not done
 *    (cleanup, root cause, lessons). The time to reach it is how long an
 *    attacker had.
 *  - Closed: done, with a verdict on what it was.
 *
 * A case may skip ahead (a false positive goes straight from New to Closed)
 * and may be reopened. The timestamps each step stamps on the case are what
 * the overview's mean-time figures are measured from.
 */
enum SecurityCaseStatus {
  New = "New",
  Investigating = "Investigating",
  Contained = "Contained",
  Closed = "Closed",
}

export const SECURITY_CASE_STATUSES: ReadonlyArray<SecurityCaseStatus> = [
  SecurityCaseStatus.New,
  SecurityCaseStatus.Investigating,
  SecurityCaseStatus.Contained,
  SecurityCaseStatus.Closed,
];

// Every status but Closed: the case still needs somebody.
export const OPEN_SECURITY_CASE_STATUSES: ReadonlyArray<SecurityCaseStatus> = [
  SecurityCaseStatus.New,
  SecurityCaseStatus.Investigating,
  SecurityCaseStatus.Contained,
];

export function isSecurityCaseStatus(
  value: unknown,
): value is SecurityCaseStatus {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

export function isOpenSecurityCaseStatus(
  status: SecurityCaseStatus | string | undefined | null,
): boolean {
  return status !== SecurityCaseStatus.Closed;
}

export function getSecurityCaseStatusColor(
  status: SecurityCaseStatus | string | undefined | null,
): Color {
  switch (status) {
    case SecurityCaseStatus.New:
      return Red;
    case SecurityCaseStatus.Investigating:
      return Yellow;
    case SecurityCaseStatus.Contained:
      return Blue;
    case SecurityCaseStatus.Closed:
      return Green;
    default:
      return Gray500;
  }
}

export default SecurityCaseStatus;
