import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import ProductBrandingText from "../../ProductBrandingText";
import WorkspaceMessageTime from "../WorkspaceMessageTime";

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
 *   Escalation rule 2 of 3 (second): if nobody              where the run is, what
 *   acknowledges by 5:28 PM, escalation rule 3 (third)      happens next, and when
 *   is next.
 *
 *   • Nitin: paged twice · by SMS and email                 who was paged, how often
 *   • NB User 2: not paged · not a member of this project   and how - and who was not
 *
 *   See every step in OneUptime                             the run's own page
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
 * This file only turns a run into words - Markdown that Slack and Microsoft
 * Teams render the same way, and the plain text a notification shows of it
 * - so it can be read and tested on its own. Every name in it (the
 * policy's, a person's, a rule's, a schedule's) is text, placed with
 * mdText, so none of them can become a link, a mention or formatting.
 */

// How a run stands, as the message tells it.
export enum OnCallPolicyRunOutcome {
  // Still escalating.
  Paging = "Paging",
  // A person acknowledged their page.
  Acknowledged = "Acknowledged",
  // The record was acknowledged or resolved some other way: paging stopped.
  RecordHandled = "RecordHandled",
  // The policy was archived while the run was escalating.
  PolicyArchived = "PolicyArchived",
  // Every escalation rule (and repeat) ran, people were paged, nobody acknowledged.
  NobodyAcknowledged = "NobodyAcknowledged",
  // Every escalation rule ran and none of them reached anybody.
  NobodyReached = "NobodyReached",
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
  // How their pages reached them: "email", "SMS", "call", ...
  methods: Array<string>;
  // The people an override routed their pages from.
  coveringFor: Array<string>;
}

// Somebody, or some step, the run could not page, once per reason.
export interface OnCallPolicyRunNotPaged {
  // The person, when it is about a person.
  personName?: string | undefined;
  // The schedule that had nobody on call, when it is about a schedule.
  scheduleName?: string | undefined;
  // The escalation rule that had nobody to page at all.
  rule?: OnCallPolicyRunRule | undefined;
  // Why, as a phrase: "not a member of this project".
  reason: string;
  /*
   * A page to the person went out and failed ("could not be paged (...)"),
   * rather than being skipped.
   */
  failed?: boolean | undefined;
}

export interface OnCallPolicyRun {
  policyName: string;
  policyUrl: string;
  // The run's own page in OneUptime: every step, in order.
  runUrl: string;
  // "Incident INC-8", "Alert #12", "Incident Episode EP-3", ...
  recordLabel: string;
  recordUrl: string;
  outcome: OnCallPolicyRunOutcome;
  // Failed: what went wrong. RecordHandled: the record's state name.
  outcomeDetail?: string | undefined;
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
        reasons: Array<string>;
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

// How many of the people paged an alarm names before "and N others".
const MAX_NAMES_IN_AN_ALARM: number = 5;

// A sentence's own end: ".", "!" or "?".
const SENTENCE_END: RegExp = /[.!?]$/;

export default class OnCallPolicyRunMessageView {
  // The run's message, as Markdown.
  public static getMarkdown(run: OnCallPolicyRun): string {
    const parts: Array<MarkdownText> = [this.getHeadline(run)];

    if (run.outcome === OnCallPolicyRunOutcome.Paging) {
      parts.push(this.getProgress(run));
    }

    const people: Array<MarkdownText> = [
      ...run.paged.map((person: OnCallPolicyRunPagedPerson): MarkdownText => {
        return this.getPagedPersonLine(person);
      }),
      ...run.notPaged.map((entry: OnCallPolicyRunNotPaged): MarkdownText => {
        return this.getNotPagedLine(entry);
      }),
    ];

    if (people.length > 0) {
      parts.push(FeedMarkdown.bulletList(people));
    }

    parts.push(
      mdText`[See every step in ${ProductBrandingText.getProductName()}](${run.runUrl})`,
    );

    return parts
      .map((part: MarkdownText): string => {
        return part.toString();
      })
      .join("\n\n");
  }

