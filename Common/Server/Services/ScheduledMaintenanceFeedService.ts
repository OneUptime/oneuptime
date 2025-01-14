import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  ScheduledMaintenanceFeedEventType,
} from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createScheduledMaintenanceFeed(data: {
    scheduledMaintenanceId: ObjectID;
    feedInfoInMarkdown: string;
    scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
    userId?: ObjectID | undefined;
    postedAt?: Date | undefined;  
  }): Promise<Model> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("Scheduled Maintenance ID is required");
    }

    if (!data.feedInfoInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.scheduledMaintenanceFeedEventType) {
      throw new BadDataException("Scheduled Maintenance log event is required");
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


    if(!data.postedAt){
      scheduledMaintenanceFeed.postedAt = OneUptimeDate.getCurrentDate();
    }

    return await this.create({
      data: scheduledMaintenanceFeed,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
