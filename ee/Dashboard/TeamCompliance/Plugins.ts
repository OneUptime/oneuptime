import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Team compliance: the team's Compliance page. The member compliance status
 * table is not a plugin key of its own - only that page shows it, and the page
 * imports it from this directory.
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import a core
 * shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 */
type TeamCompliancePluginKeys = "TeamCompliance";

const TeamCompliancePlugins: Pick<
  DashboardEnterprisePlugins,
  TeamCompliancePluginKeys
> = {
  TeamCompliance: lazy(() => {
    return import("./Compliance");
  }),
};

export default TeamCompliancePlugins;
