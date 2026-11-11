import ObjectID from "../ObjectID";
import {
  OnCallPageAgainRun,
  isOnCallPageAgainRun,
} from "./OnCallAcknowledgementTimeout";
import {
  OnCallObserverPageRun,
  isOnCallObserverPage,
} from "./OnCallObserverPage";
import { OnCallPersonPageRun, isOnCallPersonPage } from "./OnCallPersonPage";

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
 *     (OnCallPersonPage) and an observer's page (OnCallObserverPage) are
 *     about a record that is often acknowledged already, and go on until one
 *     of their people answers them: the record being acknowledged ends none
 *     of them.
 *
 * Once it is over, the page says so - "Incident INC-42 was already
 * acknowledged by Ana Lopez." - with what it is about and the button that
 * opens it in the Dashboard, and no Acknowledge. Every read behind it is best
 * effort: a fact that cannot be read leaves Acknowledge offered, as it always
 * was, and the button that acknowledges checks again.
 */

export enum OnCallAcknowledgePageState {
  // The page still waits for an answer: Acknowledge is offered.
  Open = "Open",
  // The person answered their page already, here or another way.
  AcknowledgedByYou = "AcknowledgedByYou",
  /*
   * Somebody else took it: answered the page (a page again, a person's
   * page, an observer's page), or acknowledged the record (a responder's).
   */
  AcknowledgedBySomeoneElse = "AcknowledgedBySomeoneElse",
  // The record is resolved: every page of it is over.
  Resolved = "Resolved",
}

// The run a page is part of, read with what tells its kind and its answer apart.
export interface OnCallAcknowledgePageRun
  extends OnCallPageAgainRun,
    OnCallPersonPageRun,
    OnCallObserverPageRun {
  acknowledgedAt?: Date | string | null | undefined;
  acknowledgedByUserId?: ObjectID | string | null | undefined;
  acknowledgedByUser?: { name?: unknown; email?: unknown } | null | undefined;
}

// Where the record a page is about stands, by the one rule.
export interface OnCallAcknowledgePageRecord {
  // In a state that counts as acknowledged - resolved ones included.
  isAcknowledged: boolean;
  isResolved: boolean;
}

export interface OnCallAcknowledgePageFacts {
  // The person the page is for.
  personUserId?: ObjectID | string | null | undefined;
  // This message was answered from its own link already.
  isMessageAcknowledged: boolean;
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
  // AcknowledgedBySomeoneElse: who, when the run knows - a name, or an email.
  acknowledgedByName?: string | undefined;
}

/*
 * Whether a run goes on until one of its people answers it, or its record is
 * resolved - whoever acknowledges the record: a page again, a page a person
 * asked for, an observer's page.
 */
export function isOnCallPageEndedOnlyByAnAnswer(
  run: OnCallAcknowledgePageRun | null | undefined,
): boolean {
  return (
    isOnCallPageAgainRun(run) ||
    isOnCallPersonPage(run) ||
    isOnCallObserverPage(run)
  );
}

// What the acknowledge page offers, by the rule above.
export function getOnCallAcknowledgePageAnswer(
  facts: OnCallAcknowledgePageFacts,
): OnCallAcknowledgePageAnswer {
  const run: OnCallAcknowledgePageRun | null = facts.run;
  const isRunAnswered: boolean = Boolean(run?.acknowledgedAt);

  if (facts.record?.isResolved) {
    return { state: OnCallAcknowledgePageState.Resolved };
  }

  if (
    facts.isMessageAcknowledged ||
    (isRunAnswered &&
      isSamePerson(run?.acknowledgedByUserId, facts.personUserId))
  ) {
    return { state: OnCallAcknowledgePageState.AcknowledgedByYou };
  }

  // A page again, say, read as a responder's would lose its Acknowledge.
  if (facts.isRunUnknown) {
    return { state: OnCallAcknowledgePageState.Open };
  }

  const isTaken: boolean = isOnCallPageEndedOnlyByAnAnswer(run)
    ? isRunAnswered
    : Boolean(facts.record?.isAcknowledged);

  if (!isTaken) {
    return { state: OnCallAcknowledgePageState.Open };
  }

  /*
   * Who answered the run, when somebody did. A record acknowledged some
   * other way - the Dashboard, Slack, a workflow - is said to be
   * acknowledged, without a name.
   */
  const name: string = isRunAnswered
    ? getOnCallAcknowledgePagePersonName(run?.acknowledgedByUser)
    : "";

  return {
    state: OnCallAcknowledgePageState.AcknowledgedBySomeoneElse,
    ...(name ? { acknowledgedByName: name } : {}),
  };
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
 * The sentence under that heading: who took it, as far as it is known.
 *
 *   Incident INC-42 was already acknowledged by Ana Lopez.
 *   You already acknowledged Incident INC-42.
 *   Incident INC-42 is already resolved.
 *
 * `recordLabel` names the record at the start of a sentence ("Incident
 * INC-42", "This incident"), `recordLabelInSentence` inside one ("Incident
 * INC-42", "this incident"). An observer's page is marked as seen, never
 * acknowledged: what they answer is the page, not the record.
 */
export function getOnCallAcknowledgePageAnsweredSentence(data: {
  answer: OnCallAcknowledgePageAnswer;
  isObserverPage: boolean;
  recordLabel: string;
  recordLabelInSentence: string;
}): string {
  const label: string = data.recordLabel.trim() || "It";
  const labelInSentence: string = data.recordLabelInSentence.trim() || "it";
  const byWhom: string = (data.answer.acknowledgedByName || "").trim();

  switch (data.answer.state) {
    case OnCallAcknowledgePageState.Resolved:
      return `${label} is already resolved.`;
    case OnCallAcknowledgePageState.AcknowledgedByYou:
      return data.isObserverPage
        ? "You already marked this page as seen."
        : `You already acknowledged ${labelInSentence}.`;
    case OnCallAcknowledgePageState.AcknowledgedBySomeoneElse:
    default:
      if (data.isObserverPage) {
        return byWhom
          ? `${byWhom} already marked this page as seen.`
          : "This page is already marked as seen.";
      }

      return byWhom
        ? `${label} was already acknowledged by ${byWhom}.`
        : `${label} is already acknowledged.`;
  }
}

function isSamePerson(
  a: ObjectID | string | null | undefined,
  b: ObjectID | string | null | undefined,
): boolean {
  const first: string = a ? a.toString().trim().toLowerCase() : "";
  const second: string = b ? b.toString().trim().toLowerCase() : "";

  return Boolean(first) && first === second;
}
