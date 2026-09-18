import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import React from "react";

/*
 * OneUptime Health: the enterprise dashboards and the query console. The
 * core Health shells keep the page layout and the Community content
 * (ClickHouse capacity and its settings, the instance log, migrations, the
 * support bundle) and render these as the page content, or an upsell on the
 * Community Edition.
 *
 * Each value is `React.lazy(() => import("./..."))`, so a screen downloads the
 * first time somebody opens it. Import core through
 * "@oneuptime/admin-dashboard/..." and "Common/..." only, and never import a
 * core shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 *
 * HealthInstanceLogs is deliberately not provided: the instance log is the
 * audit trail of ClickHouse capacity notifications and pruning, which are
 * Community features, so core renders it on every edition.
 */
type HealthPluginKeys =
  | "HealthOverview"
  | "HealthQueues"
  | "HealthPostgres"
  | "HealthRedis"
  | "HealthLogs"
  | "HealthTelemetry"
  | "HealthQueryConsole"
  | "HealthClickhouseCluster";

const HealthPlugins: Required<
  Pick<AdminDashboardEnterprisePlugins, HealthPluginKeys>
> = {
  HealthOverview: React.lazy(() => {
    return import("./Overview");
  }),
  HealthQueues: React.lazy(() => {
    return import("./Queues");
  }),
  HealthPostgres: React.lazy(() => {
    return import("./Postgres");
  }),
  HealthRedis: React.lazy(() => {
    return import("./Redis");
  }),
  HealthLogs: React.lazy(() => {
    return import("./DiagnosticLogs");
  }),
  HealthTelemetry: React.lazy(() => {
    return import("./Telemetry");
  }),
  HealthQueryConsole: React.lazy(() => {
    return import("./QueryConsole");
  }),
  HealthClickhouseCluster: React.lazy(() => {
    return import("./ClickhouseCluster");
  }),
};

export default HealthPlugins;
