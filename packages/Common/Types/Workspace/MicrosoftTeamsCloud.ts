/*
 * THE MICROSOFT CLOUD A SERVER'S MICROSOFT TEAMS RUNS IN.
 *
 * Microsoft runs Microsoft 365, and Teams in it, in separate clouds. An
 * organization's tenant lives in one of them, and its sign-ins, its
 * Microsoft Graph, its Teams on the web and the Azure Bot Service its bots
 * talk through are that cloud's own, on hosts of their own:
 *
 *   - Commercial: what nearly every organization has.
 *   - GCC: US government contractors and agencies at the moderate level.
 *     The commercial sign-in, Graph and Bot Framework, but Teams' own
 *     service for bots (smba.infra.gcc.teams.microsoft.com).
 *   - GCC High: US government at the high level, in Azure Government:
 *     login.microsoftonline.us, graph.microsoft.us, the Bot Framework's US
 *     Government channel (botframework.azure.us), gov.teams.microsoft.us.
 *   - DoD: the US Department of Defense, in Azure Government too, with a
 *     Graph of its own (dod-graph.microsoft.us) and dod.teams.microsoft.us.
 *
 * A tenant in one cloud cannot use another cloud's hosts: a GCC High
 * tenant is unknown to login.microsoftonline.com, and its Teams only talks
 * to a bot registered in Azure Government. So a server says which cloud its
 * Microsoft Teams is in - MICROSOFT_TEAMS_CLOUD, unset for Commercial - and
 * the Teams bot, the Microsoft Teams sign-ins and the Teams meetings app
 * all go to that cloud's hosts, which this table is the one place to name.
 *
 * Microsoft Teams operated by 21Vianet, in China, is not in the table: its
 * sign-in, Graph and Bot Framework are hosts of its own again, and nobody
 * has asked for it.
 *
 * https://learn.microsoft.com/graph/deployments
 * https://learn.microsoft.com/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages
 * https://learn.microsoft.com/azure/bot-service/how-to-deploy-gov-cloud-high
 *
 * Read in the browser as well (Dashboard links to Teams), so nothing here
 * reads the environment: the server reads MICROSOFT_TEAMS_CLOUD
 * (Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHosts.ts), and the
 * Dashboard the same setting from its env.js.
 */

export enum MicrosoftTeamsCloud {
  Commercial = "commercial",
  Gcc = "gcc",
  GccHigh = "gcc-high",
  DoD = "dod",
}

export interface MicrosoftTeamsCloudHosts {
  cloud: MicrosoftTeamsCloud;
  // What Microsoft calls the cloud.
  title: string;
  /*
   * Microsoft Entra ID's sign-in: authorize, token and admin consent
   * endpoints, and the issuer of every ID token it signs.
   */
  signInOrigin: string;
  // Microsoft Graph: every read and send, and the scopes asked for it.
  graphOrigin: string;
  /*
   * The Bot Framework's channel service for a bot registered in Azure
   * Government, which the Bot Framework SDK reads as its US Government
   * settings (botframework-connector's GovernmentConstants.ChannelService);
   * null for a bot in Azure's public cloud.
   */
  botChannelService: string | null;
  /*
   * Where a proactive Teams send goes when no service URL was captured
   * for its conversation: the cloud's own Teams service for bots.
   */
  defaultServiceUrl: string;
  // Microsoft Teams on the web: links to apps, channels and meetings.
  teamsWebOrigin: string;
  // Where the app registration and the Azure Bot are made.
  azurePortalOrigin: string;
}

const COMMERCIAL_HOSTS: MicrosoftTeamsCloudHosts = {
  cloud: MicrosoftTeamsCloud.Commercial,
  title: "Commercial",
  signInOrigin: "https://login.microsoftonline.com",
  graphOrigin: "https://graph.microsoft.com",
  botChannelService: null,
  defaultServiceUrl: "https://smba.trafficmanager.net/teams/",
  teamsWebOrigin: "https://teams.microsoft.com",
  azurePortalOrigin: "https://portal.azure.com",
};

