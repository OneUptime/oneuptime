import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Retention overrides: the project's retention by telemetry type on
 * Settings > Telemetry, and the retention cards of every service and
 * telemetry resource Settings page. The project's default retention is core.
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import the core
 * TelemetryResourceRetentionSettings shell back - it reads these plugins, and
 * that cycle crashes the Enterprise bundle (see src/Enterprise/Plugins.ts).
 */
type TelemetryRetentionPluginKeys =
  | "SettingsTelemetryRetentionByType"
  | "TelemetryResourceRetentionSettings";

const TelemetryRetentionPlugins: Pick<
  DashboardEnterprisePlugins,
  TelemetryRetentionPluginKeys
> = {
  SettingsTelemetryRetentionByType: lazy(() => {
    return import("./ProjectTelemetryRetentionByType");
  }),
  TelemetryResourceRetentionSettings: lazy(() => {
    return import("./TelemetryResourceRetentionSettings");
  }),
};

export default TelemetryRetentionPlugins;
