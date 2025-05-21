import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import Model, {
  ScheduledMaintenanceFeedEventType,
} from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  @CaptureSpan()
  public async createScheduledMaintenanceFeedItem(data: {
    scheduledMaintenanceId: ObjectID;
    feedInfoInMarkdown: string;
    scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType;
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
      if (!data.scheduledMaintenanceId) {
        throw new BadDataException("Scheduled Maintenance ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.scheduledMaintenanceFeedEventType) {
        throw new BadDataException(
          "Scheduled Maintenance log event is required",
        );
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      const scheduledMaintenanceFeed: Model = new Model();

      scheduledMaintenanceFeed.displayColor = data.displayColor;
      scheduledMaintenanceFeed.scheduledMaintenanceId =
        data.scheduledMaintenanceId;
      scheduledMaintenanceFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      scheduledMaintenanceFeed.scheduledMaintenanceFeedEventType =
        data.scheduledMaintenanceFeedEventType;
      scheduledMaintenanceFeed.projectId = data.projectId;

      if (data.userId) {
        scheduledMaintenanceFeed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        scheduledMaintenanceFeed.moreInformationInMarkdown =
          data.moreInformationInMarkdown;
      }

      if (!data.postedAt) {
        scheduledMaintenanceFeed.postedAt = OneUptimeDate.getCurrentDate();
      }

      await this.create({
        data: scheduledMaintenanceFeed,
        props: {
          isRoot: true,
        },
      });

      try {
        // send notification to slack and teams
        if (data.workspaceNotification?.sendWorkspaceNotification) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            scheduledMaintenanceId: data.scheduledMaintenanceId,
            feedInfoInMarkdown: data.feedInfoInMarkdown,
            workspaceNotification: data.workspaceNotification,
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams");
        logger.error(e);

        // we dont throw this error as it is not a critical error
      }
    } catch (error) {
      logger.error(
        "ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem",
      );
      logger.error(error);
      // we dont want to throw the error here, as this is not critical but we still log it.
    }
  }

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: {
      notifyUserId?: ObjectID | undefined; // this is oneuptime user id.
      sendWorkspaceNotification: boolean;
      appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    };
  }): Promise<void> {
    return await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      {
        projectId: data.projectId,
        notificationFor: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
