import MicrosoftTeamsCloudUtil, {
  MICROSOFT_TEAMS_CLOUD_HOSTS,
  MicrosoftTeamsCloud,
  MicrosoftTeamsCloudHosts,
} from "../../../Types/Workspace/MicrosoftTeamsCloud";
import {
  RECORDED_GRAPH_ANSWERS,
  RECORDED_HOST_ANSWERS,
  RECORDED_ON,
  RECORDED_SIGN_IN_DISCOVERY,
  RecordedSignInDiscovery,
} from "./MicrosoftCloudRecordedAnswers";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MICROSOFT CLOUDS A SERVER'S TEAMS CAN RUN IN, AND THEIR HOSTS
 * (Types/Workspace/MicrosoftTeamsCloud).
 *
 * A US Government tenant - GCC High, DoD - is unknown to the commercial
 * cloud's hosts, so its Teams bot, its sign-ins and its Teams meetings app
 * must go to its own cloud's. The table names them once; here it is held
 * to what each of Microsoft's clouds answered when asked
 * (MicrosoftCloudRecordedAnswers), and the setting to the names
 * administrators write it with.
 */

const hostsOf: (cloud: MicrosoftTeamsCloud) => MicrosoftTeamsCloudHosts = (
  cloud: MicrosoftTeamsCloud,
): MicrosoftTeamsCloudHosts => {
  return MicrosoftTeamsCloudUtil.getHosts(cloud);
};

// Each cloud, by name, for test.each.
const CLOUD_CASES: Array<[string, MicrosoftTeamsCloudHosts]> =
  MICROSOFT_TEAMS_CLOUD_HOSTS.map(
    (hosts: MicrosoftTeamsCloudHosts): [string, MicrosoftTeamsCloudHosts] => {
      return [hosts.title, hosts];
    },
  );

const recordedStatusOf: (url: string) => number | undefined = (
  url: string,
): number | undefined => {
  return RECORDED_HOST_ANSWERS.find(
    (answer: { url: string; status: number }): boolean => {
      return answer.url === url;
    },
  )?.status;
};

describe("the clouds", () => {
  test("four, in the order the docs list them, one for each value of the setting", () => {
    expect(
      MICROSOFT_TEAMS_CLOUD_HOSTS.map((hosts: MicrosoftTeamsCloudHosts) => {
        return [hosts.cloud, hosts.title];
      }),
    ).toEqual([
      [MicrosoftTeamsCloud.Commercial, "Commercial"],
      [MicrosoftTeamsCloud.Gcc, "GCC"],
      [MicrosoftTeamsCloud.GccHigh, "GCC High"],
      [MicrosoftTeamsCloud.DoD, "DoD"],
    ]);
    expect(MicrosoftTeamsCloudUtil.SETTING_VALUES).toEqual([
      "commercial",
      "gcc",
      "gcc-high",
      "dod",
    ]);
    expect([...MicrosoftTeamsCloudUtil.SETTING_VALUES].sort()).toEqual(
      Object.values(MicrosoftTeamsCloud).sort(),
    );
  });

  test("GCC is the commercial cloud's sign-in, Graph and Bot Framework, with Teams' GCC service for bots", () => {
    const commercial: MicrosoftTeamsCloudHosts = hostsOf(
      MicrosoftTeamsCloud.Commercial,
    );
    const gcc: MicrosoftTeamsCloudHosts = hostsOf(MicrosoftTeamsCloud.Gcc);

    expect(gcc.signInOrigin).toBe(commercial.signInOrigin);
    expect(gcc.graphOrigin).toBe(commercial.graphOrigin);
    expect(gcc.botChannelService).toBeNull();
    expect(gcc.teamsWebOrigin).toBe(commercial.teamsWebOrigin);
    expect(gcc.defaultServiceUrl).toBe(
      "https://smba.infra.gcc.teams.microsoft.com/teams",
    );
  });

  test("GCC High and DoD are Azure Government: its sign-in and Bot Framework channel, a Graph and a Teams of their own", () => {
    const high: MicrosoftTeamsCloudHosts = hostsOf(MicrosoftTeamsCloud.GccHigh);
    const dod: MicrosoftTeamsCloudHosts = hostsOf(MicrosoftTeamsCloud.DoD);

    for (const hosts of [high, dod]) {
      expect(hosts.signInOrigin).toBe("https://login.microsoftonline.us");
      expect(hosts.botChannelService).toBe("https://botframework.azure.us");
      expect(hosts.azurePortalOrigin).toBe("https://portal.azure.us");
    }

    expect(high.graphOrigin).toBe("https://graph.microsoft.us");
    expect(dod.graphOrigin).toBe("https://dod-graph.microsoft.us");
    expect(high.teamsWebOrigin).toBe("https://gov.teams.microsoft.us");
    expect(dod.teamsWebOrigin).toBe("https://dod.teams.microsoft.us");
    expect(high.defaultServiceUrl).toBe(
      "https://smba.infra.gov.teams.microsoft.us/teams",
    );
    expect(dod.defaultServiceUrl).toBe(
      "https://smba.infra.dod.teams.microsoft.us/teams",
    );
  });

  test("every origin is https, with no path, and every host differs only where the cloud does", () => {
    for (const hosts of MICROSOFT_TEAMS_CLOUD_HOSTS) {
      for (const origin of [
        hosts.signInOrigin,
        hosts.graphOrigin,
        hosts.teamsWebOrigin,
        hosts.azurePortalOrigin,
      ]) {
        expect(new URL(origin).origin).toBe(origin);
        expect(origin.startsWith("https://")).toBe(true);
      }

      expect(new URL(hosts.defaultServiceUrl).protocol).toBe("https:");
    }
  });
});

