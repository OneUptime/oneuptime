import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import { FEED_INVITEE_UNNAMED } from "../Feed/FeedPersonNameWords";

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
 * Someone only invited to the project can be in a schedule's rotation
 * (#10412), and nothing pages them until they join (#10586): their turn is
 * a gap, and the lines say so - through which schedule - and why, rather
 * than name them as covering:
 *
 *   ⚠️ Nobody is paged for Payments through schedule Primary until Fri at 5:50 PM, when @Bob takes over: Ivy is on call but hasn't joined the project yet.
 *   📞 @Ana is now on call for Payments until Fri at 5:50 PM, then nobody: Ivy is next but hasn't joined the project yet.
 *   ⚠️ Nobody will be paged for Payments through schedule Primary from Fri at 5:50 PM: Ivy is next but hasn't joined the project yet.
 *   📞 Ivy has joined the project and is now on call for Payments until Fri at 5:50 PM, then @Bob.
 *
 * The policy's name links to it; a policy that pages more than one
 * schedule names the one whose roster changed: "Payments (Primary)". Which
 * line a channel gets is its rules' choice (OnCallHandoffPosts).
 *
 * Pure: the people, the policy and how a moment reads where the line goes
 * - each reader's own zone in Slack and Microsoft Teams
 * (WorkspaceMessageTime), words in the schedule's zone in Mattermost and in
 * the policy's feed - are handed in. Each workspace's names and moments
 * come from OnCallChatByWorkspace.
 */

// How a moment reads where the line goes.
export type OnCallMomentText = (date: Date) => MarkdownText;

/*
 * Who a line names for someone only invited to the project when no name
 * was typed with their invitation, or the name typed holds an address
 * (#10616): never their email address. Every feed entry and channel line
 * says the same (FeedPersonName.getInviteeName).
 */
export const ON_CALL_CHAT_INVITEE_UNNAMED: string = FEED_INVITEE_UNNAMED;

// Why somebody a schedule's rotation reaches is paged by nothing (#10586).
export enum OnCallNotPagedBecause {
  // Invited to the project, and has not joined it yet.
  NotJoinedYet = "NotJoinedYet",
  // Not a member of the project: they left it, or it could not be read.
  NotAMember = "NotAMember",
}

/*
 * Somebody a schedule's rotation reaches whom nothing pages, as a line says
 * them: their name - in a channel never their email address - or empty when
 * there is none to say, and why.
 */
export interface OnCallNotPagedPerson {
  name: MarkdownText;
  because: OnCallNotPagedBecause;
}

/*
 * The cover of an override who has not joined the project yet (#10670):
 * nothing pages them until they do, so while they have not, nobody is paged
 * in place of the person away. Whether the line has a name of theirs to say
 * (FeedPersonName): with none, `cover` says they have not joined already.
 */
export interface OnCallOverrideCoverNotJoined {
  isNamed: boolean;
}

// An override, as a line about it is handed it: added, or changed.
export interface OnCallOverrideLine {
  policy: MarkdownText;
  // Who is covered: whom the rotation names.
  person: MarkdownText;
  // Who covers for them; none when their turns pass to the next person.
  cover?: MarkdownText | undefined;
  // The cover has not joined the project yet: said after the terms.
  coverNotJoined?: OnCallOverrideCoverNotJoined | undefined;
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
   * them - who takes over then. A next person nothing pages is no one to
   * take over: then nobody is paged, and the line says why (#10586).
   * Somebody who joined the project during their shift says so: nothing
   * paged them until now.
   */
  public static nowOnCall(data: {
    person: MarkdownText;
    policy: MarkdownText;
    until: Date | null;
    next?: MarkdownText | undefined;
    // Who is next, when nothing pages them - in place of `next`.
    nextNotPaged?: OnCallNotPagedPerson | undefined;
    // They joined the project during their shift.
    hasJustJoined?: boolean | undefined;
    moment: OnCallMomentText;
  }): MarkdownText {
    const next: MarkdownText | undefined =
      data.next && !data.next.isEmpty() ? data.next : undefined;

    const onCall: MarkdownText = data.hasJustJoined
      ? mdText`📞 ${data.person} has joined the project and is now on call for ${data.policy}`
      : mdText`📞 ${data.person} is now on call for ${data.policy}`;

    const until: MarkdownText = data.until
      ? mdText` until ${data.moment(data.until)}`
      : mdText``;

    if (data.nextNotPaged) {
      return mdText`${onCall}${until}, then nobody: ${OnCallChatText.whyNotPaged(
        { person: data.nextNotPaged, isNext: true },
      )}.`;
    }

    if (data.until && next) {
      return mdText`${onCall}${until}, then ${next}.`;
    }

    if (data.until) {
      return mdText`${onCall}${until}.`;
    }

    if (next) {
      return mdText`${onCall}. ${next} is next.`;
    }

    return mdText`${onCall}.`;
  }

  /*
   * Who takes over at the next handoff, and when - or, when nothing pages
   * them, that nobody will be paged then, and why (#10586).
   */
  public static nextOnCall(data: {
    person: MarkdownText;
    policy: MarkdownText;
    from: Date | null;
    // Nothing pages them: said in place of `person`.
    notPaged?: OnCallNotPagedPerson | undefined;
    // The schedule nobody will be paged through then, when nothing pages them.
    schedule?: string | undefined;
    // They joined the project before their turn came.
    hasJustJoined?: boolean | undefined;
    moment: OnCallMomentText;
  }): MarkdownText {
    if (data.notPaged) {
      const why: MarkdownText = OnCallChatText.whyNotPaged({
        person: data.notPaged,
        isNext: true,
      });
      const through: MarkdownText = OnCallChatText.throughSchedule(
        data.schedule,
      );

      return data.from
        ? mdText`⚠️ Nobody will be paged for ${data.policy}${through} from ${data.moment(data.from)}: ${why}.`
        : mdText`⚠️ Nobody will be paged for ${data.policy}${through} after this shift: ${why}.`;
    }

    const next: MarkdownText = data.hasJustJoined
      ? mdText`➡️ ${data.person} has joined the project and is next on call for ${data.policy}`
      : mdText`➡️ ${data.person} is next on call for ${data.policy}`;

    return data.from
      ? mdText`${next}, from ${data.moment(data.from)}.`
      : mdText`${next}.`;
  }

  /*
   * Nobody on call: alerts that reach the schedule page no one. When
   * somebody's turn comes later, who and when - or, when nothing pages
   * them either, that nobody is paged then, and why (#10586).
   */
  public static nobodyOnCall(data: {
    policy: MarkdownText;
    next?: MarkdownText | undefined;
    // Who is next, when nothing pages them - in place of `next`.
    nextNotPaged?: OnCallNotPagedPerson | undefined;
    from: Date | null;
    moment: OnCallMomentText;
  }): MarkdownText {
    const next: MarkdownText | undefined =
      data.next && !data.next.isEmpty() ? data.next : undefined;

    if (data.nextNotPaged) {
      const why: MarkdownText = OnCallChatText.whyNotPaged({
        person: data.nextNotPaged,
        isNext: true,
      });

      return data.from
        ? mdText`⚠️ Nobody is on call for ${data.policy}, and nobody will be paged from ${data.moment(data.from)} either: ${why}.`
        : mdText`⚠️ Nobody is on call for ${data.policy}, and nobody will be paged on the next shift either: ${why}.`;
    }

    if (next && data.from) {
      return mdText`⚠️ Nobody is on call for ${data.policy} until ${data.moment(data.from)}, when ${next} takes over.`;
    }

    if (next) {
      return mdText`⚠️ Nobody is on call for ${data.policy}. ${next} is next.`;
    }

    return mdText`⚠️ Nobody is on call for ${data.policy}, and no later shift is scheduled.`;
  }

  /*
   * Somebody on call whom nothing pages (#10586) - only invited to the
   * project, or no longer in it: alerts that reach the schedule page no one
   * until their shift ends. Through which schedule - the policy's other
   * rules may still page somebody, and a level that pages nobody passes
   * on at once - until when, who takes over then when somebody paged
   * does, and why.
   */
  public static nobodyPaged(data: {
    policy: MarkdownText;
    // The schedule whose turn it is.
    schedule: string;
    onCall: OnCallNotPagedPerson;
    until: Date | null;
    // Who takes over then: somebody paged.
    next?: MarkdownText | undefined;
    moment: OnCallMomentText;
  }): MarkdownText {
    const next: MarkdownText | undefined =
      data.next && !data.next.isEmpty() ? data.next : undefined;

    const why: MarkdownText = OnCallChatText.whyNotPaged({
      person: data.onCall,
      isNext: false,
    });

    const paged: MarkdownText = mdText`⚠️ Nobody is paged for ${data.policy}${OnCallChatText.throughSchedule(data.schedule)}`;

    if (data.until && next) {
      return mdText`${paged} until ${data.moment(data.until)}, when ${next} takes over: ${why}.`;
    }

    if (data.until) {
      return mdText`${paged} until ${data.moment(data.until)}: ${why}.`;
    }

    if (next) {
      return mdText`${paged}: ${why}. ${next} is next.`;
    }

    return mdText`${paged}: ${why}.`;
  }

  /*
   * " through schedule Primary": what a line that says nobody is paged is
   * about - the schedule, not the whole policy. Nothing for a schedule with
   * no name.
   */
  public static throughSchedule(schedule: string | undefined): MarkdownText {
    const name: string = (schedule || "").trim();

    return name ? mdText` through schedule ${name}` : mdText``;
  }

  /*
   * Why nothing pages somebody the rotation reaches: "Ivy is on call but
   * hasn't joined the project yet", "Ivy is next but ...", or, with no name
   * to say, "the person on call hasn't joined the project yet".
   */
  public static whyNotPaged(data: {
    person: OnCallNotPagedPerson;
    isNext: boolean;
  }): MarkdownText {
    const state: MarkdownText =
      data.person.because === OnCallNotPagedBecause.NotJoinedYet
        ? mdText`hasn't joined the project yet`
        : mdText`isn't a member of the project`;

    if (data.person.name.isEmpty()) {
      return data.isNext
        ? mdText`the next person ${state}`
        : mdText`the person on call ${state}`;
    }

    return data.isNext
      ? mdText`${data.person.name} is next but ${state}`
      : mdText`${data.person.name} is on call but ${state}`;
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

  /*
   * The policy's feed's own sentence for a cover who has not joined the
   * project yet (#10670), after what the override routes: "**Ivy** hasn't
   * joined the project yet, so nobody is paged in place of **Ana** until
   * they do." With no name of theirs to say, the cover's name says they have
   * not joined already: "Nobody is paged in place of **Ana** until they join
   * the project."
   */
  public static coverNotJoinedSentence(data: {
    cover: MarkdownText;
    person: MarkdownText;
    coverNotJoined: OnCallOverrideCoverNotJoined;
  }): MarkdownText {
    return data.coverNotJoined.isNamed
      ? mdText`**${data.cover}** hasn't joined the project yet, so nobody is paged in place of **${data.person}** until they do.`
      : mdText`Nobody is paged in place of **${data.person}** until they join the project.`;
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
   * ..., and their turns go to the next person in the rotation". A cover
   * who has not joined the project yet is paged by nothing (#10670), and
   * the line says so, as a coverage gap's does (#10586): "Ivy covers for
   * @Ana from ... to ..., but Ivy hasn't joined the project yet, so nobody
   * is paged in place of @Ana until they do".
   */
  private static overrideTerms(data: OnCallOverrideLine): MarkdownText {
    const from: MarkdownText = data.moment(data.from);
    const until: MarkdownText = data.moment(data.until);

    if (data.cover && !data.cover.isEmpty()) {
      const covers: MarkdownText = mdText`${data.cover} covers for ${data.person} from ${from} to ${until}`;

      if (!data.coverNotJoined) {
        return covers;
      }

      return data.coverNotJoined.isNamed
        ? mdText`${covers}, but ${data.cover} hasn't joined the project yet, so nobody is paged in place of ${data.person} until they do`
        : mdText`${covers}, so nobody is paged in place of ${data.person} until they join`;
    }

    return mdText`${data.person} is away from ${from} to ${until}, and their turns go to the next person in the rotation`;
  }
}
