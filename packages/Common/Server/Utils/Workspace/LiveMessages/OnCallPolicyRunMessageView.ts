import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../../ProductBrandingText";
import WorkspaceMessageTime from "../WorkspaceMessageTime";
import { getOnCallPageAgainChatReason } from "../../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { getOnCallPassOnLevelLabel } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";

/*
 * WHAT ONE ON-CALL POLICY RUN LOOKS LIKE IN SLACK AND MICROSOFT TEAMS.
 *
 * A run used to post a message for every step - "On Call Policy Started
 * Executing", "Status Updated ... Started", "... Executing", "... Completed",
 * and an "On-Call Alert Notification Sent to <person>" paragraph for every
 * person on every escalation rule and every repeat, each of those twice - so
 * twenty minutes of escalation buried an incident channel. Now a run is ONE
 * message that is edited as the run goes (OnCallPolicyRunMessage). It reads
 * top to bottom the way a responder needs it:
 *
 *   📟 PolicyX is paging for Incident INC-8                 what is happening
 *
 *   Second shift (Level 2 of 3): if nobody                  where the run is, what
 *   acknowledges by 5:28 PM, Night shift (Level 3 of 3)     happens next, and when
 *   is next.
 *
 * A level is named as the Escalate dialog names it (OnCallPagePassOn's
 * getOnCallPassOnLevelLabel): its name, then its place - or its place
 * alone, "Level 2 of 3", when it has no name of its own.
 *
 *   • Nitin: paged twice · by SMS and email                 who was paged, how often
 *   • NB User 2: not paged · not a member of this project   and how - and who was not
 *
 *   See every step in OneUptime                             the run's own page
 *
 * A person paged as the next in a schedule's rotation - the backup after
 * whoever is on call, which an escalation rule can page at the level after
 * the schedule's own - says so, as a person covering for somebody does:
 *
 *   • Alex: paged once · by SMS
 *   • Sam (next in the Primary rotation): paged once · by SMS and email
 *   • Nobody was next in the Secondary rotation
 *
 * Everybody is in one list - who was paged first, then who was not - with
 * no label over it: Slack sets a blank line between a label and its list,
 * and with a label and a list for each the message ran to fifteen lines,
 * half a phone screen. The next step names a moment ("by 5:28 PM", in each
 * reader's own time: WorkspaceMessageTime), not a wait: the message is
 * edited for as long as the run goes, and "within 7 minutes" never said
 * from when. An edit notifies nobody, so the channel stays quiet while the
 * run is on track.
 *
 * It is loud - a new message - only where somebody has to act (getAlarms):
 * the first time an escalation rule reaches nobody, and when the run ends
 * without anybody taking the record (nobody acknowledged, nobody could be
 * reached, it could not run, the policy was archived under it). Somebody
 * acknowledging is loud already: the record's state change says who.
 *
 * A LEVEL WITH NOBODY TO PAGE is passed at once (OnCallEmptyLevel): the run
 * pages the next level the same moment, and the message says so - in its
 * list, and in the alarm about the first such level, which asks for the
 * policy to be fixed rather than for somebody to be paged:
 *
 *   • Level 1 of 2: nobody to page, so Level 2 of 2 was paged at once
 *
 *   ⚠️ PolicyX paged nobody at Level 1 of 2 for Alert #12 (the rule has
 *   nobody to page), so Level 2 of 2 was paged at once. Fix the policy so
 *   this level pages someone.
 *
 * The alarm is raised only where the level is passed after the run's
 * message was first posted - a later level, after an earlier one waited:
 * a message posted after the level says it in its list already, and its
 * first post raises no alarm on top of itself (OnCallPolicyRunMessage).
 *
 * This file only turns a run into words - Markdown that Slack and Microsoft
 * Teams render the same way, and the plain text a notification shows of it
 * - so it can be read and tested on its own. Every name in it (the
 * policy's, a person's, a rule's, a schedule's) is text, placed with
 * mdText, so none of them can become a link, a mention or formatting.
 *
 * A DIRECT PAGE - people, a team or a schedule paged with no policy behind
 * the page (Types/OnCallDutyPolicy/OnCallDirectPage) - is a run too, and
 * reads the same way with whoever started it where the policy is. It pages
 * everybody at once, so it has no escalation rule to say it is on:
 *
 *   📟 Workflow Page the on-call engineer is paging for Incident INC-8
 *
 *   • Nitin: paged once · by SMS and email
 *   • Nobody was on call in schedule Secondary
 *
 *   See every step in OneUptime
 *
 * Its message is first posted once it has gone through everybody it names
 * (OnCallPolicyRunMessage), so a direct page that reached nobody is that
 * one message, with no alarm after it - and says what to do next itself:
 *
 *   ⚠️ Workflow Page the on-call engineer could not reach anyone for
 *   Incident INC-8
 *
 *   • Nobody was on call in schedule Secondary
 *
 *   Check who is on call, or page someone yourself.
 *
 *   See every step in OneUptime
 *
 * WHERE SOMEBODY PAGED FROM A CHAT (`/oneuptime page`), the run's message
 * says what the page is about too: the record's title - the message they
 * typed - under its first line, as they wrote it. The record's own places
 * have its title right above, in the message that announced it.
 *
 *   📟 Simon Lee is paging for Alert #12
 *
 *   “The checkout API is throwing 500s”
 *
 *   • Nawaz: paged once · by push and SMS
 *
 *   See every step in OneUptime
 *
 * A page a PERSON started ends as the paging ending, not as the person
 * doing something: "✅ Nawaz acknowledged Alert #12, so paging stopped". A
 * policy or a workflow stops paging itself ("so PolicyX stopped paging");
 * "so Simon Lee stopped paging" read as if Simon had called his page off.
 *
 * In an incident's or an alert's own channel a page is about that incident
 * or alert (WorkspacePage), and what the person who paged wrote is the
 * page's message, kept on the run: the message quotes it under its first
 * line, everywhere it is posted - the record's title is right above, in the
 * message that announced the record:
 *
 *   📟 Simon Lee is paging for Incident INC-8
 *
 *   “Can you check the database?”
 *
 *   • Nawaz: paged once · by SMS
 *
 * Such a page goes on until somebody it paged answers it, or the record is
 * resolved (OnCallPersonPage) - somebody else acknowledging the incident
 * does not stop it. When it ends with nobody answering while the record
 * is acknowledged, somebody is on the record: the ending says the page went
 * unanswered, not that somebody needs to take the record.
 *
 *   ⚠️ Nobody answered the page from Simon Lee for Incident INC-8
 *
 * A TEAM IS NAMED by each person it paged, as the person's reason for being
 * paged - "member of Platform" - the way a person covering for somebody is:
 *
 *   • Nawaz (member of Platform): paged once · by SMS
 *   • Sam (member of Platform): acknowledged · paged once
 *
 * and an alarm names the team first, then its people: "Simon Lee paged
 * Platform (Nawaz and Sam), and paging has stopped".
 *
 * SOMEBODY WHO CANNOT TAKE A PAGE can escalate it (OnCallPagePassOn). Their
 * line says so, and the run's progress says where it moved on to - straight
 * away, when nobody else on the rule was left:
 *
 *   • Alex: escalated · paged once · by SMS
 *   • Sam (next in the Primary rotation): paged once · by push
 *
 * When everybody it paged escalated it, the run ends with nobody on the
 * record, and that is loud: "⚠️ Nobody can take Incident INC-8: everybody
 * paged by PolicyX escalated it (Alex and Sam). Someone needs to take it."
 *
 * A RUN THAT WAITS TO PAGE - an on-call rule's, until its working hours
 * (OnCallDutyPolicyRunWait) - pages nobody yet, and its message says so and
 * when paging starts, in the words OneUptime says it in everywhere, the
 * moment in each reader's own time. Once it starts, the same message is
 * edited into a paging run's; a record handled while it waits ends it with
 * nobody paged, which is no alarm:
 *
 *   ⏳ PolicyX is waiting to page for Alert #12
 *
 *   Waiting for working hours. Paging starts tomorrow at 9:00 AM.
 *
 *   See every step in OneUptime
 *
 *   ✅ Alert #12 moved to Resolved, so PolicyX did not page anyone
 */

