import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Telemetry diagnostics for the master admin: what this instance is ingesting,
 * per signal and per project. Enterprise Edition; the two tabs ship in the
 * enterprise plugin.
 */
const HealthTelemetry: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Telemetry"
      currentRoute={RouteMap[PageMap.HEALTH_TELEMETRY] as Route}
    >
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthTelemetry}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="Telemetry ingestion"
              featureDescription="Live log, metric and trace ingestion for this instance — throughput and footprint per signal, and the same windows split by project."
            />
          );
        }}
      />
    </HealthPage>
  );
};

export default HealthTelemetry;
