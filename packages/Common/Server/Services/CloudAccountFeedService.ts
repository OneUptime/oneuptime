import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import CloudAccountFeed, {
  CloudAccountFeedEventType,
} from "../../Models/DatabaseModels/CloudAccountFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<CloudAccountFeed> {
  public constructor() {
    super(CloudAccountFeed);

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
  public async createCloudAccountFeedItem(data: {
    cloudAccountId: ObjectID;
    feedInfoInMarkdown: string;
    cloudAccountFeedEventType: CloudAccountFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    /*
     * A feed item is a side effect of the thing that actually happened. It must
     * never be able to fail the write it is describing, so everything here is
     * swallowed and logged rather than thrown - same contract as
     * MonitorFeedService.
     */
    try {
      const feed: CloudAccountFeed = new CloudAccountFeed();

      if (!data.cloudAccountId) {
        throw new BadDataException("Cloud Account ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.cloudAccountFeedEventType) {
        throw new BadDataException("Cloud Account feed event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      if (!data.displayColor) {
        data.displayColor = Blue500;
      }

      feed.displayColor = data.displayColor;
      feed.cloudAccountId = data.cloudAccountId;
      feed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      feed.cloudAccountFeedEventType = data.cloudAccountFeedEventType;
      feed.projectId = data.projectId;
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
      logger.error("Error in creating cloud account feed", {
        projectId: data.projectId?.toString(),
        cloudAccountId: data.cloudAccountId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
        cloudAccountId: data.cloudAccountId?.toString(),
      } as LogAttributes);

      // we dont throw this error as it is not a critical error
    }
  }
}

export default new Service();
