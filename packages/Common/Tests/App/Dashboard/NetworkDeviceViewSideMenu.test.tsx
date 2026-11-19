import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import NetworkDeviceViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import {
  activeLinkTitles,
  DESKTOP_WIDTH,
  goTo,
  isExpanded,
  linksIn,
  MenuLink,
  PROJECT_ID,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";
import { refuseRequestsTo } from "../../Helpers/RealNetworkRequests";

/*
 * Reads the page makes that these tests leave unanswered: refused at
 * once, as the network refused them, and taken as reads it could not
 * make (Tests/Helpers/RealNetworkRequests.ts).
 */
refuseRequestsTo(["/alert-state/get-list", "/incident-state/get-list"]);

/*
 * A device's own menu, rendered against the real RouteMap.
 *
 * It listed eight pages open, two of them vendor tables most devices never
 * report (SNMP Tables, Wi-Fi). What most visits are for stays open - is it
 * OK, its ports, its numbers, its traffic and logs, what alerts on it - and
 * the vendor tables fold under More, opening by themselves on their own
 * pages so a link to one still lands somewhere you can see. The SNMP walk
 * (issue #5184), a tool for setting a device up rather than a page of every
 * visit, folds there with them, beside the SNMP tables it helps fill.
 *
 * The security events about the device (issue #5769) sit beside its logs:
 * read from the syslog it sends the probe, or naming it from anywhere else.
 *
 * Incidents and alerts can be linked to a device (issue #5341), so its
 * menu lists them under Activity, open, as a host's and a cloud resource's
 * do (the counts are NetworkDeviceViewSideMenuCounts).
 */

const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function deviceRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: DEVICE_ID,
  }).toString();
}

