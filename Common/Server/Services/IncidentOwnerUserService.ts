import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate } from "../Types/Database/Hooks";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }


  public override async onCreateSuccess(onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {
      // add incident feed. 
  
      const incidentId: ObjectID | undefined = createdItem.incidentId;
      const projectId: ObjectID | undefined = createdItem.projectId;
      const userId: ObjectID | undefined = createdItem.userId;
      const createdByUserId: ObjectID | undefined = createdItem.createdByUserId || onCreate.createBy.props.userId;
  
  
      if (incidentId && userId && projectId) {
  
  
        const user: User | null = await UserService.findOneById({
          id: userId,
          select: {
            name: true,
            email: true
          },
          props: {
            isRoot: true
          }
        })
  
        if (user && user.name) {

          await IncidentFeedService.createIncidentFeed({  
            incidentId: incidentId,
            projectId: projectId,
            incidentFeedEventType: IncidentFeedEventType.OwnerUserAdded,
            displayColor: Blue500,
            feedInfoInMarkdown: `${user.name.toString()} (${user.email?.toString()}) was added to the incident as the owner.`,
            userId: createdByUserId || undefined,
          });
  
        }
  
      }
  
      return createdItem;
  
    }
}

export default new Service();
