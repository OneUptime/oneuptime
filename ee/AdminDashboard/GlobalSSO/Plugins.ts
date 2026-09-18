import {
  AdminDashboardEnterprisePlugins,
  EnterprisePluginComponent,
  NoPluginProps,
} from "@oneuptime/admin-dashboard/Enterprise/EnterprisePlugins";
import React, { ComponentType } from "react";

/*
 * Instance-wide SAML SSO and OIDC providers (Settings > Global SSO / OIDC).
 *
 * Each value is React.lazy, so a screen downloads the first time somebody
 * opens it. Import core through "@oneuptime/admin-dashboard/..." and
 * "Common/..." only, and never import a core shell that itself reads the
 * plugins (see src/Enterprise/Plugins.ts).
 */
export type GlobalSSOPluginKey =
  | "GlobalSSOList"
  | "GlobalSSOView"
  | "GlobalOIDCList"
  | "GlobalOIDCView";

export type GlobalSSOPageLoader = () => Promise<{
  default: ComponentType<NoPluginProps>;
}>;

/*
 * Where each screen lives. Kept apart from the lazy components so a test can
 * prove every key loads the page it names without reaching into React.lazy.
 */
export const GLOBAL_SSO_PAGE_LOADERS: Record<
  GlobalSSOPluginKey,
  GlobalSSOPageLoader
> = {
  GlobalSSOList: () => {
    return import("./Pages/GlobalSSO/Index");
  },
  GlobalSSOView: () => {
    return import("./Pages/GlobalSSO/View");
  },
  GlobalOIDCList: () => {
    return import("./Pages/GlobalOIDC/Index");
  },
  GlobalOIDCView: () => {
    return import("./Pages/GlobalOIDC/View");
  },
};

const lazyPage: (loader: GlobalSSOPageLoader) => EnterprisePluginComponent = (
  loader: GlobalSSOPageLoader,
): EnterprisePluginComponent => {
  return React.lazy(loader);
};

const GlobalSSOPlugins: Pick<
  AdminDashboardEnterprisePlugins,
  GlobalSSOPluginKey
> = {
  GlobalSSOList: lazyPage(GLOBAL_SSO_PAGE_LOADERS.GlobalSSOList),
  GlobalSSOView: lazyPage(GLOBAL_SSO_PAGE_LOADERS.GlobalSSOView),
  GlobalOIDCList: lazyPage(GLOBAL_SSO_PAGE_LOADERS.GlobalOIDCList),
  GlobalOIDCView: lazyPage(GLOBAL_SSO_PAGE_LOADERS.GlobalOIDCView),
};

export default GlobalSSOPlugins;
