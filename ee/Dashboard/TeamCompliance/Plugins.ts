import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Team compliance: the team's Compliance page and the member compliance
 * status table.
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import a core
 * shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 */
type TeamCompliancePluginKeys = "TeamCompliance" | "TeamComplianceStatusTable";

const TeamCompliancePlugins: Pick<
  DashboardEnterprisePlugins,
  TeamCompliancePluginKeys
> = {
  TeamCompliance: lazy(() => {
    return import("./Compliance");
  }),
  TeamComplianceStatusTable: lazy(() => {
    return import("./TeamComplianceStatusTable");
  }),
};

export default TeamCompliancePlugins;
