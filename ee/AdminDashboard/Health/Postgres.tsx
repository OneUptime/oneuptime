import PostgresCluster from "./PostgresCluster";
import PostgresHealthSettings from "./PostgresHealthSettings";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Health > PostgreSQL content: cluster health (replication, slots,
 * connections, locks, cache hits, wraparound headroom) and the settings for
 * the PostgreSQL health notifications the enterprise worker evaluates.
 */
const HealthPostgresContent: FunctionComponent = (): ReactElement => {
  return (
    <>
      <PostgresCluster />
      <PostgresHealthSettings />
    </>
  );
};

export default HealthPostgresContent;