describe(`the hosts, held to what each cloud answered on ${RECORDED_ON}`, () => {
  test.each(CLOUD_CASES)(
    "%s: its sign-in authorizes, exchanges codes and issues ID tokens at the host it names",
    (_title: string, hosts: MicrosoftTeamsCloudHosts) => {
      const discovery: RecordedSignInDiscovery | undefined =
        RECORDED_SIGN_IN_DISCOVERY.find(
          (recorded: RecordedSignInDiscovery): boolean => {
            return new URL(recorded.source).origin === hosts.signInOrigin;
          },
        );

      expect(discovery).toBeDefined();
      expect(discovery!.authorization_endpoint).toBe(
        `${hosts.signInOrigin}/organizations/oauth2/v2.0/authorize`,
      );
      expect(discovery!.token_endpoint).toBe(
        `${hosts.signInOrigin}/organizations/oauth2/v2.0/token`,
      );
      // How MicrosoftTeamsSignInAuthority checks an ID token's issuer.
      expect(discovery!.issuer).toBe(`${hosts.signInOrigin}/{tenantid}/v2.0`);
    },
  );

  test.each(CLOUD_CASES)(
    "%s: its Graph answers as Microsoft Graph",
    (_title: string, hosts: MicrosoftTeamsCloudHosts) => {
      expect(
        RECORDED_GRAPH_ANSWERS.find((answer: { url: string }): boolean => {
          return answer.url === `${hosts.graphOrigin}/v1.0/me`;
        }),
      ).toEqual({
        url: `${hosts.graphOrigin}/v1.0/me`,
        status: 401,
        errorCode: "InvalidAuthenticationToken",
      });
    },
  );

  test.each(CLOUD_CASES)(
    "%s: its Teams on the web, its Teams service for bots and its Azure portal are there",
    (_title: string, hosts: MicrosoftTeamsCloudHosts) => {
      expect(recordedStatusOf(`${hosts.teamsWebOrigin}/`)).toBe(302);
      // A GET where the bot service takes POSTs.
      expect(
        recordedStatusOf(
          hosts.defaultServiceUrl.endsWith("/")
            ? hosts.defaultServiceUrl
            : `${hosts.defaultServiceUrl}/`,
        ),
      ).toBe(404);
      expect(recordedStatusOf(`${hosts.azurePortalOrigin}/`)).toBeDefined();
    },
  );
});

