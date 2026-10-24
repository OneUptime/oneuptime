import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * IP allowlists: the allowlist card of a private status page, a public
 * dashboard and a form. Each page keeps its own words and hands them to the
 * card (Components/IpAllowlist/IpAllowlistSettings).
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import the core
 * IpAllowlistSettings shell back - it reads these plugins, and that cycle
 * crashes the Enterprise bundle (see src/Enterprise/Plugins.ts).
 */
type IpAllowlistPluginKeys = "IpAllowlistCard";

const IpAllowlistPlugins: Pick<
  DashboardEnterprisePlugins,
  IpAllowlistPluginKeys
> = {
  IpAllowlistCard: lazy(() => {
    return import("./IpAllowlistCard");
  }),
};

export default IpAllowlistPlugins;
