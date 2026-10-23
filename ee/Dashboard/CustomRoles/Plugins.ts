import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import { lazy } from "react";

/*
 * Custom roles: Teams > Settings > Roles (the project's custom roles), a
 * role's own page (its permissions and the teams and API keys given it),
 * and the custom roles card on a team's Permissions page and on an API
 * key's page. The built-in roles stay in core.
 *
 * Each value is `React.lazy(() => import("./..."))`. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import a core
 * shell that reads these plugins (Pages/Teams/Roles, Pages/Teams/RoleView,
 * Components/Team/TeamCustomRolesSettings, Components/ApiKey
 * /ApiKeyCustomRolesSettings) back - that cycle crashes the Enterprise
 * bundle (see src/Enterprise/Plugins.ts).
 */
type CustomRolesPluginKeys =
  | "TeamRoles"
  | "TeamRoleView"
  | "TeamCustomRoles"
  | "ApiKeyCustomRoles";

const CustomRolesPlugins: Pick<
  DashboardEnterprisePlugins,
  CustomRolesPluginKeys
> = {
  TeamRoles: lazy(() => {
    return import("./RolesPage");
  }),
  TeamRoleView: lazy(() => {
    return import("./RoleViewPage");
  }),
  TeamCustomRoles: lazy(() => {
    return import("./TeamCustomRoleTable");
  }),
  ApiKeyCustomRoles: lazy(() => {
    return import("./ApiKeyCustomRoleTable");
  }),
};

export default CustomRolesPlugins;
