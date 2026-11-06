import { JSONArray, JSONObject } from "../JSON";
import WorkspaceType from "./WorkspaceType";
import { SLACK_ID_PATTERN } from "./ConnectCallback";
import MicrosoftTeamsCloudUtil, {
  MicrosoftTeamsCloud,
} from "./MicrosoftTeamsCloud";

/*
 * WHERE A RECORD'S OWN CHAT CHANNEL IS.
 *
 * A workspace notification rule can create a Slack, Microsoft Teams or
 * Mattermost channel for an incident, an alert, an episode or a scheduled
 * maintenance event, and the record keeps the channels it got
 * (postUpdatesToWorkspaceChannels). The record's page shows "Open in Slack",
 * "Open in Microsoft Teams" or "Open in Mattermost" for them: one click from
 * the incident to the room where it is being worked.
 *
 * The links are built on the server - the ids they need (the Slack
 * workspace, the Microsoft Teams tenant, the Mattermost server and team) are
 * the project's connection, not the browser's to read - and only ever from
 * ids of the shape each product gives, on the product's own host, so nothing
 * a channel row holds can send the button anywhere else. Mattermost has no
 * host of its own: its links are on the server the project was connected to
 * (getMattermostChannelUrl, isMattermostChannelUrl).
 */
export interface WorkspaceChannelLink {
  workspaceType: WorkspaceType;
  // The channel's name as the record stored it: "incident-42-checkout".
  channelName: string;
  /*
   * Opens the channel in the Slack or Teams app or in the browser, or on the
   * project's Mattermost server.
   */
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

/*
 * A team's or a channel's name in Mattermost's addresses:
 * chat.example.com/<team>/channels/<channel>. Lowercase letters, digits, "-"
 * and "_", at most 64 characters, so it can only ever be one path segment.
 */
export const MATTERMOST_NAME_PATTERN: RegExp = /^[a-z0-9_-]{1,64}$/;

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

  /*
   * Mattermost's own address of a channel, on the server the project was
   * connected to: <server>/<team>/channels/<channel>. A server on a path
   * keeps its path. Null unless the server is a web address with nothing but
   * a path after its host, and the team and the channel have the shape of
   * Mattermost's names: a channel row can only ever name a channel on that
   * server, never another server or another page of it.
   */
  public static getMattermostChannelUrl(data: {
    serverUrl: string | undefined;
    teamName: string | undefined;
    channelName: string | undefined;
  }): string | null {
    const server: URL | null = WorkspaceChannelLinkUtil.parseMattermostAddress(
      WorkspaceChannelLinkUtil.readStoredText(data.serverUrl),
    );
    const teamName: string = WorkspaceChannelLinkUtil.readStoredText(
      data.teamName,
    );
    const channelName: string = WorkspaceChannelLinkUtil.readStoredText(
      data.channelName,
    );

    if (
      !server ||
      !MATTERMOST_NAME_PATTERN.test(teamName) ||
      !MATTERMOST_NAME_PATTERN.test(channelName)
    ) {
      return null;
    }

    let serverPath: string = server.pathname;

    while (serverPath.endsWith("/")) {
      serverPath = serverPath.slice(0, -1);
    }

    return `${server.origin}${serverPath}/${teamName}/channels/${channelName}`;
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
   * workspace, a name, and an https address on Slack's or Microsoft's host,
   * or the address of a Mattermost channel (isMattermostChannelUrl).
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
          workspaceType !== WorkspaceType.MicrosoftTeams &&
          workspaceType !== WorkspaceType.Mattermost) ||
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

    if (data.workspaceType === WorkspaceType.Mattermost) {
      return WorkspaceChannelLinkUtil.isMattermostChannelUrl(parsed);
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

  /*
   * Whether an address is that of a Mattermost channel. Mattermost has no
   * host to check it against: it is a server of the customer's own, and
   * which one is the project's connection, which only OneUptime's server
   * reads. So the origin is the server's to answer for: it builds the link
   * on the connection's address, and a channel row places only a name in its
   * path (getMattermostChannelUrl). Sending that origin with the links for
   * the page to compare would check the answer against itself. What the page
   * can tell on its own, it checks: a web address, with no user name in front
   * of the host (https://chat.example.com@evil.example) and nothing after
   * the channel, on the path of a channel.
   */
  private static isMattermostChannelUrl(url: URL): boolean {
    if (!WorkspaceChannelLinkUtil.isMattermostAddress(url)) {
      return false;
    }

    const [teamName, channelsWord, channelName] = url.pathname
      .split("/")
      .slice(-3);

    return (
      channelsWord === "channels" &&
      MATTERMOST_NAME_PATTERN.test(teamName || "") &&
      MATTERMOST_NAME_PATTERN.test(channelName || "")
    );
  }

  // A Mattermost server's address, or null when it is not one (isMattermostAddress).
  private static parseMattermostAddress(value: string): URL | null {
    let parsed: URL;

    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    return WorkspaceChannelLinkUtil.isMattermostAddress(parsed) ? parsed : null;
  }

  /*
   * An address on a Mattermost server. Https, or http for a server that says
   * so (MattermostConnection.normalizeServerUrl keeps what the server was
   * connected with), and only a host and a path.
   */
  private static isMattermostAddress(url: URL): boolean {
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }

  // A connection and a channel row are stored JSON: what is not text is not a name.
  private static readStoredText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
}
