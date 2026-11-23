import Color from "../Color";
import { Blue, Gray500, Green, Red, Yellow } from "../BrandColors";

/*
 * A playbook run's state. Queued and Running are the engine's; Waiting for
 * Approval means a step marked "needs approval" is holding the run until a
 * person approves or rejects it on the case. Waiting for OneUptime AI means
 * a Page On-Call step waits while OneUptime AI responds first to the case
 * (#10353, SecurityCaseAiHold): once the hold ends the run carries on, and
 * the step pages - or is skipped, when OneUptime AI resolved the case or a
 * person took it. The last three are final.
 */
enum SecurityPlaybookRunStatus {
  Queued = "Queued",
  Running = "Running",
  WaitingForApproval = "Waiting for Approval",
  WaitingForOneUptimeAi = "Waiting for OneUptime AI",
  Succeeded = "Succeeded",
  Failed = "Failed",
  Cancelled = "Cancelled",
}

export const FINISHED_SECURITY_PLAYBOOK_RUN_STATUSES: ReadonlyArray<SecurityPlaybookRunStatus> =
  [
    SecurityPlaybookRunStatus.Succeeded,
    SecurityPlaybookRunStatus.Failed,
    SecurityPlaybookRunStatus.Cancelled,
  ];

export function isFinishedSecurityPlaybookRunStatus(
  status: SecurityPlaybookRunStatus | string | undefined | null,
): boolean {
  return (
    FINISHED_SECURITY_PLAYBOOK_RUN_STATUSES as ReadonlyArray<string>
  ).includes(status || "");
}

export function getSecurityPlaybookRunStatusColor(
  status: SecurityPlaybookRunStatus | string | undefined | null,
): Color {
  switch (status) {
    case SecurityPlaybookRunStatus.Succeeded:
      return Green;
    case SecurityPlaybookRunStatus.Failed:
      return Red;
    case SecurityPlaybookRunStatus.WaitingForApproval:
      return Yellow;
    case SecurityPlaybookRunStatus.Running:
    case SecurityPlaybookRunStatus.Queued:
    case SecurityPlaybookRunStatus.WaitingForOneUptimeAi:
      return Blue;
    default:
      return Gray500;
  }
}

/*
 * One step's state inside a run. Skipped: its "only if" condition did not
 * hold. Rejected: a person turned down its approval, which ends the run.
 * Waiting for OneUptime AI: a Page On-Call step held while OneUptime AI
 * responds first to the case (#10353).
 */
export enum SecurityPlaybookStepStatus {
  Pending = "Pending",
  Running = "Running",
  WaitingForApproval = "Waiting for Approval",
  WaitingForOneUptimeAi = "Waiting for OneUptime AI",
  Succeeded = "Succeeded",
  Failed = "Failed",
  Skipped = "Skipped",
  Rejected = "Rejected",
}

export function getSecurityPlaybookStepStatusColor(
  status: SecurityPlaybookStepStatus | string | undefined | null,
): Color {
  switch (status) {
    case SecurityPlaybookStepStatus.Succeeded:
      return Green;
    case SecurityPlaybookStepStatus.Failed:
    case SecurityPlaybookStepStatus.Rejected:
      return Red;
    case SecurityPlaybookStepStatus.WaitingForApproval:
      return Yellow;
    case SecurityPlaybookStepStatus.Running:
    case SecurityPlaybookStepStatus.WaitingForOneUptimeAi:
      return Blue;
    default:
      return Gray500;
  }
}

export default SecurityPlaybookRunStatus;
