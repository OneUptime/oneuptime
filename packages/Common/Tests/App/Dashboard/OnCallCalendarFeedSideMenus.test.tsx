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
 * "Profile & Calendar" section on User Settings (placed before Workspace, per the
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
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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

describe("User Settings side menu - Profile & Calendar section", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/user-settings/notification-methods`);
  });

  afterEach(() => {
    cleanup();
    ConnectedWorkspaces.reset();
  });

  /*
   * Workspace is the last section now, and only there in a project with a
   * chat workspace connected (WorkspaceMenusConnected.test.tsx), so the
   * calendar link everybody on a rota wants still comes before it.
   */
  test("has a Profile & Calendar section placed before Workspace", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    await renderMenu(<UserSettingsSideMenu />);

    const titles: Array<string> = sectionTitlesInOrder();
    const calendarIndex: number = titles.indexOf("Profile & Calendar");
    const workspaceIndex: number = titles.indexOf("Workspace");

    expect(calendarIndex).toBeGreaterThan(-1);
    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(calendarIndex).toBeLessThan(workspaceIndex);
  });

  /*
   * Calendar held the Calendar Feed alone, and Profile its Custom Fields
   * alone: one section for what is yours (#9134).
   */
  test("the Profile & Calendar section leads with the Calendar Feed page", async () => {
    await renderMenu(<UserSettingsSideMenu />);

    const links: Array<MenuLink> = linksIn("Profile & Calendar");

    expect(links).toEqual([
      {
        title: "Calendar Feed",
        href: routeFor(PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED),
      },
      {
        title: "Custom Fields",
        href: routeFor(PageMap.USER_SETTINGS_CUSTOM_FIELDS),
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

    /*
     * The two views of the schedules come first - the list and the timeline
     * of all of them - then User Overrides, which changes who they page
     * and which the timeline draws (#9701), and the feeds that export them
     * follow: set up once, opened far less often.
     */
    expect(titles).toEqual([
      "On-Call Schedules",
      "Schedule Timeline",
      "User Overrides",
      "Calendar Feeds",
    ]);

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

/*
 * User Overrides, the project's global ones, sits under Schedules (#9701):
 * who covers for someone while they are away changes who the schedules
 * page, and the folded Advanced section kept it a click from where people
 * look. The page kept its address, so every link to it - a bookmark, the
 * Get cover link on an upcoming shift, the docs - still opens it.
 */
describe("On-Call side menu - User Overrides item", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/on-call-duty/policies`);
  });

  afterEach(() => {
    cleanup();
  });

  test("is in Schedules, at the address it always had", async () => {
    await renderMenu(<OnCallDutySideMenu />);

    const userOverrides: MenuLink | undefined = linksIn("Schedules").find(
      (link: MenuLink): boolean => {
        return link.title === "User Overrides";
      },
    );

    expect(userOverrides?.href).toBe(
      routeFor(PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES),
    );
    expect(userOverrides?.href).toBe(
      `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`,
    );
  });

  test("is no longer in Advanced, and is linked exactly once", async () => {
    await renderMenu(<OnCallDutySideMenu />);

    expect(
      linksIn("Advanced").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Execution Logs", "Archived Policies"]);

    const href: string = routeFor(PageMap.ON_CALL_DUTY_POLICY_USER_OVERRIDES);

    expect(
      hrefsInMenu().filter((candidate: string): boolean => {
        return candidate === href;
      }).length,
    ).toBe(1);
  });

  test("on its own page, its section is the open Schedules one", async () => {
    goTo(`/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`);
    await renderMenu(<OnCallDutySideMenu />);

    expect(sectionTitlesInOrder().slice(0, 3)).toEqual([
      "Policies",
      "Schedules",
      "Advanced",
    ]);
    expect(
      linksIn("Schedules").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toContain("User Overrides");
  });
});
