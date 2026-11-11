import WorkspaceProjectAuthToken, {
  SlackMiscData,
  SlackOrganizationWorkspace,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { SLACK_WORKSPACE_NOT_ADDED_ERROR } from "./SlackChannelMembers";

/*
 * ONEUPTIME INSTALLED FOR A WHOLE SLACK ENTERPRISE ORGANIZATION.
 *
 * A Slack Enterprise organization (Enterprise Grid) holds several workspaces.
 * OneUptime can be installed into one of them, as into any workspace - or an
 * org admin can install it once for the whole organization and add it to
 * some or all of its workspaces from Slack's admin pages. The app's manifest
 * allows that (org_deploy_enabled). One OneUptime project then works in
 * every workspace it was added to: its notifications post to channels of
 * any of them, and its commands, buttons, Home tab and OneUptime AI answer
 * there (SlackRequestWorkspace finds the project from any of them).
 *
 * Such a connection is stored under the organization's id (E...), with
 * isEnterpriseInstall set (SlackMiscData). Its bot token is the
 * organization's, and Slack wants to be told the workspace for what is per
 * workspace - listing or creating channels, listing people, user groups -
 * with team_id. So the connection keeps:
 *
 * - the workspaces OneUptime has been added to, as Slack lists them
 *   (auth.teams.list), read again when they are needed and older than
 *   WORKSPACES_FRESH_FOR_SECONDS - an admin adds it to workspaces in Slack,
 *   which tells OneUptime nothing;
 * - a default workspace: where a rule that names none creates its channel,
 *   and looked in first for a channel named without a workspace. A project
 *   that moved from one workspace to the organization keeps that workspace
 *   as its default.
 *
 * A project connected to one workspace of an organization moves to the
 * organization's installation when the organization's is installed for it
 * (isSameOrganization): its notification rules, linked accounts and
 * channels stay - the organization's channel and user ids are the
 * workspace's. Any other change of workspace is refused, as before.
 */

// What a finished install says it was for (readInstallation).
export interface SlackInstallation {
  // What the connection is stored under: the workspace's T..., or the organization's E....
  workspaceProjectId: string;
  isEnterpriseInstall: boolean;
  // The workspace's id and name, or the organization's for its installation.
  teamId: string;
  teamName: string;
  // The Enterprise organization it is for, or the workspace is part of.
  enterpriseId?: string | undefined;
  enterpriseName?: string | undefined;
}

// A project's connection to a whole organization, as it is used.
export interface SlackOrganizationConnection {
  enterpriseId: string;
  enterpriseName: string;
  // The workspaces OneUptime is added to: the default first, then by name.
  workspaces: Array<SlackOrganizationWorkspace>;
  // Undefined while OneUptime is added to no workspace.
  defaultWorkspaceId: string | undefined;
  // When Slack last listed the workspaces; undefined for never.
  workspacesReadAt: Date | undefined;
  /*
   * The workspaces Slack listed once and lists no more - OneUptime was
   * removed from them - by the names they had: what a rule that still
   * picks one is told by (getNotAddedMessage). The latest removed first.
   */
  removedWorkspaces: Array<SlackOrganizationWorkspace>;
}

/*
 * A workspace a rule picks - or a call is made in - that OneUptime's
 * installation for the organization is no longer added to. Its message says
 * so in plain words (SlackOrganization.getNotAddedMessage), for Notification
 * Logs, a rule's test, and whoever reads the error.
 */
export class SlackWorkspaceNotAddedException extends BadRequestException {
  // The workspace (T...).
  public readonly teamId: string;

  public constructor(data: { message: string; teamId: string }) {
    super(data.message);
    this.teamId = data.teamId;
  }
}

export default class SlackOrganization {
  /*
   * How long the workspaces Slack listed are used before they are asked for
   * again, when they are needed. auth.teams.list is a Tier 2 method.
   */
  public static readonly WORKSPACES_FRESH_FOR_SECONDS: number = 10 * 60;

  // auth.teams.list pages read at most: 200 workspaces a page.
  private static readonly MAX_WORKSPACE_PAGES: number = 50;
  private static readonly WORKSPACES_PAGE_SIZE: number = 200;

  // The workspaces OneUptime was removed from that are kept, the latest first.
  public static readonly MAX_REMOVED_WORKSPACES: number = 50;

  // What Slack answers a call made in a workspace OneUptime is not added to.
  public static readonly NOT_ADDED_ERROR: string =
    SLACK_WORKSPACE_NOT_ADDED_ERROR;

  // Whether a connection's miscData is a whole organization's installation.
  public static isOrganization(miscData: unknown): boolean {
    return (
      Boolean(miscData) &&
      typeof miscData === "object" &&
      (miscData as SlackMiscData).isEnterpriseInstall === true
    );
  }

  /*
   * What an install's token response (oauth.v2.access) says it was for: a
   * workspace's installation names its team, and its organization when it
   * is part of one; a whole organization's names the organization, with no
   * team. Null when it names neither.
   */
  public static readInstallation(
    responseBody: JSONObject,
  ): SlackInstallation | null {
    const team: JSONObject | undefined = SlackOrganization.objectOf(
      responseBody["team"],
    );
    const enterprise: JSONObject | undefined = SlackOrganization.objectOf(
      responseBody["enterprise"],
    );

    const teamId: string = SlackOrganization.textOf(team?.["id"]);
    const teamName: string = SlackOrganization.textOf(team?.["name"]);
    const enterpriseId: string = SlackOrganization.textOf(enterprise?.["id"]);
    const enterpriseName: string = SlackOrganization.textOf(
      enterprise?.["name"],
    );

    const isEnterpriseInstall: boolean =
      (responseBody["is_enterprise_install"] === true ||
        responseBody["is_enterprise_install"] === "true") &&
      Boolean(enterpriseId);

    if (isEnterpriseInstall) {
      return {
        workspaceProjectId: enterpriseId,
        isEnterpriseInstall: true,
        teamId: enterpriseId,
        teamName: enterpriseName,
        enterpriseId: enterpriseId,
        enterpriseName: enterpriseName,
      };
    }

    if (!teamId) {
      return null;
    }

    return {
      workspaceProjectId: teamId,
      isEnterpriseInstall: false,
      teamId: teamId,
      teamName: teamName,
      ...(enterpriseId
        ? { enterpriseId: enterpriseId, enterpriseName: enterpriseName }
        : {}),
    };
  }

  /*
   * What a project's connection says of the organization it is installed
   * for, as stored - nothing is asked of Slack. Null for a connection to one
   * workspace, or none.
   */
  public static readConnection(
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined,
  ): SlackOrganizationConnection | null {
    const miscData: SlackMiscData | undefined = projectAuth?.miscData as
      | SlackMiscData
      | undefined;

    if (!miscData || !SlackOrganization.isOrganization(miscData)) {
      return null;
    }

    const workspaces: Array<SlackOrganizationWorkspace> =
      SlackOrganization.readWorkspaces(miscData.workspaces);

    const defaultWorkspaceId: string | undefined =
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: workspaces,
        defaultWorkspaceId: miscData.defaultWorkspaceId,
      });

    const readAt: Date | undefined = miscData.workspacesReadAt
      ? OneUptimeDate.fromString(miscData.workspacesReadAt)
      : undefined;

    // One OneUptime was added to again is listed, not removed.
    const removedWorkspaces: Array<SlackOrganizationWorkspace> =
      SlackOrganization.readWorkspaces(miscData.removedWorkspaces).filter(
        (removed: SlackOrganizationWorkspace): boolean => {
          return !workspaces.some(
            (workspace: SlackOrganizationWorkspace): boolean => {
              return workspace.id === removed.id;
            },
          );
        },
      );

    return {
      enterpriseId:
        SlackOrganization.textOf(miscData.enterpriseId) ||
        SlackOrganization.textOf(projectAuth?.workspaceProjectId) ||
        SlackOrganization.textOf(miscData.teamId),
      enterpriseName:
        SlackOrganization.textOf(miscData.enterpriseName) ||
        SlackOrganization.textOf(miscData.teamName),
      workspaces: SlackOrganization.orderWorkspaces({
        workspaces: workspaces,
        defaultWorkspaceId: defaultWorkspaceId,
      }),
      defaultWorkspaceId: defaultWorkspaceId,
      workspacesReadAt: readAt && !isNaN(readAt.getTime()) ? readAt : undefined,
      removedWorkspaces: removedWorkspaces,
    };
  }

  /*
   * The organization a project's Slack connection is installed for, with
   * the workspaces Slack lists now when those read last are older than
   * WORKSPACES_FRESH_FOR_SECONDS - or always, with `refresh` - and stored
   * for the next time. Null for a project connected to one workspace, or to
   * none. Never throws: workspaces Slack does not list now are the ones it
   * listed last.
   */
  @CaptureSpan()
  public static async getOfProject(data: {
    projectId: ObjectID;
    refresh?: boolean | undefined;
  }): Promise<SlackOrganizationConnection | null> {
    let projectAuth: WorkspaceProjectAuthToken | null = null;

    try {
      projectAuth = await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: data.projectId,
        workspaceType: WorkspaceType.Slack,
      });
    } catch (err) {
      logger.debug("Could not read a project's Slack connection.");
      logger.debug(err);
      return null;
    }

    return await SlackOrganization.getOfConnection({
      projectId: data.projectId,
      projectAuth: projectAuth,
      refresh: data.refresh,
    });
  }

  /*
   * getOfProject, for a connection already read. Never throws.
   */
  @CaptureSpan()
  public static async getOfConnection(data: {
    projectId: ObjectID;
    projectAuth: WorkspaceProjectAuthToken | null | undefined;
    refresh?: boolean | undefined;
  }): Promise<SlackOrganizationConnection | null> {
    const organization: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(data.projectAuth);

    if (!organization || !data.projectAuth?.authToken) {
      return organization;
    }

    if (!data.refresh && SlackOrganization.isFresh(organization)) {
      return organization;
    }

    let workspaces: Array<SlackOrganizationWorkspace>;

    try {
      workspaces = await SlackOrganization.listWorkspaces(
        data.projectAuth.authToken,
      );
    } catch (err) {
      logger.debug(
        "Slack did not list the workspaces of an organization's installation; using those listed last.",
        { projectId: data.projectId.toString() },
      );
      logger.debug(err);
      return organization;
    }

    const readAt: Date = OneUptimeDate.getCurrentDate();

    // Those listed before and not now keep their names, for rules that pick them.
    const removedWorkspaces: Array<SlackOrganizationWorkspace> =
      SlackOrganization.getRemovedWorkspaces({
        listedBefore: organization.workspaces,
        removedBefore: organization.removedWorkspaces,
        listedNow: workspaces,
      });

    try {
      await WorkspaceProjectAuthTokenService.updateSlackOrganization({
        projectId: data.projectId,
        workspaceProjectId: data.projectAuth.workspaceProjectId || "",
        workspaces: workspaces,
        workspacesReadAt: readAt,
        removedWorkspaces: removedWorkspaces,
      });
    } catch (err) {
      logger.debug(
        "Could not keep the workspaces of an organization's Slack installation.",
        { projectId: data.projectId.toString() },
      );
      logger.debug(err);
    }

    const miscData: SlackMiscData = data.projectAuth.miscData as SlackMiscData;

    const defaultWorkspaceId: string | undefined =
      SlackOrganization.pickDefaultWorkspaceId({
        workspaces: workspaces,
        defaultWorkspaceId: miscData.defaultWorkspaceId,
      });

    return {
      ...organization,
      workspaces: SlackOrganization.orderWorkspaces({
        workspaces: workspaces,
        defaultWorkspaceId: defaultWorkspaceId,
      }),
      defaultWorkspaceId: defaultWorkspaceId,
      workspacesReadAt: readAt,
      removedWorkspaces: removedWorkspaces,
    };
  }

  /*
   * The workspaces OneUptime is no longer added to, once Slack lists
   * `listedNow`: those it listed before and not now, the latest first, then
   * those removed before - each once, by the name it had, none listed now,
   * at most MAX_REMOVED_WORKSPACES of them.
   */
  public static getRemovedWorkspaces(data: {
    listedBefore: Array<SlackOrganizationWorkspace>;
    removedBefore: Array<SlackOrganizationWorkspace>;
    listedNow: Array<SlackOrganizationWorkspace>;
  }): Array<SlackOrganizationWorkspace> {
    const removed: Array<SlackOrganizationWorkspace> = [];

    for (const workspace of [...data.listedBefore, ...data.removedBefore]) {
      const isListedNow: boolean = data.listedNow.some(
        (listed: SlackOrganizationWorkspace): boolean => {
          return listed.id === workspace.id;
        },
      );

      const isKept: boolean = removed.some(
        (kept: SlackOrganizationWorkspace): boolean => {
          return kept.id === workspace.id;
        },
      );

      if (!workspace.id || isListedNow || isKept) {
        continue;
      }

      removed.push({ id: workspace.id, name: workspace.name || workspace.id });
    }

    return removed.slice(0, SlackOrganization.MAX_REMOVED_WORKSPACES);
  }

  /*
   * Whether OneUptime is added to a workspace of the organization, as Slack
   * listed them last: a workspace it does not list is one OneUptime was
   * removed from, or never added to. Before Slack has listed any, it cannot
   * be told: taken as added, and Slack says otherwise when asked.
   */
  public static isWorkspaceAdded(data: {
    organization: SlackOrganizationConnection;
    teamId: string;
  }): boolean {
    if (!data.organization.workspacesReadAt) {
      return true;
    }

    return data.organization.workspaces.some(
      (workspace: SlackOrganizationWorkspace): boolean => {
        return workspace.id === data.teamId;
      },
    );
  }

  /*
   * What a rule picking a workspace OneUptime is no longer added to is
   * told, in Notification Logs, on its card and when it is tested. It does
   * not fall back to another workspace: the workspace decides who reads
   * the rule's messages.
   */
  public static getNotAddedMessage(data: {
    organization: SlackOrganizationConnection;
    teamId: string;
  }): string {
    const workspaceName: string = SlackOrganization.getWorkspaceName(data);
    const organizationName: string =
      data.organization.enterpriseName || "your Slack Enterprise organization";

    return `OneUptime is no longer added to the ${workspaceName} workspace of ${organizationName}. Add it again in Slack's organization settings, or pick another workspace on the rule.`;
  }

  // getNotAddedMessage, to throw.
  public static getNotAddedException(data: {
    organization: SlackOrganizationConnection;
    teamId: string;
  }): SlackWorkspaceNotAddedException {
    return new SlackWorkspaceNotAddedException({
      message: SlackOrganization.getNotAddedMessage(data),
      teamId: data.teamId,
    });
  }

  /*
   * auth.teams.list: the organization's workspaces OneUptime's installation
   * has been added to, each once, every page of them. Throws when Slack
   * refuses or does not answer.
   */
  @CaptureSpan()
  public static async listWorkspaces(
    authToken: string,
  ): Promise<Array<SlackOrganizationWorkspace>> {
    const workspaces: Array<SlackOrganizationWorkspace> = [];
    let cursor: string = "";
    let pages: number = 0;

    do {
      const body: JSONObject = {
        limit: SlackOrganization.WORKSPACES_PAGE_SIZE,
      };

      if (cursor) {
        body["cursor"] = cursor;
      }

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/auth.teams.list"),
          data: body,
          headers: {
            Authorization: `Bearer ${authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
          options: {
            retries: 3,
            exponentialBackoff: true,
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const json: JSONObject = (response.jsonData || {}) as JSONObject;

      if (json["ok"] !== true) {
        throw new BadRequestException(
          "Error from Slack " + SlackOrganization.textOf(json["error"]),
        );
      }

      const teams: Array<unknown> = Array.isArray(json["teams"])
        ? (json["teams"] as Array<unknown>)
        : [];

      for (const team of teams) {
        const fields: JSONObject | undefined = SlackOrganization.objectOf(team);
        const id: string = SlackOrganization.textOf(fields?.["id"]);

        if (
          !id ||
          workspaces.some((workspace: SlackOrganizationWorkspace): boolean => {
            return workspace.id === id;
          })
        ) {
          continue;
        }

        workspaces.push({
          id: id,
          name: SlackOrganization.textOf(fields?.["name"]) || id,
        });
      }

      cursor = SlackOrganization.textOf(
        SlackOrganization.objectOf(json["response_metadata"])?.["next_cursor"],
      );
      pages++;
    } while (cursor && pages < SlackOrganization.MAX_WORKSPACE_PAGES);

    return workspaces;
  }

  /*
   * The Enterprise organization a project's connection to one workspace is
   * part of, empty for none: as its install recorded it, else as Slack says
   * now (auth.test), kept for the next time. Empty when Slack cannot say.
   * Never throws.
   */
  @CaptureSpan()
  public static async getEnterpriseIdOfWorkspace(data: {
    projectId: ObjectID;
    projectAuth:
      | Pick<
          WorkspaceProjectAuthToken,
          "miscData" | "workspaceProjectId" | "authToken"
        >
      | null
      | undefined;
  }): Promise<string> {
    const miscData: SlackMiscData | undefined = data.projectAuth?.miscData as
      | SlackMiscData
      | undefined;

    if (miscData?.enterpriseId !== undefined) {
      return SlackOrganization.textOf(miscData.enterpriseId);
    }

    if (!data.projectAuth?.authToken || !data.projectAuth.workspaceProjectId) {
      return "";
    }

    let enterpriseId: string;

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/auth.test"),
          data: {},
          headers: {
            Authorization: `Bearer ${data.projectAuth.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        return "";
      }

      const json: JSONObject = (response.jsonData || {}) as JSONObject;

      if (json["ok"] !== true) {
        return "";
      }

      enterpriseId = SlackOrganization.textOf(json["enterprise_id"]);
    } catch (err) {
      logger.debug(
        "Slack did not say whether a workspace is in an organization.",
      );
      logger.debug(err);
      return "";
    }

    try {
      await WorkspaceProjectAuthTokenService.updateSlackOrganization({
        projectId: data.projectId,
        workspaceProjectId: data.projectAuth.workspaceProjectId,
        enterpriseId: enterpriseId,
      });
    } catch (err) {
      logger.debug("Could not keep the organization of a Slack workspace.");
      logger.debug(err);
    }

    return enterpriseId;
  }

  /*
   * Whether a project connected to `existing` - a workspace, or a whole
   * organization - may move to `installation` without being disconnected
   * first: both are the same Slack Enterprise organization, so its rules'
   * channels and its linked accounts are the same. Told by the
   * organization the old connection recorded, by the workspaces the new
   * installation was added to (`workspaces`), or else by asking Slack with
   * the old connection's token (auth.test). Never throws.
   */
  @CaptureSpan()
  public static async isSameOrganization(data: {
    existing: Pick<
      WorkspaceProjectAuthToken,
      "workspaceProjectId" | "miscData" | "authToken"
    >;
    installation: SlackInstallation;
    workspaces?: Array<SlackOrganizationWorkspace> | undefined;
  }): Promise<boolean> {
    const existingId: string = SlackOrganization.textOf(
      data.existing.workspaceProjectId,
    );
    const enterpriseId: string = SlackOrganization.textOf(
      data.installation.enterpriseId,
    );

    if (!existingId || !enterpriseId) {
      return false;
    }

    // The same installation, connected again: nothing moves.
    if (existingId === data.installation.workspaceProjectId) {
      return true;
    }

    const existingMiscData: SlackMiscData | undefined = data.existing
      .miscData as SlackMiscData | undefined;

    // The organization's installation, replaced by one of its workspaces'.
    if (
      SlackOrganization.isOrganization(existingMiscData) ||
      existingId.startsWith("E")
    ) {
      return existingId === enterpriseId;
    }

    if (!data.installation.isEnterpriseInstall) {
      return false;
    }

    // A workspace of the organization, replaced by the organization's installation.
    if (
      SlackOrganization.textOf(existingMiscData?.enterpriseId) === enterpriseId
    ) {
      return true;
    }

    if (
      (data.workspaces || []).some(
        (workspace: SlackOrganizationWorkspace): boolean => {
          return workspace.id === existingId;
        },
      )
    ) {
      return true;
    }

    if (!data.existing.authToken) {
      return false;
    }

    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString("https://slack.com/api/auth.test"),
          data: {},
          headers: {
            Authorization: `Bearer ${data.existing.authToken}`,
            ["Content-Type"]: "application/x-www-form-urlencoded",
          },
        });

      if (response instanceof HTTPErrorResponse) {
        return false;
      }

      const json: JSONObject = (response.jsonData || {}) as JSONObject;

      return (
        json["ok"] === true &&
        SlackOrganization.textOf(json["team_id"]) === existingId &&
        SlackOrganization.textOf(json["enterprise_id"]) === enterpriseId
      );
    } catch (err) {
      logger.debug(
        "Slack did not say which organization a workspace connection is in.",
      );
      logger.debug(err);
      return false;
    }
  }

  /*
   * The workspaces to look in for a channel, in order: the one a rule names
   * when it is OneUptime's, else the default first and then the others.
   */
  public static getWorkspaceIdsToSearch(data: {
    organization: SlackOrganizationConnection;
    teamId?: string | undefined;
  }): Array<string> {
    const teamId: string = SlackOrganization.textOf(data.teamId);

    const ids: Array<string> = data.organization.workspaces.map(
      (workspace: SlackOrganizationWorkspace): string => {
        return workspace.id;
      },
    );

    if (
      data.organization.defaultWorkspaceId &&
      !ids.includes(data.organization.defaultWorkspaceId)
    ) {
      ids.unshift(data.organization.defaultWorkspaceId);
    }

    if (!teamId) {
      return ids;
    }

    return [
      teamId,
      ...ids.filter((id: string): boolean => {
        return id !== teamId;
      }),
    ];
  }

  /*
   * The workspace a per-workspace Slack call - user groups, say - is made
   * in, for a project's connection: its own workspace; for a whole
   * organization's installation, the default one - empty while OneUptime is
   * added to none.
   */
  public static getWorkspaceIdForCalls(
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined,
  ): string {
    const organization: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(projectAuth);

    if (!organization) {
      return SlackOrganization.textOf(projectAuth?.workspaceProjectId);
    }

    return organization.defaultWorkspaceId || "";
  }

  /*
   * The workspace a channel is created in: the one a rule names, else the
   * default. Undefined when OneUptime is added to no workspace yet.
   */
  public static getWorkspaceIdToCreateIn(data: {
    organization: SlackOrganizationConnection;
    teamId?: string | undefined;
  }): string | undefined {
    return (
      SlackOrganization.textOf(data.teamId) ||
      data.organization.defaultWorkspaceId ||
      undefined
    );
  }

  /*
   * The workspace a rule's channel is in, to tell two channels of one name
   * apart (WorkspaceNotificationRuleService): for a project connected to a
   * whole organization, the one the rule names, else the default one - a
   * channel named without a workspace is created there, and looked for
   * there first. Undefined for a project connected to one workspace, or to
   * none: its channels are all in that workspace, and a workspace a rule
   * names is not read.
   */
  public static getWorkspaceIdOfChannel(data: {
    projectAuth:
      | Pick<WorkspaceProjectAuthToken, "miscData" | "workspaceProjectId">
      | null
      | undefined;
    teamId: string | undefined;
  }): string | undefined {
    const organization: SlackOrganizationConnection | null =
      SlackOrganization.readConnection(data.projectAuth);

    if (!organization) {
      return undefined;
    }

    return (
      SlackOrganization.textOf(data.teamId) ||
      organization.defaultWorkspaceId ||
      undefined
    );
  }

  /*
   * The workspace a channel is in, by its id, as a project's connection to
   * a whole organization knows it: its channel cache keeps each channel's
   * workspace (Slack.updateChannelsInCache) - the channels OneUptime created
   * or looked up for its rules. Undefined for a channel it does not know,
   * and for a project connected to one workspace.
   */
  public static getWorkspaceIdOfKnownChannel(data: {
    projectAuth: Pick<WorkspaceProjectAuthToken, "miscData"> | null | undefined;
    channelId: string | undefined;
  }): string | undefined {
    const miscData: SlackMiscData | undefined = data.projectAuth?.miscData as
      | SlackMiscData
      | undefined;

    const channelId: string = SlackOrganization.textOf(data.channelId);

    if (!channelId || !SlackOrganization.isOrganization(miscData)) {
      return undefined;
    }

    for (const entry of Object.values(miscData?.channelCache || {})) {
      const fields: JSONObject | undefined = SlackOrganization.objectOf(entry);
      const teamId: string = SlackOrganization.textOf(fields?.["teamId"]);

      if (teamId && SlackOrganization.textOf(fields?.["id"]) === channelId) {
        return teamId;
      }
    }

    return undefined;
  }

  /*
   * A workspace's name, by its id: as listed, else as it was named when
   * OneUptime was removed from it - the id when it is neither.
   */
  public static getWorkspaceName(data: {
    organization: SlackOrganizationConnection;
    teamId: string;
  }): string {
    return (
      [
        ...data.organization.workspaces,
        ...(data.organization.removedWorkspaces || []),
      ].find((workspace: SlackOrganizationWorkspace): boolean => {
        return workspace.id === data.teamId;
      })?.name || data.teamId
    );
  }

  /*
   * The default workspace: the one chosen, while OneUptime is still added to
   * it - or before Slack has listed any - else the first by name.
   */
  public static pickDefaultWorkspaceId(data: {
    workspaces: Array<SlackOrganizationWorkspace>;
    defaultWorkspaceId?: string | undefined;
  }): string | undefined {
    const chosen: string = SlackOrganization.textOf(data.defaultWorkspaceId);

    if (
      chosen &&
      (data.workspaces.length === 0 ||
        data.workspaces.some((workspace: SlackOrganizationWorkspace) => {
          return workspace.id === chosen;
        }))
    ) {
      return chosen;
    }

    return SlackOrganization.orderWorkspaces({
      workspaces: data.workspaces,
      defaultWorkspaceId: undefined,
    })[0]?.id;
  }

  // The default first, then the others by name.
  public static orderWorkspaces(data: {
    workspaces: Array<SlackOrganizationWorkspace>;
    defaultWorkspaceId: string | undefined;
  }): Array<SlackOrganizationWorkspace> {
    return [...data.workspaces].sort(
      (a: SlackOrganizationWorkspace, b: SlackOrganizationWorkspace) => {
        if (a.id === data.defaultWorkspaceId) {
          return -1;
        }

        if (b.id === data.defaultWorkspaceId) {
          return 1;
        }

        return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      },
    );
  }

  // Whether the workspaces were listed less than WORKSPACES_FRESH_FOR_SECONDS ago.
  public static isFresh(organization: SlackOrganizationConnection): boolean {
    if (!organization.workspacesReadAt) {
      return false;
    }

    const ageInSeconds: number =
      (OneUptimeDate.getCurrentDate().getTime() -
        organization.workspacesReadAt.getTime()) /
      1000;

    return (
      ageInSeconds >= 0 &&
      ageInSeconds < SlackOrganization.WORKSPACES_FRESH_FOR_SECONDS
    );
  }

  // The workspaces as stored, each with an id, each once.
  private static readWorkspaces(
    value: unknown,
  ): Array<SlackOrganizationWorkspace> {
    if (!Array.isArray(value)) {
      return [];
    }

    const workspaces: Array<SlackOrganizationWorkspace> = [];

    for (const item of value as Array<unknown>) {
      const fields: JSONObject | undefined = SlackOrganization.objectOf(item);
      const id: string = SlackOrganization.textOf(fields?.["id"]);

      if (
        !id ||
        workspaces.some((workspace: SlackOrganizationWorkspace): boolean => {
          return workspace.id === id;
        })
      ) {
        continue;
      }

      workspaces.push({
        id: id,
        name: SlackOrganization.textOf(fields?.["name"]) || id,
      });
    }

    return workspaces;
  }

  private static objectOf(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }

  private static textOf(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
