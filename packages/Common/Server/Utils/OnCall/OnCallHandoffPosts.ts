import { Green500, Red500 } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { NotificationRuleUpdateKind } from "../../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { OnCallDutyPolicyFeedEventType } from "../../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import UserService from "../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import WorkspaceUtil from "../Workspace/Workspace";
import WorkspaceMessageTime from "../Workspace/WorkspaceMessageTime";
import OnCallChatText, { OnCallMomentText } from "./OnCallChatText";

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
 * .getUserStringForWorkspace), their OneUptime name otherwise. A moment
 * reads in each reader's own zone in Slack and Microsoft Teams, in UTC in
 * Mattermost, and in the schedule's zone in the policy's feed.
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
}

// What the change says, for the policy's channels.
export enum OnCallHandoffChange {
  // Somebody else is on call now.
  NowOnCall = "NowOnCall",
  // The person on call stays; somebody else is next.
  NextOnCall = "NextOnCall",
  // Somebody was on call, and now nobody is.
  NobodyOnCall = "NobodyOnCall",
}

// Which line a post is (OnCallChatText).
export enum OnCallChatLine {
  NowOnCall = "NowOnCall",
  NowOnCallThenNext = "NowOnCallThenNext",
  NextOnCall = "NextOnCall",
  NobodyOnCall = "NobodyOnCall",
}

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

