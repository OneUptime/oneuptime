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
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";

/*
 * Admin Dashboard > Settings can carry pages an Enterprise area adds: the
 * plugin's SettingsPages become routes under /admin/settings, and its
 * SettingsSideMenuItems draw their own entries at the end of the Basic
 * section. Both are read from the plugin door in render; the Community stub
 * (what this jest config resolves) has neither, and then the menu is
 * exactly the core menu.
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
  DESKTOP_WIDTH,
  goTo,
  linksIn,
  MenuLink,
  renderMenu,
  setViewportWidth,
} from "../Dashboard/SideMenuHarness";

const BASIC: string = "sideMenu.basic";

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

  test("reads the plugin door while rendering, not when the module loads", async () => {
    expect(pluginReads).toBe(0);

    await renderSettingsMenu();

    expect(pluginReads).toBeGreaterThan(0);
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
