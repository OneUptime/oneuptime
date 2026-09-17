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
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import logger from "../Utils/Logger";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import Model from "../../Models/DatabaseModels/UserSlack";
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
          userSlackId: item.id!,
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
   * What this user would lose if this Slack account were deleted. Ask BEFORE
   * calling delete; nothing here refuses anything.
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
      methodType: NotificationMethodChannel.Slack,
      methodId: data.itemId,
    });
  }

  /*
   * A Slack notification method is a POINTER at the user's existing workspace
   * link, not a hand-typed address: the Slack member id is resolved from the
   * user's own WorkspaceUserAuthToken and never accepted from the request.
   * That is why creation IS verification — the OAuth dance that wrote the
   * auth-token row already proved the person controls that Slack account.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot && createBy.data.isVerified) {
      throw new BadDataException("isVerified cannot be set to true");
    }

    if (!createBy.props.isRoot && createBy.data.slackUserId) {
      throw new BadDataException("slackUserId cannot be set directly");
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
        "Slack is already added as a notification method for this project.",
      );
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!projectAuth || !projectAuth.authToken) {
      throw new BadDataException(
        "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Slack Integration.",
      );
    }

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.getUserAuth({
        projectId: projectId,
        userId: userId,
        workspaceType: WorkspaceType.Slack,
      });

    if (!userAuth || !userAuth.workspaceUserId) {
      throw new BadDataException(
        "Your Slack account is not connected to OneUptime for this project. Please go to User Settings > Slack Integration and connect your Slack account first.",
      );
    }

    createBy.data.slackUserId = userAuth.workspaceUserId;
    createBy.data.isVerified = true;

    /*
     * Display label only — best effort. A Slack API hiccup must not stop the
     * method from being added.
     */
    try {
      const slackUserName: string | null =
        await SlackUtil.getUsernameFromUserId({
          authToken: projectAuth.authToken,
          userId: userAuth.workspaceUserId,
          projectId: projectId,
        });

      if (slackUserName) {
        createBy.data.slackUserName = slackUserName;
      }
    } catch (err) {
      logger.error("Could not resolve Slack username for new UserSlack row.");
      logger.error(err);
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
              userSlackId: createdItem.id,
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
