import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Audit log export: Settings > Audit Logs > Export, where a project's owners
 * and admins send its audit log to storage or a service of their choosing
 * (ee/Server/AuditLogExport sends it).
 *
 * Lazy, so the page's code downloads only when it is opened. The table,
 * form and test in this folder are shared with the Admin Dashboard's
 * instance-wide page (ee/AdminDashboard/AuditLogExport), so they import
 * Common/... only - never "@oneuptime/dashboard/...".
 */
type AuditLogExportPluginKeys = "SettingsAuditLogExport";

const AuditLogExportPlugins: Pick<
  DashboardEnterprisePlugins,
  AuditLogExportPluginKeys
> = {
  SettingsAuditLogExport: lazy(() => {
    return import("./AuditLogExportSettings");
  }),
};

export default AuditLogExportPlugins;
