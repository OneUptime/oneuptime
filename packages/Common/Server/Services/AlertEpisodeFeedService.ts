import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model, {
  AlertEpisodeFeedEventType,
} from "../../Models/DatabaseModels/AlertEpisodeFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import { applyAlertEpisodeRelatedRecordPrivacyFilter } from "../Utils/AlertEpisode/AlertEpisodePrivacyFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = applyAlertEpisodeRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyAlertEpisodeRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = applyAlertEpisodeRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyAlertEpisodeRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async createAlertEpisodeFeedItem(data: {
    alertEpisodeId: ObjectID;
    feedInfoInMarkdown: string;
    alertEpisodeFeedEventType: AlertEpisodeFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
    workspaceNotification?:
      | {
          notifyUserId?: ObjectID | undefined;
          sendWorkspaceNotification: boolean;
          appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
        }
      | undefined;
  }): Promise<void> {
    try {
      if (!data.alertEpisodeId) {
        throw new BadDataException("Alert Episode ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.alertEpisodeFeedEventType) {
        throw new BadDataException("Alert episode log event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      const alertEpisodeFeed: Model = new Model();

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      if (data.userId) {
        alertEpisodeFeed.userId = data.userId;
      }

      alertEpisodeFeed.displayColor = data.displayColor;

      alertEpisodeFeed.alertEpisodeId = data.alertEpisodeId;
      alertEpisodeFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      alertEpisodeFeed.alertEpisodeFeedEventType =
        data.alertEpisodeFeedEventType;
      alertEpisodeFeed.projectId = data.projectId;

      if (!data.postedAt) {
        alertEpisodeFeed.postedAt = OneUptimeDate.getCurrentDate();
      } else {
        alertEpisodeFeed.postedAt = data.postedAt;
      }

      if (data.moreInformationInMarkdown) {
        alertEpisodeFeed.moreInformationInMarkdown =
          data.moreInformationInMarkdown;
      }

      await this.create({
        data: alertEpisodeFeed,
        props: {
          isRoot: true,
        },
      });

      try {
        if (
          data.workspaceNotification &&
          data.workspaceNotification?.sendWorkspaceNotification
        ) {
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            alertEpisodeId: data.alertEpisodeId,
            feedInfoInMarkdown: data.feedInfoInMarkdown,
            workspaceNotification: data.workspaceNotification,
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams", {
          projectId: data.projectId?.toString(),
          alertEpisodeId: data.alertEpisodeId?.toString(),
        } as LogAttributes);
        logger.error(e, {
          projectId: data.projectId?.toString(),
          alertEpisodeId: data.alertEpisodeId?.toString(),
        } as LogAttributes);
      }
    } catch (error) {
      logger.error("AlertEpisodeFeedService.createAlertEpisodeFeedItem", {
        projectId: data.projectId?.toString(),
        alertEpisodeId: data.alertEpisodeId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: data.projectId?.toString(),
        alertEpisodeId: data.alertEpisodeId?.toString(),
      } as LogAttributes);
      // we dont want to throw the error here, as this is a non-critical operation
    }
  }

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    alertEpisodeId: ObjectID;
    feedInfoInMarkdown: string;
    workspaceNotification: {
      notifyUserId?: ObjectID | undefined;
      sendWorkspaceNotification: boolean;
      appendMessageBlocks?: Array<MessageBlocksByWorkspaceType> | undefined;
    };
  }): Promise<void> {
    return await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification(
      {
        projectId: data.projectId,
        notificationFor: {
          alertEpisodeId: data.alertEpisodeId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
