import GlobalSSOUpsell from "./GlobalSSOUpsell";
import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > Global SSO: the instance-wide SAML providers.
 *
 * The screen is part of the Enterprise Edition (ee/AdminDashboard/GlobalSSO).
 * This shell keeps the route and the page module where they were: it renders
 * the Enterprise screen on the Enterprise Edition, and the upsell otherwise.
 */
const Settings: FunctionComponent = (): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getAdminDashboardPlugins().GlobalSSOList}
      renderUpsell={(): ReactElement => {
        return <GlobalSSOUpsell />;
      }}
    />
  );
};

export default Settings;
