import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import RedisHealth from "./RedisHealth";
import RedisHealthSettings from "./RedisHealthSettings";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthRedis: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Valkey"
      currentRoute={RouteMap[PageMap.HEALTH_REDIS] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Valkey health"
      enterpriseFeatureDescription="Connectivity and memory capacity for the Valkey backing this instance."
    >
      <RedisHealth />
      <RedisHealthSettings />
    </HealthPage>
  );
};

export default HealthRedis;
