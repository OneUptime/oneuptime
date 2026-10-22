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
 *   Escalates them, and answers what it did.
 */
export const ON_CALL_PAGE_PASS_ON_ROUTE: string = "/on-call-page/pass-on";

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
}

// An escalation rule - a level of the policy - by its place and name.
export interface OnCallPassOnRule {
  order: number;
  name?: string | undefined;
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
    case OnCallPassOnRefusal.NotPaged:
    default:
      return "You are not being paged about this right now.";
  }
}

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

// Reads an answer's dates back after JSON: nextStepAt comes as a string.
export function readOnCallPassOnResult(
  value: OnCallPassOnResult,
): OnCallPassOnResult {
  const nextStepAt: unknown = (value as { nextStepAt?: unknown }).nextStepAt;

  if (nextStepAt === undefined || nextStepAt === null) {
    return { ...value, nextStepAt: undefined };
  }

  const date: Date =
    nextStepAt instanceof Date ? nextStepAt : new Date(String(nextStepAt));

  return {
    ...value,
    nextStepAt: isNaN(date.getTime()) ? undefined : date,
  };
}
