import OnCallPageAs from "./OnCallPageAs";
import {
  OnCallPersonPageNotice,
  getOnCallPersonPageCallSentence,
  getOnCallPersonPageLead,
} from "./OnCallPersonPage";

/*
 * A PAGE THAT KEEPS PEOPLE INFORMED: AN OBSERVER'S PAGE.
 *
 * A page asks somebody to take an incident or an alert on. Answering it -
 * its link, a call's 1, a text, Acknowledge in Slack, Microsoft Teams or the
 * app - acknowledges the record, ends every other page about it, and makes
 * whoever answered the incident's Incident Commander when it has none. That
 * is what a responder's page is for.
 *
 * Some people need to know without taking the incident on: an oversight
 * team told about every critical incident another team owns, a manager told
 * when their service is down. They are paged AS OBSERVERS (OnCallPageAs) -
 * by an on-call rule set to page its policies as observers, a workflow's
 * page step, or a page from Slack or Microsoft Teams - and their page
 * differs from a responder's in what answering it does:
 *
 *   - IT SAYS THEY HAVE SEEN IT, AND NOTHING MORE. The record is not
 *     acknowledged, nobody else's page stops, and nobody becomes Incident
 *     Commander: the response stays with the people on it.
 *
 *   - IT GOES ON UNTIL ONE OF THE PEOPLE IT PAGED ANSWERS IT, OR ITS RECORD
 *     IS RESOLVED. The responders acknowledging the record does not mean the
 *     observers have seen it - it is usually acknowledged before they are
 *     told at all - so, as a page a person asked for (OnCallPersonPage), it
 *     is not ended by that. An observer's page waiting for working hours
 *     still pages when they begin, unless the record was resolved by then.
 *
 *   - IT NEVER PAGES AGAIN AFTER AN ACKNOWLEDGEMENT
 *     (OnCallAcknowledgementTimeout): getting the record resolved is its
 *     responders' work, not its observers'.
 *
 *   - ITS PEOPLE ARE NOT PULLED INTO THE RECORD'S SLACK OR MICROSOFT TEAMS
 *     CHANNEL BY BEING PAGED. A rule that invites on-call responders
 *     (NotificationRuleInvites) invites the responders; observers join
 *     when the rule names them, or their team, as anybody else would.
 *
 * An observer who decides to step in does what anybody does: acknowledges
 * the incident, takes a role on it. That is them taking it on, and it reads
 * as such.
 *
 * Every notification of the page says it in OneUptime's own words, and so do
 * the record's feed, the run's Slack and Microsoft Teams message and the
 * Dashboard. A run is an observer's page when its isObserverPage says so;
 * every run that existed before is a responder's.
 *
 * This file holds the rule and its words, for the server, the Dashboard and
 * the docs tests. It imports nothing that needs a server or React.
 */

// A run, a person's page or a step of one, read with what tells them apart.
export interface OnCallObserverPageRun {
  isObserverPage?: boolean | null | undefined;
}

// Whether a run pages its people as observers.
export function isOnCallObserverPage(
  run: OnCallObserverPageRun | null | undefined,
): boolean {
  return Boolean(run?.isObserverPage);
}

/*
 * What a rule, a workflow step or a chat form said - whatever was sent, read
 * as one of the two: Observers only when it says so, Responders for anything
 * else, as every page was before.
 */
export function toOnCallPageAs(value: unknown): OnCallPageAs {
  if (typeof value !== "string") {
    return OnCallPageAs.Responders;
  }

  const normalized: string = value.trim().toLowerCase();

  if (normalized === OnCallPageAs.Observers.toLowerCase()) {
    return OnCallPageAs.Observers;
  }

  // "Observer", as somebody writes it by hand in a workflow or the API.
  if (normalized === "observer") {
    return OnCallPageAs.Observers;
  }

  return OnCallPageAs.Responders;
}

// Whether what was said pages as observers (toOnCallPageAs).
export function isPageAsObservers(value: unknown): boolean {
  return toOnCallPageAs(value) === OnCallPageAs.Observers;
}

