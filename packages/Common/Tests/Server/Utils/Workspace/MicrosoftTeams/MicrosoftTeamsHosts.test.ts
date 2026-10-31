import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE HOSTS THIS SERVER'S MICROSOFT TEAMS TALKS TO
 * (Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHosts).
 *
 * MICROSOFT_TEAMS_CLOUD names the Microsoft cloud the server's Teams runs
 * in. Every address the bot, the sign-ins and the meetings app build comes
 * from here - so a GCC High server never sends a secret or a code to the
 * commercial cloud - and a value that names no cloud stops every request
 * before anything is sent, rather than falling back to the commercial
 * cloud.
 */

const environment: Record<string, string | null> = {
  MicrosoftTeamsCloudSetting: null,
};

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return new Proxy(actual, {
    get: (target: Record<string, unknown>, key: string | symbol): unknown => {
      if (typeof key === "string" && key in environment) {
        return environment[key];
      }

      return target[key as string];
    },
  });
});

import MicrosoftTeamsHosts, {
  MICROSOFT_TEAMS_CLOUD_SETTING_NAME,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsHosts";
import BadDataException from "../../../../../Types/Exception/BadDataException";

const setCloud: (value: string | null) => void = (
  value: string | null,
): void => {
  environment["MicrosoftTeamsCloudSetting"] = value;
};

interface CloudCase {
  setting: string | null;
  title: string;
  signIn: string;
  graph: string;
  channelService: string | undefined;
  serviceUrl: string;
  teamsWeb: string;
}

const CASES: Array<CloudCase> = [
  {
    setting: null,
    title: "Commercial",
    signIn: "https://login.microsoftonline.com",
    graph: "https://graph.microsoft.com",
    channelService: undefined,
    serviceUrl: "https://smba.trafficmanager.net/teams/",
    teamsWeb: "https://teams.microsoft.com",
  },
  {
    setting: "gcc",
    title: "GCC",
    signIn: "https://login.microsoftonline.com",
    graph: "https://graph.microsoft.com",
    channelService: undefined,
    serviceUrl: "https://smba.infra.gcc.teams.microsoft.com/teams",
    teamsWeb: "https://teams.microsoft.com",
  },
  {
    setting: "gcc-high",
    title: "GCC High",
    signIn: "https://login.microsoftonline.us",
    graph: "https://graph.microsoft.us",
    channelService: "https://botframework.azure.us",
    serviceUrl: "https://smba.infra.gov.teams.microsoft.us/teams",
    teamsWeb: "https://gov.teams.microsoft.us",
  },
  {
    setting: "dod",
    title: "DoD",
    signIn: "https://login.microsoftonline.us",
    graph: "https://dod-graph.microsoft.us",
    channelService: "https://botframework.azure.us",
    serviceUrl: "https://smba.infra.dod.teams.microsoft.us/teams",
    teamsWeb: "https://dod.teams.microsoft.us",
  },
];

describe("MicrosoftTeamsHosts, cloud by cloud", () => {
  test.each(CASES)(
    "$title: every address on its own hosts",
    (cloud: CloudCase) => {
      setCloud(cloud.setting);

      expect(MicrosoftTeamsHosts.getSettingProblem()).toBeNull();
      expect(MicrosoftTeamsHosts.getCloud().title).toBe(cloud.title);
      expect(MicrosoftTeamsHosts.getSignInOrigin()).toBe(cloud.signIn);
      expect(MicrosoftTeamsHosts.getGraphOrigin()).toBe(cloud.graph);
      expect(MicrosoftTeamsHosts.getGraphUrl("/teams")).toBe(
        `${cloud.graph}/v1.0/teams`,
      );
      expect(MicrosoftTeamsHosts.getGraphUrl("")).toBe(`${cloud.graph}/v1.0`);
      expect(MicrosoftTeamsHosts.getGraphScope("User.Read")).toBe(
        `${cloud.graph}/User.Read`,
      );
      expect(MicrosoftTeamsHosts.getGraphDefaultScope()).toBe(
        `${cloud.graph}/.default`,
      );
      expect(MicrosoftTeamsHosts.getBotChannelService()).toBe(
        cloud.channelService,
      );
      expect(MicrosoftTeamsHosts.getDefaultServiceUrl()).toBe(cloud.serviceUrl);
      expect(MicrosoftTeamsHosts.getTeamsWebOrigin()).toBe(cloud.teamsWeb);
    },
  );
});

describe("a MICROSOFT_TEAMS_CLOUD that names no cloud", () => {
  test("stops every address, naming the setting and the values it takes", () => {
    setCloud("gcc high please");

    const problem: string | null = MicrosoftTeamsHosts.getSettingProblem();

    expect(problem).toBe(
      `${MICROSOFT_TEAMS_CLOUD_SETTING_NAME} is "gcc high please", which names no Microsoft cloud. Set it to gcc, gcc-high or dod, or leave it unset for the commercial cloud.`,
    );

    for (const address of [
      (): unknown => {
        return MicrosoftTeamsHosts.getSignInOrigin();
      },
      (): unknown => {
        return MicrosoftTeamsHosts.getGraphUrl("/me");
      },
      (): unknown => {
        return MicrosoftTeamsHosts.getGraphDefaultScope();
      },
      (): unknown => {
        return MicrosoftTeamsHosts.getBotChannelService();
      },
      (): unknown => {
        return MicrosoftTeamsHosts.getDefaultServiceUrl();
      },
    ]) {
      expect(address).toThrow(BadDataException);
      expect(address).toThrow(problem!);
    }

    setCloud(null);
  });

  test("only a link to Teams goes on, to the commercial cloud's Teams: it sends nothing", () => {
    setCloud("usgov");

    expect(MicrosoftTeamsHosts.getTeamsWebOrigin()).toBe(
      "https://teams.microsoft.com",
    );

    setCloud(null);
  });
});

describe("MicrosoftTeamsHosts.isGraphUrl: where a Graph token may go", () => {
  test("https addresses on this cloud's Graph only", () => {
    setCloud("gcc-high");

    expect(
      MicrosoftTeamsHosts.isGraphUrl(
        "https://graph.microsoft.us/v1.0/teams?$skiptoken=2",
      ),
    ).toBe(true);

    for (const url of [
      // The commercial cloud's Graph is another cloud's.
      "https://graph.microsoft.com/v1.0/teams",
      "https://dod-graph.microsoft.us/v1.0/teams",
      "http://graph.microsoft.us/v1.0/teams",
      "https://graph.microsoft.us.evil.example/v1.0/teams",
      "https://user:secret@graph.microsoft.us/v1.0/teams",
      "https://graph.microsoft.us:8443/v1.0/teams",
      "/v1.0/teams",
      "",
      42,
      null,
    ]) {
      expect(MicrosoftTeamsHosts.isGraphUrl(url)).toBe(false);
    }

    setCloud(null);
  });

  test("the next page of an answer is followed only on this cloud's Graph", () => {
    setCloud("dod");

    expect(
      MicrosoftTeamsHosts.readGraphNextLink({
        "@odata.nextLink":
          "https://dod-graph.microsoft.us/v1.0/teams?$skiptoken=2",
      }),
    ).toBe("https://dod-graph.microsoft.us/v1.0/teams?$skiptoken=2");

    for (const answer of [
      { "@odata.nextLink": "https://graph.microsoft.us/v1.0/teams?page=2" },
      { "@odata.nextLink": "https://collector.evil.example/steal" },
      { "@odata.nextLink": "" },
      { "@odata.nextLink": 2 },
      { value: [] },
      null,
      "https://dod-graph.microsoft.us/v1.0/teams",
    ]) {
      expect(MicrosoftTeamsHosts.readGraphNextLink(answer)).toBeNull();
    }

    setCloud(null);
  });
});
