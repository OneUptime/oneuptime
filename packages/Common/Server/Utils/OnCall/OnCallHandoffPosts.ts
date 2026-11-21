import { Green500, Red500, Yellow500 } from "../../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import UserService from "../../Services/UserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import ProjectMembership from "../TeamMember/ProjectMembership";
import WorkspaceMessageTime from "../Workspace/WorkspaceMessageTime";
import OnCallHandoffPolicies, {
  OnCallHandoffPolicy,
} from "./OnCallHandoffPolicies";
import OnCallChatByWorkspace, {
  OnCallChatLines,
  OnCallChatMentionsByWorkspaceType,
  OnCallChatTextByWorkspaceType,
  OnCallChatWriter,
  OnCallNameOf,
} from "./OnCallChatByWorkspace";
import OnCallChatText, {
  OnCallMomentText,
  OnCallNotPagedBecause,
  OnCallNotPagedPerson,
} from "./OnCallChatText";

/*
 * ONE POST PER POLICY FOR A CHANGE OF WHO IS ON CALL (issue #7549).
 *
 * When a schedule's roster changes - a handoff, an override starting or
 * ending, a layer edited - every on-call policy whose escalation rules
 * page the schedule hears of it once, however many of its rules page it:
 * one entry in the policy's feed, and one line in each of its channels
 * (OnCallChatText). It used to be up to three long messages for every
 * escalation rule the schedule is in.
 *
 * Which line a channel gets is what its rules chose (NotificationRuleUpdates,
 * on-call policy rules' Updates step):
 *
 *   wants who is on call now and who is next    📞 Ana ... until 5:50 PM, then Bob.
 *   wants who is on call now only               📞 Ana ... until 5:50 PM.
 *   wants who is next only                      ➡️ Bob is next on call ...
 *   wants neither                               nothing
 *
 * - each a message of its own (getChatPosts), sent only to the channels
 * whose rules want it said that way
 * (WorkspaceNotificationRuleService.getMessageDestinationsWanting), so no
 * channel gets two. A schedule left with nobody on call is Nobody on call;
 * a new next person while the person on call stays is Who is on call next.
 * A rule saved before rules chose posts every update: the first line.
 *
 * The person on call is named as each workspace knows them: "@ana" where
 * they connected their account there (WorkspaceUtil
 * .getUserStringForWorkspace), their OneUptime name otherwise - as every
 * other on-call line names them (OnCallChatByWorkspace). A moment reads in
 * each reader's own zone in Slack and Microsoft Teams, in words in the
 * schedule's zone in Mattermost ("until Sat, Nov 14 at 5:50 PM EST", issue
 * #7970) - UTC for a schedule set in none - and in the schedule's zone in
 * the policy's feed.
 *
 * A name pings nobody, so a channel that hears every hand-off is not
 * pinged by each one. A rule can ask to mention the person who comes on
 * call instead (issue #7968, NotificationRuleUpdates
 * .isMentioningWhoIsOnCall): the lines that name who is on call now are
 * then said twice - with a real mention where they connected their
 * account (WorkspaceMentions), to the channels whose rules ask for it, and
 * as before to every other channel - so no channel gets both. Who is next
 * is never mentioned, and nobody who connected no account is.
 *
 * ONLY A MEMBER OF THE PROJECT IS PAGED (#10586). Someone only invited can
 * be in a schedule's rotation (#10412), and nothing pages them until they
 * join: when their turn comes, the schedule pages nobody, and the policy's
 * feed and channels said "📞 Ivy is now on call for Payments" all the same.
 * Now such a turn is a gap, said as the gap it is - the feed's Coverage gap
 * started, to the channels that want Nobody on call, the one push signal
 * for a gap there is (OnCallDutyPolicyFeedEventType.CoverageGapStarted) -
 * with why: "⚠️ Nobody is paged for Payments until 5:50 PM, when @Bob takes
 * over: Ivy is on call but hasn't joined the project yet." Who is next, when
 * nothing pages them, is no one to take over: "..., then nobody: Ivy is next
 * but hasn't joined the project yet." Setup Health and On-Call Readiness
 * already name the invitee, with the fix ("Ivy hasn't accepted the
 * invitation to this project, so pages don't reach them"): no warning of
 * its own is added. In a channel, such a person is named by their display
 * name alone - the name typed for them with the invitation - and never by
 * their email address; with no name, as "the person on call". The policy's
 * feed names them as the project knows them, as its other entries do.
 * Joining during their shift posts again (postJoinedDuringShift): a page
 * reaches them from then on.
 *
 * Never throws: the roster refresh that calls this must go on to store the
 * new roster.
 */

