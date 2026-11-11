import WorkspaceProjectAuthToken, {
  MattermostConnectionTeam,
  MattermostMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MattermostUtil, { MattermostTeam } from "./Mattermost";
import MattermostConnection, {
  MattermostConnectionData,
} from "./MattermostConnection";

/*
 * ONE PROJECT, EVERY TEAM ITS MATTERMOST BOT IS IN.
 *
 * A Mattermost server holds teams, and a bot account can be a member of
 * several. A project is connected to its server through one of them - the
 * team chosen when it was connected - and works in every team its bot is a
 * member of: a notification rule names the team its channels are in, or
 * leaves it to the default team, and the buttons on OneUptime's messages,
 * and the forms they open, are answered in any of them.
 *
 * The connection keeps (MattermostMiscData):
 *
 * - the default team: teamId, teamName and teamDisplayName, and the teamId
 *   of the server-only authToken, which every call that names no team is
 *   made in (MattermostConnection). The team the project was connected to,
 *   until a member makes another one the default;
 * - the teams the bot is a member of, as the server listed them
 *   (GET /api/v4/users/me/teams), read again when they are needed and older
 *   than TEAMS_FRESH_FOR_SECONDS: a Mattermost admin adds the bot to a team
 *   in Mattermost, which tells OneUptime nothing.
 *
 * The connection stays stored under the team the project was connected to
 * (workspaceProjectId), whichever team is the default: a member's sign-in
 * link was sent for it, and a channel OneUptime created before teams were
 * told apart names no team - it is in that team.
 *
 * Nothing here gives the Dashboard what it could not read already: the
 * teams are names and ids, in miscData beside the default team's.
 */

// A project's Mattermost connection, as the teams it works in.
export interface MattermostTeamsOfConnection {
  // Where a rule that names no team posts, and creates its channels.
  defaultTeam: MattermostConnectionTeam;
  /*
   * The teams the bot is a member of: the default first, then by name. The
   * default is listed even when the server no longer listed it
   * (isBotInDefaultTeam), so a project always has one.
   */
  teams: Array<MattermostConnectionTeam>;
  /*
   * Whether the server, when it last listed the teams, listed the default
   * among them. True for a connection whose teams were never listed.
   */
  isBotInDefaultTeam: boolean;
  // The team the project was connected to: what its connection is stored under.
  connectedTeamId: string;
  // When the server last listed the teams; undefined for never.
  teamsReadAt: Date | undefined;
}

export default class MattermostTeams {
  /*
   * How long the teams a server listed are used before they are asked for
   * again, when they are needed.
   */
  public static readonly TEAMS_FRESH_FOR_SECONDS: number = 10 * 60;

  /*
   * What a project's connection says of the teams it works in, as stored -
   * nothing is asked of the server. Null for no connection, or one that
   * names no team. A connection that keeps no names (miscData) still works
   * in the team it was stored under.
   */
  public static readConnection(
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined,
  ): MattermostTeamsOfConnection | null {
    const miscData: MattermostMiscData | undefined = projectAuth?.miscData as
      | MattermostMiscData
      | undefined;

    const connectedTeamId: string = MattermostTeams.idOf(
      projectAuth?.workspaceProjectId,
    );

    const defaultTeamId: string =
      MattermostTeams.idOf(miscData?.teamId) || connectedTeamId;

    if (!defaultTeamId) {
      return null;
    }

    const listed: Array<MattermostConnectionTeam> | null = Array.isArray(
      miscData?.teams,
    )
      ? MattermostTeams.readTeams(miscData?.teams)
      : null;

    // The default as the server listed it last - renamed since, maybe - else as kept.
    const defaultTeam: MattermostConnectionTeam = listed?.find(
      (team: MattermostConnectionTeam): boolean => {
        return team.id === defaultTeamId;
      },
    ) || {
      id: defaultTeamId,
      name: MattermostTeams.textOf(miscData?.teamName),
      displayName:
        MattermostTeams.textOf(miscData?.teamDisplayName) ||
        MattermostTeams.textOf(miscData?.teamName),
    };

    const readAt: Date | undefined = miscData?.teamsReadAt
      ? OneUptimeDate.fromString(miscData.teamsReadAt)
      : undefined;

    return {
      defaultTeam: defaultTeam,
      teams: MattermostTeams.orderTeams({
        teams: [
          defaultTeam,
          ...(listed || []).filter(
            (team: MattermostConnectionTeam): boolean => {
              return team.id !== defaultTeamId;
            },
          ),
        ],
        defaultTeamId: defaultTeamId,
      }),
      isBotInDefaultTeam:
        listed === null ||
        listed.some((team: MattermostConnectionTeam): boolean => {
          return team.id === defaultTeamId;
        }),
      connectedTeamId: connectedTeamId || defaultTeamId,
      teamsReadAt: readAt && !isNaN(readAt.getTime()) ? readAt : undefined,
    };
  }

  /*
   * The teams a project's Mattermost connection works in, with those the
   * server lists now when those read last are older than
   * TEAMS_FRESH_FOR_SECONDS - or always, with `refresh` - kept for the next
   * time. Null for a project not connected to Mattermost. Never throws:
   * when the server does not answer, the teams are those it listed last.
   */
  @CaptureSpan()
  public static async getOfProject(data: {
    projectId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<MattermostTeamsOfConnection | null> {
    let projectAuth: WorkspaceProjectAuthToken | null = null;

    try {
      projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Mattermost,
      });
    } catch (err) {
      logger.debug("Could not read a project's Mattermost connection.");
      logger.debug(err);
      return null;
    }

    return await MattermostTeams.getOfConnection({
      projectId: data.projectId,
      projectAuth: projectAuth,
      refresh: data.refresh,
    });
  }

  // getOfProject, for a connection read already. Never throws.
  @CaptureSpan()
  public static async getOfConnection(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken | null | undefined;
    refresh?: boolean | undefined;
  }): Promise<MattermostTeamsOfConnection | null> {
    const connection: MattermostTeamsOfConnection | null =
      MattermostTeams.readConnection(data.projectAuth);

    if (!connection || !data.projectAuth?.authToken) {
      return connection;
    }

    if (!data.refresh && MattermostTeams.isFresh(connection)) {
      return connection;
    }

    try {
      return (
        (await MattermostTeams.listNow({
          projectId: data.projectId,
          projectAuth: data.projectAuth,
        })) || connection
      );
    } catch (err) {
      logger.debug(
        "The Mattermost server did not list its bot's teams; using those it listed last.",
        { projectId: data.projectId.toString() },
      );
      logger.debug(err);
      return connection;
    }
  }

  /*
   * The teams the server lists the bot in now, kept for the next time: what
   * a member's Refresh asks for. Throws what the server answered, or why it
   * could not be reached - a member who asked is told.
   */
  @CaptureSpan()
  public static async listNow(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken;
  }): Promise<MattermostTeamsOfConnection | null> {
    if (
      !MattermostTeams.readConnection(data.projectAuth) ||
      !data.projectAuth.authToken
    ) {
      return null;
    }

    const server: MattermostConnectionData = MattermostConnection.fromAuthToken(
      data.projectAuth.authToken,
    );

    const teams: Array<MattermostConnectionTeam> = (
      await MattermostUtil.getTeamsOfBot({
        serverUrl: server.serverUrl,
        accessToken: server.accessToken,
      })
    ).map((team: MattermostTeam): MattermostConnectionTeam => {
      return MattermostTeams.toConnectionTeam(team);
    });

    const readAt: Date = OneUptimeDate.getCurrentDate();

    try {
      await WorkspaceProjectAuthTokenService.updateMattermostTeams({
        projectId: data.projectId,
        workspaceProjectId: data.projectAuth.workspaceProjectId || "",
        teams: teams,
        teamsReadAt: readAt,
      });
    } catch (err) {
      logger.debug("Could not keep the teams of a Mattermost connection.", {
        projectId: data.projectId.toString(),
      });
      logger.debug(err);
    }

    return MattermostTeams.readConnection({
      workspaceProjectId: data.projectAuth.workspaceProjectId || "",
      miscData: {
        ...((data.projectAuth.miscData || {}) as MattermostMiscData),
        teams: teams,
        teamsReadAt: OneUptimeDate.toString(readAt),
      },
    });
  }

  /*
   * Whether a team is one the connection works in: the default, the team
   * the project was connected to, or one the server listed the bot in. Read
   * as stored: nothing is asked of the server.
   */
  public static isTeamOfConnection(data: {
    connection: MattermostTeamsOfConnection | null | undefined;
    teamId: unknown;
  }): boolean {
    const teamId: string = MattermostTeams.idOf(data.teamId);

    if (!data.connection || !teamId) {
      return false;
    }

    return (
      teamId === data.connection.defaultTeam.id ||
      teamId === data.connection.connectedTeamId ||
      data.connection.teams.some((team: MattermostConnectionTeam): boolean => {
        return team.id === teamId;
      })
    );
  }

  /*
   * The team a rule's channels are in, to tell two channels of one name
   * apart (WorkspaceNotificationRuleService): the one the rule names, else
   * the default team - where a channel named without a team is created, and
   * looked for first. Undefined for a project with no Mattermost connection.
   * What is not a Mattermost id names no team: a value written through the
   * API before rules could name a team, when it was not read.
   */
  public static getTeamIdOfRuleChannel(data: {
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined;
    teamId: string | undefined;
  }): string | undefined {
    const connection: MattermostTeamsOfConnection | null =
      MattermostTeams.readConnection(data.projectAuth);

    return (
      MattermostTeams.idOf(data.teamId) ||
      connection?.defaultTeam.id ||
      undefined
    );
  }

  /*
   * The team a channel a record holds is in: as it was stored, or - for a
   * channel OneUptime created before teams were told apart, which names
   * none - the team the project was connected to, where it was created.
   * OneUptime stores only a Mattermost id (Mattermost.readChannel): what
   * is not one names no team.
   */
  public static getTeamIdOfStoredChannel(data: {
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined;
    teamId: string | undefined;
  }): string | undefined {
    const connection: MattermostTeamsOfConnection | null =
      MattermostTeams.readConnection(data.projectAuth);

    return (
      MattermostTeams.idOf(data.teamId) ||
      connection?.connectedTeamId ||
      undefined
    );
  }

  /*
   * The name in URLs of the team a channel a record holds is in
   * (getTeamIdOfStoredChannel): chat.example.com/<name>/channels/<channel>.
   * Empty when the connection does not list that team.
   */
  public static getTeamNameOfChannel(data: {
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined;
    teamId: string | undefined;
  }): string {
    const connection: MattermostTeamsOfConnection | null =
      MattermostTeams.readConnection(data.projectAuth);

    if (!connection) {
      return "";
    }

    return (
      MattermostTeams.getTeam({
        connection: connection,
        teamId: MattermostTeams.getTeamIdOfStoredChannel({
          projectAuth: data.projectAuth,
          teamId: data.teamId,
        }),
      })?.name || ""
    );
  }

  /*
   * A team of the connection by its id - the default for none - or
   * undefined when the connection does not list it.
   */
  public static getTeam(data: {
    connection: MattermostTeamsOfConnection;
    teamId?: string | undefined;
  }): MattermostConnectionTeam | undefined {
    const teamId: string =
      MattermostTeams.textOf(data.teamId) || data.connection.defaultTeam.id;

    return data.connection.teams.find(
      (team: MattermostConnectionTeam): boolean => {
        return team.id === teamId;
      },
    );
  }

  // A team as a connection keeps it: a display name, or its name for none.
  public static toConnectionTeam(
    team: MattermostTeam | MattermostConnectionTeam,
  ): MattermostConnectionTeam {
    return {
      id: team.id,
      name: MattermostTeams.textOf(team.name),
      displayName:
        MattermostTeams.textOf(team.displayName) ||
        MattermostTeams.textOf(team.name),
    };
  }

  // The default first, then the others by display name.
  public static orderTeams(data: {
    teams: Array<MattermostConnectionTeam>;
    defaultTeamId: string | undefined;
  }): Array<MattermostConnectionTeam> {
    return [...data.teams].sort(
      (a: MattermostConnectionTeam, b: MattermostConnectionTeam): number => {
        if (a.id === data.defaultTeamId) {
          return -1;
        }

        if (b.id === data.defaultTeamId) {
          return 1;
        }

        return (
          (a.displayName || a.name).localeCompare(b.displayName || b.name) ||
          a.id.localeCompare(b.id)
        );
      },
    );
  }

  // Whether the teams were listed less than TEAMS_FRESH_FOR_SECONDS ago.
  public static isFresh(connection: MattermostTeamsOfConnection): boolean {
    if (!connection.teamsReadAt) {
      return false;
    }

    const ageInSeconds: number =
      (OneUptimeDate.getCurrentDate().getTime() -
        connection.teamsReadAt.getTime()) /
      1000;

    return (
      ageInSeconds >= 0 &&
      ageInSeconds < MattermostTeams.TEAMS_FRESH_FOR_SECONDS
    );
  }

  // The teams as stored, each a Mattermost id, each once.
  private static readTeams(value: unknown): Array<MattermostConnectionTeam> {
    if (!Array.isArray(value)) {
      return [];
    }

    const teams: Array<MattermostConnectionTeam> = [];

    for (const item of value as Array<unknown>) {
      const fields: JSONObject | undefined =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as JSONObject)
          : undefined;

      const id: string = MattermostTeams.idOf(fields?.["id"]);

      if (
        !id ||
        teams.some((team: MattermostConnectionTeam): boolean => {
          return team.id === id;
        })
      ) {
        continue;
      }

      const name: string = MattermostTeams.textOf(fields?.["name"]);

      teams.push({
        id: id,
        name: name,
        displayName: MattermostTeams.textOf(fields?.["displayName"]) || name,
      });
    }

    return teams;
  }

  // A Mattermost id, or empty: only an id is ever placed in a call's path.
  private static idOf(value: unknown): string {
    return MattermostConnection.isMattermostId(value) ? value : "";
  }

  private static textOf(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
