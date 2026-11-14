/*
 * "CAN'T TAKE IT? ESCALATE."
 *
 * Somebody an on-call policy pages may not be able to take the page: on a
 * flight, driving, at the dentist, deep in another incident. Until now the
 * policy waited out the whole escalation rule (30 minutes by default) before
 * it paged the next level, and those minutes were lost for nothing. The
 * person being paged can now escalate the page, from the page itself: the
 * email, the text, the call ("press 2"), the Slack or Microsoft Teams
 * message, the Dashboard and the mobile app. A customer called it NACK, a
 * negative acknowledgement.
 *
 * The action is called Escalate everywhere a person meets it - the word
 * on-call people already use for handing a page up to the next level, and
 * the one the maintainer's copy for the incident page uses:
 *
 *   Escalate Incident?
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   You will not be paged again for this incident.
 *   [Cancel] [Escalate]
 *
 * It was first called "Pass it on". In code the feature keeps that name -
 * pass on (OnCallPagePassOn, passOn, the /pass-on routes, the "Passed On"
 * status value) - so what is stored, the API and the links already sent
 * keep working. What people read says Escalate; the stored status reads
 * "Escalated" (getOnCallPageStatusLabel), and the messages written before
 * the rename are still understood (isOnCallPagePassedOnStatusMessage and
 * the other readers below).
 *
 * What escalating a page does:
 *
 * - The person is not paged about it again by that run: the notifications
 *   still due to them stop (a call after 10 minutes, a push that repeats),
 *   and the run's later escalation rules and repeats pass them over.
 * - The run moves on AT ONCE when nobody else on its current escalation rule
 *   is left to take the page - everybody else that rule paged has escalated
 *   too: the next level is paged straight away, as it would have been when
 *   the wait ran out. After the last level the policy starts again from the
 *   first if its Repeat Policy says so, and otherwise stops, and the
 *   record's Slack and Microsoft Teams channels are told nobody took it.
 * - While somebody else on the level is still being paged, the run waits for
 *   them as it always did: one person who cannot take a page does not wake
 *   the next level while a colleague on the same level may still pick it up.
 * - A direct page (people, a team or a schedule paged with no policy) has no
 *   next level: the person stops being paged, and once everybody it paged
 *   has escalated, the page ends as one nobody took.
 * - It acknowledges nothing and changes nothing on the record. Acknowledging
 *   afterwards still works, and still stops all paging.
 *
 * WHICH LEVEL. Escalating pages the next level. When the policy has more
 * than one level after the person's, they can pick a later one instead - the
 * next level is on leave, or the page needs the database team two levels
 * up - wherever there is room to ask: the Dashboard's and the Escalate
 * page's (OnCallPassOnLevelChoice). The next level stays picked, so pressing
 * Escalate does what it always did. The levels between are skipped: the
 * run's timeline gets a line for each saying so
 * (ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE), and from the level
 * picked the run goes on as from any level - its wait, the level after it,
 * the Repeat Policy. A call, a text and a chat message's quick button page
 * the next level, as before.
 *
 * Only the person being paged can escalate their page: through a link only
 * their own messages carry (signed, OnCallPageLinkToken), their own phone
 * call, or signed in as themselves.
 *
 * This file holds what every one of those places shares: the words, the
 * kinds of answer, and the sentences built from them. It is read by the
 * server, the Dashboard and the docs tests, so it imports nothing that needs
 * a server or React.
 */

import OneUptimeDate from "../Date";
import Timezone from "../Timezone";
import OnCallDutyExecutionLogTimelineStatus from "./OnCalDutyExecutionLogTimelineStatus";
import { isDefaultEscalationRuleName } from "./EscalationRuleDefaults";

// The action, on every button and link: "Escalate".
export const ESCALATE: string = "Escalate";

// What leads up to it where there is room: "Can't take it?".
export const CANT_TAKE_IT: string = "Can't take it?";

// "Can't take it? Escalate" - a link's text where one line says both.
export const CANT_TAKE_IT_ESCALATE: string = `${CANT_TAKE_IT} ${ESCALATE}`;

/*
 * The status message of a person's page that they escalated - their
 * notification log, and the run's timeline line for them. The feed reads it
 * back as one sentence (OnCallFeedText) rather than saying it twice.
 */
export const ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE: string =
  "Escalated: could not take this page.";

// The same message as pages escalated before the rename were given it.
export const LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE: string =
  "Passed on: could not take this page.";

