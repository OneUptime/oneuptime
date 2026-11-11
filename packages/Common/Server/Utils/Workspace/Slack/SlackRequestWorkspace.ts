import { JSONObject } from "../../../../Types/JSON";

/*
 * WHERE A SLACK REQUEST WAS MADE: ITS WORKSPACE AND, IN A SLACK ENTERPRISE
 * ORGANIZATION, THE ORGANIZATION.
 *
 * A project connects Slack in one of two ways. Most install OneUptime into
 * one workspace, and the connection is stored under that workspace's id
 * (Slack's team id, T...). A Slack Enterprise organization (Enterprise Grid)
 * can instead install it for the whole organization: an org admin installs
 * it once, adds it to some or all of the organization's workspaces, and the
 * one connection - stored under the organization's id, E... - works in every
 * one of them (SlackOrganization).
 *
 * A request from a workspace of such an organization names both, and says
 * whether it is for the organization's installation (is_enterprise_install).
 * Where each sits differs with the kind of request; they are read as Slack's
 * own framework, Bolt, reads them:
 *
 * - a slash command: team_id, enterprise_id, and is_enterprise_install as
 *   the text "true" or "false";
 * - an event: the installation it is for in authorizations[0] (its
 *   enterprise_id, its team_id - null for the organization's installation -
 *   and is_enterprise_install), and the workspace in team_id;
 * - a press, a form, a shortcut, a select's options: team - null for the
 *   organization's installation, which leaves the workspace to the user's
 *   team_id, or a form's app_installed_team_id - enterprise, and
 *   is_enterprise_install.
 *
 * The projects a request can be about are those connected to either id
 * (getConnectionIds): the installation it says it is for first, then the
 * other. So a project connected to one workspace is found from it, a project
 * connected to the whole organization is found from any of its workspaces,
 * and a project that moved from the one to the other is found whichever of
 * the two Slack names.
 */
export interface SlackRequestWorkspace {
  // The workspace it was made in (T...); empty when Slack did not say.
  teamId: string;
  // The Enterprise organization the workspace is part of (E...), if any.
  enterpriseId?: string | undefined;
  // Made for OneUptime's installation in the whole organization.
  isEnterpriseInstall?: boolean | undefined;
}

// The kinds of request, as their payloads tell them apart.
export enum SlackRequestKind {
  Command = "Command",
  Event = "Event",
  Interaction = "Interaction",
}

export default class SlackRequestWorkspaceUtil {
  // What kind of request a payload is.
  public static getKind(payload: JSONObject): SlackRequestKind {
    if (
      payload["type"] === "event_callback" ||
      SlackRequestWorkspaceUtil.isObject(payload["event"])
    ) {
      return SlackRequestKind.Event;
    }

    if (typeof payload["command"] === "string") {
      return SlackRequestKind.Command;
    }

    return SlackRequestKind.Interaction;
  }

  // Where a request was made, by what its payload carries.
  public static read(payload: JSONObject): SlackRequestWorkspace {
    if (!SlackRequestWorkspaceUtil.isObject(payload)) {
      return { teamId: "" };
    }

    switch (SlackRequestWorkspaceUtil.getKind(payload)) {
      case SlackRequestKind.Event:
        return SlackRequestWorkspaceUtil.readEvent(payload);
      case SlackRequestKind.Command:
        return SlackRequestWorkspaceUtil.readCommand(payload);
      case SlackRequestKind.Interaction:
        return SlackRequestWorkspaceUtil.readInteraction(payload);
    }
  }

  /*
   * The ids a request's projects are connected under, the installation it
   * says it is for first: the organization's for the organization's
   * installation, the workspace's otherwise. Empty when it names neither.
   */
  public static getConnectionIds(
    workspace: SlackRequestWorkspace,
  ): Array<string> {
    const teamId: string = SlackRequestWorkspaceUtil.textOf(workspace.teamId);
    const enterpriseId: string = SlackRequestWorkspaceUtil.textOf(
      workspace.enterpriseId,
    );

    const ids: Array<string> =
      workspace.isEnterpriseInstall && enterpriseId
        ? [enterpriseId, teamId]
        : [teamId, enterpriseId];

    const connectionIds: Array<string> = [];

    for (const id of ids) {
      if (id && !connectionIds.includes(id)) {
        connectionIds.push(id);
      }
    }

    return connectionIds;
  }

  /*
   * The one id a request is told apart by, for what is kept of it between
   * Slack's requests (a project choice, SlackProjectChoice): the
   * organization's for the organization's installation - whose presses can
   * name the workspace of the person rather than the channel's - the
   * workspace's otherwise.
   */
  public static getScopeId(workspace: SlackRequestWorkspace): string {
    return SlackRequestWorkspaceUtil.getConnectionIds(workspace)[0] || "";
  }

  /*
   * The organization part of where a request was made, with only what it
   * says: what handlers that already take the workspace are passed too.
   */
  public static getEnterprise(workspace: SlackRequestWorkspace): {
    enterpriseId?: string;
    isEnterpriseInstall?: boolean;
  } {
    const enterprise: { enterpriseId?: string; isEnterpriseInstall?: boolean } =
      {};

    const enterpriseId: string = SlackRequestWorkspaceUtil.textOf(
      workspace.enterpriseId,
    );

    if (enterpriseId) {
      enterprise.enterpriseId = enterpriseId;
    }

    if (workspace.isEnterpriseInstall) {
      enterprise.isEnterpriseInstall = true;
    }

    return enterprise;
  }

