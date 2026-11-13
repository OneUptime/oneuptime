import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import CommunityHealthOverview from "./CommunityHealthOverview";
import { EnterpriseHealthNote } from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import InstallationHealthSummary from "./InstallationHealthSummary";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The OneUptime Health landing page.
 *
 * It opens with what needs attention on this server, in every edition
 * (InstallationHealthSummary, the same findings as `npm run doctor`).
 *
 * Every edition gets ClickHouse capacity at a glance and the tools that need
 * no Enterprise license (capacity and pruning, the instance log, probes,
 * migrations, the support bundle). On top of that, the Enterprise Edition
 * shows its live cluster-health overview (the enterprise plugin), and the
 * Community Edition a short note about it - the page is useful on both, so it
 * is never a full-page upsell.
 */
const Health: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Overview"
      currentRoute={RouteMap[PageMap.HEALTH] as Route}
    >
      <InstallationHealthSummary />
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthOverview}
        renderUpsell={(): ReactElement => {
          return <EnterpriseHealthNote />;
        }}
      />
      <CommunityHealthOverview />
    </HealthPage>
  );
};

export default Health;
