import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import ServiceLevelObjectiveFeed, {
  ServiceLevelObjectiveFeedEventType,
} from "../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<ServiceLevelObjectiveFeed> {
  public constructor() {
    super(ServiceLevelObjectiveFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async createServiceLevelObjectiveFeedItem(data: {
    serviceLevelObjectiveId: ObjectID;
    projectId: ObjectID;
    serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
    feedInfoInMarkdown: string;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    /*
     * A feed item is a side effect of the thing that actually happened - an
     * SLO edit, a status transition, a burn-rate alert. It must never be able
     * to fail the write or the evaluation it is describing, so everything here
     * is swallowed and logged rather than thrown - same contract as
     * ServiceFeedService and MonitorFeedService.
     */
    try {
      const feed: ServiceLevelObjectiveFeed = new ServiceLevelObjectiveFeed();

      if (!data.serviceLevelObjectiveId) {
        throw new BadDataException("Service Level Objective ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.serviceLevelObjectiveFeedEventType) {
        throw new BadDataException(
          "Service Level Objective feed event is required",
        );
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      feed.displayColor = data.displayColor;
      feed.serviceLevelObjectiveId = data.serviceLevelObjectiveId;
      feed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      feed.serviceLevelObjectiveFeedEventType =
        data.serviceLevelObjectiveFeedEventType;
      feed.projectId = data.projectId;
      /*
       * An explicit postedAt wins. The worker passes its own tick time so a
       * status change and the burn-rate alert it caused sort in the order they
       * were evaluated, not in the order the inserts happened to land.
       */
      feed.postedAt = data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.userId) {
        feed.userId = data.userId;
      }

      if (data.moreInformationInMarkdown) {
        feed.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      await this.create({
        data: feed,
        props: {
          isRoot: true,
        },
      });
    } catch (e) {
      logger.error("Error in creating service level objective feed", {
        projectId: data.projectId?.toString(),
        serviceLevelObjectiveId: data.serviceLevelObjectiveId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        serviceLevelObjectiveId: data.serviceLevelObjectiveId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }
}

export default new Service();
