import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";

/*
 * Enterprise license management - the OneUptime Cloud license server's admin
 * screens (the license list and one license).
 *
 * Each value should be `React.lazy(() => import("./..."))`. Import core
 * through "@oneuptime/admin-dashboard/..." and "Common/..." only, and never
 * import a core shell that itself reads the plugins (see
 * src/Enterprise/Plugins.ts).
 */
type EnterpriseLicensesPluginKeys =
  | "EnterpriseLicensesList"
  | "EnterpriseLicenseView";

const EnterpriseLicensesPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  EnterpriseLicensesPluginKeys
> = {};

export default EnterpriseLicensesPlugins;
