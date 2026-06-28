import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import DiagnosticLogs from "./DiagnosticLogs";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthLogs: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Diagnostic Logs"
      currentRoute={RouteMap[PageMap.HEALTH_LOGS] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Diagnostic logs"
      enterpriseFeatureDescription="This app instance's own recent log lines, plus the closest in-app equivalents from Postgres, ClickHouse and Redis."
    >
      <DiagnosticLogs />
    </HealthPage>
  );
};

export default HealthLogs;
