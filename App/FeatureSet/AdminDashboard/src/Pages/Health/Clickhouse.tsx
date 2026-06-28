import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import ClickhouseCluster from "./ClickhouseCluster";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthClickhouse: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="ClickHouse"
      currentRoute={RouteMap[PageMap.HEALTH_CLICKHOUSE] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="ClickHouse cluster health"
      enterpriseFeatureDescription="Shard reachability, the distributed-DDL queue, replica and replication-queue state and the Keeper connection for the ClickHouse backing this instance."
    >
      <ClickhouseCluster />
    </HealthPage>
  );
};

export default HealthClickhouse;
