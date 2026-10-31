import BadDataException from "../../../../Types/Exception/BadDataException";
import logger from "../../Logger";
import MicrosoftTeamsHosts from "./MicrosoftTeamsHosts";

/*
 * Where a proactive Microsoft Teams send is allowed to go.
 *
 * botbuilder puts the bot's Bot Framework access token on every request its
 * connector makes, and does not check where the request is going. In
 * botframework-connector 4.x, AppCredentials.isTrustedServiceUrl() always
 * returns true, trustServiceUrl() does nothing, and signRequest() signs
 * whenever an app id is configured. So whichever host a serviceUrl names
 * receives `Authorization: Bearer <bot token>`, and that token can post as
 * the OneUptime bot into any conversation the app is installed in.
 *
 * Service URLs captured from inbound bot activities are safe when they
 * arrive: the adapter checks them against the serviceurl claim in
 * Microsoft's signed token before any handler runs. But they are then stored
 * in WorkspaceProjectAuthToken.miscData and read back for later sends. This
 * checks them at the point of use, whatever wrote the stored value.
 *
 * Only Microsoft's Teams Bot Framework hosts are accepted, over https on the
 * default port:
 *
 *  - smba.trafficmanager.net: commercial cloud, on every regional path
 *    (/teams/, /amer/, /emea/, /apac/, ...). This host exactly, not
 *    *.trafficmanager.net: any Azure customer can create a Traffic Manager
 *    profile called <anything>.trafficmanager.net and point it anywhere.
 *  - *.teams.microsoft.com: GCC (smba.infra.gcc.teams.microsoft.com).
 *  - *.teams.microsoft.us: GCC High and DoD
 *    (smba.infra.gov.teams.microsoft.us, smba.infra.dod.teams.microsoft.us).
 *  - *.botapi.skype.com: Teams preview rings (canary.botapi.skype.com).
 *
 * When no service URL was ever captured for a conversation, a send goes to
 * the Teams service of the Microsoft cloud this server's Teams runs in
 * (MicrosoftTeamsHosts, MICROSOFT_TEAMS_CLOUD): smba.trafficmanager.net for
 * the commercial cloud, smba.infra.gcc.teams.microsoft.com for GCC,
 * smba.infra.gov.teams.microsoft.us for GCC High and
 * smba.infra.dod.teams.microsoft.us for DoD.
 */
export default class MicrosoftTeamsServiceUrl {
  // Used when no service URL was ever captured for the conversation.
  public static getDefault(): string {
    return MicrosoftTeamsHosts.getDefaultServiceUrl();
  }

  private static readonly TRUSTED_HOSTS: Array<string> = [
    "smba.trafficmanager.net",
  ];

  private static readonly TRUSTED_HOST_SUFFIXES: Array<string> = [
    ".teams.microsoft.com",
    ".teams.microsoft.us",
    ".botapi.skype.com",
  ];

  public static isTrusted(serviceUrl: string | undefined | null): boolean {
    if (!serviceUrl || typeof serviceUrl !== "string") {
      return false;
    }

    let url: globalThis.URL;

    try {
      url = new globalThis.URL(serviceUrl);
    } catch {
      return false;
    }

    // The https default port is normalised to "", so any port here is custom.
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return false;
    }

    const host: string = url.hostname.toLowerCase();

    if (MicrosoftTeamsServiceUrl.TRUSTED_HOSTS.includes(host)) {
      return true;
    }

    return MicrosoftTeamsServiceUrl.TRUSTED_HOST_SUFFIXES.some(
      (suffix: string) => {
        return host.endsWith(suffix);
      },
    );
  }

  /*
   * The service URL to send to: the captured one, or the cloud's default
   * when none was captured. A captured URL that is not a Microsoft host is
   * refused rather than replaced. Quietly falling back to the default
   * endpoint would hide the bad value.
   */
  public static resolve(serviceUrl: string | undefined | null): string {
    if (!serviceUrl) {
      return MicrosoftTeamsServiceUrl.getDefault();
    }

    if (!MicrosoftTeamsServiceUrl.isTrusted(serviceUrl)) {
      logger.error(
        `Refusing a Microsoft Teams send: the stored Bot Framework service URL "${serviceUrl}" is not a Microsoft Teams host.`,
      );

      throw new BadDataException(
        "The Microsoft Teams service URL stored for this conversation is not a Microsoft Bot Framework endpoint, so OneUptime will not send to it. Remove the OneUptime app from this team or chat in Microsoft Teams and add it again.",
      );
    }

    return serviceUrl;
  }

  // The first trusted URL among candidates, or the cloud's default.
  public static firstTrustedOrDefault(
    candidates: Array<string | undefined | null>,
  ): string {
    return (
      candidates.find((candidate: string | undefined | null) => {
        return MicrosoftTeamsServiceUrl.isTrusted(candidate);
      }) || MicrosoftTeamsServiceUrl.getDefault()
    );
  }
}
