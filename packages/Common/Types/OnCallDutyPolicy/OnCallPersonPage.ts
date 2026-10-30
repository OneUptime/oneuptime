import ObjectID from "../ObjectID";

/*
 * A PAGE A PERSON ASKED FOR.
 *
 * Somebody in Slack or Microsoft Teams paged people, a team or whoever is
 * on call in a schedule, by name - `/oneuptime page`, "page" typed to the
 * Teams bot, an incident's Page Someone. It is a direct page
 * (OnCallDirectPage): no on-call policy behind it, and no workflow. It
 * reaches each person through their own On-Call Rules, as every page does,
 * and differs from a page OneUptime starts on its own in two ways.
 *
 * IT GOES ON UNTIL ONE OF THE PEOPLE IT PAGED ANSWERS IT, OR ITS INCIDENT OR
 * ALERT IS RESOLVED. Somebody else acknowledging the incident does not stop
 * it: the person who paged asked for these people, and that somebody else is
 * on the incident does not mean they have seen it. Paging from an incident's
 * own channel is mostly paging somebody into an incident that is being
 * worked on - acknowledged already - and a page that stopped because of that
 * reached them by its first notification only: no call ten minutes later, no
 * push that repeats. Answering it - its link, a call's 1, a text -
 * acknowledges the incident or alert too when nobody has yet, and stops the
 * page for everybody it paged, as acknowledging always did.
 *
 * IT SAYS WHO PAGED, AND WHY YOU. Worded as a page OneUptime starts, a page
 * about an incident that was declared an hour ago told the person paged
 * that "a new incident has been created", and nobody could tell who wanted
 * them or that they were paged as a member of a team. A person's page says
 * it in every notification that is OneUptime's own words - a push, a text, a
 * call, an email, a Slack or Microsoft Teams message, Telegram - with the
 * team or the schedule they were paged through, and the message the person
 * who paged wrote, where the notification has room for it (OnCallPersonPageNotice).
 * WhatsApp's words are a template Meta approved, and stay as they are.
 *
 * This file holds the rule and its words, for the server (the workers that
 * end runs, the notifications, the runs' chat messages) and for the docs
 * tests. It imports nothing that needs a server or React.
 */

// A run, read with what tells a person's page apart.
export interface OnCallPersonPageRun {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
  triggeredByUserId?: ObjectID | string | null | undefined;
  triggeredByWorkflowId?: ObjectID | string | null | undefined;
}

/*
 * Whether a run is a page a person asked for: a direct page - no policy, by
 * its id or by the policy read with it - started by a person, with no
 * workflow behind it. Asked only of a run read with all four of those
 * columns: one read without them would not look like one.
 */
export function isOnCallPersonPage(
  run: OnCallPersonPageRun | null | undefined,
): boolean {
  if (!run) {
    return false;
  }

  if (run.onCallDutyPolicyId || run.onCallDutyPolicy) {
    return false;
  }

  return Boolean(run.triggeredByUserId) && !run.triggeredByWorkflowId;
}

/*
 * The longest message a person's page carries: what an alert's title holds,
 * so a message reads the same whichever kind of record the page is about.
 */
export const ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH: number = 500;

// A run of white space: a message is kept on one line.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

/*
 * A page's message as it is kept: on one line, without white space at its
 * ends, cut to ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH with "…". Empty for
 * none.
 */
export function toOnCallPersonPageMessage(
  message: string | null | undefined,
): string {
  const text: string = (message || "").replace(WHITE_SPACE_RUN, " ").trim();

  if (text.length <= ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH) {
    return text;
  }

  return `${text
    .substring(0, ON_CALL_PERSON_PAGE_MESSAGE_MAX_LENGTH - 1)
    .trimEnd()}…`;
}

/*
 * WHAT A PERSON'S PAGE SAYS TO THE PEOPLE IT PAGES, besides what it is
 * about: who paged, how this person was reached - by name, as a member of a
 * team, as on call in a schedule - and the message, when there is one.
 */
export interface OnCallPersonPageNotice {
  // Who paged: their name, or their email address.
  pagedByName: string;
  // The team the person was paged as a member of.
  teamName?: string | undefined;
  // The schedule the person was paged as on call in.
  scheduleName?: string | undefined;
  // What the person who paged wrote. Empty for none.
  message?: string | undefined;
}

// The name of who paged, never empty.
function pager(notice: OnCallPersonPageNotice): string {
  return notice.pagedByName.trim() || "Someone";
}

/*
 * Who was paged, as the person who paged named them - the team first, then
 * the person reading it is one of its members: "you", "Team Platform",
 * "whoever is on call in Primary".
 */
function paged(notice: OnCallPersonPageNotice): string {
  const teamName: string = (notice.teamName || "").trim();

  if (teamName) {
    return teamName;
  }

  const scheduleName: string = (notice.scheduleName || "").trim();

  if (scheduleName) {
    return `whoever is on call in ${scheduleName}`;
  }

  return "you";
}

