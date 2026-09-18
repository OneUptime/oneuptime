import { DashboardEnterprisePlugins } from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";

/*
 * SAML SSO, OIDC and SCIM screens: project settings and status pages.
 *
 * Each value should be `React.lazy(() => import("./Pages/..."))`, so a screen
 * downloads the first time somebody opens it. Import core through
 * "@oneuptime/dashboard/..." and "Common/..." only, and never import a core
 * shell that itself reads the plugins (see src/Enterprise/Plugins.ts).
 */
type SSOPluginKeys =
  | "SettingsSSO"
  | "SettingsOIDC"
  | "SettingsSCIM"
  | "StatusPageSSO"
  | "StatusPageOIDC"
  | "StatusPageSCIM";

const SSOPlugins: Pick<DashboardEnterprisePlugins, SSOPluginKeys> = {};

export default SSOPlugins;
