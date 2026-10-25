/*
 * WHAT A CASE'S STATUS COUNTS AS.
 *
 * A project's case statuses are its own (SecurityCaseStatus: renamed,
 * recoloured, reordered, its own added - "Triage", "Eradicating",
 * "Closed - Duplicate"), but OneUptime reads four things off a case's
 * status, and each status counts as one of them by where it sits in the
 * project's list (Common/Utils/SecurityCase/SecurityCaseStatuses):
 *
 *  - New: nobody has taken the case on yet. Every case starts in the new
 *    status; a status of the project's own above the acknowledged one (a
 *    "Queued") counts as New too.
 *  - Acknowledged: someone is on it. From the acknowledged status down
 *    ("Investigating" in a new project) - and reaching it first records when
 *    the case was acknowledged, which the time to acknowledge measures.
 *  - Contained: the threat can no longer do harm. From the contained status
 *    down; reaching it first records the time to contain.
 *  - Closed: done, with a verdict. From the closed status down; a closed case
 *    leaves the open lists, and the time to close is measured to it.
 *
 * A case may skip a stage (a false positive goes straight from New to
 * Closed) and may be reopened; the stages only say what a status counts as.
 */
enum SecurityCaseStage {
  New = "New",
  Acknowledged = "Acknowledged",
  Contained = "Contained",
  Closed = "Closed",
}

// In the order a case comes through them.
export const SECURITY_CASE_STAGES: ReadonlyArray<SecurityCaseStage> = [
  SecurityCaseStage.New,
  SecurityCaseStage.Acknowledged,
  SecurityCaseStage.Contained,
  SecurityCaseStage.Closed,
];

/*
 * The column that marks a project's status as the one each stage starts at
 * (SecurityCaseStatus.isNewStatus, ...): the meaning OneUptime reads, never
 * the name. It is also where OneUptime moves a case by itself: a new case
 * to the new status, a reopened one to the acknowledged status, Close Case
 * to the closed status.
 */
export const SECURITY_CASE_STAGE_FLAGS: Readonly<
  Record<SecurityCaseStage, string>
> = {
  [SecurityCaseStage.New]: "isNewStatus",
  [SecurityCaseStage.Acknowledged]: "isAcknowledgedStatus",
  [SecurityCaseStage.Contained]: "isContainedStatus",
  [SecurityCaseStage.Closed]: "isClosedStatus",
};

export function isSecurityCaseStage(
  value: unknown,
): value is SecurityCaseStage {
  return (
    typeof value === "string" &&
    (SECURITY_CASE_STAGES as ReadonlyArray<string>).includes(value)
  );
}

// The stage a built-in flag starts, or undefined for any other column.
export function getSecurityCaseStageOfFlag(
  flag: string | undefined | null,
): SecurityCaseStage | undefined {
  return SECURITY_CASE_STAGES.find((stage: SecurityCaseStage): boolean => {
    return SECURITY_CASE_STAGE_FLAGS[stage] === flag;
  });
}

export default SecurityCaseStage;
