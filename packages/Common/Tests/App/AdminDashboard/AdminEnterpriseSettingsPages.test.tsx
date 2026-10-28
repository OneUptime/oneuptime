import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";

/*
 * Admin Dashboard > Settings can carry pages an Enterprise area adds: the
 * plugin's SettingsPages become routes under /admin/settings, and its
 * SettingsSideMenuItems / SettingsNotificationSideMenuItems draw their own
 * entries at the end of the Basic and Notifications sections. All are read
 * from the plugin door in render; the Community stub (what this jest config
 * resolves) has none, and then the menu is exactly the core menu.
 *
 * Core only: this must pass with ee/ deleted.
 */

let mockPlugins: Record<string, unknown> = {};
let pluginReads: number = 0;

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/Plugins",
  () => {
    return {
      getAdminDashboardPlugins: (): Record<string, unknown> => {
        pluginReads += 1;
        return mockPlugins;
      },
    };
  },
);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

import AdminSettingsSideMenu from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu";
import AdminCommunityPlugins from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/CommunityPlugins";
import {
  ENTERPRISE_SETTINGS_PAGES_BASE_PATH,
  getEnterpriseSettingsPageRoute,
} from "../../../../App/FeatureSet/AdminDashboard/src/Enterprise/EnterprisePlugins";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import {
  activeLinkTitles,
  currentEntries,
  DESKTOP_WIDTH,
  goTo,
  isExpanded,
  linksIn,
  MenuLink,
  MOBILE_WIDTH,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "../Dashboard/SideMenuHarness";

const BASIC: string = "sideMenu.basic";
const NOTIFICATIONS: string = "sideMenu.settingsNotifications";

// The sections below Notifications, which start folded on every page but their own.
const FOLDED_SECTIONS: ReadonlyArray<string> = [
  "sideMenu.settingsMonitoring",
  "sideMenu.settingsRunbooks",
  "sideMenu.settingsDataRetention",
  "sideMenu.settingsAi",
  "sideMenu.settingsApiIntegrations",
];

function settingsRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
  ).toString();
}

function expandedSections(): Array<string> {
  return sectionTitlesInOrder().filter((title: string): boolean => {
    return isExpanded(title);
  });
}

const ExtraSettingsItem: () => ReactElement = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: "Extra Settings",
        to: getEnterpriseSettingsPageRoute("extra-settings"),
      }}
      icon={IconProp.Settings}
    />
  );
};

const ExtraNotificationItem: () => ReactElement = (): ReactElement => {
  return (
    <SideMenuItem
      link={{
        title: "Extra Notification",
        to: getEnterpriseSettingsPageRoute("extra-notification"),
      }}
      icon={IconProp.Notification}
    />
  );
};

const renderSettingsMenu: () => Promise<Array<MenuLink>> = async (): Promise<
  Array<MenuLink>
> => {
  goTo(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
    ).toString(),
  );
  await renderMenu(<AdminSettingsSideMenu />);

  return linksIn(BASIC);
};

const renderNotificationSettingsMenu: () => Promise<
  Array<MenuLink>
> = async (): Promise<Array<MenuLink>> => {
  goTo(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SETTINGS_AUTHENTICATION] as Route,
    ).toString(),
  );
  await renderMenu(<AdminSettingsSideMenu />);

  return linksIn(NOTIFICATIONS);
};

