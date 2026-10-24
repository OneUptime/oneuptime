import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";
import { AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH } from "./AuditLogExportPaths";
import AuditLogExportSideMenuItem from "./AuditLogExportSideMenuItem";

/*
 * Audit log export for the whole instance: Settings > Audit Log Export,
 * where master admins send the audit log of every project to storage or a
 * service of their choosing (ee/Server/AuditLogExport sends it).
 *
 * The page is lazy, so its code downloads only when it is opened. Merged
 * with the other Enterprise settings pages in ../EnterpriseSettings.
 */
type AuditLogExportPluginKeys = "SettingsPages" | "SettingsSideMenuItems";

const AuditLogExportPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  AuditLogExportPluginKeys
> = {
  SettingsPages: [
    {
      path: AUDIT_LOG_EXPORT_SETTINGS_PAGE_PATH,
      component: lazy(() => {
        return import("./AuditLogExportSettingsPage");
      }),
    },
  ],
  SettingsSideMenuItems: AuditLogExportSideMenuItem,
};

export default AuditLogExportPlugins;
