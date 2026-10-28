import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * Custom Channels in the Enterprise Admin Dashboard plugin, as the Enterprise
 * image builds it ("@oneuptime/ee-admin-dashboard" is the REAL ee plugin
 * here):
 *
 *   - Settings > Notifications > Custom Channels is a page at
 *     /admin/settings/custom-channels, downloaded only when it is opened, and
 *     an entry in the Notifications section of the Settings side menu after
 *     Push Notifications - on every Enterprise installation, whatever the
 *     license (the page itself says what a license that leaves custom
 *     channels out stops);
 *   - the Community build has none of it: its plugin stub is empty, core
 *     never names the page, and the page core used to have is gone - so the
 *     Community Edition has no Custom Channels page;
 *   - the page's files reach core only through Common/... and
 *     "@oneuptime/admin-dashboard/...", and the Enterprise UI's own license
 *     helpers and notice - never the Dashboard's internals, which the Admin
 *     Dashboard's build cannot resolve.
 */

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

import AdminEnterprisePlugins from "../../../AdminDashboard/Index";
import CustomChannelsPlugins from "../../../AdminDashboard/CustomChannels/Plugins";
import CustomChannelsSideMenuItem from "../../../AdminDashboard/CustomChannels/CustomChannelsSideMenuItem";
import {
  CUSTOM_CHANNELS_SETTINGS_PAGE_PATH,
  CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE,
} from "../../../AdminDashboard/CustomChannels/CustomChannelsPaths";
import BackupsPlugins from "../../../AdminDashboard/Backups/Plugins";
import WhiteLabelPlugins from "../../../AdminDashboard/WhiteLabel/Plugins";
import {
  ENTERPRISE_SETTINGS_AREAS,
  EnterpriseSettingsNotificationSideMenuItems,
  EnterpriseSettingsSideMenuItems,
} from "../../../AdminDashboard/EnterpriseSettings";
import AdminCommunityPlugins from "@oneuptime/admin-dashboard/Enterprise/CommunityPlugins";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const CUSTOM_CHANNELS_DIR: string = path.join(
  EE_DIR,
  "AdminDashboard",
  "CustomChannels",
);
const ADMIN_DASHBOARD_SRC: string = path.join(
  EE_DIR,
  "..",
  "packages",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
// The page's files, its address, or the page core used to have.
const NAMES_CUSTOM_CHANNELS_PAGE: RegExp =
  /AdminDashboard\/CustomChannels|settings\/custom-channels|Settings\/CustomChannels|SETTINGS_CUSTOM_CHANNELS/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const IMPORT_SPECIFIER: RegExp =
  /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

function importsOf(file: string): Array<string> {
  const source: string = fs
    .readFileSync(file, "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1");
  const specifiers: Array<string> = [];
  const pattern: RegExp = new RegExp(IMPORT_SPECIFIER.source, "g");
  let match: RegExpExecArray | null = pattern.exec(source);

  while (match) {
    specifiers.push(match[1] as string);
    match = pattern.exec(source);
  }

  return specifiers;
}

function sourceFilesOf(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFilesOf(full));
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

const NOTIFICATIONS: string = "sideMenu.settingsNotifications";
const BASIC: string = "sideMenu.basic";

// The page the reader is on, as the Admin Dashboard's router sets it.
function goTo(address: string): void {
  window.history.pushState({}, "", address);
  Navigation.setLocation(window.location as unknown as never);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

interface DrawnSection {
  title: string;
  expanded: boolean;
  links: Array<string>;
  lit: Array<string>;
}

// Every section of the menu as drawn: open or folded, its links, the lit one.
function drawnSections(): Array<DrawnSection> {
  return Array.from(document.querySelectorAll("h6")).map(
    (heading: HTMLElement): DrawnSection => {
      const section: HTMLElement = heading.closest("div.mb-2") as HTMLElement;
      const anchors: Array<HTMLAnchorElement> = Array.from(
        section.querySelectorAll("a"),
      );

      return {
        title: heading.textContent?.trim() || "",
        expanded:
          section.querySelector("button")?.getAttribute("aria-expanded") ===
          "true",
        links: anchors.map((anchor: HTMLAnchorElement): string => {
          return anchor.getAttribute("href") || "";
        }),
        lit: anchors
          .filter((anchor: HTMLAnchorElement): boolean => {
            return anchor.hasAttribute("aria-current");
          })
          .map((anchor: HTMLAnchorElement): string => {
            return anchor.getAttribute("href") || "";
          }),
      };
    },
  );
}

function drawnSection(title: string): DrawnSection {
  const found: DrawnSection | undefined = drawnSections().find(
    (section: DrawnSection): boolean => {
      return section.title === title;
    },
  );

  if (!found) {
    throw new Error(`The Settings menu has no section "${title}".`);
  }

  return found;
}

function expandedTitles(): Array<string> {
  return drawnSections()
    .filter((section: DrawnSection): boolean => {
      return section.expanded;
    })
    .map((section: DrawnSection): string => {
      return section.title;
    });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  setViewportWidth(1280);
  goTo("/");
});

describe("Settings > Custom Channels in the Enterprise Admin Dashboard", () => {
  test("is a page at /admin/settings/custom-channels, downloaded only when it opens", async () => {
    const pages: ReadonlyArray<EnterpriseSettingsPage> =
      CustomChannelsPlugins.SettingsPages || [];

    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe(CUSTOM_CHANNELS_SETTINGS_PAGE_PATH);
    expect(CUSTOM_CHANNELS_SETTINGS_PAGE_PATH).toBe("custom-channels");
    expect(getEnterpriseSettingsPageRoute(pages[0]!.path).toString()).toBe(
      "/admin/settings/custom-channels",
    );

    // React.lazy: an exotic component, resolving to the page itself.
    const lazy: { _payload: { _result: () => Promise<{ default: unknown }> } } =
      pages[0]!.component as unknown as {
        _payload: { _result: () => Promise<{ default: unknown }> };
      };
    const loaded: { default: unknown } = await lazy._payload._result();

    expect(loaded.default).toBe(
      (
        (await import(
          "../../../AdminDashboard/CustomChannels/CustomChannelsSettingsPage"
        )) as { default: unknown }
      ).default,
    );
  });

  test("owns exactly the two settings keys", () => {
    expect(Object.keys(CustomChannelsPlugins).sort()).toEqual(
      ["SettingsPages", "SettingsNotificationSideMenuItems"].sort(),
    );
    expect(CustomChannelsPlugins.SettingsNotificationSideMenuItems).toBe(
      CustomChannelsSideMenuItem,
    );
    /*
     * Basic's key is not among its keys: read with `in`, since its type,
     * picked to the two keys it owns, has no such property to read.
     */
    expect("SettingsSideMenuItems" in CustomChannelsPlugins).toBe(false);
  });

  test("is part of the plugin the Enterprise image builds, between Backups and White Label", () => {
    expect(AdminEnterprisePlugins.SettingsPages).toEqual(
      expect.arrayContaining([...(CustomChannelsPlugins.SettingsPages || [])]),
    );
    expect(AdminEnterprisePlugins.SettingsNotificationSideMenuItems).toBe(
      EnterpriseSettingsNotificationSideMenuItems,
    );

    const index: number = ENTERPRISE_SETTINGS_AREAS.indexOf(
      CustomChannelsPlugins,
    );

    expect(index).toBeGreaterThan(-1);
    expect(ENTERPRISE_SETTINGS_AREAS[index - 1]).toBe(BackupsPlugins);
    expect(ENTERPRISE_SETTINGS_AREAS[index + 1]).toBe(WhiteLabelPlugins);
    expect(
      ENTERPRISE_SETTINGS_AREAS.filter((area: unknown): boolean => {
        return area === CustomChannelsPlugins;
      }),
    ).toHaveLength(1);
  });

  test("its side menu entry links to the page, by its title", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<CustomChannelsSideMenuItem />);

    expect(CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE).toBe("Custom Channels");
    expect(
      screen.getByText(CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE).closest("a"),
    ).toHaveAttribute("href", "/admin/settings/custom-channels");
  });

  test("core's Settings side menu shows it once, in Notifications after Push Notifications", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SettingsSideMenu />);

    const entries: Array<HTMLElement> = screen.getAllByText("Custom Channels");
    const pushNotifications: HTMLElement =
      screen.getByText("Push Notifications");
    const notifications: HTMLElement = screen
      .getByText("sideMenu.settingsNotifications")
      .closest("div.mb-2") as HTMLElement;
    const basic: HTMLElement = screen
      .getByText("sideMenu.basic")
      .closest("div.mb-2") as HTMLElement;

    expect(entries).toHaveLength(1);
    expect(entries[0]!.closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/custom-channels",
    );
    expect(notifications).toContainElement(entries[0]!);
    expect(notifications).toContainElement(pushNotifications);
    expect(basic).not.toContainElement(entries[0]!);
    expect(
      pushNotifications.compareDocumentPosition(entries[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the Enterprise notification entries draw it whatever White Label's license says", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsNotificationSideMenuItems />);

    expect(screen.getByText("Custom Channels")).toBeInTheDocument();
    expect(document.querySelector('a[href*="white-label"]')).toBeNull();
  });

  test("the Basic Enterprise entries leave it to Notifications", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsSideMenuItems />);

    expect(screen.queryByText("Custom Channels")).toBeNull();
    expect(screen.getByText("Backups")).toBeInTheDocument();
  });
});

