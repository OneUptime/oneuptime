import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
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
import Model from "../../Models/DatabaseModels/UserMicrosoftTeams";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      await UserNotificationRuleService.deleteBy({
        query: {
          userMicrosoftTeamsId: item.id!,
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
   * What this user would lose if this Microsoft Teams account were deleted.
   * Ask BEFORE calling delete; nothing here refuses anything.
   *
   * The hook directly above deletes every UserNotificationRule that points at
   * this account, and the foreign key is onDelete: "CASCADE" so the rows would
   * go even if it did not.
   */
  @CaptureSpan()
  public async getDeletionImpact(data: {
    itemId: ObjectID;
    projectId: ObjectID;
  }): Promise<NotificationDeletionImpact> {
    return UserNotificationRuleService.getNotificationMethodDeletionImpact({
      projectId: data.projectId,
      methodType: NotificationMethodChannel.MicrosoftTeams,
      methodId: data.itemId,
    });
  }

  /*
   * A Microsoft Teams notification method is a POINTER at the user's existing
   * workspace link, not a hand-typed address: the Microsoft Entra user id is
   * resolved from the user's own WorkspaceUserAuthToken and never accepted
   * from the request. That is why creation IS verification — the OAuth dance
   * that wrote the auth-token row already proved the person controls that
   * Microsoft Teams account.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

    if (!createBy.props.isRoot && createBy.data.microsoftTeamsUserId) {
      throw new BadDataException("microsoftTeamsUserId cannot be set directly");
    }

    if (!createBy.data.projectId || !createBy.data.userId) {
      throw new BadDataException("projectId and userId are required");
    }

    const projectId: ObjectID = new ObjectID(
      createBy.data.projectId.toString(),
    );
    const userId: ObjectID = new ObjectID(createBy.data.userId.toString());

    /*
     * One workspace link per (user, project) means a second row would be an
     * exact duplicate of the first.
     */
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
        "Microsoft Teams is already added as a notification method for this project.",
      );
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.authToken) {
      throw new BadDataException(
        "This project is not connected to Microsoft Teams. Please ask a project admin to connect Microsoft Teams in Project Settings > Microsoft Teams Integration.",
      );
    }

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.getUserAuth({
        projectId: projectId,
        userId: userId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!userAuth || !userAuth.workspaceUserId) {
      throw new BadDataException(
        "Your Microsoft Teams account is not connected to OneUptime for this project. Please go to User Settings > Microsoft Teams Integration and connect your Microsoft Teams account first.",
      );
    }

    createBy.data.microsoftTeamsUserId = userAuth.workspaceUserId;
    createBy.data.isVerified = true;

    /* Display label only — captured when the user linked their account. */
    const displayName: string | undefined = (
      userAuth.miscData as JSONObject | undefined
    )?.["displayName"] as string | undefined;

    if (displayName) {
      createBy.data.microsoftTeamsUserName = displayName;
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
     * The row is born verified (creation is gated on the live workspace
     * link), so default on-call rules are seeded at create time — same as
     * webhooks.
     */
    if (createdItem.projectId && createdItem.userId && createdItem.id) {
      try {
        await UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
          {
            projectId: createdItem.projectId,
            userId: createdItem.userId,
            notificationMethod: {
              userMicrosoftTeamsId: createdItem.id,
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
