import OneUptimeDate from "../Date";
import ObjectID from "../ObjectID";
import Timezone from "../Timezone";
import {
  OnCallPageAgainRun,
  isOnCallPageAgainRun,
} from "./OnCallAcknowledgementTimeout";
import {
  OnCallObserverPageRun,
  isOnCallObserverPage,
} from "./OnCallObserverPage";
import {
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  getOnCallPassOnTime,
  isOnCallPassOnTimeToday,
} from "./OnCallPagePassOn";
import { OnCallPersonPageRun, isOnCallPersonPage } from "./OnCallPersonPage";
import {
  OnCallPolicyStartedByHandRun,
  isOnCallPolicyStartedByHand,
} from "./OnCallPolicyStartedByHand";

/*
 * WHAT THE ACKNOWLEDGE PAGE A MESSAGE'S LINK OPENS OFFERS.
 *
 * Every message a page sends - a text, an email, WhatsApp, Telegram, a push,
 * Slack, Microsoft Teams - links to one page about it (UserOnCallLogTimelineAPI's
 * acknowledge-page): what the page is about, with Acknowledge. It asked
 * "Do you want to acknowledge this incident?" whatever had happened since the
 * message was sent, so somebody opening it after the incident was taken - by
 * a colleague, by themselves from another message or the Dashboard, or moved
 * on to a state after Acknowledged - was asked to acknowledge it again
 * (https://github.com/OneUptime/oneuptime/issues/6706). Everywhere else,
 * Acknowledge is offered only to a record that is not acknowledged yet
 * (Common/Utils/AcknowledgedState).
 *
 * So the page offers Acknowledge only while the person's page still waits for
 * an answer, by the rule the worker that sends the page's notifications ends
 * it with (Workers/Jobs/UserOnCallLog/ExecutePendingExecutions):
 *
 *   - a record that is resolved ends every page of it;
 *   - the person's own answer ends their page: this message's link, or any
 *     other way they answered the page - another message's link, a call's 1,
 *     a text, the app (the run then records them as who acknowledged it);
 *   - a responder's page is over once its record is acknowledged - by the
 *     one rule, so a state after Acknowledged counts - whoever did it;
 *   - a page again (OnCallAcknowledgementTimeout), a page a person asked for
 *     (OnCallPersonPage), a policy a person started by hand
 *     (OnCallPolicyStartedByHand) and an observer's page (OnCallObserverPage)
 *     are about a record that is often acknowledged already, and go on until
 *     one of their people answers them: the record being acknowledged ends
 *     none of them.
 *
 * Once it is over, the page says so, with what it is about and the button
 * that opens it in the Dashboard, and no Acknowledge - who took it, and when,
 * as Slack and Microsoft Teams answer a press that came too late
 * (https://github.com/OneUptime/oneuptime/issues/6711):
 *
 *   Incident INC-42 was already acknowledged by Ana Lopez at 5:28 AM UTC.
 *
 * Who and when come from where the page was taken: for a responder's page,
 * the record's own state timeline - its latest acknowledgement, or its latest
 * resolve - whether that was a page's answer, the Dashboard, the app, Slack
 * or a workflow; for the pages that go on until answered, the answer to the
 * page, as the run records it. The person themselves is "you". The time is on
 * the reader's own clock.
 *
 * Every read behind it is best effort: a fact that cannot be read leaves
 * Acknowledge offered, as it always was - or, once the page is over, leaves
 * out who or when - and the button that acknowledges checks again.
 */

export enum OnCallAcknowledgePageState {
  // The page still waits for an answer: Acknowledge is offered.
  Open = "Open",
  // The person answered their page already, here or another way.
  AcknowledgedByYou = "AcknowledgedByYou",
  /*
   * Somebody else took it: answered the page (a page again, a person's
   * page, a policy started by hand, an observer's page), or acknowledged the
   * record (a responder's).
   */
  AcknowledgedBySomeoneElse = "AcknowledgedBySomeoneElse",
  // The record is resolved: every page of it is over.
  Resolved = "Resolved",
}

// The run a page is part of, read with what tells its kind and its answer apart.
export interface OnCallAcknowledgePageRun
  extends OnCallPageAgainRun,
    OnCallPersonPageRun,
    OnCallPolicyStartedByHandRun,
    OnCallObserverPageRun {
  acknowledgedAt?: Date | string | null | undefined;
  acknowledgedByUserId?: ObjectID | string | null | undefined;
  acknowledgedByUser?: { name?: unknown; email?: unknown } | null | undefined;
}

