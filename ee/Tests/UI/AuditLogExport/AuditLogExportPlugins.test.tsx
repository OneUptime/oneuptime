import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * Audit log export in the two Enterprise plugins, as the Enterprise image
 * builds them ("@oneuptime/ee-dashboard" and "@oneuptime/ee-admin-dashboard"
 * are the REAL ee plugins here):
 *
 *   - the Dashboard plugin hands the core shell of Settings > Audit Logs >
 *     Export its page, lazily;
 *   - the Admin Dashboard plugin adds Settings > Audit Log Export - a page
 *     at /admin/settings/audit-log-export, lazy, and its side menu entry -
 *     merged with Backups' and White Label's, so none hides another;
 *   - the table, form and test both frontends render import Common/... only:
 *     each frontend's build resolves "@oneuptime/dashboard" or
 *     "@oneuptime/admin-dashboard", never both.
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

import Navigation from "Common/UI/Utils/Navigation";
import DashboardEnterprisePlugins from "../../../Dashboard/Index";
import DashboardAuditLogExportPlugins from "../../../Dashboard/AuditLogExport/Plugins";
import AdminEnterprisePlugins from "../../../AdminDashboard/Index";
import AdminAuditLogExportPlugins from "../../../AdminDashboard/AuditLogExport/Plugins";
import { AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH } from "../../../AdminDashboard/AuditLogExport/AuditLogExportPaths";
import { BACKUPS_SETTINGS_PAGE_PATH } from "../../../AdminDashboard/Backups/BackupsPaths";
import { CUSTOM_CHANNELS_SETTINGS_PAGE_PATH } from "../../../AdminDashboard/CustomChannels/CustomChannelsPaths";
import {
  ENTERPRISE_SETTINGS_PAGES,
  EnterpriseSettingsSideMenuItems,
} from "../../../AdminDashboard/EnterpriseSettings";
import { WHITE_LABEL_SETTINGS_PAGE_PATH } from "../../../AdminDashboard/WhiteLabel/WhiteLabelSettingsAPI";
import {
  EnterpriseSettingsPage,
  getEnterpriseSettingsPageRoute,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import SettingsSideMenu from "@oneuptime/admin-dashboard/Pages/Settings/SideMenu";
import { DASHBOARD_ENTERPRISE_PLUGIN_KEYS } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

const EE_DIR: string = path.resolve(__dirname, "..", "..", "..");

// What both frontends bundle, from ee/Dashboard/AuditLogExport.
const SHARED_FILES: Array<string> = [
  "AuditLogExportCopy.ts",
  "AuditLogExportForm.ts",
  "AuditLogExportFormModal.tsx",
  "AuditLogExportLicenseNotice.tsx",
  "AuditLogExportTable.tsx",
  "AuditLogExportTest.tsx",
];

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Dashboard plugin", () => {
  test("Settings > Audit Logs > Export is a plugin key of the contract", () => {
    expect(DASHBOARD_ENTERPRISE_PLUGIN_KEYS).toContain(
      "SettingsAuditLogExport",
    );
  });

  test("hands the shell the export page, downloaded only when it opens", async () => {
    const page: unknown = DashboardAuditLogExportPlugins.SettingsAuditLogExport;

    // React.lazy: an exotic component, not a plain function.
    expect(typeof page).toBe("object");
    expect(DashboardEnterprisePlugins.SettingsAuditLogExport).toBe(page);

    const lazy: { _payload: { _result: () => Promise<{ default: unknown }> } } =
      page as { _payload: { _result: () => Promise<{ default: unknown }> } };
    const loaded: { default: unknown } = await lazy._payload._result();

    expect(loaded.default).toBe(
      (
        (await import(
          "../../../Dashboard/AuditLogExport/AuditLogExportSettings"
        )) as { default: unknown }
      ).default,
    );
  });
});

describe("the Admin Dashboard plugin", () => {
  test("adds Settings > Audit Log Export at /admin/settings/audit-log-export, lazily", () => {
    const pages: ReadonlyArray<EnterpriseSettingsPage> =
      AdminAuditLogExportPlugins.SettingsPages || [];

    expect(pages).toHaveLength(1);
    expect(pages[0]!.path).toBe(AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH);
    expect(getEnterpriseSettingsPageRoute(pages[0]!.path).toString()).toBe(
      "/admin/settings/audit-log-export",
    );
    expect(typeof pages[0]!.component).toBe("object");
  });

  test("merges its page with Backups', Custom Channels' and White Label's: the plugin keeps them all", () => {
    expect(
      ENTERPRISE_SETTINGS_PAGES.map((page: EnterpriseSettingsPage) => {
        return page.path;
      }),
    ).toEqual([
      AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH,
      BACKUPS_SETTINGS_PAGE_PATH,
      CUSTOM_CHANNELS_SETTINGS_PAGE_PATH,
      WHITE_LABEL_SETTINGS_PAGE_PATH,
    ]);
    expect(AdminEnterprisePlugins.SettingsPages).toBe(
      ENTERPRISE_SETTINGS_PAGES,
    );
    expect(AdminEnterprisePlugins.SettingsSideMenuItems).toBe(
      EnterpriseSettingsSideMenuItems,
    );
  });

  test("core's Settings side menu shows Audit Log Export in Basic, after Authentication", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<SettingsSideMenu />);

    const entry: HTMLElement = screen.getByText("Audit Log Export");
    const authentication: HTMLElement = screen.getAllByText(
      "sideMenu.settingsAuthentication",
    )[0] as HTMLElement;

    expect(entry.closest("a")).toHaveAttribute(
      "href",
      "/admin/settings/audit-log-export",
    );
    expect(
      authentication.compareDocumentPosition(entry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("its entry is there without the white-label license, and White Label's is not", () => {
    jest.spyOn(Navigation, "isOnThisPage").mockReturnValue(false);

    render(<EnterpriseSettingsSideMenuItems />);

    expect(screen.getByText("Audit Log Export")).toBeInTheDocument();
    expect(document.querySelector('a[href*="white-label"]')).toBeNull();
  });
});

describe("what both frontends bundle", () => {
  test.each(SHARED_FILES)(
    "Dashboard/AuditLogExport/%s imports neither frontend's internals",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(EE_DIR, "Dashboard", "AuditLogExport", file),
        "utf8",
      );

      expect(source).not.toMatch(/from "@oneuptime\/dashboard\//);
      expect(source).not.toMatch(/from "@oneuptime\/admin-dashboard\//);
    },
  );

  test("the Admin Dashboard's type check covers every shared file", () => {
    const tsconfig: string = fs.readFileSync(
      path.join(EE_DIR, "AdminDashboard", "tsconfig.json"),
      "utf8",
    );

    for (const file of SHARED_FILES) {
      expect(tsconfig).toContain(`"../Dashboard/AuditLogExport/${file}"`);
    }
  });
});
