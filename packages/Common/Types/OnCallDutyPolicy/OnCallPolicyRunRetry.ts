import ColumnLength from "../Database/ColumnLength";

/*
 * AN ON-CALL POLICY RUN WHOSE STEP FAILED IS TRIED AGAIN (issue #8167).
 *
 * Every minute the worker (OnCallDutyPolicyExecutionLog:
 * ExecutePendingExecutions) works on each run still going: it ends one
 * whose record was acknowledged, moves one on to its next escalation rule
 * once its wait is over (OnCallEscalationAdvance), starts one that waited
 * to page. It used to end the run in Error on any error, and Error is
 * final: one database blip as it moved a run on, and no later rule of the
 * run was ever paged.
 *
 * Now a step that fails for a reason a retry cannot fix - the record is
 * gone, the data is bad (OnCallRunFailure) - ends the run, as before. Any
 * other failure leaves the run as it is, and the step is tried again: a
 * minute later, then two, then four, then every five minutes
 * (getOnCallPolicyRunRetryWaitInMinutes), each try at a tick of the worker.
 * A run whose step fails ON_CALL_POLICY_RUN_MAX_TRIES tries in a row - over
 * about 37 minutes - ends in Error, saying so
 * (getOnCallPolicyRunOutOfTriesMessage): a failure that lasts that long is
 * not a blip, and a run that fails every minute for a bug is not to fail
 * forever (#8106). A step that goes through clears its failures, so the
 * tries are counted in a row.
 *
 * Every step is safe to try again: moving a run on and starting a run that
 * waited are each claimed with one atomic UPDATE, so a step tried again
 * after it got past its claim does not page anybody twice.
 */

// How many tries in a row a run's step gets: the first, and nine more.
export const ON_CALL_POLICY_RUN_MAX_TRIES: number = 10;

// The longest wait between two tries.
export const ON_CALL_POLICY_RUN_RETRY_LONGEST_WAIT_IN_MINUTES: number = 5;

/*
 * How much earlier than its wait says a try may come: the worker ticks once
 * a minute, a few seconds either way, and a tick that comes a second early
 * is not made to wait a whole minute more.
 */
export const ON_CALL_POLICY_RUN_RETRY_SLACK_IN_MS: number = 30 * 1000;

const MINUTE_IN_MS: number = 60 * 1000;

// What a run's failed tries in a row are.
export interface OnCallPolicyRunFailures {
  // How many tries in a row failed.
  failedTries: number;
  // When the first of them failed.
  firstFailedAt: Date;
  // When the last one failed.
  lastFailedAt: Date;
  // No try comes before this.
  retryAt: Date;
  // What the last one failed with.
  lastError: string;
}

/*
 * How long a run waits for its next try once `failedTries` tries in a row
 * have failed: 1, 2 and 4 minutes, then 5.
 */
export function getOnCallPolicyRunRetryWaitInMinutes(
  failedTries: number,
): number {
  const tries: number = Number.isFinite(failedTries)
    ? Math.max(1, Math.floor(failedTries))
    : 1;

  return Math.min(
    2 ** Math.min(tries - 1, 30),
    ON_CALL_POLICY_RUN_RETRY_LONGEST_WAIT_IN_MINUTES,
  );
}

// A run's failures once one more try failed, at `failedAt`, with `error`.
export function addOnCallPolicyRunFailure(data: {
  previous: OnCallPolicyRunFailures | null | undefined;
  failedAt: Date;
  error: string;
}): OnCallPolicyRunFailures {
  const failedTries: number = (data.previous?.failedTries || 0) + 1;

  return {
    failedTries: failedTries,
    firstFailedAt: data.previous?.firstFailedAt
      ? new Date(data.previous.firstFailedAt)
      : new Date(data.failedAt),
    lastFailedAt: new Date(data.failedAt),
    retryAt: new Date(
      data.failedAt.getTime() +
        getOnCallPolicyRunRetryWaitInMinutes(failedTries) * MINUTE_IN_MS,
    ),
    lastError: data.error,
  };
}

