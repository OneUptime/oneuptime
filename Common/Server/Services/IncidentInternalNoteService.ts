import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentInternalNote";
import { OnCreate } from "../Types/Database/Hooks";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const userId: ObjectID | null | undefined =
      createdItem.createdByUserId || createdItem.createdByUser?.id;
  

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `**Posted Internal Note**

${createdItem.note}
          `,
    });

    return createdItem;
  }
}

export default new Service();
