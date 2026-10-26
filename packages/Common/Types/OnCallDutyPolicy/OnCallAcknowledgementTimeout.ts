/*
 * AN ON-CALL POLICY'S ACKNOWLEDGEMENT TIMEOUT: PAGE AGAIN WHEN AN
 * ACKNOWLEDGED INCIDENT, ALERT OR EPISODE IS NOT RESOLVED IN TIME.
 *
 * Acknowledging a page stops the policy for good: somebody took it. When
 * they are then pulled away, fall back asleep or forget, the record can sit
 * acknowledged with nobody reminded of it (issue #5123). A policy can now
 * say how long that may last - "page again if it is acknowledged but not
 * resolved within N minutes" (OnCallDutyPolicy.acknowledgementTimeoutInMinutes).
 * Empty, as it is on every policy until somebody sets it, nothing changes:
 * acknowledging stops the paging, as it always did.
 *
 * What it does, decided once for everybody (there is nothing else to pick):
 *
 *   - The clock starts when the record is acknowledged - from anywhere: an
 *     answered page, the Dashboard, the mobile app, Slack or Microsoft
 *     Teams, the API, a workflow - and starts again at every new
 *     acknowledgement, a page again answered included. It is counted from
 *     the moment OneUptime records the acknowledgement, so a state change
 *     back-dated to yesterday does not page anybody at once.
 *   - When it runs out with the record still acknowledged and not resolved,
 *     the policy pages again: a new run of it (a "page again", numbered on
 *     the run as pageAgainNumber). It starts at the escalation rule that was
 *     paging when the record was acknowledged and pages whoever is on call
 *     there NOW - a rotation that changed hands since pages its new person -
 *     and, first, the person who acknowledged it.
 *   - The record stays acknowledged. OneUptime never moves a record back up
 *     its list of states (Common/Utils/StateMove): doing it here would write
 *     a state change into the record's history, tell status page
 *     subscribers and the record's channels it changed, and start every
 *     automation that waits for a state - for a reminder. The page again
 *     is a page of its own instead, in the record's feed and its on-call
 *     logs like every page: acknowledged, escalated or left alone like any.
 *     Escalated, it moves to the next level; left alone, it goes through
 *     the policy's levels as the first run did.
 *   - It pages again at most ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN
 *     times for one record, so a record somebody keeps acknowledging and
 *     never resolves is not paged about for ever.
 *   - It stops when the record is resolved or deleted, when the policy is
 *     archived or deleted, and when the timeout is turned off. A changed
 *     number of minutes applies to the clocks already running.
 *
 * This file holds the rule and its words, for the server (the clock, the
 * worker that pages again, the feed and the runs' chat messages), the
 * Dashboard and the docs tests. It imports nothing that needs a server or
 * React.
 */

// What "Page again" starts with in the Dashboard: half an hour.
export const DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES: number = 30;

/*
 * The shortest and longest timeouts a policy may have. Under five minutes
 * nobody acknowledging has had time to look; a day is the longest wait a
 * reminder about an open record is still about the same piece of work.
 */
export const MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES: number = 5;
export const MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES: number = 1440;

/*
 * How many times one policy pages again about one record, at most. A
 * person who acknowledges each page again is working on it: after a few
 * times they have said so often enough.
 */
export const ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN: number = 5;

const MINUTE_IN_MS: number = 60 * 1000;

export interface OnCallAcknowledgementTimeoutSettings {
  acknowledgementTimeoutInMinutes?: number | null | undefined;
}

/*
 * The policy's timeout in minutes, or null when it does not page again.
 * A stored number is read as the worker reads it: not a positive number is
 * off, anything else a whole number inside the allowed range.
 */
export function getOnCallAcknowledgementTimeoutInMinutes(
  policy: OnCallAcknowledgementTimeoutSettings | null | undefined,
): number | null {
  const value: unknown = policy?.acknowledgementTimeoutInMinutes;

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const minutes: number = Number(value);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }

  return Math.min(
    MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
    Math.max(
      MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
      Math.floor(minutes),
    ),
  );
}

// Whether a policy pages again after an acknowledgement.
export function isOnCallAcknowledgementTimeoutOn(
  policy: OnCallAcknowledgementTimeoutSettings | null | undefined,
): boolean {
  return getOnCallAcknowledgementTimeoutInMinutes(policy) !== null;
}

/*
 * Why a value cannot be a policy's timeout, or null when it can: null (the
 * timeout is off) or a whole number of minutes in the allowed range. What
 * the API, Terraform and a workflow are told; the Dashboard never sends
 * anything else.
 */
export const ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL: string = `The acknowledgement timeout is a whole number of minutes from ${MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES} to ${MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES} (24 hours), or null to turn it off.`;