/*
 * The timeline's line for somebody a later escalation rule (or a repeat)
 * would have paged, who had escalated this run's page already. It is kept
 * on the run's own page only: the feed and the run's Slack and Microsoft
 * Teams message say once that the person escalated, not once for every
 * rule after it.
 */
export const ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE: string =
  "Skipped because they escalated this page.";

// The same line as runs before the rename wrote it.
export const LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE: string =
  "Skipped because they passed this page on.";

/*
 * The line a level gets on the run's timeline when somebody escalating
 * picked a later level to page (OnCallPassOnLevelChoice): the policy did not
 * page it. It names nobody - the line of the person who escalated, just
 * before it, says who - and it is no fault of the level's: the record's
 * feed says the page was escalated past it, the Execution Timeline draws it
 * without a warning, and the run's Slack and Microsoft Teams message leaves
 * it out, where a level that pages nobody raises an alarm.
 */
export const ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE: string =
  "Skipped: the page was escalated past this level.";

// Whether a timeline line is the one a level skipped by escalating gets.
export function isOnCallLevelSkippedByEscalationMessage(
  message: string | undefined | null,
): boolean {
  return (
    (message || "").trim() ===
    ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE
  );
}

/*
 * The status message of the delivery - the email, the text, the call - a
 * person escalated their page through. Shown, never read back.
 */
export const ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE: string =
  "Escalated from this notification.";

function isOneOf(
  message: string | undefined | null,
  messages: Array<string>,
): boolean {
  return messages.includes((message || "").trim());
}

/*
 * Whether a status message is the one an escalated page is given - in the
 * words of today, or of before the rename: logs written before it are read
 * back the same way.
 */
export function isOnCallPagePassedOnStatusMessage(
  message: string | undefined | null,
): boolean {
  return isOneOf(message, [
    ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
    LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ]);
}

// Whether a timeline line is the one that passes over somebody who escalated.
export function isOnCallPagePassedOnSkipTimelineMessage(
  message: string | undefined | null,
): boolean {
  return isOneOf(message, [
    ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
    LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ]);
}

/*
 * The status an escalated page is stored with is "Passed On" - the value
 * the run's timeline, a person's notification logs and the API have used
 * since the action was first named. People read it as "Escalated".
 */
export const ON_CALL_PAGE_PASSED_ON_STATUS_VALUE: string =
  OnCallDutyExecutionLogTimelineStatus.PassedOn;

export const ON_CALL_PAGE_ESCALATED_STATUS_LABEL: string = "Escalated";

// A stored status as people read it: "Passed On" reads "Escalated".
export function getOnCallPageStatusLabel(status: string): string {
  return status === ON_CALL_PAGE_PASSED_ON_STATUS_VALUE
    ? ON_CALL_PAGE_ESCALATED_STATUS_LABEL
    : status;
}

/*
 * The key a phone call asks the person to press to escalate the page, and
 * what it says about it, after "To acknowledge this incident, press 1.": "If
 * you can't take it, press 2 to escalate." What it answers when the key is
 * pressed depends on what came of it (UserOnCallLogTimelineAPI).
 */
export const ON_CALL_PAGE_CALL_PASS_ON_DIGIT: string = "2";

export function getOnCallPageCallPassOnPrompt(): string {
  return `If you can't take it, press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to escalate.`;
}

// The record kinds a page is about, as the Dashboard's API names them.
export enum OnCallPageRecordType {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incident-episode",
  AlertEpisode = "alert-episode",
}

/*
 * GET  <api>/on-call-page/pass-on/<record type>/<record id>
 *   The signed-in person's open pages about one record, and what escalating
 *   them would do.
 * POST <api>/on-call-page/pass-on/<record type>/<record id>
 *   Escalates them, and answers what it did. Its body may say which level
 *   to page for a page - OnCallPassOnRecordRequest - and a page it says
 *   nothing of pages its next level.
 */
export const ON_CALL_PAGE_PASS_ON_ROUTE: string = "/on-call-page/pass-on";

/*
 * The POST's body field with the level picked for each page, by the page's
 * run: { "escalateTo": { "<execution log id>": "<escalation rule id>" } }.
 */
export const ON_CALL_PAGE_PASS_ON_ESCALATE_TO_FIELD: string = "escalateTo";

export interface OnCallPassOnRecordRequest {
  escalateTo?: Record<string, string> | undefined;
}

