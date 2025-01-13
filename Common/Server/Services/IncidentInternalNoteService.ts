import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentInternalNote";
import UserService from "./UserService";
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
    let userName: string | null = null;

    if (userId) {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (user && user.name && user.name.toString()) {
        userName = user.name.toString();
      }
    }

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.id!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PrivateNote,
      displayColor: Blue500,
      feedInfoInMarkdown: `**Private (Internal) Note Posted${userName ? " by " + userName.toString() : ""}**

${createdItem.note}
          `,
    });

    return createdItem;
  }
}

export default new Service();
