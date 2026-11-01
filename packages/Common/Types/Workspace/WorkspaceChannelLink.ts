import { JSONArray, JSONObject } from "../JSON";
import WorkspaceType from "./WorkspaceType";
import { SLACK_ID_PATTERN } from "./ConnectCallback";
import MicrosoftTeamsCloudUtil, {
  MicrosoftTeamsCloud,
} from "./MicrosoftTeamsCloud";

/*
 * WHERE A RECORD'S OWN CHAT CHANNEL IS.
 *
 * A workspace notification rule can create a Slack or Microsoft Teams
 * channel for an incident, an alert, an episode or a scheduled maintenance
 * event, and the record keeps the channels it got
 * (postUpdatesToWorkspaceChannels). The record's page shows "Open in Slack"
 * / "Open in Microsoft Teams" for them: one click from the incident to the
 * room where it is being worked.
 *
 * The links are built on the server - the ids they need (the Slack
 * workspace, the Microsoft Teams tenant) are the project's connection, not
 * the browser's to read - and only ever from ids of the shape each product
 * gives, on a fixed host, so nothing a channel row holds can send the button
 * anywhere else.
 */
export interface WorkspaceChannelLink {
  workspaceType: WorkspaceType;
  // The channel's name as the record stored it: "incident-42-checkout".
  channelName: string;
  // Opens the channel in the Slack or Teams app, or in the browser.
  url: string;
}

// The record kinds whose pages show their channels.
export enum WorkspaceChannelRecordType {
  Incident = "incident",
  Alert = "alert",
  IncidentEpisode = "incident-episode",
  AlertEpisode = "alert-episode",
  ScheduledMaintenance = "scheduled-maintenance",
}

// GET <api>/workspace-channel-link/<record type>/<record id>
export const WORKSPACE_CHANNEL_LINK_ROUTE: string = "/workspace-channel-link";

/*
 * A Microsoft Teams channel id: "19:<letters, digits, -, _>@thread.tacv2"
 * (or .skype for older teams). Nothing else goes into the link's path.
 */
const MICROSOFT_TEAMS_CHANNEL_ID_PATTERN: RegExp =
  /^19:[A-Za-z0-9._-]{1,200}@thread\.(?:tacv2|skype)$/;

// A Microsoft Entra id - a team (group) or a tenant: a GUID.
const MICROSOFT_ID_PATTERN: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SLACK_REDIRECT_URL: string = "https://slack.com/app_redirect";

export default class WorkspaceChannelLinkUtil {
  /*
   * Slack's own link to a channel: it opens the channel in the Slack app
   * when it is installed, in the browser otherwise. Null unless both ids
   * have the shape of a Slack id.
   * https://api.slack.com/reference/deep-linking
   */
  public static getSlackChannelUrl(data: {
    teamId: string | undefined;
    channelId: string | undefined;
  }): string | null {
    const teamId: string = (data.teamId || "").trim();
    const channelId: string = (data.channelId || "").trim();

    if (!SLACK_ID_PATTERN.test(teamId) || !SLACK_ID_PATTERN.test(channelId)) {
      return null;
    }

    return `${SLACK_REDIRECT_URL}?channel=${channelId}&team=${teamId}`;
  }

  /*
   * Microsoft Teams' link to a channel - what "Get link to channel" copies:
   * https://teams.microsoft.com/l/channel/<channel id>/<channel name>
   * ?groupId=<team id>&tenantId=<tenant id>, on Teams on the web of the
   * Microsoft cloud the team is in (`teamsWebOrigin`, the commercial
   * cloud's when not given; gov.teams.microsoft.us in GCC High). The tenant
   * is left out when it is not known; Teams finds the channel by its team.
   * Null unless the ids have the shapes Microsoft gives them.
   */
  public static getMicrosoftTeamsChannelUrl(data: {
    tenantId: string | undefined;
    teamId: string | undefined;
    channelId: string | undefined;
    channelName: string | undefined;
    teamsWebOrigin?: string | undefined;
  }): string | null {
    const tenantId: string = (data.tenantId || "").trim();
    const teamId: string = (data.teamId || "").trim();
    const channelId: string = (data.channelId || "").trim();
    const channelName: string = (data.channelName || "").trim() || "channel";

    if (
      !MICROSOFT_TEAMS_CHANNEL_ID_PATTERN.test(channelId) ||
      !MICROSOFT_ID_PATTERN.test(teamId)
    ) {
      return null;
    }

    const teamsWebOrigin: string =
      data.teamsWebOrigin ||
      MicrosoftTeamsCloudUtil.getHosts(MicrosoftTeamsCloud.Commercial)
        .teamsWebOrigin;

    let url: string = `${teamsWebOrigin}/l/channel/${encodeURIComponent(
      channelId,
    )}/${encodeURIComponent(channelName)}?groupId=${teamId}`;

    if (MICROSOFT_ID_PATTERN.test(tenantId)) {
      url += `&tenantId=${tenantId}`;
    }

    return url;
  }

  public static isRecordType(
    value: unknown,
  ): value is WorkspaceChannelRecordType {
    return (
      typeof value === "string" &&
      (Object.values(WorkspaceChannelRecordType) as Array<string>).includes(
        value,
      )
    );
  }

  public static toJSONArray(links: Array<WorkspaceChannelLink>): JSONArray {
    return links.map((link: WorkspaceChannelLink): JSONObject => {
      return {
        workspaceType: link.workspaceType,
        channelName: link.channelName,
        url: link.url,
      };
    });
  }

  /*
   * The links an answer holds, keeping only well-formed ones: a known
   * workspace, a name, and an https address on Slack's or Microsoft's host.
   */
  public static fromJSONArray(value: unknown): Array<WorkspaceChannelLink> {
    if (!Array.isArray(value)) {
      return [];
    }

    const links: Array<WorkspaceChannelLink> = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const json: JSONObject = item as JSONObject;
      const workspaceType: unknown = json["workspaceType"];
      const channelName: unknown = json["channelName"];
      const url: unknown = json["url"];

      if (
        (workspaceType !== WorkspaceType.Slack &&
          workspaceType !== WorkspaceType.MicrosoftTeams) ||
        typeof channelName !== "string" ||
        typeof url !== "string" ||
        !WorkspaceChannelLinkUtil.isOnWorkspaceHost({
          workspaceType: workspaceType,
          url: url,
        })
      ) {
        continue;
      }

      links.push({
        workspaceType: workspaceType,
        channelName: channelName,
        url: url,
      });
    }

    return links;
  }

  // Whether a link goes where a link to that product's channel goes.
  public static isOnWorkspaceHost(data: {
    workspaceType: WorkspaceType;
    url: string;
  }): boolean {
    let parsed: URL;

    try {
      parsed = new URL(data.url);
    } catch {
      return false;
    }

    if (parsed.protocol !== "https:") {
      return false;
    }

    if (data.workspaceType === WorkspaceType.Slack) {
      return parsed.host === "slack.com";
    }

    // Teams on the web, in whichever Microsoft cloud the team is.
    if (data.workspaceType === WorkspaceType.MicrosoftTeams) {
      return MicrosoftTeamsCloudUtil.isTeamsWebHost(parsed.host);
    }

    return false;
  }
}
