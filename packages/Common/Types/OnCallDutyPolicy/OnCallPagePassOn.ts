/*
 * "CAN'T TAKE IT? PASS IT ON."
 *
 * Somebody an on-call policy pages may not be able to take the page: on a
 * flight, driving, at the dentist, deep in another incident. Until now the
 * policy waited out the whole escalation rule (30 minutes by default) before
 * it paged the next level, and those minutes were lost for nothing. The
 * person being paged can now pass the page on, from the page itself: the
 * email, the text, the call ("press 2"), the Slack or Microsoft Teams
 * message, the Dashboard and the mobile app. A customer called it NACK, a
 * negative acknowledgement; "pass it on" says what happens, in the words a
 * person woken at 3 a.m. reads at a glance.
 *
 * What passing a page on does:
 *
 * - The person is not paged about it again by that run: the notifications
 *   still due to them stop (a call after 10 minutes, a push that repeats),
 *   and the run's later escalation rules and repeats pass them over.
 * - The run moves on AT ONCE when nobody else on its current escalation rule
 *   is left to take the page - everybody else that rule paged has passed it
 *   on too: the next rule is paged straight away, as it would have been when
 *   the wait ran out. After the last rule the policy starts again from the
 *   first if its Repeat Policy says so, and otherwise stops, and the
 *   record's Slack and Microsoft Teams channels are told nobody took it.
 * - While somebody else on the rule is still being paged, the run waits for
 *   them as it always did: one person who cannot take a page does not wake
 *   the next level while a colleague on the same rule may still pick it up.
 * - A direct page (people, a team or a schedule paged with no policy) has no
 *   next rule: the person stops being paged, and once everybody it paged has
 *   passed it on, the page ends as one nobody took.
 * - It acknowledges nothing and changes nothing on the record. Acknowledging
 *   afterwards still works, and still stops all paging.
 *
 * Only the person being paged can pass their page on: through a link only
 * their own messages carry (signed, OnCallPageLinkToken), their own phone
 * call, or signed in as themselves.
 *
 * This file holds what every one of those places shares: the words, the
 * kinds of answer, and the sentences built from them. It is read by the
 * server, the Dashboard and the docs tests, so it imports nothing that needs
 * a server or React.
 */

import OneUptimeDate from "../Date";

// The action, on every button and link: "Pass it on".
export const PASS_IT_ON: string = "Pass it on";

// What leads up to it where there is room: "Can't take it?".
export const CANT_TAKE_IT: string = "Can't take it?";

// "Can't take it? Pass it on" - a link's text where one line says both.
export const CANT_TAKE_IT_PASS_IT_ON: string = `${CANT_TAKE_IT} ${PASS_IT_ON}`;

/*
 * The status message of a person's page that they passed on - their
 * notification log, and the run's timeline line for them. The feed reads it
 * back as one sentence (OnCallFeedText) rather than saying it twice.
 */
export const ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE: string =
  "Passed on: could not take this page.";

/*
 * The timeline's line for somebody a later escalation rule (or a repeat)
 * would have paged, who had passed this run's page on already. It is kept
 * on the run's own page only: the feed and the run's Slack and Microsoft
 * Teams message say once that the person passed it on, not once for every
 * rule after it.
 */
export const ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE: string =
  "Skipped because they passed this page on.";

/*
 * The status message of the delivery - the email, the text, the call - a
 * person passed their page on through.
 */
export const ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE: string =
  "Passed on from this notification.";

/*
 * The key a phone call asks the person to press to pass the page on, and
 * what it says about it, after "To acknowledge this incident, press 1.": "If
 * you can't take it, press 2 to pass it on." What it answers when the key is
 * pressed depends on what came of it (UserOnCallLogTimelineAPI).
 */
export const ON_CALL_PAGE_CALL_PASS_ON_DIGIT: string = "2";