// What a schedule's roster change is, for one policy that pages the schedule.
export interface OnCallHandoff {
  projectId: ObjectID;
  onCallDutyPolicyId: ObjectID;
  onCallDutyPolicyName: string;
  scheduleId: ObjectID;
  scheduleName: string;
  // The zone the schedule's handoffs are set in: the feed's times read in it.
  scheduleTimezone?: Timezone | null | undefined;
  // Who was on call, and who was next, before the change.
  previousUserId: ObjectID | null;
  previousNextUserId: ObjectID | null;
  // Who is on call now, and when they hand off.
  currentUserId: ObjectID | null;
  handoffAt: Date | null;
  // Who is next, and when their turn starts.
  nextUserId: ObjectID | null;
  nextStartsAt: Date | null;
  /*
   * Whether the person on call now, and whoever is next, are members of the
   * project: nothing pages anybody else (#10586). Left out, they are.
   */
  currentUserIsMember?: boolean | undefined;
  nextUserIsMember?: boolean | undefined;
  /*
   * Nobody's turn changed, but the person on call now - or who is next -
   * joined the project during it: a page reaches them from now on, where
   * the hand-off said nothing would (postJoinedDuringShift).
   */
  currentUserJustJoined?: boolean | undefined;
  nextUserJustJoined?: boolean | undefined;
}

// What the change says, for the policy's channels.
export enum OnCallHandoffChange {
  // Somebody else is on call now.
  NowOnCall = "NowOnCall",
  // The person on call stays; somebody else is next.
  NextOnCall = "NextOnCall",
  // Somebody was on call, and now nobody is.
  NobodyOnCall = "NobodyOnCall",
  /*
   * Somebody else is on call now, whom nothing pages - only invited, or no
   * longer a member: alerts that reach the schedule page no one (#10586).
   */
  NobodyPaged = "NobodyPaged",
}

// Which line a post is (OnCallChatText).
export enum OnCallChatLine {
  NowOnCall = "NowOnCall",
  NowOnCallThenNext = "NowOnCallThenNext",
  NextOnCall = "NextOnCall",
  NobodyOnCall = "NobodyOnCall",
  NobodyPaged = "NobodyPaged",
}

/*
 * Who of a hand-off's people nothing pages, by lower-cased user id: why, and
 * the name a channel may say - their display name, never their email
 * address, or "" for none (readNotPagedPeople).
 */
export type OnCallNotPagedPeople = Map<
  string,
  { because: OnCallNotPagedBecause; displayName: string }
>;

// How a line names somebody nothing pages, and why (OnCallChatText).
export type OnCallNotPagedOf = (
  userId: ObjectID,
) => Promise<OnCallNotPagedPerson>;

/*
 * One message of a change: its line, and the channels it goes to - those
 * whose rules want one of updateKinds, also one of alsoWantedUpdateKinds,
 * and none of notWantedUpdateKinds.
 */
export interface OnCallChatPost {
  line: OnCallChatLine;
  updateKinds: Array<NotificationRuleUpdateKind>;
  alsoWantedUpdateKinds?: Array<NotificationRuleUpdateKind> | undefined;
  notWantedUpdateKinds?: Array<NotificationRuleUpdateKind> | undefined;
}

export default class OnCallHandoffPosts {
  // Whether two roster users are the same person (nobody and nobody are).
  public static isSameUser(
    a: ObjectID | null | undefined,
    b: ObjectID | null | undefined,
  ): boolean {
    return (
      (a?.toString() || "").toLowerCase() ===
      (b?.toString() || "").toLowerCase()
    );
  }

  // Whether the person on call now is paged: a member of the project (#10586).
  public static isCurrentUserPaged(handoff: OnCallHandoff): boolean {
    return handoff.currentUserIsMember !== false;
  }

  // Whether who is next is paged when their turn comes: a member of the project.
  public static isNextUserPaged(handoff: OnCallHandoff): boolean {
    return handoff.nextUserIsMember !== false;
  }

  /*
   * What the change says, or null when it says nothing a channel is told:
   * the same person on call and next, only a handoff time moved on.
   * Somebody else on call whom nothing pages is a gap (#10586); somebody
   * who joined during their turn is on call, or next, from now on.
   */
  public static getChange(handoff: OnCallHandoff): OnCallHandoffChange | null {
    if (handoff.currentUserJustJoined) {
      return handoff.currentUserId && this.isCurrentUserPaged(handoff)
        ? OnCallHandoffChange.NowOnCall
        : null;
    }

    if (handoff.nextUserJustJoined) {
      return this.getNextToName(handoff) && this.isNextUserPaged(handoff)
        ? OnCallHandoffChange.NextOnCall
        : null;
    }

    const isNewPersonOnCall: boolean = !this.isSameUser(
      handoff.previousUserId,
      handoff.currentUserId,
    );

    if (isNewPersonOnCall && handoff.currentUserId) {
      return this.isCurrentUserPaged(handoff)
        ? OnCallHandoffChange.NowOnCall
        : OnCallHandoffChange.NobodyPaged;
    }

    if (isNewPersonOnCall && handoff.previousUserId) {
      return OnCallHandoffChange.NobodyOnCall;
    }

    if (
      handoff.nextUserId &&
      !this.isSameUser(handoff.previousNextUserId, handoff.nextUserId) &&
      !this.isSameUser(handoff.nextUserId, handoff.currentUserId)
    ) {
      return OnCallHandoffChange.NextOnCall;
    }

    return null;
  }

