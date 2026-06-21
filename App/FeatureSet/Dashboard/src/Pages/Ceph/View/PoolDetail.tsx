import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import CephResourceModel from "Common/Models/DatabaseModels/CephResource";
import Card from "Common/UI/Components/Card/Card";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceOverviewTab, {
  SummaryField,
} from "../../../Components/Infrastructure/ResourceOverviewTab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import CephRateChart from "../../../Components/Ceph/CephRateChart";
import CephResourceUtils, {
  GrowthFitSample,
  GrowthProjection,
} from "../Utils/CephResourceUtils";

/*
 * Pool detail page. The route param (subModelId) is the CephResource
 * externalId — the `pool_id` datapoint label (e.g. `2`) — not a database
 * id and not the pool name: pool DATA series carry only `pool_id`, so
 * every metric filter below stays valid even when the pool is renamed.
 */

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";

/*
 * Growth projection (WI-29): least-squares fit of ceph_pool_stored over
 * the last 24h against the pool's writable limit (stored + max_avail) —
 * the UI-only analog of the upstream CephPoolGrowthWarning mixin alert.
 */
const PROJECTION_WINDOW_HOURS: number = 24;

/*
 * Below this much observed history the projection is rendered with an
 * explicit low-confidence caveat instead of a confident "~N days".
 */
const MIN_CONFIDENT_FIT_SPAN_MS: number = 2 * 60 * 60 * 1000;

const CephClusterPoolDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const poolId: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [resource, setResource] = useState<CephResourceModel | null>(null);
  const [growth, setGrowth] = useState<GrowthProjection | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingResource, setIsLoadingResource] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: CephCluster | null = await ModelAPI.getItem({
        modelType: CephCluster,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  const fetchResource: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingResource(true);
    try {
      const result: ListResult<CephResourceModel> =
        await ModelAPI.getList<CephResourceModel>({
          modelType: CephResourceModel,
          query: {
            cephClusterId: modelId,
            kind: "Pool",
            externalId: poolId,
          },
          skip: 0,
          limit: 1,
          select: {
            externalId: true,
            name: true,
            storedBytes: true,
            maxAvailBytes: true,
            objects: true,
            metricsUpdatedAt: true,
            lastSeenAt: true,
            createdAt: true,
          },
          sort: {},
        });
      setResource(result.data[0] || null);
    } catch {
      // Graceful degradation — overview tab shows the empty state.
    }
    setIsLoadingResource(false);
  };

  /*
   * Pure client math on the already-stored metric series — no new
   * metrics, no alerting (same fetch shape as the cluster Overview's
   * capacity projection). Failures simply hide the growth row.
   */
  const fetchGrowthProjection: (clusterName: string) => Promise<void> = async (
    clusterName: string,
  ): Promise<void> => {
    try {
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(
        endDate,
        -PROJECTION_WINDOW_HOURS,
      );

      const fetchSamples: (
        metricName: string,
      ) => Promise<Array<GrowthFitSample>> = async (
        metricName: string,
      ): Promise<Array<GrowthFitSample>> => {
        const result: AggregatedResult =
          await AnalyticsModelAPI.aggregate<Metric>({
            modelType: Metric,
            aggregateBy: {
              query: {
                projectId: ProjectUtil.getCurrentProjectId()!,
                time: new InBetween(startDate, endDate),
                name: metricName,
                attributes: {
                  [CLUSTER_ATTR]: clusterName,
                  pool_id: poolId,
                } as Dictionary<string | number | boolean>,
              },
              aggregationType: AggregationType.Avg,
              aggregateColumnName: "value",
              aggregationTimestampColumnName: "time",
              startTimestamp: startDate,
              endTimestamp: endDate,
              limit: LIMIT_PER_PROJECT,
              skip: 0,
            },
          });

        const samples: Array<GrowthFitSample> = [];
        for (const p of (result.data || []) as Array<AggregatedModel>) {
          const raw: unknown =
            p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
          const t: number =
            raw instanceof Date
              ? raw.getTime()
              : new Date(raw as string).getTime();
          const v: number = Number(p["value"]);
          if (Number.isFinite(t) && Number.isFinite(v)) {
            samples.push({ t, v });
          }
        }
        samples.sort((a: GrowthFitSample, b: GrowthFitSample) => {
          return a.t - b.t;
        });
        return samples;
      };

      const [storedSamples, maxAvailSamples]: [
        Array<GrowthFitSample>,
        Array<GrowthFitSample>,
      ] = await Promise.all([
        fetchSamples("ceph_pool_stored"),
        fetchSamples("ceph_pool_max_avail"),
      ]);

      if (storedSamples.length < 3 || maxAvailSamples.length === 0) {
        return;
      }

      /*
       * The pool is full when stored reaches stored + max_avail — both
       * taken from the latest samples so the target tracks replication
       * and cluster-capacity changes.
       */
      const latestStored: number = storedSamples[storedSamples.length - 1]!.v;
      const latestMaxAvail: number =
        maxAvailSamples[maxAvailSamples.length - 1]!.v;
      const capacityBytes: number = latestStored + latestMaxAvail;
      if (capacityBytes <= 0) {
        return;
      }

      setGrowth(
        CephResourceUtils.linearGrowthDaysToTarget(
          storedSamples,
          capacityBytes,
        ),
      );
    } catch {
      // Best-effort — the growth projection row simply stays hidden.
    }
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
    fetchResource().catch(() => {});
  }, []);

  // ClickHouse-backed projection loads once the cluster name is known.
  useEffect(() => {
    if (!cluster?.name) {
      return;
    }
    fetchGrowthProjection(cluster.name).catch(() => {});
  }, [cluster?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = cluster.name;
  const poolDisplayName: string = resource?.name || `pool ${poolId}`;

  const buildPoolQuery: (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }) => MetricQueryConfigData = (args: {
    variable: string;
    title: string;
    description: string;
    legend: string;
    legendUnit: string;
    metricName: string;
  }): MetricQueryConfigData => {
    return {
      metricAliasData: {
        metricVariable: args.variable,
        title: args.title,
        description: args.description,
        legend: args.legend,
        legendUnit: args.legendUnit,
      },
      metricQueryData: {
        filterData: {
          metricName: args.metricName,
          attributes: {
            "resource.ceph.cluster.name": clusterName,
            pool_id: poolId,
          },
          aggegationType: AggregationType.Max,
          aggregateBy: {},
        },
      },
    };
  };

  const queryConfigs: Array<MetricQueryConfigData> = [
    buildPoolQuery({
      variable: "pool_stored",
      title: "Stored Bytes",
      description: `Bytes stored in ${poolDisplayName} (after replication).`,
      legend: "Stored",
      legendUnit: "bytes",
      metricName: "ceph_pool_stored",
    }),
    buildPoolQuery({
      variable: "pool_max_avail",
      title: "Max Available",
      description: `Bytes still writable into ${poolDisplayName} given current cluster capacity and replication.`,
      legend: "Max Avail",
      legendUnit: "bytes",
      metricName: "ceph_pool_max_avail",
    }),
    buildPoolQuery({
      variable: "pool_objects",
      title: "Objects",
      description: `Number of RADOS objects in ${poolDisplayName}.`,
      legend: "Objects",
      legendUnit: "",
      metricName: "ceph_pool_objects",
    }),
  ];

  // Build overview summary fields from the inventory row.
  const storedBytes: number | null = resource
    ? CephResourceUtils.freshMetricValue(resource, resource.storedBytes)
    : null;
  const maxAvailBytes: number | null = resource
    ? CephResourceUtils.freshMetricValue(resource, resource.maxAvailBytes)
    : null;
  const usedPercent: number | null =
    storedBytes !== null &&
    maxAvailBytes !== null &&
    storedBytes + maxAvailBytes > 0
      ? (storedBytes / (storedBytes + maxAvailBytes)) * 100
      : null;

  const summaryFields: Array<SummaryField> = [
    { title: "Pool", value: poolDisplayName },
    { title: "Pool ID", value: poolId },
    { title: "Cluster", value: clusterName },
  ];

  /*
   * WI-29: "pool ~full in N days" from the stored-bytes linear fit.
   * Shown only when it carries signal (growing or already at capacity);
   * an explicit caveat keeps it honest when under 2h of history backs
   * the fit.
   */
  const growthValue: string | null = (() => {
    if (!growth || growth.daysToTarget === null) {
      return null;
    }
    if (growth.daysToTarget === 0) {
      return "At capacity — no writable space left";
    }
    if (!Number.isFinite(growth.daysToTarget)) {
      return null;
    }
    const caveat: string =
      growth.sampleSpanMs < MIN_CONFIDENT_FIT_SPAN_MS
        ? " (low confidence — under 2h of history)"
        : "";
    if (growth.daysToTarget > 365) {
      return `Full in >1 year at current growth${caveat}`;
    }
    return `Full in ~${Math.max(1, Math.round(growth.daysToTarget))}d at current growth${caveat}`;
  })();

  if (resource) {
    summaryFields.push(
      {
        title: "Stored",
        value: CephResourceUtils.formatBytes(storedBytes),
      },
      {
        title: "Max Available",
        value: CephResourceUtils.formatBytes(maxAvailBytes),
      },
      {
        title: "Used",
        value: CephResourceUtils.formatPercent(usedPercent),
      },
    );
    if (growthValue) {
      summaryFields.push({
        title: "Growth",
        value: growthValue,
      });
    }
    summaryFields.push(
      {
        title: "Objects",
        value: CephResourceUtils.formatCount(
          resource
            ? CephResourceUtils.freshMetricValue(resource, resource.objects)
            : null,
        ),
      },
      {
        title: "Last Seen",
        value: CephResourceUtils.formatLastSeen(resource.lastSeenAt),
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <ResourceOverviewTab
          summaryFields={resource ? summaryFields : []}
          labels={{}}
          annotations={{}}
          isLoading={isLoadingResource}
          emptyMessage={`Pool ${poolId} is not in the inventory yet. It appears here a few minutes after the Ceph agent starts sending metrics.`}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Pool Metrics: ${poolDisplayName}`}
          description="Stored capacity growth, object count, IOPS, and throughput for this pool."
        >
          <ResourceMetricsTab
            queryConfigs={queryConfigs}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              return (
                <div className="mt-4 space-y-6">
                  <div>
                    <div className="mb-2 text-sm font-medium text-gray-700">
                      Client IOPS
                    </div>
                    <CephRateChart
                      clusterName={clusterName}
                      series={[
                        { metricName: "ceph_pool_rd", label: "Read" },
                        { metricName: "ceph_pool_wr", label: "Write" },
                      ]}
                      seriesKeyAttributes={["pool_id"]}
                      extraAttributes={{ pool_id: poolId }}
                      startDate={dateRange.startValue}
                      endDate={dateRange.endValue}
                      syncId={`ceph-pool-detail-${poolId}`}
                      emptyMessage="No I/O reported for this pool in the selected time range."
                    />
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-medium text-gray-700">
                      Client Throughput
                    </div>
                    <CephRateChart
                      clusterName={clusterName}
                      series={[
                        { metricName: "ceph_pool_rd_bytes", label: "Read" },
                        { metricName: "ceph_pool_wr_bytes", label: "Write" },
                      ]}
                      seriesKeyAttributes={["pool_id"]}
                      extraAttributes={{ pool_id: poolId }}
                      startDate={dateRange.startValue}
                      endDate={dateRange.endValue}
                      yAxisUnit="By/s"
                      syncId={`ceph-pool-detail-${poolId}`}
                      emptyMessage="No throughput reported for this pool in the selected time range."
                    />
                  </div>
                </div>
              );
            }}
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default CephClusterPoolDetail;
