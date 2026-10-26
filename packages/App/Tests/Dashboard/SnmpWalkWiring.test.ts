import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5184: the wiring of a device's SNMP Walk page that no type checker
 * sees - the page's route, menu entry, breadcrumbs and layout; who may do
 * what on it; the ways to it from the Overview and from Settings; that it
 * never reads the device's credentials; and the monitor "Alert on it" opens.
 *
 * METHOD. As MonitorCreateNetworkDeviceDeepLink does: the App suite has no
 * React renderer, so the sources are read with comments stripped (prose can
 * never satisfy a test) and whitespace squashed (Prettier may reflow). A
 * comment starts after a space or a line break: RouteMap's wildcard paths
 * (`/monitors/*`) are not comments.
 * Rendering is covered in Common/Tests/App/Dashboard/SnmpWalkCard.test.tsx
 * and in the browser by packages/E2E/SnmpWalk.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /(^|\s)\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|\s)\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const IMPORT_SPECIFIER: RegExp = /from "([^"]+)"/g;

function readCode(...segments: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8")
    .replace(BLOCK_COMMENT, "$1 ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

const VIEW_MODEL: string = readCode(
  "Components",
  "NetworkDevice",
  "SnmpWalkViewModel.ts",
);
const CARD: string = readCode(
  "Components",
  "NetworkDevice",
  "SnmpWalkCard.tsx",
);
const RESULTS: string = readCode(
  "Components",
  "NetworkDevice",
  "SnmpWalkResults.tsx",
);
const PAGE: string = readCode("Pages", "NetworkDevice", "View", "SnmpWalk.tsx");
const CREATE_PAGE: string = readCode("Pages", "Monitor", "Create.tsx");

describe("the SNMP Walk page's place in the product", () => {
  test("has a page key, an address under the device, and a route", () => {
    expect(readCode("Utils", "PageMap.ts")).toContain(
      'NETWORK_DEVICE_VIEW_SNMP_WALK = "NETWORK_DEVICE_VIEW_SNMP_WALK"',
    );

    const routeMap: string = readCode("Utils", "RouteMap.ts");
    expect(routeMap).toContain(
      "[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK]: `${RouteParams.ModelID}/snmp-walk`",
    );
    expect(routeMap).toContain(
      "[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK]: new Route( `/dashboard/${RouteParams.ProjectID}/network-devices/${ NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] }`, )",
    );

    const routes: string = readCode("Routes", "NetworkDeviceRoutes.tsx");
    expect(routes).toContain(
      'import NetworkDeviceSnmpWalk from "../Pages/NetworkDevice/View/SnmpWalk";',
    );
    expect(routes).toContain(
      "path={RouteUtil.getLastPathForKey( PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK, )}",
    );
    expect(routes).toContain("<NetworkDeviceSnmpWalk");
  });

  test("is drawn as a device page, with the device's own menu and breadcrumbs", () => {
    expect(readCode("Pages", "Network", "Layout.tsx")).toContain(
      "PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK,",
    );
    expect(
      readCode("Pages", "NetworkDevice", "Utils", "Breadcrumbs.ts"),
    ).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK, [ "Project", "Network", "View Device", "SNMP Walk", ])',
    );
  });

  test("sits under More in the device's menu, after the SNMP tables", () => {
    const menu: string = readCode(
      "Pages",
      "NetworkDevice",
      "View",
      "SideMenu.tsx",
    );
    const more: number = menu.indexOf('<SideMenuSection title="More"');
    const tables: number = menu.indexOf('title: "SNMP Tables"');
    const walk: number = menu.indexOf('title: "SNMP Walk"');
    const wifi: number = menu.indexOf('title: "Wi-Fi"');

    expect(more).toBeGreaterThan(-1);
    expect(tables).toBeGreaterThan(more);
    expect(walk).toBeGreaterThan(tables);
    expect(wifi).toBeGreaterThan(walk);
  });

  test("is reached from the Overview's Connectivity tools card, by every reader", () => {
    const card: string = readCode(
      "Components",
      "NetworkDevice",
      "DeviceDiagnosticsCard.tsx",
    );

    expect(card).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] as Route",
    );
    expect(card).toContain(
      'template="See every OID this device answers with an {{walk}}."',
    );
    // Outside the diagnostics permission's gate: the page says what one may do.
    const gate: number = card.indexOf("props.canRunDiagnostics ?");
    const gateEnd: number = card.indexOf("<></> )}", gate);
    const link: number = card.indexOf(
      'data-testid="network-device-snmp-walk-link"',
    );
    expect(gate).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(gateEnd);
  });

  test("is reached from the device's health OIDs in Settings", () => {
    const settings: string = readCode(
      "Pages",
      "NetworkDevice",
      "View",
      "Settings.tsx",
    );
    const field: number = settings.indexOf(
      'title: "Device-Specific Health OIDs"',
    );
    const sideLink: number = settings.indexOf(
      'text: "Find OIDs with an SNMP walk"',
      field,
    );

    expect(field).toBeGreaterThan(-1);
    expect(sideLink).toBeGreaterThan(field);
    expect(settings.substring(sideLink, sideLink + 300)).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK] as Route",
    );
  });
});

