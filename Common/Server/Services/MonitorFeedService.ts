import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MonitorFeed, {
  MonitorFeedEventType,
} from "../../Models/DatabaseModels/MonitorFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
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
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
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

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
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
          monitorId: data.monitorId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