// How a run's message is drawn for one place.
export interface OnCallPolicyRunViewOptions {
  /*
   * The record's title, under the first line: set where somebody paged
   * from a chat, for whom it is what the page is about.
   */
  recordTitle?: string | undefined;
}

// How a run stands, as the message tells it.
export enum OnCallPolicyRunOutcome {
  /*
   * Waiting to page, paging nobody yet: held until working hours
   * (OnCallDutyPolicyRunWait). Not an ending: it starts paging later.
   */
  Waiting = "Waiting",
  // Still escalating.
  Paging = "Paging",
  // A person acknowledged their page.
  Acknowledged = "Acknowledged",
  // The record was acknowledged or resolved some other way: paging stopped.
  RecordHandled = "RecordHandled",
  /*
   * The record was acknowledged or resolved while the run waited to page:
   * it ended having paged nobody, and nobody needed paging.
   */
  HandledWhileWaiting = "HandledWhileWaiting",
  // The policy was archived while the run was escalating.
  PolicyArchived = "PolicyArchived",
  // Every escalation rule (and repeat) ran, people were paged, nobody acknowledged.
  NobodyAcknowledged = "NobodyAcknowledged",
  /*
   * A page a person asked for (OnCallPersonPage) whose people were all
   * paged, none of them answering, about a record somebody else had
   * acknowledged by then: somebody is on the record, and the page went
   * unanswered.
   */
  NobodyAnswered = "NobodyAnswered",
  // Every escalation rule ran and none of them reached anybody.
  NobodyReached = "NobodyReached",
  /*
   * Everybody the run paged escalated the page (OnCallPagePassOn): nobody
   * was left to page, and nobody took it.
   */
  EverybodyPassedOn = "EverybodyPassedOn",
  // The run could not page anybody at all (an archived policy, no rules, an error).
  Failed = "Failed",
}

export interface OnCallPolicyRunRule {
  order: number;
  name?: string | undefined;
}

// A person the run paged, once per run however often.
export interface OnCallPolicyRunPagedPerson {
  name: string;
  // Pages that went out to them (one per escalation rule and repeat).
  timesPaged: number;
  // A page to them is still going out.
  isBeingPaged: boolean;
  acknowledged: boolean;
  // They could not take it, and escalated it (OnCallPagePassOn).
  passedOn?: boolean | undefined;
  // How their pages reached them: "email", "SMS", "call", ...
  methods: Array<string>;
  // The people an override routed their pages from.
  coveringFor: Array<string>;
  /*
   * The schedules they were paged in as the next person in the rotation -
   * the backup after whoever is on call - by name. Empty when every page
   * was for another reason.
   */
  nextInRotationOf?: Array<string> | undefined;
  /*
   * The teams they were paged as a member of - a team a direct page or an
   * escalation rule named - by name. Empty when no page reached them
   * through a team.
   */
  teams?: Array<string> | undefined;
}

// Somebody, or some step, the run could not page, once per reason.
export interface OnCallPolicyRunNotPaged {
  // The person, when it is about a person.
  personName?: string | undefined;
  // The schedule that had nobody on call, when it is about a schedule.
  scheduleName?: string | undefined;
  /*
   * About that schedule: somebody was on call in it, but nobody was next in
   * its rotation, for a rule that pages the next person.
   */
  nobodyNextInRotation?: boolean | undefined;
  // The team a direct page named that has no members, when it is about one.
  teamName?: string | undefined;
  // The escalation rule that had nobody to page at all.
  rule?: OnCallPolicyRunRule | undefined;
  /*
   * About that rule: the level the run moved on to at once, since nobody
   * was there to wait for (OnCallEmptyLevel). Unset after the last level,
   * and for a run that waited the rule out.
   */
  movedOnTo?: OnCallPolicyRunRule | undefined;
  // Why, as a phrase: "not a member of this project".
  reason: string;
  /*
   * A page to the person went out and failed ("could not be paged (...)"),
   * rather than being skipped.
   */
  failed?: boolean | undefined;
  /*
   * The person is away with nobody named to cover (a user override that
   * skips them) until then: "not paged · away until Oct 17, 2026 at 5:00 PM",
   * in each reader's own time.
   */
  awayUntil?: Date | undefined;
}

/*
 * Who started a direct page, named in its message where an on-call policy's
 * run names the policy: the workflow whose step started it, or the person.
 * With neither, the product itself is named.
 */
export interface OnCallDirectPageRun {
  startedByWorkflowName?: string | undefined;
  // The workflow in the Dashboard, when the run recorded which one it was.
  startedByWorkflowUrl?: string | undefined;
  startedByPersonName?: string | undefined;
}

