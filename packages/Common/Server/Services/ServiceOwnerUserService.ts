import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/ServiceOwnerUser";
import ServiceFeedService from "./ServiceFeedService";
import { ServiceFeedEventType } from "../../Models/DatabaseModels/ServiceFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ServiceService from "./ServiceService";
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
        serviceId: true,
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
      const serviceId: ObjectID | undefined = item.serviceId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (!serviceId || !projectId || !userId) {
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

      await ServiceFeedService.createServiceFeedItem({
        serviceId: serviceId,
        projectId: projectId,
        serviceFeedEventType: ServiceFeedEventType.OwnerUserRemoved,
        displayColor: Red500,
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Removed **${owner}** as an owner of ${await ServiceService.getServiceMarkdownLink(
            projectId,
            serviceId,
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
    const serviceId: ObjectID | undefined = createdItem.serviceId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (serviceId && userId && projectId) {
      await ServiceFeedService.createServiceFeedItem({
        serviceId: serviceId,
        projectId: projectId,
        serviceFeedEventType: ServiceFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Added **${await UserService.getUserMarkdownString({
            userId: userId,
            projectId: projectId,
          })}** as an owner of ${await ServiceService.getServiceMarkdownLink(
            projectId,
            serviceId,
          )}.`.toString(),
        userId: createdByUserId || undefined,
      });
    }

    return createdItem;
  }
}

export default new Service();
