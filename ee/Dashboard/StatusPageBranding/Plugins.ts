import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Status page branding: the switch that hides Powered by OneUptime from a
 * status page's footer, on its Advanced Settings.
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import the core
 * StatusPagePoweredBySettings shell back - it reads these plugins, and that
 * cycle crashes the Enterprise bundle (see src/Enterprise/Plugins.ts).
 */
type StatusPageBrandingPluginKeys = "StatusPagePoweredBy";

const StatusPageBrandingPlugins: Pick<
  DashboardEnterprisePlugins,
  StatusPageBrandingPluginKeys
> = {
  StatusPagePoweredBy: lazy(() => {
    return import("./PoweredByCard");
  }),
};

export default StatusPageBrandingPlugins;
