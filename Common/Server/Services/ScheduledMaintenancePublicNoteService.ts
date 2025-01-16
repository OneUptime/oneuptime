import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import OneUptimeDate from "../../Types/Date";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import ObjectID from "../../Types/ObjectID";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Blue500, Indigo500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

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

    await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
      scheduledMaintenanceId: createdItem.scheduledMaintenanceId!,
      projectId: createdItem.projectId!,
      scheduledMaintenanceFeedEventType:
        ScheduledMaintenanceFeedEventType.PublicNote,
      displayColor: Indigo500,
      userId: userId || undefined,
      feedInfoInMarkdown: `**Posted public note for this scheduledMaintenance on status page**
  
${createdItem.note}
            `,
    });

    return createdItem;
  }

  public override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
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
          scheduledMaintenanceFeedEventType:
            ScheduledMaintenanceFeedEventType.PublicNote,
          displayColor: Blue500,
          userId: userId || undefined,

          feedInfoInMarkdown: `**Updated Public Note**
    
${updatedItem.note}
              `,
        });
      }
    }
    return onUpdate;
  }
}

export default new Service();
