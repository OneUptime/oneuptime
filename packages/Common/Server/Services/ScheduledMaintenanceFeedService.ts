import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SavedChatMessage, {
  SavedChatMessageUtil,
} from "../../Types/Workspace/SavedChatMessage";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import Model, {
  ScheduledMaintenanceFeedEventType,
} from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import FeedWorkspaceNotificationUtil, {
  FeedWorkspaceAuthor,
  FeedWorkspaceNotification,
} from "../Utils/Feed/FeedWorkspaceNotification";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);

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
  public async createScheduledMaintenanceFeedItem(data: {
    scheduledMaintenanceId: ObjectID;
    feedInfoInMarkdown: string;
    scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    /*
     * A note saved from a Slack or Microsoft Teams message: who wrote it,
     * in which chat, and when (SavedChatMessage). The row's user is
     * whoever saved it.
     */
    savedFromChatMessage?: SavedChatMessage | undefined;
    // Posted to Slack and Microsoft Teams too (FeedWorkspaceNotification).
    workspaceNotification?: FeedWorkspaceNotification | undefined;
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

      // When it happened: the time the caller gives, or now.
      scheduledMaintenanceFeed.postedAt =
        data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.savedFromChatMessage) {
        scheduledMaintenanceFeed.savedFromChatMessage =
          SavedChatMessageUtil.toJSON(data.savedFromChatMessage);
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
            author: FeedWorkspaceNotificationUtil.getAuthor({
              workspaceNotification: data.workspaceNotification,
              userId: data.userId,
              savedFromChatMessage: data.savedFromChatMessage,
            }),
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams", {
          projectId: data.projectId?.toString(),
          scheduledMaintenanceId: data.scheduledMaintenanceId?.toString(),
        } as LogAttributes);
        logger.error(e, {
          projectId: data.projectId?.toString(),
          scheduledMaintenanceId: data.scheduledMaintenanceId?.toString(),
        } as LogAttributes);

        // we dont throw this error as it is not a critical error
      }
    } catch (error) {
      logger.error(
        "ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem",
        {
          projectId: data.projectId?.toString(),
          scheduledMaintenanceId: data.scheduledMaintenanceId?.toString(),
        } as LogAttributes,
      );
      logger.error(error, {
        projectId: data.projectId?.toString(),
        scheduledMaintenanceId: data.scheduledMaintenanceId?.toString(),
      } as LogAttributes);
      // we dont want to throw the error here, as this is not critical but we still log it.
    }
  }

  /*
   * Posts an entry to the record's Slack and Microsoft Teams channels,
   * opening with the author the entry names (FeedWorkspaceNotification).
   */
  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    scheduledMaintenanceId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: FeedWorkspaceNotification;
    // Who the message opens with (FeedWorkspaceNotificationUtil.getAuthor).
    author?: FeedWorkspaceAuthor | undefined;
  }): Promise<void> {
    return await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      {
        projectId: data.projectId,
        notificationFor: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        notificationText: data.workspaceNotification.notificationText,
        workspaceNotification:
          FeedWorkspaceNotificationUtil.toWorkspaceNotification({
            workspaceNotification: data.workspaceNotification,
            author: data.author,
          }),
      },
    );
  }
}

export default new Service();
