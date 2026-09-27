import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
  NotificationMethodChannel,
} from "./UserNotificationRuleService";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import logger from "../Utils/Logger";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import Model from "../../Models/DatabaseModels/UserDiscord";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { EntityManager, In, IsNull } from "typeorm";

/*
 * Which Discord methods a binding transition invalidates. The user scope
 * carries its user id as a required field so that a missing id can never
 * silently widen a single unlink into a project-wide cleanup.
 */
export type DiscordMethodBindingScope =
  | { scope: "project"; projectId: ObjectID }
  | { scope: "user"; projectId: ObjectID; userId: ObjectID };

/*
 * The advisory lock DiscordBindingService takes for every install, link and
 * disconnect. Taking the same one here serializes "add a method" against
 * those transitions.
 */
const bindingLockKey: (projectId: ObjectID) => string = (
  projectId: ObjectID,
): string => {
  return "discord-binding:" + projectId.toString();
};

/*
 * A Discord binding row is tombstoned rather than deleted (deletedAt set,
 * authToken cleared), so presence of a row alone does not mean a live link.
 */
const isLive: (
  row: WorkspaceProjectAuthToken | WorkspaceUserAuthToken | null,
) => boolean = (
  row: WorkspaceProjectAuthToken | WorkspaceUserAuthToken | null,
): boolean => {
  return Boolean(row && row.authToken && !row.deletedAt);
};

/*
 * Detach on-call history from the rules about to be deleted with these
 * methods. The timeline's rule foreign key is ON DELETE CASCADE, so without
 * this a Sent or Error row would vanish with its rule even though its
 * userDiscordId foreign key is SET NULL. A NULL rule id is already a valid
 * state (fallback deliveries have no rule); a retired row is told apart by its
 * cleared userDiscordId. Only Discord rules are touched here.
 */