  /*
   * The message as one line of plain text: what a notification, a message
   * preview or a screen reader shows of it.
   */
  public static getPlainText(run: OnCallPolicyRun): string {
    switch (run.outcome) {
      case OnCallPolicyRunOutcome.Paging:
        return `${run.policyName} is paging for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.Acknowledged:
        return `${run.acknowledgedByName || "Someone"} acknowledged ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.RecordHandled:
        return run.outcomeDetail
          ? `${run.recordLabel} moved to ${run.outcomeDetail}, so ${run.policyName} stopped paging`
          : `${run.policyName} stopped paging for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.PolicyArchived:
        return `${run.policyName} stopped paging for ${run.recordLabel}: the policy was archived`;
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        return `Nobody acknowledged ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.NobodyReached:
        return `${run.policyName} could not reach anyone for ${run.recordLabel}`;
      case OnCallPolicyRunOutcome.Failed:
      default:
        return `${run.policyName} could not page anyone for ${run.recordLabel}`;
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
    const policy: MarkdownText = mdText`**[${run.policyName}](${run.policyUrl})**`;

    if (run.firstRuleThatReachedNobody) {
      const reasons: Array<string> = run.firstRuleThatReachedNobody.reasons;
      const rule: string = this.getRuleLabel(
        run.firstRuleThatReachedNobody.rule,
        run.ruleCount,
      );

      /*
       * The policy and the rule first: earlier rules may have paged people,
       * so "Nobody was paged for Incident INC-8" would not be true. Why, in
       * brackets: the reasons themselves read "NB User 2: not a member ...".
       */
      alarms.push({
        key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
        markdown:
          mdText`⚠️ ${policy} paged nobody at ${rule} for ${record}${reasons.length > 0 ? mdText` (${FeedMarkdown.join(reasons, "; ")})` : FeedMarkdown.empty()}. If nobody is on it yet, page someone or fix the policy.`.toString(),
        text: `${run.policyName} paged nobody at ${rule} for ${run.recordLabel}`,
      });
    }

    switch (run.outcome) {
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody has acknowledged ${record}. ${policy} paged ${this.getPagedNames(run)}, went through every escalation rule${this.getRepeatsDoneClause(run)} and has stopped paging. Someone needs to take it.`.toString(),
          text: `Nobody has acknowledged ${run.recordLabel}: someone needs to take it`,
        });
        break;
      case OnCallPolicyRunOutcome.NobodyReached:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody was paged for ${record}: no escalation rule of ${policy} reached anyone. Check who is on call, or page someone yourself.`.toString(),
          text: `Nobody was paged for ${run.recordLabel}`,
        });
        break;
      case OnCallPolicyRunOutcome.Failed:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`❌ ${policy} could not page anyone for ${record}${this.getFailureDetail(run)} Page someone yourself.`.toString(),
          text: `${run.policyName} could not page anyone for ${run.recordLabel}`,
        });
        break;
      case OnCallPolicyRunOutcome.PolicyArchived:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⏹️ ${policy} stopped paging for ${record} because the policy was archived. Nobody else will be paged: someone needs to take it.`.toString(),
          text: `${run.policyName} stopped paging for ${run.recordLabel}: the policy was archived`,
        });
        break;
      default:
        break;
    }

    return alarms;
  }

  private static getHeadline(run: OnCallPolicyRun): MarkdownText {
    const record: MarkdownText = mdText`**[${run.recordLabel}](${run.recordUrl})**`;
    const policy: MarkdownText = mdText`**[${run.policyName}](${run.policyUrl})**`;

    switch (run.outcome) {
      case OnCallPolicyRunOutcome.Paging:
        return mdText`📟 ${policy} is paging for ${record}`;
      case OnCallPolicyRunOutcome.Acknowledged:
        return mdText`✅ **${run.acknowledgedByName || "Someone"}** acknowledged ${record}, so ${policy} stopped paging`;
      case OnCallPolicyRunOutcome.RecordHandled:
        /*
         * In the past tense: the message is not edited once the run is
         * over, and the record may move on to other states after it.
         */
        return run.outcomeDetail
          ? mdText`✅ ${record} moved to **${run.outcomeDetail}**, so ${policy} stopped paging`
          : mdText`✅ ${record} is being handled, so ${policy} stopped paging`;
      case OnCallPolicyRunOutcome.PolicyArchived:
        return mdText`⏹️ ${policy} stopped paging for ${record}: the policy was archived`;
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        return mdText`⚠️ ${policy} went through every escalation rule for ${record} and nobody acknowledged`;
      case OnCallPolicyRunOutcome.NobodyReached:
        return mdText`⚠️ ${policy} could not reach anyone for ${record}`;
      case OnCallPolicyRunOutcome.Failed:
      default:
        return run.outcomeDetail
          ? mdText`❌ ${policy} could not page anyone for ${record}: ${run.outcomeDetail}`
          : mdText`❌ ${policy} could not page anyone for ${record}`;
    }
  }

  /*
   * Where the escalation is, and what happens next and when, in one
   * paragraph: "**Escalation rule 2 of 3 (second)**: if nobody acknowledges
   * by 5:28 PM, escalation rule 3 (third) is next."
   */
  private static getProgress(run: OnCallPolicyRun): MarkdownText {
    if (!run.currentRule) {
      // Before its first rule is under way (such a run is not posted yet).
      return run.ruleCount > 0
        ? mdText`**Starting with escalation rule 1 of ${run.ruleCount}**`
        : mdText`**Starting**`;
    }

    const where: MarkdownText = mdText`**${this.capitalize(this.getRuleLabel(run.currentRule, run.ruleCount))}**`;

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
      return mdText`if nobody acknowledges ${when}, ${this.getRuleLabel(run.nextRule)} is next.`;
    }

    if (run.repeatNumber < run.repeatsAllowed) {
      return mdText`if nobody acknowledges ${when}, the policy starts again from escalation rule 1.`;
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

  // "**Nitin**: paged twice · by SMS and email".
  private static getPagedPersonLine(
    person: OnCallPolicyRunPagedPerson,
  ): MarkdownText {
    const who: MarkdownText =
      person.coveringFor.length > 0
        ? mdText`**${person.name}** (covering for ${this.joinNames(person.coveringFor)})`
        : mdText`**${person.name}**`;

    const facts: Array<MarkdownText> = [];

    if (person.acknowledged) {
      facts.push(mdText`acknowledged`);
    }

    if (person.timesPaged > 0) {
      facts.push(mdText`paged ${this.getTimes(person.timesPaged)}`);
    }

    if (person.isBeingPaged) {
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
  private static getNotPagedLine(entry: OnCallPolicyRunNotPaged): MarkdownText {
    if (entry.personName) {
      const reason: string = entry.reason.trim();

      if (entry.failed) {
        return mdText`**${entry.personName}**: ${reason}`;
      }

      return !reason || reason === ON_CALL_RUN_NOT_PAGED
        ? mdText`**${entry.personName}**: ${ON_CALL_RUN_NOT_PAGED}`
        : mdText`**${entry.personName}**: ${ON_CALL_RUN_NOT_PAGED} · ${reason}`;
    }

    if (entry.scheduleName) {
      return mdText`Nobody was on call in schedule **${entry.scheduleName}**`;
    }

    if (entry.rule) {
      return mdText`${this.capitalize(this.getRuleLabel(entry.rule))}: ${entry.reason}`;
    }

    return mdText`${this.capitalize(entry.reason)}`;
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

  // "escalation rule 2 of 3 (second)", or without the count or the name.
  private static getRuleLabel(
    rule: OnCallPolicyRunRule,
    ruleCount?: number | undefined,
  ): string {
    const position: string =
      ruleCount && ruleCount >= rule.order
        ? `escalation rule ${rule.order} of ${ruleCount}`
        : `escalation rule ${rule.order}`;

    return rule.name?.trim() ? `${position} (${rule.name.trim()})` : position;
  }

  /*
   * Who the run paged, for an alarm: "Nitin", "Nitin and NB User 3", up to
   * five names and then "and 3 others".
   */
  private static getPagedNames(run: OnCallPolicyRun): MarkdownText {
    const names: Array<string> = run.paged.map(
      (person: OnCallPolicyRunPagedPerson): string => {
        return person.name;
      },
    );

    if (names.length === 0) {
      return mdText`nobody`;
    }

    if (names.length <= MAX_NAMES_IN_AN_ALARM) {
      return this.joinNames(names);
    }

    const others: number = names.length - MAX_NAMES_IN_AN_ALARM;

    return mdText`${FeedMarkdown.join(names.slice(0, MAX_NAMES_IN_AN_ALARM), ", ")} and ${others} ${others === 1 ? "other" : "others"}`;
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