/*
 * The field of the Escalate page's form (UserOnCallLogTimelineAPI) with the
 * level picked: the escalation rule's id. Without it, the next level.
 */
export const ON_CALL_PAGE_PASS_ON_LEVEL_PARAM: string = "escalationRuleId";

export function isOnCallPageRecordType(
  value: unknown,
): value is OnCallPageRecordType {
  return (
    typeof value === "string" &&
    (Object.values(OnCallPageRecordType) as Array<string>).includes(value)
  );
}

// "incident", "alert", "incident episode", "alert episode".
export function getOnCallPageRecordNoun(
  recordType: OnCallPageRecordType,
): string {
  switch (recordType) {
    case OnCallPageRecordType.Incident:
      return "incident";
    case OnCallPageRecordType.Alert:
      return "alert";
    case OnCallPageRecordType.IncidentEpisode:
      return "incident episode";
    case OnCallPageRecordType.AlertEpisode:
    default:
      return "alert episode";
  }
}

// What escalating a page did - or, asked beforehand, would do.
export enum OnCallPassOnOutcome {
  /*
   * Nobody else on the run's current escalation rule was left to take it:
   * the next level was paged straight away.
   */
  NextRulePaged = "NextRulePaged",
  /*
   * It was the policy's last level and its Repeat Policy repeats: the
   * policy started again from its first level straight away.
   */
  PolicyStartedAgain = "PolicyStartedAgain",
  /*
   * Nobody is left to page: it was the last level with no repeat left, a
   * direct page whose people have all escalated, or a run that had stopped
   * paging already. Somebody needs to take the record.
   */
  PagingStopped = "PagingStopped",
  /*
   * Somebody else on the current level (or on a direct page) is still being
   * paged: the run waits for them, as it always did.
   */
  OthersStillPaged = "OthersStillPaged",
  /*
   * The person's page was from an earlier level: the run has moved on past
   * it already, and goes on as it is.
   */
  AlreadyEscalated = "AlreadyEscalated",
}

// Why a page could not be escalated.
export enum OnCallPassOnRefusal {
  // The record is acknowledged or resolved: somebody has taken it.
  RecordAcknowledged = "RecordAcknowledged",
  // The person escalated this page already.
  AlreadyPassedOn = "AlreadyPassedOn",
  // The page is over: its run ended and the person's notifications are done.
  PageOver = "PageOver",
  // The person is not being paged about it.
  NotPaged = "NotPaged",
  // The link was not one of the person's own, or it has expired.
  InvalidLink = "InvalidLink",
  /*
   * The level picked to page is not one escalating can page any more: the
   * policy's levels changed since they were offered (a level was deleted or
   * moved), or it is not a level of this policy at all. Nothing was
   * changed, and the person can escalate again, picking from the levels as
   * they are now.
   */
  LevelNotAvailable = "LevelNotAvailable",
}

// An escalation rule - a level of the policy - by its place and name.
export interface OnCallPassOnRule {
  order: number;
  name?: string | undefined;
}

/*
 * A LEVEL ESCALATING CAN PAGE: a level of the policy after the person's,
 * by its escalation rule (see "Which level" at the top). Picked by the
 * rule's id, which stays the same while a level is renamed or the levels
 * around it change; the server checks, as the person escalates, that it is
 * still a level after theirs.
 */
export interface OnCallPassOnLevelChoice extends OnCallPassOnRule {
  escalationRuleId: string;
}

/*
 * What escalating came to, or would come to (isPreview). Plain data, so the
 * Dashboard and the mobile app can word it in their own language; the
 * server words it with getOnCallPassOnSentence.
 */
export interface OnCallPassOnResult {
  outcome: OnCallPassOnOutcome;
  // True when this says what escalating WOULD do - nothing was changed.
  isPreview: boolean;
  // A direct page: no policy, so no escalation rules.
  isDirectPage: boolean;
  // The policy's name; empty for a direct page.
  policyName: string;
  /*
   * NextRulePaged: the level now paging (a preview: the level that would
   * be). PolicyStartedAgain: the first level. AlreadyEscalated: the level
   * the run is on.
   */
  rule?: OnCallPassOnRule | undefined;
  // The level's people who were paged now. Empty in a preview.
  pagedNames: Array<string>;
  // OthersStillPaged: who else is still being paged.
  stillPagedNames: Array<string>;
  /*
   * OthersStillPaged on a policy's run: when the current level's wait runs
   * out, and the level after it then, when there is one.
   */
  nextStepAt?: Date | undefined;
  nextRule?: OnCallPassOnRule | undefined;
  // How many levels the policy has, for "Level 2 of 3".
  ruleCount: number;
  /*
   * A preview that pages a level now (NextRulePaged): the levels escalating
   * may page, in order - every level after the person's. The first is the
   * next level, `rule`, which escalating pages unless another is picked; a
   * later one skips those before it. Absent on any other answer.
   */
  levelChoices?: Array<OnCallPassOnLevelChoice> | undefined;
}

