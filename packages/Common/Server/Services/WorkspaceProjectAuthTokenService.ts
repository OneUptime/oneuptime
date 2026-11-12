import ObjectID from "../../Types/ObjectID";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../Types/Workspace/WorkspaceType";
import DatabaseService from "./DatabaseService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnFind } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import ProjectService from "./ProjectService";
import { SAMPLE_PROJECT_REFUSALS } from "../../Types/SampleProject/SampleProject";
import Model, {
  LegacyServerOnlyMiscDataKeys,
  MattermostConnectionTeam,
  MattermostMiscData,
  MiscData,
  SlackChannelCache,
  SlackMiscData,
  SlackOrganizationWorkspace,
  WorkspaceMiscData,
} from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import MattermostConnection, {
  MattermostConnectionData,
} from "../Utils/Workspace/Mattermost/MattermostConnection";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A sample project (issue #6808) is never connected to Slack, Microsoft
   * Teams or Mattermost: a connection posts as the project's bot - a
   * welcome, every rule's message, every direct message - and nothing ever
   * leaves a sample. Refused here, where every connection is first saved
   * (refreshAuthToken creates through this), with what to do instead.
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (projectId && (await ProjectService.isSampleProject(projectId))) {
      throw new BadDataException(SAMPLE_PROJECT_REFUSALS.workspace);
    }

    return { createBy, carryForward: null };
  }

  /*
   * Disconnecting a WORKSPACE disconnects every user link inside it.
   *
   * The dashboard's "Uninstall OneUptime from Slack / Microsoft Teams" button
   * deletes this row through the generic CRUD path, and nothing else about
   * the workspace survives that in a usable state: the user auth tokens were
   * minted against this workspace's OAuth app, and the UserSlack /
   * UserMicrosoftTeams / UserMattermost notification methods are pointers at those links that
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
    // The tokens the delete removes, and the delete held to them.
    const itemsToDelete: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        workspaceType: true,
      },
    );

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

    const storedMiscData: SlackMiscData =
      (projectAuth.miscData as SlackMiscData | undefined) ||
      ({} as SlackMiscData);

    /*
     * A Slack Enterprise organization's channels are stored with their
     * workspace (teamId); the editor saves names and ids only. A channel
     * kept keeps its workspace: a channel id is one channel, in one
     * workspace. Without it, the channel would be taken for a channel of
     * any of the organization's workspaces (Slack.getWorkspaceChannelByName).
     */
    const workspaceOfChannel: Map<string, string> = new Map();

    for (const entry of Object.values(storedMiscData.channelCache || {})) {
      if (
        entry &&
        typeof entry.id === "string" &&
        typeof entry.teamId === "string" &&
        entry.teamId
      ) {
        workspaceOfChannel.set(entry.id, entry.teamId);
      }
    }

    const channelCache: SlackChannelCache = {};

    for (const [name, entry] of Object.entries(data.channelCache)) {
      const teamId: string | undefined =
        entry.teamId || workspaceOfChannel.get(entry.id);

      channelCache[name] = teamId ? { ...entry, teamId: teamId } : entry;
    }

    const miscData: SlackMiscData = {
      ...storedMiscData,
      channelCache: channelCache,
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
   * A Slack connection to a whole Enterprise organization: the workspaces
   * Slack listed OneUptime as added to, when, those it no longer lists, and
   * the default workspace (SlackOrganization) - written into the project's
   * connection and nothing else, while it is still that organization's
   * (`workspaceProjectId`). A connection removed or replaced meanwhile is
   * left alone. Every other miscData field is carried over from the stored
   * row.
   */
  @CaptureSpan()
  public async updateSlackOrganization(data: {
    projectId: ObjectID;
    workspaceProjectId: string;
    workspaces?: Array<SlackOrganizationWorkspace> | undefined;
    workspacesReadAt?: Date | undefined;
    /*
     * The workspaces Slack no longer lists, by the names they had
     * (SlackOrganization.getRemovedWorkspaces).
     */
    removedWorkspaces?: Array<SlackOrganizationWorkspace> | undefined;
    defaultWorkspaceId?: string | undefined;
    /*
     * A connection to one workspace: the Enterprise organization it is part
     * of - empty for none - as Slack said it, for a connection made before
     * installs recorded it.
     */
    enterpriseId?: string | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceProjectId) {
      throw new BadDataException("workspaceProjectId is required");
    }

    const projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
        workspaceProjectId: data.workspaceProjectId,
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
      return;
    }

    const miscData: SlackMiscData = {
      ...((projectAuth.miscData as SlackMiscData | undefined) ||
        ({} as SlackMiscData)),
    };

    if (data.workspaces) {
      miscData.workspaces = data.workspaces.map(
        (workspace: SlackOrganizationWorkspace): SlackOrganizationWorkspace => {
          return { id: workspace.id, name: workspace.name };
        },
      );
      miscData.workspacesReadAt = OneUptimeDate.toString(
        data.workspacesReadAt || OneUptimeDate.getCurrentDate(),
      );
    }

    if (data.removedWorkspaces) {
      miscData.removedWorkspaces = data.removedWorkspaces.map(
        (workspace: SlackOrganizationWorkspace): SlackOrganizationWorkspace => {
          return { id: workspace.id, name: workspace.name };
        },
      );
    }

    if (data.defaultWorkspaceId !== undefined) {
      /*
       * A channel of one name in several workspaces is cached once, as the
       * default workspace's (Slack.updateChannelsInCache), and a rule that
       * names no workspace takes the cached one. With another default, the
       * channels cached as other workspaces' are looked up again, the new
       * default's first - or such a rule kept posting to the old default's.
       * A channel cached with no workspace, as typed into the channel list
       * by hand, stays.
       */
      if (
        data.defaultWorkspaceId !== miscData.defaultWorkspaceId &&
        miscData.channelCache
      ) {
        const channelCache: SlackChannelCache = {};

        for (const [name, entry] of Object.entries(miscData.channelCache)) {
          if (!entry?.teamId || entry.teamId === data.defaultWorkspaceId) {
            channelCache[name] = entry;
          }
        }

        miscData.channelCache = channelCache;
      }

      miscData.defaultWorkspaceId = data.defaultWorkspaceId;
    }

    if (data.enterpriseId !== undefined) {
      miscData.enterpriseId = data.enterpriseId;
    }

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
   * A Mattermost connection's teams: those the server listed its bot in,
   * when, those it no longer lists, and the default team (MattermostTeams) -
   * written into the project's connection and nothing else, while it is
   * still the one stored under `workspaceProjectId`. A connection removed or
   * replaced meanwhile is left alone. Every other field is carried over
   * from the stored row.
   *
   * Another default team is written into the server-only authToken too:
   * every call that names no team is made in the team it holds
   * (MattermostConnection). The connection stays stored under the team it
   * was made for.
   */
  @CaptureSpan()
  public async updateMattermostTeams(data: {
    projectId: ObjectID;
    workspaceProjectId: string;
    teams?: Array<MattermostConnectionTeam> | undefined;
    teamsReadAt?: Date | undefined;
    /*
     * The teams the server no longer lists the bot in, by the names they
     * had (MattermostTeams.getRemovedTeams).
     */
    removedTeams?: Array<MattermostConnectionTeam> | undefined;
    defaultTeam?: MattermostConnectionTeam | undefined;
  }): Promise<void> {
    if (!data.projectId) {
      throw new BadDataException("projectId is required");
    }

    if (!data.workspaceProjectId) {
      throw new BadDataException("workspaceProjectId is required");
    }

    if (
      data.defaultTeam &&
      !MattermostConnection.isMattermostId(data.defaultTeam.id)
    ) {
      throw new BadDataException("The Mattermost team id is not valid.");
    }

    const projectAuth: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        workspaceType: WorkspaceType.Mattermost,
        workspaceProjectId: data.workspaceProjectId,
      },
      select: {
        _id: true,
        miscData: true,
        authToken: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!projectAuth || !projectAuth.id) {
      return;
    }

    const miscData: MattermostMiscData = {
      ...((projectAuth.miscData as MattermostMiscData | undefined) ||
        ({} as MattermostMiscData)),
    };

    const update: { miscData: MattermostMiscData; authToken?: string } = {
      miscData: miscData,
    };

    if (data.teams) {
      miscData.teams = data.teams.map(
        (team: MattermostConnectionTeam): MattermostConnectionTeam => {
          return {
            id: team.id,
            name: team.name,
            displayName: team.displayName || team.name,
          };
        },
      );
      miscData.teamsReadAt = OneUptimeDate.toString(
        data.teamsReadAt || OneUptimeDate.getCurrentDate(),
      );

      /*
       * The default team as the server names it now: a team renamed in
       * Mattermost has its channels at its new address.
       */
      const listedDefault: MattermostConnectionTeam | undefined =
        miscData.teams.find((team: MattermostConnectionTeam): boolean => {
          return team.id === miscData.teamId;
        });

      if (listedDefault && listedDefault.name) {
        miscData.teamName = listedDefault.name;
        miscData.teamDisplayName =
          listedDefault.displayName || listedDefault.name;
      }
    }

    if (data.removedTeams) {
      miscData.removedTeams = data.removedTeams.map(
        (team: MattermostConnectionTeam): MattermostConnectionTeam => {
          return {
            id: team.id,
            name: team.name,
            displayName: team.displayName || team.name,
          };
        },
      );
    }

    if (data.defaultTeam) {
      const connection: MattermostConnectionData =
        MattermostConnection.fromAuthToken(projectAuth.authToken || "");

      update.authToken = MattermostConnection.toAuthToken({
        ...connection,
        teamId: data.defaultTeam.id,
      });

      miscData.teamId = data.defaultTeam.id;
      miscData.teamName = data.defaultTeam.name;
      miscData.teamDisplayName =
        data.defaultTeam.displayName || data.defaultTeam.name;
    }

    await this.updateOneById({
      id: projectAuth.id,
      data: update,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * `authTokenExpiresAt` is the expiry of THIS `authToken`. Leaving it out
   * clears the stored one, so a new token never inherits an old token's
   * expiry.
   *
   * `replacesWorkspaceProjectId`: the workspace the project is connected to
   * now, which this connection may replace - a Slack workspace moving to its
   * Enterprise organization's installation, or back (SlackOrganization).
   * Any other workspace is refused, as below.
   */
  @CaptureSpan()
  public async refreshAuthToken(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    authToken: string;
    authTokenExpiresAt?: Date | undefined;
    workspaceProjectId: string;
    miscData: WorkspaceMiscData;
    replacesWorkspaceProjectId?: string | undefined;
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
      projectAuth.workspaceProjectId !== data.workspaceProjectId &&
      projectAuth.workspaceProjectId !== data.replacesWorkspaceProjectId
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
