import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * Session Length in the Enterprise Admin Dashboard plugin, as the
 * Enterprise image builds it ("@oneuptime/ee-admin-dashboard" is the REAL
 * ee plugin here):
 *
 *   - Settings > Session Length is a page at /admin/settings/session-length,
 *     downloaded only when it is opened, and an entry in the Settings side
 *     menu right after License - on every Enterprise installation, whatever
 *     the license (the page says what a license that leaves it out stops);
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
import { EnterpriseSettingsSideMenuItems } from "../../../AdminDashboard/EnterpriseSettings";
import SessionLengthPlugins from "../../../AdminDashboard/SessionLength/Plugins";
import SessionLengthSideMenuItem from "../../../AdminDashboard/SessionLength/SessionLengthSideMenuItem";
import {
  SESSION_LENGTH_SETTINGS_PAGE_PATH,
  SESSION_LENGTH_SETTINGS_PAGE_TITLE,
} from "../../../AdminDashboard/SessionLength/SessionLengthPaths";
import AdminCommunityPlugins from "@oneuptime/admin-dashboard/Enterprise/CommunityPlugins";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import { LICENSE_SETTINGS_PAGE_PATH } from "Common/UI/Components/EditionLabel/LicenseSettingsPage";
import Navigation from "Common/UI/Utils/Navigation";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SESSION_LENGTH_DIR: string = path.join(
  EE_DIR,
  "AdminDashboard",
  "SessionLength",
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
// The page's files, or its address.
const NAMES_SESSION_LENGTH_PAGE: RegExp =
  /AdminDashboard\/SessionLength|settings\/session-length/;
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

describe("Settings > Session Length in the Enterprise Admin Dashboard", () => {
  test("is a page at /admin/settings/session-length, downloaded only when it opens", async () => {
    const pages: ReadonlyArray<EnterpriseSettingsPage> =
      SessionLengthPlugins.SettingsPages || [];

    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe(SESSION_LENGTH_SETTINGS_PAGE_PATH);
    expect(getEnterpriseSettingsPageRoute(pages[0]!.path).toString()).toBe(
      "/admin/settings/session-length",
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
          "../../../AdminDashboard/SessionLength/SessionLengthSettingsPage"
        )) as { default: unknown }
      ).default,
    );
  });

  test("is part of the plugin the Enterprise image builds, with its side menu entry", () => {
    expect(AdminEnterprisePlugins.SettingsPages).toEqual(
      expect.arrayContaining([...(SessionLengthPlugins.SettingsPages || [])]),
    );
    expect(SessionLengthPlugins.SettingsSideMenuItems).toBe(
      SessionLengthSideMenuItem,
    );
  });

  test("its side menu entry is named Session Length and links to the page", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SessionLengthSideMenuItem />);

    expect(SESSION_LENGTH_SETTINGS_PAGE_TITLE).toBe("Session Length");
    expect(
      screen.getByText(SESSION_LENGTH_SETTINGS_PAGE_TITLE).closest("a"),
    ).toHaveAttribute("href", "/admin/settings/session-length");
  });

  test("core's Settings side menu shows it after the sign-in settings and before Audit Log Export", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SettingsSideMenu />);

    const sessionLength: HTMLElement = screen.getByText("Session Length");
    // With react-i18next stubbed, core's entries read as their keys.
    const authentication: HTMLElement = screen.getAllByText(
      "sideMenu.settingsAuthentication",
    )[0] as HTMLElement;
    const auditLogExport: HTMLElement = screen.getByText("Audit Log Export");

    expect(sessionLength.closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/session-length",
    );
    expect(
      authentication.compareDocumentPosition(sessionLength) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sessionLength.compareDocumentPosition(auditLogExport) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("among the Enterprise settings it comes right after License (AuditLogExportPlugins.test.tsx pins the whole order)", () => {
    const paths: Array<string> = (
      AdminEnterprisePlugins.SettingsPages || []
    ).map((page: EnterpriseSettingsPage): string => {
      return page.path;
    });

    expect(paths.indexOf(SESSION_LENGTH_SETTINGS_PAGE_PATH)).toBe(
      paths.indexOf(LICENSE_SETTINGS_PAGE_PATH) + 1,
    );
  });

  test("the Enterprise settings entries draw it whatever the license says", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsSideMenuItems />);

    expect(screen.getByText("Session Length")).toBeInTheDocument();
  });
});

describe("the Community build", () => {
  test("has no Session Length page: its plugin stub is empty", () => {
    expect(AdminCommunityPlugins).toEqual({});
    expect(AdminCommunityPlugins.SettingsPages).toBeUndefined();
  });

  test("core never names the page: it is the Enterprise plugin's alone", () => {
    for (const file of sourceFilesOf(ADMIN_DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      expect({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        namesSessionLengthPage: NAMES_SESSION_LENGTH_PAGE.test(source),
      }).toEqual({
        file: path.relative(ADMIN_DASHBOARD_SRC, file),
        namesSessionLengthPage: false,
      });
    }
  });
});

describe("what the page's files import", () => {
  test("only Common, the Admin Dashboard's internals, the Enterprise UI's license helpers, React and each other", () => {
    const allowed: Array<RegExp> = [
      /^\.\//,
      /^\.\.\/\.\.\/Dashboard\/Identity\/License\//,
      /^\.\.\/\.\.\/Dashboard\/EnterpriseSettings\/EnterpriseSettingLicenseNotice$/,
      /^Common\//,
      /^@oneuptime\/admin-dashboard\//,
      /^react$/,
      /^react-i18next$/,
    ];
    const problems: Array<string> = [];

    for (const file of sourceFilesOf(SESSION_LENGTH_DIR)) {
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

  test("never the Dashboard's internals, nor do the files it borrows: the Admin Dashboard's build cannot resolve them", () => {
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

    for (const file of [...sourceFilesOf(SESSION_LENGTH_DIR), ...borrowed]) {
      expect({
        file: path.basename(file),
        imports: importsOf(file).filter((specifier: string): boolean => {
          return specifier.startsWith("@oneuptime/dashboard/");
        }),
      }).toEqual({ file: path.basename(file), imports: [] });
    }
  });
});