// What escalating one page answers: done, with what came of it, or refused.
export interface OnCallPassOnAnswer {
  passedOn: boolean;
  result?: OnCallPassOnResult | undefined;
  refusal?: OnCallPassOnRefusal | undefined;
  /*
   * RecordAcknowledged: who acknowledged it, when that is known. Text, for
   * "Incident INC-42 was already acknowledged by Ana Lopez."
   */
  acknowledgedByName?: string | undefined;
  /*
   * The API's answer only: what came of it, or why not, as the server words
   * it in English (getOnCallPassOnSentence / getOnCallPassOnRefusalSentence)
   * with times in the person's own time zone. The mobile app shows it as it
   * is; the Dashboard words the result in the reader's language instead.
   */
  sentence?: string | undefined;
}

// One page a person can escalate, and what escalating it would do.
export interface OnCallOpenPage {
  executionLogId: string;
  preview: OnCallPassOnResult;
  // The API's answer only: the preview as the server words it (see above).
  sentence?: string | undefined;
  /*
   * Present (true) when the page is acknowledged as the page it is
   * (ON_CALL_PAGE_AGAIN_ACKNOWLEDGE_ROUTE), since its record is acknowledged
   * and the record's own Acknowledge is gone: a page again
   * (OnCallAcknowledgementTimeout), whose record was acknowledged all
   * along; and a page a person asked for (OnCallPersonPage) or a policy a
   * person started by hand (OnCallPolicyStartedByHand) about a record
   * somebody acknowledged already - both go on until one of their people
   * answers them. Its name is the first kind's: the Dashboard and the app
   * offer "Acknowledge again" for each. Absent otherwise.
   */
  isPageAgain?: true | undefined;
  /*
   * Present (true) beside isPageAgain when the page is not a page again but
   * one somebody asked for by hand - a page a person sent (OnCallPersonPage)
   * or a policy a person started (OnCallPolicyStartedByHand) - about a
   * record somebody acknowledged already: the person is paged to help with
   * it, not paged again about one they took, so the mobile app does not say
   * "again" or "if you're still on it". An app that does not know it says
   * what it says of a page again, and answers it the same way. Absent
   * otherwise.
   */
  isAskedFor?: true | undefined;
  /*
   * Present (true) when the page is an observer's (OnCallObserverPage): the
   * person is kept informed while others respond, and answers it by saying
   * they have seen it (ON_CALL_OBSERVER_PAGE_SEEN_ROUTE), so the mobile app
   * offers no Escalate for it. Absent otherwise.
   */
  isObserverPage?: true | undefined;
}

/*
 * The GET answer of the Dashboard and the mobile app: the signed-in person's
 * open pages about the record (empty when there is nothing to escalate).
 */
export interface OnCallOpenPagesAnswer {
  pages: Array<OnCallOpenPage>;
}

// The POST answer: one answer per page that was escalated.
export interface OnCallPassOnRecordAnswer {
  answers: Array<OnCallPassOnAnswer>;
}

export interface OnCallPassOnWording {
  // "Incident INC-42", "Alert #12" - what the page is about, for refusals.
  recordLabel?: string | undefined;
  // The reader's own time zone, for "by 5:28 AM UTC". Server time without one.
  timezone?: string | undefined;
  /*
   * When the sentence is read, for whether "by 5:28 AM UTC" needs its date
   * (getOnCallPassOnTime). Now without one.
   */
  now?: Date | undefined;
  /*
   * For a sentence drawn on a page or a phone screen: a level's place -
   * "Level 2 of 3" - and a time - "5:28 AM UTC" - each stay on one line,
   * written with spaces no line breaks at (ON_CALL_PASS_ON_NO_BREAK_SPACE).
   * A call reads its sentence out, and leaves this off.
   */
  keepTogether?: boolean | undefined;
}

