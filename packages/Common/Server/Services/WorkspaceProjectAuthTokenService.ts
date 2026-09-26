import ObjectID from "../../Types/ObjectID";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnUpdate, OnDelete, OnFind } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../Types/Database/Query";
import DiscordBindingService from "./DiscordBindingService";
import Model, {
  LegacyServerOnlyMiscDataKeys,
  MiscData,
  SlackChannelCache,
  SlackMiscData,
  WorkspaceMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (
      !createBy.props.isRoot &&
      createBy.data.workspaceType === WorkspaceType.Discord
    ) {
      throw new BadDataException(
        "Discord connections must be verified through the Discord authorization flow.",
      );
    }
    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (!updateBy.props.isRoot) {
      const rows: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: { workspaceType: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
      if (
        updateBy.data.workspaceType === WorkspaceType.Discord ||
        rows.some((row: Model): boolean => {
          return row.workspaceType === WorkspaceType.Discord;
        })
      ) {
        throw new BadDataException(
          "Discord connections can only be changed through the Discord settings endpoints.",
        );
      }
    }
    return { updateBy, carryForward: null };
  }

  public override async deleteOneBy(
    deleteBy: DeleteOneBy<Model>,
  ): Promise<number> {
    return await this.deleteBy({ ...deleteBy, limit: 1, skip: 0 });
  }

  public override async deleteBy(deleteBy: DeleteBy<Model>): Promise<number> {
    const query: Query<Model> =
      await ModelPermission.checkDeleteQueryPermission(
        Model,
        deleteBy.query,
        deleteBy.props,
      );
    const rows: Array<Model> = await this.findBy({
      query,
      select: { _id: true, projectId: true, workspaceType: true },
      skip: deleteBy.skip,
      limit: deleteBy.limit,
      props: { isRoot: true },
    });
    const discord: Array<Model> = rows.filter((row: Model): boolean => {
      return row.workspaceType === WorkspaceType.Discord;
    });
    if (discord.length === 0) {
      return await super.deleteBy(deleteBy);
    }
    let count: number = 0;
    for (const row of discord) {
      if (row.projectId && row._id) {
        count += await DiscordBindingService.disconnect({
          projectId: row.projectId,
          id: row._id,
          user: false,
        });
      }
    }
    const otherIds: Array<ObjectID> = rows
      .filter((row: Model): boolean => {
        return row.workspaceType !== WorkspaceType.Discord;
      })
      .map((row: Model): ObjectID => {
        return row.id!;
      });
    if (otherIds.length) {
      count += await super.deleteBy({
        ...deleteBy,
        query: { _id: QueryHelper.any(otherIds) },
        skip: 0,
        limit: otherIds.length,
      });
    }
    return count;
  }

  /*
   * Disconnecting a WORKSPACE disconnects every user link inside it.
   *
   * The dashboard's "Uninstall OneUptime from Slack / Microsoft Teams" button
   * deletes this row through the generic CRUD path, and nothing else about
   * the workspace survives that in a usable state: the user auth tokens were
   * minted against this workspace's OAuth app, and the UserSlack /
   * UserMicrosoftTeams notification methods are pointers at those links that
   * WorkspaceUserNotificationService will deterministically refuse to send
   * through once this row is gone ("This project is not connected to ...").
   *
   * Left behind, those verified-looking methods are worse than dead: the
   * on-call fallback selects them into its zero-cost tier and stops looking,
   * and the readiness surface keeps reporting the responder reachable. So the
   * user tokens are deleted THROUGH THEIR SERVICE here, whose own
   * onBeforeDelete cascades to the notification methods and their rules -
   * returning every affected responder to the "no rule" state the
   * verified-method fallback is built to rescue. This mirrors what the
   * Slack-side app_uninstall webhook already did; the webhook remains for
   * uninstalls initiated inside Slack, where this hook never fires.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
        workspaceType: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      if (!item.projectId || !item.workspaceType) {
        continue;
      }

      await WorkspaceUserAuthTokenService.deleteBy({
        query: {
          projectId: item.projectId,
          workspaceType: item.workspaceType,
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

  /*
   * miscData is readable by every project Viewer through the CRUD API. Older
   * releases kept the tenant's live Microsoft Graph app token in it, so a
   * row that still carries one (not yet migrated, or written by an old pod
   * during a rolling deploy) must not hand it out. Stripped for every caller,
   * root included: the token lives in `authToken` now, and anything that
   * reads miscData and writes it back then cleans the row as a side effect.
   */
  public static removeLegacyServerOnlyMiscData(miscData: MiscData): MiscData {
    if (!miscData || typeof miscData !== "object") {
      return miscData;
    }

    const hasLegacyKey: boolean = LegacyServerOnlyMiscDataKeys.some(
      (key: string) => {
        return Object.prototype.hasOwnProperty.call(miscData, key);
      },
    );

    if (!hasLegacyKey) {
      return miscData;
    }

    const cleaned: MiscData = { ...miscData };

    for (const key of LegacyServerOnlyMiscDataKeys) {
      delete cleaned[key];
    }

    return cleaned;
  }

  @CaptureSpan()
  protected override async onFindSuccess(
    onFind: OnFind<Model>,
    items: Array<Model>,
  ): Promise<OnFind<Model>> {
    for (const item of items) {
      if (item.miscData) {
        item.miscData = Service.removeLegacyServerOnlyMiscData(item.miscData);
      }
    }

    return { ...onFind, carryForward: items };
  }

  @CaptureSpan()
  public async getProjectAuth(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Model | null> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceType) {
      throw new BadDataException("workspaceType is required");
    }

    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        authToken: true,
        authTokenExpiresAt: true,
        workspaceProjectId: true,
        miscData: true,
        workspaceType: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getProjectAuths(data: {
    projectId: ObjectID;
  }): Promise<Array<Model>> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    return await this.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        authToken: true,
        authTokenExpiresAt: true,
        workspaceProjectId: true,
        miscData: true,
        workspaceType: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return Boolean(await this.getProjectAuth(data));
  }

  /*
   * Replaces the project's cached Slack channel list and nothing else.
   *
   * miscData cannot be updated through the CRUD API (see the model): for
   * Microsoft Teams it holds values the server trusts. The Slack channel
   * cache is the one part of it the dashboard edits, so its editor saves
   * through PUT /slack/channel-cache, which lands here. Every other miscData
   * field is carried over from the stored row, never from the caller.
   */
  @CaptureSpan()
  public async replaceSlackChannelCache(data: {
    projectId: ObjectID;
    channelCache: SlackChannelCache;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    const projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      },
      select: {
        _id: true,
        miscData: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectAuth || !projectAuth.id) {
      throw new BadDataException(
        "Slack is not connected for this project. Please connect Slack first.",
      );
    }

    const miscData: SlackMiscData = {
      ...((projectAuth.miscData as SlackMiscData | undefined) ||
        ({} as SlackMiscData)),
      channelCache: data.channelCache,
    };

    await this.updateOneById({
      id: projectAuth.id,
      data: {
        miscData: miscData,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * `authTokenExpiresAt` is the expiry of THIS `authToken`. Leaving it out
   * clears the stored one, so a new token never inherits an old token's
   * expiry.
   */
  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    authTokenExpiresAt?: Date | undefined;
    workspaceProjectId: string;
    miscData: WorkspaceMiscData;
  }): Promise<void> {
    if (data.workspaceType === WorkspaceType.Discord) {
      throw new BadDataException(
        "Use the verified Discord binding flow to change Discord connections.",
      );
    }
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceType) {
      throw new BadDataException("workspaceType is required");
    }

    if (!data.authToken) {
      throw new BadDataException("authToken is required");
    }

    if (!data.workspaceProjectId) {
      throw new BadDataException("workspaceProjectId is required");
    }

    if (!data.miscData) {
      throw new BadDataException("miscData is required");
    }

    let projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        _id: true,
        workspaceProjectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * A project stores exactly one workspace (one Microsoft tenant / one Slack
     * team). Re-running the connect flow from a DIFFERENT workspace used to
     * silently repoint the project, which breaks every existing notification
     * rule and orphans the bot conversations captured under the old workspace —
     * with no error and nothing in the logs.
     *
     * Refuse instead, and tell the admin to disconnect first if the change is
     * deliberate.
     */
    if (
      projectAuth &&
      projectAuth.workspaceProjectId &&
      projectAuth.workspaceProjectId !== data.workspaceProjectId
    ) {
      logger.error(
        `Refusing to repoint ${data.workspaceType} for project ${data.projectId.toString()} from workspace ${projectAuth.workspaceProjectId} to ${data.workspaceProjectId}.`,
        {
          projectId: data.projectId.toString(),
          workspaceType: data.workspaceType,
        },
      );

      const workspaceName: string = getWorkspaceTypeDisplayName(
        data.workspaceType,
      );

      throw new BadDataException(
        `This OneUptime project is already connected to a different ${workspaceName} workspace. Disconnect the existing ${workspaceName} connection in Project Settings before connecting a new one.`,
      );
    }

    if (!projectAuth) {
      projectAuth = new Model();

      projectAuth.projectId = data.projectId;
      projectAuth.authToken = data.authToken;
      if (data.authTokenExpiresAt) {
        projectAuth.authTokenExpiresAt = data.authTokenExpiresAt;
      }
      projectAuth.workspaceType = data.workspaceType;
      projectAuth.workspaceProjectId = data.workspaceProjectId;
      projectAuth.miscData = data.miscData;

      await this.create({
        data: projectAuth,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: projectAuth.id!,
        data: {
          authToken: data.authToken,
          authTokenExpiresAt: data.authTokenExpiresAt || null,
          workspaceProjectId: data.workspaceProjectId,
          miscData: data.miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  /*
   * Store a freshly minted token for an EXISTING connection, and nothing
   * else.
   *
   * Deliberately not refreshAuthToken: a token refresh must not rewrite
   * miscData (a stale copy would erase chats and teams captured by bot
   * events in the meantime), must not recreate a connection that was
   * disconnected while the token request was in flight, and must not follow
   * a connection that now names a different workspace. Matching on
   * workspaceProjectId covers the last two: if the row is gone or repointed,
   * nothing is written.
   */
  @CaptureSpan()
  public async saveRefreshedAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    workspaceProjectId: string;
    authToken: string;
    authTokenExpiresAt: Date;
  }): Promise<void> {
    if (data.workspaceType === WorkspaceType.Discord) {
      throw new BadDataException(
        "Discord uses the deployment bot credential and verified binding flow.",
      );
    }
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceType) {
      throw new BadDataException("workspaceType is required");
    }

    if (!data.workspaceProjectId) {
      throw new BadDataException("workspaceProjectId is required");
    }

    if (!data.authToken) {
      throw new BadDataException("authToken is required");
    }

    await this.updateOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: data.workspaceType,
        workspaceProjectId: data.workspaceProjectId,
      },
      data: {
        authToken: data.authToken,
        authTokenExpiresAt: data.authTokenExpiresAt,
      },
      props: {
        isRoot: true,
      },
    });
  }
}
export default new Service();
