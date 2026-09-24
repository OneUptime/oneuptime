import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import EnterprisePluginPage from "../../Enterprise/EnterprisePluginPage";
import { getAdminDashboardPlugins } from "../../Enterprise/Plugins";
import ClickhouseCapacity from "./ClickhouseCapacity";
import ClickhouseCapacitySettings from "./ClickhouseCapacitySettings";
import EnterpriseHealthUpgrade from "./EnterpriseHealthUpgrade";
import HealthPage from "./HealthPage";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The ClickHouse datastore page, on every edition.
 *
 * Capacity and its settings (capacity notifications and automatic pruning)
 * are Community Edition features, so they always render: a full ClickHouse
 * disk stops ingestion on every edition. Cluster health (shards, the
 * distributed-DDL queue, replication, Keeper) is an Enterprise Edition
 * feature and comes from the enterprise plugin, or an upsell in its place.
 *
 * Telemetry ingestion lives under Diagnostics > Telemetry, where it sits
 * beside the per-project breakdown. This page stays about the datastore
 * itself: capacity, shards and replication.
 */
const HealthClickhouse: FunctionComponent = (): ReactElement => {
  return (
    <HealthPage
      title="ClickHouse"
      currentRoute={RouteMap[PageMap.HEALTH_CLICKHOUSE] as Route}
    >
      <ClickhouseCapacity />
      <EnterprisePluginPage
        plugin={getAdminDashboardPlugins().HealthClickhouseCluster}
        renderUpsell={(): ReactElement => {
          return (
            <EnterpriseHealthUpgrade
              featureName="ClickHouse cluster health"
              featureDescription="Shard reachability, the distributed-DDL queue, replica and replication-queue state and the Keeper connection for the ClickHouse backing this instance."
              showEveryEditionNote={false}
            />
          );
        }}
      />
      <ClickhouseCapacitySettings />
    </HealthPage>
  );
};

export default HealthClickhouse;
