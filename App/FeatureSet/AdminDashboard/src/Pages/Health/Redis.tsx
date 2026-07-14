import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import HealthPage from "./HealthPage";
import RedisHealth from "./RedisHealth";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const HealthRedis: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="Redis"
      currentRoute={RouteMap[PageMap.HEALTH_REDIS] as Route}
      enterpriseOnly={true}
      enterpriseFeatureName="Redis health"
      enterpriseFeatureDescription="Connectivity and memory capacity for the Redis backing this instance."
    >
      <RedisHealth />
    </HealthPage>
  );
};

export default HealthRedis;