// "Alex, Sam and Kim" - names are text.
export function joinOnCallPassOnNames(names: Array<string>): string {
  const kept: Array<string> = names
    .map((name: string): string => {
      return name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    });

  if (kept.length <= 1) {
    return kept[0] || "";
  }

  return `${kept.slice(0, -1).join(", ")} and ${kept[kept.length - 1]}`;
}

/*
 * A level's own name, or nothing: none when it has no name, and none when
 * its name is the one its place gives it ("Level 2" on the second level,
 * EscalationRuleDefaults) - "Level 2 (Level 2 of 3)" would say it twice.
 */
export function getOnCallPassOnLevelName(
  rule: OnCallPassOnRule,
): string | undefined {
  const name: string = (rule.name || "").trim();

  if (!name || isDefaultEscalationRuleName(name, rule.order)) {
    return undefined;
  }

  return name;
}

/*
 * How many levels to say there are: the policy's count, never fewer than
 * the level's own place ("Level 3 of 2" would be a lie about a policy read
 * while it changed).
 */
export function getOnCallPassOnLevelCount(
  rule: OnCallPassOnRule,
  ruleCount?: number | undefined,
): number {
  return Math.max(ruleCount || 0, rule.order);
}

// U+00A0, a space no line breaks at.
export const ON_CALL_PASS_ON_NO_BREAK_SPACE: string = String.fromCharCode(0xa0);

// A phrase whose spaces no line breaks at, when it is to stay on one line.
function keepOnOneLine(
  phrase: string,
  keepTogether: boolean | undefined,
): string {
  return keepTogether
    ? phrase.split(" ").join(ON_CALL_PASS_ON_NO_BREAK_SPACE)
    : phrase;
}

/*
 * A level as every sentence names it: "Platform leads (Level 2 of 3)" - its
 * name, then its place - or "Level 2 of 3" when it has no name of its own.
 * In every sentence it is what the policy pages.
 *
 * keepTogether writes the place with spaces no line breaks at, for a page
 * or a phone screen: a narrow one broke the maintainer's own example as
 * "Platform leads (Level 2 of" / "3)". The name keeps its own spaces - it
 * is text somebody typed, and may be long.
 */
export function getOnCallPassOnLevelLabel(
  rule: OnCallPassOnRule,
  ruleCount?: number | undefined,
  keepTogether?: boolean | undefined,
): string {
  const place: string = keepOnOneLine(
    `Level ${rule.order} of ${getOnCallPassOnLevelCount(rule, ruleCount)}`,
    keepTogether,
  );
  const name: string | undefined = getOnCallPassOnLevelName(rule);

  return name ? `${name} (${place})` : place;
}

/*
 * A level's label, or nothing when the level is not known: no rule, or one
 * whose place could not be read (order 0) - "the next level" says it then,
 * as the Dashboard does.
 */
function getKnownLevelLabel(
  rule: OnCallPassOnRule | undefined,
  ruleCount: number,
  keepTogether: boolean | undefined,
): string | undefined {
  return rule && rule.order
    ? getOnCallPassOnLevelLabel(rule, ruleCount, keepTogether)
    : undefined;
}

/*
 * Whether `at` falls on the day `now` does, as the reader's clock reads both
 * - in `timezone`, or the server's or browser's zone without one.
 */
export function isOnCallPassOnTimeToday(data: {
  at: Date;
  now?: Date | undefined;
  timezone?: string | undefined;
}): boolean {
  const day: (date: Date) => string = (date: Date): string => {
    return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
      date: date,
      format: "YYYY-MM-DD",
      timezone: data.timezone,
    });
  };

  return day(data.at) === day(data.now || OneUptimeDate.getCurrentDate());
}

// "5:28 AM UTC": the time of day of `at`, with its zone.
export function getOnCallPassOnTimeOfDay(data: {
  at: Date;
  timezone?: string | undefined;
}): string {
  const time: string = OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: data.at,
    format: OneUptimeDate.getUserPrefers12HourFormat() ? "h:mm A" : "HH:mm",
    timezone: data.timezone,
  });

  const zone: string = OneUptimeDate.getZoneAbbrByTimezone(
    (data.timezone || OneUptimeDate.getCurrentTimezone()) as Timezone,
    data.at,
  );

  return `${time} ${zone}`.trim();
}

/*
 * When the policy moves on, in the reader's zone (the server's without
 * one). A level's wait is minutes away, so on the same day the time says it
 * - "by 5:28 AM UTC" - and a date in front of it would only stand between
 * the reader and the clock, on a page read at 3 a.m. or a call read out. A
 * time on another day keeps its date: "by Oct 17, 2026, 12:10 AM UTC".
 */