/*
 * The kind of record a page is about, as its words name it: "incident",
 * "alert", "incident episode", "alert episode".
 */
export type OnCallObserverPageRecordKind =
  | "incident"
  | "alert"
  | "incident episode"
  | "alert episode";

/*
 * What an observer's page tells the people it reaches, after what it is
 * about, in every notification with room for a sentence: an email, a push,
 * Slack, Microsoft Teams, Telegram, a text.
 */
export function getOnCallObserverPageNotice(
  kind: OnCallObserverPageRecordKind,
): string {
  return `You're paged as an observer, to keep you informed: the people responding stay on this ${kind}. Acknowledging this page only says you've seen it. It does not acknowledge the ${kind}.`;
}

/*
 * What a call says after what the page is about: a call says less, and says
 * it slowly, so the rest is in its prompt (getOnCallObserverPageCallPrompt).
 */
export function getOnCallObserverPageSpokenNotice(
  kind: OnCallObserverPageRecordKind,
): string {
  return `You are kept informed: the people responding stay on this ${kind}.`;
}

/*
 * What a call says first, where a first page's says "A new incident has been
 * created": "You are paged as an observer about an incident", or a person's
 * page's "Alice Kim paged you about an incident, as an observer". Every
 * kind of record starts with a vowel.
 */
export function getOnCallObserverPageCallSentence(data: {
  recordNoun: string;
  personPage?: OnCallPersonPageNotice | undefined;
}): string {
  if (data.personPage) {
    return `${getOnCallPersonPageCallSentence({
      recordNoun: data.recordNoun,
      notice: data.personPage,
    })}, as an observer`;
  }

  return `You are paged as an observer about an ${data.recordNoun}`;
}

// What a call asks for, where a responder's says "To acknowledge this incident, press 1".
export function getOnCallObserverPageCallPrompt(
  kind: OnCallObserverPageRecordKind,
): string {
  return `To say you have heard this, press 1. This does not acknowledge the ${kind}.`;
}

// What a call says once 1 is pressed.
export const ON_CALL_OBSERVER_PAGE_CALL_ANSWERED: string =
  "Thank you. The page is marked as heard. Good bye";

/*
 * What a chat or Telegram message, a push and an email open with, where a
 * first page's says "New incident assigned to you": "You're paged as an
 * observer", or a person's page's "Alice Kim paged you as an observer",
 * "Alice Kim paged Platform as observers".
 */
export function getOnCallObserverPageLead(
  personPage?: OnCallPersonPageNotice | undefined,
): string {
  if (!personPage) {
    return "You're paged as an observer";
  }

  const asWhat: string = (personPage.teamName || "").trim()
    ? "as observers"
    : "as an observer";

  return `${getOnCallPersonPageLead(personPage)} ${asWhat}`;
}

/*
 * An email's subject, where a responder's says "ACTION REQUIRED: Incident
 * INC-42 created - <title>": "FYI (observer): Incident INC-42 - <title>", or
 * a person's page's "FYI (observer): Alice Kim paged you about Incident
 * INC-42 - <title>". Nothing is required of an observer.
 */
export function getOnCallObserverPageEmailSubject(data: {
  recordLabel: string;
  recordTitle: string;
  personPage?: OnCallPersonPageNotice | undefined;
}): string {
  const about: string = `${data.recordLabel.trim()} - ${data.recordTitle.trim()}`;

  return data.personPage
    ? `FYI (observer): ${getOnCallPersonPageLead(data.personPage)} about ${about}`
    : `FYI (observer): ${about}`;
}

/*
 * A push notification's title, where a responder's says "New Incident
 * INC-42: <title>": "FYI: Incident INC-42: <title>".
 */
export function getOnCallObserverPagePushTitle(data: {
  recordLabel: string;
  recordTitle: string;
}): string {
  return `FYI: ${data.recordLabel.trim()}: ${data.recordTitle.trim()}`;
}