/*
 * Notifications starts folded, and Custom Channels' entry is drawn by the
 * Enterprise plugin, which the menu's route scan cannot read into. On the
 * page itself the menu must still open Notifications at the lit entry - at
 * once, as a core Notifications page is drawn - and leave every other
 * section as it is. The real plugin, as the Enterprise image builds it.
 */
describe("the Settings menu on the Custom Channels page", () => {
  test("opens Notifications at Custom Channels and lights it; Basic stays open and the rest folded", () => {
    goTo("/admin/settings/custom-channels");

    render(<SettingsSideMenu />);

    const notifications: DrawnSection = drawnSection(NOTIFICATIONS);

    expect(expandedTitles()).toEqual([BASIC, NOTIFICATIONS]);
    expect(notifications.lit).toEqual(["/admin/settings/custom-channels"]);
    expect(notifications.links[notifications.links.length - 1]).toBe(
      "/admin/settings/custom-channels",
    );
    expect(drawnSection(BASIC).lit).toEqual([]);
    expect(drawnSection(BASIC).links).not.toContain(
      "/admin/settings/custom-channels",
    );
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
  });

  test("draws Notifications open at once, as on a core Notifications page", () => {
    goTo("/admin/settings/custom-channels");

    render(<SettingsSideMenu />);

    const body: HTMLElement = document.getElementById(
      screen
        .getByRole("button", { name: NOTIFICATIONS })
        .getAttribute("aria-controls") || "",
    ) as HTMLElement;

    expect(body).toHaveClass("opacity-100", "transition-none");
    expect(body).not.toHaveClass("max-h-0");
  });

  test("on Backups, an Enterprise page under Basic, Notifications stays folded", () => {
    goTo("/admin/settings/backups");

    render(<SettingsSideMenu />);

    expect(expandedTitles()).toEqual([BASIC]);
    expect(drawnSection(BASIC).lit).toEqual(["/admin/settings/backups"]);
    expect(drawnSection(NOTIFICATIONS).lit).toEqual([]);
  });

  test("on Push Notifications, Custom Channels comes right after it, unlit", () => {
    goTo("/admin/settings/push-notifications");

    render(<SettingsSideMenu />);

    const notifications: DrawnSection = drawnSection(NOTIFICATIONS);
    const push: number = notifications.links.indexOf(
      "/admin/settings/push-notifications",
    );

    expect(expandedTitles()).toEqual([BASIC, NOTIFICATIONS]);
    expect(notifications.lit).toEqual(["/admin/settings/push-notifications"]);
    expect(push).toBeGreaterThan(-1);
    expect(notifications.links[push + 1]).toBe(
      "/admin/settings/custom-channels",
    );
  });

  /*
   * The docs walk an admin here as the menu draws it: Settings, then
   * Notifications > Custom Channels, Notifications starting folded. Core's
   * docs facts hold the step to core's menu and to every translation; this
   * holds it to the real plugin, which only an Enterprise checkout has.
   */
  test("the docs walk an admin to it as the menu draws it, Notifications starting folded", () => {
    const adminEnglish: {
      navbar: { settings: string };
      sideMenu: { settingsNotifications: string };
    } = JSON.parse(
      fs.readFileSync(
        path.join(ADMIN_DASHBOARD_SRC, "Locales", "en.json"),
        "utf8",
      ),
    );
    const docs: string = fs.readFileSync(
      path.join(
        EE_DIR,
        "..",
        "packages",
        "App",
        "FeatureSet",
        "Docs",
        "Content",
        "en",
        "self-hosted",
        "custom-notification-channels.md",
      ),
      "utf8",
    );
    const settings: string = adminEnglish.navbar.settings;
    const notifications: string = adminEnglish.sideMenu.settingsNotifications;

    goTo("/admin/settings/authentication");

    render(<SettingsSideMenu />);

    const section: DrawnSection = drawnSection(NOTIFICATIONS);

    expect(section.expanded).toBe(false);
    expect(section.links[section.links.length - 1]).toBe(
      "/admin/settings/custom-channels",
    );
    expect(drawnSection(BASIC).links).not.toContain(
      "/admin/settings/custom-channels",
    );
    expect(docs).toContain(
      `open **${settings}**, then **${notifications} > ${CUSTOM_CHANNELS_SETTINGS_PAGE_TITLE}** in the side menu (**${notifications}** starts folded)`,
    );
  });

  test("on a phone, the opened menu shows Notifications open with Custom Channels lit", () => {
    setViewportWidth(375);
    goTo("/admin/settings/custom-channels");

    render(<SettingsSideMenu />);

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    expect(expandedTitles()).toEqual([BASIC, NOTIFICATIONS]);
    expect(drawnSection(NOTIFICATIONS).lit).toEqual([
      "/admin/settings/custom-channels",
    ]);
  });
});