export function getOnCallPassOnTime(
  at: Date,
  wording: OnCallPassOnWording = {},
): string {
  if (
    isOnCallPassOnTimeToday({
      at: at,
      now: wording.now,
      timezone: wording.timezone,
    })
  ) {
    return getOnCallPassOnTimeOfDay({ at: at, timezone: wording.timezone });
  }

  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: at,
    timezone: wording.timezone,
  });
}

/*
 * What escalating did, or would do, in plain sentences: what the confirm
 * page, the page after it, a phone call and the API answer say - word for
 * word what the Dashboard says in English (PassOnPage).
 *
 *   This will immediately page Platform leads (Level 2 of 3), without
 *     waiting.
 *   The policy is now paging Platform leads (Level 2 of 3): Sam Lee.
 *   Bob Smith is still being paged. If nobody acknowledges by 5:28 AM UTC,
 *     the policy pages Level 3 of 3 next.
 *
 * A level is always what the policy pages, never the sentence's first
 * word: its name is text somebody typed, in whatever case they typed it.
 * It never says the person is not paged again: every place says that once,
 * in its own words, beside it (getOnCallPageNotPagedAgainSentence).
 */
export function getOnCallPassOnSentence(
  result: OnCallPassOnResult,
  wording: OnCallPassOnWording = {},
): string {
  const level: string | undefined = getKnownLevelLabel(
    result.rule,
    result.ruleCount,
    wording.keepTogether,
  );

  switch (result.outcome) {
    case OnCallPassOnOutcome.NextRulePaged: {
      if (result.isPreview) {
        return level
          ? `This will immediately page ${level}, without waiting.`
          : "This will immediately page the next level, without waiting.";
      }

      if (!level) {
        return "The policy is now paging the next level.";
      }

      const names: string = joinOnCallPassOnNames(result.pagedNames);

      return names
        ? `The policy is now paging ${level}: ${names}.`
        : `The policy is now paging ${level}.`;
    }
    case OnCallPassOnOutcome.PolicyStartedAgain: {
      if (result.isPreview) {
        return level
          ? `There is no level after yours, so this will immediately page ${level} again, without waiting.`
          : "There is no level after yours, so this will immediately page the first level again, without waiting.";
      }

      return level
        ? `There was no level after yours, so the policy started over and is paging ${level} again.`
        : "There was no level after yours, so the policy started over and is paging the first level again.";
    }
    case OnCallPassOnOutcome.OthersStillPaged: {
      const who: string =
        joinOnCallPassOnNames(result.stillPagedNames) || "Somebody else";
      const verb: string =
        result.stillPagedNames.length > 1 ? "are still" : "is still";
      const still: string = `${who} ${verb} being paged.`;

      if (result.isDirectPage || !result.nextStepAt) {
        return still;
      }

      const time: string = keepOnOneLine(
        getOnCallPassOnTime(result.nextStepAt, wording),
        wording.keepTogether,
      );
      const next: string | undefined = getKnownLevelLabel(
        result.nextRule,
        result.ruleCount,
        wording.keepTogether,
      );

      return next
        ? `${still} If nobody acknowledges by ${time}, the policy pages ${next} next.`
        : `${still} If nobody acknowledges by ${time}, the policy moves on.`;
    }
    case OnCallPassOnOutcome.AlreadyEscalated:
      return level
        ? `The policy has moved on already and is paging ${level} now.`
        : "The policy has moved on already and is paging a later level now.";
    case OnCallPassOnOutcome.PagingStopped:
    default:
      if (result.isPreview) {
        return result.isDirectPage
          ? "Nobody else is being paged: paging stops, and somebody needs to take it."
          : "Nobody else is left to page: paging stops, and somebody needs to take it.";
      }

      return "Nobody else is left to page, so paging stopped. Somebody needs to take it.";
  }
}

/*
 * Why a page could not be escalated, as a sentence: "Incident INC-42 was
 * already acknowledged by Ana Lopez, so there is nothing to escalate."
 */
