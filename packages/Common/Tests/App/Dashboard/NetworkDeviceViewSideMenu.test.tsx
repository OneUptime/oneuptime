import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
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

/*
 * A device's own menu, rendered against the real RouteMap.
 *
 * It listed eight pages open, two of them vendor tables most devices never
 * report (SNMP Tables, Wi-Fi). What most visits are for stays open - is it
 * OK, its ports, its numbers, its traffic and logs, what alerts on it - and
 * the vendor tables fold under More, opening by themselves on their own
 * pages so a link to one still lands somewhere you can see.
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

describe("a network device's own menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    // In the project first: the menu's routes take its id from the address.
    goTo(`/dashboard/${PROJECT_ID}/network-devices`);
    goTo(deviceRoute(PageMap.NETWORK_DEVICE_VIEW));
  });

  afterEach(() => {
    cleanup();
  });

  test("is Device, More, Developer and Manage, in that order", async () => {
    await renderDeviceMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Device",
      "More",
      "Developer",
      "Manage",
    ]);
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
      { title: "Logs", href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_LOGS) },
      {
        title: "Monitors",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_MONITORS),
      },
    ]);
  });

  test("folds the vendor tables under More", async () => {
    await renderDeviceMenu();

    expect(isExpanded("More")).toBe(false);
    expect(linksIn("More")).toEqual([
      {
        title: "SNMP Tables",
        href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_TABLES),
      },
      { title: "Wi-Fi", href: deviceRoute(PageMap.NETWORK_DEVICE_VIEW_WIFI) },
    ]);
    expect(titles(linksIn("Device"))).not.toContain("SNMP Tables");
    expect(titles(linksIn("Device"))).not.toContain("Wi-Fi");
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
    [PageMap.NETWORK_DEVICE_VIEW_MONITORS, "Monitors"],
  ])(
    "%s highlights %s and leaves More folded",
    async (pageMapKey: string, title: string): Promise<void> => {
      goTo(deviceRoute(pageMapKey));

      await renderDeviceMenu();

      expect(activeLinkTitles()).toEqual([title]);
      expect(isExpanded("More")).toBe(false);
    },
  );

  test("the device's pages all stay on this device, in this project", async () => {
    await renderDeviceMenu();

    for (const section of ["Device", "More"]) {
      for (const link of linksIn(section)) {
        expect(link.href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
        expect(link.href).toContain(DEVICE_ID.toString());
      }
    }
  });
});
