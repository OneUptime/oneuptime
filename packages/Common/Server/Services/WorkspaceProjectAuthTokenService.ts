import ObjectID from "../../Types/ObjectID";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import Model, {
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

  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    workspaceProjectId: string;
    miscData: WorkspaceMiscData;
  }): Promise<void> {
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
          workspaceProjectId: data.workspaceProjectId,
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
