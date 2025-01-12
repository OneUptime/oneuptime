import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  IncidentLogEventType,
} from "Common/Models/DatabaseModels/IncidentLog";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
          this.hardDeleteItemsOlderThanInDays("createdAt", 120);
        }
  }

  public async createIncidentLog(data: {
    incidentId: ObjectID;
    logInMarkdown: string;
    incidentLogEventType: IncidentLogEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
  }): Promise<Model> {
    const incidentLog: Model = new Model();

    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
    }

    if (!data.logInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.incidentLogEventType) {
      throw new BadDataException("Incident log event is required");
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required");
    }

    if (!data.displayColor) {
      data.displayColor = Blue500;
    }

    incidentLog.displayColor = data.displayColor;
    incidentLog.incidentId = data.incidentId;
    incidentLog.logInMarkdown = data.logInMarkdown;
    incidentLog.incidentLogEventType = data.incidentLogEventType;
    incidentLog.projectId = data.projectId;

    if (data.moreInformationInMarkdown) {
      incidentLog.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: incidentLog,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