export function getOnCallPassOnRefusalSentence(
  answer: OnCallPassOnAnswer,
  wording: OnCallPassOnWording = {},
): string {
  const record: string = (wording.recordLabel || "").trim() || "It";

  switch (answer.refusal) {
    case OnCallPassOnRefusal.RecordAcknowledged: {
      const byWhom: string = (answer.acknowledgedByName || "").trim();

      return byWhom
        ? `${record} was already acknowledged by ${byWhom}, so there is nothing to escalate.`
        : `${record} is already acknowledged, so there is nothing to escalate.`;
    }
    case OnCallPassOnRefusal.AlreadyPassedOn:
      return "You escalated it already, so you will not be paged again for it.";
    case OnCallPassOnRefusal.PageOver:
      return "This page is over: the on-call policy has stopped paging.";
    case OnCallPassOnRefusal.InvalidLink:
      return "This link cannot escalate the page: it is not valid, or it has expired. Use the link in the newest message you were paged with.";
    case OnCallPassOnRefusal.LevelNotAvailable:
      return ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE;
    case OnCallPassOnRefusal.NotPaged:
    default:
      return "You are not being paged about this right now.";
  }
}

// Why a level picked to page could not be (OnCallPassOnRefusal.LevelNotAvailable).
export const ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE: string =
  "The policy's levels have changed, so nothing was escalated. Escalate again to pick a level.";

/*
 * What the Escalate page a message's link opens says as it asks again,
 * because the level picked was not there to page. The levels as they are
 * now are right under it, the next one picked - so it says to pick one,
 * never to press Escalate to get to them: pressing it as it stands pages
 * the next level.
 */
export const ON_CALL_PAGE_LEVELS_CHANGED_PICK_AGAIN_NOTICE: string =
  "The policy's levels have changed, so nothing was escalated. Pick a level and escalate again.";

// The same, when one level is left after the person's: nothing to pick.
export const ON_CALL_PAGE_LEVELS_CHANGED_NOTICE: string =
  "The policy's levels have changed, so nothing was escalated.";

/*
 * The levels a preview offers to page (levelChoices), each once and in
 * order; none when it offers none. A level whose place or id cannot be
 * read is left out.
 */
export function getOnCallPassOnLevelChoices(
  result: OnCallPassOnResult | undefined | null,
): Array<OnCallPassOnLevelChoice> {
  const choices: Array<OnCallPassOnLevelChoice> = [];
  const seen: Set<string> = new Set<string>();
  const offered: unknown = result?.levelChoices;

  if (!Array.isArray(offered)) {
    return choices;
  }

  for (const item of offered as Array<unknown>) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const choice: OnCallPassOnLevelChoice = item as OnCallPassOnLevelChoice;
    const id: string =
      typeof choice.escalationRuleId === "string"
        ? choice.escalationRuleId.trim()
        : "";

    if (
      !id ||
      seen.has(id.toLowerCase()) ||
      typeof choice.order !== "number" ||
      !Number.isInteger(choice.order) ||
      choice.order < 1
    ) {
      continue;
    }

    seen.add(id.toLowerCase());
    choices.push(choice);
  }

  return choices.sort(
    (a: OnCallPassOnLevelChoice, b: OnCallPassOnLevelChoice): number => {
      return a.order - b.order;
    },
  );
}

/*
 * Whether there is a level to pick: two or more levels after the person's.
 * With one, escalating pages it, and nobody is asked which.
 */
export function hasOnCallPassOnLevelChoice(
  result: OnCallPassOnResult | undefined | null,
): boolean {
  return getOnCallPassOnLevelChoices(result).length > 1;
}

/*
 * The level of `choices` with the escalation rule given, or none - the
 * rule ids compared as written, in any case.
 */
export function findOnCallPassOnLevelChoice(
  choices: Array<OnCallPassOnLevelChoice>,
  escalationRuleId: string | undefined | null,
): OnCallPassOnLevelChoice | undefined {
  const id: string = (escalationRuleId || "").trim().toLowerCase();

  if (!id) {
    return undefined;
  }

  return choices.find((choice: OnCallPassOnLevelChoice): boolean => {
    return choice.escalationRuleId.trim().toLowerCase() === id;
  });
}

/*
 * What escalating would do with a later level picked: the preview with the
 * level it pages, and the levels it skips. The next level - or a level the
 * preview does not offer - is the preview as it is, skipping nothing.
 */
