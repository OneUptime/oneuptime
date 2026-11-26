import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ProxmoxClusterOwnerUser";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import { ProxmoxClusterFeedEventType } from "../../Models/DatabaseModels/ProxmoxClusterFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ProxmoxClusterService from "./ProxmoxClusterService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * The rows are gone by the time onDeleteSuccess runs, so the feed item has
     * to be built from what was read here: the rows the delete removes, and
     * the delete held to them (findRowsAndHoldDeleteToThem).
     */
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        proxmoxClusterId: true,
        projectId: true,
        userId: true,
      },
    );

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

      /*
       * The entry is the channels' line too: the owner is named as the
       * added entry names them, linked to their page - someone only
       * invited by the name typed for them, never by an address, and no
       * address after anybody's name (FeedPersonName, #10668). A member
       * with no name is no longer taken off without a word.
       */
      const owner: MarkdownText = await UserService.getUserMarkdownString({
        userId: userId,
        projectId: projectId,
      });

      if (owner.isEmpty()) {
        continue;
      }

      await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
        proxmoxClusterId: proxmoxClusterId,
        projectId: projectId,
        proxmoxClusterFeedEventType:
          ProxmoxClusterFeedEventType.OwnerUserRemoved,
        displayColor: Red500,
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Removed **${owner}** as an owner of ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
            projectId,
            proxmoxClusterId,
          )}.`.toString(),
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
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Added **${await UserService.getUserMarkdownString({
            userId: userId,
            projectId: projectId,
          })}** as an owner of ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
            projectId,
            proxmoxClusterId,
          )}.`.toString(),
        userId: createdByUserId || undefined,
      });
    }

    return createdItem;
  }
}

export default new Service();
