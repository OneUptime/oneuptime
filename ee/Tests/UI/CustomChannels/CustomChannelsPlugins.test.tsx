import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
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
    expect(CustomChannelsPlugins.SettingsSideMenuItems).toBeUndefined();
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
