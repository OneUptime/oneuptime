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
 *   - with no devices, the page is the first-run path: a probe on the
 *     network, then the two ways in (each opening its form), then alerts;
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
  test("shows the first-run path when the project has no devices", () => {
    expect(OVERVIEW).toMatch(
      /if \(fleet\.total === 0\) \{ return \( <NetworkGetStarted enabledAlertPolicyCount=\{enabledAlertPolicyCount\} isAddProbeRequested=\{isAddProbeRequested\} \/> \); \}/,
    );
  });

  /*
   * A probe first: every device is pinged by one, and the one that pings it
   * has to be on its network. Then the devices, then the alerts - the order
   * a network comes in.
   */
  test("is three steps, in the order a network comes in", () => {
    const probe: number = GET_STARTED.indexOf(
      'data-testid="network-first-run-step-probe"',
    );
    const devices: number = GET_STARTED.indexOf(
      'data-testid="network-first-run-step-devices"',
    );
    const alerts: number = GET_STARTED.indexOf(
      'data-testid="network-first-run-step-alerts"',
    );

    expect(probe).toBeGreaterThan(-1);
    expect(devices).toBeGreaterThan(probe);
    expect(alerts).toBeGreaterThan(devices);
    expect(GET_STARTED).toContain(
      '<ol className="space-y-8" data-testid="network-first-run-steps">',
    );
  });

  test("numbers each step, and ticks the ones that are done", () => {
    expect(GET_STARTED).toContain(
      "<StepMarker number={1} isDone={isProbeDone} />",
    );
    expect(GET_STARTED).toContain("<StepMarker number={2} isDone={false} />");
    expect(GET_STARTED).toContain(
      "<StepMarker number={3} isDone={areAlertsOn} />",
    );
    expect(GET_STARTED).toContain(
      "const isProbeDone: boolean = probeKind === NetworkProbeSetupKind.Connected;",
    );
    expect(GET_STARTED).toContain(
      "const areAlertsOn: boolean = props.enabledAlertPolicyCount !== null && props.enabledAlertPolicyCount > 0;",
    );
  });

  test("the probe step offers to add a probe, or to run the one that is waiting", () => {
    expect(GET_STARTED).toMatch(
      /<Button title="Add a probe" icon=\{IconProp\.Add\} buttonStyle=\{ButtonStyleType\.PRIMARY\} dataTestId="network-first-run-add-probe"/,
    );
    expect(GET_STARTED).toMatch(
      /<Button title="How to run it" icon=\{IconProp\.Code\} buttonStyle=\{ButtonStyleType\.NORMAL\} dataTestId="network-first-run-run-probe"/,
    );
    // Neither once a probe checks in, nor for a role that may not add one.
    expect(GET_STARTED).toContain(
      "if (!probes.canAddProbe || probes.isLoading || isProbeDone) { return null; }",
    );
  });

  test("the probe dialog opens in place, and the step reads the probes again when it closes", () => {
    expect(GET_STARTED).toContain(
      'import AddProbeModal, { AddProbeModalProbe } from "./AddProbeModal";',
    );
    expect(GET_STARTED).toMatch(
      /onClose=\{\(\) => \{ setDialog\(null\); probes\.refresh\(\)/,
    );
    expect(GET_STARTED).toMatch(
      /onProbeChanged=\{\(\) => \{ probes\.refresh\(\)/,
    );
    // Opened at once when the page was opened to add a probe.
    expect(GET_STARTED).toContain(
      "props.isAddProbeRequested ? { probe: null } : null",
    );
  });

  test("the alerts step links to Alert Policies until a policy is on", () => {
    expect(GET_STARTED).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ALERT_POLICIES]",
    );
    expect(GET_STARTED).toContain('data-testid="network-first-run-set-up-alerts"');
    expect(GET_STARTED).toContain("{!areAlertsOn && (");
    expect(GET_STARTED).toContain('data-testid="network-first-run-alerts-status"');
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
    expect(GET_STARTED).toMatch(
      /Navigation\.navigate\( ?getNetworkQuickActionRoute\(choice\.action\),? ?\);/,
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
