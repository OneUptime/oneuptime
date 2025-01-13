import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  AlertLogEventType,
} from "Common/Models/DatabaseModels/AlertLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createAlertLog(data: {
    alertId: ObjectID;
    logInMarkdown: string;
    alertLogEventType: AlertLogEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
  }): Promise<Model> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
    }

    if (!data.logInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.alertLogEventType) {
      throw new BadDataException("Alert log event is required");
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required");
    }

    const alertLog: Model = new Model();

    if (!data.displayColor) {
      data.displayColor = Blue500;
    }

    alertLog.displayColor = data.displayColor;

    alertLog.alertId = data.alertId;
    alertLog.logInMarkdown = data.logInMarkdown;
    alertLog.alertLogEventType = data.alertLogEventType;
    alertLog.projectId = data.projectId;

    if (data.moreInformationInMarkdown) {
      alertLog.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: alertLog,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