export const MICROSOFT_TEAMS_CLOUD_HOSTS: ReadonlyArray<MicrosoftTeamsCloudHosts> =
  [
    COMMERCIAL_HOSTS,
    {
      cloud: MicrosoftTeamsCloud.Gcc,
      title: "GCC",
      signInOrigin: "https://login.microsoftonline.com",
      graphOrigin: "https://graph.microsoft.com",
      botChannelService: null,
      defaultServiceUrl: "https://smba.infra.gcc.teams.microsoft.com/teams",
      teamsWebOrigin: "https://teams.microsoft.com",
      azurePortalOrigin: "https://portal.azure.com",
    },
    {
      cloud: MicrosoftTeamsCloud.GccHigh,
      title: "GCC High",
      signInOrigin: "https://login.microsoftonline.us",
      graphOrigin: "https://graph.microsoft.us",
      botChannelService: "https://botframework.azure.us",
      defaultServiceUrl: "https://smba.infra.gov.teams.microsoft.us/teams",
      teamsWebOrigin: "https://gov.teams.microsoft.us",
      azurePortalOrigin: "https://portal.azure.us",
    },
    {
      cloud: MicrosoftTeamsCloud.DoD,
      title: "DoD",
      signInOrigin: "https://login.microsoftonline.us",
      graphOrigin: "https://dod-graph.microsoft.us",
      botChannelService: "https://botframework.azure.us",
      defaultServiceUrl: "https://smba.infra.dod.teams.microsoft.us/teams",
      teamsWebOrigin: "https://dod.teams.microsoft.us",
      azurePortalOrigin: "https://portal.azure.us",
    },
  ];

/*
 * The words a MICROSOFT_TEAMS_CLOUD value may name a cloud by, as read:
 * lower case, without spaces, hyphens or underscores - so "GCC High",
 * "gcc-high" and "GCC_HIGH" are all "gcchigh".
 */
const CLOUD_NAMES: ReadonlyMap<string, MicrosoftTeamsCloud> = new Map<
  string,
  MicrosoftTeamsCloud
>([
  ["commercial", MicrosoftTeamsCloud.Commercial],
  ["global", MicrosoftTeamsCloud.Commercial],
  ["worldwide", MicrosoftTeamsCloud.Commercial],
  ["public", MicrosoftTeamsCloud.Commercial],
  ["gcc", MicrosoftTeamsCloud.Gcc],
  ["gccmoderate", MicrosoftTeamsCloud.Gcc],
  ["gcchigh", MicrosoftTeamsCloud.GccHigh],
  ["gcch", MicrosoftTeamsCloud.GccHigh],
  ["dod", MicrosoftTeamsCloud.DoD],
  ["gccdod", MicrosoftTeamsCloud.DoD],
]);

// Hosts beside Teams on the web that serve a Teams meeting's join link.
const TEAMS_MEETING_HOSTS: ReadonlyArray<string> = [
  "teams.microsoft.com",
  "teams.microsoft.us",
  "teams.live.com",
  "teams.cloud.microsoft",
];

// And any host under Teams' own, in the commercial cloud and the US Government's.
const TEAMS_MEETING_HOST_SUFFIXES: ReadonlyArray<string> = [
  ".teams.microsoft.com",
  ".teams.microsoft.us",
];

// A value read as a cloud's name: what CLOUD_NAMES is keyed by.
const asCloudName: (value: string) => string = (value: string): string => {
  let name: string = "";

  for (const character of value.toLowerCase()) {
    if (character !== " " && character !== "-" && character !== "_") {
      name += character;
    }
  }

  return name;
};

// A host name as compared: lower case, without a trailing dot.
const asHost: (host: string) => string = (host: string): string => {
  const lower: string = host.trim().toLowerCase();

  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
};

// The host of an origin of the table ("https://graph.microsoft.us").
const hostOf: (origin: string) => string = (origin: string): string => {
  return asHost(origin.slice(origin.indexOf("//") + 2));
};

