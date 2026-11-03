import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import DataAssetFeed, {
  DataAssetFeedEventType,
} from "../../Models/DatabaseModels/DataAssetFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends ProjectReferencesService<DataAssetFeed> {
  public constructor() {
    super(DataAssetFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * Feed items are written by OneUptime itself as it collects a store,
   * naming the asset they are about. Refusing one would only lose the
   * history; a feed item written by an API call or a workflow is checked
   * like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  @CaptureSpan()
  public async createDataAssetFeedItem(data: {
    dataAssetId: ObjectID;
    feedInfoInMarkdown: string;
    dataAssetFeedEventType: DataAssetFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    /*
     * A feed item is a side effect of the change it describes, and must never
     * fail the collection that found the change: everything here is logged
     * rather than thrown, as DataStoreFeedService does.
     */
    try {
      if (!data.dataAssetId) {
        throw new BadDataException("Data Asset ID is required");
      }

      if (!data.feedInfoInMarkdown) {
        throw new BadDataException("Log in markdown is required");
      }

      if (!data.dataAssetFeedEventType) {
        throw new BadDataException("Data Asset feed event is required");
      }

      if (!data.projectId) {
        throw new BadDataException("Project ID is required");
      }

      const feed: DataAssetFeed = new DataAssetFeed();

      feed.displayColor = data.displayColor || Blue500;
      feed.dataAssetId = data.dataAssetId;
      feed.feedInfoInMarkdown = data.feedInfoInMarkdown;
      feed.dataAssetFeedEventType = data.dataAssetFeedEventType;
      feed.projectId = data.projectId;
      feed.postedAt = data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.userId) {
        feed.createdByUserId = data.userId;
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
      logger.error("Error in creating data asset feed", {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
      logger.error(e, {
        projectId: data.projectId?.toString(),
      } as LogAttributes);
    }
  }
}

export default new Service();
