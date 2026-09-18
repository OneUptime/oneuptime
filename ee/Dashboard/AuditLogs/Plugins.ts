import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

/*
 * Audit logs: the body of the shared audit log table and the Settings page
 * that switches recording on.
 *
 * Each value should be `React.lazy(() => import("./..."))`, so the audit log
 * table's code downloads only where a table is shown. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import the core
 * AuditLogsTable shell back - it reads these plugins, and that cycle crashes
 * the Enterprise bundle (see src/Enterprise/Plugins.ts).
 */
type AuditLogsPluginKeys = "AuditLogsTable" | "SettingsAuditLogsSettings";

const AuditLogsPlugins: Pick<DashboardEnterprisePlugins, AuditLogsPluginKeys> =
  {};

export default AuditLogsPlugins;
