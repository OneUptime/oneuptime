import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * Backups in the Enterprise Admin Dashboard plugin, as the Enterprise image
 * builds it ("@oneuptime/ee-admin-dashboard" is the REAL ee plugin here):
 *
 *   - Settings > Backups is a page at /admin/settings/backups, downloaded
 *     only when it is opened, and an entry in the Settings side menu after
 *     Audit Log Export - on every Enterprise installation, whatever the
 *     license (the page says what a license that leaves backups out stops);
 *   - the Community build has none of it: its plugin stub is empty, and
 *     core never names the page;
 *   - the page's files reach core only through Common/... and
 *     "@oneuptime/admin-dashboard/...", and the Enterprise UI's own license
 *     helpers - never an npm package ee does not depend on.
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
import BackupsPlugins from "../../../AdminDashboard/Backups/Plugins";
import BackupsSideMenuItem from "../../../AdminDashboard/Backups/BackupsSideMenuItem";
import {
  BACKUPS_SETTINGS_PAGE_PATH,
  BACKUPS_SETTINGS_PAGE_TITLE,
} from "../../../AdminDashboard/Backups/BackupsPaths";
import { EnterpriseSettingsSideMenuItems } from "../../../AdminDashboard/EnterpriseSettings";
import AdminCommunityPlugins from "@oneuptime/admin-dashboard/Enterprise/CommunityPlugins";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import Navigation from "Common/UI/Utils/Navigation";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const BACKUPS_DIR: string = path.join(EE_DIR, "AdminDashboard", "Backups");
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
// The page's files, or its address.
const NAMES_BACKUPS_PAGE: RegExp = /AdminDashboard\/Backups|settings\/backups/;
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

describe("Settings > Backups in the Enterprise Admin Dashboard", () => {
  test("is a page at /admin/settings/backups, downloaded only when it opens", async () => {
    const pages: ReadonlyArray<EnterpriseSettingsPage> =
      BackupsPlugins.SettingsPages || [];

    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe(BACKUPS_SETTINGS_PAGE_PATH);
    expect(getEnterpriseSettingsPageRoute(pages[0]!.path).toString()).toBe(
      "/admin/settings/backups",
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
          "../../../AdminDashboard/Backups/BackupsSettingsPage"
        )) as { default: unknown }
      ).default,
    );
  });

  test("is part of the plugin the Enterprise image builds, with its side menu entry", () => {
    expect(AdminEnterprisePlugins.SettingsPages).toEqual(
      expect.arrayContaining([...(BackupsPlugins.SettingsPages || [])]),
    );
    expect(BackupsPlugins.SettingsSideMenuItems).toBe(BackupsSideMenuItem);
  });

  test("its side menu entry links to the page, with no license asked for", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<BackupsSideMenuItem />);

    expect(
      screen.getByText(BACKUPS_SETTINGS_PAGE_TITLE).closest("a"),
    ).toHaveAttribute("href", "/admin/settings/backups");
  });

  test("core's Settings side menu shows it after Audit Log Export", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SettingsSideMenu />);

    const backups: HTMLElement = screen.getByText("Backups");
    const auditLogExport: HTMLElement = screen.getByText("Audit Log Export");

    expect(backups.closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/backups",
    );
    expect(
      auditLogExport.compareDocumentPosition(backups) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the Enterprise settings entries draw it whatever White Label's license says", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsSideMenuItems />);

    expect(screen.getByText("Backups")).toBeInTheDocument();
  });
});

describe("the Community build", () => {
  test("has no Backups page: its plugin stub is empty", () => {
    expect(AdminCommunityPlugins).toEqual({});
    expect(AdminCommunityPlugins.SettingsPages).toBeUndefined();
  });

  test("core never names the page: it is the Enterprise plugin's alone", () => {
    for (const file of sourceFilesOf(ADMIN_DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      expect({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        importsBackups: NAMES_BACKUPS_PAGE.test(source),
      }).toEqual({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        importsBackups: false,
      });
    }
  });
});

describe("what the page's files import", () => {
  test("only Common, the Admin Dashboard's internals, the Enterprise UI's license helpers, React and each other", () => {
    const allowed: Array<RegExp> = [
      /^\.\//,
      /^\.\.\/\.\.\/Dashboard\/Identity\/License\//,
      /^\.\.\/\.\.\/Dashboard\/AuditLogExport\/AuditLogExportTest$/,
      /^Common\//,
      /^@oneuptime\/admin-dashboard\//,
      /^react$/,
      /^react-i18next$/,
    ];
    const problems: Array<string> = [];

    for (const file of sourceFilesOf(BACKUPS_DIR)) {
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
    for (const file of sourceFilesOf(BACKUPS_DIR)) {
      expect(importsOf(file).join("\n")).not.toMatch(/@oneuptime\/dashboard\//);
    }
  });

  test("the Admin Dashboard's type check covers what the page borrows from the Dashboard's area", () => {
    const tsconfig: string = fs.readFileSync(
      path.join(EE_DIR, "AdminDashboard", "tsconfig.json"),
      "utf8",
    );

    expect(tsconfig).toContain(
      '"../Dashboard/AuditLogExport/AuditLogExportTest',
    );
  });
});
