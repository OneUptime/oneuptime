import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
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
        incidentId: true,
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
      const incidentId: ObjectID | undefined = item.incidentId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (incidentId && userId && projectId) {
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
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: incidentId,
            projectId: projectId,
            incidentFeedEventType: IncidentFeedEventType.OwnerUserRemoved,
            displayColor: Red500,
            feedInfoInMarkdown: `**${user.name.toString()}** (${user.email?.toString()}) was removed from the incident as the owner.`,
            userId: deleteByUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
            },
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
    // add incident feed.

    const incidentId: ObjectID | undefined = createdItem.incidentId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (incidentId && userId && projectId) {
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
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: incidentId,
          projectId: projectId,
          incidentFeedEventType: IncidentFeedEventType.OwnerUserAdded,
          displayColor: Gray500,
          feedInfoInMarkdown: `**${user.name.toString()}** (${user.email?.toString()}) was added to the incident as the owner.`,
          userId: createdByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
          },
        });
      }
    }

    return createdItem;
  }
}

export default new Service();