describe("who may do what on the page", () => {
  test.each([
    ["canWalk", "new NetworkDeviceDiagnostic(), ModelAction.Create"],
    ["canEditDevice", "new NetworkDevice(), ModelAction.Update"],
    ["canEditTemplate", "new NetworkDeviceOidTemplate(), ModelAction.Update"],
    ["canCreateMonitor", "new Monitor(), ModelAction.Create"],
  ])(
    "%s is the permission gate's answer for %s",
    (prop: string, check: string) => {
      const at: number = PAGE.indexOf(`${prop}={`);

      expect(at).toBeGreaterThan(-1);
      expect(PAGE.substring(at, at + 200)).toContain(
        `PermissionGate.check(${check})`,
      );
    },
  );

  test("the card offers each action only to who may take it", () => {
    expect(CARD).toContain("{props.canWalk ? ( getForm() ) : (");
    expect(CARD).toContain("canCollect: props.canEditDevice && isProbePolled,");
    expect(CARD).toContain(
      "canCollectOnTemplate: props.canEditTemplate && isProbePolled && Boolean(device?.oidTemplateId),",
    );
    expect(CARD).toContain(
      "getAlertRoute: props.canCreateMonitor ? getAlertRoute : undefined,",
    );
    expect(CARD).toContain("continueAfter && props.canWalk ?");
  });
});

describe("credentials stay on the server", () => {
  /*
   * The probe is handed the device's credentials by the server when it
   * claims the walk. The page asks for the walk by device and subtree, and
   * never reads a credential column.
   */
  test.each([
    "snmpCommunityString",
    "snmpV3Username",
    "snmpV3AuthKey",
    "snmpV3PrivKey",
    "snmpV3Auth",
    "snmpCredentialProfile",
  ])("the page never reads %s", (column: string) => {
    expect(CARD).not.toContain(column);
    expect(RESULTS).not.toContain(column);
    expect(PAGE).not.toContain(column);
  });

  test("a walk is asked for with the device, the type and the subtree only", () => {
    expect(CARD).toContain(
      "diagnostic.networkDeviceId = props.networkDeviceId;",
    );
    expect(CARD).toContain(
      "diagnostic.diagnosticType = NetworkDeviceDiagnosticType.SnmpWalk;",
    );
    expect(CARD).toContain("diagnostic.snmpWalkRootOid = data.rootOid;");
    expect(CARD).toContain("diagnostic.snmpWalkAfterOid = data.afterOid;");
  });
});

describe("the view model", () => {
  /*
   * App's tests import it in plain Node: anything reading `window` at load
   * (RouteMap, ModelAPI, Navigation) would break them, and React is not
   * installed in App at all.
   */
  test("imports nothing that needs a browser or React", () => {
    const specifiers: Array<string> = Array.from(
      VIEW_MODEL.matchAll(IMPORT_SPECIFIER),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(specifiers.length).toBeGreaterThan(0);

    for (const specifier of specifiers) {
      const isAllowed: boolean =
        specifier.startsWith("Common/Types/") ||
        specifier.startsWith("Common/Utils/") ||
        specifier === "Common/UI/Utils/TranslateTemplate";

      expect({ specifier, isAllowed }).toEqual({ specifier, isAllowed: true });
    }
  });
});

describe("Alert on it opens a monitor on the OID", () => {
  test("the create page reads the OID, its type and value through the shared parser", () => {
    expect(CREATE_PAGE).toContain(
      'const walkedOid: SnmpWalkAlertPrefill | null = parseSnmpWalkAlertQuery({ snmpOid: Navigation.getQueryStringByName("snmpOid"), snmpOidType: Navigation.getQueryStringByName("snmpOidType"), snmpOidValue: Navigation.getQueryStringByName("snmpOidValue"), });',
    );
  });

  /*
   * The check and the description come from the prefill too: a counter is
   * alerted on by its rate (SNMP OID Rate (per second)), with words that
   * say so, not by its raw value.
   */
  test("an OID replaces the recommended pack with its one criteria, on the check its type is alerted on", () => {
    expect(CREATE_PAGE).toContain(
      "const recommendedCriteria: Array<MonitorCriteriaInstance> = walkedOid ? [ NetworkDeviceAlertPackUtil.buildOidValueCriteriaInstance({ oid: walkedOid.oid, name: walkedOid.oidName, checkOn: walkedOid.checkOn, filterType: walkedOid.filterType, value: walkedOid.value, description: walkedOid.description, }), ] : NetworkDeviceAlertPackUtil.buildCriteriaInstances({",
    );
  });

  test("the monitor is named after the device and the OID", () => {
    expect(CREATE_PAGE).toContain(
      'translator.translateTemplate("{{deviceName}}: {{oidName}}", {',
    );
    expect(CREATE_PAGE).toContain(
      '"Alerts on {{oidName}} of the {{deviceName}} network device."',
    );
  });

  test("the OID is read only inside the Network Device branch, after the monitor-backed one", () => {
    const branch: number = CREATE_PAGE.indexOf(
      "await preSeedPingMonitorForMonitorBackedDevice({",
    );
    const read: number = CREATE_PAGE.indexOf("parseSnmpWalkAlertQuery({");

    expect(branch).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(branch);
  });
});
