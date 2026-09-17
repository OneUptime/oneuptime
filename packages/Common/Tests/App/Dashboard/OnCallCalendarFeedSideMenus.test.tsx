import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";

/*
 * The two side-menu entries that make the calendar feeds reachable: the
 * "Calendar" section on User Settings (placed before Workspace, per the
 * design) and the "Calendar Feeds" item under On-Call Duty's Schedules
 * section. Both are rendered for real against the real RouteMap, so an entry
 * that points at the wrong route, lands in the wrong section, or is dropped
 * in a menu reshuffle fails here rather than in somebody's browser.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

import UserSettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/SideMenu";
import OnCallDutySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  linksIn,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

describe("User Settings side menu - Calendar section", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/user-settings/notification-methods`);
  });

  afterEach(() => {
    cleanup();
  });

  test("has a Calendar section placed right before Workspace", async () => {
    await renderMenu(<UserSettingsSideMenu />);

    const titles: Array<string> = sectionTitlesInOrder();
    const calendarIndex: number = titles.indexOf("Calendar");
    const workspaceIndex: number = titles.indexOf("Workspace");

    expect(calendarIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(calendarIndex).toBe(workspaceIndex - 1);
  });

  test("the Calendar section holds exactly the Calendar Feed page", async () => {
    await renderMenu(<UserSettingsSideMenu />);

    const links: Array<MenuLink> = linksIn("Calendar");

    expect(links).toEqual([
      {
        title: "Calendar Feed",
        href: routeFor(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED),
      },
    ]);
    expect(links[0]!.href).toBe(
      `/dashboard/${PROJECT_ID}/user-settings/calendar-feed`,
    );
  });

  test("no other section links to the Calendar Feed page", async () => {
    await renderMenu(<UserSettingsSideMenu />);

    const href: string = routeFor(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED);

    expect(
      hrefsInMenu().filter((candidate: string): boolean => {
        return candidate === href;
      }).length,
    ).toBe(1);
  });
});

describe("On-Call Duty side menu - Calendar Feeds item", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/on-call-duty/policies`);
  });

  afterEach(() => {
    cleanup();
  });

  test("lists Calendar Feeds next to the schedules it exports", async () => {
    await renderMenu(<OnCallDutySideMenu />);

    const links: Array<MenuLink> = linksIn("Schedules");
    const titles: Array<string> = links.map((link: MenuLink): string => {
      return link.title;
    });

    expect(titles).toContain("On-Call Schedules");
    expect(titles).toContain("Calendar Feeds");
    expect(titles.indexOf("Calendar Feeds")).toBe(
      titles.indexOf("On-Call Schedules") + 1,
    );

    const calendarFeeds: MenuLink | undefined = links.find(
      (link: MenuLink): boolean => {
        return link.title === "Calendar Feeds";
      },
    );

    expect(calendarFeeds?.href).toBe(
      routeFor(PageMap.ON_CALL_DUTY_CALENDAR_FEEDS),
    );
    expect(calendarFeeds?.href).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/calendar-feeds`,
    );
  });

  test("the Calendar Feeds page is linked exactly once", async () => {
    await renderMenu(<OnCallDutySideMenu />);

    const href: string = routeFor(PageMap.ON_CALL_DUTY_CALENDAR_FEEDS);

    expect(
      hrefsInMenu().filter((candidate: string): boolean => {
        return candidate === href;
      }).length,
    ).toBe(1);
  });
});
