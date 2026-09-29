import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

// Valkey health and its notifications: Enterprise Edition.
const HealthRedis: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Valkey"
      currentRoute={RouteMap[PageMap.HEALTH_REDIS] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthRedis}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="Valkey health"
              featureDescription="Connectivity and memory capacity for the Valkey backing this instance."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthRedis;