describe("the Community build", () => {
  test("has no Custom Channels page: its plugin stub is empty", () => {
    expect(AdminCommunityPlugins).toEqual({});
    expect(AdminCommunityPlugins.SettingsPages).toBeUndefined();
    expect(AdminCommunityPlugins.SettingsSideMenuItems).toBeUndefined();
    expect(
      AdminCommunityPlugins.SettingsNotificationSideMenuItems,
    ).toBeUndefined();
  });

  test("the page core used to have is gone", () => {
    expect(
      fs.existsSync(
        path.join(ADMIN_DASHBOARD_SRC, "Pages", "Settings", "CustomChannels"),
      ),
    ).toBe(false);
  });

  test("core never names the page: it is the Enterprise plugin's alone", () => {
    for (const file of sourceFilesOf(ADMIN_DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      expect({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        namesCustomChannels: NAMES_CUSTOM_CHANNELS_PAGE.test(source),
      }).toEqual({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        namesCustomChannels: false,
      });
    }
  });
});

describe("what the page's files import", () => {
  test("only Common, the Admin Dashboard's internals, the Enterprise UI's license helpers and notice, React and each other", () => {
    const allowed: Array<RegExp> = [
      /^\.\//,
      /^\.\.\/\.\.\/Dashboard\/Identity\/License\/(EnterpriseLicenseMode|UseEnterpriseLicenseMode)$/,
      /^\.\.\/\.\.\/Dashboard\/EnterpriseSettings\/EnterpriseSettingLicenseNotice$/,
      /^Common\//,
      /^@oneuptime\/admin-dashboard\//,
      /^react$/,
      /^react-i18next$/,
    ];
    const problems: Array<string> = [];

    for (const file of sourceFilesOf(CUSTOM_CHANNELS_DIR)) {
      for (const specifier of importsOf(file)) {
        if (
          !allowed.some((pattern: RegExp): boolean => {
            return pattern.test(specifier);
          })
        ) {
          problems.push(`${path.basename(file)}: ${specifier}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  test("never the Dashboard's internals: the Admin Dashboard's build cannot resolve them", () => {
    const borrowed: Array<string> = [
      path.join(
        EE_DIR,
        "Dashboard",
        "Identity",
        "License",
        "EnterpriseLicenseMode.ts",
      ),
      path.join(
        EE_DIR,
        "Dashboard",
        "Identity",
        "License",
        "UseEnterpriseLicenseMode.ts",
      ),
      path.join(
        EE_DIR,
        "Dashboard",
        "EnterpriseSettings",
        "EnterpriseSettingLicenseNotice.tsx",
      ),
    ];

    for (const file of [...sourceFilesOf(CUSTOM_CHANNELS_DIR), ...borrowed]) {
      expect({
        file: path.basename(file),
        imports: importsOf(file).filter((specifier: string): boolean => {
          return specifier.startsWith("@oneuptime/dashboard/");
        }),
      }).toEqual({ file: path.basename(file), imports: [] });
    }
  });
});
