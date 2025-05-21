import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../Models/DatabaseModels/IncidentFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<IncidentFeed> {
  public constructor() {
    super(IncidentFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  @CaptureSpan()
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
          appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
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
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            incidentId: data.incidentId,
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
      logger.error("Error in creating incident feed");
      logger.error(e);

      // we dont throw this error as it is not a critical error
    }
  }

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
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
          incidentId: data.incidentId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
