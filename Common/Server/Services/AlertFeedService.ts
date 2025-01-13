import { Blue500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { IsBillingEnabled } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import Model, {
  AlertFeedEventType,
} from "Common/Models/DatabaseModels/AlertFeed";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);

    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 120);
    }
  }

  public async createAlertFeed(data: {
    alertId: ObjectID;
    feedInfoInMarkdown: string;
    alertFeedEventType: AlertFeedEventType;
    projectId: ObjectID;
    moreInformationInMarkdown?: string | undefined;
    displayColor?: Color | undefined;
  }): Promise<Model> {
    if (!data.alertId) {
      throw new BadDataException("Alert ID is required");
    }

    if (!data.feedInfoInMarkdown) {
      throw new BadDataException("Log in markdown is required");
    }

    if (!data.alertFeedEventType) {
      throw new BadDataException("Alert log event is required");
    }

    if (!data.projectId) {
      throw new BadDataException("Project ID is required");
    }

    const alertFeed: Model = new Model();

    if (!data.displayColor) {
      data.displayColor = Blue500;
    }

    alertFeed.displayColor = data.displayColor;

    alertFeed.alertId = data.alertId;
    alertFeed.feedInfoInMarkdown = data.feedInfoInMarkdown;
    alertFeed.alertFeedEventType = data.alertFeedEventType;
    alertFeed.projectId = data.projectId;

    if (data.moreInformationInMarkdown) {
      alertFeed.moreInformationInMarkdown = data.moreInformationInMarkdown;
    }

    return await this.create({
      data: alertFeed,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
