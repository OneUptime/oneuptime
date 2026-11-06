import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5548: the wiring of the Network's SNMP Walk page that no type
 * checker sees - its route, its place under Advanced in the Network menu
 * and in Search, its breadcrumbs; the ways to it from the Devices list and
 * from an OID on a device's own SNMP Walk page; who may do what on it; that
 * it keeps the walk in its address without adding to the browser's history;
 * and that it never reads a device's credentials.
 *
 * METHOD. As SnmpWalkWiring does: the App suite has no React renderer, so
 * the sources are read with comments stripped (prose can never satisfy a
 * test) and whitespace squashed (Prettier may reflow). A comment starts
 * after a space or a line break: RouteMap's wildcard paths (`/monitors/*`)
 * are not comments. Rendering is covered in
 * Common/Tests/App/Dashboard/MultiDeviceSnmpWalkCard.test.tsx.
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
  "MultiDeviceSnmpWalkViewModel.ts",
);
const CARD: string = readCode(
  "Components",
  "NetworkDevice",
  "MultiDeviceSnmpWalkCard.tsx",
);
const RESULTS: string = readCode(
  "Components",
  "NetworkDevice",
  "MultiDeviceSnmpWalkResults.tsx",
);
const ROUTE: string = readCode(
  "Components",
  "NetworkDevice",
  "MultiDeviceSnmpWalkRoute.ts",
);
const BULK_ACTION: string = readCode(
  "Components",
  "NetworkDevice",
  "useBulkSnmpWalk.tsx",
);
const PAGE: string = readCode("Pages", "NetworkDevice", "SnmpWalk.tsx");
const DEVICE_LIST: string = readCode("Pages", "NetworkDevice", "Devices.tsx");
const DEVICE_WALK_CARD: string = readCode(
  "Components",
  "NetworkDevice",
  "SnmpWalkCard.tsx",
);
const DEVICE_WALK_RESULTS: string = readCode(
  "Components",
  "NetworkDevice",
  "SnmpWalkResults.tsx",
);

describe("the Network's SNMP Walk page's place in the product", () => {
  test("has a page key, an address of its own in the Network area, and a route", () => {
    expect(readCode("Utils", "PageMap.ts")).toContain(
      'NETWORK_SNMP_WALK = "NETWORK_SNMP_WALK"',
    );

    const routeMap: string = readCode("Utils", "RouteMap.ts");

    expect(routeMap).toContain("[PageMap.NETWORK_SNMP_WALK]: `snmp-walk`,");
    expect(routeMap).toContain(
      "[PageMap.NETWORK_SNMP_WALK]: new Route( `/dashboard/${RouteParams.ProjectID}/network-devices/${ NetworkDeviceRoutePath[PageMap.NETWORK_SNMP_WALK] }`, )",
    );

    const routes: string = readCode("Routes", "NetworkDeviceRoutes.tsx");

    expect(routes).toContain(
      'import NetworkSnmpWalk from "../Pages/NetworkDevice/SnmpWalk";',
    );
    expect(routes).toContain(
      'path={NetworkDeviceRoutePath[PageMap.NETWORK_SNMP_WALK] || ""}',
    );
    expect(routes).toContain(
      "<NetworkSnmpWalk {...props} pageRoute={RouteMap[PageMap.NETWORK_SNMP_WALK] as Route} />",
    );
  });

  test("is not a device's page: it is drawn with the Network menu, and its trail is Network's", () => {
    const layout: string = readCode("Pages", "Network", "Layout.tsx");

    expect(layout).toContain("PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK,");
    expect(layout).not.toContain("PageMap.NETWORK_SNMP_WALK,");
    expect(
      readCode("Pages", "NetworkDevice", "Utils", "Breadcrumbs.ts"),
    ).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SNMP_WALK, [ "Project", "Network", "SNMP Walk", ])',
    );
  });

  test("waits folded under Advanced in the Network menu, before Archived Devices", () => {
    const menu: string = readCode(
      "Components",
      "Network",
      "NetworkSideMenu.tsx",
    );
    const advanced: number = menu.indexOf('title: "Advanced"');
    const walk: number = menu.indexOf('title: "SNMP Walk"');
    const archived: number = menu.indexOf('title: "Archived Devices"');

    expect(advanced).toBeGreaterThan(-1);
    expect(walk).toBeGreaterThan(advanced);
    expect(archived).toBeGreaterThan(walk);
    expect(menu).toContain("RouteMap[PageMap.NETWORK_SNMP_WALK] as Route");
    // Not among what people open Network for: the open section stays short.
    expect(menu.indexOf('title: "SNMP Walk"')).toBeGreaterThan(
      menu.indexOf('title: "Discovery"'),
    );
  });

  test("is found by Search, under Advanced as in the menu", () => {
    const index: string = readCode(
      "Components",
      "CommandPalette",
      "PageSearchIndex.ts",
    );
    const network: number = index.indexOf(
      "page: PageMap.NETWORK_DEVICE_ARCHIVED",
    );
    const walk: number = index.indexOf("page: PageMap.NETWORK_SNMP_WALK");

    expect(walk).toBeGreaterThan(-1);
    expect(network).toBeGreaterThan(walk);
    expect(index).toContain(
      'page: PageMap.NETWORK_SNMP_WALK, title: "SNMP Walk", icon: IconProp.Search,',
    );
    expect(index).toContain('"snmpwalk"');
  });
});

