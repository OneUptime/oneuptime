import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import { ProxmoxClusterFeedEventType } from "../../Models/DatabaseModels/ProxmoxClusterFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ProxmoxClusterService from "./ProxmoxClusterService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs, so the feed item has
     * to be built from what was read here.
     */
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
      select: {
        proxmoxClusterId: true,
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

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedByUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    const itemsToDelete: Array<Model> = onDelete.carryForward.itemsToDelete;

    for (const item of itemsToDelete) {
      const proxmoxClusterId: ObjectID | undefined = item.proxmoxClusterId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (!proxmoxClusterId || !projectId || !userId) {
        continue;
      }

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

      if (!user || !user.name) {
        continue;
      }

      await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
        proxmoxClusterId: proxmoxClusterId,
        projectId: projectId,
        proxmoxClusterFeedEventType:
          ProxmoxClusterFeedEventType.OwnerUserRemoved,
        displayColor: Red500,
        feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) as an owner of ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
          projectId,
          proxmoxClusterId,
        )}.`,
        userId: deletedByUserId || undefined,
      });
    }

    return onDelete;
  }

  @CaptureSpan()
  public override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const proxmoxClusterId: ObjectID | undefined = createdItem.proxmoxClusterId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (proxmoxClusterId && userId && projectId) {
      await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
        proxmoxClusterId: proxmoxClusterId,
        projectId: projectId,
        proxmoxClusterFeedEventType: ProxmoxClusterFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
          {
            userId: userId,
            projectId: projectId,
          },
        )}** as an owner of ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
          projectId,
          proxmoxClusterId,
        )}.`,
        userId: createdByUserId || undefined,
      });
    }

    return createdItem;
  }
}

export default new Service();