// A change that took a record, or a page, where it stands: who made it, and when.
export interface OnCallAcknowledgePageChange {
  // Who made it; nobody by name for an API key, a workflow, a monitor.
  byUserId?: ObjectID | string | null | undefined;
  /*
   * Who made it, as the page names them (getOnCallAcknowledgePagePersonName):
   * empty when that is not known.
   */
  byName?: string | undefined;
  at?: Date | string | null | undefined;
}

// Where the record a page is about stands, by the one rule.
export interface OnCallAcknowledgePageRecord {
  // In a state that counts as acknowledged - resolved ones included.
  isAcknowledged: boolean;
  isResolved: boolean;
  /*
   * Who acknowledged it, and when: its latest acknowledgement, by its state
   * timeline. Undefined when that is not known.
   */
  acknowledgement?: OnCallAcknowledgePageChange | undefined;
  // Who resolved it, and when. Undefined when that is not known.
  resolution?: OnCallAcknowledgePageChange | undefined;
}

export interface OnCallAcknowledgePageFacts {
  // The person the page is for.
  personUserId?: ObjectID | string | null | undefined;
  // This message was answered from its own link already.
  isMessageAcknowledged: boolean;
  // When it was.
  messageAcknowledgedAt?: Date | string | null | undefined;
  // The run, as read; null when the page has none or it could not be read.
  run: OnCallAcknowledgePageRun | null;
  /*
   * The page has a run that could not be read: what kind of page it is is
   * not known, so the record being acknowledged ends nothing - only the
   * person's own answer, or a resolve, does.
   */
  isRunUnknown?: boolean | undefined;
  // The record, as read; null when it is gone or could not be read.
  record: OnCallAcknowledgePageRecord | null;
}

export interface OnCallAcknowledgePageAnswer {
  state: OnCallAcknowledgePageState;
  /*
   * Who took it - answered the page, acknowledged the record, resolved it -
   * when it is somebody else and known: a name, or an email.
   */
  byName?: string | undefined;
  // When it was taken - answered, acknowledged or resolved - when known.
  at?: Date | undefined;
  // Resolved by the person the page is for.
  isByYou?: true | undefined;
}

/*
 * Whether a run goes on until one of its people answers it, or its record is
 * resolved - whoever acknowledges the record: a page again, a page a person
 * asked for, a policy a person started by hand, an observer's page. The one
 * rule the workers that page end runs by, and everything that says whether a
 * page is still waiting for an answer.
 */
export function isOnCallPageEndedOnlyByAnAnswer(
  run: OnCallAcknowledgePageRun | null | undefined,
): boolean {
  return (
    isOnCallPageAgainRun(run) ||
    isOnCallPersonPage(run) ||
    isOnCallPolicyStartedByHand(run) ||
    isOnCallObserverPage(run)
  );
}

/*
 * Whether a person answers their page of a run as the page it is, once its
 * record is acknowledged: a page again, a page a person asked for, a policy a
 * person started by hand. The record's own Acknowledge is gone then, so the
 * Dashboard and the app offer "Acknowledge again" for it
 * (OnCallAcknowledgementTimeout.acknowledgePagesAgainForRecord). Not an
 * observer's page: an observer says they have seen it instead.
 */
export function isOnCallPageAnsweredAsAPage(
  run: OnCallAcknowledgePageRun | null | undefined,
): boolean {
  return isOnCallPageEndedOnlyByAnAnswer(run) && !isOnCallObserverPage(run);
}

