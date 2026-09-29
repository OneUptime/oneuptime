import RedisHealth from "./RedisHealth";
import RedisHealthSettings from "./RedisHealthSettings";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Health > Valkey content: connectivity and memory capacity, and the settings
 * for the Valkey health notifications the enterprise worker evaluates.
 */
const HealthRedisContent: FunctionComponent = (): ReactElement => {
  return (
    <>
      <RedisHealth />
      <RedisHealthSettings />
    </>
  );
};

export default HealthRedisContent;
