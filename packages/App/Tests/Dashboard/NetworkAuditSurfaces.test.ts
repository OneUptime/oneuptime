import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { isDifferentText } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDetailText";
import {
  DEVICES_WITH_INTERFACES_DOWN_SELECTION,
  DEVICE_INTERFACES_FACET_KEY,
  DeviceInterfacesFacetValue,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";

/*
 * The Network area, read from the source after the audit that made it
 * natural to use (the App suite has no React renderer; the components are
 * rendered in Common/Tests/App/Dashboard). Each block is one finding of the
 * audit, pinned so it cannot quietly come back:
 *
 *   - empty pages say what to do next, naming labels that exist;
 *   - the Overview's tiles and lists go where they talk about;
 *   - a page with nothing on it draws no toolbar, legend or zeroes;
 *   - words say what they mean, once, in the reader's language.
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

function readCode(...parts: Array<string>): string {
  return stripComments(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8"),
  ).replace(/\s+/g, " ");
}

const OVERVIEW: string = readCode("Pages", "NetworkDevice", "Overview.tsx");
const ENDPOINTS: string = readCode("Pages", "NetworkDevice", "Endpoints.tsx");
const SITE_ENDPOINTS: string = readCode(
  "Pages",
  "NetworkSite",
  "View",
  "Endpoints.tsx",
);

describe("an empty Endpoints page says where endpoints come from", () => {
  /*
   * Endpoints are collected by a switch or router with Collect Connected
   * Endpoints turned on, a device setting that is off by default. The page
   * used to send people to "your switch and router monitors", where there is
   * no such setting.
   */
  test("the network's list names the device setting and where it is", () => {
    expect(ENDPOINTS).toContain(
      'noItemsMessage={ "No endpoints yet. Turn on Collect Connected Endpoints on a switch or router - its Settings page, Edit Polling - and what is plugged into it appears here after its next poll." }',
    );
    expect(ENDPOINTS).not.toContain("monitors");
  });

  test("a site's list does too", () => {
    expect(SITE_ENDPOINTS).toContain(
      'noItemsMessage="No endpoints at this site yet. Turn on Collect Connected Endpoints on one of its switches or routers - its Settings page, Edit Polling - and what is plugged into it appears here after its next poll."',
    );
    expect(SITE_ENDPOINTS).not.toContain("monitors");
  });

  test("the labels it names are the ones the device Settings page draws", () => {
    const settings: string = readCode(
      "Pages",
      "NetworkDevice",
      "View",
      "Settings.tsx",
    );
    const pollingFields: string = readCode(
      "Pages",
      "NetworkDevice",
      "DevicePollingFormFields.ts",
    );

    expect(settings).toContain('editButtonText="Edit Polling"');
    expect(settings).toContain('title: "Collect Connected Endpoints",');
    expect(pollingFields).toContain(
      'title: "Collect Connected Endpoints (ARP + FDB)"',
    );
  });

  test("the list says what an endpoint is, and that nothing ages out on its own", () => {
    expect(ENDPOINTS).toContain(
      "What is plugged into your switches and routers - phones, printers, cameras, laptops - read from their address tables. Nothing is removed on its own: Last Seen says when each was last there.",
    );
  });

  test("the Overview's Endpoints tile says the same when there are none", () => {
    expect(OVERVIEW).toContain(
      '"None yet: turn on Collect Connected Endpoints on a switch or router."',
    );
  });
});

