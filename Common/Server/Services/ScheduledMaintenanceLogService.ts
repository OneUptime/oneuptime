import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  ScheduledMaintenanceLogEventType,
} from "Common/Models/DatabaseModels/ScheduledMaintenanceLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
              this.hardDeleteItemsOlderThanInDays("createdAt", 120);
            }
  }

  public async createScheduledMaintenanceLog(data: {
    scheduledMaintenanceId: ObjectID;
    logInMarkdown: string;
    scheduledMaintenanceLogEventType: ScheduledMaintenanceLogEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
  }): Promise<Model> {
    if (!data.scheduledMaintenanceId) {
      throw new BadDataException("Scheduled Maintenance ID is required");
    }

    if (!data.logInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.scheduledMaintenanceLogEventType) {
      throw new BadDataException("Scheduled Maintenance log event is required");
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required");
    }

    if (!data.displayColor) {
      data.displayColor = Blue500;
    }

    const scheduledMaintenanceLog: Model = new Model();

    scheduledMaintenanceLog.displayColor = data.displayColor;
    scheduledMaintenanceLog.scheduledMaintenanceId =
      data.scheduledMaintenanceId;
    scheduledMaintenanceLog.logInMarkdown = data.logInMarkdown;
    scheduledMaintenanceLog.scheduledMaintenanceLogEventType =
      data.scheduledMaintenanceLogEventType;
    scheduledMaintenanceLog.projectId = data.projectId;

    if (data.moreInformationInMarkdown) {
      scheduledMaintenanceLog.moreInformationInMarkdown =
        data.moreInformationInMarkdown;
    }

    return await this.create({
      data: scheduledMaintenanceLog,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
