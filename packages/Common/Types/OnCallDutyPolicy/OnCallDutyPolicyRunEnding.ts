/*
 * How an on-call policy run's execution log says why it ended.
 *
 * "Completed" is the status of a run that went through every escalation
 * rule with nobody acknowledging, and of one that stopped because its
 * incident, alert or episode was acknowledged or resolved first. What tells
 * them apart is the status message the run is given as it ends - the record
 * read later may have moved on since. The run's Slack and Microsoft Teams
 * message (OnCallPolicyRunMessage) reads it from here, and the worker that
 * ends runs (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions) writes
 * it from here.
 */

// A run that went through every escalation rule, and every repeat.
export const ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE: string =
  "Execution completed.";

// How the message of a run that stopped because its record was handled starts.
export const ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START: string =
  "Execution completed because ";

// "Execution completed because incident is acknowledged or resolved."
export function getOnCallPolicyRunRecordHandledMessage(
  recordKind: string,
): string {
  return `${ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START}${recordKind} is acknowledged or resolved.`;
}
