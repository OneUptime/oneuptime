import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where the Events pages live: the network's (Network -> Events) and a
 * device's (its Events tab, beside Traffic and Logs). App's node test
 * environment cannot render the pages, so their wiring - routes, menus,
 * breadcrumbs, the search palette, and the link from Create Monitor - is
 * pinned as comment-stripped, whitespace-squashed source; what they DO is
 * rendered in Common/Tests/App/Dashboard.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

/*
 * The route map holds paths such as `/*`, which a comment stripper takes
 * for the start of a comment: it is read whole, whitespace squashed only.
 */
function readWhole(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(WHITESPACE, " ");
}

describe("the network's Events page", () => {
  test("is a page of its own at network-devices/events", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'NETWORK_EVENTS = "NETWORK_EVENTS",',
    );
    expect(readCode("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_EVENTS]: `events`,",
    );
    expect(readWhole("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_EVENTS]: new Route( `/dashboard/${RouteParams.ProjectID}/network-devices/${ NetworkDeviceRoutePath[PageMap.NETWORK_EVENTS] }`, ),",
    );
    expect(readCode("Routes/NetworkDeviceRoutes.tsx")).toContain(
      'path={NetworkDeviceRoutePath[PageMap.NETWORK_EVENTS] || ""} element={ <NetworkEvents {...props} pageRoute={RouteMap[PageMap.NETWORK_EVENTS] as Route} /> }',
    );
  });

  test("is not taken for a device's page: the word is matched before a device's id is", () => {
    /*
     * `events` and `:id` are both one segment under network-devices. The
     * word's route is declared before the device's, like `traffic`.
     */
    const routes: string = readCode("Routes/NetworkDeviceRoutes.tsx");
    const events: number = routes.indexOf(
      "NetworkDeviceRoutePath[PageMap.NETWORK_EVENTS]",
    );
    const traffic: number = routes.indexOf(
      "NetworkDeviceRoutePath[PageMap.NETWORK_TRAFFIC]",
    );
    const device: number = routes.indexOf(
      "NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_VIEW]",
    );

    expect(traffic).toBeGreaterThan(-1);
    expect(events).toBeGreaterThan(traffic);
    expect(device).toBeGreaterThan(events);
  });

  test("sits in the Network menu between Traffic and Discovery, open on arrival", () => {
    const menu: string = readCode("Components/Network/NetworkSideMenu.tsx");
    const traffic: number = menu.indexOf('title: "Traffic",');
    const events: number = menu.indexOf('title: "Events",');
    const discovery: number = menu.indexOf('title: "Discovery",');

    expect(traffic).toBeGreaterThan(-1);
    expect(events).toBeGreaterThan(traffic);
    expect(discovery).toBeGreaterThan(events);
    // Before the first folded section.
    expect(events).toBeLessThan(menu.indexOf('title: "Topology",'));
    expect(menu).toContain(
      "RouteMap[PageMap.NETWORK_EVENTS] as Route, ), }, icon: IconProp.Activity,",
    );
  });

  test("has its breadcrumbs and is found from the search palette by the words people use", () => {
    expect(readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_EVENTS, [ "Project", "Network", "Events", ])',
    );

    const search: string = readCode(
      "Components/CommandPalette/PageSearchIndex.ts",
    );
    const entry: string = search.slice(
      search.indexOf("page: PageMap.NETWORK_EVENTS,"),
      search.indexOf("page: PageMap.NETWORK_DEVICE_DISCOVERY,"),
    );

    expect(entry).toContain('title: "Events",');
    for (const keyword of [
      "syslog",
      "network events",
      "snmp traps",
      "link down",
      "interface down",
      "vpn tunnel",
      "failover",
      "device logs",
    ]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("draws the whole network's events", () => {
    expect(readCode("Pages/NetworkDevice/Events.tsx")).toContain(
      'return <NetworkEventsView scope={{ kind: "network" }} />;',
    );
  });
});

describe("a device's Events tab", () => {
  const page: string = readCode("Pages/NetworkDevice/View/Events.tsx");

  test("is a page of the device at :id/events, in the device's own layout", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'NETWORK_DEVICE_VIEW_EVENTS = "NETWORK_DEVICE_VIEW_EVENTS",',
    );
    expect(readCode("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_DEVICE_VIEW_EVENTS]: `${RouteParams.ModelID}/events`,",
    );
    expect(readWhole("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_DEVICE_VIEW_EVENTS]: new Route( `/dashboard/${RouteParams.ProjectID}/network-devices/${ NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_VIEW_EVENTS] }`, ),",
    );
    expect(readCode("Routes/NetworkDeviceRoutes.tsx")).toContain(
      "path={RouteUtil.getLastPathForKey(PageMap.NETWORK_DEVICE_VIEW_EVENTS)} element={ <NetworkDeviceEvents {...props} pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route} /> }",
    );
    // A model page: the device's header and side menu, not the Network menu.
    expect(readCode("Pages/Network/Layout.tsx")).toContain(
      "PageMap.NETWORK_DEVICE_VIEW_EVENTS,",
    );
  });

  test("is in the device's side menu between Traffic and Logs: what the device sends, then all of it", () => {
    const menu: string = readCode("Pages/NetworkDevice/View/SideMenu.tsx");
    const traffic: number = menu.indexOf('title: "Traffic",');
    const events: number = menu.indexOf('title: "Events",');
    const logs: number = menu.indexOf('title: "Logs",');

    expect(traffic).toBeGreaterThan(-1);
    expect(events).toBeGreaterThan(traffic);
    expect(logs).toBeGreaterThan(events);
    expect(menu).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route, { modelId: props.modelId }, ), }} icon={IconProp.Activity}",
    );
  });

  test("has its breadcrumbs", () => {
    expect(readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_EVENTS, [ "Project", "Network", "View Device", "Events", ])',
    );
  });

  test("draws that device's events, fresh for each device", () => {
    expect(page).toContain(
      '<NetworkEventsView key={modelId.toString()} scope={{ kind: "device", networkDeviceId: modelId.toString() }} device={device} />',
    );
  });

  test("reads only what the set-up guide and an alert's name need: the name, the addresses messages are matched by, and the probe", () => {
    expect(page).toContain(
      "select: { _id: true, name: true, hostname: true, otherAddresses: true, probe: { _id: true, name: true, isGlobalProbe: true, }, },",
    );
  });

  test("a device that could not be read does not take the page down", () => {
    // The events are read by the device's id; its details only dress the page.
    expect(page).toContain(".catch(() => { });");
  });
});