describe("the ways to the page", () => {
  test("Bulk Actions on the Devices list opens it with the devices picked", () => {
    expect(DEVICE_LIST).toContain(
      'import useBulkSnmpWalk from "../../Components/NetworkDevice/useBulkSnmpWalk";',
    );
    expect(DEVICE_LIST).toContain(
      "const { bulkActions: snmpWalkBulkActions } = useBulkSnmpWalk();",
    );
    expect(DEVICE_LIST).toContain("...snmpWalkBulkActions,");

    expect(BULK_ACTION).toContain('title: "SNMP Walk"');
    expect(BULK_ACTION).toContain("icon: IconProp.Search");
    expect(BULK_ACTION).toContain(
      'Navigation.navigate( getMultiDeviceSnmpWalkRoute({ deviceIds: deviceIds, startOid: "" }), );',
    );
  });

  test("the bulk action changes nothing, so it asks nothing first, even over rows the page does not show", () => {
    expect(BULK_ACTION).toContain("opensItsOwnDialog: true");
    expect(BULK_ACTION).not.toContain("confirmMessage");
    expect(BULK_ACTION).not.toContain("updateById");
    expect(BULK_ACTION).not.toContain("runBulkAction");
  });

  test("the bulk action is locked, with why, for a reader who may not walk", () => {
    expect(BULK_ACTION).toContain(
      "PermissionGate.check( new NetworkDeviceDiagnostic(), ModelAction.Create, )",
    );
    expect(BULK_ACTION).toContain(
      "disabled: true, tooltip: walkGate.disabledReason,",
    );
  });

  test("an OID on a device's own SNMP Walk page opens it on the OID, with the device picked, for who may walk", () => {
    expect(DEVICE_WALK_RESULTS).toContain(
      'text={translator.translateText("Compare with other devices")!}',
    );
    expect(DEVICE_WALK_RESULTS).toContain(
      "if (actions.onCompareWithOtherDevices) {",
    );
    expect(DEVICE_WALK_CARD).toContain(
      "onCompareWithOtherDevices: props.canWalk ? (row: SnmpWalkRow) => { Navigation.navigate( getMultiDeviceSnmpWalkRoute({ deviceIds: [props.networkDeviceId.toString()], startOid: row.oid, }), ); } : undefined,",
    );
  });

  test("its address is built in one place, from the view model's query", () => {
    expect(ROUTE).toContain("RouteMap[PageMap.NETWORK_SNMP_WALK] as Route");
    expect(ROUTE).toContain("buildMultiDeviceSnmpWalkQuery(query)");
  });
});

describe("who may do what on the page", () => {
  test("walking needs the diagnostic create permission, collecting the device's or the template's update permission", () => {
    expect(PAGE).toContain(
      "canWalk={ PermissionGate.check(new NetworkDeviceDiagnostic(), ModelAction.Create) .isAllowed }",
    );
    expect(PAGE).toContain(
      "canEditDevice={ PermissionGate.check(new NetworkDevice(), ModelAction.Update).isAllowed }",
    );
    expect(PAGE).toContain(
      "canEditTemplate={ PermissionGate.check(new NetworkDeviceOidTemplate(), ModelAction.Update) .isAllowed }",
    );
  });

  test("each action is hidden from who may not take it", () => {
    expect(CARD).toContain("{props.canWalk ? ( getForm() ) : (");
    expect(CARD).toContain("canCollect={props.canEditDevice}");
    expect(CARD).toContain("canCollectOnTemplate={props.canEditTemplate}");
    expect(RESULTS).toContain(
      "const canCollect: boolean = props.canCollect && collect.collectableDeviceIds.length > 0;",
    );
    expect(RESULTS).toContain("if (props.canCollectOnTemplate) {");
  });
});

