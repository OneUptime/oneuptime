import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * Pool list page reading the CephResource Postgres inventory (kind=Pool).
 * The inventory deliberately stores ceph_pool_rd / ceph_pool_wr as raw
 * cumulative counters (readOpsCounter / writeOpsCounter), so the IOPS
 * columns come from ClickHouse rate math over a short recent window —
 * never from the counter columns. The detail route param is the
 * resource externalId (the `pool_id` label).
 */

const IOPS_WINDOW_MINUTES: number = 15;

const CephClusterPools: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchPoolRates: (
    clusterName: string,
    metricName: string,
  ) => Promise<Map<string, number>> = async (
    clusterName: string,
    metricName: string,
  ): Promise<Map<string, number>> => {
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveMinutes(
      endDate,
      -IOPS_WINDOW_MINUTES,
    );

    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: {
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!,
          time: new InBetween(startDate, endDate),
          name: metricName,
          attributes: {
            "resource.ceph.cluster.name": clusterName,
          } as Dictionary<string | number | boolean>,
        },
        // Max preserves the raw counter value per bucket (no delta skew).
        aggregationType: AggregationType.Max,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: startDate,
        endTimestamp: endDate,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        groupBy: {
          attributes: true,
        },
      },
    });

    return CephResourceUtils.computeRatePerSeriesKey(result, "pool_id");
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const rows: Array<CephResourceModel> =
        await CephResourceUtils.fetchCephResources({
          cephClusterId: modelId,
          kinds: ["Pool"],
        });

      /*
       * IOPS rates are supplementary — a ClickHouse hiccup must not
       * blank the Postgres-served inventory list, so failures degrade
       * the two columns to "—".
       */
      let readRates: Map<string, number> = new Map();
      let writeRates: Map<string, number> = new Map();
      try {
        const cluster: CephCluster | null = await ModelAPI.getItem({
          modelType: CephCluster,
          id: modelId,
          select: {
            name: true,
          },
        });
        if (cluster?.name) {
          [readRates, writeRates] = await Promise.all([
            fetchPoolRates(cluster.name, "ceph_pool_rd"),
            fetchPoolRates(cluster.name, "ceph_pool_wr"),
          ]);
        }
      } catch {
        // Rate columns render "—" when ClickHouse is unavailable.
      }

      rows.sort((a: CephResourceModel, b: CephResourceModel) => {
        return (a.name || a.externalId || "").localeCompare(
          b.name || b.externalId || "",
        );
      });

      const list: Array<InfrastructureResource> = rows.map(
        (row: CephResourceModel): InfrastructureResource => {
          const storedBytes: number | null = CephResourceUtils.freshMetricValue(
            row,
            row.storedBytes,
          );
          const maxAvailBytes: number | null =
            CephResourceUtils.freshMetricValue(row, row.maxAvailBytes);
          const objects: number | null = CephResourceUtils.freshMetricValue(
            row,
            row.objects,
          );
          const usedPercent: number | null =
            storedBytes !== null &&
            maxAvailBytes !== null &&
            storedBytes + maxAvailBytes > 0
              ? (storedBytes / (storedBytes + maxAvailBytes)) * 100
              : null;

          const poolId: string = row.externalId || "";
          const readRate: number | undefined = readRates.get(poolId);
          const writeRate: number | undefined = writeRates.get(poolId);

          return {
            name: row.name || `pool ${poolId}`,
            namespace: "",
            cpuUtilization: null,
            memoryUsageBytes: null,
            memoryLimitBytes: null,
            status: "",
            age: CephResourceUtils.formatAge(row.createdAt),
            additionalAttributes: {
              externalId: poolId,
              stored: CephResourceUtils.formatBytes(storedBytes),
              maxAvail: CephResourceUtils.formatBytes(maxAvailBytes),
              usedPercent: CephResourceUtils.formatPercent(usedPercent),
              objects: CephResourceUtils.formatCount(objects),
              readIops:
                readRate !== undefined ? `${readRate.toFixed(1)}/s` : "—",
              writeIops:
                writeRate !== undefined ? `${writeRate.toFixed(1)}/s` : "—",
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
      title="Pools"
      description={`Storage pools in this cluster. Read / write IOPS are averaged over the last ${IOPS_WINDOW_MINUTES} minutes.`}
      resources={resources}
      tableIdPrefix="ceph"
      showGroupColumn={false}
      showStatus={false}
      showResourceMetrics={false}
      columns={[
        { title: "Stored", key: "stored" },
        { title: "Max Avail", key: "maxAvail" },
        { title: "Used", key: "usedPercent" },
        { title: "Objects", key: "objects" },
        { title: "Read IOPS", key: "readIops" },
        { title: "Write IOPS", key: "writeIops" },
      ]}
      emptyMessage="No pools found in the inventory yet. Pools appear here a few minutes after the Ceph agent starts sending metrics."
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(
              resource.additionalAttributes["externalId"] || "",
            ),
          },
        );
      }}
    />
  );
};

export default CephClusterPools;
