import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  IncidentFeedEventType,
} from "Common/Models/DatabaseModels/IncidentFeed";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createIncidentFeed(data: {
    incidentId: ObjectID;
    feedInfoInMarkdown: string;
    incidentFeedEventType: IncidentFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
  }): Promise<Model> {
    const incidentFeed: Model = new Model();

    if (!data.incidentId) {
      throw new BadDataException("Incident ID is required");
    }

    if (!data.feedInfoInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.incidentFeedEventType) {
      throw new BadDataException("Incident log event is required");
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required");
    }

    if (!data.displayColor) {
      data.displayColor = Blue500;
    }

    incidentFeed.displayColor = data.displayColor;
    incidentFeed.incidentId = data.incidentId;
    incidentFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
    incidentFeed.incidentFeedEventType = data.incidentFeedEventType;
    incidentFeed.projectId = data.projectId;

    if (data.moreInformationInMarkdown) {
      incidentFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: incidentFeed,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
