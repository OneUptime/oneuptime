import {
  DEFAULT_MERAKI_REGION,
  MERAKI_REGIONS,
  MerakiRegion,
  MerakiRegionDefinition,
  getMerakiApiBaseUrl,
  getMerakiRegion,
  getMerakiRegionOrDefault,
  isMerakiApiHost,
  isMerakiRegion,
} from "../../../Types/NetworkController/MerakiRegion";
import { describe, expect, test } from "@jest/globals";

/*
 * The hosts a Meraki connection may ever send its key to: the five
 * dashboards' API hosts (developer.cisco.com/meraki/api-v1/getting-started)
 * and the shards under each region's own domain - compared on the parsed
 * host, label by label, never as a substring.
 */

function region(value: MerakiRegion): MerakiRegionDefinition {
  return getMerakiRegion(value) as MerakiRegionDefinition;
}

describe("Meraki's dashboards", () => {
  test("are the five Meraki documents as base URIs, each with its API host", () => {
    expect(
      MERAKI_REGIONS.map((definition: MerakiRegionDefinition) => {
        return [definition.region, definition.apiHost];
      }),
    ).toEqual([
      ["global", "api.meraki.com"],
      ["canada", "api.meraki.ca"],
      ["china", "api.meraki.cn"],
      ["india", "api.meraki.in"],
      ["us-fedramp", "api.gov-meraki.com"],
    ]);
  });

  test("every region says the address people sign in at", () => {
    for (const definition of MERAKI_REGIONS) {
      expect(definition.dashboardHost.startsWith("dashboard.")).toBe(true);
      expect(definition.dashboardHost.slice("dashboard.".length)).toBe(
        definition.domain,
      );
    }
  });

  test("the global dashboard is the default", () => {
    expect(DEFAULT_MERAKI_REGION).toBe(MerakiRegion.Global);
    expect(getMerakiRegionOrDefault(undefined).apiHost).toBe("api.meraki.com");
    expect(getMerakiRegionOrDefault("atlantis").apiHost).toBe("api.meraki.com");
    expect(getMerakiRegionOrDefault("china").apiHost).toBe("api.meraki.cn");
  });

  test("a region is one of the five, by value", () => {
    expect(isMerakiRegion("india")).toBe(true);
    expect(isMerakiRegion("India")).toBe(false);
    expect(isMerakiRegion("")).toBe(false);
    expect(isMerakiRegion(null)).toBe(false);
    expect(isMerakiRegion(5)).toBe(false);
  });

  test("the base URL is HTTPS on the API host, under /api/v1", () => {
    expect(getMerakiApiBaseUrl(region(MerakiRegion.Global))).toBe(
      "https://api.meraki.com/api/v1",
    );
    expect(getMerakiApiBaseUrl(region(MerakiRegion.UnitedStatesFedRamp))).toBe(
      "https://api.gov-meraki.com/api/v1",
    );
  });
});

describe("which hosts are the region's API", () => {
  const global: MerakiRegionDefinition = region(MerakiRegion.Global);

  test.each([
    ["api.meraki.com"],
    ["API.Meraki.com"],
    ["n123.meraki.com"],
    ["n42.dashboard.meraki.com"],
  ])("%s is", (host: string) => {
    expect(isMerakiApiHost(global, host)).toBe(true);
  });

  test.each([
    ["meraki.com"],
    ["evilmeraki.com"],
    ["api.meraki.com.example.net"],
    ["api.meraki.com."],
    ["meraki.com.attacker.io"],
    ["api.meraki.cn"],
    ["api-meraki.com"],
    [""],
  ])("%s is not", (host: string) => {
    expect(isMerakiApiHost(global, host)).toBe(false);
  });

  test("each region allows its own domain only", () => {
    expect(isMerakiApiHost(region(MerakiRegion.China), "n1.meraki.cn")).toBe(
      true,
    );
    expect(isMerakiApiHost(region(MerakiRegion.China), "n1.meraki.com")).toBe(
      false,
    );
    expect(
      isMerakiApiHost(
        region(MerakiRegion.UnitedStatesFedRamp),
        "api.gov-meraki.com",
      ),
    ).toBe(true);
    expect(
      isMerakiApiHost(
        region(MerakiRegion.UnitedStatesFedRamp),
        "api.meraki.com",
      ),
    ).toBe(false);
  });
});
