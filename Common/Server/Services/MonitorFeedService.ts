import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceMessagePayload from "../../Types/Workspace/WorkspaceMessagePayload";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MonitorFeed, {
  MonitorFeedEventType,
} from "Common/Models/DatabaseModels/MonitorFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import MonitorService from "./MonitorService";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<MonitorFeed> {
  public constructor() {
    super(MonitorFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  @CaptureSpan()
  public async createMonitorFeedItem(data: {
    monitorId: ObjectID;
    feedInfoInMarkdown: string;
    monitorFeedEventType: MonitorFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    // send notifificatin to slack and teams. This is optional
    workspaceNotification?:
      | {
          notifyUserId?: ObjectID | undefined; // this is oneuptime user id.
          sendWorkspaceNotification: boolean;
          appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
        }
      | undefined;
  }): Promise<void> {
    try {
      logger.debug("MonitorFeedService.createMonitorFeedItem");
      logger.debug(data);

      const monitorFeed: MonitorFeed = new MonitorFeed();

      if (!data.monitorId) {
        throw new BadDataException("Monitor ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.monitorFeedEventType) {
        throw new BadDataException("Monitor log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      monitorFeed.displayColor = data.displayColor;
      monitorFeed.monitorId = data.monitorId;
      monitorFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      monitorFeed.monitorFeedEventType = data.monitorFeedEventType;
      monitorFeed.projectId = data.projectId;

      if (!data.postedAt) {
        monitorFeed.postedAt = OneUptimeDate.getCurrentDate();
      }

      if (data.userId) {
        monitorFeed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        monitorFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      const createdMonitorFeed: MonitorFeed = await this.create({
        data: monitorFeed,
        props: {
          isRoot: true,
        },
      });

      logger.debug("Monitor Feed created");
      logger.debug(createdMonitorFeed);

      try {
        // send notification to slack and teams
        if (data.workspaceNotification && data.workspaceNotification?.sendWorkspaceNotification) {
          await Service.sendWorkspaceNotification({
            projectId: data.projectId,
            monitorId: data.monitorId,
            feedInfoInMarkdown: data.feedInfoInMarkdown,
            workspaceNotification: data.workspaceNotification,
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams");
        logger.error(e);

        // we dont throw this error as it is not a critical error
      }
    } catch (e) {
      logger.error("Error in creating monitor feed");
      logger.error(e);

      // we dont throw this error as it is not a critical error
    }
  }

  public static async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: {
      notifyUserId?: ObjectID | undefined; // this is oneuptime user id.
      sendWorkspaceNotification: boolean;
      appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    };
  }) {
    let messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> = [];

    // use markdown to create blocks
    messageBlocksByWorkspaceTypes =
      await WorkspaceUtil.getMessageBlocksByMarkdown({
        userId: data.workspaceNotification.notifyUserId,
        markdown: data.feedInfoInMarkdown,
        projectId: data.projectId,
      });

    if (data.workspaceNotification.appendMessageBlocks) {
      for (const messageBlocksByWorkspaceType of data.workspaceNotification
        .appendMessageBlocks) {
        const workspaceType: WorkspaceType =
          messageBlocksByWorkspaceType.workspaceType;

        messageBlocksByWorkspaceTypes
          .find(
            (messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType) => {
              return (
                messageBlocksByWorkspaceType.workspaceType === workspaceType
              );
            }
          )
          ?.messageBlocks.push(...messageBlocksByWorkspaceType.messageBlocks);
      }
    }

    const workspaceNotificationPaylaods: Array<WorkspaceMessagePayload> = [];

    for (const messageBlocksByWorkspaceType of messageBlocksByWorkspaceTypes) {
      const existingChannels: Array<string> =
        await WorkspaceNotificationRuleService.getExistingChannelNamesBasedOnEventType(
          {
            projectId: data.projectId,
            notificationRuleEventType: NotificationRuleEventType.Monitor,
            workspaceType: messageBlocksByWorkspaceType.workspaceType,
          }
        );

      const monitorChannels: Array<WorkspaceChannel> =
        await MonitorService.getWorkspaceChannelForMonitor({
          monitorId: data.monitorId,
          workspaceType: messageBlocksByWorkspaceType.workspaceType,
        });

      const workspaceMessagePayload: WorkspaceMessagePayload = {
        _type: "WorkspaceMessagePayload",
        workspaceType: messageBlocksByWorkspaceType.workspaceType,
        messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
        channelNames: existingChannels,
        channelIds:
          monitorChannels.map((channel: WorkspaceChannel) => {
            return channel.id;
          }) || [],
      };

      workspaceNotificationPaylaods.push(workspaceMessagePayload);
    }

    await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
      projectId: data.projectId,
      messagePayloadsByWorkspace: workspaceNotificationPaylaods,
    });
  }
}

export default new Service();
