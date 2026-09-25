import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import DatabaseService from "./DatabaseService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnUpdate, OnDelete } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteOneBy from "../Types/Database/DeleteOneBy";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../Types/Database/Query";
import DiscordBindingService from "./DiscordBindingService";
import BadDataException from "../../Types/Exception/BadDataException";
import Model, {
  WorkspaceUserMiscData,
} from "../../Models/DatabaseModels/WorkspaceUserAuthToken";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
        "Discord account identities must be verified through Discord authorization.",
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
          "Discord account identities can only be changed through Discord authorization.",
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
          user: true,
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
   * A UserSlack / UserMicrosoftTeams notification method is a pointer at the
   * workspace link being deleted here, so it goes down with it (which also
   * deletes the notification rules routing to it, via that service's own
   * delete hook). Leaving the method row behind would be worse than deleting
   * it: a rule pointing at a dead link fails with an error row and no re-page,
   * while a user with NO matching rule is rescued by the verified-method
   * fallback.
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
        userId: true,
        workspaceType: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of itemsToDelete) {
      if (!item.projectId || !item.userId) {
        continue;
      }

      if (item.workspaceType === WorkspaceType.Slack) {
        await UserSlackService.deleteBy({
          query: {
            projectId: item.projectId,
            userId: item.userId,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }

      if (item.workspaceType === WorkspaceType.MicrosoftTeams) {
        await UserMicrosoftTeamsService.deleteBy({
          query: {
            projectId: item.projectId,
            userId: item.userId,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async getUserAuth(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        userId: data.userId,
        projectId: data.projectId,
        workspaceType: data.workspaceType,
      },
      select: {
        authToken: true,
        workspaceUserId: true,
        miscData: true,
        workspaceType: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async doesExist(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
  }): Promise<boolean> {
    return (
      (
        await this.countBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
            workspaceType: data.workspaceType,
          },
          skip: 0,
          limit: 1,
          props: {
            isRoot: true,
          },
        })
      ).toNumber() > 0
    );
  }

  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    userId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceUserId: string;
    miscData: WorkspaceUserMiscData;
  }): Promise<void> {
    if (data.workspaceType === WorkspaceType.Discord) {
      throw new BadDataException(
        "Use the verified Discord binding flow to link Discord accounts.",
      );
    }
    let userAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        workspaceType: data.workspaceType,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!userAuth) {
      userAuth = new Model();

      userAuth.projectId = data.projectId;
      userAuth.userId = data.userId;
      userAuth.authToken = data.authToken;
      userAuth.workspaceType = data.workspaceType;
      userAuth.workspaceUserId = data.workspaceUserId;
      userAuth.miscData = data.miscData;

      await this.create({
        data: userAuth,
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: userAuth.id!,
        data: {
          authToken: data.authToken,
          workspaceUserId: data.workspaceUserId,
          miscData: data.miscData,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }
}
export default new Service();