  /*
   * getScopeId of a request that may have said only its workspace: what is
   * passed where older callers built a request without the organization.
   */
  public static getScopeIdOf(data: {
    slackWorkspace?: SlackRequestWorkspace | undefined;
    slackTeamId?: string | undefined;
  }): string | undefined {
    const scopeId: string = data.slackWorkspace
      ? SlackRequestWorkspaceUtil.getScopeId(data.slackWorkspace)
      : SlackRequestWorkspaceUtil.textOf(data.slackTeamId);

    return scopeId || undefined;
  }

  // A workspace with no organization: what callers that only knew a team id pass.
  public static ofTeam(teamId: string | undefined): SlackRequestWorkspace {
    return { teamId: SlackRequestWorkspaceUtil.textOf(teamId) };
  }

  private static readCommand(payload: JSONObject): SlackRequestWorkspace {
    return SlackRequestWorkspaceUtil.build({
      teamId: payload["team_id"],
      enterpriseId: payload["enterprise_id"],
      isEnterpriseInstall: payload["is_enterprise_install"],
    });
  }

  private static readEvent(payload: JSONObject): SlackRequestWorkspace {
    const authorizations: unknown = payload["authorizations"];

    const authorization: JSONObject | undefined =
      Array.isArray(authorizations) &&
      SlackRequestWorkspaceUtil.isObject(authorizations[0])
        ? (authorizations[0] as JSONObject)
        : undefined;

    const event: JSONObject | undefined = SlackRequestWorkspaceUtil.isObject(
      payload["event"],
    )
      ? (payload["event"] as JSONObject)
      : undefined;

    /*
     * The installation's own workspace, when the event is for one (null for
     * the organization's), else the workspace the event happened in.
     */
    const teamId: string =
      SlackRequestWorkspaceUtil.textOf(authorization?.["team_id"]) ||
      SlackRequestWorkspaceUtil.textOf(payload["team_id"]) ||
      SlackRequestWorkspaceUtil.textOf(event?.["team"]);

    const enterpriseId: string =
      SlackRequestWorkspaceUtil.textOf(authorization?.["enterprise_id"]) ||
      SlackRequestWorkspaceUtil.textOf(payload["enterprise_id"]);

    return SlackRequestWorkspaceUtil.build({
      teamId: teamId,
      enterpriseId: enterpriseId,
      isEnterpriseInstall: authorization
        ? authorization["is_enterprise_install"]
        : payload["is_enterprise_install"],
    });
  }

  private static readInteraction(payload: JSONObject): SlackRequestWorkspace {
    const team: JSONObject | undefined = SlackRequestWorkspaceUtil.isObject(
      payload["team"],
    )
      ? (payload["team"] as JSONObject)
      : undefined;

    const user: JSONObject | undefined = SlackRequestWorkspaceUtil.isObject(
      payload["user"],
    )
      ? (payload["user"] as JSONObject)
      : undefined;

    const view: JSONObject | undefined = SlackRequestWorkspaceUtil.isObject(
      payload["view"],
    )
      ? (payload["view"] as JSONObject)
      : undefined;

    const enterprise: JSONObject | undefined =
      SlackRequestWorkspaceUtil.isObject(payload["enterprise"])
        ? (payload["enterprise"] as JSONObject)
        : undefined;

    /*
     * A form's submission names, on the form, the workspace OneUptime is
     * installed in: a form opened from another workspace through a shared
     * channel has another team.
     */
    const isFormSubmission: boolean =
      payload["type"] === "view_submission" ||
      payload["type"] === "view_closed";

    const teamId: string =
      (isFormSubmission
        ? SlackRequestWorkspaceUtil.textOf(view?.["app_installed_team_id"])
        : "") ||
      SlackRequestWorkspaceUtil.textOf(team?.["id"]) ||
      SlackRequestWorkspaceUtil.textOf(payload["team_id"]) ||
      SlackRequestWorkspaceUtil.textOf(user?.["team_id"]);

    const enterpriseId: string =
      SlackRequestWorkspaceUtil.textOf(enterprise?.["id"]) ||
      SlackRequestWorkspaceUtil.textOf(team?.["enterprise_id"]) ||
      SlackRequestWorkspaceUtil.textOf(payload["enterprise_id"]);

    return SlackRequestWorkspaceUtil.build({
      teamId: teamId,
      enterpriseId: enterpriseId,
      isEnterpriseInstall: payload["is_enterprise_install"],
    });
  }

  private static build(data: {
    teamId: unknown;
    enterpriseId: unknown;
    isEnterpriseInstall: unknown;
  }): SlackRequestWorkspace {
    const workspace: SlackRequestWorkspace = {
      teamId: SlackRequestWorkspaceUtil.textOf(data.teamId),
    };

    const enterpriseId: string = SlackRequestWorkspaceUtil.textOf(
      data.enterpriseId,
    );

    if (enterpriseId) {
      workspace.enterpriseId = enterpriseId;
    }

    // A command says it as text, everything else as a boolean.
    if (
      data.isEnterpriseInstall === true ||
      data.isEnterpriseInstall === "true"
    ) {
      workspace.isEnterpriseInstall = true;
    }

    return workspace;
  }

  private static textOf(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private static isObject(value: unknown): boolean {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
