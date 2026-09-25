import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DatabaseServerOwnerUser";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import User from "../../Models/DatabaseModels/User";
import UserService from "./UserService";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import ModelPermission from "../Types/Database/Permissions/Index";
import DatabaseServerService from "./DatabaseServerService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A caller adding an owner: the create permission first (so the lookup
   * below is no way to probe for databases), then the database must be in
   * the caller's project - by its FK column and its relation object alike.
   * Root writes (owner rules) choose their own database.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot) {
      ModelPermission.checkCreatePermissions(
        Model,
        createBy.data,
        createBy.props,
      );

      await DatabaseServerService.assertDatabaseServerReferenceInProject(
        createBy,
      );
    }

    return { createBy: createBy, carryForward: null };
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
        databaseServerId: true,
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
      const databaseServerId: ObjectID | undefined = item.databaseServerId;
      const projectId: ObjectID | undefined = item.projectId;
      const userId: ObjectID | undefined = item.userId;

      if (!databaseServerId || !projectId || !userId) {
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

      await DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: databaseServerId,
        projectId: projectId,
        databaseServerFeedEventType:
          DatabaseServerFeedEventType.OwnerUserRemoved,
        displayColor: Red500,
        feedInfoInMarkdown: `👨🏻‍💻 Removed **${user.name.toString()}** (${user.email?.toString()}) as an owner of ${await DatabaseServerService.getDatabaseServerMarkdownLink(
          projectId,
          databaseServerId,
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
    const databaseServerId: ObjectID | undefined = createdItem.databaseServerId;
    const projectId: ObjectID | undefined = createdItem.projectId;
    const userId: ObjectID | undefined = createdItem.userId;
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    /*
     * Added by a person (not an owner rule): whoever added this owner first,
     * it now counts as somebody investing in the database.
     */
    if (databaseServerId && userId && !onCreate.createBy.props.isRoot) {
      await DatabaseServerService.forgetAutomaticAssignments({
        databaseServerId: databaseServerId,
        kind: "ownerUserIds",
        ids: [userId],
      });
    }

    if (databaseServerId && userId && projectId) {
      await DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: databaseServerId,
        projectId: projectId,
        databaseServerFeedEventType: DatabaseServerFeedEventType.OwnerUserAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `👨🏻‍💻 Added **${await UserService.getUserMarkdownString(
          {
            userId: userId,
            projectId: projectId,
          },
        )}** as an owner of ${await DatabaseServerService.getDatabaseServerMarkdownLink(
          projectId,
          databaseServerId,
        )}.`,
        userId: createdByUserId || undefined,
      });
    }

    return createdItem;
  }
}

export default new Service();