/*
 * Whether a run may be tried at `now`: one with no failures always may,
 * one whose last try failed once its wait is over.
 */
export function isOnCallPolicyRunRetryDue(data: {
  failures: OnCallPolicyRunFailures | null | undefined;
  now: Date;
}): boolean {
  if (!data.failures) {
    return true;
  }

  const retryAt: number = new Date(data.failures.retryAt).getTime();

  if (isNaN(retryAt)) {
    return true;
  }

  return data.now.getTime() >= retryAt - ON_CALL_POLICY_RUN_RETRY_SLACK_IN_MS;
}

// Whether the last failed try was a run's last: it ends in Error now.
export function hasOnCallPolicyRunRunOutOfTries(
  failures: OnCallPolicyRunFailures,
): boolean {
  return failures.failedTries >= ON_CALL_POLICY_RUN_MAX_TRIES;
}

// A run's status message, as long as the column holds (ColumnLength.LongText).
export function toOnCallPolicyRunStatusMessage(message: string): string {
  const oneLine: string = message.replace(/\s+/g, " ").trim();

  if (oneLine.length <= ColumnLength.LongText) {
    return oneLine;
  }

  return `${oneLine.slice(0, ColumnLength.LongText - 3).trimEnd()}...`;
}

// "1 minute", "37 minutes": how long the failed tries went on.
function describeMinutes(from: Date, to: Date): string {
  const minutes: number = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / MINUTE_IN_MS,
  );

  if (!Number.isFinite(minutes) || minutes < 1) {
    return "less than a minute";
  }

  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

// How a sentence ends.
const SENTENCE_END: RegExp = /[.!?]$/;

// The error's words as the end of a sentence: with a full stop, once.
function asSentenceEnd(text: string): string {
  const trimmed: string = text.replace(/\s+/g, " ").trim();

  if (!trimmed) {
    return "an error with no message.";
  }

  return SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

/*
 * WHAT A RUN THAT RAN OUT OF TRIES ENDS WITH: what happened, what the last
 * try failed with, and what to do - page the record's people again. A run
 * that waited to page (`wasWaiting`) paged nobody; one that was paging
 * stopped. The record's feed reads it after "<policy> stopped with an
 * error." (OnCallFeedText).
 *
 *   "OneUptime tried 10 times in 37 minutes to move this run on, and every
 *    try failed, so it stopped paging. The last try failed with: Connection
 *    terminated unexpectedly. If the incident still needs somebody, page
 *    them again."
 *
 * Never longer than a run's status message can be.
 */
export function getOnCallPolicyRunOutOfTriesMessage(data: {
  failures: OnCallPolicyRunFailures;
  wasWaiting: boolean;
  // The kind of record the run pages about: "incident", "alert episode"...
  recordKind?: string | null | undefined;
}): string {
  const tries: number = data.failures.failedTries;
  const over: string = describeMinutes(
    data.failures.firstFailedAt,
    data.failures.lastFailedAt,
  );
  const what: string = data.wasWaiting
    ? `OneUptime tried ${tries} times in ${over} to start this run, and every try failed, so nobody was paged.`
    : `OneUptime tried ${tries} times in ${over} to move this run on, and every try failed, so it stopped paging.`;
  const kind: string = (data.recordKind || "").trim();
  const next: string = kind
    ? ` If the ${kind} still needs somebody, page them again.`
    : "";
  const lead: string = `${what} The last try failed with: `;
  // Room for the error, between the sentences OneUptime writes around it.
  const room: number = ColumnLength.LongText - lead.length - next.length;
  const error: string = asSentenceEnd(data.failures.lastError);
  const clipped: string =
    error.length <= room
      ? error
      : `${error.slice(0, Math.max(0, room - 3)).trimEnd()}...`;

  return toOnCallPolicyRunStatusMessage(`${lead}${clipped}${next}`);
}
