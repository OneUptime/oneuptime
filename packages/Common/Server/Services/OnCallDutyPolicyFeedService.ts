import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import FeedWorkspaceNotificationUtil, {
  FeedWorkspaceAuthor,
  FeedWorkspaceNotification,
} from "../Utils/Feed/FeedWorkspaceNotification";
import FeedUpdateKinds, {
  ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS,
} from "../Utils/Feed/FeedUpdateKinds";
import { NotificationRuleUpdateKind } from "../../Types/Workspace/NotificationRules/NotificationRuleUpdates";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { WorkspacePayloadMention } from "../../Types/Workspace/WorkspaceMessagePayload";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<OnCallDutyPolicyFeed> {
  public constructor() {
    super(OnCallDutyPolicyFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * Feed items are mostly written by OneUptime itself as things happen, naming
   * the record they are about and crediting whoever did it - someone who may
   * have left the project since, or an admin from outside it. Refusing one of
   * those would only lose the item. A feed item written by an API call or a
   * workflow is checked like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  @CaptureSpan()
  public async createOnCallDutyPolicyFeedItem(data: {
    onCallDutyPolicyId: ObjectID;
    feedInfoInMarkdown: string;
    onCallDutyPolicyFeedEventType: OnCallDutyPolicyFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    // Posted to Slack and Microsoft Teams too (FeedWorkspaceNotification).
    workspaceNotification?: FeedWorkspaceNotification | undefined;
    /*
     * What the channels are sent, when the entry says more than a channel
     * needs (issue #7549): the policy's feed keeps which escalation rule a
     * schedule was added to, and its order; the channel hears "Added
     * schedule Primary to Payments".
     */
    chatInfoInMarkdown?: string | undefined;
    /*
     * The channels' line as each workspace reads it, where it is not
     * chatInfoInMarkdown (issue #7967): its people named as that workspace
     * knows them - "@ana.lee" where Ana connected her account there - and
     * its moments as it shows them (OnCallChatByWorkspace). The feed keeps
     * OneUptime's names.
     */
    chatInfoByWorkspaceType?:
      | Partial<Record<WorkspaceType, string>>
      | undefined;
  }): Promise<void> {
    try {
      logger.debug(
        "OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem",
        {
          projectId: data.projectId?.toString(),
          onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
        } as LogAttributes,
      );
      logger.debug(data, {
        projectId: data.projectId?.toString(),
        onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
      } as LogAttributes);

      const onCallDutyPolicyFeed: OnCallDutyPolicyFeed =
        new OnCallDutyPolicyFeed();

      if (!data.onCallDutyPolicyId) {
        throw new BadDataException("OnCallDutyPolicy ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.onCallDutyPolicyFeedEventType) {
        throw new BadDataException("OnCallDutyPolicy log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      onCallDutyPolicyFeed.displayColor = data.displayColor;
      onCallDutyPolicyFeed.onCallDutyPolicyId = data.onCallDutyPolicyId;
      onCallDutyPolicyFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      onCallDutyPolicyFeed.onCallDutyPolicyFeedEventType =
        data.onCallDutyPolicyFeedEventType;
      onCallDutyPolicyFeed.projectId = data.projectId;

      /*
       * Filed when asked, else now: "On-Call Policy Created" is filed when
       * the policy's create began, so it stays the first line of its feed
       * although its owners are written before it. A time asked for used to
       * be dropped, leaving the entry with none.
       */
      onCallDutyPolicyFeed.postedAt =
        data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.userId) {
        onCallDutyPolicyFeed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        onCallDutyPolicyFeed.moreInformationInMarkdown =
          data.moreInformationInMarkdown;
      }

      const createdOnCallDutyPolicyFeed: OnCallDutyPolicyFeed =
        await this.create({
          data: onCallDutyPolicyFeed,
          props: {
            isRoot: true,
          },
        });

      logger.debug("On-Call Policy Feed created", {
        projectId: data.projectId?.toString(),
        onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
      } as LogAttributes);
      logger.debug(createdOnCallDutyPolicyFeed, {
        projectId: data.projectId?.toString(),
        onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
      } as LogAttributes);

      try {
        // send notification to slack and teams
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            onCallDutyPolicyId: data.onCallDutyPolicyId,
            feedInfoInMarkdown:
              data.chatInfoInMarkdown || data.feedInfoInMarkdown,
            ...(data.chatInfoByWorkspaceType &&
            Object.keys(data.chatInfoByWorkspaceType).length > 0
              ? { markdownByWorkspaceType: data.chatInfoByWorkspaceType }
              : {}),
            workspaceNotification: data.workspaceNotification,
            // Which updates it is: posted where a rule wants one of them.
            updateKinds: FeedUpdateKinds.resolve({
              named: data.workspaceNotification.updateKinds,
              ofType:
                ON_CALL_DUTY_POLICY_FEED_UPDATE_KINDS[
                  data.onCallDutyPolicyFeedEventType
                ],
            }),
            author: FeedWorkspaceNotificationUtil.getAuthor({
              workspaceNotification: data.workspaceNotification,
              userId: data.userId,
            }),
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams", {
          projectId: data.projectId?.toString(),
          onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
        } as LogAttributes);
        logger.error(e, {
          projectId: data.projectId?.toString(),
          onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
        } as LogAttributes);

        // we dont throw this error as it is not a critical error
      }
    } catch (e) {
      logger.error("Error in creating onCallDutyPolicy feed", {
        projectId: data.projectId?.toString(),
        onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        onCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }

  /*
   * Posts an entry to the record's Slack and Microsoft Teams channels,
   * opening with the author the entry names (FeedWorkspaceNotification).
   */
  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: FeedWorkspaceNotification;
    // Who the message opens with (FeedWorkspaceNotificationUtil.getAuthor).
    author?: FeedWorkspaceAuthor | undefined;
    /*
     * Which updates the entry is (FeedUpdateKinds): posted only where a
     * rule wants one of them. Left out, wherever its messages go.
     */
    updateKinds?: Array<NotificationRuleUpdateKind> | undefined;
    /*
     * For one of several messages about one handoff (OnCallHandoffPosts):
     * posted only where a rule also wants one of these updates, and where
     * no rule wants any of those not wanted.
     */
    alsoWantedUpdateKinds?: Array<NotificationRuleUpdateKind> | undefined;
    notWantedUpdateKinds?: Array<NotificationRuleUpdateKind> | undefined;
    // What a workspace is sent, where it is not feedInfoInMarkdown.
    markdownByWorkspaceType?:
      | Partial<Record<WorkspaceType, string>>
      | undefined;
    /*
     * The person on call each workspace's line mentions, on a rule that
     * asks for it (issue #7968, OnCallHandoffPosts)...
     */
    mentionsByWorkspaceType?:
      | Partial<Record<WorkspaceType, Array<WorkspacePayloadMention>>>
      | undefined;
    /*
     * ...posted only where a rule that wants the line asks to mention them
     * (true), or, the line without, only where none does (false).
     */
    mentioning?: boolean | undefined;
  }): Promise<void> {
    return await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      {
        projectId: data.projectId,
        notificationFor: {
          onCallDutyPolicyId: data.onCallDutyPolicyId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        markdownByWorkspaceType: data.markdownByWorkspaceType,
        ...(data.mentionsByWorkspaceType
          ? { mentionsByWorkspaceType: data.mentionsByWorkspaceType }
          : {}),
        notificationText: data.workspaceNotification.notificationText,
        workspaceNotification: {
          ...FeedWorkspaceNotificationUtil.toWorkspaceNotification({
            workspaceNotification: data.workspaceNotification,
            author: data.author,
            updateKinds: data.updateKinds,
          }),
          ...(data.alsoWantedUpdateKinds
            ? { alsoWantedUpdateKinds: data.alsoWantedUpdateKinds }
            : {}),
          ...(data.notWantedUpdateKinds
            ? { notWantedUpdateKinds: data.notWantedUpdateKinds }
            : {}),
          ...(data.mentioning !== undefined
            ? { mentioning: data.mentioning }
            : {}),
        },
      },
    );
  }
}

export default new Service();
