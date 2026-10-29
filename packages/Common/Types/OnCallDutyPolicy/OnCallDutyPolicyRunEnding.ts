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

/*
 * A run that ended because everybody it paged escalated the page
 * (OnCallPagePassOn): nobody was left to page, and nobody took it. Its Slack
 * and Microsoft Teams message says nobody could take the record, and its
 * feed says why paging stopped.
 */
export const ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE: string =
  "Execution completed: everybody it paged escalated it.";

/*
 * The same ending as runs wrote it before the action was renamed from "Pass
 * it on" to Escalate. Those runs keep their message; it is read the same.
 */
export const LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE: string =
  "Execution completed: everybody it paged passed it on.";

// Whether a run ended because everybody it paged escalated - in either words.
export function isOnCallPolicyRunEverybodyPassedOnMessage(
  message: string | undefined | null,
): boolean {
  const trimmed: string = (message || "").trim();

  return (
    trimmed === ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE ||
    trimmed === LEGACY_ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE
  );
}

/*
 * A RUN THAT PAGED NOBODY AT ALL: no escalation rule of its policy had
 * anybody it could page - no responders, empty teams, nobody on call,
 * everybody away, gone or unreachable. Such a run stops as soon as it has
 * gone through its rules, since every rule that pages nobody is passed at
 * once (OnCallEmptyLevel), and it ends as "Completed - No One Notified".
 *
 * Its message says who can put it right: the people who look after the
 * policy - its owners, who are also the ones emailed about a page that
 * could not be delivered. The record's feed says the second sentence alone
 * after its own (OnCallFeedText): "went through every escalation rule and
 * paged nobody" is the first.
 */
export const ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_FIX: string =
  "This policy's owners should add responders to its escalation rules, or check who is on call in its schedules.";

export const ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE: string = `Execution completed, but no one was notified: no escalation rule of this policy had anybody to page. ${ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_FIX}`;

// The same ending as runs wrote it before it said who can put it right.
export const LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE: string =
  "Execution completed, but no one was notified. Every escalation rule in this policy reached no one - usually because the on-call schedules it targets had nobody on call.";

// Whether a run ended having paged nobody at all - in either words.
export function isOnCallPolicyRunNobodyNotifiedMessage(
  message: string | undefined | null,
): boolean {
  const trimmed: string = (message || "").trim();

  return (
    trimmed === ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE ||
    trimmed === LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE
  );
}

// How the message of a run that stopped because its record was handled starts.
export const ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START: string =
  "Execution completed because ";

// "Execution completed because incident is acknowledged or resolved."
export function getOnCallPolicyRunRecordHandledMessage(
  recordKind: string,
): string {
  return `${ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START}${recordKind} is acknowledged or resolved.`;
}

/*
 * "Execution completed because incident is resolved." - how a page again
 * ends when its record is resolved (OnCallAcknowledgementTimeout). Its
 * record was acknowledged all along, so "acknowledged or resolved" would not
 * say why it stopped. It starts as every handled ending does, so the feed
 * and the run's chat message read it the same way.
 */
export function getOnCallPolicyRunRecordResolvedMessage(
  recordKind: string,
): string {
  return `${ON_CALL_POLICY_RUN_RECORD_HANDLED_MESSAGE_START}${recordKind} is resolved.`;
}