  /*
   * Who is next, as the line names them: somebody other than the person on
   * call - a rotation of one has nobody next.
   */
  public static getNextToName(handoff: OnCallHandoff): ObjectID | null {
    if (
      !handoff.nextUserId ||
      this.isSameUser(handoff.nextUserId, handoff.currentUserId)
    ) {
      return null;
    }

    return handoff.nextUserId;
  }

  /*
   * The messages of a change, each to the channels that want it said that
   * way - never two to one channel.
   */
  public static getChatPosts(handoff: OnCallHandoff): Array<OnCallChatPost> {
    const change: OnCallHandoffChange | null = this.getChange(handoff);

    if (change === OnCallHandoffChange.NobodyOnCall) {
      return [
        {
          line: OnCallChatLine.NobodyOnCall,
          updateKinds: [NotificationRuleUpdateKind.NobodyOnCall],
        },
      ];
    }

    // A gap with somebody on the roster: where a gap is posted (#10586).
    if (change === OnCallHandoffChange.NobodyPaged) {
      return [
        {
          line: OnCallChatLine.NobodyPaged,
          updateKinds: [NotificationRuleUpdateKind.NobodyOnCall],
        },
      ];
    }

    if (change === OnCallHandoffChange.NextOnCall) {
      return [
        {
          line: OnCallChatLine.NextOnCall,
          updateKinds: [NotificationRuleUpdateKind.OnCallNext],
        },
      ];
    }

    if (change !== OnCallHandoffChange.NowOnCall) {
      return [];
    }

    // Nobody next: one line, the same for every channel that wants it.
    if (!this.getNextToName(handoff)) {
      return [
        {
          line: OnCallChatLine.NowOnCall,
          updateKinds: [NotificationRuleUpdateKind.OnCallNow],
        },
      ];
    }

    const posts: Array<OnCallChatPost> = [
      {
        line: OnCallChatLine.NowOnCallThenNext,
        updateKinds: [NotificationRuleUpdateKind.OnCallNow],
        alsoWantedUpdateKinds: [NotificationRuleUpdateKind.OnCallNext],
      },
      {
        line: OnCallChatLine.NowOnCall,
        updateKinds: [NotificationRuleUpdateKind.OnCallNow],
        notWantedUpdateKinds: [NotificationRuleUpdateKind.OnCallNext],
      },
    ];

    // Who is next, for the channels that want only that - when it changed.
    if (!this.isSameUser(handoff.previousNextUserId, handoff.nextUserId)) {
      posts.push({
        line: OnCallChatLine.NextOnCall,
        updateKinds: [NotificationRuleUpdateKind.OnCallNext],
        notWantedUpdateKinds: [NotificationRuleUpdateKind.OnCallNow],
      });
    }

    return posts;
  }

