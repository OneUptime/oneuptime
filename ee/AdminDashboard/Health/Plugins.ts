import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";

/*
 * OneUptime Health: the enterprise dashboards and the query console. The
 * core Health shells keep the page layout and the Community content
 * (ClickHouse capacity, migrations, the support bundle) and render these as
 * the page content.
 *
 * Each value should be `React.lazy(() => import("./..."))`. Import core
 * through "@oneuptime/admin-dashboard/..." and "Common/..." only, and never
 * import a core shell that itself reads the plugins (see
 * src/Enterprise/Plugins.ts).
 */
type HealthPluginKeys =
  | "HealthOverview"
  | "HealthQueues"
  | "HealthInstanceLogs"
  | "HealthPostgres"
  | "HealthRedis"
  | "HealthLogs"
  | "HealthTelemetry"
  | "HealthQueryConsole"
  | "HealthClickhouseCluster";

const HealthPlugins: Pick<AdminDashboardEnterprisePlugins, HealthPluginKeys> =
  {};

export default HealthPlugins;