export function getOnCallPageCallPassOnPrompt(): string {
  return `If you can't take it, press ${ON_CALL_PAGE_CALL_PASS_ON_DIGIT} to pass it on.`;
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
 *   The signed-in person's open pages about one record, and what passing
 *   them on would do.
 * POST <api>/on-call-page/pass-on/<record type>/<record id>
 *   Passes them on, and answers what it did.
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

// What passing a page on did - or, asked beforehand, would do.
export enum OnCallPassOnOutcome {
  /*
   * Nobody else on the run's current escalation rule was left to take it:
   * the next rule was paged straight away.
   */
  NextRulePaged = "NextRulePaged",
  /*
   * It was the policy's last rule and its Repeat Policy repeats: the policy
   * started again from its first rule straight away.
   */
  PolicyStartedAgain = "PolicyStartedAgain",
  /*
   * Nobody is left to page: it was the last rule with no repeat left, a
   * direct page whose people have all passed it on, or a run that had
   * stopped paging already. Somebody needs to take the record.
   */
  PagingStopped = "PagingStopped",
  /*
   * Somebody else on the current escalation rule (or on a direct page) is
   * still being paged: the run waits for them, as it always did.
   */
  OthersStillPaged = "OthersStillPaged",
  /*
   * The person's page was from an earlier escalation rule: the run has
   * moved on past it already, and goes on as it is.
   */
  AlreadyEscalated = "AlreadyEscalated",
}

// Why a page could not be passed on.
export enum OnCallPassOnRefusal {
  // The record is acknowledged or resolved: somebody has taken it.
  RecordAcknowledged = "RecordAcknowledged",
  // The person passed this page on already.
  AlreadyPassedOn = "AlreadyPassedOn",
  // The page is over: its run ended and the person's notifications are done.
  PageOver = "PageOver",
  // The person is not being paged about it.
  NotPaged = "NotPaged",
  // The link was not one of the person's own, or it has expired.
  InvalidLink = "InvalidLink",
}

export interface OnCallPassOnRule {
  order: number;
  name?: string | undefined;
}

/*
 * What passing on came to, or would come to (isPreview). Plain data, so the
 * Dashboard and the mobile app can word it in their own language; the
 * server words it with getOnCallPassOnSentence.
 */
export interface OnCallPassOnResult {
  outcome: OnCallPassOnOutcome;
  // True when this says what passing on WOULD do - nothing was changed.
  isPreview: boolean;
  // A direct page: no policy, so no escalation rules.
  isDirectPage: boolean;
  // The policy's name; empty for a direct page.
  policyName: string;
  /*
   * NextRulePaged: the rule now paging (a preview: the rule that would be).
   * PolicyStartedAgain: the first rule. AlreadyEscalated: the rule the run
   * is on.
   */
  rule?: OnCallPassOnRule | undefined;
  // The rule's people who were paged now. Empty in a preview.
  pagedNames: Array<string>;
  // OthersStillPaged: who else is still being paged.
  stillPagedNames: Array<string>;
  /*
   * OthersStillPaged on a policy's run: when the current rule's wait runs
   * out, and the rule after it then, when there is one.
   */
  nextStepAt?: Date | undefined;
  nextRule?: OnCallPassOnRule | undefined;
  // How many escalation rules the policy has, for "escalation rule 2 of 3".
  ruleCount: number;
}

// What passing on one page answers: done, with what came of it, or refused.
export interface OnCallPassOnAnswer {
  passedOn: boolean;
  result?: OnCallPassOnResult | undefined;
  refusal?: OnCallPassOnRefusal | undefined;
  /*
   * RecordAcknowledged: who acknowledged it, when that is known. Text, for
   * "Incident INC-42 was already acknowledged by Ana Lopez."
   */
  acknowledgedByName?: string | undefined;
}

// One page a person can pass on, and what passing it on would do.
export interface OnCallOpenPage {
  executionLogId: string;
  preview: OnCallPassOnResult;
}

/*
 * The Dashboard's GET answer: the signed-in person's open pages about the
 * record (empty when there is nothing to pass on).
 */
export interface OnCallOpenPagesAnswer {
  pages: Array<OnCallOpenPage>;
}

// The Dashboard's POST answer: one answer per page that was passed on.
export interface OnCallPassOnRecordAnswer {
  answers: Array<OnCallPassOnAnswer>;
}

export interface OnCallPassOnWording {
  // "Incident INC-42", "Alert #12" - what the page is about, for refusals.
  recordLabel?: string | undefined;
  // The reader's own time zone, for "by 5:28 AM UTC". Server time without one.
  timezone?: string | undefined;
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
 * "escalation rule 2 of 3 (Level 2)", or without the count or the name when
 * they are not known.
 */
export function getOnCallPassOnRuleLabel(
  rule: OnCallPassOnRule,
  ruleCount?: number | undefined,
): string {
  const position: string =
    ruleCount && ruleCount >= rule.order
      ? `escalation rule ${rule.order} of ${ruleCount}`
      : `escalation rule ${rule.order}`;

  const name: string = (rule.name || "").trim();

  return name ? `${position} (${name})` : position;
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}

// "5:28 AM UTC" in the reader's zone, or the server's without one.
function formatTime(at: Date, timezone: string | undefined): string {
  return OneUptimeDate.getDateAsFormattedStringInTimezone({
    date: at,
    timezone: timezone,
  });
}

/*
 * What passing on did, or would do, in plain sentences: what the confirm
 * page, the page after it, a phone call and the API answer say.
 *
 *   Escalation rule 2 of 3 (Level 2) is paging Sam Lee now.
 *   Bob Smith is still being paged. If nobody acknowledges by Oct 16, 2026,
 *     5:28 AM UTC, escalation rule 2 of 3 is next.
 *
 * It never says the person is not paged again: every place says that once,
 * in its own words, beside it.
 */
export function getOnCallPassOnSentence(
  result: OnCallPassOnResult,
  wording: OnCallPassOnWording = {},
): string {
  switch (result.outcome) {
    case OnCallPassOnOutcome.NextRulePaged: {
      const rule: string = result.rule
        ? getOnCallPassOnRuleLabel(result.rule, result.ruleCount)
        : "the next escalation rule";

      if (result.isPreview) {
        return `${capitalize(rule)} is paged right away, without waiting.`;
      }

      return result.pagedNames.length > 0
        ? `${capitalize(rule)} is paging ${joinOnCallPassOnNames(result.pagedNames)} now.`
        : `${capitalize(rule)} is next, and is being paged now.`;
    }
    case OnCallPassOnOutcome.PolicyStartedAgain: {
      const start: string = result.isPreview
        ? "This is the policy's last escalation rule, so the policy starts again from escalation rule 1 right away."
        : "That was the policy's last escalation rule, so the policy started again from escalation rule 1.";

      if (result.isPreview || result.pagedNames.length === 0) {
        return start;
      }

      return `${start} It is paging ${joinOnCallPassOnNames(result.pagedNames)} now.`;
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

      const next: string = result.nextRule
        ? `${getOnCallPassOnRuleLabel(result.nextRule, result.ruleCount)} is next`
        : "the policy moves on";

      return `${still} If nobody acknowledges by ${formatTime(
        result.nextStepAt,
        wording.timezone,
      )}, ${next}.`;
    }
    case OnCallPassOnOutcome.AlreadyEscalated: {
      const rule: string = result.rule
        ? getOnCallPassOnRuleLabel(result.rule, result.ruleCount)
        : "a later escalation rule";

      return `The policy has moved on already: ${rule} is paging now.`;
    }
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
 * Why a page could not be passed on, as a sentence: "Incident INC-42 was
 * already acknowledged by Ana Lopez, so there is nothing to pass on."
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
        ? `${record} was already acknowledged by ${byWhom}, so there is nothing to pass on.`
        : `${record} is already acknowledged, so there is nothing to pass on.`;
    }
    case OnCallPassOnRefusal.AlreadyPassedOn:
      return "You passed this page on already. You won't be paged about it again.";
    case OnCallPassOnRefusal.PageOver:
      return "This page is over: the on-call policy has stopped paging.";
    case OnCallPassOnRefusal.InvalidLink:
      return "This link cannot pass the page on: it is not valid, or it has expired. Use the link in the newest message you were paged with.";
    case OnCallPassOnRefusal.NotPaged:
    default:
      return "You are not being paged about this right now.";
  }
}

/*
 * The one line every place says beside what happens: the person who passed
 * it on is not paged about it again by this run.
 */
export const ON_CALL_PAGE_NOT_PAGED_AGAIN: string =
  "You won't be paged about it again.";

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