function titles(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

async function renderDeviceMenu(): Promise<void> {
  await renderMenu(<NetworkDeviceViewSideMenu modelId={DEVICE_ID} />);
}

/*
 * The project's products answer: Security Events in use, unless a test
 * says otherwise, and the reader allowed to read security events
 * (ProductsInResources).
 */
function givenProducts(extra: Partial<ProjectProductsAnswer> = {}): void {
  ProjectProducts.setAnswer(PROJECT_ID, {
    ...getEmptyProjectProductsAnswer(),
    usage: { [ProductKey.SecurityEvents]: ProductUsage.InUse },
    ...extra,
  });
}

describe("a network device's own menu", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ProjectProducts.reset();
    givenProducts();
    jest.spyOn(PermissionGate, "check").mockImplementation(() => {
      return { isAllowed: true } as PermissionGateResult;
    });
    setViewportWidth(DESKTOP_WIDTH);
    // In the project first: the menu's routes take its id from the address.
    goTo(`/dashboard/${PROJECT_ID}/network-devices`);
    goTo(deviceRoute(PageMap.NETWORK_DEVICE_VIEW));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    ProjectProducts.reset();
  });

  test("is Device, Activity, More, Developer and Manage, in that order", async () => {
    await renderDeviceMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Device",
      "Activity",
      "More",
      "Developer",
      "Manage",
    ]);
  });

  test("lists the incidents and alerts linked to the device under Activity, open", async () => {
    await renderDeviceMenu();

    expect(isExpanded("Activity")).toBe(true);
    expect(linksIn("Activity")).toEqual([
      {
        title: "Incidents",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_INCIDENTS),
      },
      {
        title: "Alerts",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_ALERTS),
      },
    ]);
    // Not among the pages of every visit, nor folded with the vendor tables.
    expect(titles(linksIn("Device"))).not.toContain("Incidents");
    expect(titles(linksIn("More"))).not.toContain("Alerts");
  });

  test("the incidents and alerts live at the device's incidents and alerts addresses", () => {
    expect(deviceRoute(PageMap.NETWORK_DEVICE_VIEW_INCIDENTS)).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID.toString()}/incidents`,
    );
    expect(deviceRoute(PageMap.NETWORK_DEVICE_VIEW_ALERTS)).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID.toString()}/alerts`,
    );
  });

  test("keeps what most visits are for open, in one section", async () => {
    await renderDeviceMenu();

    expect(isExpanded("Device")).toBe(true);
    expect(linksIn("Device")).toEqual([
      { title: "Overview", href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW) },
      {
        title: "Interfaces",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_INTERFACES),
      },
      {
        title: "Metrics",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_METRICS),
      },
      {
        title: "Traffic",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_TRAFFIC),
      },
      // What the device reported (#4728), then everything it sent.
      {
        title: "Events",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_EVENTS),
      },
      { title: "Logs", href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_LOGS) },
      // The security events about it, beside the logs they are read from (#5769).
      {
        title: "Security Events",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS),
      },
      {
        title: "Monitors",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_MONITORS),
      },
    ]);
  });

  test("the security events live at the device's security-events address", () => {
    expect(deviceRoute(PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS)).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID.toString()}/security-events`,
    );
  });

  test("folds the vendor tables and the SNMP walk under More", async () => {
    await renderDeviceMenu();

    expect(isExpanded("More")).toBe(false);
    expect(linksIn("More")).toEqual([
      {
        title: "SNMP Tables",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_TABLES),
      },
      {
        title: "SNMP Walk",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK),
      },
      { title: "Wi-Fi", href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_WIFI) },
    ]);
    expect(titles(linksIn("Device"))).not.toContain("SNMP Tables");
    expect(titles(linksIn("Device"))).not.toContain("SNMP Walk");
    expect(titles(linksIn("Device"))).not.toContain("Wi-Fi");
  });

  test("the SNMP walk lives at the device's snmp-walk address", () => {
    expect(deviceRoute(PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK)).toBe(
      `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID.toString()}/snmp-walk`,
    );
  });

  test("More opens on a click", async () => {
    await renderDeviceMenu();

    await act(async () => {
      fireEvent.click(sectionToggle("More"));
    });

    expect(isExpanded("More")).toBe(true);
    expect(sectionBody("More")).toHaveClass("opacity-100");
  });

  test.each([
    [PageMap.NETWORK_DEVICE_VIEW_TABLES, "SNMP Tables"],
    [PageMap.NETWORK_DEVICE_VIEW_SNMP_WALK, "SNMP Walk"],
    [PageMap.NETWORK_DEVICE_VIEW_WIFI, "Wi-Fi"],
  ])(
    "%s opens More by itself and highlights %s",
    async (pageMapKey: string, title: string): Promise<void> => {
      goTo(deviceRoute(pageMapKey));

      await renderDeviceMenu();

      expect(isExpanded("More")).toBe(true);
      expect(sectionBody("More")).toHaveClass("opacity-100");
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test.each([
    [PageMap.NETWORK_DEVICE_VIEW, "Overview"],
    [PageMap.NETWORK_DEVICE_VIEW_INTERFACES, "Interfaces"],
    [PageMap.NETWORK_DEVICE_VIEW_EVENTS, "Events"],
    [PageMap.NETWORK_DEVICE_VIEW_SECURITY_EVENTS, "Security Events"],
    [PageMap.NETWORK_DEVICE_VIEW_MONITORS, "Monitors"],
    [PageMap.NETWORK_DEVICE_VIEW_INCIDENTS, "Incidents"],
    [PageMap.NETWORK_DEVICE_VIEW_ALERTS, "Alerts"],
  ])(
    "%s highlights %s and leaves More folded",
    async (pageMapKey: string, title: string): Promise<void> => {
      goTo(deviceRoute(pageMapKey));

      await renderDeviceMenu();

      expect(activeLinkTitles()).toEqual([title]);
      expect(isExpanded("More")).toBe(false);
    },
  );

  /*
   * The Security Events entry stood on every device's menu, even on a
   * server that had switched Security Events off (#9547). Now it follows
   * the product, as every resource's does.
   */
  test.each([
    [
      "switched off on the server",
      {
        offOnServer: {
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
        },
      },
    ],
    ["hidden in the project", { hidden: [ProductKey.SecurityEvents] }],
    ["never set up", { usage: {} }],
  ])(
    "leaves Security Events out while it is %s",
    async (
      _label: string,
      extra: Partial<ProjectProductsAnswer>,
    ): Promise<void> => {
      givenProducts(extra);

      await renderDeviceMenu();

      expect(titles(linksIn("Device"))).not.toContain("Security Events");
      expect(titles(linksIn("Device"))).toContain("Logs");
    },
  );

  test("leaves Security Events out for someone who may not read security events", async () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(() => {
      return { isAllowed: false } as PermissionGateResult;
    });

    await renderDeviceMenu();

    expect(titles(linksIn("Device"))).not.toContain("Security Events");
  });

  test("the device's pages all stay on this device, in this project", async () => {
    await renderDeviceMenu();

    for (const section of ["Device", "Activity", "More"]) {
      for (const link of linksIn(section)) {
        expect(link.href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
        expect(link.href).toContain(DEVICE_ID.toString());
      }
    }
  });
});
