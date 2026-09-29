import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

// PostgreSQL cluster health and its notifications: Enterprise Edition.
const HealthPostgres: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="PostgreSQL"
      currentRoute={RouteMap[PageMap.HEALTH_POSTGRES] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthPostgres}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="PostgreSQL cluster health"
              featureDescription="Replication lag, slot health, connection saturation, lock pressure, cache-hit ratio and transaction-ID wraparound headroom for the Postgres backing this instance."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthPostgres;
