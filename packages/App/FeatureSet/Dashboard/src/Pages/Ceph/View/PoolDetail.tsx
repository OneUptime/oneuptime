import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
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
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import Dictionary from "Common/Types/Dictionary";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import CephRateChart from "../../../Components/Ceph/CephRateChart";
import CephPartHero from "../../../Components/Ceph/Part/CephPartHero";
import CephPoolOverview from "../../../Components/Ceph/Part/CephPoolOverview";
import {
  CephPartRoutes,
  getCephPartRoutes,
} from "../../../Components/Ceph/Part/CephPartRoutes";
import useCephPart, {
  CephPart,
} from "../../../Components/Ceph/Part/UseCephPart";
import CephResourceUtils, {
  GrowthFitSample,
  GrowthProjection,
} from "../Utils/CephResourceUtils";
import {
  CephAssessment,
  CephPoolPgStates,
  assessCephPool,
} from "../Utils/CephHealth";
import { CephPgStateReadings, loadCephPgStates } from "../Utils/CephReadings";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import { CEPH_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/CephMetricDescriptions";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A pool's page: its hero (its state by the cluster's rules, its id, what
 * it stores and its objects), then its Overview - what about it needs
 * attention, how full it is, its placement groups, what is open on it, the
 * pool alerts and its details - and its metrics over time.
 *
 * The route's part (subModelId) is the pool's `pool_id` (2), not a database
 * id and not its name: pool data series carry only `pool_id`, so every
 * metric filter below stays valid when the pool is renamed.
 */

const CLUSTER_ATTR: string = "resource.ceph.cluster.name";

/*
 * Growth projection: a least-squares fit of ceph_pool_stored over the last
 * 24 hours against the pool's writable limit (stored + max_avail) - the
 * UI-only analog of the upstream CephPoolGrowthWarning mixin alert.
 */
const PROJECTION_WINDOW_HOURS: number = 24;

const CephClusterPoolDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const poolId: string = Navigation.getLastParamAsString();

  const part: CephPart = useCephPart({
    clusterId: modelId,
    kind: "Pool",
    externalId: poolId,
  });

  const [growth, setGrowth] = useState<GrowthProjection | null>(null);
  const [pgStates, setPgStates] = useState<CephPoolPgStates | null>(null);

  const clusterName: string = part.cluster?.name || "";

  /*
   * Pure client math on the already-stored metric series - no new metrics,
   * no alerting (the cluster Overview's capacity projection, per pool).
   * Failures leave the growth row out.
   */
  const fetchGrowthProjection: (name: string) => Promise<void> = async (
    name: string,
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
                  [CLUSTER_ATTR]: name,
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
       * The pool is full when stored reaches stored + max_avail, both from
       * the latest samples, so the target follows replication and
       * cluster-capacity changes.
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
      // Best-effort: the growth row stays out.
    }
  };

  // Its placement groups by state: best-effort, as the Pools list reads them.
  const fetchPgStates: (name: string) => Promise<void> = async (
    name: string,
  ): Promise<void> => {
    try {
      const states: CephPgStateReadings = await loadCephPgStates(name);
      setPgStates(states.byPool.get(poolId) || null);
    } catch {
      setPgStates(null);
    }
  };

  // The metrics' reads wait for the cluster's name.
  useEffect(() => {
    if (!clusterName) {
      return;
    }
    fetchGrowthProjection(clusterName).catch(() => {});
    fetchPgStates(clusterName).catch(() => {});
  }, [clusterName]);

  if (part.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (part.error) {
    return <ErrorMessage message={part.error} />;
  }

  if (!clusterName) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const routes: CephPartRoutes = getCephPartRoutes(modelId);
  const poolDisplayName: string = part.row?.name || `pool ${poolId}`;
  const assessment: CephAssessment | null = part.row
    ? assessCephPool(part.row, {
        now: part.readAt,
        newestSeenAt: part.newestSeenAt,
        pgStates: pgStates,
      })
    : null;

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
    // The charts draw their titles and legends as they are given.
    return {
      metricAliasData: {
        metricVariable: args.variable,
        title: translator.translateText(args.title) || args.title,
        description: args.description,
        legend: translator.translateText(args.legend) || args.legend,
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
      /*
       * ceph_pool_stored is Ceph's STORED figure: what clients wrote, before
       * replication copies (the replicated size is ceph_pool_stored_raw).
       */
      description: translator.translateTemplate(
        "Bytes clients stored in {{poolName}}, before replication copies.",
        { poolName: poolDisplayName },
      ),
      legend: "Stored",
      legendUnit: "bytes",
      metricName: "ceph_pool_stored",
    }),
    buildPoolQuery({
      variable: "pool_max_avail",
      title: "Max Available",
      description: translator.translateTemplate(
        "Bytes still writable into {{poolName}} given current cluster capacity and replication.",
        { poolName: poolDisplayName },
      ),
      legend: "Max Avail",
      legendUnit: "bytes",
      metricName: "ceph_pool_max_avail",
    }),
    buildPoolQuery({
      variable: "pool_objects",
      title: "Objects",
      description: translator.translateTemplate(
        "Number of RADOS objects in {{poolName}}.",
        { poolName: poolDisplayName },
      ),
      legend: "Objects",
      legendUnit: "",
      metricName: "ceph_pool_objects",
    }),
  ];

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: part.isLoadingRows ? (
        <PageLoader isVisible={true} />
      ) : part.rowError ? (
        <ResourcePartReadError
          testId="ceph-pool-read-error"
          title="Couldn't load this pool"
          message={part.rowError}
          onRetry={part.refresh}
        />
      ) : (
        <CephPoolOverview
          clusterId={modelId}
          clusterName={clusterName}
          externalId={poolId}
          row={part.row}
          newestSeenAt={part.newestSeenAt}
          pgStates={pgStates}
          growth={growth}
          routes={routes}
          now={part.readAt}
        />
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate("Pool Metrics: {{poolName}}", {
            poolName: poolDisplayName,
          })}
          description="Stored capacity growth, object count, IOPS, and throughput for this pool."
        >
          <ResourceMetricsTab
            queryConfigs={queryConfigs}
            renderExtraCharts={(dateRange: InBetween<Date>): ReactElement => {
              /*
               * The tab's card hands these charts its zoom. Their headings
               * name the drag, revealed while the pointer is over that
               * chart (its named group), as the metric panels above name
               * it in theirs.
               */
              return (
                <div className="mt-4 space-y-6">
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      {translator.translateText("Client IOPS")}
                      <InfoTooltip
                        label="Client IOPS"
                        text={CEPH_METRIC_DESCRIPTIONS.poolClientIops}
                      />
                      <TimeRangeZoomHint
                        revealOnHover={true}
                        className="ml-auto font-normal"
                      />
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
                  <div className="group/zoomhint">
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      {translator.translateText("Client Throughput")}
                      <InfoTooltip
                        label="Client Throughput"
                        text={CEPH_METRIC_DESCRIPTIONS.poolClientThroughput}
                      />
                      <TimeRangeZoomHint
                        revealOnHover={true}
                        className="ml-auto font-normal"
                      />
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

  return (
    <div data-testid="ceph-pool-page">
      <CephPartHero
        kind="Pool"
        row={part.row}
        externalId={poolId}
        assessment={assessment}
        clusterName={clusterName}
        clusterRoute={routes.clusterRoute}
        now={part.readAt}
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default CephClusterPoolDetail;