// What the acknowledge page offers, by the rule above.
export function getOnCallAcknowledgePageAnswer(
  facts: OnCallAcknowledgePageFacts,
): OnCallAcknowledgePageAnswer {
  const run: OnCallAcknowledgePageRun | null = facts.run;

  // The answer to the page, as the run records it.
  const runAnswer: OnCallAcknowledgePageChange | undefined = run?.acknowledgedAt
    ? {
        byUserId: run.acknowledgedByUserId,
        byName: getOnCallAcknowledgePagePersonName(run.acknowledgedByUser),
        at: run.acknowledgedAt,
      }
    : undefined;

  if (facts.record?.isResolved) {
    return takenBy(
      OnCallAcknowledgePageState.Resolved,
      facts.record.resolution,
      facts.personUserId,
    );
  }

  if (facts.isMessageAcknowledged) {
    return withTime(
      { state: OnCallAcknowledgePageState.AcknowledgedByYou },
      facts.messageAcknowledgedAt,
    );
  }

  if (runAnswer && isSamePerson(runAnswer.byUserId, facts.personUserId)) {
    return withTime(
      { state: OnCallAcknowledgePageState.AcknowledgedByYou },
      runAnswer.at,
    );
  }

  // A page again, say, read as a responder's would lose its Acknowledge.
  if (facts.isRunUnknown) {
    return { state: OnCallAcknowledgePageState.Open };
  }

  // Taken only by an answer to the page, which the run records.
  if (isOnCallPageEndedOnlyByAnAnswer(run)) {
    return runAnswer
      ? takenBy(
          OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
          runAnswer,
          facts.personUserId,
        )
      : { state: OnCallAcknowledgePageState.Open };
  }

  if (!facts.record?.isAcknowledged) {
    return { state: OnCallAcknowledgePageState.Open };
  }

  /*
   * A responder's page, over with its record's acknowledgement: whoever
   * acknowledged the record, by its state timeline - a page's answer, the
   * Dashboard, the app, Slack alike - or the run's answer when the timeline
   * does not say.
   */
  return takenBy(
    OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
    facts.record.acknowledgement || runAnswer,
    facts.personUserId,
  );
}

// Whether the page still offers Acknowledge.
export function isOnCallAcknowledgePageOpen(
  answer: OnCallAcknowledgePageAnswer,
): boolean {
  return answer.state === OnCallAcknowledgePageState.Open;
}

// A person as the page names them: their name, else their email, else nothing.
export function getOnCallAcknowledgePagePersonName(
  user: { name?: unknown; email?: unknown } | null | undefined,
): string {
  const name: string = user?.name ? String(user.name).trim() : "";

  if (name) {
    return name;
  }

  return user?.email ? String(user.email).trim() : "";
}

/*
 * The heading over a page that no longer offers Acknowledge: "Already
 * acknowledged", "Already resolved" - or, for an observer, "Already marked as
 * seen", since an observer's answer acknowledges nothing.
 */
export function getOnCallAcknowledgePageAnsweredHeading(data: {
  state: OnCallAcknowledgePageState;
  isObserverPage: boolean;
}): string {
  if (data.state === OnCallAcknowledgePageState.Resolved) {
    return ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_RESOLVED_TITLE;
  }

  return data.isObserverPage
    ? ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_SEEN_TITLE
    : ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_ACKNOWLEDGED_TITLE;
}

export const ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_ACKNOWLEDGED_TITLE: string =
  "Already acknowledged";
export const ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_RESOLVED_TITLE: string =
  "Already resolved";
export const ON_CALL_ACKNOWLEDGE_PAGE_ALREADY_SEEN_TITLE: string =
  "Already marked as seen";

/*
 * When it was taken, as the page says it, on the reader's own clock: "at
 * 5:28 AM UTC" the same day, "on Oct 17, 2026, 12:10 AM UTC" another - the
 * time the Escalate page words a time with (getOnCallPassOnTime), kept on one
 * line of a phone. A zone OneUptime does not know reads as UTC: the page's
 * whole purpose is to inform, and a wrong zone would say a wrong time.
 */
export function getOnCallAcknowledgePageMoment(data: {
  at: Date;
  timezone?: string | undefined;
  now?: Date | undefined;
}): string {
  const timezone: string = toKnownTimezone(data.timezone);

  const time: string = getOnCallPassOnTime(data.at, {
    timezone: timezone,
    now: data.now,
  });

  const isToday: boolean = isOnCallPassOnTimeToday({
    at: data.at,
    now: data.now,
    timezone: timezone,
  });

  return `${isToday ? "at" : "on"} ${time
    .split(" ")
    .join(ON_CALL_PASS_ON_NO_BREAK_SPACE)}`;
}

