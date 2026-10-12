import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT ONE ON-CALL POLICY RUN LOOKS LIKE IN SLACK AND MICROSOFT TEAMS.
 *
 * A run used to post a message for every step - "On Call Policy Started
 * Executing", "Status Updated ... Started", "... Executing", "... Completed",
 * and an "On-Call Alert Notification Sent to <person>" paragraph for every
 * person on every escalation rule and every repeat, each of those twice - so
 * twenty minutes of escalation buried an incident channel. Now a run is ONE
 * message that is edited as the run goes (OnCallPolicyRunMessage): which
 * policy, for which record, where the escalation is, who was paged, how many
 * times and how, who was not and why, and what happens next. An edit
 * notifies nobody, so the channel stays quiet while the run is on track.
 *
 * It is loud - a new message - only where somebody has to act (getAlarms):
 * the first time an escalation rule reaches nobody, and when the run ends
 * without anybody taking the record (nobody acknowledged, nobody could be
 * reached, it could not run, the policy was archived under it). Somebody
 * acknowledging is loud already: the record's state change says who.
 *
 * This file only turns a run into words - Markdown that Slack and Microsoft
 * Teams render the same way - so it can be read and tested on its own. Every
 * name in it (the policy's, a person's, a rule's, a schedule's) is text,
 * placed with mdText, so none of them can become a link, a mention or
 * formatting.
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
}

export const ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE: string =
  "nobody-paged-at-a-rule";
export const ON_CALL_RUN_ALARM_OUTCOME: string = "outcome";