export interface OnCallPolicyRun {
  // Empty for a direct page, which has no policy (directPage).
  policyName: string;
  policyUrl: string;
  /*
   * Set for a direct page: who started it. Such a run has no escalation
   * rules - ruleCount is 0, and it is never on one.
   */
  directPage?: OnCallDirectPageRun | undefined;
  // The run's own page in OneUptime: every step, in order.
  runUrl: string;
  /*
   * What the person who paged wrote to the people the page reaches - a
   * page from an incident's or an alert's own channel (pageMessage).
   * Empty for none.
   */
  pageMessage?: string | undefined;
  // "Incident INC-8", "Alert #12", "Incident Episode EP-3", ...
  recordLabel: string;
  recordUrl: string;
  outcome: OnCallPolicyRunOutcome;
  /*
   * Failed: what went wrong. RecordHandled, HandledWhileWaiting: the
   * record's state name.
   */
  outcomeDetail?: string | undefined;
  /*
   * Waiting: when paging starts, and whether it waits for working hours
   * (OnCallDutyPolicyRunWait) or for a moment some other caller named.
   */
  pagingStartsAt?: Date | undefined;
  isWaitingForWorkingHours?: boolean | undefined;
  /*
   * A run that waited and started before its hours began: why. Its record
   * came to match an on-call rule that pages right away
   * (WaitingRunsOnRecordChange).
   */
  startedEarlyReason?: string | undefined;
  /*
   * A page again (OnCallAcknowledgementTimeout): which time its policy
   * pages again because the record stayed acknowledged without being
   * resolved. Unset for every other run.
   */
  pageAgainNumber?: number | undefined;
  acknowledgedByName?: string | undefined;
  ruleCount: number;
  // The escalation rule the run is on (or ended on).
  currentRule?: OnCallPolicyRunRule | undefined;
  // The rule after it, when there is one.
  nextRule?: OnCallPolicyRunRule | undefined;
  // How long the run waits on the current rule before moving on.
  escalateAfterInMinutes: number;
  /*
   * When that wait is over, when the run knows when the current rule
   * started: the moment the next step names ("by 5:28 PM").
   */
  nextStepAt?: Date | undefined;
  // Which pass this is (0 is the first), and how many repeats the policy allows.
  repeatNumber: number;
  repeatsAllowed: number;
  paged: Array<OnCallPolicyRunPagedPerson>;
  notPaged: Array<OnCallPolicyRunNotPaged>;
  /*
   * The first escalation rule that reached nobody at all, when one did:
   * the step to raise an alarm about.
   */
  firstRuleThatReachedNobody?:
    | {
        rule: OnCallPolicyRunRule;
        // Text, or Markdown that holds a moment ("Ana: away until <time>").
        reasons: Array<string | MarkdownText>;
        /*
         * The level the run moved on to at once from it (OnCallEmptyLevel).
         * Unset after the last level, and for a run that waited it out.
         */
        movedOnTo?: OnCallPolicyRunRule | undefined;
      }
    | undefined;
}

// A new message the run posts because somebody has to act.
export interface OnCallPolicyRunAlarm {
  // At most one alarm per key per run.
  key: string;
  markdown: string;
  // What its notification says: one line of plain text.
  text: string;
}

export const ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE: string =
  "nobody-paged-at-a-rule";
export const ON_CALL_RUN_ALARM_OUTCOME: string = "outcome";

// The reason of a person skipped without one: they were just not paged.
export const ON_CALL_RUN_NOT_PAGED: string = "not paged";

/*
 * What somebody who reads "nobody could be reached" does next. It ends the
 * alarm of a run that reached nobody, and the message of a direct page
 * that did (getMarkdown).
 */
export const WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED: MarkdownText = mdText`Check who is on call, or page someone yourself.`;

/*
 * What the person who paged does next when nobody they paged answered,
 * about a record somebody else is on (OnCallPolicyRunOutcome.NobodyAnswered).
 */
export const WHAT_TO_DO_WHEN_NOBODY_ANSWERED: MarkdownText = mdText`Page someone else, or reach them another way.`;

// How many of the people paged an alarm names before "and N others".
const MAX_NAMES_IN_AN_ALARM: number = 5;

// A sentence's own end: ".", "!" or "?".
const SENTENCE_END: RegExp = /[.!?]$/;

// A run of white space in a record's title: one space in a message's line.
const WHITE_SPACE_RUN: RegExp = /\s+/g;

/*
 * How much of a record's title a message shows, where somebody paged from a
 * chat: an alert's title holds 500 characters, and the alert's link has all
 * of it. Two hundred is three lines in a channel and five on a phone; much
 * more and the quote buries who was paged, which the message is for.
 */
export const ON_CALL_RUN_MAX_RECORD_TITLE_LENGTH: number = 200;

export default class OnCallPolicyRunMessageView {
  /*
   * Why a rule did not page somebody who is away with nobody named to cover,
   * for the alarm about a rule that reached nobody: "Alex Kim: away until
   * <day and time>", in each reader's own time.
   */
  public static getAwayReason(
    personName: string,
    awayUntil: Date,
  ): MarkdownText {
    return mdText`${personName}: away until ${WorkspaceMessageTime.dateAndTime(awayUntil)}`;
  }

  /*
   * Why a person was paged as the backup after whoever is on call: "next in
   * the Primary rotation". The schedule's name is text.
   */
  public static getNextInRotationReason(scheduleName: string): MarkdownText {
    return mdText`next in the ${scheduleName} rotation`;
  }

  /*
   * Why a person was paged as a member of a team - a team a direct page or
   * an escalation rule named: "member of Platform", "member of Platform and
   * Database". The teams' names are text.
   */
  public static getTeamReason(teamNames: Array<string>): MarkdownText {
    return mdText`member of ${this.joinNames(teamNames)}`;
  }

  /*
   * Why a rule that pages the next person in a schedule's rotation paged
   * nobody there, for the alarm about a rule that reached nobody: "nobody
   * was next in the Primary rotation".
   */
  public static getNobodyNextInRotationReason(
    scheduleName: string,
  ): MarkdownText {
    return mdText`nobody was next in the ${scheduleName} rotation`;
  }