/*
 * The sentence under that heading: who took it, and when, as far as it is
 * known.
 *
 *   Incident INC-42 was already acknowledged by Ana Lopez at 5:28 AM UTC.
 *   You already acknowledged Incident INC-42 at 5:28 AM UTC.
 *   Incident INC-42 was already resolved by Ana Lopez at 6:10 AM UTC.
 *   Incident INC-42 is already acknowledged.
 *
 * `recordLabel` names the record at the start of a sentence ("Incident
 * INC-42", "This incident"), `recordLabelInSentence` inside one ("Incident
 * INC-42", "this incident"). An observer's page is marked as seen, never
 * acknowledged: what they answer is the page, not the record. Times are in
 * `timezone`, the reader's own, and say their date on another day than
 * `now`.
 */
export function getOnCallAcknowledgePageAnsweredSentence(data: {
  answer: OnCallAcknowledgePageAnswer;
  isObserverPage: boolean;
  recordLabel: string;
  recordLabelInSentence: string;
  timezone?: string | undefined;
  now?: Date | undefined;
}): string {
  const label: string = data.recordLabel.trim() || "It";
  const labelInSentence: string = data.recordLabelInSentence.trim() || "it";
  const byWhom: string = (data.answer.byName || "").trim();
  const when: string = data.answer.at
    ? ` ${getOnCallAcknowledgePageMoment({
        at: data.answer.at,
        timezone: data.timezone,
        now: data.now,
      })}`
    : "";

  switch (data.answer.state) {
    case OnCallAcknowledgePageState.Resolved:
      if (data.answer.isByYou) {
        return `You already resolved ${labelInSentence}${when}.`;
      }

      if (byWhom) {
        return `${label} was already resolved by ${byWhom}${when}.`;
      }

      return when
        ? `${label} was already resolved${when}.`
        : `${label} is already resolved.`;
    case OnCallAcknowledgePageState.AcknowledgedByYou:
      return data.isObserverPage
        ? `You already marked this page as seen${when}.`
        : `You already acknowledged ${labelInSentence}${when}.`;
    case OnCallAcknowledgePageState.AcknowledgedBySomeoneElse:
    default:
      if (data.isObserverPage) {
        if (byWhom) {
          return `${byWhom} already marked this page as seen${when}.`;
        }

        return when
          ? `This page was already marked as seen${when}.`
          : "This page is already marked as seen.";
      }

      if (byWhom) {
        return `${label} was already acknowledged by ${byWhom}${when}.`;
      }

      return when
        ? `${label} was already acknowledged${when}.`
        : `${label} is already acknowledged.`;
  }
}

/*
 * An answer that names who took it and when, from the change that did: the
 * person themselves is "you" - their own acknowledgement, from the Dashboard
 * say, is theirs.
 */
function takenBy(
  state: OnCallAcknowledgePageState,
  change: OnCallAcknowledgePageChange | undefined,
  personUserId: ObjectID | string | null | undefined,
): OnCallAcknowledgePageAnswer {
  const isByYou: boolean = isSamePerson(change?.byUserId, personUserId);

  if (
    isByYou &&
    state === OnCallAcknowledgePageState.AcknowledgedBySomeoneElse
  ) {
    return withTime(
      { state: OnCallAcknowledgePageState.AcknowledgedByYou },
      change?.at,
    );
  }

  const name: string = isByYou ? "" : (change?.byName || "").trim();

  return withTime(
    {
      state: state,
      ...(name ? { byName: name } : {}),
      ...(isByYou ? { isByYou: true as const } : {}),
    },
    change?.at,
  );
}

// The answer, with when it was taken when that is a moment.
function withTime(
  answer: OnCallAcknowledgePageAnswer,
  at: Date | string | null | undefined,
): OnCallAcknowledgePageAnswer {
  if (!at) {
    return answer;
  }

  const date: Date = OneUptimeDate.fromString(at);

  return Number.isNaN(date.getTime()) ? answer : { ...answer, at: date };
}

function toKnownTimezone(timezone: string | undefined): string {
  return timezone &&
    Object.values(Timezone).includes(timezone as unknown as Timezone)
    ? timezone
    : Timezone.UTC;
}

function isSamePerson(
  a: ObjectID | string | null | undefined,
  b: ObjectID | string | null | undefined,
): boolean {
  const first: string = a ? a.toString().trim().toLowerCase() : "";
  const second: string = b ? b.toString().trim().toLowerCase() : "";

  return Boolean(first) && first === second;
}