export default class MicrosoftTeamsCloudUtil {
  // The values MICROSOFT_TEAMS_CLOUD is documented with, in order.
  public static readonly SETTING_VALUES: ReadonlyArray<string> =
    MICROSOFT_TEAMS_CLOUD_HOSTS.map((hosts: MicrosoftTeamsCloudHosts) => {
      return hosts.cloud;
    });

  /*
   * The cloud a MICROSOFT_TEAMS_CLOUD value names: Commercial when it is
   * unset or empty, and null when it names no cloud. Read leniently - case,
   * spaces, hyphens and underscores aside, and by the other names Microsoft
   * gives a cloud ("Worldwide", "GCCH").
   */
  public static read(value: unknown): MicrosoftTeamsCloud | null {
    if (value === undefined || value === null) {
      return MicrosoftTeamsCloud.Commercial;
    }

    if (typeof value !== "string") {
      return null;
    }

    const name: string = asCloudName(value.trim());

    if (!name) {
      return MicrosoftTeamsCloud.Commercial;
    }

    return CLOUD_NAMES.get(name) || null;
  }

  // The hosts of a cloud.
  public static getHosts(cloud: MicrosoftTeamsCloud): MicrosoftTeamsCloudHosts {
    return (
      MICROSOFT_TEAMS_CLOUD_HOSTS.find(
        (hosts: MicrosoftTeamsCloudHosts): boolean => {
          return hosts.cloud === cloud;
        },
      ) || COMMERCIAL_HOSTS
    );
  }

  /*
   * The hosts of the cloud a MICROSOFT_TEAMS_CLOUD value names, or the
   * commercial cloud's for a value that names none: for what only links to
   * Teams (a Dashboard button), where a wrong setting costs a link. The
   * server never falls back like this (MicrosoftTeamsHosts).
   */
  public static getHostsOrCommercial(value: unknown): MicrosoftTeamsCloudHosts {
    const cloud: MicrosoftTeamsCloud | null =
      MicrosoftTeamsCloudUtil.read(value);

    return cloud ? MicrosoftTeamsCloudUtil.getHosts(cloud) : COMMERCIAL_HOSTS;
  }

  // Whether a host is Microsoft Teams on the web, in any cloud.
  public static isTeamsWebHost(host: string): boolean {
    const wanted: string = asHost(host);

    return MICROSOFT_TEAMS_CLOUD_HOSTS.some(
      (hosts: MicrosoftTeamsCloudHosts): boolean => {
        return hostOf(hosts.teamsWebOrigin) === wanted;
      },
    );
  }

  /*
   * Whether a host is Microsoft Graph, in any cloud: what it serves - an
   * image a Teams message carries, the next page of an answer - is read
   * with a Graph token only.
   */
  public static isGraphHost(host: string): boolean {
    const wanted: string = asHost(host);

    return MICROSOFT_TEAMS_CLOUD_HOSTS.some(
      (hosts: MicrosoftTeamsCloudHosts): boolean => {
        return hostOf(hosts.graphOrigin) === wanted;
      },
    );
  }

  /*
   * Whether a host serves Teams meetings' join links: Teams on the web in
   * any cloud, Teams' own hosts of the commercial cloud and the US
   * Government's (teams.microsoft.com, teams.microsoft.us, and any host
   * under them), Teams for personal accounts (teams.live.com) and
   * Microsoft's newer address for Teams (teams.cloud.microsoft).
   */
  public static isTeamsMeetingHost(host: string): boolean {
    const wanted: string = asHost(host);

    return (
      MicrosoftTeamsCloudUtil.isTeamsWebHost(wanted) ||
      TEAMS_MEETING_HOSTS.includes(wanted) ||
      TEAMS_MEETING_HOST_SUFFIXES.some((suffix: string): boolean => {
        return wanted.endsWith(suffix);
      })
    );
  }
}
