import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import CephResourceUtils from "../Utils/CephResourceUtils";

/*
 * OSD list page reading the CephResource Postgres inventory (kind=Osd)
 * instead of groupBy-ing ClickHouse metrics — same architecture as
 * Pages/Kubernetes/View/Nodes.tsx. The detail route param is the
 * resource externalId (the `ceph_daemon` label, e.g. `osd.3`).
 */
const CephClusterOsds: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const rows: Array<CephResourceModel> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: modelId,
          kinds: ["Osd"],
        });

      rows.sort((a: CephResourceModel, b: CephResourceModel) => {
        return CephResourceUtils.compareDaemonNames(
          a.externalId || "",
          b.externalId || "",
        );
      });

      const list: Array<InfrastructureResource> = rows.map(
        (row: CephResourceModel): InfrastructureResource => {
          const statBytes: number | null = CephResourceUtils.freshMetricValue(
            row,
            row.statBytes,
          );
          const statBytesUsed: number | null =
            CephResourceUtils.freshMetricValue(row, row.statBytesUsed);
          const usedPercent: number | null =
            statBytes !== null && statBytesUsed !== null && statBytes > 0
              ? (statBytesUsed / statBytes) * 100
              : null;
          const applyLatencyMs: number | null =
            CephResourceUtils.freshMetricValue(row, row.applyLatencyMs);
          const commitLatencyMs: number | null =
            CephResourceUtils.freshMetricValue(row, row.commitLatencyMs);
          const pgCount: number | null = CephResourceUtils.freshMetricValue(
            row,
            row.pgCount,
          );

          return {
            name: row.externalId || "",
            namespace: row.hostname || "",
            cpuUtilization: null,
            memoryUsageBytes: null,
            memoryLimitBytes: null,
            status: row.isUp ? "Up" : "Down",
            age: CephResourceUtils.formatAge(row.createdAt),
            additionalAttributes: {
              in: row.isIn ? "In" : "Out",
              deviceClass: row.deviceClass || "—",
              used:
                usedPercent !== null
                  ? `${CephResourceUtils.formatBytes(statBytesUsed)} / ${CephResourceUtils.formatBytes(statBytes)} (${usedPercent.toFixed(1)}%)`
                  : "—",
              pgs: pgCount !== null ? Math.round(pgCount).toString() : "—",
              latency:
                applyLatencyMs !== null || commitLatencyMs !== null
                  ? `${applyLatencyMs !== null ? applyLatencyMs.toFixed(0) : "—"} / ${commitLatencyMs !== null ? commitLatencyMs.toFixed(0) : "—"} ms`
                  : "—",
            },
          };
        },
      );

      setResources(list);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="OSDs"
      description="Object storage daemons in this cluster. Up means the daemon is running; In means it participates in data placement."
      resources={resources}
      tableIdPrefix="ceph"
      groupColumnTitle="Host"
      showResourceMetrics={false}
      columns={[
        { title: "In / Out", key: "in" },
        { title: "Class", key: "deviceClass" },
        { title: "Used / Total", key: "used" },
        { title: "PGs", key: "pgs" },
        { title: "Apply / Commit Latency", key: "latency" },
      ]}
      emptyMessage="No OSDs found in the inventory yet. OSDs appear here a few minutes after the Ceph agent starts sending metrics."
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default CephClusterOsds;
