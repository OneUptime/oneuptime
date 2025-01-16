import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

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

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.PrivateNote,
      displayColor: Blue500,
      userId: userId || undefined,

      feedInfoInMarkdown: `**Posted Internal / Private Note**
  
${createdItem.note}
            `,
    });

    return createdItem;
  }


      public override async onUpdateSuccess(onUpdate: OnUpdate<Model>, _updatedItemIds: Array<ObjectID>): Promise<OnUpdate<Model>> {
    
        if (onUpdate.updateBy.data.note) {
    
    
    
          const updatedItems: Array<Model> = await this.findBy({
            query: onUpdate.updateBy.query,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {},
            select: {
              scheduledMaintenanceId: true,
              projectId: true,
              note: true,
              createdByUserId: true,
              createdByUser: {
                id: true,
              },
            },
          });
    
          const userId: ObjectID | null | undefined =
            onUpdate.updateBy.props.userId;
    
          for (const updatedItem of updatedItems) {
    
            await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
              scheduledMaintenanceId: updatedItem.scheduledMaintenanceId!,
              projectId: updatedItem.projectId!,
              scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.PrivateNote,
              displayColor: Blue500,
              userId: userId || undefined,
    
              feedInfoInMarkdown: `**Updated Private Note**
      
${updatedItem.note}
                `,
            });
    
    
          }
        }
        return onUpdate;
      }
}

export default new Service();