  // The line of a post, with people named and moments read as given.
  public static async getLine(data: {
    line: OnCallChatLine;
    handoff: OnCallHandoff;
    policy: MarkdownText;
    nameOf: OnCallNameOf;
    moment: OnCallMomentText;
    /*
     * How the person on call now is named, where it is not nameOf: a
     * mention, on a rule that asks for one (issue #7968). Who is next is
     * always nameOf's.
     */
    nameOfPersonOnCall?: OnCallNameOf | undefined;
    /*
     * Somebody nothing pages (#10586), as this line names them - in a
     * channel by their display name alone, never their email address - and
     * why. Left out, they are named nowhere, and not a member.
     */
    notPagedOf?: OnCallNotPagedOf | undefined;
  }): Promise<MarkdownText> {
    const handoff: OnCallHandoff = data.handoff;
    const nextUserId: ObjectID | null = this.getNextToName(handoff);
    const notPagedOf: OnCallNotPagedOf =
      data.notPagedOf ||
      (async (): Promise<OnCallNotPagedPerson> => {
        return {
          name: FeedMarkdown.empty(),
          because: OnCallNotPagedBecause.NotAMember,
        };
      });

    // Who is next, as the line says them: named when paged, else why not.
    const getNext: () => Promise<{
      next?: MarkdownText | undefined;
      nextNotPaged?: OnCallNotPagedPerson | undefined;
    }> = async (): Promise<{
      next?: MarkdownText | undefined;
      nextNotPaged?: OnCallNotPagedPerson | undefined;
    }> => {
      if (!nextUserId) {
        return {};
      }

      return this.isNextUserPaged(handoff)
        ? { next: await data.nameOf(nextUserId) }
        : { nextNotPaged: await notPagedOf(nextUserId) };
    };

    if (data.line === OnCallChatLine.NobodyOnCall) {
      return OnCallChatText.nobodyOnCall({
        policy: data.policy,
        ...(await getNext()),
        from: handoff.nextStartsAt,
        moment: data.moment,
      });
    }

    if (data.line === OnCallChatLine.NobodyPaged) {
      if (!handoff.currentUserId) {
        return FeedMarkdown.empty();
      }

      return OnCallChatText.nobodyPaged({
        policy: data.policy,
        onCall: await notPagedOf(handoff.currentUserId),
        until: handoff.handoffAt,
        // Who takes over then, only when a page reaches them.
        next: (await getNext()).next,
        moment: data.moment,
      });
    }

    if (data.line === OnCallChatLine.NextOnCall) {
      if (!nextUserId) {
        return FeedMarkdown.empty();
      }

      const { next, nextNotPaged } = await getNext();

      return OnCallChatText.nextOnCall({
        person: next || FeedMarkdown.empty(),
        policy: data.policy,
        from: handoff.nextStartsAt,
        notPaged: nextNotPaged,
        hasJustJoined: Boolean(handoff.nextUserJustJoined),
        moment: data.moment,
      });
    }

    if (!handoff.currentUserId) {
      return FeedMarkdown.empty();
    }

    const person: MarkdownText = await (data.nameOfPersonOnCall || data.nameOf)(
      handoff.currentUserId,
    );

    return OnCallChatText.nowOnCall({
      person: person,
      policy: data.policy,
      until: handoff.handoffAt,
      ...(data.line === OnCallChatLine.NowOnCallThenNext
        ? await getNext()
        : {}),
      hasJustJoined: Boolean(handoff.currentUserJustJoined),
      moment: data.moment,
    });
  }

