import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Names on the Traffic pages (issue #5340), wired: where the names people
 * give addresses are kept (Network > Settings > Address Names), how a
 * Traffic page reaches them ("Name this address" on the address card), and
 * that every card that lists flow addresses is handed the page's names.
 * App's node test environment cannot render the pages, so the wiring is
 * pinned as comment-stripped, whitespace-squashed source; what they DO is
 * rendered in Common/Tests/App/Dashboard and the NetworkTrafficNames
 * offline suite.
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
 * The route files hold wildcard routes ("/monitors/*") that read as the
 * start of a comment: they are squashed with their comments left in.
 */
function readRoutes(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(WHITESPACE, " ");
}

describe("Network > Settings > Address Names", () => {
  test("is a page of its own at network-devices/settings/address-names", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES = "NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES",',
    );

    const routes: string = readRoutes("Utils/RouteMap.ts");

    expect(routes).toContain(
      "[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES]: `settings/address-names`,",
    );
    expect(routes).toContain(
      "[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES]: new Route( `/dashboard/${RouteParams.ProjectID}/network-devices/${ NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES] }`, ),",
    );
    expect(readRoutes("Routes/NetworkDeviceRoutes.tsx")).toContain(
      '<NetworkDeviceSettingsAddressNames {...props} pageRoute={ RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES] as Route } />',
    );
  });

  test("sits in the Network menu's Settings, after the vocabularies devices are sorted by", () => {
    const menu: string = readCode("Components/Network/NetworkSideMenu.tsx");
    const siteTypes: number = menu.indexOf('title: "Site Types",');
    const addressNames: number = menu.indexOf('title: "Address Names",');
    const oidTemplates: number = menu.indexOf('title: "OID Collection Templates",');

    expect(siteTypes).toBeGreaterThan(-1);
    expect(addressNames).toBeGreaterThan(siteTypes);
    expect(oidTemplates).toBeGreaterThan(addressNames);
    expect(menu).toContain(
      "RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES] as Route, ), }, icon: IconProp.Label,",
    );
  });

  test("has its breadcrumbs and is found from the search palette by the words people use", () => {
    expect(readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles( PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES, ["Project", "Network", "Settings", "Address Names"], )',
    );

    const search: string = readCode(
      "Components/CommandPalette/PageSearchIndex.ts",
    );
    const start: number = search.indexOf(
      "page: PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES,",
    );
    const entry: string = search.slice(start, search.indexOf("}", start));

    expect(start).toBeGreaterThan(-1);
    expect(entry).toContain('title: "Address Names",');
    for (const keyword of ["ip names", "subnet names", "hostnames"]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("lists the names with the shared form, searchable by name and by address", () => {
    const page: string = readCode(
      "Pages/NetworkDevice/Settings/AddressNames.tsx",
    );

    expect(page).toContain("modelType={NetworkAddressName}");
    expect(page).toContain("formFields={getNetworkAddressNameFormFields()}");
    expect(page).toContain('searchableFields={["name", "address"]}');
    expect(page).toContain("isCreateable={true}");
    expect(page).toContain("isEditable={true}");
    expect(page).toContain("isDeleteable={true}");
    // An address reads left to right in every language, as on the Traffic pages.
    expect(page).toContain("<TrafficAddressText");
  });
});

describe("a Traffic page hands its names to everything that lists an address", () => {
  const view: string = readCode(
    "Components/NetworkTraffic/NetworkTrafficView.tsx",
  );

  test("the top lists and the conversations draw names through the shared parts", () => {
    expect(view).toContain("label: <TrafficAddressPrimary label={label} />,");
    expect(view).toContain(
      "sublabel: getTrafficAddressSecondary(label) || undefined,",
    );
    expect(view).toContain("<TrafficAddressPair");
  });

  test("the diagram, the senders card and the address card are given the page's names", () => {
    expect(view).toContain("addressNames={summary.addressNames}");
    expect(
      view.split("addressNames={summary.addressNames}").length - 1,
    ).toBeGreaterThanOrEqual(2);
    expect(view).toContain("<TrafficAddressCard label={labelOf(filteredAddress)}");
  });

  test("find takes a name or an address, and asks the server only for a name", () => {
    expect(view).toContain("findNetworkTrafficAddress(request)");
    expect(view).toContain('"Find a name or an IP address"');
    expect(view).not.toContain('"Find an IP address"');
  });

  test("naming is for who may add Address Names, renaming for who may change them", () => {
    expect(view).toContain(
      "PermissionGate.check( new NetworkAddressName(), ModelAction.Create,",
    );
    expect(view).toContain(
      "PermissionGate.check( new NetworkAddressName(), ModelAction.Update,",
    );
  });
});