export default class OnCallPolicyRunMessageView {
  // The run's message, as Markdown.
  public static getMarkdown(run: OnCallPolicyRun): string {
    const parts: Array<MarkdownText> = [this.getHeadline(run)];

    if (run.outcome === OnCallPolicyRunOutcome.Paging) {
      parts.push(this.getProgressLine(run));
    }

    if (run.paged.length > 0) {
      parts.push(
        mdText`**Paged**
${FeedMarkdown.bulletList(
  run.paged.map((person: OnCallPolicyRunPagedPerson): MarkdownText => {
    return this.getPagedPersonLine(person);
  }),
)}`,
      );
    }

    if (run.notPaged.length > 0) {
      parts.push(
        mdText`**Not paged**
${FeedMarkdown.bulletList(
  run.notPaged.map((entry: OnCallPolicyRunNotPaged): MarkdownText => {
    return this.getNotPagedLine(entry);
  }),
)}`,
      );
    }

    // What comes next, once a rule is under way.
    if (run.outcome === OnCallPolicyRunOutcome.Paging && run.currentRule) {
      parts.push(this.getNextStepLine(run));
    }

    parts.push(mdText`[See every step in OneUptime](${run.runUrl})`);

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
        return `${run.policyName} stopped paging for ${run.recordLabel}`;
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
   * on it - acknowledged, or the record handled - raises none.
   */
  public static getAlarms(run: OnCallPolicyRun): Array<OnCallPolicyRunAlarm> {
    const alarms: Array<OnCallPolicyRunAlarm> = [];

    const record: MarkdownText = mdText`**[${run.recordLabel}](${run.recordUrl})**`;
    const policy: MarkdownText = mdText`**[${run.policyName}](${run.policyUrl})**`;

    if (run.firstRuleThatReachedNobody) {
      const reasons: Array<string> = run.firstRuleThatReachedNobody.reasons;

      // Why, in brackets: the reasons themselves read "NB User 2: not a member ...".
      alarms.push({
        key: ON_CALL_RUN_ALARM_NOBODY_PAGED_AT_A_RULE,
        markdown:
          mdText`⚠️ Nobody was paged for ${record} at ${this.getRuleLabel(run.firstRuleThatReachedNobody.rule, run.ruleCount)} of ${policy}${reasons.length > 0 ? mdText` (${FeedMarkdown.join(reasons, "; ")})` : FeedMarkdown.empty()}. If nobody is on it yet, page someone or fix the policy.`.toString(),
      });
    }

    switch (run.outcome) {
      case OnCallPolicyRunOutcome.NobodyAcknowledged:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody has acknowledged ${record}. ${policy} paged ${this.getPagedNames(run)}, went through every escalation rule${this.getRepeatsDoneClause(run)} and has stopped paging. Someone needs to take it.`.toString(),
        });
        break;
      case OnCallPolicyRunOutcome.NobodyReached:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⚠️ Nobody was paged for ${record}: no escalation rule of ${policy} reached anyone. Check who is on call, or page someone yourself.`.toString(),
        });
        break;
      case OnCallPolicyRunOutcome.Failed:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`❌ ${policy} could not page anyone for ${record}${run.outcomeDetail ? mdText`: ${run.outcomeDetail}` : FeedMarkdown.empty()}`.toString(),
        });
        break;
      case OnCallPolicyRunOutcome.PolicyArchived:
        alarms.push({
          key: ON_CALL_RUN_ALARM_OUTCOME,
          markdown:
            mdText`⏹️ ${policy} stopped paging for ${record} because the policy was archived. Nobody else will be paged: someone needs to take it.`.toString(),
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
        return mdText`✅ **${run.acknowledgedByName || "Someone"}** acknowledged ${record}: ${policy} stopped paging`;
      case OnCallPolicyRunOutcome.RecordHandled:
        return run.outcomeDetail
          ? mdText`✅ ${policy} stopped paging: ${record} is ${run.outcomeDetail}`
          : mdText`✅ ${policy} stopped paging: ${record} is being handled`;
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

  // Where the escalation is: "Escalation rule 2 of 3: second · repeat 1 of 2".
  private static getProgressLine(run: OnCallPolicyRun): MarkdownText {
    const where: MarkdownText = run.currentRule
      ? mdText`**${this.capitalize(this.getRuleLabel(run.currentRule, run.ruleCount))}**`
      : run.ruleCount > 0
        ? mdText`**Starting with escalation rule 1 of ${run.ruleCount}**`
        : mdText`**Starting**`;

    if (run.repeatsAllowed <= 0) {
      return where;
    }

    if (run.repeatNumber <= 0) {
      // "repeats once", "repeats up to twice", "repeats up to 3 times".
      return run.repeatsAllowed === 1
        ? mdText`${where} · repeats once if nobody acknowledges`
        : mdText`${where} · repeats up to ${this.getTimes(run.repeatsAllowed)} if nobody acknowledges`;
    }

    return mdText`${where} · repeat ${run.repeatNumber} of ${run.repeatsAllowed}`;
  }

  // What happens if nobody acknowledges, and when.
  private static getNextStepLine(run: OnCallPolicyRun): MarkdownText {
    const within: string =
      run.escalateAfterInMinutes > 0
        ? `within ${run.escalateAfterInMinutes} ${run.escalateAfterInMinutes === 1 ? "minute" : "minutes"}`
        : "within a minute";

    if (run.nextRule) {
      return mdText`If nobody acknowledges ${within}, ${this.getRuleLabel(run.nextRule, run.ruleCount)} is next.`;
    }

    if (run.repeatNumber < run.repeatsAllowed) {
      return mdText`If nobody acknowledges ${within}, the policy starts again from escalation rule 1.`;
    }

    return mdText`This is the last step: if nobody acknowledges ${within}, paging ends.`;
  }

  private static getPagedPersonLine(
    person: OnCallPolicyRunPagedPerson,
  ): MarkdownText {
    const who: MarkdownText =
      person.coveringFor.length > 0
        ? mdText`**${person.name}** (covering for ${FeedMarkdown.join(person.coveringFor)})`
        : mdText`**${person.name}**`;

    const facts: Array<MarkdownText> = [];

    if (person.acknowledged) {
      facts.push(mdText`acknowledged ✅`);
    }

    if (person.timesPaged > 0) {
      facts.push(mdText`paged ${this.getTimes(person.timesPaged)}`);
    }

    if (person.isBeingPaged) {
      facts.push(mdText`being paged now`);
    }

    if (person.methods.length > 0) {
      facts.push(mdText`by ${FeedMarkdown.join(person.methods)}`);
    }

    if (facts.length === 0) {
      return who;
    }

    return mdText`${who}: ${FeedMarkdown.join(facts, " · ")}`;
  }

  private static getNotPagedLine(entry: OnCallPolicyRunNotPaged): MarkdownText {
    if (entry.personName) {
      return mdText`**${entry.personName}**: ${entry.reason}`;
    }

    if (entry.scheduleName) {
      return mdText`Nobody was on call in schedule **${entry.scheduleName}**`;
    }

    if (entry.rule) {
      return mdText`${this.capitalize(this.getRuleLabel(entry.rule))}: ${entry.reason}`;
    }

    return mdText`${this.capitalize(entry.reason)}`;
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

  private static getPagedNames(run: OnCallPolicyRun): string {
    const names: Array<string> = run.paged.map(
      (person: OnCallPolicyRunPagedPerson): string => {
        return person.name;
      },
    );

    if (names.length === 0) {
      return "nobody";
    }

    if (names.length === 1) {
      return names[0]!;
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