describe("the Overview's tiles and lists go where they talk about", () => {
  function tile(title: string): string {
    const start: number = OVERVIEW.indexOf(`<InfoCard title="${title}"`);
    expect(start).toBeGreaterThan(-1);
    const end: number = OVERVIEW.indexOf("<InfoCard", start + 10);
    return OVERVIEW.slice(start, end === -1 ? undefined : end);
  }

  test("Devices opens the device list", () => {
    expect(tile("Devices")).toContain(
      "onClick={() => { Navigation.navigate( RouteUtil.populateRouteParams( RouteMap[PageMap.NETWORK_DEVICES] as Route, ), ); }}",
    );
  });

  test("Interfaces Down opens the device list filtered to devices with ports down", () => {
    expect(tile("Interfaces Down")).toContain(
      "Navigation.navigate( getDeviceListRouteForFacet(DEVICES_WITH_INTERFACES_DOWN_SELECTION), );",
    );
    expect(DEVICES_WITH_INTERFACES_DOWN_SELECTION).toEqual({
      facetKey: DEVICE_INTERFACES_FACET_KEY,
      values: [DeviceInterfacesFacetValue.SomeDown],
      operator: "is",
    });
  });

  test("the Devices list's own Interfaces Down tile filters the same way", () => {
    const tiles: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceSummaryTiles.ts",
    );

    expect(tiles).toContain("DEVICES_WITH_INTERFACES_DOWN_SELECTION");
  });

  test("Sites opens the sites, Endpoints the endpoints", () => {
    expect(tile("Sites")).toContain("RouteMap[PageMap.NETWORK_SITES] as Route");
    expect(tile("Endpoints")).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route",
    );
  });

  test("a recent scan is a link to Discovery, where its results are", () => {
    expect(OVERVIEW).toMatch(
      /<AppLink key=\{scan\._id\?\.toString\(\)\} to=\{RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.NETWORK_DEVICE_DISCOVERY\] as Route, \)\}/,
    );
  });

  test("times read in the reader's language, and a scan's status is translated", () => {
    expect(OVERVIEW).not.toContain("OneUptimeDate.fromNow(");
    expect(OVERVIEW.match(/formatRelativeTime\(\{/g)?.length).toBe(2);
    expect(OVERVIEW).toContain("language: translator.language,");
    expect(OVERVIEW).toContain("{translator.translateText(status) || status}");
  });
});

describe("a page with nothing on it draws nothing it cannot fill", () => {
  test("the device and site tile strips hide while there is nothing to count", () => {
    expect(
      readCode("Components", "NetworkDevice", "DeviceSummaryCards.tsx"),
    ).toContain("if (hasError || (counts && counts.totalDevices === 0)) {");
    expect(
      readCode("Components", "NetworkSite", "SiteSummaryCards.tsx"),
    ).toContain("if (hasError || (counts && counts.totalSites === 0)) {");
  });

  test("an empty map is one small card that says how to put devices on it", () => {
    const live: string = readCode(
      "Components",
      "Topology",
      "NetworkTopologyLiveView.tsx",
    );
    const graph: string = readCode(
      "Components",
      "Topology",
      "NetworkDeviceGraph.tsx",
    );

    expect(live).toContain(
      "!isLoading && !error && topology.nodes.length === 0",
    );
    expect(live).toContain("<NetworkTopologyEmptyState");
    expect(graph).toContain("<NetworkTopologyEmptyState");
  });

  test("the explorer leaves out its note about the map while the map is empty", () => {
    const explorer: string = readCode(
      "Components",
      "Topology",
      "NetworkTopologyExplorer.tsx",
    );

    expect(explorer).toContain("onNodeCountChange={setFlatMapNodeCount}");
    expect(explorer).toContain("flatMapNodeCount !== 0");
  });

  test("Discovery's live status shows once there is a scan to report on", () => {
    expect(readCode("Pages", "NetworkDevice", "Discovery.tsx")).toContain(
      "liveUpdates.lastRefreshedAt && (liveUpdates.loadedRowCount > 0 || liveUpdates.error) ? (",
    );
    expect(
      readCode("Components", "NetworkDevice", "useDiscoveryScanLiveUpdates.ts"),
    ).toContain("loadedRowCount: rows.length,");
  });

  test("a site card with no devices in it says so, once", () => {
    const card: string = readCode("Components", "NetworkSite", "SiteCard.tsx");

    expect(card).not.toContain('"No unit rollup yet"');
    expect(card).toContain('"Nothing reporting yet: no devices or sites in it."');
  });
});

