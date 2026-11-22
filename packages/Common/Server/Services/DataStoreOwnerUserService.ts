import ObjectID from "../../Types/ObjectID";
import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataStoreOwnerUser";
import DataStoreFeedService from "./DataStoreFeedService";
import { DataStoreFeedEventType } from "../../Models/DatabaseModels/DataStoreFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import PendingInviteeProfiles from "../Utils/TeamMember/PendingInviteeProfiles";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import DataStoreService from "./DataStoreService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import DataSecurityAiProposalService from "./DataSecurityAiProposalService";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";

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
        dataStoreId: true,
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
      const dataStoreId: ObjectID | undefined = item.dataStoreId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (!dataStoreId || !projectId || !userId) {
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

      // Someone only invited is named as the project knows them (#9823).
      await PendingInviteeProfiles.nameInProject({
        users: [user],
        projectId: projectId,
      });

      if (!user || !user.name) {
        continue;
      }

      await DataStoreFeedService.createDataStoreFeedItem({
        dataStoreId: dataStoreId,
        projectId: projectId,
        dataStoreFeedEventType: DataStoreFeedEventType.OwnerUserRemoved,
        displayColor: Red500,
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) as an owner of ${await DataStoreService.getDataStoreMarkdownLink(
            projectId,
            dataStoreId,
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
    const dataStoreId: ObjectID | undefined = createdItem.dataStoreId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (dataStoreId && userId && projectId) {
      await DataStoreFeedService.createDataStoreFeedItem({
        dataStoreId: dataStoreId,
        projectId: projectId,
        dataStoreFeedEventType: DataStoreFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown:
          mdText`👨🏻‍💻 Added **${await UserService.getUserMarkdownString({
            userId: userId,
            projectId: projectId,
          })}** as an owner of ${await DataStoreService.getDataStoreMarkdownLink(
            projectId,
            dataStoreId,
          )}.`.toString(),
        userId: createdByUserId || undefined,
      });
    }

    if (dataStoreId) {
      await expireOwnersProposedForStore(dataStoreId);
    }

    return createdItem;
  }
}

/*
 * A store that has an owner now no longer needs the owners OneUptime AI
 * proposed for it (#10374). Never fails the owner's add.
 */
export async function expireOwnersProposedForStore(
  dataStoreId: ObjectID,
): Promise<void> {
  try {
    await DataSecurityAiProposalService.expireWaitingOwnersForStore({
      dataStoreId,
      at: OneUptimeDate.getCurrentDate(),
    });
  } catch (error) {
    logger.error(
      `DataSecurity owners: could not settle the owners proposed for store ${dataStoreId.toString()}: ${error}`,
    );
  }
}

export default new Service();
