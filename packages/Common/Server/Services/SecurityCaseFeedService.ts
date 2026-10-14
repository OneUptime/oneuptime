import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import SecurityCaseFeed, {
  SecurityCaseFeedEventType,
} from "../../Models/DatabaseModels/SecurityCaseFeed";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ProjectReferencesService from "./ProjectReferencesService";

export class Service extends ProjectReferencesService<SecurityCaseFeed> {
  public constructor() {
    super(SecurityCaseFeed);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  /*
   * Feed items are written by OneUptime as things happen on a case, crediting
   * whoever did them - someone who may have left the project since.
   * Refusing one of those would only lose the record (IncidentFeedService
   * does the same).
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /*
   * One timeline entry. Never throws: a case's change of status must not
   * fail because its feed entry could not be written, so a failure is
   * logged and dropped, as incidents do.
   */
  @CaptureSpan()
  public async createSecurityCaseFeedItem(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    feedInfoInMarkdown: string;
    eventType: SecurityCaseFeedEventType;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;
  }): Promise<void> {
    try {
      if (!data.feedInfoInMarkdown) {
        return;
      }

      const item: SecurityCaseFeed = new SecurityCaseFeed();
      item.projectId = data.projectId;
      item.securityCaseId = data.securityCaseId;
      item.feedInfoInMarkdown = data.feedInfoInMarkdown;
      item.securityCaseFeedEventType = data.eventType;
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
        `SecurityCaseFeedService: could not write a feed item for case ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
    }
  }
}

export default new Service();