const detachHistoryFromMethodRules: (
  manager: EntityManager,
  methodIds: Array<string>,
) => Promise<void> = async (
  manager: EntityManager,
  methodIds: Array<string>,
): Promise<void> => {
  if (methodIds.length === 0) {
    return;
  }

  const rules: Array<UserNotificationRule> = await manager
    .getRepository(UserNotificationRule)
    .find({
      where: { userDiscordId: In(methodIds) as unknown as ObjectID },
      select: { _id: true },
    });

  const ruleIds: Array<string> = rules.map(
    (rule: UserNotificationRule): string => {
      return rule._id!.toString();
    },
  );

  if (ruleIds.length === 0) {
    return;
  }

  await manager
    .getRepository(UserOnCallLogTimeline)
    .update(
      { userNotificationRuleId: In(ruleIds) as unknown as ObjectID },
      { userNotificationRuleId: null as unknown as ObjectID },
    );
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * DatabaseService applies the delete permission check only after this
     * hook, and the rule cleanup below runs as root. Scope first, so an id
     * the caller cannot delete (another member's, another project's) never
     * reaches the cleanup.
     */
    deleteBy.query = await ModelPermission.checkDeleteQueryPermission(
      Model,
      deleteBy.query,
      deleteBy.props,
    );

    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      skip: deleteBy.skip,
      limit: deleteBy.limit,
      props: {
        isRoot: true,
      },
    });

    /*
     * Pin the final delete to exactly the rows whose rules are removed here,
     * so a shifting skip/limit window cannot delete a different method.
     * DatabaseService re-applies permissions to this id query.
     */
    const ids: Array<ObjectID> = itemsToDelete.map((item: Model): ObjectID => {
      return item.id!;
    });
    deleteBy.query = { _id: QueryHelper.any(ids) };
    deleteBy.skip = 0;
    deleteBy.limit = ids.length;

    await this.executeTransaction(
      async (manager: EntityManager): Promise<void> => {
        await detachHistoryFromMethodRules(
          manager,
          ids.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
      },
    );

    for (const item of itemsToDelete) {
      await UserNotificationRuleService.deleteBy({
        query: {
          userDiscordId: item.id!,
          projectId: item.projectId!,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /**
   * What this user would lose if this Discord account were deleted. Ask
   * BEFORE calling delete; nothing here refuses anything.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.Discord,
      methodId: data.itemId,
    });
  }

  /*
   * The cascade DiscordBindingService runs INSIDE its own locked transaction
   * when it unlinks an account, relinks it to a different Discord account, or
   * disconnects the project. Those transitions write with a raw manager, so
   * no service hook fires; without this the methods would outlive the link
   * they point at, and the on-call fallback would treat them as reachable.
   *
   * Rules are deleted by the selected method ids only, so methodless opt-out
   * rules survive. On-call timeline rows keep their history: they are
   * detached from the doomed rules first, and their foreign key to
   * UserDiscord is ON DELETE SET NULL.
   */
  public async deleteMethodsForBinding(
    manager: EntityManager,
    data: DiscordMethodBindingScope,
  ): Promise<number> {
    if (!data.projectId) {
      throw new BadDataException(
        "Discord method cleanup requires a project id.",
      );
    }

    if (data.scope === "user" && !data.userId) {
      throw new BadDataException(
        "Discord method cleanup for an account link requires its user id.",
      );
    }

    const methods: Array<Model> = await manager.getRepository(Model).find({
      where: {
        projectId: data.projectId,
        ...(data.scope === "user" ? { userId: data.userId } : {}),
      },
      select: { _id: true },
    });

    const methodIds: Array<string> = methods.map((method: Model): string => {
      return method._id!.toString();
    });

    if (methodIds.length === 0) {
      return 0;
    }

    await detachHistoryFromMethodRules(manager, methodIds);

    await manager
      .getRepository(UserNotificationRule)
      .delete({ userDiscordId: In(methodIds) as unknown as ObjectID });

    await manager.getRepository(Model).delete({ _id: In(methodIds) });

    return methodIds.length;
  }

  /*
   * A Discord notification method is a POINTER at the user's existing
   * Discord account link, not a hand-typed address: the Discord user id is
   * resolved from the user's own WorkspaceUserAuthToken and never accepted
   * from the request. That link is only ever written by the Discord OAuth
   * flow (DiscordBindingService.link), so creation IS verification.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

    if (!createBy.props.isRoot && createBy.data.discordUserId) {
      throw new BadDataException("discordUserId cannot be set directly");
    }

    if (!createBy.props.isRoot && createBy.data.discordUserName) {
      throw new BadDataException("discordUserName cannot be set directly");
    }

    if (!createBy.data.projectId || !createBy.data.userId) {
      throw new BadDataException("projectId and userId are required");
    }

    const projectId: ObjectID = new ObjectID(
      createBy.data.projectId.toString(),
    );
    const userId: ObjectID = new ObjectID(createBy.data.userId.toString());

    // One account link per (user, project), so a second row is a duplicate.
    const existingCount: number = (
      await this.countBy({
        query: {
          projectId: projectId,
          userId: userId,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    if (existingCount > 0) {
      throw new BadDataException(
        "Discord is already added as a notification method for this project.",
      );
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Discord,
      });

    if (!isLive(projectAuth)) {
      throw new BadDataException(
        "This project is not connected to Discord. Please ask a project admin to connect Discord in Project Settings > Discord.",
      );
    }

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.getUserAuth({
        projectId: projectId,
        userId: userId,
        workspaceType: WorkspaceType.Discord,
      });

    if (!isLive(userAuth) || !userAuth!.workspaceUserId) {
      throw new BadDataException(
        "Your Discord account is not connected to OneUptime for this project. Please go to User Settings > Discord and connect your Discord account first.",
      );
    }

    createBy.data.discordUserId = userAuth!.workspaceUserId;
    createBy.data.isVerified = true;

    /* Display label only, captured when the user linked their account. */
    const miscData: JSONObject | undefined = userAuth!.miscData as
      | JSONObject
      | undefined;
    const label: unknown = miscData?.["displayName"] || miscData?.["username"];

    if (typeof label === "string" && label) {
      createBy.data.discordUserName = label;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * onBeforeCreate read the link outside the binding lock, so an unlink,
     * relink or disconnect could have committed between that read and this
     * insert. Its cascade would not have seen this row. Re-check under the
     * same lock: after this point a transition's cascade will see the row.
     */
    const stillLinked: boolean = await this.executeTransaction(
      async (manager: EntityManager): Promise<boolean> => {
        await manager.query("SET LOCAL lock_timeout = '5s'");
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [bindingLockKey(createdItem.projectId!)],
        );

        const link: WorkspaceUserAuthToken | null = await manager
          .getRepository(WorkspaceUserAuthToken)
          .findOne({
            where: {
              projectId: createdItem.projectId!,
              userId: createdItem.userId!,
              workspaceType: WorkspaceType.Discord,
              deletedAt: IsNull(),
            },
          });

        if (
          isLive(link) &&
          link!.workspaceUserId === createdItem.discordUserId
        ) {
          return true;
        }

        await manager
          .getRepository(Model)
          .delete({ _id: createdItem._id!.toString() });

        return false;
      },
    );

    if (!stillLinked) {
      throw new BadDataException(
        "Your Discord connection changed while this method was being added. Connect your Discord account again, then add the method.",
      );
    }

    // Born verified, so default on-call rules are seeded at create time.
    if (createdItem.projectId && createdItem.userId && createdItem.id) {
      try {
        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: createdItem.projectId,
            userId: createdItem.userId,
            notificationMethod: {
              userDiscordId: createdItem.id,
            },
          },
        );
      } catch (err) {
        logger.error(err);
      }
    }

    return createdItem;
  }
}

export default new Service();
