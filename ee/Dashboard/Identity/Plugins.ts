import {
  DashboardEnterprisePlugins,
  EnterprisePluginComponent,
} from "@oneuptime/dashboard/Enterprise/EnterprisePlugins";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import React, { ComponentType } from "react";

/*
 * SCIM user provisioning screens: project settings and status pages, each
 * with its SCIM logs. (Single sign-on is not here: its screens are part of
 * the core Dashboard in every edition.)
 *
 * Each value is React.lazy, so a screen downloads the first time somebody
 * opens it. Import core through "@oneuptime/dashboard/..." and "Common/..."
 * only, and never import a core shell that itself reads the plugins (see
 * src/Enterprise/Plugins.ts).
 */
export type IdentityPluginKey = "SettingsSCIM" | "StatusPageSCIM";

export type IdentityPageLoader = () => Promise<{
  default: ComponentType<PageComponentProps>;
}>;

/*
 * Where each screen lives. Kept apart from the lazy components so a test can
 * prove every key loads the page it names without reaching into React.lazy.
 */
export const IDENTITY_PAGE_LOADERS: Record<
  IdentityPluginKey,
  IdentityPageLoader
> = {
  SettingsSCIM: () => {
    return import("./Pages/Settings/SCIM");
  },
  StatusPageSCIM: () => {
    return import("./Pages/StatusPages/SCIM");
  },
};

const lazyPage: (
  loader: IdentityPageLoader,
) => EnterprisePluginComponent<PageComponentProps> = (
  loader: IdentityPageLoader,
): EnterprisePluginComponent<PageComponentProps> => {
  return React.lazy(loader);
};

const IdentityPlugins: Pick<DashboardEnterprisePlugins, IdentityPluginKey> = {
  SettingsSCIM: lazyPage(IDENTITY_PAGE_LOADERS.SettingsSCIM),
  StatusPageSCIM: lazyPage(IDENTITY_PAGE_LOADERS.StatusPageSCIM),
};

export default IdentityPlugins;