  // The run's message, as Markdown.
  public static getMarkdown(
    run: OnCallPolicyRun,
    options?: OnCallPolicyRunViewOptions | undefined,
  ): string {
    const parts: Array<MarkdownText> = [this.getHeadline(run)];

    /*
     * What the person who paged wrote, everywhere - or, where somebody
     * paged from a chat about something new, what the page is about: its
     * alert's title, which is their message.
     */
    const quote: string = this.getQuote(run, options);

    if (quote) {
      parts.push(mdText`“${quote}”`);
    }

    /*
     * Started before the working hours it waited for, because its record
     * came to match a rule that pages right away: why it is paging now.
     */
    const startedEarlyReason: string = (run.startedEarlyReason || "").trim();

    if (startedEarlyReason) {
      parts.push(mdText`**Started early.** ${startedEarlyReason}`);
    }

    /*
     * A page again: why the policy pages about a record somebody had
     * acknowledged already - said for as long as the run is told, as a
     * start that came early is.
     */
    if (run.pageAgainNumber && run.pageAgainNumber > 0) {
      parts.push(
        mdText`**Paged again** ${getOnCallPageAgainChatReason(run.pageAgainNumber)}`,
      );
    }

    // A direct page pages everybody at once: there is no rule it is on.
    if (run.outcome === OnCallPolicyRunOutcome.Paging && !run.directPage) {
      parts.push(this.getProgress(run));
    }

    // Waiting to page: why, and when paging starts.
    if (run.outcome === OnCallPolicyRunOutcome.Waiting) {
      const waiting: MarkdownText | null = this.getWaiting(run);

      if (waiting) {
        parts.push(waiting);
      }
    }

    const people: Array<MarkdownText> = [
      ...run.paged.map((person: OnCallPolicyRunPagedPerson): MarkdownText => {
        return this.getPagedPersonLine(person);
      }),
      ...run.notPaged.map((entry: OnCallPolicyRunNotPaged): MarkdownText => {
        return this.getNotPagedLine(entry, run.ruleCount);
      }),
    ];

    if (people.length > 0) {
      parts.push(FeedMarkdown.bulletList(people));
    }

    /*
     * A direct page that reached nobody is over as soon as it has gone
     * through the people it names, and its message is first posted then
     * (OnCallPolicyRunMessage): this message is all the channel is told. A
     * first post raises no alarm on top of itself, so it says what the
     * alarm would have - what to do next - itself.
     */
    if (
      run.directPage &&
      run.outcome === OnCallPolicyRunOutcome.NobodyReached
    ) {
      parts.push(WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED);
    }

    parts.push(
      mdText`[See every step in ${ProductBrandingText.getProductName()}](${run.runUrl})`,
    );

    return FeedMarkdown.join(parts, "\n\n").toString();
  }

  /*
   * The message as one line of plain text: what a notification, a message
   * preview or a screen reader shows of it.
   */
  public static getPlainText(
    run: OnCallPolicyRun,
    options?: OnCallPolicyRunViewOptions | undefined,
  ): string {
    const line: string = this.getPlainTextLine(run);
    const quote: string = this.getQuote(run, options);

    // The page's message, or what the page is about, after it.
    return quote ? `${line}: ${quote}` : line;
  }

  /*
   * What the message quotes under its first line: the page's message - what
   * the person who paged wrote (pageMessage) - or, where somebody paged
   * from a chat, the record's title. On one line, cut to a length a chat
   * line reads at a glance. Empty when there is nothing to quote.
   */
  private static getQuote(
    run: OnCallPolicyRun,
    options: OnCallPolicyRunViewOptions | undefined,
  ): string {
    const quote: string = (run.pageMessage || options?.recordTitle || "")
      .replace(WHITE_SPACE_RUN, " ")
      .trim();

    if (quote.length <= ON_CALL_RUN_MAX_RECORD_TITLE_LENGTH) {
      return quote;
    }

    return `${quote.substring(0, ON_CALL_RUN_MAX_RECORD_TITLE_LENGTH - 1).trimEnd()}…`;
  }

