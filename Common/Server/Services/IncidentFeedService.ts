import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceMessagePayload from "../../Types/Workspace/WorkspaceMessagePayload";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import IncidentFeed, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import IncidentService from "./IncidentService";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import WorkspaceUtil from "../Utils/Workspace/Workspace";

export class Service extends DatabaseService<IncidentFeed> {
  public constructor() {
    super(IncidentFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createIncidentFeedItem(data: {
    incidentId: ObjectID;
    feedInfoInMarkdown: string;
    incidentFeedEventType: IncidentFeedEventType;
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
          overrideMessageBlocksByWorkspace?:
            | Array<MessageBlocksByWorkspaceType>
            | undefined;
        }
      | undefined;
  }): Promise<void> {
    try {
      logger.debug("IncidentFeedService.createIncidentFeedItem");
      logger.debug(data);

      const incidentFeed: IncidentFeed = new IncidentFeed();

      if (!data.incidentId) {
        throw new BadDataException("Incident ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.incidentFeedEventType) {
        throw new BadDataException("Incident log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      incidentFeed.displayColor = data.displayColor;
      incidentFeed.incidentId = data.incidentId;
      incidentFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      incidentFeed.incidentFeedEventType = data.incidentFeedEventType;
      incidentFeed.projectId = data.projectId;

      if (!data.postedAt) {
        incidentFeed.postedAt = OneUptimeDate.getCurrentDate();
      }

      if (data.userId) {
        incidentFeed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        incidentFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      const createdIncidentFeed: IncidentFeed = await this.create({
        data: incidentFeed,
        props: {
          isRoot: true,
        },
      });

      logger.debug("Incident Feed created");
      logger.debug(createdIncidentFeed);

      try {
        // send notification to slack and teams
        if (data.workspaceNotification?.sendWorkspaceNotification) {
          let messageBlocksByWorkspaceTypes: Array<MessageBlocksByWorkspaceType> =
            [];

          if (data.workspaceNotification.overrideMessageBlocksByWorkspace) {
            // override these blocks.
            messageBlocksByWorkspaceTypes =
              data.workspaceNotification.overrideMessageBlocksByWorkspace;
          } else {
            // use markdown to create blocks
            messageBlocksByWorkspaceTypes =
              await WorkspaceUtil.getMessageBlocksByMarkdown({
                userId: data.workspaceNotification.notifyUserId,
                markdown: data.feedInfoInMarkdown,
                projectId: data.projectId,
              });
          }

          const workspaceNotificationPaylaods: Array<WorkspaceMessagePayload> =
            [];

          for (const messageBlocksByWorkspaceType of messageBlocksByWorkspaceTypes) {
            const existingChannels: Array<string> =
              await WorkspaceNotificationRuleService.getExistingChannelNamesBasedOnEventType(
                {
                  projectId: data.projectId,
                  notificationRuleEventType: NotificationRuleEventType.Incident,
                  workspaceType: messageBlocksByWorkspaceType.workspaceType,
                },
              );

            const incidentChannels: Array<WorkspaceChannel> =
              await IncidentService.getWorkspaceChannelForIncident({
                incidentId: data.incidentId,
                workspaceType: messageBlocksByWorkspaceType.workspaceType,
              });

            const workspaceMessagePayload: WorkspaceMessagePayload = {
              _type: "WorkspaceMessagePayload",
              workspaceType: messageBlocksByWorkspaceType.workspaceType,
              messageBlocks: messageBlocksByWorkspaceType.messageBlocks,
              channelNames: existingChannels,
              channelIds:
                incidentChannels.map((channel: WorkspaceChannel) => {
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
    } catch (e) {
      logger.error("Error in creating incident feed");
      logger.error(e);

      // we dont throw this error as it is not a critical error
    }
  }
}

export default new Service();
