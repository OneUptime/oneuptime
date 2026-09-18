import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

/*
 * Team compliance: the team's Compliance page and the member compliance
 * status table.
 *
 * Each value should be `React.lazy(() => import("./..."))`. Import core
 * through "@oneuptime/dashboard/..." and "Common/..." only, and never import
 * a core shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 */
type TeamCompliancePluginKeys = "TeamCompliance" | "TeamComplianceStatusTable";

const TeamCompliancePlugins: Pick<
  DashboardEnterprisePlugins,
  TeamCompliancePluginKeys
> = {};

export default TeamCompliancePlugins;
