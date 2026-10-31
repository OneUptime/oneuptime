import { MicrosoftTeamsCloudSetting } from "../../../EnvironmentConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import MicrosoftTeamsCloudUtil, {
  MicrosoftTeamsCloud,
  MicrosoftTeamsCloudHosts,
} from "../../../../Types/Workspace/MicrosoftTeamsCloud";

/*
 * THE HOSTS THIS SERVER'S MICROSOFT TEAMS TALKS TO.
 *
 * MICROSOFT_TEAMS_CLOUD says which Microsoft cloud the server's Microsoft
 * Teams runs in (Types/Workspace/MicrosoftTeamsCloud.ts): Commercial when
 * unset, GCC, GCC High or DoD. Every address the Teams bot, the Microsoft
 * Teams sign-ins and the Teams meetings app build comes from here - the
 * sign-in and token endpoints, Microsoft Graph and its scopes, the Bot
 * Framework's channel service, the Teams service a first proactive send
 * goes to, and Teams on the web - so a server in GCC High never sends a
 * secret, a code or a token to the commercial cloud's hosts.
 *
 * A value that names no cloud ("gcc high please") is refused, not read as
 * Commercial: every address asked for throws a BadDataException that names
 * the setting, before anything is sent anywhere, and the bot check
 * (/api/microsoft-bot/test) says so. Falling back would send a government
 * tenant's sign-ins to the commercial cloud.
 *
 * The setting is read when an address is asked for, so a test can set it.
 */

export const MICROSOFT_TEAMS_CLOUD_SETTING_NAME: string =
  "MICROSOFT_TEAMS_CLOUD";

// The version of Microsoft Graph every request names.
export const MICROSOFT_GRAPH_VERSION: string = "v1.0";

export default class MicrosoftTeamsHosts {
  /*
   * What is wrong with MICROSOFT_TEAMS_CLOUD, or null when it names a
   * cloud (or is unset): for the bot check, which reports it.
   */
  public static getSettingProblem(): string | null {
    if (MicrosoftTeamsCloudUtil.read(MicrosoftTeamsCloudSetting) !== null) {
      return null;
    }

    return `${MICROSOFT_TEAMS_CLOUD_SETTING_NAME} is "${String(
      MicrosoftTeamsCloudSetting,
    )}", which names no Microsoft cloud. Set it to ${MicrosoftTeamsCloudUtil.SETTING_VALUES.join(
      ", ",
    )}, or leave it unset for the commercial cloud.`;
  }

  // The cloud this server's Microsoft Teams runs in, and its hosts.
  public static getCloud(): MicrosoftTeamsCloudHosts {
    const cloud: MicrosoftTeamsCloud | null = MicrosoftTeamsCloudUtil.read(
      MicrosoftTeamsCloudSetting,
    );

    if (!cloud) {
      throw new BadDataException(
        MicrosoftTeamsHosts.getSettingProblem() ||
          `${MICROSOFT_TEAMS_CLOUD_SETTING_NAME} names no Microsoft cloud.`,
      );
    }

    return MicrosoftTeamsCloudUtil.getHosts(cloud);
  }

  // Microsoft Entra ID's sign-in origin: authorize, token, admin consent.
  public static getSignInOrigin(): string {
    return MicrosoftTeamsHosts.getCloud().signInOrigin;
  }

  // Microsoft Graph's origin.
  public static getGraphOrigin(): string {
    return MicrosoftTeamsHosts.getCloud().graphOrigin;
  }

  /*
   * A Microsoft Graph address: `path` (starting with "/") under the
   * version every request names - "/teams" is
   * https://graph.microsoft.com/v1.0/teams in the commercial cloud.
   */
  public static getGraphUrl(path: string): string {
    return `${MicrosoftTeamsHosts.getGraphOrigin()}/${MICROSOFT_GRAPH_VERSION}${path}`;
  }

  /*
   * A Microsoft Graph permission as a scope a sign-in asks for:
   * "User.Read" is https://graph.microsoft.com/User.Read in the commercial
   * cloud and https://graph.microsoft.us/User.Read in GCC High.
   */
  public static getGraphScope(permission: string): string {
    return `${MicrosoftTeamsHosts.getGraphOrigin()}/${permission}`;
  }

  // Every Microsoft Graph permission the app was granted, as one scope.
  public static getGraphDefaultScope(): string {
    return MicrosoftTeamsHosts.getGraphScope(".default");
  }

  /*
   * Whether `url` is an https address on this cloud's Microsoft Graph: the
   * only kind of address a Graph token is sent to, the next page of an
   * answer included.
   */
  public static isGraphUrl(url: unknown): boolean {
    if (typeof url !== "string" || !url) {
      return false;
    }

    let parsed: globalThis.URL;
    let graph: globalThis.URL;

    try {
      parsed = new globalThis.URL(url);
      graph = new globalThis.URL(MicrosoftTeamsHosts.getGraphOrigin());
    } catch {
      return false;
    }

    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      parsed.host === graph.host
    );
  }

  /*
   * The next page of a Microsoft Graph answer (@odata.nextLink), to follow
   * with the same Graph token - or null when there is none, or when it is
   * not on this cloud's Graph, which an answer must not be able to send
   * the token to.
   */
  public static readGraphNextLink(answer: unknown): string | null {
    if (!answer || typeof answer !== "object") {
      return null;
    }

    const next: unknown = (answer as Record<string, unknown>)[
      "@odata.nextLink"
    ];

    if (typeof next !== "string" || !next) {
      return null;
    }

    return MicrosoftTeamsHosts.isGraphUrl(next) ? next : null;
  }

  /*
   * The Bot Framework channel service the Teams bot is configured with:
   * the US Government's for a bot in Azure Government (GCC High and DoD),
   * undefined for one in Azure's public cloud.
   */
  public static getBotChannelService(): string | undefined {
    return MicrosoftTeamsHosts.getCloud().botChannelService || undefined;
  }

  // Where a proactive Teams send goes when no service URL was captured.
  public static getDefaultServiceUrl(): string {
    return MicrosoftTeamsHosts.getCloud().defaultServiceUrl;
  }

  /*
   * Microsoft Teams on the web: links to the app and to channels. A link
   * sends nothing anywhere, so for a MICROSOFT_TEAMS_CLOUD that names no
   * cloud it is the commercial cloud's, and a page that only links to
   * Teams never fails for the setting.
   */
  public static getTeamsWebOrigin(): string {
    return MicrosoftTeamsCloudUtil.getHostsOrCommercial(
      MicrosoftTeamsCloudSetting,
    ).teamsWebOrigin;
  }
}