// How a person is named in a line.
type NameOf = (userId: ObjectID) => Promise<MarkdownText>;

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

  /*
   * What the change says, or null when it says nothing a channel is told:
   * the same person on call and next, only a handoff time moved on.
   */
  public static getChange(handoff: OnCallHandoff): OnCallHandoffChange | null {
    const isNewPersonOnCall: boolean = !this.isSameUser(
      handoff.previousUserId,
      handoff.currentUserId,
    );

    if (isNewPersonOnCall && handoff.currentUserId) {
      return OnCallHandoffChange.NowOnCall;
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
    nameOf: NameOf;
    moment: OnCallMomentText;
  }): Promise<MarkdownText> {
    const handoff: OnCallHandoff = data.handoff;
    const nextUserId: ObjectID | null = this.getNextToName(handoff);

    if (data.line === OnCallChatLine.NobodyOnCall) {
      return OnCallChatText.nobodyOnCall({
        policy: data.policy,
        next: nextUserId ? await data.nameOf(nextUserId) : undefined,
        from: handoff.nextStartsAt,
        moment: data.moment,
      });
    }

    if (data.line === OnCallChatLine.NextOnCall) {
      return nextUserId
        ? OnCallChatText.nextOnCall({
            person: await data.nameOf(nextUserId),
            policy: data.policy,
            from: handoff.nextStartsAt,
            moment: data.moment,
          })
        : FeedMarkdown.empty();
    }

    if (!handoff.currentUserId) {
      return FeedMarkdown.empty();
    }

    return OnCallChatText.nowOnCall({
      person: await data.nameOf(handoff.currentUserId),
      policy: data.policy,
      until: handoff.handoffAt,
      next:
        data.line === OnCallChatLine.NowOnCallThenNext && nextUserId
          ? await data.nameOf(nextUserId)
          : undefined,
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

      await this.writeFeedEntry({ handoff, change, policy });

      await this.postToChannels({ handoff, policy });
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
   * channels are told below, a line each.
   */
  private static async writeFeedEntry(data: {
    handoff: OnCallHandoff;
    change: OnCallHandoffChange;
    policy: MarkdownText;
  }): Promise<void> {
    const handoff: OnCallHandoff = data.handoff;
    const timezone: Timezone = handoff.scheduleTimezone || Timezone.UTC;

    const line: OnCallChatLine =
      data.change === OnCallHandoffChange.NobodyOnCall
        ? OnCallChatLine.NobodyOnCall
        : data.change === OnCallHandoffChange.NextOnCall
          ? OnCallChatLine.NextOnCall
          : OnCallChatLine.NowOnCallThenNext;

    const feedInfoInMarkdown: MarkdownText = await this.getLine({
      line: line,
      handoff: handoff,
      policy: data.policy,
      nameOf: async (userId: ObjectID): Promise<MarkdownText> => {
        const name: MarkdownText = await UserService.getUserMarkdownString({
          userId: userId,
          projectId: handoff.projectId,
        });

        return name.isEmpty() ? mdText`Somebody` : mdText`**${name}**`;
      },
      moment: (date: Date): MarkdownText => {
        return mdText`${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
          {
            date: date,
            timezones: [timezone],
          },
        )}`;
      },
    });

    if (feedInfoInMarkdown.isEmpty()) {
      return;
    }

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
      onCallDutyPolicyFeedEventType:
        data.change === OnCallHandoffChange.NobodyOnCall
          ? OnCallDutyPolicyFeedEventType.CoverageGapStarted
          : OnCallDutyPolicyFeedEventType.RosterHandoff,
      displayColor:
        data.change === OnCallHandoffChange.NobodyOnCall ? Red500 : Green500,
      feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      userId: userId || undefined,
    });
  }

  /*
   * A line in each channel whose rules want one (getChatPosts): the person
   * named as each connected workspace knows them, moments in each
   * reader's own zone.
   */
  private static async postToChannels(data: {
    handoff: OnCallHandoff;
    policy: MarkdownText;
  }): Promise<void> {
    const handoff: OnCallHandoff = data.handoff;
    const posts: Array<OnCallChatPost> = this.getChatPosts(handoff);

    if (posts.length === 0) {
      return;
    }

    const workspaceTypes: Array<WorkspaceType> = (
      (await WorkspaceProjectAuthTokenService.getProjectAuths({
        projectId: handoff.projectId,
      })) || []
    )
      .filter((projectAuth: WorkspaceProjectAuthToken): boolean => {
        return Boolean(projectAuth.authToken && projectAuth.workspaceType);
      })
      .map((projectAuth: WorkspaceProjectAuthToken): WorkspaceType => {
        return projectAuth.workspaceType!;
      });

    // Nothing connected: nowhere to post.
    if (workspaceTypes.length === 0) {
      return;
    }

    // Each person's name in each workspace, asked once for all the lines.
    const names: Map<string, MarkdownText> = new Map<string, MarkdownText>();

    const nameIn: (workspaceType: WorkspaceType | null) => NameOf = (
      workspaceType: WorkspaceType | null,
    ): NameOf => {
      return async (userId: ObjectID): Promise<MarkdownText> => {
        const key: string = `${workspaceType || ""}:${userId.toString()}`;
        const known: MarkdownText | undefined = names.get(key);

        if (known) {
          return known;
        }

        const name: string = workspaceType
          ? (
              await WorkspaceUtil.getUserStringForWorkspace({
                userId: userId,
                projectId: handoff.projectId,
                workspaceType: workspaceType,
              })
            ).trim()
          : (
              await UserService.getUserMarkdownString({
                userId: userId,
                projectId: handoff.projectId,
              })
            ).toString();

        const markdown: MarkdownText = name
          ? FeedMarkdown.asMarkdown(name)
          : mdText`Somebody`;

        names.set(key, markdown);

        return markdown;
      };
    };

    // Each reader's own zone (Slack, Microsoft Teams); UTC in Mattermost.
    const moment: OnCallMomentText = (date: Date): MarkdownText => {
      return WorkspaceMessageTime.dateAndTime(date);
    };

    for (const post of posts) {
      // One message failing must not keep the others from their channels.
      try {
        const markdownByWorkspaceType: Partial<Record<WorkspaceType, string>> =
          {};

        for (const workspaceType of workspaceTypes) {
          markdownByWorkspaceType[workspaceType] = (
            await this.getLine({
              line: post.line,
              handoff: handoff,
              policy: data.policy,
              nameOf: nameIn(workspaceType),
              moment: moment,
            })
          ).toString();
        }

        // For a workspace that has no line of its own: OneUptime's names.
        const line: MarkdownText = await this.getLine({
          line: post.line,
          handoff: handoff,
          policy: data.policy,
          nameOf: nameIn(null),
          moment: moment,
        });

        if (line.isEmpty()) {
          continue;
        }

        await OnCallDutyPolicyFeedService.sendWorkspaceNotification({
          projectId: handoff.projectId,
          onCallDutyPolicyId: handoff.onCallDutyPolicyId,
          feedInfoInMarkdown: line.toString(),
          markdownByWorkspaceType: markdownByWorkspaceType,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
          updateKinds: post.updateKinds,
          alsoWantedUpdateKinds: post.alsoWantedUpdateKinds,
          notWantedUpdateKinds: post.notWantedUpdateKinds,
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
}
