import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceMessagePayload from "../../Types/Workspace/WorkspaceMessagePayload";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import AlertService from "./AlertService";
import DatabaseService from "./DatabaseService";
import Model, {
  AlertFeedEventType,
} from "Common/Models/DatabaseModels/AlertFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import WorkspaceUtil from "../Utils/Workspace/Workspace";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createAlertFeedItem(data: {
    alertId: ObjectID;
    feedInfoInMarkdown: string;
    alertFeedEventType: AlertFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    workspaceNotification?:
      | {
          notifyUserId?: ObjectID | undefined; // this is oneuptime user id.
          sendWorkspaceNotification: boolean;
          appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
        }
      | undefined;
  }): Promise<void> {
    try {
      if (!data.alertId) {
        throw new BadDataException("Alert ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.alertFeedEventType) {
        throw new BadDataException("Alert log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      const alertFeed: Model = new Model();

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      if (data.userId) {
        alertFeed.userId = data.userId;
      }

      alertFeed.displayColor = data.displayColor;

      alertFeed.alertId = data.alertId;
      alertFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      alertFeed.alertFeedEventType = data.alertFeedEventType;
      alertFeed.projectId = data.projectId;

      if (!data.postedAt) {
        alertFeed.postedAt = OneUptimeDate.getCurrentDate();
      }

      if (data.moreInformationInMarkdown) {
        alertFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      await this.create({
        data: alertFeed,
        props: {
          isRoot: true,
        },
      });

      try {
        // send notification to slack and teams
        if (data.workspaceNotification?.sendWorkspaceNotification) {
          let messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> =
            [];

          // use markdown to create blocks
          messageBlocksByWorkspaceTypes =
            await WorkspaceUtil.getMessageBlocksByMarkdown({
              userId: data.workspaceNotification.notifyUserId,
              markdown: data.feedInfoInMarkdown,
              projectId: data.projectId,
            });

          if (data.workspaceNotification.appendMessageBlocks) {
            for (const messageBlocksByWorkspaceType of data
              .workspaceNotification.appendMessageBlocks) {
              const workspaceType: WorkspaceType =
                messageBlocksByWorkspaceType.workspaceType;

              messageBlocksByWorkspaceTypes
                .find(
                  (
                    messageBlocksByWorkspaceType: MessageBlocksByWorkspaceType
                  ) => {
                    return (
                      messageBlocksByWorkspaceType.workspaceType ===
                      workspaceType
                    );
                  }
                )
                ?.messageBlocks.push(
                  ...messageBlocksByWorkspaceType.messageBlocks
                );
            }
          }

          const workspaceNotificationPaylaods: Array<WorkspaceMessagePayload> =
            [];

          for (const messageBlocksByWorkspaceType of messageBlocksByWorkspaceTypes) {
            const existingChannels: Array<string> =
              await WorkspaceNotificationRuleService.getExistingChannelNamesBasedOnEventType(
                {
                  projectId: data.projectId,
                  notificationRuleEventType: NotificationRuleEventType.Alert,
                  workspaceType: messageBlocksByWorkspaceType.workspaceType,
                }
              );

            const alertChannels: Array<WorkspaceChannel> =
              await AlertService.getWorkspaceChannelForAlert({
                alertId: data.alertId,
                workspaceType: messageBlocksByWorkspaceType.workspaceType,
              });

            const workspaceMessagePayload: WorkspaceMessagePayload = {
              _type: "WorkspaceMessagePayload",
              workspaceType: messageBlocksByWorkspaceType.workspaceType,
              messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
              channelNames: existingChannels,
              channelIds:
                alertChannels.map((channel: WorkspaceChannel) => {
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
      } catch (e) {
        logger.error("Error in sending notification to slack and teams");
        logger.error(e);

        // we dont throw this error as it is not a critical error
      }
    } catch (error) {
      logger.error("AlertFeedService.createAlertFeedItem");
      logger.error(error);
      // we dont want to throw the error here, as this is a non-critical operation
    }
  }
}

export default new Service();
