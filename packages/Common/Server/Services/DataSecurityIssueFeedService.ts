import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import DataSecurityIssueFeed, {
  DataSecurityIssueFeedEventType,
} from "../../Models/DatabaseModels/DataSecurityIssueFeed";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

export class Service extends ProjectReferencesService<DataSecurityIssueFeed> {
  public constructor() {
    super(DataSecurityIssueFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * Feed items are written by OneUptime as things happen on an issue, crediting
   * whoever did them - someone who may have left the project since.
   * Refusing one of those would only lose the record (IncidentFeedService
   * does the same).
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * One timeline entry. Never throws: an issue's change of status must not
   * fail because its feed entry could not be written, so a failure is
   * logged and dropped, as incidents do.
   */
  @CaptureSpan()
  public async createDataSecurityIssueFeedItem(data: {
    projectId: ObjectID;
    dataSecurityIssueId: ObjectID;
    feedInfoInMarkdown: string;
    eventType: DataSecurityIssueFeedEventType;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    try {
      if (!data.feedInfoInMarkdown) {
        return;
      }

      const item: DataSecurityIssueFeed = new DataSecurityIssueFeed();
      item.projectId = data.projectId;
      item.dataSecurityIssueId = data.dataSecurityIssueId;
      item.feedInfoInMarkdown = data.feedInfoInMarkdown;
      item.dataSecurityIssueFeedEventType = data.eventType;
      item.displayColor = data.displayColor || Blue500;
      item.postedAt = data.postedAt || OneUptimeDate.getCurrentDate();

      if (data.moreInformationInMarkdown) {
        item.moreInformationInMarkdown = data.moreInformationInMarkdown;
      }

      if (data.userId) {
        item.userId = data.userId;
      }

      await this.create({
        data: item,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      logger.error(
        `DataSecurityIssueFeedService: could not write a feed item for issue ${data.dataSecurityIssueId.toString()}:`,
      );
      logger.error(error);
    }
  }
}

export default new Service();