/*
 * A push notification's body: "You're paged as an observer, in Acme: the
 * people responding stay on this incident. Tap to view."
 */
export function getOnCallObserverPagePushBody(data: {
  kind: OnCallObserverPageRecordKind;
  projectName: string;
  personPage?: OnCallPersonPageNotice | undefined;
}): string {
  const project: string = data.projectName.trim();

  return `${getOnCallObserverPageLead(data.personPage)}${
    project ? `, in ${project}` : ""
  }: the people responding stay on this ${data.kind}. Tap to view.`;
}

/*
 * The words before a text message's link, where a responder's says "Ack or
 * escalate:": opening the link only marks the page seen.
 */
export const ON_CALL_OBSERVER_PAGE_SMS_ACTION: string = "Mark seen:";

// What a text message says after the product, before what it is about.
export const ON_CALL_OBSERVER_PAGE_SMS_LEAD: string = "FYI (observer)";

/*
 * The link that answers an observer's page, in a chat or Telegram message,
 * an email's button and the page it opens, where a responder's says
 * "Acknowledge": answering only says they have seen it.
 */
export const ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL: string = "I've seen it";

/*
 * "I'VE SEEN IT" FROM THE MOBILE APP: the person answers their own page as
 * an observer about a record, signed in as them - from the action under its
 * push, which opens the record's screen, or from the screen's own button -
 * as its link, a call's 1 or a text would. The record is not acknowledged,
 * and nobody else's page stops.
 *
 * GET  <api>/on-call-page/seen/<record type>/<record id>
 *   The signed-in person's observer pages about the record that they can
 *   still say they have seen: { pages: [...] }, one for each run. Empty for
 *   everybody else.
 * POST the same route
 *   Says they have seen them: { seen: N }, how many - 0 when there was none
 *   to answer: seen already, by them or by somebody else the page reached,
 *   or over, as its record is resolved.
 *
 * Only ever the caller's own pages, in the project they are signed in to:
 * nothing is sent but the record.
 */
export const ON_CALL_OBSERVER_PAGE_SEEN_ROUTE: string = "/on-call-page/seen";

// One observer's page the person can still say they have seen: a run's.
export interface OnCallObserverOpenPage {
  executionLogId: string;
  // The policy paging them; empty for a direct page.
  policyName: string;
}

// The GET answer: the person's observer pages about the record.
export interface OnCallObserverOpenPagesAnswer {
  pages: Array<OnCallObserverOpenPage>;
}

// The POST answer: how many of them it said the person has seen.
export interface OnCallObserverPageSeenAnswer {
  seen: number;
}

/*
 * Why the person gets an observer's email, where a responder's says they are
 * responsible for the incident or on call.
 */
export function getOnCallObserverPageEmailWhy(
  kind: OnCallObserverPageRecordKind,
): string {
  return `You are receiving this email because you are paged as an observer: to keep you informed about this ${kind} while the people responding stay on it.`;
}

/*
 * The run's status message once one of the people it paged answers it:
 * "Seen by Ana Lopez (ana@example.com), paged as an observer. The incident
 * is not acknowledged by this."
 */
export function getOnCallObserverPageSeenMessage(data: {
  kind: OnCallObserverPageRecordKind;
  userName: string;
  userEmail: string;
}): string {
  const name: string = (data.userName || "").trim();
  const email: string = (data.userEmail || "").trim();
  const who: string =
    name && email ? `${name} (${email})` : name || email || "somebody";

  return `Seen by ${who}, paged as an observer. The ${data.kind} is not acknowledged by this.`;
}

// A run that pages as observers, in a few words: the Dashboard's line under its status.
export const ON_CALL_OBSERVER_PAGE_LABEL: string = "Paged as observers";

/*
 * Why a page as observers about something new is refused: observers are
 * kept informed while somebody else responds, and nobody would be
 * responding to an alert the page itself creates.
 */
export const ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE: string =
  "Observers are kept informed about an incident or an alert that is already there, while somebody else responds. To page about something new, page responders.";