export function getOnCallAcknowledgementTimeoutRefusal(
  value: unknown,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  // A number, or the text of one ("30"): what a JSON body may carry.
  const isNumberLike: boolean =
    typeof value === "number" ||
    (typeof value === "string" && value.trim().length > 0);

  const minutes: number = isNumberLike ? Number(value) : NaN;

  if (
    !Number.isInteger(minutes) ||
    minutes < MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES ||
    minutes > MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES
  ) {
    return ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_REFUSAL;
  }

  return null;
}

// When a clock that started at `startedAt` runs out.
export function getOnCallAcknowledgementTimeoutDueAt(data: {
  startedAt: Date;
  minutes: number;
}): Date {
  return new Date(
    new Date(data.startedAt).getTime() + data.minutes * MINUTE_IN_MS,
  );
}

/*
 * Whether a clock that started at `startedAt` has run out at `now`: to the
 * millisecond, never by whole minutes - a worker that ticks once a minute
 * pages again at its first tick at or after the moment.
 */
export function isOnCallAcknowledgementTimeoutDue(data: {
  startedAt: Date;
  minutes: number;
  now: Date;
}): boolean {
  const startedAt: number = new Date(data.startedAt).getTime();

  if (isNaN(startedAt)) {
    return false;
  }

  return (
    getOnCallAcknowledgementTimeoutDueAt({
      startedAt: new Date(startedAt),
      minutes: data.minutes,
    }).getTime() <= new Date(data.now).getTime()
  );
}

/*
 * Whether a policy may page again about a record it paged again about
 * `pagesAgainSoFar` times already.
 */
export function hasOnCallPagesAgainLeft(
  pagesAgainSoFar: number | null | undefined,
): boolean {
  // None so far: the first page again is still to come.
  if (pagesAgainSoFar === null || pagesAgainSoFar === undefined) {
    return true;
  }

  const count: number = Number(pagesAgainSoFar);

  // A count that is not a number pages nobody again: it cannot be trusted.
  if (!Number.isFinite(count)) {
    return false;
  }

  return count < ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN;
}

export interface OnCallPageAgainRun {
  pageAgainNumber?: number | null | undefined;
}

/*
 * Whether a run is a page again: started because its record stayed
 * acknowledged without being resolved. Such a run is not over because its
 * record is acknowledged - it was all along - only once somebody
 * acknowledges the run itself, or the record is resolved.
 */
export function isOnCallPageAgainRun(
  run: OnCallPageAgainRun | null | undefined,
): boolean {
  const number: number = Number(run?.pageAgainNumber || 0);

  return Number.isFinite(number) && number > 0;
}

/*
 * A timeout in words: "30 minutes", "1 hour", "1 hour 30 minutes",
 * "24 hours".
 */
export function describeOnCallAcknowledgementTimeout(minutes: number): string {
  const whole: number = Math.max(0, Math.floor(minutes));
  const hours: number = Math.floor(whole / 60);
  const rest: number = whole % 60;

  const minutesText: string = rest === 1 ? "1 minute" : `${rest} minutes`;

  if (hours === 0) {
    return minutesText;
  }

  const hoursText: string = hours === 1 ? "1 hour" : `${hours} hours`;

  return rest === 0 ? hoursText : `${hoursText} ${minutesText}`;
}

// Which page again of how many, for a line about one: "1 of 5".
export function getOnCallPageAgainPlace(pageAgainNumber: number): string {
  return `${pageAgainNumber} of ${ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN}`;
}

/*
 * The status message a page again runs with while it pages, the words its
 * Execution Logs row and the run's own page show:
 *
 *   Paging again (1 of 5): still not resolved 30 minutes after it was
 *   acknowledged.
 */
export const ON_CALL_PAGE_AGAIN_STATUS_MESSAGE_START: string = "Paging again (";

export function getOnCallPageAgainStatusMessage(data: {
  pageAgainNumber: number;
  minutes: number;
}): string {
  return `${ON_CALL_PAGE_AGAIN_STATUS_MESSAGE_START}${getOnCallPageAgainPlace(
    data.pageAgainNumber,
  )}): still not resolved ${describeOnCallAcknowledgementTimeout(
    data.minutes,
  )} after it was acknowledged.`;
}

// Whether a run's status message is the one a page again pages with.
export function isOnCallPageAgainStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  return (statusMessage || "").startsWith(
    ON_CALL_PAGE_AGAIN_STATUS_MESSAGE_START,
  );
}

/*
 * Which page again of how many, saying so when it is the last: "1 of 5",
 * "5 of 5, the last time" - in the feed and in the run's chat message.
 */
