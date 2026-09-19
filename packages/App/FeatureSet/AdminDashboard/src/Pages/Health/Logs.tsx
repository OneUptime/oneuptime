import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

// Diagnostic logs: Enterprise Edition.
const HealthLogs: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Diagnostic Logs"
      currentRoute={RouteMap[PageMap.HEALTH_LOGS] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthLogs}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="Diagnostic logs"
              featureDescription="This app instance's own recent log lines, plus the closest in-app equivalents from Postgres, ClickHouse and Valkey."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthLogs;
