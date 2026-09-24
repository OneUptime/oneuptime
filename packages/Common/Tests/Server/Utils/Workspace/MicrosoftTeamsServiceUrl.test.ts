import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsServiceUrl from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * botbuilder attaches the bot's Bot Framework token to every proactive
 * request, whatever host the serviceUrl names (botframework-connector 4.x no
 * longer keeps a trusted-host list). These pin the allow-list the send paths
 * now check stored service URLs against: Microsoft's Teams hosts for the
 * commercial, GCC, GCC High and DoD clouds, and nothing else.
 */

describe("MicrosoftTeamsServiceUrl.isTrusted", () => {
  test.each([
    // Commercial cloud, global and regional paths.
    "https://smba.trafficmanager.net/teams/",
    "https://smba.trafficmanager.net/amer/",
    "https://smba.trafficmanager.net/emea/",
    "https://smba.trafficmanager.net/apac/",
    "https://smba.trafficmanager.net/in/",
    "https://smba.trafficmanager.net/amer/72f988bf-86f1-41af-91ab-2d7cd011db47/",
    "https://SMBA.TrafficManager.net/teams/",
    "https://smba.trafficmanager.net:443/teams/",
    // GCC.
    "https://smba.infra.gcc.teams.microsoft.com/teams",
    "https://smba.infra.gcc.teams.microsoft.com/gcc",
    "https://smba.emea.teams.microsoft.com/",
    // GCC High and DoD.
    "https://smba.infra.gov.teams.microsoft.us/teams",
    "https://smba.infra.gov.teams.microsoft.us/",
    "https://smba.infra.dod.teams.microsoft.us/dod",
    // Teams preview rings.
    "https://canary.botapi.skype.com/amer/",
  ])("accepts %s", (serviceUrl: string) => {
    expect(MicrosoftTeamsServiceUrl.isTrusted(serviceUrl)).toBe(true);
  });

  test.each([
    // Not https.
    "http://smba.trafficmanager.net/teams/",
    "ftp://smba.trafficmanager.net/teams/",
    // Hosts anyone can own.
    "https://attacker.example.com/",
    "https://attacker.trafficmanager.net/teams/",
    "https://smba.trafficmanager.net.attacker.example.com/teams/",
    "https://smba.attacker.example.com/",
    "https://evilteams.microsoft.com/",
    "https://teams.microsoft.com.attacker.example.com/",
    "https://smba.infra.gov.teams.microsoft.us.attacker.example.com/",
    "https://attacker.example.com/smba.trafficmanager.net/teams/",
    "https://attacker.example.com/?next=https://smba.trafficmanager.net/",
    // Credentials, custom ports, odd hosts.
    "https://user:pass@smba.trafficmanager.net/teams/",
    "https://smba.trafficmanager.net@attacker.example.com/teams/",
    "https://smba.trafficmanager.net:8443/teams/",
    "https://smba.trafficmanager.net./teams/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    // Not URLs.
    "smba.trafficmanager.net/teams/",
    "//smba.trafficmanager.net/teams/",
    "not a url",
    "",
  ])("refuses %s", (serviceUrl: string) => {
    expect(MicrosoftTeamsServiceUrl.isTrusted(serviceUrl)).toBe(false);
  });

  test("refuses missing and non-string values", () => {
    expect(MicrosoftTeamsServiceUrl.isTrusted(undefined)).toBe(false);
    expect(MicrosoftTeamsServiceUrl.isTrusted(null)).toBe(false);
    expect(
      MicrosoftTeamsServiceUrl.isTrusted({
        toString: () => {
          return "https://smba.trafficmanager.net/teams/";
        },
      } as unknown as string),
    ).toBe(false);
  });
});

describe("MicrosoftTeamsServiceUrl.resolve", () => {
  test("uses the commercial endpoint when nothing was captured", () => {
    expect(MicrosoftTeamsServiceUrl.resolve(undefined)).toBe(
      "https://smba.trafficmanager.net/teams/",
    );
    expect(MicrosoftTeamsServiceUrl.resolve("")).toBe(
      "https://smba.trafficmanager.net/teams/",
    );
  });

  test("keeps a captured Microsoft URL exactly as it was captured (GCC/DoD)", () => {
    expect(
      MicrosoftTeamsServiceUrl.resolve(
        "https://smba.infra.dod.teams.microsoft.us/dod",
      ),
    ).toBe("https://smba.infra.dod.teams.microsoft.us/dod");
  });

  test("refuses a captured URL that is not a Microsoft host, rather than falling back", () => {
    expect(() => {
      return MicrosoftTeamsServiceUrl.resolve("https://attacker.example.com/");
    }).toThrow(BadDataException);
  });
});

describe("MicrosoftTeamsServiceUrl.firstTrustedOrDefault", () => {
  test("skips untrusted and empty candidates", () => {
    expect(
      MicrosoftTeamsServiceUrl.firstTrustedOrDefault([
        undefined,
        "https://attacker.example.com/",
        "",
        "https://smba.infra.gcc.teams.microsoft.com/teams",
        "https://smba.trafficmanager.net/emea/",
      ]),
    ).toBe("https://smba.infra.gcc.teams.microsoft.com/teams");
  });

  test("falls back to the commercial endpoint when none is trusted", () => {
    expect(
      MicrosoftTeamsServiceUrl.firstTrustedOrDefault([
        "https://attacker.example.com/",
      ]),
    ).toBe("https://smba.trafficmanager.net/teams/");
    expect(MicrosoftTeamsServiceUrl.firstTrustedOrDefault([])).toBe(
      "https://smba.trafficmanager.net/teams/",
    );
  });
});
