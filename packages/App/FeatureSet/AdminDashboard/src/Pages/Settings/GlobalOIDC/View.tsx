import GlobalOIDCUpsell from "./GlobalOIDCUpsell";
import EnterprisePluginPage from "../../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../../Enterprise/Plugins";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Settings > Global OIDC > one provider: its configuration and attached projects.
 *
 * The screen is part of the Enterprise Edition (ee/AdminDashboard/GlobalSSO).
 * This shell keeps the route and the page module where they were: it renders
 * the Enterprise screen on the Enterprise Edition, and the upsell otherwise.
 */
const GlobalOIDCView: FunctionComponent = (): ReactElement => {
  return (
    <EnterprisePluginPage
      plugin={getAdminDashboardPlugins().GlobalOIDCView}
      renderUpsell={(): ReactElement => {
        return <GlobalOIDCUpsell />;
      }}
    />
  );
};

export default GlobalOIDCView;
