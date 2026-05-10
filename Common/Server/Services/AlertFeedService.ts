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
  AlertFeedEventType,
} from "../../Models/DatabaseModels/AlertFeed";
import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
} from "./WorkspaceNotificationRuleService";
import { applyAlertRelatedRecordPrivacyFilter } from "../Utils/Alert/AlertPrivacyFilter";
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
    findBy.query = applyAlertRelatedRecordPrivacyFilter(
      findBy.query,
      findBy.props,
    );
    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = applyAlertRelatedRecordPrivacyFilter(
      countBy.query,
      countBy.props,
    );
    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = applyAlertRelatedRecordPrivacyFilter(
      updateBy.query,
      updateBy.props,
    );
    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = applyAlertRelatedRecordPrivacyFilter(
      deleteBy.query,
      deleteBy.props,
    );
    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
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
          await this.sendWorkspaceNotification({
            projectId: data.projectId,
            alertId: data.alertId,
            feedInfoInMarkdown: data.feedInfoInMarkdown,
            workspaceNotification: data.workspaceNotification,
          });
        }
      } catch (e) {
        logger.error("Error in sending notification to slack and teams", {
          projectId: data.projectId?.toString(),
          alertId: data.alertId?.toString(),
        } as LogAttributes);
        logger.error(e, {
          projectId: data.projectId?.toString(),
          alertId: data.alertId?.toString(),
        } as LogAttributes);

        // we dont throw this error as it is not a critical error
      }
    } catch (error) {
      logger.error("AlertFeedService.createAlertFeedItem", {
        projectId: data.projectId?.toString(),
        alertId: data.alertId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: data.projectId?.toString(),
        alertId: data.alertId?.toString(),
      } as LogAttributes);
      // we dont want to throw the error here, as this is a non-critical operation
    }
  }

  @CaptureSpan()
  public async sendWorkspaceNotification(data: {
    projectId: ObjectID;
    alertId: ObjectID;
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
          alertId: data.alertId,
        },
        feedInfoInMarkdown: data.feedInfoInMarkdown,
        workspaceNotification: data.workspaceNotification,
      },
    );
  }
}

export default new Service();
