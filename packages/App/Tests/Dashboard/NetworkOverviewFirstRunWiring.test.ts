import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How the Network Overview is put together, read from the source (the App
 * suite has no React renderer; the components themselves are rendered in
 * Common/Tests/App/Dashboard/NetworkOverviewPage.test.tsx).
 *
 * It replaced an EmptyState whose two buttons only took people to a list
 * (where they then had to find the right button), and a page that made
 * them work out "is my network healthy?" from four tiles. What has to hold:
 *
 *   - with no devices, the page is the two ways in, each opening its form;
 *   - with devices, it opens on one sentence about the network's health,
 *     worked out from the same counts the tiles show - the SNMP-failing
 *     count included - and on whether any alert policy is on;
 *   - the alert-policy line is read on its own and allowed to fail, so a
 *     role that cannot read alert policies still gets its Overview.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(...relativeParts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  ).replace(/\s+/g, " ");
}

const OVERVIEW: string = readCode("Pages", "NetworkDevice", "Overview.tsx");
const GET_STARTED: string = readCode(
  "Components",
  "Network",
  "NetworkGetStarted.tsx",
);
const HERO: string = readCode("Components", "Network", "NetworkHealthHero.tsx");

describe("the Overview with nothing on it", () => {
  test("shows the two ways in when the project has no devices", () => {
    expect(OVERVIEW).toContain(
      "if (fleet.total === 0) { return <NetworkGetStarted />; }",
    );
  });

  test("no longer draws the old empty state that only linked to lists", () => {
    expect(OVERVIEW).not.toContain("network-overview-empty-state");
    expect(OVERVIEW).not.toContain("Welcome to Network Monitoring");
    expect(OVERVIEW).not.toContain("<EmptyState");
  });

  test("offers discovery first, then adding one device", () => {
    const discover: number = GET_STARTED.indexOf(
      "action: NetworkQuickAction.DiscoverDevices",
    );
    const add: number = GET_STARTED.indexOf(
      "action: NetworkQuickAction.AddDevice",
    );

    expect(discover).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(discover);
  });

  test("each choice opens its form, not a list", () => {
    expect(GET_STARTED).toContain(
      "Navigation.navigate(getNetworkQuickActionRoute(choice.action));",
    );
    expect(GET_STARTED).not.toContain("RouteMap[PageMap.NETWORK_DEVICES]");
    expect(GET_STARTED).not.toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY]",
    );
  });

  test("each choice is a real button", () => {
    expect(GET_STARTED).toContain('<button key={choice.action} type="button"');
  });

  test("the two choices sit side by side from tablet width, stacked below", () => {
    expect(GET_STARTED).toContain("grid grid-cols-1 gap-4 md:grid-cols-2");
  });
});

describe("the Overview with devices on it", () => {
  test("opens on the health verdict, above the tiles", () => {
    const hero: number = OVERVIEW.indexOf("<NetworkHealthHero");
    const tiles: number = OVERVIEW.indexOf(
      "mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
    );

    expect(hero).toBeGreaterThan(-1);
    expect(tiles).toBeGreaterThan(hero);
  });

  test("works the verdict out from every count it can speak about", () => {
    for (const input of [
      "totalDevices: fleet.total",
      "devicesUp: fleet.up",
      "devicesDown: fleet.down",
      "devicesPending: fleet.pending",
      "interfacesDown: fleet.interfacesDown",
      "unhealthySites: summary?.unhealthySiteCount || 0",
      "snmpFailingDevices: fleet.snmpFailing",
    ]) {
      expect({ input, wired: OVERVIEW.includes(input) }).toEqual({
        input,
        wired: true,
      });
    }
  });

  test("hands the hero the pending count and the alert-policy count", () => {
    expect(OVERVIEW).toContain("devicesPending={fleet.pending}");
    expect(OVERVIEW).toContain(
      "enabledAlertPolicyCount={enabledAlertPolicyCount}",
    );
  });

  test("a fleet with no snmpFailing count from an older server reads zero", () => {
    expect(OVERVIEW).toContain("snmpFailing: 0,");
  });
});

describe("the alert-policy line", () => {
  test("counts enabled policies of this project only", () => {
    expect(OVERVIEW).toContain("modelType: NetworkAlertPolicy");
    expect(OVERVIEW).toContain(
      "query: { projectId: projectId, isEnabled: true, }",
    );
  });

  test("is read alongside the page's data, not after it", () => {
    expect(OVERVIEW).toContain("fetchEnabledAlertPolicyCount(projectId), ]);");
  });

  test("a failed read hides the line rather than failing the page", () => {
    expect(OVERVIEW).toContain("} catch { setEnabledAlertPolicyCount(null); }");
  });

  test("the hero leaves the line out when the count is unknown", () => {
    expect(HERO).toContain("props.enabledAlertPolicyCount !== null ? (");
  });

  test("links to Alert Policies, where the recommended policy is one click", () => {
    expect(HERO).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES]",
    );
  });
});

describe("the hero's two actions", () => {
  test("Add Device is the primary one, Discover Devices the plain one", () => {
    expect(HERO).toMatch(
      /title="Discover Devices" icon=\{IconProp\.Search\} buttonStyle=\{ButtonStyleType\.NORMAL\}/,
    );
    expect(HERO).toMatch(
      /title="Add Device" icon=\{IconProp\.Add\} buttonStyle=\{ButtonStyleType\.PRIMARY\}/,
    );
  });

  test("both open their forms through the quick-action routes", () => {
    expect(HERO).toContain(
      "getNetworkQuickActionRoute(NetworkQuickAction.DiscoverDevices)",
    );
    expect(HERO).toContain(
      "getNetworkQuickActionRoute(NetworkQuickAction.AddDevice)",
    );
  });
});
