import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import InstanceHealthLogs from "./InstanceHealthLogs";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The instance health log is available on every edition: it is the audit
 * trail of the ClickHouse capacity notifications and automatic pruning runs,
 * which are Community Edition features (pruning drops telemetry partitions,
 * and this is where an operator sees what it dropped and why). On the
 * Enterprise Edition it also lists the PostgreSQL and Valkey notifications.
 */
const HealthInstanceLogs: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Instance Logs"
      currentRoute={RouteMap[PageMap.HEALTH_INSTANCE_LOGS] as Route}
    >
      <InstanceHealthLogs />
    </HealthPage>
  );
};

export default HealthInstanceLogs;