/*
 * The page's first words, where a page OneUptime starts says "New incident
 * assigned to you": "Alice Kim paged you", "Alice Kim paged Platform",
 * "Alice Kim paged whoever is on call in Primary".
 */
export function getOnCallPersonPageLead(notice: OnCallPersonPageNotice): string {
  return `${pager(notice)} paged ${paged(notice)}`;
}

/*
 * Why the person reading it was paged, where a page OneUptime starts says
 * "You're getting this because you're on call.": "You're getting this
 * because you're a member of Platform.", "... because you're on call in
 * Primary.", "... because Alice Kim paged you by name."
 */
export function getOnCallPersonPageWhyLine(
  notice: OnCallPersonPageNotice,
): string {
  const teamName: string = (notice.teamName || "").trim();

  if (teamName) {
    return `You're getting this because you're a member of ${teamName}.`;
  }

  const scheduleName: string = (notice.scheduleName || "").trim();

  if (scheduleName) {
    return `You're getting this because you're on call in ${scheduleName}.`;
  }

  return `You're getting this because ${pager(notice)} paged you by name.`;
}

// The page's message, when it has one: what the person who paged wrote.
export function getOnCallPersonPageMessage(
  notice: OnCallPersonPageNotice,
): string {
  return toOnCallPersonPageMessage(notice.message);
}

/*
 * A push notification's title, where a page OneUptime starts says "New
 * Incident INC-42: <title>": "Alice Kim paged you: Incident INC-42".
 * `recordLabel` is the record's kind and number: "Incident INC-42".
 */
export function getOnCallPersonPagePushTitle(data: {
  recordLabel: string;
  notice: OnCallPersonPageNotice;
}): string {
  return `${getOnCallPersonPageLead(data.notice)}: ${data.recordLabel.trim()}`;
}

/*
 * A push notification's body: the record's title and project, then the
 * message - "Checkout is down, in Acme. “Can you check the database?”" -
 * where a page OneUptime starts says "A new incident has been created".
 */
export function getOnCallPersonPagePushBody(data: {
  recordTitle: string;
  projectName: string;
  notice: OnCallPersonPageNotice;
}): string {
  const title: string = data.recordTitle.trim();
  const project: string = data.projectName.trim();
  const message: string = getOnCallPersonPageMessage(data.notice);

  const what: string = project ? `${title}, in ${project}.` : `${title}.`;

  return message ? `${what} “${message}”` : what;
}

/*
 * What a call says first, where a first page's says "A new incident has
 * been created": "Alice Kim paged you about an incident", "Alice Kim paged
 * Platform about an incident". Every kind of record starts with a vowel.
 */
export function getOnCallPersonPageCallSentence(data: {
  recordNoun: string;
  notice: OnCallPersonPageNotice;
}): string {
  return `${getOnCallPersonPageLead(data.notice)} about an ${data.recordNoun}`;
}

/*
 * What a call says after the record, when the page has a message: "Alice
 * Kim says: Can you check the database?". Empty for none.
 */
export function getOnCallPersonPageCallMessage(
  notice: OnCallPersonPageNotice,
): string {
  const message: string = getOnCallPersonPageMessage(notice);

  return message ? `${pager(notice)} says: ${message}` : "";
}

/*
 * What an email says first, where a first page's says "A new incident has
 * been created in the project - Acme": "Alice Kim paged you about this
 * incident in the project Acme.", "Alice Kim paged Platform about this
 * incident in the project Acme. You're a member of Platform."
 */
export function getOnCallPersonPageEmailLine(data: {
  recordNoun: string;
  projectName: string;
  notice: OnCallPersonPageNotice;
}): string {
  const project: string = data.projectName.trim();
  const teamName: string = (data.notice.teamName || "").trim();
  const scheduleName: string = (data.notice.scheduleName || "").trim();

  const first: string = `${getOnCallPersonPageLead(data.notice)} about this ${
    data.recordNoun
  }${project ? ` in the project ${project}` : ""}.`;

  if (teamName) {
    return `${first} You're a member of ${teamName}.`;
  }

  if (scheduleName) {
    return `${first} You're on call in ${scheduleName}.`;
  }

  return first;
}

/*
 * The line an email shows the message on, when the page has one: "Alice
 * Kim wrote: “Can you check the database?”". Empty for none.
 */
export function getOnCallPersonPageEmailMessageLine(
  notice: OnCallPersonPageNotice,
): string {
  const message: string = getOnCallPersonPageMessage(notice);

  return message ? `${pager(notice)} wrote: “${message}”` : "";
}

/*
 * An email's subject, where a first page's says "ACTION REQUIRED: Incident
 * INC-42 created - <title>": "ACTION REQUIRED: Alice Kim paged you about
 * Incident INC-42 - <title>".
 */
export function getOnCallPersonPageEmailSubject(data: {
  recordLabel: string;
  recordTitle: string;
  notice: OnCallPersonPageNotice;
}): string {
  return `ACTION REQUIRED: ${getOnCallPersonPageLead(
    data.notice,
  )} about ${data.recordLabel.trim()} - ${data.recordTitle.trim()}`;
}