describe("the walk in the page's address", () => {
  test("is read from the address once, through the view model's parser", () => {
    expect(PAGE).toContain(
      "parseMultiDeviceSnmpWalkQuery({ devices: Navigation.getQueryStringByName( MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM, ), oid: Navigation.getQueryStringByName(MULTI_DEVICE_SNMP_WALK_OID_PARAM), })",
    );
  });

  test("is written in place when a walk starts, never pushed onto the browser's history", () => {
    expect(PAGE).toContain("Navigation.setQueryString({");
    expect(PAGE).not.toContain("Navigation.navigate(");
    expect(CARD).toContain(
      "props.onQueryChange?.({ deviceIds: ids, startOid: rootOid });",
    );
  });
});

describe("what the page reads and writes", () => {
  test("never reads a device's credentials: the server hands them to the probe that walks", () => {
    for (const column of [
      "snmpCommunityString",
      "snmpV3Username",
      "snmpV3AuthKey",
      "snmpV3PrivKey",
      "snmpCredentialProfile",
    ]) {
      expect(CARD).not.toContain(column);
      expect(RESULTS).not.toContain(column);
      expect(VIEW_MODEL).not.toContain(column);
    }
  });

  test("asks for each walk as a device's own page does: the device, the type and where to start", () => {
    expect(CARD).toContain(
      "diagnostic.networkDeviceId = new ObjectID(deviceId);",
    );
    expect(CARD).toContain(
      "diagnostic.diagnosticType = NetworkDeviceDiagnosticType.SnmpWalk;",
    );
    expect(CARD).toContain("diagnostic.snmpWalkRootOid = rootOid;");
    // A walk of many devices is always a fresh one; a device's page continues it.
    expect(CARD).not.toContain("diagnostic.snmpWalkAfterOid");
    // The server picks the probe and the address from the device.
    expect(CARD).not.toContain("diagnostic.probe");
    expect(CARD).not.toContain("diagnostic.hostname");
  });

  test("a read that finds every walk still on its way leaves the comparison as it is", () => {
    expect(CARD).toContain(
      "const hasChanged: boolean = next.some( (walk: DeviceWalk, index: number): boolean => { return walk !== walksRef.current[index]; }, );",
    );
    expect(CARD).toContain("if (hasChanged) { setWalks(next); }");
  });

  test("reads every walk still on its way in one request, never one request a device", () => {
    expect(CARD).toContain(
      "_id: new Includes( waiting.map((walk: DeviceWalk): string => { return walk.diagnosticId!; }), ),",
    );
    expect(CARD).not.toContain("modelAPI.getItem<NetworkDeviceDiagnostic>");
  });

  test("collects an OID on a device's own list, or its template's - never by replacing either", () => {
    expect(CARD).toContain(
      "snmpOids: addWalkedOid( current.snmpOids as Array<SnmpOid> | undefined, row.oid, ) as unknown as JSONArray,",
    );
    expect(CARD).toContain(
      "oids: addWalkedOid( template?.oids as Array<SnmpOid> | undefined, row.oid, ) as unknown as JSONArray,",
    );
  });
});

describe("the view model stays pure", () => {
  test("imports no React, no browser and no API: App's tests load it in plain Node", () => {
    const imports: Array<string> = Array.from(
      VIEW_MODEL.matchAll(IMPORT_SPECIFIER),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier).not.toBe("react");
      expect(specifier).not.toContain("ModelAPI");
      expect(specifier).not.toContain("Navigation");
      expect(specifier).not.toContain("RouteMap");
      expect(specifier).not.toContain("Common/UI/Components");
    }

    expect(VIEW_MODEL).not.toContain("window.");
    expect(VIEW_MODEL).not.toContain("document.");
  });

  test("the address's route lives apart from the view model, which never reads RouteMap", () => {
    expect(ROUTE).toContain('from "./MultiDeviceSnmpWalkViewModel"');
    expect(VIEW_MODEL).not.toContain("PageMap");
  });
});
