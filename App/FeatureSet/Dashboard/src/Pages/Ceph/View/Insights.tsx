import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import Card from "Common/UI/Components/Card/Card";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import CephRateChart from "../../../Components/Ceph/CephRateChart";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import InBetween from "Common/Types/BaseDatabase/InBetween";

/*
 * Curated MetricView presets sharing one time-range state — the Ceph
 * analog of Pages/Kubernetes/View/Insights.tsx. Explicitly NOT computed
 * recommendations; the spec scopes Insights to curated charts.
 */

interface MetricSpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  groupByAttributes?: boolean | undefined;
}

function buildQuery(
  spec: MetricSpec,
  clusterName: string,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: spec.variable,
      title: spec.title,
      description: spec.description,
      legend: spec.legend,
      legendUnit: spec.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: spec.metricName,
        attributes: {
          "resource.ceph.cluster.name": clusterName,
        },
        aggegationType: spec.aggregation,
        aggregateBy: {},
      },
      ...(spec.groupByAttributes
        ? {
            groupBy: {
              attributes: true,
            },
          }
        : {}),
    },
  };
}

function buildMetricViewData(
  queries: Array<MetricQueryConfigData>,
  startAndEndDate: InBetween<Date>,
): MetricViewData {
  return {
    startAndEndDate,
    queryConfigs: queries,
    formulaConfigs: [],
  };
}

interface SectionProps {
  title: string;
  description: string;
  icon: IconProp;
  data?: MetricViewData | undefined;
  children?: ReactElement | undefined;
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (newTimeRange: RangeStartAndEndDateTime) => void;
}

const InsightsSection: FunctionComponent<SectionProps> = (
  props: SectionProps,
): ReactElement => {
  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <Icon icon={props.icon} className="h-5 w-5 text-gray-500" />
          <span>{props.title}</span>
        </div>
      }
      description={props.description}
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={props.timeRange}
          onChange={props.onTimeRangeChange}
        />
      }
    >
      {props.children ??
        (props.data ? (
          <MetricView
            data={props.data}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            hideCardInCharts={true}
            onChange={() => {}}
          />
        ) : undefined)}
    </Card>
  );
};

function getCapacityQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cluster_used_bytes",
        title: "Cluster Capacity Used",
        description: "Raw storage used across all OSDs (bytes).",
        legend: "Used",
        legendUnit: "bytes",
        metricName: "ceph_cluster_total_used_bytes",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pool_stored",
        title: "Stored Bytes per Pool",
        description: "Bytes stored per pool (after replication).",
        legend: "Stored",
        legendUnit: "bytes",
        metricName: "ceph_pool_stored",
        aggregation: AggregationType.Max,
        groupByAttributes: true,
      },
      cluster,
    ),
  ];
}

function getLatencyQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "osd_apply_latency",
        title: "OSD Apply Latency",
        description: "Apply latency per OSD (ms).",
        legend: "Apply",
        legendUnit: "ms",
        metricName: "ceph_osd_apply_latency_ms",
        aggregation: AggregationType.Avg,
        groupByAttributes: true,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "osd_commit_latency",
        title: "OSD Commit Latency",
        description: "Commit latency per OSD (ms).",
        legend: "Commit",
        legendUnit: "ms",
        metricName: "ceph_osd_commit_latency_ms",
        aggregation: AggregationType.Avg,
        groupByAttributes: true,
      },
      cluster,
    ),
  ];
}

function getDataHealthQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "objects_degraded",
        title: "Degraded Objects",
        description:
          "Objects with fewer replicas than configured. Non-zero means redundancy is reduced.",
        legend: "Degraded",
        legendUnit: "",
        metricName: "ceph_num_objects_degraded",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "objects_misplaced",
        title: "Misplaced Objects",
        description:
          "Objects not stored on their CRUSH-intended OSDs (usually during rebalancing).",
        legend: "Misplaced",
        legendUnit: "",
        metricName: "ceph_num_objects_misplaced",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pg_degraded",
        title: "Degraded Placement Groups",
        description: "Placement groups with reduced redundancy.",
        legend: "Degraded PGs",
        legendUnit: "",
        metricName: "ceph_pg_degraded",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pg_undersized",
        title: "Undersized Placement Groups",
        description:
          "Placement groups mapped to fewer OSDs than their configured replica count.",
        legend: "Undersized PGs",
        legendUnit: "",
        metricName: "ceph_pg_undersized",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
  ];
}

const CephClusterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<CephCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

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

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

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

  const capacityData: MetricViewData = buildMetricViewData(
    getCapacityQueries(clusterName),
    startAndEndDate,
  );
  const latencyData: MetricViewData = buildMetricViewData(
    getLatencyQueries(clusterName),
    startAndEndDate,
  );
  const dataHealthData: MetricViewData = buildMetricViewData(
    getDataHealthQueries(clusterName),
    startAndEndDate,
  );

  return (
    <Fragment>
      <InsightsSection
        title="Capacity"
        description="Cluster-wide capacity usage and per-pool stored bytes."
        icon={IconProp.ChartBar}
        data={capacityData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Client I/O"
        description="Per-second client IOPS and throughput summed across all pools."
        icon={IconProp.Signal}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      >
        <div className="space-y-6">
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
              startDate={startAndEndDate.startValue}
              endDate={startAndEndDate.endValue}
              syncId={`ceph-insights-${clusterName}`}
              emptyMessage="No client I/O reported in the selected time range."
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
              startDate={startAndEndDate.startValue}
              endDate={startAndEndDate.endValue}
              yAxisUnit="By/s"
              syncId={`ceph-insights-${clusterName}`}
              emptyMessage="No throughput reported in the selected time range."
            />
          </div>
        </div>
      </InsightsSection>

      <InsightsSection
        title="Latency"
        description="Apply and commit latency broken down per OSD."
        icon={IconProp.Clock}
        data={latencyData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Data Health"
        description="Degraded / misplaced objects and problem placement groups."
        icon={IconProp.ShieldCheck}
        data={dataHealthData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />
    </Fragment>
  );
};

export default CephClusterInsights;
