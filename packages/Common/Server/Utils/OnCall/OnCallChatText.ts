import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT AN ON-CALL POLICY'S CHANNELS ARE TOLD OF ITS ROSTER, IN ONE LINE.
 *
 * A handoff used to post up to three long messages for every escalation
 * rule the schedule is in - who is no longer on call, who is on call now
 * and who is next - each naming the rule, its order and both ends of the
 * shift in several time zones (issue #7549). Now a policy's channels hear
 * one line of it:
 *
 *   📞 @Ana is now on call for Payments until Fri at 5:50 PM.
 *   📞 @Ana is now on call for Payments until Fri at 5:50 PM, then @Bob.
 *   ➡️ @Bob is next on call for Payments, from Fri at 5:50 PM.
 *   ⚠️ Nobody is on call for Payments until Fri at 5:50 PM, when @Bob takes over.
 *   ⚠️ Nobody is on call for Payments, and no later shift is scheduled.
 *
 * The policy's name links to it; a policy that pages more than one
 * schedule names the one whose roster changed: "Payments (Primary)". Which
 * line a channel gets is its rules' choice (OnCallHandoffPosts).
 *
 * Pure: the people, the policy and how a moment reads where the line goes
 * - each reader's own zone in Slack and Microsoft Teams
 * (WorkspaceMessageTime), the schedule's zone in the policy's feed - are
 * handed in.
 */

// How a moment reads where the line goes.
export type OnCallMomentText = (date: Date) => MarkdownText;

// An override, as a line about it is handed it: added, or changed.
export interface OnCallOverrideLine {
  policy: MarkdownText;
  // Who is covered: whom the rotation names.
  person: MarkdownText;
  // Who covers for them; none when their turns pass to the next person.
  cover?: MarkdownText | undefined;
  from: Date;
  until: Date;
  moment: OnCallMomentText;
}

export default class OnCallChatText {
  /*
   * The policy, linked to its page: "[Payments](...)", or "[Payments](...)
   * (Primary)" with the schedule whose roster changed.
   */
  public static policy(data: {
    name: string;
    link: string;
    scheduleName?: string | undefined;
  }): MarkdownText {
    const name: string = data.name.trim() || "On-call policy";
    const scheduleName: string = (data.scheduleName || "").trim();

    return scheduleName
      ? mdText`[${name}](${data.link}) (${scheduleName})`
      : mdText`[${name}](${data.link})`;
  }

  /*
   * A handoff: who is on call now, until when and - where the line names
   * them - who takes over then.
   */
  public static nowOnCall(data: {
    person: MarkdownText;
    policy: MarkdownText;
    until: Date | null;
    next?: MarkdownText | undefined;
    moment: OnCallMomentText;
  }): MarkdownText {
    const next: MarkdownText | undefined =
      data.next && !data.next.isEmpty() ? data.next : undefined;

    if (data.until && next) {
      return mdText`📞 ${data.person} is now on call for ${data.policy} until ${data.moment(data.until)}, then ${next}.`;
    }

    if (data.until) {
      return mdText`📞 ${data.person} is now on call for ${data.policy} until ${data.moment(data.until)}.`;
    }

    if (next) {
      return mdText`📞 ${data.person} is now on call for ${data.policy}. ${next} is next.`;
    }

    return mdText`📞 ${data.person} is now on call for ${data.policy}.`;
  }

  // Who takes over at the next handoff, and when.
  public static nextOnCall(data: {
    person: MarkdownText;
    policy: MarkdownText;
    from: Date | null;
    moment: OnCallMomentText;
  }): MarkdownText {
    return data.from
      ? mdText`➡️ ${data.person} is next on call for ${data.policy}, from ${data.moment(data.from)}.`
      : mdText`➡️ ${data.person} is next on call for ${data.policy}.`;
  }

  /*
   * Nobody on call: alerts that reach the schedule page no one. When
   * somebody's turn comes later, who and when.
   */
  public static nobodyOnCall(data: {
    policy: MarkdownText;
    next?: MarkdownText | undefined;
    from: Date | null;
    moment: OnCallMomentText;
  }): MarkdownText {
    const next: MarkdownText | undefined =
      data.next && !data.next.isEmpty() ? data.next : undefined;

    if (next && data.from) {
      return mdText`⚠️ Nobody is on call for ${data.policy} until ${data.moment(data.from)}, when ${next} takes over.`;
    }

    if (next) {
      return mdText`⚠️ Nobody is on call for ${data.policy}. ${next} is next.`;
    }

    return mdText`⚠️ Nobody is on call for ${data.policy}, and no later shift is scheduled.`;
  }

  /*
   * A person, team or schedule added to the policy's escalation rules or
   * taken out of them, as its channels hear it: who or what, and the
   * policy - not the escalation rule or its order, which the policy's feed
   * keeps. Written to follow the name of whoever made the change: "📅
   * @valeria added schedule Primary to on-call policy Payments."
   */
  public static policyChange(data: {
    emoji: string;
    isAdded: boolean;
    what: MarkdownText;
    policy: MarkdownText;
    // Said after it: a schedule added with nobody on call in it.
    then?: MarkdownText | undefined;
  }): MarkdownText {
    const then: MarkdownText =
      data.then && !data.then.isEmpty() ? mdText` ${data.then}` : mdText``;

    return data.isAdded
      ? mdText`${data.emoji} Added ${data.what} to on-call policy ${data.policy}.${then}`
      : mdText`${data.emoji} Removed ${data.what} from on-call policy ${data.policy}.${then}`;
  }

  /*
   * An override, as the policy's channels hear it: who covers for whom, or
   * who is away with nobody named to cover, from when to when. Written to
   * follow the name of whoever added it.
   */
  public static overrideAdded(data: OnCallOverrideLine): MarkdownText {
    return mdText`🔁 Added an override on ${data.policy}: ${OnCallChatText.overrideTerms(data)}.`;
  }

  /*
   * An override edited - who covers, or when it starts or ends - as the
   * policy's channels hear it: the override as it is now, said as the add
   * says it. What it was stays in the policy's feed. Written to follow the
   * name of whoever changed it.
   */
  public static overrideChanged(data: OnCallOverrideLine): MarkdownText {
    return mdText`✏️ Changed an override on ${data.policy}: ${OnCallChatText.overrideTerms(data)}.`;
  }

  // An override taken back: the person covered is paged on their turns again.
  public static overrideRemoved(data: {
    policy: MarkdownText;
    person: MarkdownText;
  }): MarkdownText {
    return mdText`❌ Removed an override on ${data.policy}: ${data.person} is paged on their turns again.`;
  }

  /*
   * What an override does, from when to when: "@Bob covers for @Ana from
   * ... to ...", or, with nobody named to cover, "@Ana is away from ... to
   * ..., and their turns go to the next person in the rotation".
   */
  private static overrideTerms(data: OnCallOverrideLine): MarkdownText {
    const from: MarkdownText = data.moment(data.from);
    const until: MarkdownText = data.moment(data.until);

    if (data.cover && !data.cover.isEmpty()) {
      return mdText`${data.cover} covers for ${data.person} from ${from} to ${until}`;
    }

    return mdText`${data.person} is away from ${from} to ${until}, and their turns go to the next person in the rotation`;
  }
}