describe("MicrosoftTeamsCloudUtil.read: the setting, as administrators write it", () => {
  test.each([
    [undefined, MicrosoftTeamsCloud.Commercial],
    [null, MicrosoftTeamsCloud.Commercial],
    ["", MicrosoftTeamsCloud.Commercial],
    ["   ", MicrosoftTeamsCloud.Commercial],
    ["commercial", MicrosoftTeamsCloud.Commercial],
    ["Commercial", MicrosoftTeamsCloud.Commercial],
    ["Worldwide", MicrosoftTeamsCloud.Commercial],
    ["global", MicrosoftTeamsCloud.Commercial],
    ["public", MicrosoftTeamsCloud.Commercial],
    ["gcc", MicrosoftTeamsCloud.Gcc],
    ["GCC", MicrosoftTeamsCloud.Gcc],
    ["gcc-moderate", MicrosoftTeamsCloud.Gcc],
    ["gcc-high", MicrosoftTeamsCloud.GccHigh],
    ["GCC High", MicrosoftTeamsCloud.GccHigh],
    ["GCC_HIGH", MicrosoftTeamsCloud.GccHigh],
    ["gcchigh", MicrosoftTeamsCloud.GccHigh],
    ["GCCH", MicrosoftTeamsCloud.GccHigh],
    [" gcc-high ", MicrosoftTeamsCloud.GccHigh],
    ["dod", MicrosoftTeamsCloud.DoD],
    ["DoD", MicrosoftTeamsCloud.DoD],
    ["gcc-dod", MicrosoftTeamsCloud.DoD],
  ])("%j is %s", (value: unknown, cloud: MicrosoftTeamsCloud) => {
    expect(MicrosoftTeamsCloudUtil.read(value)).toBe(cloud);
  });

  test.each([
    ["usgov"],
    ["government"],
    ["gcc high please"],
    ["china"],
    ["21vianet"],
    ["https://login.microsoftonline.us"],
    [42],
    [true],
    [{}],
  ])("%j names no cloud", (value: unknown) => {
    expect(MicrosoftTeamsCloudUtil.read(value)).toBeNull();
  });

  test("a value that names no cloud is the commercial cloud only for a link", () => {
    expect(
      MicrosoftTeamsCloudUtil.getHostsOrCommercial("usgov").teamsWebOrigin,
    ).toBe("https://teams.microsoft.com");
    expect(
      MicrosoftTeamsCloudUtil.getHostsOrCommercial("gcc-high").teamsWebOrigin,
    ).toBe("https://gov.teams.microsoft.us");
    expect(MicrosoftTeamsCloudUtil.getHostsOrCommercial(null).cloud).toBe(
      MicrosoftTeamsCloud.Commercial,
    );
  });
});

describe("which hosts are Microsoft's, in any cloud", () => {
  test("Teams on the web: each cloud's, case aside and with a trailing dot, and nothing that only looks like one", () => {
    for (const host of [
      "teams.microsoft.com",
      "gov.teams.microsoft.us",
      "dod.teams.microsoft.us",
      "GOV.Teams.Microsoft.US",
      "teams.microsoft.com.",
    ]) {
      expect(MicrosoftTeamsCloudUtil.isTeamsWebHost(host)).toBe(true);
    }

    for (const host of [
      "teams.microsoft.us",
      "teams.live.com",
      "evil.teams.microsoft.com",
      "gov.teams.microsoft.us.evil.example",
      "xgov.teams.microsoft.us",
      "teams.microsoft.com:8443",
      "",
    ]) {
      expect(MicrosoftTeamsCloudUtil.isTeamsWebHost(host)).toBe(false);
    }
  });

  test("Microsoft Graph: each cloud's, and nothing that only looks like one", () => {
    for (const host of [
      "graph.microsoft.com",
      "graph.microsoft.us",
      "dod-graph.microsoft.us",
      "Graph.Microsoft.US",
    ]) {
      expect(MicrosoftTeamsCloudUtil.isGraphHost(host)).toBe(true);
    }

    for (const host of [
      "graph.microsoft.us.evil.example",
      "evilgraph.microsoft.us",
      "graph.windows.net",
      "microsoftgraph.chinacloudapi.cn",
      "",
    ]) {
      expect(MicrosoftTeamsCloudUtil.isGraphHost(host)).toBe(false);
    }
  });

  test("a Teams meeting's link: Teams on the web in every cloud, and Teams' other meeting hosts", () => {
    for (const host of [
      "teams.microsoft.com",
      "gov.teams.microsoft.us",
      "dod.teams.microsoft.us",
      "teams.microsoft.us",
      "teams.live.com",
      "teams.cloud.microsoft",
    ]) {
      expect(MicrosoftTeamsCloudUtil.isTeamsMeetingHost(host)).toBe(true);
    }

    for (const host of ["zoom.us", "meet.google.com", "teams.example.com"]) {
      expect(MicrosoftTeamsCloudUtil.isTeamsMeetingHost(host)).toBe(false);
    }
  });
});
