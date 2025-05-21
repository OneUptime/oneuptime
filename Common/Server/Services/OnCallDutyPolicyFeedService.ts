import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyFeed, {
  OnCallDutyPolicyFeedEventType,
} from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<OnCallDutyPolicyFeed> {
  public constructor() {
    super(OnCallDutyPolicyFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 90);
    }
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
      logger.debug(
        "OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem",
      );
      logger.debug(data);

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

      if (!data.postedAt) {
        onCallDutyPolicyFeed.postedAt = OneUptimeDate.getCurrentDate();
      }

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

      logger.debug("On Call Duty Policy Feed created");
      logger.debug(createdOnCallDutyPolicyFeed);

      try {
        // send notification to slack and teams
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            onCallDutyPolicyId: data.onCallDutyPolicyId,
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
      logger.error("Error in creating onCallDutyPolicy feed");
      logger.error(e);

      // we dont throw this error as it is not a critical error
    }
  }

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    onCallDutyPolicyId: ObjectID;
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
          onCallDutyPolicyId: data.onCallDutyPolicyId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
