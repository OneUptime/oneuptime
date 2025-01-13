import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OneUptimeDate from "../../Types/Date";
import Model from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.postedAt) {
      createBy.data.postedAt = OneUptimeDate.getCurrentDate();
    }

    return {
      createBy: createBy,
      carryForward: null,
    };
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

      if (user && user.name) {
        userName = user.name.toString();
      }
    }

    await IncidentFeedService.createIncidentFeed({
      incidentId: createdItem.id!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.PublicNote,
      displayColor: Blue500,
      feedInfoInMarkdown: `**Note Posted on Status Page${userName ? " by " + userName.toString() : ""}**

${createdItem.note}
          `,
    });

    return createdItem;
  }
}

export default new Service();
