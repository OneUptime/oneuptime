import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5775: every device discovery has seen, on one page reachable from
 * the topology map, added to monitoring through the discovery import and
 * hidden from the map many at a time - never deleting a monitored device
 * or its monitoring.
 *
 * The decisions worth defending here are wiring: which page draws the list,
 * which permission locks which action, that the map's Show them is one
 * request, that a bulk hide asks first, and that adding goes through the
 * import (so a duplicate is refused there, with why). The App suite has no
 * renderer, so the relationships are pinned against the sources, the way
 * AddNeighborToMonitoringWiring pins the neighbour's. The rules these files
 * wire together are tested on their own in DiscoveredDeviceItems.test.ts,
 * and the page renders in Common's DiscoveredDevicesTable suite.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

/*
 * Comments are stripped before anything is matched: an assertion about the
 * code has to read the code rather than the commentary describing it.
 */
function readCode(...relativeParts: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const FOLDER: Array<string> = [
  "Components",
  "NetworkDevice",
  "DiscoveredDevices",
];

const TABLE: string = readCode(...FOLDER, "DiscoveredDevicesTable.tsx");
const DIALOG: string = readCode(...FOLDER, "AddDiscoveredDevicesDialog.tsx");
const COUNT_HOOK: string = readCode(...FOLDER, "useDiscoveredDeviceCount.ts");
const LIVE_VIEW: string = readCode(
  "Components",
  "Topology",
  "NetworkTopologyLiveView.tsx",
);
const PANEL: string = readCode(
  "Components",
  "Topology",
  "NetworkDeviceDetailPanel.tsx",
);
const IMPORT_DIALOG: string = readCode(
  "Components",
  "NetworkDevice",
  "DiscoveryImport",
  "DiscoveryImportDialog.tsx",
);

describe("the pages", () => {
  test("the network's page and a site's draw the one list, the site's scoped to it", () => {
    expect(readCode("Pages", "NetworkDevice", "Endpoints.tsx")).toContain(
      "<DiscoveredDevicesTable />",
    );

    const sitePage: string = readCode(
      "Pages",
      "NetworkSite",
      "View",
      "Endpoints.tsx",
    );

    expect(sitePage).toContain(
      "const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);",
    );
    expect(sitePage).toContain(
      "<DiscoveredDevicesTable siteId={modelId.toString()} />",
    );
  });

  test("the menus, breadcrumbs and search name it Discovered Devices, at the address Endpoints had", () => {
    const networkMenu: string = readCode(
      "Components",
      "Network",
      "NetworkSideMenu.tsx",
    );
    const siteMenu: string = readCode(
      "Pages",
      "NetworkSite",
      "View",
      "SideMenu.tsx",
    );

    expect(networkMenu).toMatch(
      /title: "Discovered Devices", to: RouteUtil\.populateRouteParams\( RouteMap\[PageMap\.NETWORK_DEVICE_ENDPOINTS\] as Route,? \)/,
    );
    expect(siteMenu).toContain('title: "Discovered Devices"');
    expect(siteMenu).toContain("PageMap.NETWORK_SITE_VIEW_ENDPOINTS");
    expect(networkMenu).not.toContain('title: "Endpoints"');
    expect(siteMenu).not.toContain('title: "Endpoints"');

    expect(
      readCode("Pages", "NetworkDevice", "Utils", "Breadcrumbs.ts"),
    ).toContain('"Project", "Network", "Topology", "Discovered Devices",');
    expect(
      readCode("Pages", "NetworkSite", "Utils", "Breadcrumbs.ts"),
    ).toContain('"Project", "Network", "View Site", "Discovered Devices",');

    const search: string = readCode(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );

    expect(search).toContain('title: "Discovered Devices"');
    // Found by the words people used for it before, and by what it does.
    for (const keyword of [
      '"endpoints"',
      '"mac addresses"',
      '"ip addresses"',
      '"add to monitoring"',
      '"hide from map"',
    ]) {
      expect(search).toContain(keyword);
    }
  });

  test("the Overview tile and a site's hero tile say Discovered Devices too", () => {
    expect(readCode("Pages", "NetworkDevice", "Overview.tsx")).toContain(
      'title="Discovered Devices"',
    );
    expect(
      readCode("Components", "NetworkSite", "SiteStatusHero.tsx"),
    ).toContain(
      'title="Discovered Devices" description={NETWORK_SITE_METRIC_DESCRIPTIONS.endpoints}',
    );
  });
});

describe("the list", () => {
  test("opens on the devices not monitored, which is what a reader comes to act on", () => {
    expect(TABLE).toMatch(
      /useState<DiscoveredDeviceShow>\( DiscoveredDeviceShow\.NotMonitored,? \)/,
    );
  });

  test("searches on the server, a moment after the reader stops typing", () => {
    expect(TABLE).toContain(
      "export const DISCOVERED_DEVICE_SEARCH_DEBOUNCE_MS: number = 300;",
    );
    expect(TABLE).toContain("listDiscoveredDevices(");
  });

  test("a selection belongs to the rows it was made over: a new search, choice or site clears it", () => {
    expect(TABLE).toContain(
      "useEffect(() => { setCurrentPageNumber(1); clearSelection(); }, [debouncedSearch, show, props.siteId]);",
    );
    expect(TABLE).toMatch(/onBulkActionEnd=\{\(\) => \{ clearSelection\(\);/);
  });

  test("locks each action on the permission it needs", () => {
    expect(TABLE).toContain(
      "const addGate: PermissionGateResult = PermissionGate.check( new NetworkDevice(), ModelAction.Create, );",
    );
    expect(TABLE).toContain(
      "const hideGate: PermissionGateResult = PermissionGate.check( new NetworkTopologySuppression(), ModelAction.Create, );",
    );
    expect(TABLE).toContain(
      "const showGate: PermissionGateResult = PermissionGate.check( new NetworkTopologySuppression(), ModelAction.Delete, );",
    );
    expect(TABLE).toContain(
      "const editGate: PermissionGateResult = PermissionGate.check( new NetworkEndpoint(), ModelAction.Update, );",
    );
    expect(TABLE).toContain(
      "const deleteGate: PermissionGateResult = PermissionGate.check( new NetworkEndpoint(), ModelAction.Delete, );",
    );
    expect(TABLE.match(/\.\.\.lockFor\(addGate\)/g)).toHaveLength(2);
    expect(TABLE.match(/\.\.\.lockFor\(hideGate\)/g)).toHaveLength(2);
    expect(TABLE.match(/\.\.\.lockFor\(showGate\)/g)).toHaveLength(2);
  });

  test("Hide from map asks first, and says monitored devices and their monitoring are never changed", () => {
    const start: number = TABLE.indexOf(
      "title: DISCOVERED_DEVICES_COPY.hideFromMap,",
    );
    const block: string = TABLE.slice(start, start + 1600);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain("confirmTitle:");
    expect(block).toContain("confirmMessage:");
    expect(block).toContain(
      "Nothing is deleted: monitored devices and their monitoring are never changed, and Show on map brings them back.",
    );
    expect(block).toContain(
      "Nothing is deleted: a monitored device and its monitoring are never changed, and Show on map brings it back.",
    );
  });

  test("a bulk hide or show is one request for the whole selection, read by every row", () => {
    expect(TABLE).toContain(
      "concurrency: Math.max(1, actionProps.items.length), isStoppable: false,",
    );
    expect(TABLE).toContain("if (!request) { request = changeMap(");
    expect(TABLE).toContain(".then(indexMapChange);");
    // A row the answer does not name is a failure, never a success.
    expect(TABLE).toContain("throw new Error(outcome.reason);");
  });

  test("Add to monitoring opens the import dialog, for a selection or one row", () => {
    const start: number = TABLE.indexOf(
      "title: DISCOVERED_DEVICES_COPY.addToMonitoring,",
    );
    const block: string = TABLE.slice(start, start + 600);

    expect(block).toContain("opensItsOwnDialog: true,");
    expect(block).toContain("setDialogDevices([...actionProps.items]);");
    expect(TABLE).toContain("setDialogDevices([item]);");
    expect(TABLE).toContain("<AddDiscoveredDevicesDialog");
  });

  test("a row with no address offers Add to monitoring locked, saying why", () => {
    expect(TABLE).toContain(
      "return canAddToMonitoring(item) ? undefined : translator.translateText(DISCOVERED_DEVICES_COPY.noAddressYet);",
    );
  });

  test("deleting a row asks first, and says a monitored device is not changed", () => {
    expect(TABLE).toContain(
      "getConfirmation: (item: DiscoveredDeviceItem) => {",
    );
    expect(TABLE).toContain(
      '"It leaves this list until a switch, router or network controller reports it again. A monitored device and its monitoring are not changed."',
    );
  });

  test("selects every matching row through the server, and never exports a partial selection as CSV", () => {
    expect(TABLE).toContain("await selectAllDiscoveredDevices({");
    expect(TABLE).toContain("isBulkSelectionTruncated={isSelectionTruncated}");
    expect(TABLE).toContain("disableBulkCsvExport={true}");
  });

  /*
   * A raw Table draws a row's own actions only in a column of their own -
   * without it, Add to monitoring, View device and the ⋯ menu are not drawn
   * at all, and nothing fails to say so.
   */
  test("the rows' own actions have their column", () => {
    expect(TABLE).toContain("actionButtons={actionButtons}");
    expect(TABLE).toMatch(
      /\{ title: "Actions", type: FieldType\.Actions, key: null, disableSort: true, disableCsvExport: true, \}/,
    );
  });

  test("the running imports of the list are shown on it, and can be reopened", () => {
    expect(TABLE).toContain("activeImports.fromDiscoveredDevices");
    expect(TABLE).toContain('data-testid="discovered-devices-running-imports"');
  });
});

describe("the Add to monitoring dialog", () => {
  test("is the discovery import's own Monitoring step, for devices from the list", () => {
    expect(DIALOG).toContain("<DiscoveryImportMonitoringStep");
    expect(DIALOG).toContain(
      "source={DiscoveryImportSource.DiscoveredDevices}",
    );
    expect(DIALOG).toContain("startDiscoveredDeviceImport(");
  });

  test("makes the monitor template the way a scan's import does", () => {
    expect(DIALOG).toContain("resolveImportMonitorTemplateId(");
    expect(IMPORT_DIALOG).toContain("resolveImportMonitorTemplateId(");
  });

  test("adds only what the plan adds, and names what it leaves out", () => {
    expect(DIALOG).toContain("getAddToMonitoringPlan(");
    expect(DIALOG).toContain(
      'data-testid="discovered-device-import-monitored"',
    );
    expect(DIALOG).toContain(
      'data-testid="discovered-device-import-no-address"',
    );
  });

  test("the scan import dialog still hands out the scroll helper the scans page reads", () => {
    expect(IMPORT_DIALOG).toContain("export { scrollToTopOfScroller };");
  });
});

describe("the topology map", () => {
  test("offers the list a click away, with how many are not monitored, to a reader who may read it", () => {
    expect(LIVE_VIEW).toContain(
      "const canReadDiscoveredDevices: boolean = PermissionGate.check( new NetworkEndpoint(), ModelAction.Read, ).isAllowed;",
    );
    expect(LIVE_VIEW).toContain("...(canReadDiscoveredDevices ? [");
    expect(LIVE_VIEW).toContain(
      'translator.translateTemplate( "Discovered Devices ({{count}})", { count: translator.formatNumber(discoveredCount) }, )',
    );
    expect(LIVE_VIEW).toMatch(
      /props\.siteId \? RouteUtil\.populateRouteParams\( RouteMap\[ ?PageMap\.NETWORK_SITE_VIEW_ENDPOINTS ?\] as Route, \{ modelId: new ObjectID\(props\.siteId\) \},? \) : RouteUtil\.populateRouteParams\( RouteMap\[ ?PageMap\.NETWORK_DEVICE_ENDPOINTS ?\] as Route,? \)/,
    );
  });

  test("the count is the not-monitored one, read with a page of one", () => {
    expect(COUNT_HOOK).toContain("limit: 1,");
    expect(COUNT_HOOK).toContain("show: DiscoveredDeviceShow.NotMonitored,");
    expect(COUNT_HOOK).toContain("counts.notMonitored");
  });

  test("Show them is one request, not one per hidden node", () => {
    const start: number = LIVE_VIEW.indexOf(
      "const restoreAllHiddenNodes: () => void = useCallback(",
    );
    const block: string = LIVE_VIEW.slice(start, start + 700);

    expect(block).toContain("showEverythingOnMap()");
    expect(block).not.toContain("deleteItem");
    expect(LIVE_VIEW).not.toContain("LIMIT_PER_PROJECT");
  });

  test("the hidden nodes line is one sentence a language can word", () => {
    expect(LIVE_VIEW).toContain(
      'translator.translatePlural( { one: "{{count}} node is hidden from this map.", other: "{{count}} nodes are hidden from this map.", }, topology.suppressedNodeCount, )',
    );
    expect(LIVE_VIEW).not.toContain('"node is" : "nodes are"');
  });

  test("an endpoint's panel adds it through the discovery import, closing the drawer first", () => {
    expect(LIVE_VIEW).toContain(
      "const selectedEndpoint: DiscoveredDeviceItem | null = selectedNode ? getDiscoveredDeviceItemForNode(selectedNode) : null;",
    );
    expect(LIVE_VIEW).toContain(
      ": canCreateDevice && selectedEndpoint ? () => { setSelectedNodeId(null); setEndpointToAdd(selectedEndpoint); } : undefined",
    );
    expect(LIVE_VIEW).toContain(
      "{endpointToAdd ? ( <AddDiscoveredDevicesDialog",
    );
    expect(LIVE_VIEW).toContain(
      "key={endpointToAdd.id} devices={[endpointToAdd]}",
    );
  });

  test("after an add the map is read again in the background, so the viewport stays", () => {
    const start: number = LIVE_VIEW.indexOf("<AddDiscoveredDevicesDialog");
    const block: string = LIVE_VIEW.slice(start, start + 900);

    expect(block).toContain("fetchTopology(true)");
    expect(block).not.toContain("fetchTopology(false)");
  });

  test("a hide, a show and an add read the count again", () => {
    expect(
      LIVE_VIEW.match(
        /setDiscoveredCountKey\(\(key: number\): number => \{ return key \+ 1; \}\);/g,
      ),
    ).toHaveLength(3);
  });
});

describe("the detail panel", () => {
  test("names the node's address beside its kind, isolated for right-to-left sentences", () => {
    expect(PANEL).toContain(
      "return `${data.kindText} · \\u2068${ipAddress}\\u2069`;",
    );
    expect(PANEL).toContain(
      "description={getNodeSubtitle({ kindText: kindText, name: node.name, ipAddress: node.ipAddress, })}",
    );
  });

  test("tells an endpoint what adding it does", () => {
    expect(PANEL).toContain('data-testid="network-topology-not-monitored"');
    expect(PANEL).toContain(
      "OneUptime does not monitor this device yet. Add it to check it on a schedule, and pick who hears when it stops answering.",
    );
  });
});
