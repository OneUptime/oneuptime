/*
 * WHAT AN ON-CALL RUN, AND A PERSON'S PAGE, SAY AS THEY START (#8434).
 *
 * A run of an on-call policy - or a direct page, a test page, a page again
 * - is written Scheduled, then Started, then handed to its escalation, and
 * its status message says which, in English, for every reader. A person's
 * page (UserOnCallLog) the same. The worker that times out a run or a page
 * that did not finish starting (OnCallDutyPolicyExecutionLog and
 * UserOnCallLog:TimeoutStuckExecutions) says so in its message too.
 *
 * The writers write these lines from here, and the on-call logs read them
 * back into codes (OnCallLogLine) to word them in the reader's language:
 * the same words, so a line written before this file is read the same.
 *
 * React-free and server-safe.
 */

// A run written, not started yet.
export const ON_CALL_RUN_SCHEDULED_MESSAGE: string = "Scheduled.";

// A policy's run that started, and goes through its escalation rules.
export const ON_CALL_RUN_EXECUTION_STARTED_MESSAGE: string =
  "Execution started...";

// A direct page or a test page that started paging its people.
export const ON_CALL_RUN_PAGING_STARTED_MESSAGE: string = "Paging started...";

/*
 * What a policy's run that did not finish starting, and could not be
 * handed over, ends with, as it always did
 * (OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions).
 */
export const ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE: string =
  "Policy Execution timed out.";
export const ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE: string =
  "Policy Execution never started (stuck in Scheduled) and was timed out.";

/*
 * What a person's page that did not finish starting says once it is handed
 * over to the person's-log worker, which sends its notifications from then
 * on (UserOnCallLog:TimeoutStuckExecutions):
 *
 *   "This page did not finish starting within 5 minutes, so its
 *    notifications are sent from here."
 */
const USER_LOG_HANDED_OVER_START: string =
  "This page did not finish starting within ";
const USER_LOG_HANDED_OVER_END: string =
  " minutes, so its notifications are sent from here.";
const WHOLE_NUMBER: RegExp = /^\d+$/;

export function getUserOnCallLogHandedOverMessage(minutes: number): string {
  return `${USER_LOG_HANDED_OVER_START}${minutes}${USER_LOG_HANDED_OVER_END}`;
}

/*
 * The minutes a handed-over page's message names, or null when the message
 * is no handed-over page's.
 */
export function readUserOnCallLogHandedOverMinutes(
  statusMessage: string | null | undefined,
): number | null {
  const message: string = (statusMessage || "").trim();

  if (
    !message.startsWith(USER_LOG_HANDED_OVER_START) ||
    !message.endsWith(USER_LOG_HANDED_OVER_END)
  ) {
    return null;
  }

  const minutes: string = message.slice(
    USER_LOG_HANDED_OVER_START.length,
    message.length - USER_LOG_HANDED_OVER_END.length,
  );

  return WHOLE_NUMBER.test(minutes) ? Number(minutes) : null;
}

// What a person's page that started too long ago to be handed over ends with.
export const USER_LOG_TIMED_OUT_STATUS_MESSAGE: string =
  "Rule execution timed out.";