  /*
   * The change of one policy: its feed entry, and a line in each channel
   * that wants one.
   */
  public static async post(handoff: OnCallHandoff): Promise<void> {
    try {
      const change: OnCallHandoffChange | null = this.getChange(handoff);

      if (!change) {
        return;
      }

      const policy: MarkdownText = OnCallChatText.policy({
        name: handoff.onCallDutyPolicyName,
        link: (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            handoff.projectId,
            handoff.onCallDutyPolicyId,
          )
        ).toString(),
        scheduleName: (await this.pagesOtherSchedules(handoff))
          ? handoff.scheduleName
          : undefined,
      });

      // Who of its people nothing pages, why, and what a channel calls them.
      const notPaged: OnCallNotPagedPeople =
        await this.readNotPagedPeople(handoff);

      await this.writeFeedEntry({ handoff, change, policy, notPaged });

      await this.postToChannels({ handoff, policy, notPaged });
    } catch (err) {
      logger.error("Could not post an on-call handoff to the policy.", {
        projectId: handoff.projectId?.toString(),
        onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
        onCallDutyPolicyScheduleId: handoff.scheduleId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: handoff.projectId?.toString(),
        onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * Whether the policy pages a schedule other than this one: its lines
   * then say which schedule changed.
   */
  private static async pagesOtherSchedules(
    handoff: OnCallHandoff,
  ): Promise<boolean> {
    const other: OnCallDutyPolicyEscalationRuleSchedule | null =
      await OnCallDutyPolicyEscalationRuleScheduleService.findOneBy({
        query: {
          onCallDutyPolicyId: handoff.onCallDutyPolicyId,
          onCallDutyPolicyScheduleId: QueryHelper.notEquals(handoff.scheduleId),
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    return Boolean(other);
  }

  /*
   * The policy's feed: one entry for the change, its people named and its
   * moments in the schedule's zone, as the Dashboard shows them. Its
   * channels are told below, a line each. A gap - nobody on call, or
   * somebody nothing pages - is a Coverage gap started, in red; who is
   * next, when nothing will page them, a warning.
   */
  private static async writeFeedEntry(data: {
    handoff: OnCallHandoff;
    change: OnCallHandoffChange;
    policy: MarkdownText;
    notPaged: OnCallNotPagedPeople;
  }): Promise<void> {
    const handoff: OnCallHandoff = data.handoff;
    const timezone: Timezone = handoff.scheduleTimezone || Timezone.UTC;

    const line: OnCallChatLine =
      data.change === OnCallHandoffChange.NobodyOnCall
        ? OnCallChatLine.NobodyOnCall
        : data.change === OnCallHandoffChange.NobodyPaged
          ? OnCallChatLine.NobodyPaged
          : data.change === OnCallHandoffChange.NextOnCall
            ? OnCallChatLine.NextOnCall
            : OnCallChatLine.NowOnCallThenNext;

    // As the Dashboard names people: someone only invited as the project knows them.
    const nameOf: OnCallNameOf = async (
      userId: ObjectID,
    ): Promise<MarkdownText> => {
      const name: MarkdownText = await UserService.getUserMarkdownString({
        userId: userId,
        projectId: handoff.projectId,
      });

      return name.isEmpty() ? mdText`Somebody` : mdText`**${name}**`;
    };

    const feedInfoInMarkdown: MarkdownText = await this.getLine({
      line: line,
      handoff: handoff,
      policy: data.policy,
      nameOf: nameOf,
      moment: (date: Date): MarkdownText => {
        return mdText`${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
          {
            date: date,
            timezones: [timezone],
          },
        )}`;
      },
      notPagedOf: async (userId: ObjectID): Promise<OnCallNotPagedPerson> => {
        return {
          name: await nameOf(userId),
          because: this.getNotPagedBecause(data.notPaged, userId),
        };
      },
    });

    if (feedInfoInMarkdown.isEmpty()) {
      return;
    }

    const isGap: boolean =
      data.change === OnCallHandoffChange.NobodyOnCall ||
      data.change === OnCallHandoffChange.NobodyPaged;

    const isGapAhead: boolean =
      data.change === OnCallHandoffChange.NextOnCall &&
      !this.isNextUserPaged(handoff);

    // Whom the entry is about: the Dashboard's feed shows them beside it.
    const userId: ObjectID | null =
      data.change === OnCallHandoffChange.NowOnCall
        ? handoff.currentUserId
        : data.change === OnCallHandoffChange.NextOnCall
          ? handoff.nextUserId
          : null;

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: handoff.onCallDutyPolicyId,
      projectId: handoff.projectId,
      onCallDutyPolicyFeedEventType: isGap
        ? OnCallDutyPolicyFeedEventType.CoverageGapStarted
        : OnCallDutyPolicyFeedEventType.RosterHandoff,
      displayColor: isGap ? Red500 : isGapAhead ? Yellow500 : Green500,
      feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      userId: userId || undefined,
    });
  }

  /*
   * A line in each channel whose rules want one (getChatPosts): the person
   * named as each connected workspace knows them, moments in each reader's
   * own zone - in Mattermost, in the schedule's (OnCallChatByWorkspace).
   * Somebody nothing pages is named by their display name alone, in every
   * workspace and in the line for those with none of their own.
   */
  private static async postToChannels(data: {
    handoff: OnCallHandoff;
    policy: MarkdownText;
    notPaged: OnCallNotPagedPeople;
  }): Promise<void> {
    const handoff: OnCallHandoff = data.handoff;
    const posts: Array<OnCallChatPost> = this.getChatPosts(handoff);

    if (posts.length === 0) {
      return;
    }

    // Each person's name in each workspace, asked once for all the lines.
    const chat: OnCallChatByWorkspace = new OnCallChatByWorkspace({
      projectId: handoff.projectId,
      timezone: handoff.scheduleTimezone,
    });

    // Nothing connected: nowhere to post.
    if ((await chat.getWorkspaceTypes()).length === 0) {
      return;
    }

    const notPagedOf: OnCallNotPagedOf = async (
      userId: ObjectID,
    ): Promise<OnCallNotPagedPerson> => {
      return this.getNotPagedInChannel(data.notPaged, userId);
    };

    for (const post of posts) {
      // One message failing must not keep the others from their channels.
      try {
        const markdownByWorkspaceType: OnCallChatTextByWorkspaceType =
          await chat.write(
            (writer: OnCallChatWriter): Promise<MarkdownText> => {
              return this.getLine({
                line: post.line,
                handoff: handoff,
                policy: data.policy,
                nameOf: writer.nameOf,
                moment: writer.moment,
                notPagedOf: notPagedOf,
              });
            },
          );

        // For a workspace that has no line of its own: OneUptime's names.
        const line: MarkdownText = await this.getLine({
          line: post.line,
          handoff: handoff,
          policy: data.policy,
          nameOf: chat.nameIn(null),
          moment: (date: Date): MarkdownText => {
            return WorkspaceMessageTime.dateAndTime(date);
          },
          notPagedOf: notPagedOf,
        });

        if (line.isEmpty()) {
          continue;
        }

        /*
         * The line again with the person on call mentioned, for the
         * channels whose rules ask for it (issue #7968) - none when they
         * connected no workspace's account, and nobody can be mentioned.
         */
        const mentioned: OnCallChatLines | null =
          await this.getLinesMentioningPersonOnCall({
            chat: chat,
            post: post,
            handoff: handoff,
            policy: data.policy,
            notPagedOf: notPagedOf,
          });

        const send: (message: {
          markdownByWorkspaceType: OnCallChatTextByWorkspaceType;
          mentionsByWorkspaceType?:
            | OnCallChatMentionsByWorkspaceType
            | undefined;
          mentioning?: boolean | undefined;
        }) => Promise<void> = async (message: {
          markdownByWorkspaceType: OnCallChatTextByWorkspaceType;
          mentionsByWorkspaceType?:
            | OnCallChatMentionsByWorkspaceType
            | undefined;
          mentioning?: boolean | undefined;
        }): Promise<void> => {
          await OnCallDutyPolicyFeedService.sendWorkspaceNotification({
            projectId: handoff.projectId,
            onCallDutyPolicyId: handoff.onCallDutyPolicyId,
            feedInfoInMarkdown: line.toString(),
            markdownByWorkspaceType: message.markdownByWorkspaceType,
            ...(message.mentionsByWorkspaceType
              ? { mentionsByWorkspaceType: message.mentionsByWorkspaceType }
              : {}),
            ...(message.mentioning !== undefined
              ? { mentioning: message.mentioning }
              : {}),
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
            updateKinds: post.updateKinds,
            alsoWantedUpdateKinds: post.alsoWantedUpdateKinds,
            notWantedUpdateKinds: post.notWantedUpdateKinds,
          });
        };

        if (!mentioned) {
          await send({ markdownByWorkspaceType: markdownByWorkspaceType });
          continue;
        }

        /*
         * Said both ways, each to its own channels - never both to one: the
         * mention where a rule that posts it there asks for it, the name
         * everywhere else. Should the mention not be posted, the channels
         * that asked for it hear the line without it, rather than nothing.
         */
        let isMentionPosted: boolean = true;

        try {
          await send({
            markdownByWorkspaceType: mentioned.lines,
            mentionsByWorkspaceType: mentioned.mentions,
            mentioning: true,
          });
        } catch (err) {
          isMentionPosted = false;
          logger.error(
            "Could not post an on-call handoff's mention to its channels: they hear the line without it.",
            {
              projectId: handoff.projectId?.toString(),
              onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
            } as LogAttributes,
          );
          logger.error(err, {
            projectId: handoff.projectId?.toString(),
            onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
          } as LogAttributes);
        }

        await send({
          markdownByWorkspaceType: markdownByWorkspaceType,
          mentioning: isMentionPosted ? false : undefined,
        });
      } catch (err) {
        logger.error("Could not post an on-call handoff to its channels.", {
          projectId: handoff.projectId?.toString(),
          onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: handoff.projectId?.toString(),
          onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
        } as LogAttributes);
      }
    }
  }

  /*
   * A post's line in each workspace with the person on call now mentioned
   * where they connected that workspace's account (issue #7968), or null
   * when the post names nobody on call now - who is next and nobody on
   * call are never mentioned - or nobody can be mentioned anywhere.
   */
  private static async getLinesMentioningPersonOnCall(data: {
    chat: OnCallChatByWorkspace;
    post: OnCallChatPost;
    handoff: OnCallHandoff;
    policy: MarkdownText;
    notPagedOf: OnCallNotPagedOf;
  }): Promise<OnCallChatLines | null> {
    if (
      !data.handoff.currentUserId ||
      (data.post.line !== OnCallChatLine.NowOnCall &&
        data.post.line !== OnCallChatLine.NowOnCallThenNext)
    ) {
      return null;
    }

    const mentioned: OnCallChatLines = await data.chat.writeWithMentions(
      (writer: OnCallChatWriter): Promise<MarkdownText> => {
        return this.getLine({
          line: data.post.line,
          handoff: data.handoff,
          policy: data.policy,
          nameOf: writer.nameOf,
          moment: writer.moment,
          nameOfPersonOnCall: writer.mentionOf,
          notPagedOf: data.notPagedOf,
        });
      },
    );

    return Object.keys(mentioned.mentions).length > 0 ? mentioned : null;
  }

  /*
   * WHO OF A HAND-OFF'S PEOPLE NOTHING PAGES, AND WHAT A CHANNEL CALLS THEM
   * (#10586): the person on call now, or who is next, when they are not
   * members of the project. Why - only invited, or not a member - and the
   * name a channel may say: someone only invited by the name typed for them
   * with the invitation, never their account's own (#9823), someone who
   * left by the name they had. Never an email address: a name that holds
   * one is none. One read of who is only invited, and one of the names of
   * anyone else; nothing read when everybody named is paged. Unread, each
   * of them is not a member, with no name to say.
   */
  public static async readNotPagedPeople(
    handoff: OnCallHandoff,
  ): Promise<OnCallNotPagedPeople> {
    const people: OnCallNotPagedPeople = new Map<
      string,
      { because: OnCallNotPagedBecause; displayName: string }
    >();

    const userIds: Array<ObjectID> = [];
    const nextUserId: ObjectID | null = this.getNextToName(handoff);

    if (handoff.currentUserId && !this.isCurrentUserPaged(handoff)) {
      userIds.push(handoff.currentUserId);
    }

    if (nextUserId && !this.isNextUserPaged(handoff)) {
      userIds.push(nextUserId);
    }

    if (userIds.length === 0) {
      return people;
    }

    for (const userId of userIds) {
      people.set(userId.toString().toLowerCase(), {
        because: OnCallNotPagedBecause.NotAMember,
        displayName: "",
      });
    }

    try {
      const withheld: Map<string, WithheldProfile> =
        await PendingInviteeProfiles.readWithheldProfilesInProject({
          userIds: userIds.map((userId: ObjectID): string => {
            return userId.toString();
          }),
          projectId: handoff.projectId,
        });

      const others: Array<ObjectID> = [];

      for (const userId of userIds) {
        const invited: WithheldProfile | undefined =
          PendingInviteeProfiles.getWithheldProfile({
            userId: userId,
            withheld: withheld,
          });

        if (!invited) {
          others.push(userId);
          continue;
        }

        people.set(userId.toString().toLowerCase(), {
          because: OnCallNotPagedBecause.NotJoinedYet,
          displayName: this.getDisplayName(invited.inviteeName),
        });
      }

      if (others.length === 0) {
        return people;
      }

      const users: Array<User> = await UserService.findBy({
        query: {
          _id: QueryHelper.any(others),
        },
        select: {
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const user of users) {
        if (user.id) {
          people.set(user.id.toString().toLowerCase(), {
            because: OnCallNotPagedBecause.NotAMember,
            displayName: this.getDisplayName(user.name?.toString()),
          });
        }
      }
    } catch (err) {
      logger.error(
        "Could not read who an on-call handoff names that nothing pages; they are said to be no members, with no name.",
        {
          projectId: handoff.projectId?.toString(),
          onCallDutyPolicyId: handoff.onCallDutyPolicyId?.toString(),
        } as LogAttributes,
      );
      logger.error(err, {
        projectId: handoff.projectId?.toString(),
      } as LogAttributes);
    }

    return people;
  }

  /*
   * A name a channel may say: trimmed, and none when it is empty or holds
   * an email address - an inviter can type one as the name (#10586).
   */
  public static getDisplayName(name: string | null | undefined): string {
    const trimmed: string = (name || "").trim();

    return trimmed.includes("@") ? "" : trimmed;
  }

  // Why nothing pages somebody, as read: not a member when unread.
  private static getNotPagedBecause(
    notPaged: OnCallNotPagedPeople,
    userId: ObjectID,
  ): OnCallNotPagedBecause {
    return (
      notPaged.get(userId.toString().toLowerCase())?.because ||
      OnCallNotPagedBecause.NotAMember
    );
  }

  /*
   * Somebody nothing pages, as a channel says them: their display name -
   * as text, linking nowhere - or none, and why.
   */
  private static getNotPagedInChannel(
    notPaged: OnCallNotPagedPeople,
    userId: ObjectID,
  ): OnCallNotPagedPerson {
    const displayName: string =
      notPaged.get(userId.toString().toLowerCase())?.displayName || "";

    return {
      name: displayName ? mdText`**${displayName}**` : FeedMarkdown.empty(),
      because: this.getNotPagedBecause(notPaged, userId),
    };
  }

  /*
   * SOMEBODY ON CALL, OR NEXT, JOINED THE PROJECT DURING THE SHIFT (#10586).
   * While they were only invited, the hand-off that put them on call told
   * each policy's channels nobody was paged until it ended, and the one
   * that made them next that nobody would be then. A page reaches them now:
   * each policy that pages the schedule hears it once, as a hand-off would
   * say it - "📞 Ivy has joined the project and is now on call for Payments
   * until 5:50 PM, then Bob.", "➡️ Ivy has joined the project and is next on
   * call for Payments, from 5:50 PM." - to the channels that want who is on
   * call now, and who is next. The schedules are read off their rosters as
   * hand-offs keep them (currentUserIdOnRoster, nextUserIdOnRoster). Called
   * once they joined the project (OnCallJoinNotices); never throws.
   */
  public static async postJoinedDuringShift(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    try {
      const rosterSelect: Select<OnCallDutyPolicySchedule> = {
        _id: true,
        currentUserIdOnRoster: true,
        rosterHandoffAt: true,
        nextUserIdOnRoster: true,
        rosterNextStartAt: true,
      };

      const [onCallIn, nextIn]: [
        Array<OnCallDutyPolicySchedule>,
        Array<OnCallDutyPolicySchedule>,
      ] = await Promise.all([
        OnCallDutyPolicyScheduleService.findBy({
          query: {
            projectId: data.projectId,
            currentUserIdOnRoster: data.userId,
          },
          select: rosterSelect,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
        OnCallDutyPolicyScheduleService.findBy({
          query: {
            projectId: data.projectId,
            nextUserIdOnRoster: data.userId,
          },
          select: rosterSelect,
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

      // Each schedule once: on call in it comes first.
      const schedules: Map<string, OnCallDutyPolicySchedule> = new Map<
        string,
        OnCallDutyPolicySchedule
      >();

      for (const schedule of [...onCallIn, ...nextIn]) {
        if (schedule.id && !schedules.has(schedule.id.toString())) {
          schedules.set(schedule.id.toString(), schedule);
        }
      }

      if (schedules.size === 0) {
        return;
      }

      const rows: Array<OnCallDutyPolicyEscalationRuleSchedule> =
        await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
          query: {
            projectId: data.projectId,
            onCallDutyPolicyScheduleId: QueryHelper.any(
              [...schedules.values()].map(
                (schedule: OnCallDutyPolicySchedule): ObjectID => {
                  return schedule.id!;
                },
              ),
            ),
          },
          select: {
            projectId: true,
            _id: true,
            onCallDutyPolicyScheduleId: true,
            pageNextInRotation: true,
            onCallDutyPolicy: {
              name: true,
              _id: true,
            },
            onCallDutyPolicyEscalationRule: {
              name: true,
              _id: true,
              order: true,
            },
            onCallDutyPolicySchedule: {
              name: true,
              _id: true,
              timezone: true,
            },
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      // Who else each roster names, and whether a page reaches them.
      const others: Array<ObjectID> = [];

      for (const schedule of schedules.values()) {
        for (const userId of [
          schedule.currentUserIdOnRoster,
          schedule.nextUserIdOnRoster,
        ]) {
          if (userId && !this.isSameUser(userId, data.userId)) {
            others.push(userId);
          }
        }
      }

      const memberUserIds: Set<string> =
        others.length > 0
          ? await ProjectMembership.getMemberUserIds({
              projectId: data.projectId,
              userIds: others,
            })
          : new Set<string>();

      const isMember: (userId: ObjectID | null | undefined) => boolean = (
        userId: ObjectID | null | undefined,
      ): boolean => {
        return (
          !userId ||
          this.isSameUser(userId, data.userId) ||
          memberUserIds.has(userId.toString().toLowerCase())
        );
      };

      for (const schedule of schedules.values()) {
        const isOnCall: boolean = this.isSameUser(
          schedule.currentUserIdOnRoster,
          data.userId,
        );

        const policies: Array<OnCallHandoffPolicy> = OnCallHandoffPolicies.group(
          rows.filter((row: OnCallDutyPolicyEscalationRuleSchedule): boolean => {
            return this.isSameUser(
              row.onCallDutyPolicyScheduleId,
              schedule.id,
            );
          }),
        );

        for (const policy of policies) {
          const currentUserId: ObjectID | null =
            schedule.currentUserIdOnRoster || null;
          const nextUserId: ObjectID | null =
            schedule.nextUserIdOnRoster || null;

          // OnCallHandoffPosts.post never throws.
          await this.post({
            projectId: policy.projectId,
            onCallDutyPolicyId: policy.policyId,
            onCallDutyPolicyName: policy.policyName,
            scheduleId: schedule.id!,
            scheduleName: policy.scheduleName,
            scheduleTimezone: policy.scheduleTimezone,
            // Nobody's turn changed: only who a page reaches.
            previousUserId: currentUserId,
            previousNextUserId: nextUserId,
            currentUserId: currentUserId,
            handoffAt: schedule.rosterHandoffAt || null,
            nextUserId: nextUserId,
            nextStartsAt:
              schedule.rosterNextStartAt || schedule.rosterHandoffAt || null,
            currentUserIsMember: isMember(currentUserId),
            nextUserIsMember: isMember(nextUserId),
            currentUserJustJoined: isOnCall,
            nextUserJustJoined: !isOnCall,
          });
        }
      }
    } catch (err) {
      logger.error(
        "Could not tell an on-call policy's channels that somebody on call joined the project.",
        {
          projectId: data.projectId.toString(),
          userId: data.userId.toString(),
        } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
        userId: data.userId.toString(),
      } as LogAttributes);
    }
  }
}
