import Team from "../../Models/DatabaseModels/Team";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import TeamService from "./TeamService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";

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
        teamId: true,
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
      const teamId: ObjectID | undefined = item.teamId;

      if (scheduledMaintenanceId && teamId && projectId) {
        const team: Team | null = await TeamService.findOneById({
          id: teamId,
          select: {
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (team && team.name) {
          await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
            scheduledMaintenanceId: scheduledMaintenanceId,
            projectId: projectId,
            scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.OwnerTeamRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `**Team ${team.name}** was removed from the scheduled maintenance as the owner.`,
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
    const teamId: ObjectID | undefined = createdItem.teamId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (scheduledMaintenanceId && teamId && projectId) {
      const team: Team | null = await TeamService.findOneById({
        id: teamId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (team && team.name) {
        await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeed({
          scheduledMaintenanceId: scheduledMaintenanceId,
          projectId: projectId,
          scheduledMaintenanceFeedEventType: ScheduledMaintenanceFeedEventType.OwnerTeamAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `**Team ${team.name}** was added to the scheduled maintenance as the owner.`,
          userId: createdByUserId || undefined,
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