describe("the device's Logs tab", () => {
  const page: string = readCode("Pages/NetworkDevice/View/Logs.tsx");

  test("says what the probe listens on now: 5140 over UDP and TCP, with nothing to switch on", () => {
    expect(page).toContain("for {{syslog}} on port 5140, over UDP and TCP.");
    expect(page).not.toContain("off by default");
    expect(page).not.toContain("PROBE_SYSLOG_RECEIVER_ENABLED");
  });

  test("says how messages find the device: its hostname or one of its Other Addresses", () => {
    expect(page).toContain(
      "Messages are matched to this device by the address they come from: its hostname, or one of its Other Addresses.",
    );
  });

  test("points to the device's Events tab for what is read out of them", () => {
    expect(page).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_VIEW_EVENTS] as Route, { modelId: modelId }",
    );
  });
});

describe("Create Monitor, opened from an alert card", () => {
  const create: string = readCode("Pages/Monitor/Create.tsx");

  test("reads the alert and the device from the URL", () => {
    expect(create).toContain(
      "Navigation.getQueryStringByName( NETWORK_EVENT_ALERT_QUERY_PARAM, )",
    );
    expect(create).toContain(
      "preSeedFromNetworkEventAlert( networkEventAlertId.trim(), Navigation.getQueryStringByName( NETWORK_EVENT_DEVICE_QUERY_PARAM, )?.trim() || null, )",
    );
  });

  test("a stronger prefill wins, and the bare monitor type comes after it", () => {
    const llm: number = create.indexOf(
      "preSeedFromLlmMonitorTemplate(llmMonitorTemplateId.trim())",
    );
    const networkEvent: number = create.indexOf(
      "preSeedFromNetworkEventAlert( networkEventAlertId.trim(),",
    );
    const monitorType: number = create.indexOf(
      "const monitorTypeParam: string | null =",
    );

    expect(llm).toBeGreaterThan(-1);
    expect(networkEvent).toBeGreaterThan(llm);
    expect(monitorType).toBeGreaterThan(networkEvent);
  });

  test("the form waits for the prefill, and shows itself whether or not it could be made", () => {
    expect(create).toContain(
      "if (networkEventAlertId) { setIsLoading(true); preSeedFromNetworkEventAlert(",
    );
    expect(create).toContain(
      ").finally(() => { setIsLoading(false); }); return; } const monitorTypeParam",
    );
  });
});

describe("the Events view", () => {
  const view: string = readCode(
    "Components/NetworkEvents/NetworkEventsView.tsx",
  );

  test("reads events through the logs' own endpoints: no endpoint of its own to guard", () => {
    const api: string = readCode(
      "Components/NetworkEvents/NetworkEventsApi.ts",
    );

    expect(api).toContain(
      'export const NETWORK_EVENTS_FACETS_PATH: string = "/telemetry/logs/facets";',
    );
    expect(api).toContain("AnalyticsModelAPI.getList<Log>(options)");
    // Nothing else is asked of the server.
    expect(api.split("API.post(").length - 1).toBe(1);
    expect(api).not.toContain("API.get(");
    expect(api).not.toContain("API.put(");
    expect(api).not.toContain("API.delete(");
  });

  test("gates Create alert the way the monitor table gates its own create button", () => {
    expect(view).toContain(
      'PermissionGate.gateCardButton( { title: "Create alert",',
    );
    expect(view).toContain("new Monitor(), ModelAction.Create, )");
    // A locked button is not permission to create.
    expect(view).toContain(
      "const canCreateAlert: boolean = Boolean( createButton && !createButton.disabled, );",
    );
  });

  test("keeps its view in the URL, and drops the answer to a request it is no longer waiting for", () => {
    expect(view).toContain(
      "Navigation.setQueryString(toNetworkEventsUrlParams(next));",
    );
    expect(view).toContain(
      "const sequence: number = ++requestSequence.current;",
    );
    expect(view).toContain("if (!isCurrent()) { return; }");
  });
});