describe("words that say what they mean", () => {
  test("a site with no parent is at the top level, wherever its parent is shown", () => {
    for (const parts of [
      ["Pages", "NetworkSite", "Sites.tsx"],
      ["Pages", "NetworkSite", "View", "Settings.tsx"],
      ["Pages", "NetworkSite", "View", "Index.tsx"],
    ]) {
      const code: string = readCode(...parts);

      expect({ parts, says: code.includes('translateText("Top level")') }).toEqual(
        { parts, says: true },
      );
      expect(code).not.toContain('translateText("Root")');
      expect(code).not.toContain('translateText("Root site")');
    }
  });

  test("a new site's name is offered a place anyone has, not a store number", () => {
    const sites: string = readCode("Pages", "NetworkSite", "Sites.tsx");
    const childSites: string = readCode(
      "Pages",
      "NetworkSite",
      "View",
      "ChildSites.tsx",
    );

    expect(sites).toContain('placeholder: "London office",');
    expect(sites).not.toContain("Unit 1042");
    expect(childSites).toContain('placeholder: "Second floor",');
  });

  test("a device's details show its SNMP name and description only when they add something", () => {
    const view: string = readCode("Pages", "NetworkDevice", "View", "Index.tsx");

    expect(view).toContain("return isDifferentText(item.sysName, item.name);");
    expect(view).toContain(
      "return isDifferentText(item.sysDescr, item.description);",
    );
    expect(readCode("Pages", "NetworkDevice", "Devices.tsx")).toContain(
      "{isDifferentText(item.sysName, item.name) && (",
    );
  });

  test("the device list fits a laptop: Labels is a column you add, not one you scroll past", () => {
    const devices: string = readCode("Pages", "NetworkDevice", "Devices.tsx");
    const labels: number = devices.indexOf('title: "Labels",');

    expect(labels).toBeGreaterThan(-1);
    expect(devices.slice(labels, labels + 300)).toContain(
      "isHiddenByDefault: true,",
    );
  });

  test("the community string is optional, and its help says so", () => {
    expect(readCode("Pages", "NetworkDevice", "SnmpConfigFormFields.ts")).toContain(
      "The community string the device answers SNMP with, such as public. Leave it empty to ping the device only.",
    );
  });

  test("the latency matrix names the monitors that fill it", () => {
    expect(
      readCode("Components", "NetworkDevice", "LatencyMatrixGrid.tsx"),
    ).toContain(
      "It fills in once a monitor that checks from a probe, such as a Ping, Port or Website monitor, has run.",
    );
  });

  test("Device Links says to draw only the cables no switch reports", () => {
    expect(readCode("Pages", "NetworkDevice", "Links.tsx")).toContain(
      "so draw a link here only for a cable no switch reports",
    );
  });

  test("site assignment rules say what they do, and what a hand-placed device does", () => {
    const rules: string = readCode("Pages", "NetworkSite", "AssignmentRules.tsx");

    expect(rules).toContain('title: "Site Assignment Rules",');
    expect(rules).toContain(
      "A device you put in a site by hand stays there until its address or name changes.",
    );
    expect(rules).toContain("Run Now applies a rule to the devices you already have.");
  });

  test("the map of sites says what a click does", () => {
    expect(readCode("Pages", "NetworkSite", "NetworkMap.tsx")).toContain(
      '"Click a site to open it."',
    );
  });

  test("the device map's legend is translated as one sentence", () => {
    const live: string = readCode(
      "Components",
      "Topology",
      "NetworkTopologyLiveView.tsx",
    );

    expect(live).toContain('translateString("Read the map:")');
    expect(live).toContain(
      '"devices are nodes, lines are network connections, and the numbers on a device are its ports up / down."',
    );
  });

  test("the scan's credentials step says what the list is", () => {
    const discovery: string = readCode("Pages", "NetworkDevice", "Discovery.tsx");

    expect(discovery).toContain('title: "Credentials to try",');
    expect(discovery).toContain(
      "The scan tries these in order on every host that answers ping, and keeps the first that works.",
    );
    expect(discovery).not.toContain('title: "SNMP Configs"');
  });
});

describe("isDifferentText", () => {
  test("a value worth its own row: present, and not the words already shown", () => {
    expect(isDifferentText("core-sw1.example.com", "Core switch")).toBe(true);
  });

  test("the same words, in any case or spacing around them, are shown once", () => {
    expect(isDifferentText("core-sw1", "core-sw1")).toBe(false);
    expect(isDifferentText("CORE-SW1 ", " core-sw1")).toBe(false);
  });

  test("nothing, or only spaces, is not a row", () => {
    expect(isDifferentText(undefined, "core-sw1")).toBe(false);
    expect(isDifferentText(null, "core-sw1")).toBe(false);
    expect(isDifferentText("   ", "core-sw1")).toBe(false);
  });

  test("a value beside nothing shown is a row", () => {
    expect(isDifferentText("core-sw1", undefined)).toBe(true);
    expect(isDifferentText("core-sw1", "")).toBe(true);
  });
});