export function getOnCallPassOnPickedResult(
  result: OnCallPassOnResult,
  escalationRuleId: string | undefined | null,
): { result: OnCallPassOnResult; skipped: Array<OnCallPassOnRule> } {
  const choices: Array<OnCallPassOnLevelChoice> =
    getOnCallPassOnLevelChoices(result);
  const picked: OnCallPassOnLevelChoice | undefined =
    findOnCallPassOnLevelChoice(choices, escalationRuleId);

  if (
    !picked ||
    result.outcome !== OnCallPassOnOutcome.NextRulePaged ||
    picked === choices[0]
  ) {
    return { result: result, skipped: [] };
  }

  return {
    result: {
      ...result,
      rule: { order: picked.order, name: picked.name },
    },
    skipped: choices
      .filter((choice: OnCallPassOnLevelChoice): boolean => {
        return choice.order < picked.order;
      })
      .map((choice: OnCallPassOnLevelChoice): OnCallPassOnRule => {
        return { order: choice.order, name: choice.name };
      }),
  };
}

/*
 * What the Escalate page says where the person picks the level: the page
 * cannot say which until they have - "This will immediately page the level
 * you pick, without waiting."
 */
export const ON_CALL_PAGE_PICK_LEVEL_SENTENCE: string =
  "This will immediately page the level you pick, without waiting.";

/*
 * The radio group's label where a level is picked, on the Escalate page and
 * in the Dashboard's dialog: "Escalate to".
 */
export const ON_CALL_PAGE_ESCALATE_TO_LABEL: string = "Escalate to";

/*
 * The headings over what came of it, on the pages a message's links open -
 * the Dashboard's dialog uses the same words (PassOnPage). A refusal's
 * heading says why in a few words, never the button's own word: "Escalate"
 * over a refusal would read as an instruction.
 */
export const ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE: string =
  "Already acknowledged";
export const ON_CALL_PAGE_ALREADY_ESCALATED_TITLE: string = "Already escalated";
export const ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE: string =
  "Nothing to escalate";
// The level picked was not there to page (OnCallPassOnRefusal.LevelNotAvailable).
export const ON_CALL_PAGE_NOT_ESCALATED_TITLE: string = "Not escalated";

// "Incident escalated", "Alert Episode escalated": the heading once it is done.
export function getOnCallPageEscalatedTitle(recordName: string): string {
  const name: string = recordName.trim();

  return name ? `${name} escalated` : "Escalated";
}

/*
 * Whether escalating leaves - or left - nobody being paged: the last level
 * with no repeat, or everybody else escalated too. Every place says that one
 * as a warning, not in passing: nobody is on the record, and somebody still
 * needs to take it.
 */
export function isOnCallPassOnPagingStopped(
  result: OnCallPassOnResult,
): boolean {
  return result.outcome === OnCallPassOnOutcome.PagingStopped;
}

/*
 * The one line every place says beside what happens: the person who
 * escalated is not paged about it again by this run. "You will not be paged
 * again for this incident." - by what the page is about, as the place names
 * it ("incident", "alert episode"), or "for it" without one.
 */
export function getOnCallPageNotPagedAgainSentence(
  recordNoun?: string | undefined,
): string {
  const noun: string = (recordNoun || "").trim().toLowerCase();

  return noun
    ? `You will not be paged again for this ${noun}.`
    : "You will not be paged again for it.";
}

/*
 * Reads an answer back after JSON: nextStepAt comes as a string, and the
 * levels it offers are kept only as far as they can be read (each with an
 * id and a place).
 */
export function readOnCallPassOnResult(
  value: OnCallPassOnResult,
): OnCallPassOnResult {
  const levelChoices: Array<OnCallPassOnLevelChoice> = Array.isArray(
    (value as { levelChoices?: unknown }).levelChoices,
  )
    ? getOnCallPassOnLevelChoices(value).map(
        (choice: OnCallPassOnLevelChoice): OnCallPassOnLevelChoice => {
          return {
            escalationRuleId: String(choice.escalationRuleId),
            order: choice.order,
            ...(typeof choice.name === "string" && choice.name.trim()
              ? { name: choice.name }
              : {}),
          };
        },
      )
    : [];

  const withChoices: OnCallPassOnResult = {
    ...value,
    levelChoices: levelChoices.length > 0 ? levelChoices : undefined,
  };

  const nextStepAt: unknown = (value as { nextStepAt?: unknown }).nextStepAt;

  if (nextStepAt === undefined || nextStepAt === null) {
    return { ...withChoices, nextStepAt: undefined };
  }

  const date: Date =
    nextStepAt instanceof Date ? nextStepAt : new Date(String(nextStepAt));

  return {
    ...withChoices,
    nextStepAt: isNaN(date.getTime()) ? undefined : date,
  };
}
