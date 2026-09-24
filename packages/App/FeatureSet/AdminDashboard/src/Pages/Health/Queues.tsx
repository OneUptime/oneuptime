import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Background queue health is an Enterprise Edition feature: the queue table
 * and failed-job drill-in ship in the enterprise plugin, and the Community
 * Edition shows the upsell in the same layout.
 */
const HealthQueues: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Background Queues"
      currentRoute={RouteMap[PageMap.HEALTH_QUEUES] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthQueues}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="Background queue health"
              featureDescription="Job backlog and failures across the BullMQ workers, with a drill-in to the recent failed-job logs for any queue reporting failures."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthQueues;
