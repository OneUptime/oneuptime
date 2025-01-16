import User from "../../Models/DatabaseModels/User";
import ObjectID from "../../Types/ObjectID";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import UserService from "./UserService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }


  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Model[] = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        scheduledMaintenanceId: true,
        projectId: true,
        userId: true,
      },
    });

    return {
      carryForward: {
        itemsToDelete: itemsToDelete,
      },
      deleteBy: deleteBy,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleteByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Model[] = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const scheduledMaintenanceId: ObjectID | undefined = item.scheduledMaintenanceId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (scheduledMaintenanceId && userId && projectId) {
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
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: projectId,
            scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `**${user.name.toString()}** (${user.email?.toString()}) was removed from the scheduled maintenance as the owner.`,
            userId: deleteByUserId || undefined,
          });
        }
      }
    }

    return onDelete;
  }

  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // add scheduledMaintenance feed.

    const scheduledMaintenanceId: ObjectID | undefined = createdItem.scheduledMaintenanceId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (scheduledMaintenanceId && userId && projectId) {
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
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId,
          scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `**${user.name.toString()}** (${user.email?.toString()}) was added to the scheduled maintenance as the owner.`,
          userId: createdByUserId || undefined,
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
