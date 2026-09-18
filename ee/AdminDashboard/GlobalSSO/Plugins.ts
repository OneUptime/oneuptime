import { AdminDashboardEnterprisePlugins } from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";

/*
 * Instance-wide SAML SSO and OIDC providers (Settings > Global SSO / OIDC).
 *
 * Each value should be `React.lazy(() => import("./..."))`, so a screen
 * downloads the first time somebody opens it. Import core through
 * "@oneuptime/admin-dashboard/..." and "Common/..." only, and never import a
 * core shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 */
type GlobalSSOPluginKeys =
  | "GlobalSSOList"
  | "GlobalSSOView"
  | "GlobalOIDCList"
  | "GlobalOIDCView";

const GlobalSSOPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  GlobalSSOPluginKeys
> = {};

export default GlobalSSOPlugins;