  private static getPlainTextLine(run: OnCallPolicyRun): string {
    // The policy, or who started a direct page: what the line is about.
    const pagerName: string = this.getPagerName(run);
    const pagerNameInSentence: string = this.getPagerName(run, {
      isInSentence: true,
    });
    // A person's page: the paging stops, not the person (see the header).
    const isStartedByPerson: boolean = this.isStartedByPerson(run);

    switch (run.outcome) {
      case OnCallPolicyRunOutcome.Waiting:
        return `${pagerName} is waiting to page for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.HandledWhileWaiting:
        return run.outcomeDetail
          ? `${run.recordLabel} moved to ${run.outcomeDetail}, so ${pagerNameInSentence} did not page anyone`
          : `${pagerName} did not page anyone for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.Paging:
        return run.pageAgainNumber
          ? `${pagerName} is paging again for ${run.recordLabel}`
          : `${pagerName} is paging for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.Acknowledged:
        return `${run.acknowledgedByName || "Someone"} acknowledged ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.RecordHandled:
        if (isStartedByPerson) {
          return run.outcomeDetail
            ? `${run.recordLabel} moved to ${run.outcomeDetail}, so paging stopped`
            : `Paging stopped for ${run.recordLabel}`;
        }

        return run.outcomeDetail
          ? `${run.recordLabel} moved to ${run.outcomeDetail}, so ${pagerNameInSentence} stopped paging`
          : `${pagerName} stopped paging for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.PolicyArchived:
        return `${pagerName} stopped paging for ${run.recordLabel}: the policy was archived`;
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        // A page again's record was acknowledged earlier: its page was not.
        return run.pageAgainNumber
          ? `Nobody answered the page again for ${run.recordLabel}`
          : `Nobody acknowledged ${run.recordLabel}`;
      // A person's page, about a record somebody else is on.
      case OnCallPolicyRunOutcome.NobodyAnswered:
        return `Nobody answered the page from ${pagerNameInSentence} for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.EverybodyPassedOn:
        return `Nobody could take ${run.recordLabel}: everybody paged by ${pagerNameInSentence} escalated it`;
      case OnCallPolicyRunOutcome.NobodyReached:
        return `${pagerName} could not reach anyone for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.Failed:
      default:
        if (run.paged.length > 0) {
          return isStartedByPerson
            ? `Paging stopped for ${run.recordLabel}`
            : `${pagerName} stopped paging for ${run.recordLabel}`;
        }

        return `${pagerName} could not page anyone for ${run.recordLabel}`;
    }
  }

  /*
   * The new messages the run's state calls for, each at most once per run
   * (by key): the first escalation rule that reached nobody, and an ending
   * that leaves the record with nobody on it. A run that ends with somebody
   * on it - acknowledged, or the record handled - raises none. Each says
   * what happened first and what to do last, and carries the line its
   * notification shows.
   */
  public static getAlarms(run: OnCallPolicyRun): Array<OnCallPolicyRunAlarm> {
    const alarms: Array<OnCallPolicyRunAlarm> = [];

    const record: MarkdownText = mdText`**[${run.recordLabel}](${run.recordUrl})**`;
    // The policy, or who started a direct page.
    const policy: MarkdownText = this.getPager(run);
    const pagerName: string = this.getPagerName(run);
    // A person's page: the paging stops, not the person (see the header).
    const isStartedByPerson: boolean = this.isStartedByPerson(run);

    /*
     * A rule that reached nobody is said only while nobody is on the record:
     * once somebody acknowledged, or the record was handled, there is
     * nobody left to page.
     */
    const isSomebodyOnIt: boolean =
      run.outcome === OnCallPolicyRunOutcome.Acknowledged ||
      run.outcome === OnCallPolicyRunOutcome.RecordHandled ||
      run.outcome === OnCallPolicyRunOutcome.HandledWhileWaiting;

    if (run.firstRuleThatReachedNobody && !isSomebodyOnIt) {
      const reasons: Array<string | MarkdownText> =
        run.firstRuleThatReachedNobody.reasons;
      const rule: string = this.getRuleLabel(
        run.firstRuleThatReachedNobody.rule,
        run.ruleCount,
      );
      const why: MarkdownText =
        reasons.length > 0
          ? mdText` (${FeedMarkdown.join(reasons, "; ")})`
          : FeedMarkdown.empty();
      const movedOnTo: OnCallPolicyRunRule | undefined =
        run.firstRuleThatReachedNobody.movedOnTo;

      /*
       * The policy and the rule first: earlier rules may have paged people,
       * so "Nobody was paged for Incident INC-8" would not be true. Why, in
       * brackets: the reasons themselves read "NB User 2: not a member ...".
       *
       * A level passed at once (OnCallEmptyLevel) held nobody up: the next
       * level was paged that moment, so what is left to do is to fix the
       * policy, not to page somebody.
       */
      if (movedOnTo) {
        const next: string = this.getRuleLabel(movedOnTo, run.ruleCount);

        alarms.push({
          key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
          markdown:
            mdText`⚠️ ${policy} paged nobody at ${rule} for ${record}${why}, so ${next} was paged at once. Fix the policy so this level pages someone.`.toString(),
          text: `${run.policyName} paged nobody at ${rule} for ${run.recordLabel}, so ${next} was paged at once`,
        });
      } else {
        alarms.push({
          key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
          markdown:
            mdText`⚠️ ${policy} paged nobody at ${rule} for ${record}${why}. If nobody is on it yet, page someone or fix the policy.`.toString(),
          text: `${run.policyName} paged nobody at ${rule} for ${run.recordLabel}`,
        });
      }
    }

    switch (run.outcome) {
      /*
       * A page again (OnCallAcknowledgementTimeout) about a record somebody
       * acknowledged earlier, which nobody answered: nobody is on it now.
       */
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        if (run.pageAgainNumber) {
          alarms.push({
            key: ON_CALL_RUN_ALARM_OUTCOME,
            markdown:
              mdText`⚠️ Nobody answered the page again for ${record}: it is still not resolved. ${policy} paged ${this.getPagedNames(run)}, went through every escalation rule${this.getRepeatsDoneClause(run)} and has stopped paging. Someone needs to take it.`.toString(),
            text: `Nobody answered the page again for ${run.recordLabel}: someone needs to take it`,
          });
          break;
        }

        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown: run.directPage
            ? // Everybody was paged at once, and each page has sent all it had to.
              mdText`⚠️ Nobody has acknowledged ${record}. ${policy} paged ${this.getPagedNames(run)}, and ${isStartedByPerson ? mdText`paging has stopped` : mdText`has stopped paging`}. Someone needs to take it.`.toString()
            : mdText`⚠️ Nobody has acknowledged ${record}. ${policy} paged ${this.getPagedNames(run)}, went through every escalation rule${this.getRepeatsDoneClause(run)} and has stopped paging. Someone needs to take it.`.toString(),
          text: `Nobody has acknowledged ${run.recordLabel}: someone needs to take it`,
        });
        break;
      /*
       * A person's page about a record somebody else is on: nobody needs to
       * take the record - the person who paged needs somebody else.
       */
      case OnCallPolicyRunOutcome.NobodyAnswered:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody answered the page for ${record}: ${policy} paged ${this.getPagedNames(run)}, and paging has stopped. ${WHAT_TO_DO_WHEN_NOBODY_ANSWERED}`.toString(),
          text: `Nobody answered the page from ${this.getPagerName(run, { isInSentence: true })} for ${run.recordLabel}`,
        });
        break;
      case OnCallPolicyRunOutcome.EverybodyPassedOn:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody can take ${record}: everybody paged by ${this.getPager(run, { isInSentence: true })} escalated it (${this.getPagedNames(run)}). Someone needs to take it.`.toString(),
          text: `Nobody can take ${run.recordLabel}: someone needs to take it`,
        });
        break;
      case OnCallPolicyRunOutcome.NobodyReached:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown: run.directPage
            ? mdText`⚠️ Nobody was paged for ${record}: ${this.getPager(run, { isInSentence: true })} could not reach anyone${this.getNotPagedClause(run)}. ${WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED}`.toString()
            : mdText`⚠️ Nobody was paged for ${record}: no escalation rule of ${policy} reached anyone. ${WHAT_TO_DO_WHEN_NOBODY_WAS_REACHED}`.toString(),
          text: `Nobody was paged for ${run.recordLabel}`,
        });
        break;
      case OnCallPolicyRunOutcome.Failed: {
        /*
         * It went wrong part way, after some rules had paged people - or
         * before anybody was paged at all.
         */
        const what: string =
          run.paged.length > 0
            ? `stopped paging for ${run.recordLabel} before anyone acknowledged`
            : `could not page anyone for ${run.recordLabel}`;

        const whatInMarkdown: MarkdownText =
          run.paged.length > 0
            ? mdText`stopped paging for ${record} before anyone acknowledged`
            : mdText`could not page anyone for ${record}`;

        // A person's page that went wrong part way: the paging stopped.
        if (isStartedByPerson && run.paged.length > 0) {
          alarms.push({
            key: ON_CALL_RUN_ALARM_OUTCOME,
            markdown:
              mdText`❌ Paging stopped for ${record} before anyone acknowledged${this.getFailureDetail(run)} Page someone yourself.`.toString(),
            text: `Paging stopped for ${run.recordLabel} before anyone acknowledged`,
          });
          break;
        }

        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`❌ ${policy} ${whatInMarkdown}${this.getFailureDetail(run)} Page someone yourself.`.toString(),
          text: `${pagerName} ${what}`,
        });
        break;
      }
      case OnCallPolicyRunOutcome.PolicyArchived:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⏹️ ${policy} stopped paging for ${record} because the policy was archived. Nobody else will be paged: someone needs to take it.`.toString(),
          text: `${pagerName} stopped paging for ${run.recordLabel}: the policy was archived`,
        });
        break;
      default:
        break;
    }

    return alarms;
  }

  private static getHeadline(run: OnCallPolicyRun): MarkdownText {
    const record: MarkdownText = mdText`**[${run.recordLabel}](${run.recordUrl})**`;
    // The policy, or who started a direct page: first in a sentence, and inside one.
    const policy: MarkdownText = this.getPager(run);
    const policyInSentence: MarkdownText = this.getPager(run, {
      isInSentence: true,
    });
    // A person's page: the paging stops, not the person (see the header).
    const isStartedByPerson: boolean = this.isStartedByPerson(run);
    const soPagingStopped: MarkdownText = isStartedByPerson
      ? mdText`so paging stopped`
      : mdText`so ${policyInSentence} stopped paging`;

    switch (run.outcome) {
      case OnCallPolicyRunOutcome.Waiting:
        return mdText`⏳ ${policy} is waiting to page for ${record}`;
      /*
       * It never paged, so it did not "stop": in the past tense, as for a
       * run that stopped because its record was handled.
       */
      case OnCallPolicyRunOutcome.HandledWhileWaiting:
        return run.outcomeDetail
          ? mdText`✅ ${record} moved to **${run.outcomeDetail}**, so ${policyInSentence} did not page anyone`
          : mdText`✅ ${record} is being handled, so ${policyInSentence} did not page anyone`;
      case OnCallPolicyRunOutcome.Paging:
        // A page again (OnCallAcknowledgementTimeout) says it is one.
        return run.pageAgainNumber
          ? mdText`📟 ${policy} is paging again for ${record}`
          : mdText`📟 ${policy} is paging for ${record}`;
      case OnCallPolicyRunOutcome.Acknowledged:
        return mdText`✅ **${run.acknowledgedByName || "Someone"}** acknowledged ${record}, ${soPagingStopped}`;
      case OnCallPolicyRunOutcome.RecordHandled:
        /*
         * In the past tense: the message is not edited once the run is
         * over, and the record may move on to other states after it.
         */
        return run.outcomeDetail
          ? mdText`✅ ${record} moved to **${run.outcomeDetail}**, ${soPagingStopped}`
          : mdText`✅ ${record} is being handled, ${soPagingStopped}`;
      case OnCallPolicyRunOutcome.PolicyArchived:
        return mdText`⏹️ ${policy} stopped paging for ${record}: the policy was archived`;
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        // A page again's record was acknowledged earlier: its page was not.
        if (run.pageAgainNumber) {
          return mdText`⚠️ ${policy} paged again for ${record} and nobody answered`;
        }

        // A direct page has no escalation rules to have gone through.
        return run.directPage
          ? mdText`⚠️ ${policy} paged for ${record} and nobody acknowledged`
          : mdText`⚠️ ${policy} went through every escalation rule for ${record} and nobody acknowledged`;
      // A person's page about a record somebody else is on.
      case OnCallPolicyRunOutcome.NobodyAnswered:
        return mdText`⚠️ Nobody answered the page from ${policyInSentence} for ${record}`;
      case OnCallPolicyRunOutcome.EverybodyPassedOn:
        return mdText`⚠️ Nobody could take ${record}: everybody paged by ${policyInSentence} escalated it`;
      case OnCallPolicyRunOutcome.NobodyReached:
        return mdText`⚠️ ${policy} could not reach anyone for ${record}`;
      case OnCallPolicyRunOutcome.Failed:
      default: {
        // A person's page that went wrong after paging people: it stopped.
        if (isStartedByPerson && run.paged.length > 0) {
          return run.outcomeDetail
            ? mdText`❌ Paging stopped for ${record}: ${run.outcomeDetail}`
            : mdText`❌ Paging stopped for ${record}`;
        }

        // Some rules may have paged people before it went wrong.
        const what: MarkdownText =
          run.paged.length > 0
            ? mdText`stopped paging for`
            : mdText`could not page anyone for`;

        return run.outcomeDetail
          ? mdText`❌ ${policy} ${what} ${record}: ${run.outcomeDetail}`
          : mdText`❌ ${policy} ${what} ${record}`;
      }
    }
  }

  /*
   * Why a waiting run waits, and when paging starts, in each reader's own
   * time: "**Waiting for working hours.** Paging starts tomorrow at 9:00
   * AM." - the words of its status message (OnCallDutyPolicyRunWait). Null
   * when the run does not know when.
   */
  private static getWaiting(run: OnCallPolicyRun): MarkdownText | null {
    const startsAt: Date | undefined = run.pagingStartsAt;

    if (!startsAt || isNaN(startsAt.getTime())) {
      return run.isWaitingForWorkingHours
        ? mdText`**Waiting for working hours.**`
        : null;
    }

    const when: MarkdownText = WorkspaceMessageTime.dateAndTime(startsAt);

    return run.isWaitingForWorkingHours
      ? mdText`**Waiting for working hours.** Paging starts ${when}.`
      : mdText`Paging starts ${when}.`;
  }

  /*
   * Where the escalation is, and what happens next and when, in one
   * paragraph: "**Second shift (Level 2 of 3)**: if nobody acknowledges by
   * 5:28 PM, Night shift (Level 3 of 3) is next."
   */
  private static getProgress(run: OnCallPolicyRun): MarkdownText {
    if (!run.currentRule) {
      // Before its first rule is under way (such a run is not posted yet).
      return run.ruleCount > 0
        ? mdText`**Starting with Level 1 of ${run.ruleCount}**`
        : mdText`**Starting**`;
    }

    const where: MarkdownText = mdText`**${this.getRuleLabel(run.currentRule, run.ruleCount)}**`;

    let repeat: MarkdownText = FeedMarkdown.empty();

    if (run.repeatNumber > 0) {
      repeat =
        run.repeatsAllowed >= run.repeatNumber
          ? mdText`, repeat ${run.repeatNumber} of ${run.repeatsAllowed}`
          : mdText`, repeat ${run.repeatNumber}`;
    }

    return mdText`${where}${repeat}: ${this.getNextStep(run)}`;
  }

  // What happens if nobody acknowledges, and when.
  private static getNextStep(run: OnCallPolicyRun): MarkdownText {
    const when: MarkdownText = this.getWhen(run);

    if (run.nextRule) {
      return mdText`if nobody acknowledges ${when}, ${this.getRuleLabel(run.nextRule, run.ruleCount)} is next.`;
    }

    if (run.repeatNumber < run.repeatsAllowed) {
      return mdText`if nobody acknowledges ${when}, the policy starts again from Level 1.`;
    }

    return mdText`if nobody acknowledges ${when}, paging stops.`;
  }

  /*
   * "by 5:28 PM" (in each reader's own time) when the run knows when the
   * wait is over; "within 7 minutes" when it does not; "within a minute"
   * for a rule that moves on at once.
   */
  private static getWhen(run: OnCallPolicyRun): MarkdownText {
    if (run.escalateAfterInMinutes <= 0) {
      return mdText`within a minute`;
    }

    if (run.nextStepAt && !isNaN(run.nextStepAt.getTime())) {
      return mdText`by ${WorkspaceMessageTime.time(run.nextStepAt)}`;
    }

    return mdText`within ${run.escalateAfterInMinutes} ${run.escalateAfterInMinutes === 1 ? "minute" : "minutes"}`;
  }

  /*
   * "**Nitin**: paged twice · by SMS and email", with why somebody else's
   * page reached them: "(covering for Alex)", "(next in the Primary
   * rotation)" - and the team a page reached them through: "(member of
   * Platform)".
   */
  private static getPagedPersonLine(
    person: OnCallPolicyRunPagedPerson,
  ): MarkdownText {
    const why: Array<MarkdownText> = [];

    if (person.coveringFor.length > 0) {
      why.push(mdText`covering for ${this.joinNames(person.coveringFor)}`);
    }

    for (const scheduleName of person.nextInRotationOf || []) {
      why.push(this.getNextInRotationReason(scheduleName));
    }

    const teams: Array<string> = person.teams || [];

    if (teams.length > 0) {
      why.push(this.getTeamReason(teams));
    }

    const who: MarkdownText =
      why.length > 0
        ? mdText`**${person.name}** (${FeedMarkdown.join(why, "; ")})`
        : mdText`**${person.name}**`;

    const facts: Array<MarkdownText> = [];

    if (person.acknowledged) {
      facts.push(mdText`acknowledged`);
    } else if (person.passedOn) {
      facts.push(mdText`escalated`);
    }

    if (person.timesPaged > 0) {
      facts.push(mdText`paged ${this.getTimes(person.timesPaged)}`);
    }

    if (person.isBeingPaged && !person.passedOn) {
      facts.push(mdText`being paged now`);
    }

    if (person.methods.length > 0) {
      facts.push(mdText`by ${this.joinNames(person.methods)}`);
    }

    if (facts.length === 0) {
      return who;
    }

    return mdText`${who}: ${FeedMarkdown.join(facts, " · ")}`;
  }

  // "**NB User 2**: not paged · not a member of this project".
  private static getNotPagedLine(
    entry: OnCallPolicyRunNotPaged,
    ruleCount: number,
  ): MarkdownText {
    if (entry.personName && entry.awayUntil) {
      return mdText`**${entry.personName}**: ${ON_CALL_RUN_NOT_PAGED} · away until ${WorkspaceMessageTime.dateAndTime(entry.awayUntil)}`;
    }

    if (entry.personName) {
      const reason: string = entry.reason.trim();

      if (entry.failed) {
        return mdText`**${entry.personName}**: ${reason}`;
      }

      return !reason || reason === ON_CALL_RUN_NOT_PAGED
        ? mdText`**${entry.personName}**: ${ON_CALL_RUN_NOT_PAGED}`
        : mdText`**${entry.personName}**: ${ON_CALL_RUN_NOT_PAGED} · ${reason}`;
    }

    if (entry.scheduleName && entry.nobodyNextInRotation) {
      return mdText`Nobody was next in the **${entry.scheduleName}** rotation`;
    }

    if (entry.scheduleName) {
      return mdText`Nobody was on call in schedule **${entry.scheduleName}**`;
    }

    if (entry.teamName) {
      return mdText`Team **${entry.teamName}** has no members`;
    }

    /*
     * A level with nobody to page, and - when the run did not wait for it -
     * the level it paged at once instead (OnCallEmptyLevel).
     */
    if (entry.rule) {
      const level: string = this.getRuleLabel(entry.rule, ruleCount);

      return entry.movedOnTo
        ? mdText`${level}: ${entry.reason}, so ${this.getRuleLabel(entry.movedOnTo, ruleCount)} was paged at once`
        : mdText`${level}: ${entry.reason}`;
    }

    return mdText`${this.capitalize(entry.reason)}`;
  }

  /*
   * What a run's message is about: an on-call policy, as a link to it - or,
   * for a direct page, who started the page: "Workflow **Page SRE**" (a
   * link to the workflow when the run recorded which one), the person, or
   * the product. Inside a sentence the word "workflow" is not capitalised;
   * a policy's and a person's names read the same in both places.
   */
  private static getPager(
    run: OnCallPolicyRun,
    options?: { isInSentence?: boolean | undefined } | undefined,
  ): MarkdownText {
    if (!run.directPage) {
      return mdText`**[${run.policyName}](${run.policyUrl})**`;
    }

    const workflowName: string = (
      run.directPage.startedByWorkflowName || ""
    ).trim();

    if (workflowName) {
      const workflow: MarkdownText = run.directPage.startedByWorkflowUrl
        ? mdText`**[${workflowName}](${run.directPage.startedByWorkflowUrl})**`
        : mdText`**${workflowName}**`;

      return options?.isInSentence
        ? mdText`workflow ${workflow}`
        : mdText`Workflow ${workflow}`;
    }

    const personName: string = (
      run.directPage.startedByPersonName || ""
    ).trim();

    if (personName) {
      return mdText`**${personName}**`;
    }

    return mdText`${ProductBrandingText.getProductName()}`;
  }

  /*
   * Whether a person started the run - a page from a chat - and not a
   * policy, a workflow or the product: its ending is then told as the
   * paging ending ("so paging stopped"), never as the person stopping it.
   */
  private static isStartedByPerson(run: OnCallPolicyRun): boolean {
    if (!run.directPage) {
      return false;
    }

    return (
      !(run.directPage.startedByWorkflowName || "").trim() &&
      Boolean((run.directPage.startedByPersonName || "").trim())
    );
  }

  // The same, as plain text: what a notification shows of it.
  private static getPagerName(
    run: OnCallPolicyRun,
    options?: { isInSentence?: boolean | undefined } | undefined,
  ): string {
    if (!run.directPage) {
      return run.policyName;
    }

    const workflowName: string = (
      run.directPage.startedByWorkflowName || ""
    ).trim();

    if (workflowName) {
      return options?.isInSentence
        ? `workflow ${workflowName}`
        : `Workflow ${workflowName}`;
    }

    return (
      (run.directPage.startedByPersonName || "").trim() ||
      ProductBrandingText.getProductName()
    );
  }

  /*
   * Why a direct page reached nobody, in brackets, for its alarm: " (Alex
   * Kim: away until <time>; nobody was on call in schedule Primary)". Empty
   * when the run has nothing to say of it.
   */
  private static getNotPagedClause(run: OnCallPolicyRun): MarkdownText {
    const reasons: Array<MarkdownText> = run.notPaged
      .map((entry: OnCallPolicyRunNotPaged): MarkdownText | null => {
        if (entry.personName && entry.awayUntil) {
          return this.getAwayReason(entry.personName, entry.awayUntil);
        }

        if (entry.personName) {
          return mdText`${entry.personName}: ${entry.reason.trim() || ON_CALL_RUN_NOT_PAGED}`;
        }

        if (entry.scheduleName && entry.nobodyNextInRotation) {
          return this.getNobodyNextInRotationReason(entry.scheduleName);
        }

        if (entry.scheduleName) {
          return mdText`nobody was on call in schedule ${entry.scheduleName}`;
        }

        if (entry.teamName) {
          return mdText`team ${entry.teamName} has no members`;
        }

        return null;
      })
      .filter((reason: MarkdownText | null): reason is MarkdownText => {
        return reason !== null;
      });

    if (reasons.length === 0) {
      return FeedMarkdown.empty();
    }

    return mdText` (${FeedMarkdown.join(reasons, "; ")})`;
  }

  // ": No Escalation Rules in Policy." - or just "." - closing the sentence.
  private static getFailureDetail(run: OnCallPolicyRun): MarkdownText {
    const detail: string = run.outcomeDetail?.trim() || "";

    if (!detail) {
      return mdText`.`;
    }

    return SENTENCE_END.test(detail)
      ? mdText`: ${detail}`
      : mdText`: ${detail}.`;
  }

  /*
   * A level as the Escalate dialog names it: "Second shift (Level 2 of 3)",
   * or "Level 2 of 3" when it has no name of its own (OnCallPagePassOn).
   * The name is text as typed - never capitalized here.
   */
  private static getRuleLabel(
    rule: OnCallPolicyRunRule,
    ruleCount: number,
  ): string {
    return getOnCallPassOnLevelLabel(
      { order: rule.order, name: rule.name },
      ruleCount,
    );
  }

  /*
   * Who the run paged, for an alarm: "Nitin", "Nitin and NB User 3", up to
   * five names and then "and 3 others". The people a team was paged for are
   * named after the team, together: "Platform (Nitin and Sam) and Alex".
   */
  private static getPagedNames(run: OnCallPolicyRun): MarkdownText {
    if (run.paged.length === 0) {
      return mdText`nobody`;
    }

    // In the order each was first paged: a team where its first member was.
    const entries: Array<{ team: string | null; names: Array<string> }> = [];

    for (const person of run.paged) {
      const team: string | null = (person.teams || [])[0] || null;
      const entry: { team: string | null; names: Array<string> } | undefined =
        team
          ? entries.find(
              (candidate: { team: string | null; names: Array<string> }) => {
                return candidate.team === team;
              },
            )
          : undefined;

      if (entry) {
        entry.names.push(person.name);
      } else {
        entries.push({ team: team, names: [person.name] });
      }
    }

    const said: Array<MarkdownText> = entries.map(
      (entry: { team: string | null; names: Array<string> }): MarkdownText => {
        const names: MarkdownText = this.joinNamesUpTo(entry.names);

        return entry.team ? mdText`${entry.team} (${names})` : names;
      },
    );

    if (said.length <= MAX_NAMES_IN_AN_ALARM) {
      return this.joinMarkdown(said);
    }

    const others: number = said.length - MAX_NAMES_IN_AN_ALARM;

    return mdText`${FeedMarkdown.join(said.slice(0, MAX_NAMES_IN_AN_ALARM), ", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  }

  // "A", "A and B", up to five names and then "and 3 others". Names are text.
  private static joinNamesUpTo(names: Array<string>): MarkdownText {
    if (names.length <= MAX_NAMES_IN_AN_ALARM) {
      return this.joinNames(names);
    }

    const others: number = names.length - MAX_NAMES_IN_AN_ALARM;

    return mdText`${FeedMarkdown.join(names.slice(0, MAX_NAMES_IN_AN_ALARM), ", ")} and ${others} ${others === 1 ? "other" : "others"}`;
  }

  // "A", "A and B", "A, B and C", of Markdown already placed.
  private static joinMarkdown(parts: Array<MarkdownText>): MarkdownText {
    if (parts.length <= 1) {
      return parts[0] || FeedMarkdown.empty();
    }

    return mdText`${FeedMarkdown.join(parts.slice(0, -1), ", ")} and ${parts[parts.length - 1]!}`;
  }

  // "A", "A and B", "A, B and C". Names are text.
  private static joinNames(names: Array<string>): MarkdownText {
    if (names.length <= 1) {
      return mdText`${names[0] || ""}`;
    }

    return mdText`${FeedMarkdown.join(names.slice(0, -1), ", ")} and ${names[names.length - 1]!}`;
  }

  // " (repeated once)", " (repeated twice)", " (repeated 3 times)", or nothing.
  private static getRepeatsDoneClause(run: OnCallPolicyRun): string {
    if (run.repeatNumber <= 0) {
      return "";
    }

    return ` (repeated ${this.getTimes(run.repeatNumber)})`;
  }

  // "once", "twice", "3 times".
  private static getTimes(count: number): string {
    if (count === 1) {
      return "once";
    }

    if (count === 2) {
      return "twice";
    }

    return `${count} times`;
  }

  private static capitalize(text: string): string {
    return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
  }
}
