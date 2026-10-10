import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Field from "Common/UI/Components/Forms/Types/Field";
import { MAX_OTHER_ADDRESSES } from "Common/Utils/NetworkDevice/NetworkDeviceOtherAddresses";
import {
  OTHER_ADDRESSES_FIELD_TITLE,
  OTHER_ADDRESSES_LIMIT,
  OTHER_ADDRESSES_VALIDATION_MESSAGE,
  getOtherAddressesFormField,
  validateOtherAddresses,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/OtherAddressesFormField";

/*
 * Where the Traffic pages live: the network's (Network -> Traffic), a
 * site's (its side menu) and a device's (its Traffic tab, flows first and
 * packet captures under them - issue #4601). App's node test environment
 * cannot render the pages, so their wiring - routes, menus, breadcrumbs,
 * the search palette - is pinned as comment-stripped, whitespace-squashed
 * source; what they DO is rendered in Common/Tests/App/Dashboard.
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

describe("the network's Traffic page", () => {
  test("is a page of its own at network-devices/traffic", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'NETWORK_TRAFFIC = "NETWORK_TRAFFIC",',
    );
    expect(readCode("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_TRAFFIC]: `traffic`,",
    );
    expect(readCode("Routes/NetworkDeviceRoutes.tsx")).toContain(
      'path={NetworkDeviceRoutePath[PageMap.NETWORK_TRAFFIC] || ""} element={ <NetworkTraffic {...props} pageRoute={RouteMap[PageMap.NETWORK_TRAFFIC] as Route} /> }',
    );
  });

  test("sits in the Network menu between Map and Discovery, open on arrival", () => {
    const menu: string = readCode("Components/Network/NetworkSideMenu.tsx");
    const map: number = menu.indexOf('title: "Map",');
    const traffic: number = menu.indexOf('title: "Traffic",');
    const discovery: number = menu.indexOf('title: "Discovery",');

    expect(map).toBeGreaterThan(-1);
    expect(traffic).toBeGreaterThan(map);
    expect(discovery).toBeGreaterThan(traffic);
    // Before the first folded section.
    expect(traffic).toBeLessThan(menu.indexOf('title: "Topology",'));
    expect(menu).toContain(
      "RouteMap[PageMap.NETWORK_TRAFFIC] as Route, ), }, icon: IconProp.ArrowUpDown,",
    );
  });

  test("has its breadcrumbs and is found from the search palette by the words people use", () => {
    expect(readCode("Pages/NetworkDevice/Utils/Breadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_TRAFFIC, [ "Project", "Network", "Traffic", ])',
    );

    const search: string = readCode(
      "Components/CommandPalette/PageSearchIndex.ts",
    );
    const entry: string = search.slice(
      search.indexOf("page: PageMap.NETWORK_TRAFFIC,"),
      search.indexOf("page: PageMap.NETWORK_DEVICE_DISCOVERY,"),
    );

    expect(entry).toContain('title: "Traffic",');
    for (const keyword of [
      "netflow",
      "ipfix",
      "sflow",
      "top talkers",
      "bandwidth",
    ]) {
      expect(entry).toContain(`"${keyword}"`);
    }
  });

  test("draws the whole network's traffic", () => {
    expect(readCode("Pages/NetworkDevice/Traffic.tsx")).toContain(
      'return <NetworkTrafficView scope={{ kind: "network" }} />;',
    );
  });
});

describe("a site's Traffic page", () => {
  test("is a page of the site at view/:id/traffic, in the site's own layout", () => {
    expect(readCode("Utils/PageMap.ts")).toContain(
      'NETWORK_SITE_VIEW_TRAFFIC = "NETWORK_SITE_VIEW_TRAFFIC",',
    );
    expect(readCode("Utils/RouteMap.ts")).toContain(
      "[PageMap.NETWORK_SITE_VIEW_TRAFFIC]: `view/${RouteParams.ModelID}/traffic`,",
    );
    expect(readCode("Routes/NetworkSiteRoutes.tsx")).toContain(
      "path={RouteUtil.getLastPathForKey(PageMap.NETWORK_SITE_VIEW_TRAFFIC)} element={ <NetworkSiteViewTraffic {...props} pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW_TRAFFIC] as Route} /> }",
    );
    // A model page: the site's header and side menu, not the Network menu.
    expect(readCode("Pages/Network/Layout.tsx")).toContain(
      "PageMap.NETWORK_SITE_VIEW_TRAFFIC,",
    );
  });

  test("is in the site's side menu right after Devices, with its breadcrumbs", () => {
    const menu: string = readCode("Pages/NetworkSite/View/SideMenu.tsx");

    expect(menu.indexOf('title: "Traffic",')).toBeGreaterThan(
      menu.indexOf('title: "Devices",'),
    );
    expect(menu.indexOf('title: "Traffic",')).toBeLessThan(
      menu.indexOf('title: "Child Sites",'),
    );
    expect(readCode("Pages/NetworkSite/Utils/Breadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.NETWORK_SITE_VIEW_TRAFFIC, [ "Project", "Network", "View Site", "Traffic", ])',
    );
  });

  test("draws the site's traffic, fresh for each site", () => {
    expect(readCode("Pages/NetworkSite/View/Traffic.tsx")).toContain(
      '<NetworkTrafficView key={modelId.toString()} scope={{ kind: "site", networkSiteId: modelId }} />',
    );
  });
});

describe("a device's Traffic tab", () => {
  const page: string = readCode("Pages/NetworkDevice/View/Traffic.tsx");

  test("shows the flows first and the packet captures under them (issue #4601)", () => {
    const flows: number = page.indexOf("<NetworkTrafficView");
    const captures: number = page.indexOf("<DevicePacketCaptures");

    expect(flows).toBeGreaterThan(-1);
    expect(captures).toBeGreaterThan(flows);
  });

  test("reads only what the set-up guide needs: the addresses records are matched by, and the probe", () => {
    expect(page).toContain(
      "select: { _id: true, hostname: true, otherAddresses: true, probe: { _id: true, name: true, isGlobalProbe: true, }, },",
    );
  });

  test("the old top talkers card is gone", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Components/NetworkDevice/FlowTopTalkers.tsx"),
      ),
    ).toBe(false);
    expect(page).not.toContain("FlowTopTalkers");
    expect(page).not.toContain("Setting up NetFlow");
  });
});

describe("Other Addresses on a device's Settings", () => {
  test("is a field of the Address step, beside the hostname, with a row shown when it is set", () => {
    const settings: string = readCode("Pages/NetworkDevice/View/Settings.tsx");

    expect(settings).toContain(
      'getOtherAddressesFormField({ stepId: "address" }),',
    );
    expect(settings).toContain(
      'field: { otherAddresses: true, }, title: "Other Addresses", fieldType: FieldType.Text, showIf: (item: NetworkDevice): boolean => { return Boolean(item.otherAddresses); },',
    );
  });

  test("the field edits otherAddresses, optional, on the step it is given", () => {
    const field: Field<NetworkDevice> = getOtherAddressesFormField({
      stepId: "address",
    });

    expect(field.field).toEqual({ otherAddresses: true });
    expect(field.title).toBe(OTHER_ADDRESSES_FIELD_TITLE);
    expect(field.required).toBe(false);
    expect(field.stepId).toBe("address");
    expect(getOtherAddressesFormField().stepId).toBeUndefined();
  });

  test("the form takes what the server stores, and the same limit", () => {
    const valid: (raw: unknown) => string | null = (raw: unknown) => {
      return validateOtherAddresses({
        otherAddresses: raw,
      } as unknown as FormValues<NetworkDevice>);
    };

    expect(OTHER_ADDRESSES_LIMIT).toBe(MAX_OTHER_ADDRESSES);
    expect(OTHER_ADDRESSES_VALIDATION_MESSAGE).toContain(
      `up to ${MAX_OTHER_ADDRESSES}`,
    );
    expect(valid(undefined)).toBeNull();
    expect(valid("")).toBeNull();
    expect(valid("  ")).toBeNull();
    expect(valid("10.0.0.1")).toBeNull();
    expect(valid("10.0.0.1, 2001:db8::1; 192.0.2.10\n198.51.100.1")).toBeNull();
    expect(valid("10.0.0.1, core-router")).toBe(
      OTHER_ADDRESSES_VALIDATION_MESSAGE,
    );
    expect(
      valid(
        Array.from(
          { length: MAX_OTHER_ADDRESSES + 1 },
          (_value: unknown, index: number): string => {
            return `10.0.0.${index + 1}`;
          },
        ).join(", "),
      ),
    ).toBe(OTHER_ADDRESSES_VALIDATION_MESSAGE);
  });
});
