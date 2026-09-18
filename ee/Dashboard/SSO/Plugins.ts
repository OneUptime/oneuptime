import {
  DashboardEnterprisePlugins,
  EnterprisePluginComponent,
} from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import React, { ComponentType } from "react";

/*
 * SAML SSO, OIDC and SCIM screens: project settings and status pages.
 *
 * Each value is React.lazy, so a screen downloads the first time somebody
 * opens it. Import core through "@oneuptime/dashboard/..." and "Common/..."
 * only, and never import a core shell that itself reads the plugins (see
 * src/Enterprise/Plugins.ts).
 */
export type SSOPluginKey =
  | "SettingsSSO"
  | "SettingsOIDC"
  | "SettingsSCIM"
  | "StatusPageSSO"
  | "StatusPageOIDC"
  | "StatusPageSCIM";

export type SSOPageLoader = () => Promise<{
  default: ComponentType<PageComponentProps>;
}>;

/*
 * Where each screen lives. Kept apart from the lazy components so a test can
 * prove every key loads the page it names without reaching into React.lazy.
 */
export const SSO_PAGE_LOADERS: Record<SSOPluginKey, SSOPageLoader> = {
  SettingsSSO: () => {
    return import("./Pages/Settings/SSO");
  },
  SettingsOIDC: () => {
    return import("./Pages/Settings/OIDC");
  },
  SettingsSCIM: () => {
    return import("./Pages/Settings/SCIM");
  },
  StatusPageSSO: () => {
    return import("./Pages/StatusPages/SSO");
  },
  StatusPageOIDC: () => {
    return import("./Pages/StatusPages/OIDC");
  },
  StatusPageSCIM: () => {
    return import("./Pages/StatusPages/SCIM");
  },
};

const lazyPage: (
  loader: SSOPageLoader,
) => EnterprisePluginComponent<PageComponentProps> = (
  loader: SSOPageLoader,
): EnterprisePluginComponent<PageComponentProps> => {
  return React.lazy(loader);
};

const SSOPlugins: Pick<DashboardEnterprisePlugins, SSOPluginKey> = {
  SettingsSSO: lazyPage(SSO_PAGE_LOADERS.SettingsSSO),
  SettingsOIDC: lazyPage(SSO_PAGE_LOADERS.SettingsOIDC),
  SettingsSCIM: lazyPage(SSO_PAGE_LOADERS.SettingsSCIM),
  StatusPageSSO: lazyPage(SSO_PAGE_LOADERS.StatusPageSSO),
  StatusPageOIDC: lazyPage(SSO_PAGE_LOADERS.StatusPageOIDC),
  StatusPageSCIM: lazyPage(SSO_PAGE_LOADERS.StatusPageSCIM),
};

export default SSOPlugins;