beforeEach(() => {
  mockPlugins = AdminCommunityPlugins as Record<string, unknown>;
  pluginReads = 0;
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("the Admin Dashboard's settings menu", () => {
  test("with the Community stub, Basic holds only core's entries", async () => {
    const coreLinks: Array<MenuLink> = await renderSettingsMenu();

    expect(coreLinks.length).toBeGreaterThan(0);
    expect(
      coreLinks.some((link: MenuLink): boolean => {
        return link.title === "Extra Settings";
      }),
    ).toBe(false);
  });

  test("draws the plugin's entries at the end of Basic", async () => {
    const coreLinks: Array<MenuLink> = await renderSettingsMenu();
    cleanup();

    mockPlugins = { SettingsSideMenuItems: ExtraSettingsItem };

    const links: Array<MenuLink> = await renderSettingsMenu();

    expect(links).toEqual([
      ...coreLinks,
      { title: "Extra Settings", href: "/admin/settings/extra-settings" },
    ]);
  });

  test("draws the plugin's notification entries at the end of Notifications", async () => {
    const coreLinks: Array<MenuLink> = await renderNotificationSettingsMenu();
    cleanup();

    mockPlugins = { SettingsNotificationSideMenuItems: ExtraNotificationItem };

    const links: Array<MenuLink> = await renderNotificationSettingsMenu();

    expect(links).toEqual([
      ...coreLinks,
      {
        title: "Extra Notification",
        href: "/admin/settings/extra-notification",
      },
    ]);
  });

  test("a Basic entry does not appear in Notifications", async () => {
    const coreLinks: Array<MenuLink> = await renderNotificationSettingsMenu();
    cleanup();

    mockPlugins = { SettingsSideMenuItems: ExtraSettingsItem };

    const links: Array<MenuLink> = await renderNotificationSettingsMenu();

    expect(links).toEqual(coreLinks);
  });

  test("reads the plugin door while rendering, not when the module loads", async () => {
    expect(pluginReads).toBe(0);

    await renderSettingsMenu();

    expect(pluginReads).toBeGreaterThan(0);
  });
});

/*
 * Notifications starts folded, and an entry the plugin draws is a component
 * the menu's route scan cannot read into. On that entry's own page the
 * section must still open and the entry be the lit one - the reader is never
 * left on a page whose entry is folded away - in the section the plugin put
 * it in, and nowhere else.
 */
describe("a page the plugin adds opens the section its entry is in", () => {
  beforeEach(() => {
    mockPlugins = {
      SettingsSideMenuItems: ExtraSettingsItem,
      SettingsNotificationSideMenuItems: ExtraNotificationItem,
    };
  });

  test("on a notification entry's page, Notifications opens and lights it; Basic stays open and the rest folded", async () => {
    goTo(getEnterpriseSettingsPageRoute("extra-notification").toString());
    await renderMenu(<AdminSettingsSideMenu />);

    expect(isExpanded(NOTIFICATIONS)).toBe(true);
    expect(isExpanded(BASIC)).toBe(true);
    expect(expandedSections()).toEqual([BASIC, NOTIFICATIONS]);
    expect(activeLinkTitles()).toEqual(["Extra Notification"]);
    expect(currentEntries()).toEqual([
      { title: "Extra Notification", current: "page" },
    ]);
    expect(linksIn(NOTIFICATIONS).pop()).toEqual({
      title: "Extra Notification",
      href: "/admin/settings/extra-notification",
    });

    for (const folded of FOLDED_SECTIONS) {
      expect({ section: folded, expanded: isExpanded(folded) }).toEqual({
        section: folded,
        expanded: false,
      });
    }
  });

  test("Notifications opens at once there, drawn as on a core page of its own", async () => {
    goTo(getEnterpriseSettingsPageRoute("extra-notification").toString());
    await renderMenu(<AdminSettingsSideMenu />);

    expect(sectionBody(NOTIFICATIONS)).toHaveClass(
      "opacity-100",
      "transition-none",
    );
    expect(sectionBody(NOTIFICATIONS)).not.toHaveClass("max-h-0");
  });

  test("on a Basic entry's page, Basic lights it and Notifications stays folded", async () => {
    goTo(getEnterpriseSettingsPageRoute("extra-settings").toString());
    await renderMenu(<AdminSettingsSideMenu />);

    expect(expandedSections()).toEqual([BASIC]);
    expect(activeLinkTitles()).toEqual(["Extra Settings"]);
    expect(sectionBody(NOTIFICATIONS)).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
  });

  test("on a core Notifications page, the plugin's entry is last and unlit", async () => {
    goTo(settingsRoute(PageMap.SETTINGS_PUSH_NOTIFICATIONS));
    await renderMenu(<AdminSettingsSideMenu />);

    const links: Array<MenuLink> = linksIn(NOTIFICATIONS);

    expect(expandedSections()).toEqual([BASIC, NOTIFICATIONS]);
    expect(activeLinkTitles()).toEqual(["Push Notifications"]);
    expect(links[links.length - 2]).toEqual({
      title: "Push Notifications",
      href: "/admin/settings/push-notifications",
    });
    expect(links[links.length - 1]).toEqual({
      title: "Extra Notification",
      href: "/admin/settings/extra-notification",
    });
  });

  test("on Authentication, Notifications stays folded with the plugin's entry inside it, and opens with a click", async () => {
    goTo(settingsRoute(PageMap.SETTINGS_AUTHENTICATION));
    await renderMenu(<AdminSettingsSideMenu />);

    expect(expandedSections()).toEqual([BASIC]);
    expect(
      linksIn(NOTIFICATIONS).map((link: MenuLink): string => {
        return link.title;
      }),
    ).toContain("Extra Notification");

    fireEvent.click(screen.getByRole("button", { name: NOTIFICATIONS }));

    expect(isExpanded(NOTIFICATIONS)).toBe(true);
    expect(sectionBody(NOTIFICATIONS)).toHaveClass(
      "opacity-100",
      "transition-opacity",
    );
  });

  test("on a phone, the opened menu shows Notifications open with the entry lit", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(getEnterpriseSettingsPageRoute("extra-notification").toString());
    await renderMenu(<AdminSettingsSideMenu />);

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    expect(expandedSections()).toEqual([BASIC, NOTIFICATIONS]);
    expect(activeLinkTitles()).toEqual(["Extra Notification"]);
  });

  /*
   * The Community Edition has neither key: on the address an Enterprise page
   * would have, the menu is the core menu - nothing is lit, nothing opens,
   * and no Enterprise entry is drawn.
   */
  test("with the Community stub, that address lights nothing and opens nothing", async () => {
    mockPlugins = AdminCommunityPlugins as Record<string, unknown>;
    goTo(getEnterpriseSettingsPageRoute("extra-notification").toString());
    await renderMenu(<AdminSettingsSideMenu />);

    expect(expandedSections()).toEqual([BASIC]);
    expect(activeLinkTitles()).toEqual([]);
    expect(document.body.textContent).not.toContain("Extra Notification");
    expect(document.body.textContent).not.toContain("Extra Settings");
  });
});

describe("Enterprise settings page routes", () => {
  test("live under /admin/settings", () => {
    expect(ENTERPRISE_SETTINGS_PAGES_BASE_PATH).toBe("/admin/settings");
    expect(getEnterpriseSettingsPageRoute("extra-settings").toString()).toBe(
      "/admin/settings/extra-settings",
    );
  });

  test("the Community stub adds no settings page and no menu entry", () => {
    expect(
      (AdminCommunityPlugins as Record<string, unknown>)["SettingsPages"],
    ).toBeUndefined();
    expect(
      (AdminCommunityPlugins as Record<string, unknown>)[
        "SettingsSideMenuItems"
      ],
    ).toBeUndefined();
    expect(
      (AdminCommunityPlugins as Record<string, unknown>)[
        "SettingsNotificationSideMenuItems"
      ],
    ).toBeUndefined();
  });

  test("the router maps every plugin settings page to its route, in render, behind a loader", () => {
    const appSource: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "App.tsx",
      ),
      "utf8",
    );

    expect(appSource).toContain(
      "(getAdminDashboardPlugins().SettingsPages || []).map(",
    );
    expect(appSource).toContain(
      "path={getEnterpriseSettingsPageRoute(page.path).toString()}",
    );
    expect(appSource).toContain(
      "<Suspense fallback={<PageLoader isVisible={true} />}>",
    );
  });
});
