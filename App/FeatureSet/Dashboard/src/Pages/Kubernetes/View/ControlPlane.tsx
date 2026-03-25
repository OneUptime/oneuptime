import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
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
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import InBetween from "Common/Types/BaseDatabase/InBetween";

// ──────────────────────────────────────────────────────────────────────────────
// Query builder helper
// ──────────────────────────────────────────────────────────────────────────────

interface MetricQuerySpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  yAxisFormatter?: (value: number) => string;
}

function buildQuery(
  spec: MetricQuerySpec,
  clusterIdentifier: string,
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
          "resource.k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: spec.aggregation,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: spec.yAxisFormatter,
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

// ──────────────────────────────────────────────────────────────────────────────
// Section component — one Card per control plane component
// ──────────────────────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description: string;
  icon: IconProp;
  data: MetricViewData;
}

const ControlPlaneSection: FunctionComponent<SectionProps> = (
  props: SectionProps,
): ReactElement => {
  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <Icon
            icon={props.icon}
            className="h-5 w-5 text-gray-500"
          />
          <span>{props.title}</span>
        </div>
      }
      description={props.description}
    >
      <MetricView
        data={props.data}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={() => {}}
      />
    </Card>
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// Metric specs per control plane component
// ──────────────────────────────────────────────────────────────────────────────

function getEtcdQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "etcd_db_size",
        title: "Database Size",
        description: "Total size of the etcd MVCC database on disk.",
        legend: "DB Size",
        legendUnit: "",
        metricName: "etcd_mvcc_db_total_size_in_bytes",
        aggregation: AggregationType.Avg,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_db_size_in_use",
        title: "Database Size In Use",
        description: "Actual used size of the etcd database (after compaction).",
        legend: "In Use",
        legendUnit: "",
        metricName: "etcd_mvcc_db_total_size_in_use_in_bytes",
        aggregation: AggregationType.Avg,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_keys_total",
        title: "Total Keys",
        description: "Total number of keys stored in etcd.",
        legend: "Keys",
        legendUnit: "",
        metricName: "etcd_debugging_mvcc_keys_total",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_leader_changes",
        title: "Leader Changes",
        description:
          "Number of leader changes seen. Frequent changes indicate instability.",
        legend: "Changes",
        legendUnit: "",
        metricName: "etcd_server_leader_changes_seen_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_proposals_failed",
        title: "Failed Proposals",
        description: "Total number of failed raft proposals.",
        legend: "Failed",
        legendUnit: "",
        metricName: "etcd_server_proposals_failed_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_disk_wal_fsync",
        title: "WAL Fsync Duration",
        description:
          "Latency of WAL fsync operations. High values cause slow commits.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "etcd_disk_wal_fsync_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_disk_backend_commit",
        title: "Backend Commit Duration",
        description: "Latency of backend commit operations.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "etcd_disk_backend_commit_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "etcd_network_peer_sent",
        title: "Network Peer Sent Bytes",
        description: "Total bytes sent to peers. Shows replication traffic.",
        legend: "Sent",
        legendUnit: "",
        metricName: "etcd_network_peer_sent_bytes_total",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
  ];
}

function getApiServerQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "apiserver_requests",
        title: "Request Rate",
        description: "Total API server requests.",
        legend: "Requests",
        legendUnit: "req/s",
        metricName: "apiserver_request_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "apiserver_latency",
        title: "Request Latency",
        description: "Average API server request duration.",
        legend: "Latency",
        legendUnit: "seconds",
        metricName: "apiserver_request_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "apiserver_errors",
        title: "Request Errors (5xx)",
        description:
          "API server 5xx error count. Non-zero values need investigation.",
        legend: "Errors",
        legendUnit: "",
        metricName: "apiserver_request_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "apiserver_inflight_requests",
        title: "In-Flight Requests",
        description:
          "Current number of in-flight requests being processed. High counts indicate API server saturation.",
        legend: "Requests",
        legendUnit: "",
        metricName: "apiserver_current_inflight_requests",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "apiserver_audit_events",
        title: "Audit Events",
        description:
          "Number of audit events processed. Monitors audit pipeline throughput.",
        legend: "Events",
        legendUnit: "",
        metricName: "apiserver_audit_event_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "apiserver_tls_handshake_errors",
        title: "TLS Handshake Errors",
        description:
          "Number of TLS handshake errors. Indicates certificate or connectivity issues.",
        legend: "Errors",
        legendUnit: "",
        metricName: "apiserver_tls_handshake_errors_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

function getSchedulerQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "scheduler_pending",
        title: "Pending Pods",
        description:
          "Number of pods waiting to be scheduled. Sustained values indicate scheduling pressure.",
        legend: "Pending Pods",
        legendUnit: "",
        metricName: "scheduler_pending_pods",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "scheduler_latency",
        title: "Scheduling Latency",
        description: "End-to-end scheduling duration from pod creation to binding.",
        legend: "Latency",
        legendUnit: "seconds",
        metricName: "scheduler_e2e_scheduling_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "scheduler_attempts",
        title: "Scheduling Attempts",
        description: "Number of scheduling attempts by result (scheduled, unschedulable, error).",
        legend: "Attempts",
        legendUnit: "",
        metricName: "scheduler_schedule_attempts_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "scheduler_preemptions",
        title: "Preemption Attempts",
        description: "Number of preemption attempts to free resources for higher-priority pods.",
        legend: "Preemptions",
        legendUnit: "",
        metricName: "scheduler_preemption_attempts_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "scheduler_queue_duration",
        title: "Queue Wait Duration",
        description: "Time pods spend in the scheduling queue before being scheduled.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "scheduler_scheduling_attempt_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
  ];
}

function getControllerManagerQueries(
  cluster: string,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "controller_queue_depth",
        title: "Work Queue Depth",
        description:
          "Current depth of controller work queues. High values mean controllers are falling behind.",
        legend: "Queue Depth",
        legendUnit: "",
        metricName: "workqueue_depth",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "controller_queue_latency",
        title: "Queue Latency",
        description: "Time items spend waiting in the work queue before processing.",
        legend: "Latency",
        legendUnit: "seconds",
        metricName: "workqueue_queue_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "controller_work_duration",
        title: "Work Duration",
        description: "Time spent processing a single work queue item.",
        legend: "Duration",
        legendUnit: "seconds",
        metricName: "workqueue_work_duration_seconds_sum",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "controller_retries",
        title: "Retries",
        description:
          "Number of work queue item retries. Frequent retries indicate reconciliation failures.",
        legend: "Retries",
        legendUnit: "",
        metricName: "workqueue_retries_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "controller_adds",
        title: "Queue Additions",
        description: "Rate of items being added to work queues.",
        legend: "Adds",
        legendUnit: "",
        metricName: "workqueue_adds_total",
        aggregation: AggregationType.Sum,
      },
      cluster,
    ),
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

const KubernetesClusterControlPlane: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
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
  ) => void = useCallback(
    (newTimeRange: RangeStartAndEndDateTime): void => {
      setTimeRange(newTimeRange);
      setStartAndEndDate(
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
      );
    },
    [],
  );

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
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

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterIdentifier: string = cluster.clusterIdentifier || "";

  // Build all metric view data sections
  const etcdData: MetricViewData = buildMetricViewData(
    getEtcdQueries(clusterIdentifier),
    startAndEndDate,
  );
  const apiServerData: MetricViewData = buildMetricViewData(
    getApiServerQueries(clusterIdentifier),
    startAndEndDate,
  );
  const schedulerData: MetricViewData = buildMetricViewData(
    getSchedulerQueries(clusterIdentifier),
    startAndEndDate,
  );
  const controllerData: MetricViewData = buildMetricViewData(
    getControllerManagerQueries(clusterIdentifier),
    startAndEndDate,
  );

  return (
    <Fragment>
      {/* Info banner */}
      <div className="mb-5 flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex-shrink-0 mt-0.5">
          <Icon
            icon={IconProp.Info}
            className="h-5 w-5 text-blue-500"
          />
        </div>
        <div>
          <p className="text-sm font-medium text-blue-800">
            Control Plane Metrics Configuration
          </p>
          <p className="mt-1 text-sm text-blue-600">
            Control plane metrics require{" "}
            <code className="px-1 py-0.5 bg-blue-100 rounded text-xs font-mono">
              controlPlane.enabled: true
            </code>{" "}
            in the kubernetes-agent Helm chart values. This is typically only
            available for self-managed clusters, not managed services like EKS,
            GKE, or AKS.
          </p>
        </div>
      </div>

      {/* Global time range picker */}
      <div className="mb-5 flex items-center justify-end">
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={timeRange}
          onChange={handleTimeRangeChange}
        />
      </div>

      {/* etcd */}
      <ControlPlaneSection
        title="etcd"
        description="Distributed key-value store backing all cluster state. Monitors database size, disk I/O latency, leader stability, and replication health."
        icon={IconProp.Database}
        data={etcdData}
      />

      {/* API Server */}
      <ControlPlaneSection
        title="API Server"
        description="Central management entity that validates and serves all REST operations. Tracks request throughput, latency, error rates, and connection health."
        icon={IconProp.Globe}
        data={apiServerData}
      />

      {/* Scheduler */}
      <ControlPlaneSection
        title="Scheduler"
        description="Assigns pods to nodes based on resource requirements, affinity, and constraints. Monitors scheduling throughput, queue pressure, and preemption activity."
        icon={IconProp.AdjustmentHorizontal}
        data={schedulerData}
      />

      {/* Controller Manager */}
      <ControlPlaneSection
        title="Controller Manager"
        description="Runs core control loops that reconcile cluster state. Tracks work queue depth, processing latency, retries, and throughput across all controllers."
        icon={IconProp.Settings}
        data={controllerData}
      />
    </Fragment>
  );
};

export default KubernetesClusterControlPlane;
