import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import InstanceHealthLogs from "./InstanceHealthLogs";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthInstanceLogs: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Instance Logs"
      currentRoute={RouteMap[PageMap.HEALTH_INSTANCE_LOGS] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Instance health log"
      enterpriseFeatureDescription="An audit trail of the capacity notifications and automatic ClickHouse pruning work this instance has performed."
    >
      <InstanceHealthLogs />
    </HealthPage>
  );
};

export default HealthInstanceLogs;