export function getOnCallPageAgainPlaceWithLast(
  pageAgainNumber: number,
): string {
  const isLast: boolean =
    pageAgainNumber >= ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN;

  return `${getOnCallPageAgainPlace(pageAgainNumber)}${
    isLast ? ", the last time" : ""
  }`;
}

/*
 * What a page again's Slack and Microsoft Teams message says under its
 * headline, the words after "Paged again" (bold there): "(1 of 5): still
 * not resolved after it was acknowledged."
 */
export function getOnCallPageAgainChatReason(pageAgainNumber: number): string {
  return `(${getOnCallPageAgainPlaceWithLast(
    pageAgainNumber,
  )}): still not resolved after it was acknowledged.`;
}

/*
 * WHAT A PAGE AGAIN SAYS TO THE PEOPLE IT PAGES.
 *
 * A page again reaches people the way every page does - their own
 * notification rules: an email, a call, a push, a Slack or Microsoft Teams
 * message, Telegram. Worded as a first page, it told somebody who
 * acknowledged the incident half an hour ago that "a new incident has been
 * created". It says what it is instead: the incident (alert, episode) is
 * still not resolved, so long after it was acknowledged. The text message
 * says it is still not resolved too, after the project, in the one
 * 160-character part it fits in (Utils/Sms/OnCallPageSms). WhatsApp's is
 * left as it is: its words are a template Meta approved, and a page again's
 * own wording would need a new template approved first.
 */
export interface OnCallPageAgainNotice {
  // Which page again, from 1.
  pageAgainNumber: number;
  // The policy's timeout, when it could be read: "30 minutes after".
  minutes?: number | undefined;
}

/*
 * Why the person is paged again, as the end of a sentence: "still not
 * resolved 30 minutes after it was acknowledged" - or, without the minutes,
 * "still not resolved after it was acknowledged".
 */
export function getOnCallPageAgainNoticeReason(
  notice: OnCallPageAgainNotice,
): string {
  const minutes: number = Number(notice.minutes || 0);

  return Number.isFinite(minutes) && minutes > 0
    ? `still not resolved ${describeOnCallAcknowledgementTimeout(
        minutes,
      )} after it was acknowledged`
    : "still not resolved after it was acknowledged";
}

/*
 * A page again's headline, where a first page says "New incident assigned
 * to you": "Incident still not resolved". `recordNoun` is the record's kind
 * as a sentence names it: "incident", "alert", "incident episode", "alert
 * episode".
 */
export function getOnCallPageAgainHeadline(recordNoun: string): string {
  const noun: string = recordNoun.trim() || "record";

  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} still not resolved`;
}

/*
 * What a call says first, where a first page's says "A new incident has
 * been created": "An incident is still not resolved 30 minutes after it was
 * acknowledged". Every kind of record starts with a vowel.
 */
export function getOnCallPageAgainCallSentence(data: {
  recordNoun: string;
  notice: OnCallPageAgainNotice;
}): string {
  return `An ${data.recordNoun} is ${getOnCallPageAgainNoticeReason(
    data.notice,
  )}`;
}

/*
 * What an email says first, where a first page's says "A new incident has
 * been created in the project - Acme": "This incident in the project Acme
 * is still not resolved 30 minutes after it was acknowledged."
 */
export function getOnCallPageAgainEmailLine(data: {
  recordNoun: string;
  projectName: string;
  notice: OnCallPageAgainNotice;
}): string {
  const project: string = data.projectName.trim();

  return `This ${data.recordNoun}${
    project ? ` in the project ${project}` : ""
  } is ${getOnCallPageAgainNoticeReason(data.notice)}.`;
}

/*
 * What a chat message and a Telegram message say under the record, where a
 * first page's say "You're getting this because you're on call.".
 */
export function getOnCallPageAgainWhyLine(
  notice: OnCallPageAgainNotice,
): string {
  return `You're getting this because it is ${getOnCallPageAgainNoticeReason(
    notice,
  )}.`;
}

/*
 * ACKNOWLEDGING A PAGE AGAIN FROM THE DASHBOARD.
 *
 * A page again's record was acknowledged all along, so the record's own
 * Acknowledge is not offered. The person being paged again acknowledges
 * their page instead - as its link, a call's 1 or a text would - signed in
 * as themselves: a POST of the record's type and id to this route, which
 * acknowledges every page again of theirs about the record still going out
 * to them, and starts the clock again (OnCallPagePassOnAPI).
 */
export const ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE: string =
  "/on-call-page/acknowledge";

// The POST answer: how many of the person's pages again it acknowledged.
export interface OnCallPageAgainAcknowledgeAnswer {
  acknowledged: number;
}
