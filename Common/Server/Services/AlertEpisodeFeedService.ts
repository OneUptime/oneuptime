import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import Model, {
  AlertEpisodeFeedEventType,
} from "../../Models/DatabaseModels/AlertEpisodeFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
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
    } catch (error) {
      logger.error("AlertEpisodeFeedService.createAlertEpisodeFeedItem");
      logger.error(error);
      // we dont want to throw the error here, as this is a non-critical operation
    }
  }
}

export default new Service();
