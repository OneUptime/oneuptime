import WorkingHours from "./WorkingHours";

/*
 * A RUN THAT WAITS TO PAGE, AND HOW IT SAYS SO.
 *
 * An on-call policy's run can be held: it is created waiting
 * (OnCallDutyPolicyStatus.Waiting) with the moment it starts paging
 * (OnCallDutyPolicyExecutionLog.pagingStartsAt), pages nobody until then, and
 * is started at its first escalation rule when that moment comes
 * (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions). An on-call rule
 * that pages only during working hours holds the runs it starts outside them
 * (OnCallRuleWhenToPage); OnCallDutyPolicyService.executePolicy holds a run
 * for any caller that names the moment.
 *
 * Acknowledged or resolved while it waits, the record needs nobody paged: the
 * run ends there, paging nobody. An archived policy pages no one: its run
 * ends there too, saying so (OnCallDutyPolicyArchive).
 *
 * The run's status message says why it waits and when it pages - the words
 * its record's feed, its Slack and Microsoft Teams message and the Execution
 * Logs table show - and, once it ended without paging, why. Those readers
 * tell the messages apart by how they start, as they do the messages of a
 * run that ended (OnCallDutyPolicyRunEnding).
 */

// "Waiting for working hours. Paging starts Wed 09:00 (Europe/London)."
export const ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START: string =
  "Waiting for working hours. ";

// A run that waits for any other reason: "Waiting. Paging starts Wed 09:00 (UTC)."
export const ON_CALL_POLICY_RUN_WAITING_MESSAGE_START: string = "Waiting. ";

export function getOnCallPolicyRunWaitingMessage(data: {
  pagingStartsAt: Date;
  // The zone the moment is told in: the rule's. UTC without one.
  timezone?: string | undefined;
  // When the message is written: a moment a week or more away names its date.
  now: Date;
  isWaitingForWorkingHours: boolean;
}): string {
  const start: string = data.isWaitingForWorkingHours
    ? ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START
    : ON_CALL_POLICY_RUN_WAITING_MESSAGE_START;

  return `${start}Paging starts ${WorkingHours.describeMoment({
    at: data.pagingStartsAt,
    timezone: data.timezone,
    now: data.now,
  })}.`;
}

// Whether a waiting run's message says it waits for working hours.
export function isOnCallPolicyRunWaitingForWorkingHours(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_POLICY_RUN_WAITING_FOR_WORKING_HOURS_MESSAGE_START,
  );
}

/*
 * How the message of a run that ended while it waited, because its record
 * was handled, starts. Not "Execution completed because ...": that is a run
 * that stopped paging (OnCallDutyPolicyRunEnding), and this one never began.
 */
export const ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START: string =
  "Execution completed without paging because ";

// "Execution completed without paging because alert is acknowledged or resolved."
export function getOnCallPolicyRunEndedWhileWaitingMessage(
  recordKind: string,
): string {
  return `${ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START}${recordKind} is acknowledged or resolved.`;
}

export function isOnCallPolicyRunEndedWhileWaiting(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_POLICY_RUN_ENDED_WHILE_WAITING_MESSAGE_START,
  );
}
